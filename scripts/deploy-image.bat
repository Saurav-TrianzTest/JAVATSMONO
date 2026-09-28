@echo off
setlocal enabledelayedexpansion

REM =============================================================================
REM deploy-image.bat — Deploy storefront-backend to AWS ECS Fargate (Windows)
REM Usage   : scripts\deploy-image.bat
REM Run from: repository root
REM Requires: aws-cli v2, jq (https://stedolan.github.io/jq/)
REM =============================================================================

set "SERVICE_NAME=storefront-backend-service"
set "TASK_FAMILY=storefront-backend-task"
set "LOG_GROUP=/ecs/storefront-backend"
set "TASK_DEF_FILE=ecs\task-definition.json"
set "SVC_DEF_FILE=ecs\service-definition.json"

echo ============================================================
echo   storefront-backend -- ECS Fargate Deployment Script
echo ============================================================
echo.

REM ── AWS Region ────────────────────────────────────────────────────────────────
set /p "AWS_REGION=AWS Region [us-east-1]: "
if "!AWS_REGION!"=="" set "AWS_REGION=us-east-1"

REM ── AWS Account ID ────────────────────────────────────────────────────────────
echo Fetching AWS Account ID...
for /f "delims=" %%a in ('aws sts get-caller-identity --query Account --output text') do set "ACCOUNT_ID=%%a"
echo Account ID: !ACCOUNT_ID!

REM ── ECS Cluster ───────────────────────────────────────────────────────────────
set /p "CLUSTER_NAME=ECS Cluster name [storefront-cluster]: "
if "!CLUSTER_NAME!"=="" set "CLUSTER_NAME=storefront-cluster"

echo Checking ECS cluster '!CLUSTER_NAME!'...
for /f "delims=" %%s in ('aws ecs describe-clusters --clusters !CLUSTER_NAME! --region !AWS_REGION! --query "clusters[0].status" --output text 2^>nul') do set "CLUSTER_STATUS=%%s"
if "!CLUSTER_STATUS!" neq "ACTIVE" (
  echo Creating ECS cluster '!CLUSTER_NAME!'...
  aws ecs create-cluster --cluster-name !CLUSTER_NAME! --region !AWS_REGION!
  echo Cluster created.
) else (
  echo Cluster '!CLUSTER_NAME!' is ACTIVE.
)

REM ── Network Configuration ─────────────────────────────────────────────────────
echo.
echo -- Network Configuration --
set /p "VPC_ID=VPC ID: "
set /p "SUBNETS_INPUT=Subnet IDs (comma-separated, e.g. subnet-aaa,subnet-bbb): "
set /p "SECURITY_GROUP=Security Group ID: "

REM Parse first two subnets
for /f "tokens=1,2 delims=," %%a in ("!SUBNETS_INPUT!") do (
  set "SUBNET_1=%%a"
  set "SUBNET_2=%%b"
)
if "!SUBNET_2!"=="" set "SUBNET_2=!SUBNET_1!"

REM ── ECR Image URI ─────────────────────────────────────────────────────────────
echo.
set /p "IMAGE_URI=Full ECR image URI (e.g. 123456789.dkr.ecr.us-east-1.amazonaws.com/storefront-backend:latest): "

REM ── CloudWatch Log Group ──────────────────────────────────────────────────────
echo.
echo Ensuring CloudWatch log group '!LOG_GROUP!' exists...
aws logs create-log-group --log-group-name !LOG_GROUP! --region !AWS_REGION! >nul 2>&1
echo Log group ready.

REM ── Load Balancer ─────────────────────────────────────────────────────────────
echo.
set /p "NEED_LB=Do you need an Application Load Balancer for this service? (y/n) [n]: "
if "!NEED_LB!"=="" set "NEED_LB=n"
set "USE_LB=false"

if /i "!NEED_LB!"=="y" (
  echo.
  echo -- Creating Application Load Balancer --
  set /p "ALB_NAME=ALB name [storefront-backend-alb]: "
  if "!ALB_NAME!"=="" set "ALB_NAME=storefront-backend-alb"

  echo Creating ALB '!ALB_NAME!'...
  for /f "delims=" %%a in ('aws elbv2 create-load-balancer --name !ALB_NAME! --subnets !SUBNET_1! !SUBNET_2! --security-groups !SECURITY_GROUP! --scheme internet-facing --type application --region !AWS_REGION! --query "LoadBalancers[0].LoadBalancerArn" --output text') do set "ALB_ARN=%%a"
  echo ALB ARN: !ALB_ARN!

  for /f "delims=" %%d in ('aws elbv2 describe-load-balancers --load-balancer-arns !ALB_ARN! --region !AWS_REGION! --query "LoadBalancers[0].DNSName" --output text') do set "ALB_DNS=%%d"

  echo Creating Target Group...
  set "TG_NAME=!ALB_NAME!-tg"
  for /f "delims=" %%t in ('aws elbv2 create-target-group --name !TG_NAME! --protocol HTTP --port 8080 --vpc-id !VPC_ID! --target-type ip --health-check-path "/api/health" --health-check-interval-seconds 30 --healthy-threshold-count 2 --unhealthy-threshold-count 3 --region !AWS_REGION! --query "TargetGroups[0].TargetGroupArn" --output text') do set "TARGET_GROUP_ARN=%%t"
  echo Target Group ARN: !TARGET_GROUP_ARN!

  echo Creating ALB Listener on port 80...
  aws elbv2 create-listener --load-balancer-arn !ALB_ARN! --protocol HTTP --port 80 --default-actions "Type=forward,TargetGroupArn=!TARGET_GROUP_ARN!" --region !AWS_REGION! >nul

  set "USE_LB=true"
)

REM ── Prepare task-definition.json ──────────────────────────────────────────────
echo.
echo Preparing task definition...
copy /Y !TASK_DEF_FILE! %TEMP%\task-definition-deploy.json >nul

powershell -NoProfile -Command ^
  "(Get-Content '%TEMP%\task-definition-deploy.json') -replace '{{ACCOUNT_ID}}','!ACCOUNT_ID!' -replace '{{AWS_REGION}}','!AWS_REGION!' -replace '{{IMAGE_URI}}','!IMAGE_URI!' | Set-Content '%TEMP%\task-definition-deploy.json'"

REM ── Register Task Definition ──────────────────────────────────────────────────
echo Registering task definition '!TASK_FAMILY!'...
for /f "delims=" %%r in ('aws ecs register-task-definition --cli-input-json file://%TEMP%/task-definition-deploy.json --region !AWS_REGION! --query "taskDefinition.taskDefinitionArn" --output text') do set "TASK_DEF_ARN=%%r"
echo Registered: !TASK_DEF_ARN!

REM ── Prepare service-definition.json ──────────────────────────────────────────
copy /Y !SVC_DEF_FILE! %TEMP%\service-definition-deploy.json >nul

powershell -NoProfile -Command ^
  "(Get-Content '%TEMP%\service-definition-deploy.json') -replace '{{CLUSTER_NAME}}','!CLUSTER_NAME!' -replace '{{SUBNET_1}}','!SUBNET_1!' -replace '{{SUBNET_2}}','!SUBNET_2!' -replace '{{SECURITY_GROUP}}','!SECURITY_GROUP!' | Set-Content '%TEMP%\service-definition-deploy.json'"

REM ── Inject load balancer config if needed ─────────────────────────────────────
if "!USE_LB!"=="true" (
  powershell -NoProfile -Command ^
    "$svc = Get-Content '%TEMP%\service-definition-deploy.json' | ConvertFrom-Json; $svc | Add-Member -Force -NotePropertyName 'loadBalancers' -NotePropertyValue @(@{targetGroupArn='!TARGET_GROUP_ARN!';containerName='storefront-backend';containerPort=8080}); $svc | Add-Member -Force -NotePropertyName 'healthCheckGracePeriodSeconds' -NotePropertyValue 300; $svc | ConvertTo-Json -Depth 10 | Set-Content '%TEMP%\service-definition-deploy.json'"
)

REM ── Create or Update ECS Service ─────────────────────────────────────────────
echo.
for /f "delims=" %%e in ('aws ecs describe-services --cluster !CLUSTER_NAME! --services !SERVICE_NAME! --region !AWS_REGION! --query "services[?status==''ACTIVE''].serviceName" --output text 2^>nul') do set "EXISTING_SERVICE=%%e"

if "!EXISTING_SERVICE!"=="" (
  echo Creating ECS service '!SERVICE_NAME!'...
  aws ecs create-service --cli-input-json file://%TEMP%/service-definition-deploy.json --region !AWS_REGION!
  if !ERRORLEVEL! neq 0 (
    echo Failed to create ECS service.
    exit /b 1
  )
  echo Service created.
) else (
  echo Updating existing ECS service '!SERVICE_NAME!'...
  aws ecs update-service --cluster !CLUSTER_NAME! --service !SERVICE_NAME! --task-definition !TASK_DEF_ARN! --region !AWS_REGION! >nul
  if !ERRORLEVEL! neq 0 (
    echo Failed to update ECS service.
    exit /b 1
  )
  echo Service updated.
)

REM ── Wait for Stability ────────────────────────────────────────────────────────
echo.
echo Waiting for service to reach stable state (this may take a few minutes)...
aws ecs wait services-stable --cluster !CLUSTER_NAME! --services !SERVICE_NAME! --region !AWS_REGION!

REM ── Verify Deployment ─────────────────────────────────────────────────────────
echo.
echo -- Deployment Status --
aws ecs describe-services --cluster !CLUSTER_NAME! --services !SERVICE_NAME! --region !AWS_REGION! --query "services[0].{Status:status,Running:runningCount,Desired:desiredCount,Pending:pendingCount}" --output table

echo.
echo ============================================================
echo   Deployment complete!
echo   Service  : !SERVICE_NAME!
echo   Cluster  : !CLUSTER_NAME!
echo   Task Def : !TASK_DEF_ARN!
echo   Log Group: !LOG_GROUP!
if "!USE_LB!"=="true" echo   ALB DNS  : http://!ALB_DNS!
echo ============================================================
echo.
echo Troubleshooting tips:
echo   View logs : aws logs tail !LOG_GROUP! --follow --region !AWS_REGION!
echo   List tasks: aws ecs list-tasks --cluster !CLUSTER_NAME! --service-name !SERVICE_NAME! --region !AWS_REGION!

endlocal
