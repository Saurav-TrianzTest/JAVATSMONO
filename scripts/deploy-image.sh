#!/bin/bash
# =============================================================================
# deploy-image.sh – Deploy storefront-backend to AWS ECS Fargate
# Usage: ./scripts/deploy-image.sh
# Run from the repository root directory.
# =============================================================================
set -e
set -o pipefail

SERVICE_NAME="storefront-backend-service"
TASK_FAMILY="storefront-backend-task"
PROJECT_NAME="storefront-backend"
LOG_GROUP="/ecs/storefront-backend"

echo "=============================================="
echo "  storefront-backend – ECS Fargate Deploy"
echo "=============================================="
echo ""

# ── AWS Configuration ─────────────────────────────────────────────────────────
read -rp "Enter AWS Region [us-east-1]: " AWS_REGION
AWS_REGION="${AWS_REGION:-us-east-1}"

read -rp "Enter ECS Cluster name [storefront-backend-cluster]: " CLUSTER_NAME
CLUSTER_NAME="${CLUSTER_NAME:-storefront-backend-cluster}"

# ── Network Configuration ─────────────────────────────────────────────────────
echo ""
echo "--- Network Configuration ---"
read -rp "Enter VPC ID (e.g. vpc-xxxxxxxx): " VPC_ID
read -rp "Enter Subnet IDs (comma-separated, e.g. subnet-aaa,subnet-bbb): " SUBNETS_RAW
read -rp "Enter Security Group ID (e.g. sg-xxxxxxxx): " SECURITY_GROUP

# Parse subnets
SUBNET_1=$(echo "$SUBNETS_RAW" | cut -d',' -f1 | tr -d ' ')
SUBNET_2=$(echo "$SUBNETS_RAW" | cut -d',' -f2 | tr -d ' ')
if [ -z "$SUBNET_2" ]; then
  SUBNET_2="$SUBNET_1"
fi

# ── Image URI ─────────────────────────────────────────────────────────────────
echo ""
read -rp "Enter full ECR image URI (e.g. 123456789.dkr.ecr.us-east-1.amazonaws.com/storefront-backend:latest): " IMAGE_URI
if [ -z "$IMAGE_URI" ]; then
  echo "ERROR: Image URI is required."
  exit 1
fi

# ── Get AWS Account ID ────────────────────────────────────────────────────────
echo ""
echo "Fetching AWS Account ID..."
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "Account ID: $ACCOUNT_ID"

# ── Ensure CloudWatch Log Group exists ───────────────────────────────────────
echo ""
echo "Ensuring CloudWatch log group exists: $LOG_GROUP"
aws logs create-log-group --log-group-name "$LOG_GROUP" --region "$AWS_REGION" 2>/dev/null || true
echo "Log group ready."

# ── Check / Create ECS Cluster ───────────────────────────────────────────────
echo ""
echo "Checking ECS cluster: $CLUSTER_NAME"
CLUSTER_STATUS=$(aws ecs describe-clusters --clusters "$CLUSTER_NAME" --region "$AWS_REGION" \
  --query "clusters[0].status" --output text 2>/dev/null || echo "MISSING")

if [ "$CLUSTER_STATUS" != "ACTIVE" ]; then
  echo "Cluster not found or inactive. Creating cluster: $CLUSTER_NAME"
  aws ecs create-cluster --cluster-name "$CLUSTER_NAME" --region "$AWS_REGION"
  echo "Cluster created."
else
  echo "Cluster '$CLUSTER_NAME' is active."
fi

# ── Load Balancer ─────────────────────────────────────────────────────────────
echo ""
read -rp "Do you need a load balancer for this service? (y/n) [n]: " NEED_LB
NEED_LB="${NEED_LB:-n}"

TARGET_GROUP_ARN=""
LB_DNS=""

if [[ "$NEED_LB" =~ ^[Yy]$ ]]; then
  echo ""
  echo "Creating Application Load Balancer..."

  LB_NAME="${PROJECT_NAME}-alb"
  TG_NAME="${PROJECT_NAME}-tg"

  # Create ALB
  LB_ARN=$(aws elbv2 create-load-balancer \
    --name "$LB_NAME" \
    --subnets "$SUBNET_1" "$SUBNET_2" \
    --security-groups "$SECURITY_GROUP" \
    --scheme internet-facing \
    --type application \
    --region "$AWS_REGION" \
    --query "LoadBalancers[0].LoadBalancerArn" \
    --output text)
  echo "ALB created: $LB_ARN"

  LB_DNS=$(aws elbv2 describe-load-balancers \
    --load-balancer-arns "$LB_ARN" \
    --region "$AWS_REGION" \
    --query "LoadBalancers[0].DNSName" \
    --output text)

  # Create Target Group (target-type ip required for Fargate awsvpc)
  TARGET_GROUP_ARN=$(aws elbv2 create-target-group \
    --name "$TG_NAME" \
    --protocol HTTP \
    --port 8080 \
    --vpc-id "$VPC_ID" \
    --target-type ip \
    --health-check-path "/api/health" \
    --health-check-interval-seconds 30 \
    --healthy-threshold-count 2 \
    --unhealthy-threshold-count 3 \
    --region "$AWS_REGION" \
    --query "TargetGroups[0].TargetGroupArn" \
    --output text)
  echo "Target Group created: $TARGET_GROUP_ARN"

  # Create listener
  aws elbv2 create-listener \
    --load-balancer-arn "$LB_ARN" \
    --protocol HTTP \
    --port 80 \
    --default-actions "Type=forward,TargetGroupArn=$TARGET_GROUP_ARN" \
    --region "$AWS_REGION" >/dev/null
  echo "Listener created on port 80."
fi

# ── Prepare task-definition.json ─────────────────────────────────────────────
echo ""
echo "Preparing task definition..."
cp ecs/task-definition.json /tmp/task-definition-deploy.json

sed -i "s|{{IMAGE_URI}}|${IMAGE_URI}|g"     /tmp/task-definition-deploy.json
sed -i "s|{{AWS_REGION}}|${AWS_REGION}|g"   /tmp/task-definition-deploy.json
sed -i "s|{{ACCOUNT_ID}}|${ACCOUNT_ID}|g"   /tmp/task-definition-deploy.json

# ── Register Task Definition ──────────────────────────────────────────────────
echo "Registering task definition..."
TASK_DEF_ARN=$(aws ecs register-task-definition \
  --cli-input-json file:///tmp/task-definition-deploy.json \
  --region "$AWS_REGION" \
  --query "taskDefinition.taskDefinitionArn" \
  --output text)
echo "Task definition registered: $TASK_DEF_ARN"

# ── Prepare service-definition.json ──────────────────────────────────────────
echo ""
echo "Preparing service definition..."
cp ecs/service-definition.json /tmp/service-definition-deploy.json

sed -i "s|{{CLUSTER_NAME}}|${CLUSTER_NAME}|g"     /tmp/service-definition-deploy.json
sed -i "s|{{SUBNET_1}}|${SUBNET_1}|g"             /tmp/service-definition-deploy.json
sed -i "s|{{SUBNET_2}}|${SUBNET_2}|g"             /tmp/service-definition-deploy.json
sed -i "s|{{SECURITY_GROUP}}|${SECURITY_GROUP}|g" /tmp/service-definition-deploy.json

# Handle load balancer in service definition
if [[ "$NEED_LB" =~ ^[Yy]$ ]]; then
  # Inject loadBalancers and healthCheckGracePeriodSeconds
  python3 - <<PYEOF
import json, sys

with open('/tmp/service-definition-deploy.json', 'r') as f:
    svc = json.load(f)

svc['loadBalancers'] = [{
    'targetGroupArn': '${TARGET_GROUP_ARN}',
    'containerName': 'storefront-backend',
    'containerPort': 8080
}]
svc['healthCheckGracePeriodSeconds'] = 300

with open('/tmp/service-definition-deploy.json', 'w') as f:
    json.dump(svc, f, indent=2)
PYEOF
  echo "Load balancer configuration injected."
fi

# ── Check if service exists ───────────────────────────────────────────────────
echo ""
echo "Checking if ECS service exists..."
EXISTING_SERVICE=$(aws ecs describe-services \
  --cluster "$CLUSTER_NAME" \
  --services "$SERVICE_NAME" \
  --region "$AWS_REGION" \
  --query "services[?status!='INACTIVE'].serviceName" \
  --output text 2>/dev/null || echo "")

if [ -z "$EXISTING_SERVICE" ] || [ "$EXISTING_SERVICE" = "None" ]; then
  echo "Service does not exist. Creating service: $SERVICE_NAME"
  # Update task definition reference to use the registered ARN
  python3 - <<PYEOF
import json
with open('/tmp/service-definition-deploy.json', 'r') as f:
    svc = json.load(f)
svc['taskDefinition'] = '${TASK_DEF_ARN}'
with open('/tmp/service-definition-deploy.json', 'w') as f:
    json.dump(svc, f, indent=2)
PYEOF
  aws ecs create-service \
    --cli-input-json file:///tmp/service-definition-deploy.json \
    --region "$AWS_REGION"
  echo "Service created."
else
  echo "Service '$SERVICE_NAME' exists. Updating service..."
  aws ecs update-service \
    --cluster "$CLUSTER_NAME" \
    --service "$SERVICE_NAME" \
    --task-definition "$TASK_DEF_ARN" \
    --region "$AWS_REGION" >/dev/null
  echo "Service updated."
fi

# ── Wait for stability ────────────────────────────────────────────────────────
echo ""
echo "Waiting for service to stabilize (this may take a few minutes)..."
aws ecs wait services-stable \
  --cluster "$CLUSTER_NAME" \
  --services "$SERVICE_NAME" \
  --region "$AWS_REGION"
echo "Service is stable."

# ── Verify deployment ─────────────────────────────────────────────────────────
echo ""
echo "--- Deployment Summary ---"
aws ecs describe-services \
  --cluster "$CLUSTER_NAME" \
  --services "$SERVICE_NAME" \
  --region "$AWS_REGION" \
  --query "services[0].{Status:status,Running:runningCount,Desired:desiredCount,Pending:pendingCount}" \
  --output table

echo ""
echo "CloudWatch Log Group: $LOG_GROUP"
echo "CloudWatch Logs URL: https://console.aws.amazon.com/cloudwatch/home?region=${AWS_REGION}#logsV2:log-groups/log-group/${LOG_GROUP//\//\$252F}"

if [ -n "$LB_DNS" ]; then
  echo ""
  echo "Load Balancer DNS: http://$LB_DNS"
  echo "Health Check URL:  http://$LB_DNS/api/health"
fi

echo ""
echo "=============================================="
echo "  Deployment complete!"
echo "=============================================="
echo ""
echo "Troubleshooting tips:"
echo "  - View tasks:  aws ecs list-tasks --cluster $CLUSTER_NAME --region $AWS_REGION"
echo "  - Task logs:   aws logs tail $LOG_GROUP --follow --region $AWS_REGION"
echo "  - Task details: aws ecs describe-tasks --cluster $CLUSTER_NAME --tasks <task-arn> --region $AWS_REGION"
