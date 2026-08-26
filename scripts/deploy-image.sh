#!/bin/bash

# AWS ECS Fargate Deployment Script
# Deploys containerized application to AWS ECS Fargate

set -e
set -o pipefail

echo "=========================================="
echo "AWS ECS Fargate Deployment Script"
echo "=========================================="
echo ""

# Project configuration
PROJECT_NAME="storefront-backend"
TASK_FAMILY="storefront-backend-task"
SERVICE_NAME="storefront-backend-service"

# Prompt for AWS region
read -p "Enter AWS region (e.g., us-east-1): " AWS_REGION
if [ -z "$AWS_REGION" ]; then
    echo "Error: AWS region is required"
    exit 1
fi

# Prompt for ECS cluster name
read -p "Enter ECS cluster name: " CLUSTER_NAME
if [ -z "$CLUSTER_NAME" ]; then
    echo "Error: ECS cluster name is required"
    exit 1
fi

# Prompt for VPC configuration
echo ""
echo "=== Network Configuration ==="
read -p "Enter VPC ID: " VPC_ID
if [ -z "$VPC_ID" ]; then
    echo "Error: VPC ID is required"
    exit 1
fi

read -p "Enter subnet IDs (comma-separated, at least 2): " SUBNETS
if [ -z "$SUBNETS" ]; then
    echo "Error: At least 2 subnet IDs are required"
    exit 1
fi

# Convert comma-separated subnets to array
IFS=',' read -ra SUBNET_ARRAY <<< "$SUBNETS"
SUBNET_1=$(echo "${SUBNET_ARRAY[0]}" | xargs)
SUBNET_2=$(echo "${SUBNET_ARRAY[1]}" | xargs)

read -p "Enter security group ID: " SECURITY_GROUP
if [ -z "$SECURITY_GROUP" ]; then
    echo "Error: Security group ID is required"
    exit 1
fi

# Prompt for Docker image URI
echo ""
read -p "Enter Docker image URI (e.g., 123456789.dkr.ecr.us-east-1.amazonaws.com/app:latest): " IMAGE_URI
if [ -z "$IMAGE_URI" ]; then
    echo "Error: Image URI is required"
    exit 1
fi

# Get AWS account ID
echo ""
echo "Getting AWS account ID..."
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
if [ -z "$ACCOUNT_ID" ]; then
    echo "Error: Failed to get AWS account ID"
    exit 1
fi
echo "AWS Account ID: $ACCOUNT_ID"

# Check if ECS cluster exists, create if not
echo ""
echo "Checking ECS cluster..."
aws ecs describe-clusters --clusters "$CLUSTER_NAME" --region "$AWS_REGION" >/dev/null 2>&1 || {
    echo "Cluster does not exist. Creating ECS cluster: $CLUSTER_NAME"
    aws ecs create-cluster --cluster-name "$CLUSTER_NAME" --region "$AWS_REGION"
    echo "ECS cluster created successfully"
}

# Create CloudWatch log group if it doesn't exist
echo ""
echo "Creating CloudWatch log group..."
aws logs create-log-group --log-group-name "/ecs/$PROJECT_NAME" --region "$AWS_REGION" 2>/dev/null || echo "Log group already exists"

# Ask about load balancer
echo ""
read -p "Do you need a load balancer for this service? (y/n): " NEED_LB

if [ "$NEED_LB" = "y" ] || [ "$NEED_LB" = "Y" ]; then
    echo ""
    echo "=== Creating Application Load Balancer ==="
    
    # Create ALB
    ALB_NAME="${PROJECT_NAME}-alb"
    echo "Creating Application Load Balancer: $ALB_NAME"
    
    ALB_ARN=$(aws elbv2 create-load-balancer \
        --name "$ALB_NAME" \
        --subnets "$SUBNET_1" "$SUBNET_2" \
        --security-groups "$SECURITY_GROUP" \
        --scheme internet-facing \
        --type application \
        --ip-address-type ipv4 \
        --region "$AWS_REGION" \
        --query 'LoadBalancers[0].LoadBalancerArn' \
        --output text)
    
    if [ -z "$ALB_ARN" ]; then
        echo "Error: Failed to create Application Load Balancer"
        exit 1
    fi
    echo "ALB created: $ALB_ARN"
    
    # Get ALB DNS name
    ALB_DNS=$(aws elbv2 describe-load-balancers \
        --load-balancer-arns "$ALB_ARN" \
        --region "$AWS_REGION" \
        --query 'LoadBalancers[0].DNSName' \
        --output text)
    
    # Create target group with target-type ip (required for Fargate)
    TG_NAME="${PROJECT_NAME}-tg"
    echo "Creating Target Group: $TG_NAME"
    
    TARGET_GROUP_ARN=$(aws elbv2 create-target-group \
        --name "$TG_NAME" \
        --protocol HTTP \
        --port 8080 \
        --vpc-id "$VPC_ID" \
        --target-type ip \
        --health-check-enabled \
        --health-check-protocol HTTP \
        --health-check-path "/actuator/health" \
        --health-check-interval-seconds 30 \
        --health-check-timeout-seconds 5 \
        --healthy-threshold-count 2 \
        --unhealthy-threshold-count 3 \
        --region "$AWS_REGION" \
        --query 'TargetGroups[0].TargetGroupArn' \
        --output text)
    
    if [ -z "$TARGET_GROUP_ARN" ]; then
        echo "Error: Failed to create Target Group"
        exit 1
    fi
    echo "Target Group created: $TARGET_GROUP_ARN"
    
    # Create listener
    echo "Creating ALB Listener..."
    aws elbv2 create-listener \
        --load-balancer-arn "$ALB_ARN" \
        --protocol HTTP \
        --port 80 \
        --default-actions Type=forward,TargetGroupArn="$TARGET_GROUP_ARN" \
        --region "$AWS_REGION" >/dev/null
    
    echo "ALB Listener created successfully"
    
    # Update service definition with load balancer configuration
    TEMP_SERVICE_DEF=$(mktemp)
    cat ecs/service-definition.json > "$TEMP_SERVICE_DEF"
    
    # Add load balancer configuration using jq or manual JSON manipulation
    if command -v jq &> /dev/null; then
        jq --arg tg "$TARGET_GROUP_ARN" \
           '. + {loadBalancers: [{targetGroupArn: $tg, containerName: "storefront-backend", containerPort: 8080}], healthCheckGracePeriodSeconds: 300}' \
           "$TEMP_SERVICE_DEF" > ecs/service-definition-with-lb.json
        SERVICE_DEF_FILE="ecs/service-definition-with-lb.json"
    else
        # Fallback: use original file and warn user
        echo "Warning: jq not found. Please manually add load balancer configuration to service definition."
        SERVICE_DEF_FILE="ecs/service-definition.json"
    fi
    
    rm -f "$TEMP_SERVICE_DEF"
else
    SERVICE_DEF_FILE="ecs/service-definition.json"
    # Remove loadBalancers section if it exists
    if command -v jq &> /dev/null; then
        jq 'del(.loadBalancers, .healthCheckGracePeriodSeconds)' ecs/service-definition.json > ecs/service-definition-no-lb.json
        SERVICE_DEF_FILE="ecs/service-definition-no-lb.json"
    fi
fi

# Replace placeholders in task definition
echo ""
echo "Preparing task definition..."
TEMP_TASK_DEF=$(mktemp)
sed "s|{{IMAGE_URI}}|$IMAGE_URI|g; s|{{AWS_REGION}}|$AWS_REGION|g; s|{{ACCOUNT_ID}}|$ACCOUNT_ID|g" \
    ecs/task-definition.json > "$TEMP_TASK_DEF"

# Register task definition
echo "Registering ECS task definition..."
TASK_DEF_ARN=$(aws ecs register-task-definition \
    --cli-input-json file://"$TEMP_TASK_DEF" \
    --region "$AWS_REGION" \
    --query 'taskDefinition.taskDefinitionArn' \
    --output text)

if [ -z "$TASK_DEF_ARN" ]; then
    echo "Error: Failed to register task definition"
    rm -f "$TEMP_TASK_DEF"
    exit 1
fi

echo "Task definition registered: $TASK_DEF_ARN"
rm -f "$TEMP_TASK_DEF"

# Replace placeholders in service definition
echo ""
echo "Preparing service definition..."
TEMP_SERVICE_DEF=$(mktemp)
sed "s|{{CLUSTER_NAME}}|$CLUSTER_NAME|g; s|{{SUBNET_1}}|$SUBNET_1|g; s|{{SUBNET_2}}|$SUBNET_2|g; s|{{SECURITY_GROUP}}|$SECURITY_GROUP|g" \
    "$SERVICE_DEF_FILE" > "$TEMP_SERVICE_DEF"

# Check if service exists
echo "Checking if service exists..."
SERVICE_EXISTS=$(aws ecs describe-services \
    --cluster "$CLUSTER_NAME" \
    --services "$SERVICE_NAME" \
    --region "$AWS_REGION" \
    --query 'services[?status==`ACTIVE`].serviceName' \
    --output text)

if [ -z "$SERVICE_EXISTS" ]; then
    # Create new service
    echo "Creating ECS service..."
    aws ecs create-service \
        --cli-input-json file://"$TEMP_SERVICE_DEF" \
        --region "$AWS_REGION" >/dev/null
    
    if [ $? -ne 0 ]; then
        echo "Error: Failed to create ECS service"
        rm -f "$TEMP_SERVICE_DEF"
        exit 1
    fi
    echo "ECS service created successfully"
else
    # Update existing service
    echo "Updating existing ECS service..."
    aws ecs update-service \
        --cluster "$CLUSTER_NAME" \
        --service "$SERVICE_NAME" \
        --task-definition "$TASK_DEF_ARN" \
        --region "$AWS_REGION" >/dev/null
    
    if [ $? -ne 0 ]; then
        echo "Error: Failed to update ECS service"
        rm -f "$TEMP_SERVICE_DEF"
        exit 1
    fi
    echo "ECS service updated successfully"
fi

rm -f "$TEMP_SERVICE_DEF"

# Wait for service to stabilize
echo ""
echo "Waiting for service to become stable (this may take a few minutes)..."
aws ecs wait services-stable \
    --cluster "$CLUSTER_NAME" \
    --services "$SERVICE_NAME" \
    --region "$AWS_REGION"

# Verify deployment
echo ""
echo "=========================================="
echo "Deployment Verification"
echo "=========================================="

SERVICE_INFO=$(aws ecs describe-services \
    --cluster "$CLUSTER_NAME" \
    --services "$SERVICE_NAME" \
    --region "$AWS_REGION" \
    --query 'services[0].[runningCount,desiredCount,status]' \
    --output text)

echo "Service Status: $SERVICE_INFO"

# Display access information
echo ""
echo "=========================================="
echo "Deployment Completed Successfully!"
echo "=========================================="
echo "Cluster: $CLUSTER_NAME"
echo "Service: $SERVICE_NAME"
echo "Task Definition: $TASK_DEF_ARN"
echo "Region: $AWS_REGION"

if [ "$NEED_LB" = "y" ] || [ "$NEED_LB" = "Y" ]; then
    echo ""
    echo "Application Load Balancer:"
    echo "  DNS Name: $ALB_DNS"
    echo "  Access your application at: http://$ALB_DNS"
    echo "  Health Check: http://$ALB_DNS/actuator/health"
fi

echo ""
echo "CloudWatch Logs:"
echo "  Log Group: /ecs/$PROJECT_NAME"
echo "  View logs: https://console.aws.amazon.com/cloudwatch/home?region=$AWS_REGION#logsV2:log-groups/log-group//ecs/$PROJECT_NAME"

echo ""
echo "To view service details:"
echo "  aws ecs describe-services --cluster $CLUSTER_NAME --services $SERVICE_NAME --region $AWS_REGION"
echo ""
echo "To view running tasks:"
echo "  aws ecs list-tasks --cluster $CLUSTER_NAME --service-name $SERVICE_NAME --region $AWS_REGION"
