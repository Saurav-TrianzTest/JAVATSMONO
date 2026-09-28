#!/usr/bin/env bash
# =============================================================================
# deploy-image.sh — Deploy storefront-backend to AWS ECS Fargate
# Usage   : bash scripts/deploy-image.sh
# Run from: repository root
# Requires: aws-cli v2, jq
# =============================================================================
set -e
set -o pipefail

SERVICE_NAME="storefront-backend-service"
TASK_FAMILY="storefront-backend-task"
LOG_GROUP="/ecs/storefront-backend"
TASK_DEF_FILE="ecs/task-definition.json"
SVC_DEF_FILE="ecs/service-definition.json"

echo "============================================================"
echo "  storefront-backend — ECS Fargate Deployment Script"
echo "============================================================"
echo ""

# ── AWS Region ────────────────────────────────────────────────────────────────
read -rp "AWS Region [us-east-1]: " AWS_REGION
AWS_REGION="${AWS_REGION:-us-east-1}"

# ── AWS Account ID ────────────────────────────────────────────────────────────
echo "Fetching AWS Account ID..."
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "Account ID: ${ACCOUNT_ID}"

# ── ECS Cluster ───────────────────────────────────────────────────────────────
read -rp "ECS Cluster name [storefront-cluster]: " CLUSTER_NAME
CLUSTER_NAME="${CLUSTER_NAME:-storefront-cluster}"

echo "Checking ECS cluster '${CLUSTER_NAME}'..."
CLUSTER_STATUS=$(aws ecs describe-clusters \
  --clusters "${CLUSTER_NAME}" \
  --region "${AWS_REGION}" \
  --query "clusters[0].status" \
  --output text 2>/dev/null || echo "MISSING")

if [ "${CLUSTER_STATUS}" != "ACTIVE" ]; then
  echo "Creating ECS cluster '${CLUSTER_NAME}'..."
  aws ecs create-cluster --cluster-name "${CLUSTER_NAME}" --region "${AWS_REGION}"
  echo "Cluster created."
else
  echo "Cluster '${CLUSTER_NAME}' is ACTIVE."
fi

# ── Network Configuration ─────────────────────────────────────────────────────
echo ""
echo "── Network Configuration ──────────────────────────────────────────────"
read -rp "VPC ID: " VPC_ID
read -rp "Subnet IDs (comma-separated, e.g. subnet-aaa,subnet-bbb): " SUBNETS_INPUT
read -rp "Security Group ID: " SECURITY_GROUP

# Parse subnets into JSON array
SUBNET_1=$(echo "${SUBNETS_INPUT}" | cut -d',' -f1 | tr -d ' ')
SUBNET_2=$(echo "${SUBNETS_INPUT}" | cut -d',' -f2 | tr -d ' ')
if [ -z "${SUBNET_2}" ]; then
  SUBNET_2="${SUBNET_1}"
fi

# ── ECR Image URI ─────────────────────────────────────────────────────────────
echo ""
read -rp "Full ECR image URI (e.g. 123456789.dkr.ecr.us-east-1.amazonaws.com/storefront-backend:latest): " IMAGE_URI

# ── CloudWatch Log Group ──────────────────────────────────────────────────────
echo ""
echo "Ensuring CloudWatch log group '${LOG_GROUP}' exists..."
aws logs create-log-group --log-group-name "${LOG_GROUP}" --region "${AWS_REGION}" 2>/dev/null || true
echo "Log group ready."

# ── Load Balancer ─────────────────────────────────────────────────────────────
echo ""
read -rp "Do you need an Application Load Balancer for this service? (y/n) [n]: " NEED_LB
NEED_LB="${NEED_LB:-n}"

if [[ "${NEED_LB}" =~ ^[Yy]$ ]]; then
  echo ""
  echo "── Creating Application Load Balancer ─────────────────────────────────"
  read -rp "ALB name [storefront-backend-alb]: " ALB_NAME
  ALB_NAME="${ALB_NAME:-storefront-backend-alb}"

  # Build subnet list for ALB (space-separated)
  ALB_SUBNETS=$(echo "${SUBNETS_INPUT}" | tr ',' ' ')

  echo "Creating ALB '${ALB_NAME}'..."
  ALB_ARN=$(aws elbv2 create-load-balancer \
    --name "${ALB_NAME}" \
    --subnets ${ALB_SUBNETS} \
    --security-groups "${SECURITY_GROUP}" \
    --scheme internet-facing \
    --type application \
    --region "${AWS_REGION}" \
    --query "LoadBalancers[0].LoadBalancerArn" \
    --output text)
  echo "ALB ARN: ${ALB_ARN}"

  ALB_DNS=$(aws elbv2 describe-load-balancers \
    --load-balancer-arns "${ALB_ARN}" \
    --region "${AWS_REGION}" \
    --query "LoadBalancers[0].DNSName" \
    --output text)

  echo "Creating Target Group (type=ip for Fargate awsvpc)..."
  TG_NAME="${ALB_NAME}-tg"
  TARGET_GROUP_ARN=$(aws elbv2 create-target-group \
    --name "${TG_NAME}" \
    --protocol HTTP \
    --port 8080 \
    --vpc-id "${VPC_ID}" \
    --target-type ip \
    --health-check-path "/api/health" \
    --health-check-interval-seconds 30 \
    --healthy-threshold-count 2 \
    --unhealthy-threshold-count 3 \
    --region "${AWS_REGION}" \
    --query "TargetGroups[0].TargetGroupArn" \
    --output text)
  echo "Target Group ARN: ${TARGET_GROUP_ARN}"

  echo "Creating ALB Listener on port 80..."
  aws elbv2 create-listener \
    --load-balancer-arn "${ALB_ARN}" \
    --protocol HTTP \
    --port 80 \
    --default-actions "Type=forward,TargetGroupArn=${TARGET_GROUP_ARN}" \
    --region "${AWS_REGION}" >/dev/null

  USE_LB=true
else
  USE_LB=false
fi

# ── Prepare task-definition.json ──────────────────────────────────────────────
echo ""
echo "Preparing task definition..."
cp "${TASK_DEF_FILE}" /tmp/task-definition-deploy.json

sed -i "s|{{ACCOUNT_ID}}|${ACCOUNT_ID}|g"   /tmp/task-definition-deploy.json
sed -i "s|{{AWS_REGION}}|${AWS_REGION}|g"   /tmp/task-definition-deploy.json
sed -i "s|{{IMAGE_URI}}|${IMAGE_URI}|g"     /tmp/task-definition-deploy.json

# ── Register Task Definition ──────────────────────────────────────────────────
echo "Registering task definition '${TASK_FAMILY}'..."
TASK_DEF_ARN=$(aws ecs register-task-definition \
  --cli-input-json file:///tmp/task-definition-deploy.json \
  --region "${AWS_REGION}" \
  --query "taskDefinition.taskDefinitionArn" \
  --output text)
echo "Registered: ${TASK_DEF_ARN}"

# ── Prepare service-definition.json ──────────────────────────────────────────
cp "${SVC_DEF_FILE}" /tmp/service-definition-deploy.json

sed -i "s|{{CLUSTER_NAME}}|${CLUSTER_NAME}|g"     /tmp/service-definition-deploy.json
sed -i "s|{{SUBNET_1}}|${SUBNET_1}|g"             /tmp/service-definition-deploy.json
sed -i "s|{{SUBNET_2}}|${SUBNET_2}|g"             /tmp/service-definition-deploy.json
sed -i "s|{{SECURITY_GROUP}}|${SECURITY_GROUP}|g" /tmp/service-definition-deploy.json

# ── Inject load balancer config or remove placeholder ────────────────────────
if [ "${USE_LB}" = "true" ]; then
  # Add loadBalancers and healthCheckGracePeriodSeconds via jq
  jq --arg tg_arn "${TARGET_GROUP_ARN}" \
     '. + {
       "loadBalancers": [{
         "targetGroupArn": $tg_arn,
         "containerName": "storefront-backend",
         "containerPort": 8080
       }],
       "healthCheckGracePeriodSeconds": 300
     }' /tmp/service-definition-deploy.json > /tmp/service-definition-lb.json
  mv /tmp/service-definition-lb.json /tmp/service-definition-deploy.json
fi

# ── Create or Update ECS Service ─────────────────────────────────────────────
echo ""
EXISTING_SERVICE=$(aws ecs describe-services \
  --cluster "${CLUSTER_NAME}" \
  --services "${SERVICE_NAME}" \
  --region "${AWS_REGION}" \
  --query "services[?status=='ACTIVE'].serviceName" \
  --output text 2>/dev/null || echo "")

if [ -z "${EXISTING_SERVICE}" ] || [ "${EXISTING_SERVICE}" = "None" ]; then
  echo "Creating ECS service '${SERVICE_NAME}'..."
  aws ecs create-service \
    --cli-input-json file:///tmp/service-definition-deploy.json \
    --region "${AWS_REGION}"
  echo "Service created."
else
  echo "Updating existing ECS service '${SERVICE_NAME}'..."
  aws ecs update-service \
    --cluster "${CLUSTER_NAME}" \
    --service "${SERVICE_NAME}" \
    --task-definition "${TASK_DEF_ARN}" \
    --region "${AWS_REGION}" >/dev/null
  echo "Service updated."
fi

# ── Wait for Stability ────────────────────────────────────────────────────────
echo ""
echo "Waiting for service to reach stable state (this may take a few minutes)..."
aws ecs wait services-stable \
  --cluster "${CLUSTER_NAME}" \
  --services "${SERVICE_NAME}" \
  --region "${AWS_REGION}"

# ── Verify Deployment ─────────────────────────────────────────────────────────
echo ""
echo "── Deployment Status ──────────────────────────────────────────────────"
aws ecs describe-services \
  --cluster "${CLUSTER_NAME}" \
  --services "${SERVICE_NAME}" \
  --region "${AWS_REGION}" \
  --query "services[0].{Status:status,Running:runningCount,Desired:desiredCount,Pending:pendingCount}" \
  --output table

echo ""
echo "============================================================"
echo "  Deployment complete!"
echo "  Service  : ${SERVICE_NAME}"
echo "  Cluster  : ${CLUSTER_NAME}"
echo "  Task Def : ${TASK_DEF_ARN}"
echo "  Log Group: ${LOG_GROUP}"
if [ "${USE_LB}" = "true" ]; then
  echo "  ALB DNS  : http://${ALB_DNS}"
fi
echo "============================================================"
echo ""
echo "Troubleshooting tips:"
echo "  View logs : aws logs tail ${LOG_GROUP} --follow --region ${AWS_REGION}"
echo "  List tasks: aws ecs list-tasks --cluster ${CLUSTER_NAME} --service-name ${SERVICE_NAME} --region ${AWS_REGION}"
echo "  Stop tasks: aws ecs stop-task --cluster ${CLUSTER_NAME} --task <TASK_ARN> --region ${AWS_REGION}"
