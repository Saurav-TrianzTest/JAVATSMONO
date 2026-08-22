@echo off
setlocal enabledelayedexpansion

REM =============================================================================
REM deploy-image.bat – Deploy storefront-backend to AWS ECS Fargate (Windows)
REM Usage: scripts\deploy-image.bat
REM Run from the repository root directory.
REM =============================================================================

set "SERVICE_NAME=storefront-backend-service"
set "TASK_FAMILY=storefront-backend-task"
set "PROJECT_NAME=storefront-backend"
set "LOG_GROUP=/ecs/storefront-backend"

echo ==============================================
echo   storefront-backend - ECS Fargate Deploy
echo ==============================================
echo.

REM ── AWS Configuration ─────────────────────────────────────────────────────────
set /p "AWS_REGION=Enter AWS Region [us-east-1]: "
if "!AWS_REGION!"=="" set "AWS_REGION=us-east-1"

set /p "CLUSTER_NAME=Enter ECS Cluster name [storefront-backend-cluster]: "
if "!CLUSTER_NAME!"=="" set "CLUSTER_NAME=storefront-backend-cluster"

REM ── Network Configuration ─────────────────────────────────────────────────────
echo.
echo --- Network Configuration ---
set /p "VPC_ID=Enter VPC ID (e.g. vpc-xxxxxxxx): "
set /p "SUBNETS_RAW=Enter Subnet IDs (comma-separated, e.g. subnet-aaa,subnet-bbb): "
set /p "SECURITY_GROUP=Enter Security Group ID (e.g. sg-xxxxxxxx): "

REM Parse subnets using PowerShell
for /f "delims=" %%i in ('powershell -NoProfile -Command "\"!SUBNETS_RAW!\".Split(',')[0].Trim()"') do set "SUBNET_1=%%i"
for /f "delims=" %%i in ('powershell -NoProfile -Command "$s=\"!SUBNETS_RAW!\".Split(','); if($s.Length -gt 1){$s[1].Trim()}else{$s[0].Trim()}"') do set "SUBNET_2=%%i"

REM ── Image URI ─────────────────────────────────────────────────────────────────
echo.
set /p "IMAGE_URI=Enter full ECR image URI (e.g. 123456789.dkr.ecr.us-east-1.amazonaws.com/storefront-backend:latest): "
if "!IMAGE_URI!"=="" (
    echo ERROR: Image URI is required.
    exit /b 1
)

REM ── Get AWS Account ID ────────────────────────────────────────────────────────
echo.
echo Fetching AWS Account ID...
for /f "delims=" %%i in ('aws sts get-caller-identity --query Account --output text') do set "ACCOUNT_ID=%%i"
echo Account ID: !ACCOUNT_ID!

REM ── Ensure CloudWatch Log Group exists ───────────────────────────────────────
echo.
echo Ensuring CloudWatch log group exists: !LOG_GROUP!
aws logs create-log-group --log-group-name "!LOG_GROUP!" --region "!AWS_REGION!" >nul 2>&1
echo Log group ready.

REM ── Check / Create ECS Cluster ───────────────────────────────────────────────
echo.
echo Checking ECS cluster: !CLUSTER_NAME!
for /f "delims=" %%i in ('aws ecs describe-clusters --clusters "!CLUSTER_NAME!" --region "!AWS_REGION!" --query "clusters[0].status" --output text 2^>nul') do set "CLUSTER_STATUS=%%i"

if not "!CLUSTER_STATUS!"=="ACTIVE" (
    echo Cluster not found or inactive. Creating cluster: !CLUSTER_NAME!
    aws ecs create-cluster --cluster-name "!CLUSTER_NAME!" --region "!AWS_REGION!"
    echo Cluster created.
) else (
    echo Cluster '!CLUSTER_NAME!' is active.
)

REM ── Load Balancer ─────────────────────────────────────────────────────────────
echo.
set /p "NEED_LB=Do you need a load balancer for this service? (y/n) [n]: "
if "!NEED_LB!"=="" set "NEED_LB=n"

set "TARGET_GROUP_ARN="
set "LB_DNS="

if /i "!NEED_LB!"=="y" (
    echo.
    echo Creating Application Load Balancer...

    set "LB_NAME=!PROJECT_NAME!-alb"
    set "TG_NAME=!PROJECT_NAME!-tg"

    for /f "delims=" %%i in ('aws elbv2 create-load-balancer --name "!LB_NAME!" --subnets "!SUBNET_1!" "!SUBNET_2!" --security-groups "!SECURITY_GROUP!" --scheme internet-facing --type application --region "!AWS_REGION!" --query "LoadBalancers[0].LoadBalancerArn" --output text') do set "LB_ARN=%%i"
    echo ALB created: !LB_ARN!

    for /f "delims=" %%i in ('aws elbv2 describe-load-balancers --load-balancer-arns "!LB_ARN!" --region "!AWS_REGION!" --query "LoadBalancers[0].DNSName" --output text') do set "LB_DNS=%%i"

    for /f "delims=" %%i in ('aws elbv2 create-target-group --name "!TG_NAME!" --protocol HTTP --port 8080 --vpc-id "!VPC_ID!" --target-type ip --health-check-path "/api/health" --health-check-interval-seconds 30 --healthy-threshold-count 2 --unhealthy-threshold-count 3 --region "!AWS_REGION!" --query "TargetGroups[0].TargetGroupArn" --output text') do set "TARGET_GROUP_ARN=%%i"
    echo Target Group created: !TARGET_GROUP_ARN!

    aws elbv2 create-listener --load-balancer-arn "!LB_ARN!" --protocol HTTP --port 80 --default-actions "Type=forward,TargetGroupArn=!TARGET_GROUP_ARN!" --region "!AWS_REGION!" >nul
    echo Listener created on port 80.
)

REM ── Prepare task-definition.json ─────────────────────────────────────────────
echo.
echo Preparing task definition...
copy /Y ecs\task-definition.json %TEMP%\task-definition-deploy.json >nul

powershell -NoProfile -Command ^
  "(Get-Content '%TEMP%\task-definition-deploy.json') -replace '{{IMAGE_URI}}','!IMAGE_URI!' -replace '{{AWS_REGION}}','!AWS_REGION!' -replace '{{ACCOUNT_ID}}','!ACCOUNT_ID!' | Set-Content '%TEMP%\task-definition-deploy.json'"

REM ── Register Task Definition ──────────────────────────────────────────────────
echo Registering task definition...
for /f "delims=" %%i in ('aws ecs register-task-definition --cli-input-json file://%TEMP%\task-definition-deploy.json --region "!AWS_REGION!" --query "taskDefinition.taskDefinitionArn" --output text') do set "TASK_DEF_ARN=%%i"
echo Task definition registered: !TASK_DEF_ARN!

REM ── Prepare service-definition.json ──────────────────────────────────────────
echo.
echo Preparing service definition...
copy /Y ecs\service-definition.json %TEMP%\service-definition-deploy.json >nul

powershell -NoProfile -Command ^
  "(Get-Content '%TEMP%\service-definition-deploy.json') -replace '{{CLUSTER_NAME}}','!CLUSTER_NAME!' -replace '{{SUBNET_1}}','!SUBNET_1!' -replace '{{SUBNET_2}}','!SUBNET_2!' -replace '{{SECURITY_GROUP}}','!SECURITY_GROUP!' | Set-Content '%TEMP%\service-definition-deploy.json'"

REM Inject load balancer config if needed
if /i "!NEED_LB!"=="y" (
    powershell -NoProfile -Command ^
      "$svc = Get-Content '%TEMP%\service-definition-deploy.json' | ConvertFrom-Json; $svc | Add-Member -Force -NotePropertyName 'loadBalancers' -NotePropertyValue @(@{targetGroupArn='!TARGET_GROUP_ARN!';containerName='storefront-backend';containerPort=8080}); $svc | Add-Member -Force -NotePropertyName 'healthCheckGracePeriodSeconds' -NotePropertyValue 300; $svc | ConvertTo-Json -Depth 10 | Set-Content '%TEMP%\service-definition-deploy.json'"
    echo Load balancer configuration injected.
)

REM Update task definition ARN in service definition
powershell -NoProfile -Command ^
  "$svc = Get-Content '%TEMP%\service-definition-deploy.json' | ConvertFrom-Json; $svc.taskDefinition = '!TASK_DEF_ARN!'; $svc | ConvertTo-Json -Depth 10 | Set-Content '%TEMP%\service-definition-deploy.json'"

REM ── Check if service exists ───────────────────────────────────────────────────
echo.
echo Checking if ECS service exists...
for /f "delims=" %%i in ('aws ecs describe-services --cluster "!CLUSTER_NAME!" --services "!SERVICE_NAME!" --region "!AWS_REGION!" --query "services[?status!=''INACTIVE''].serviceName" --output text 2^>nul') do set "EXISTING_SERVICE=%%i"

if "!EXISTING_SERVICE!"=="" (
    echo Service does not exist. Creating service: !SERVICE_NAME!
    aws ecs create-service --cli-input-json file://%TEMP%\service-definition-deploy.json --region "!AWS_REGION!"
    echo Service created.
) else (
    echo Service '!SERVICE_NAME!' exists. Updating service...
    aws ecs update-service --cluster "!CLUSTER_NAME!" --service "!SERVICE_NAME!" --task-definition "!TASK_DEF_ARN!" --region "!AWS_REGION!" >nul
    echo Service updated.
)

REM ── Wait for stability ────────────────────────────────────────────────────────
echo.
echo Waiting for service to stabilize (this may take a few minutes)...
aws ecs wait services-stable --cluster "!CLUSTER_NAME!" --services "!SERVICE_NAME!" --region "!AWS_REGION!"
echo Service is stable.

REM ── Verify deployment ─────────────────────────────────────────────────────────
echo.
echo --- Deployment Summary ---
aws ecs describe-services --cluster "!CLUSTER_NAME!" --services "!SERVICE_NAME!" --region "!AWS_REGION!" --query "services[0].{Status:status,Running:runningCount,Desired:desiredCount,Pending:pendingCount}" --output table

echo.
echo CloudWatch Log Group: !LOG_GROUP!

if not "!LB_DNS!"=="" (
    echo.
    echo Load Balancer DNS: http://!LB_DNS!
    echo Health Check URL:  http://!LB_DNS!/api/health
)

echo.
echo ==============================================
echo   Deployment complete!
echo ==============================================
echo.
echo Troubleshooting tips:
echo   - View tasks:  aws ecs list-tasks --cluster !CLUSTER_NAME! --region !AWS_REGION!
echo   - Task logs:   aws logs tail !LOG_GROUP! --follow --region !AWS_REGION!

endlocal
