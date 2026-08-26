@echo off
setlocal enabledelayedexpansion

REM AWS ECS Fargate Deployment Script (Windows)
REM Deploys containerized application to AWS ECS Fargate

echo ==========================================
echo AWS ECS Fargate Deployment Script
echo ==========================================
echo.

REM Project configuration
set PROJECT_NAME=storefront-backend
set TASK_FAMILY=storefront-backend-task
set SERVICE_NAME=storefront-backend-service

REM Prompt for AWS region
set /p AWS_REGION="Enter AWS region (e.g., us-east-1): "
if "!AWS_REGION!"=="" (
    echo Error: AWS region is required
    exit /b 1
)

REM Prompt for ECS cluster name
set /p CLUSTER_NAME="Enter ECS cluster name: "
if "!CLUSTER_NAME!"=="" (
    echo Error: ECS cluster name is required
    exit /b 1
)

REM Prompt for VPC configuration
echo.
echo === Network Configuration ===
set /p VPC_ID="Enter VPC ID: "
if "!VPC_ID!"=="" (
    echo Error: VPC ID is required
    exit /b 1
)

set /p SUBNETS="Enter subnet IDs (comma-separated, at least 2): "
if "!SUBNETS!"=="" (
    echo Error: At least 2 subnet IDs are required
    exit /b 1
)

REM Parse subnets
for /f "tokens=1,2 delims=," %%a in ("!SUBNETS!") do (
    set SUBNET_1=%%a
    set SUBNET_2=%%b
)
set SUBNET_1=!SUBNET_1: =!
set SUBNET_2=!SUBNET_2: =!

set /p SECURITY_GROUP="Enter security group ID: "
if "!SECURITY_GROUP!"=="" (
    echo Error: Security group ID is required
    exit /b 1
)

REM Prompt for Docker image URI
echo.
set /p IMAGE_URI="Enter Docker image URI (e.g., 123456789.dkr.ecr.us-east-1.amazonaws.com/app:latest): "
if "!IMAGE_URI!"=="" (
    echo Error: Image URI is required
    exit /b 1
)

REM Get AWS account ID
echo.
echo Getting AWS account ID...
for /f "delims=" %%i in ('aws sts get-caller-identity --query Account --output text') do set ACCOUNT_ID=%%i
if "!ACCOUNT_ID!"=="" (
    echo Error: Failed to get AWS account ID
    exit /b 1
)
echo AWS Account ID: !ACCOUNT_ID!

REM Check if ECS cluster exists, create if not
echo.
echo Checking ECS cluster...
aws ecs describe-clusters --clusters !CLUSTER_NAME! --region !AWS_REGION! >nul 2>&1
if !ERRORLEVEL! neq 0 (
    echo Cluster does not exist. Creating ECS cluster: !CLUSTER_NAME!
    aws ecs create-cluster --cluster-name !CLUSTER_NAME! --region !AWS_REGION!
    if !ERRORLEVEL! neq 0 (
        echo Error: Failed to create ECS cluster
        exit /b 1
    )
    echo ECS cluster created successfully
)

REM Create CloudWatch log group if it doesn't exist
echo.
echo Creating CloudWatch log group...
aws logs create-log-group --log-group-name "/ecs/!PROJECT_NAME!" --region !AWS_REGION! 2>nul
if !ERRORLEVEL! equ 0 (
    echo Log group created
) else (
    echo Log group already exists
)

REM Ask about load balancer
echo.
set /p NEED_LB="Do you need a load balancer for this service? (y/n): "

if /i "!NEED_LB!"=="y" (
    echo.
    echo === Creating Application Load Balancer ===
    
    set ALB_NAME=!PROJECT_NAME!-alb
    echo Creating Application Load Balancer: !ALB_NAME!
    
    for /f "delims=" %%i in ('aws elbv2 create-load-balancer --name !ALB_NAME! --subnets !SUBNET_1! !SUBNET_2! --security-groups !SECURITY_GROUP! --scheme internet-facing --type application --ip-address-type ipv4 --region !AWS_REGION! --query "LoadBalancers[0].LoadBalancerArn" --output text') do set ALB_ARN=%%i
    
    if "!ALB_ARN!"=="" (
        echo Error: Failed to create Application Load Balancer
        exit /b 1
    )
    echo ALB created: !ALB_ARN!
    
    REM Get ALB DNS name
    for /f "delims=" %%i in ('aws elbv2 describe-load-balancers --load-balancer-arns !ALB_ARN! --region !AWS_REGION! --query "LoadBalancers[0].DNSName" --output text') do set ALB_DNS=%%i
    
    REM Create target group
    set TG_NAME=!PROJECT_NAME!-tg
    echo Creating Target Group: !TG_NAME!
    
    for /f "delims=" %%i in ('aws elbv2 create-target-group --name !TG_NAME! --protocol HTTP --port 8080 --vpc-id !VPC_ID! --target-type ip --health-check-enabled --health-check-protocol HTTP --health-check-path "/actuator/health" --health-check-interval-seconds 30 --health-check-timeout-seconds 5 --healthy-threshold-count 2 --unhealthy-threshold-count 3 --region !AWS_REGION! --query "TargetGroups[0].TargetGroupArn" --output text') do set TARGET_GROUP_ARN=%%i
    
    if "!TARGET_GROUP_ARN!"=="" (
        echo Error: Failed to create Target Group
        exit /b 1
    )
    echo Target Group created: !TARGET_GROUP_ARN!
    
    REM Create listener
    echo Creating ALB Listener...
    aws elbv2 create-listener --load-balancer-arn !ALB_ARN! --protocol HTTP --port 80 --default-actions Type=forward,TargetGroupArn=!TARGET_GROUP_ARN! --region !AWS_REGION! >nul
    echo ALB Listener created successfully
    
    set SERVICE_DEF_FILE=ecs\service-definition.json
) else (
    set SERVICE_DEF_FILE=ecs\service-definition.json
)

REM Replace placeholders in task definition
echo.
echo Preparing task definition...
set TEMP_TASK_DEF=%TEMP%\task-def-!RANDOM!.json
powershell -Command "(Get-Content ecs\task-definition.json) -replace '{{IMAGE_URI}}', '!IMAGE_URI!' -replace '{{AWS_REGION}}', '!AWS_REGION!' -replace '{{ACCOUNT_ID}}', '!ACCOUNT_ID!' | Set-Content !TEMP_TASK_DEF!"

REM Register task definition
echo Registering ECS task definition...
for /f "delims=" %%i in ('aws ecs register-task-definition --cli-input-json file://!TEMP_TASK_DEF! --region !AWS_REGION! --query "taskDefinition.taskDefinitionArn" --output text') do set TASK_DEF_ARN=%%i

if "!TASK_DEF_ARN!"=="" (
    echo Error: Failed to register task definition
    del !TEMP_TASK_DEF!
    exit /b 1
)

echo Task definition registered: !TASK_DEF_ARN!
del !TEMP_TASK_DEF!

REM Replace placeholders in service definition
echo.
echo Preparing service definition...
set TEMP_SERVICE_DEF=%TEMP%\service-def-!RANDOM!.json
powershell -Command "(Get-Content !SERVICE_DEF_FILE!) -replace '{{CLUSTER_NAME}}', '!CLUSTER_NAME!' -replace '{{SUBNET_1}}', '!SUBNET_1!' -replace '{{SUBNET_2}}', '!SUBNET_2!' -replace '{{SECURITY_GROUP}}', '!SECURITY_GROUP!' | Set-Content !TEMP_SERVICE_DEF!"

REM Check if service exists
echo Checking if service exists...
for /f "delims=" %%i in ('aws ecs describe-services --cluster !CLUSTER_NAME! --services !SERVICE_NAME! --region !AWS_REGION! --query "services[?status==`ACTIVE`].serviceName" --output text') do set SERVICE_EXISTS=%%i

if "!SERVICE_EXISTS!"=="" (
    REM Create new service
    echo Creating ECS service...
    aws ecs create-service --cli-input-json file://!TEMP_SERVICE_DEF! --region !AWS_REGION! >nul
    
    if !ERRORLEVEL! neq 0 (
        echo Error: Failed to create ECS service
        del !TEMP_SERVICE_DEF!
        exit /b 1
    )
    echo ECS service created successfully
) else (
    REM Update existing service
    echo Updating existing ECS service...
    aws ecs update-service --cluster !CLUSTER_NAME! --service !SERVICE_NAME! --task-definition !TASK_DEF_ARN! --region !AWS_REGION! >nul
    
    if !ERRORLEVEL! neq 0 (
        echo Error: Failed to update ECS service
        del !TEMP_SERVICE_DEF!
        exit /b 1
    )
    echo ECS service updated successfully
)

del !TEMP_SERVICE_DEF!

REM Wait for service to stabilize
echo.
echo Waiting for service to become stable (this may take a few minutes)...
aws ecs wait services-stable --cluster !CLUSTER_NAME! --services !SERVICE_NAME! --region !AWS_REGION!

REM Verify deployment
echo.
echo ==========================================
echo Deployment Verification
echo ==========================================

for /f "delims=" %%i in ('aws ecs describe-services --cluster !CLUSTER_NAME! --services !SERVICE_NAME! --region !AWS_REGION! --query "services[0].[runningCount,desiredCount,status]" --output text') do set SERVICE_INFO=%%i
echo Service Status: !SERVICE_INFO!

REM Display access information
echo.
echo ==========================================
echo Deployment Completed Successfully!
echo ==========================================
echo Cluster: !CLUSTER_NAME!
echo Service: !SERVICE_NAME!
echo Task Definition: !TASK_DEF_ARN!
echo Region: !AWS_REGION!

if /i "!NEED_LB!"=="y" (
    echo.
    echo Application Load Balancer:
    echo   DNS Name: !ALB_DNS!
    echo   Access your application at: http://!ALB_DNS!
    echo   Health Check: http://!ALB_DNS!/actuator/health
)

echo.
echo CloudWatch Logs:
echo   Log Group: /ecs/!PROJECT_NAME!
echo   View logs: https://console.aws.amazon.com/cloudwatch/home?region=!AWS_REGION!#logsV2:log-groups/log-group//ecs/!PROJECT_NAME!

echo.
echo To view service details:
echo   aws ecs describe-services --cluster !CLUSTER_NAME! --services !SERVICE_NAME! --region !AWS_REGION!
echo.
echo To view running tasks:
echo   aws ecs list-tasks --cluster !CLUSTER_NAME! --service-name !SERVICE_NAME! --region !AWS_REGION!

endlocal
