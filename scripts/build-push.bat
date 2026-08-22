@echo off
setlocal enabledelayedexpansion

REM =============================================================================
REM build-push.bat – Build and push Docker image for storefront-backend
REM Usage: scripts\build-push.bat
REM Run from the repository root directory.
REM =============================================================================

set "PROJECT_NAME=storefront-backend"

echo ==============================================
echo   storefront-backend - Docker Build ^& Push
echo ==============================================
echo.

REM ── Sanitize image name (lowercase) ─────────────────────────────────────────
REM Use PowerShell for reliable string manipulation
for /f "delims=" %%i in ('powershell -NoProfile -Command "\"storefront-backend\".ToLower() -replace '[^a-z0-9]','-' -replace '^-+','' -replace '-+$',''"') do set "IMAGE_NAME=%%i"

REM ── Prompt for image tag ─────────────────────────────────────────────────────
set /p "RAW_TAG=Enter image tag [latest]: "
if "!RAW_TAG!"=="" set "RAW_TAG=latest"
for /f "delims=" %%i in ('powershell -NoProfile -Command "\"!RAW_TAG!\".ToLower() -replace '[^a-z0-9._-]','-' -replace '^-+','' -replace '-+$',''"') do set "IMAGE_TAG=%%i"
if "!IMAGE_TAG!"=="" set "IMAGE_TAG=latest"
echo Using image tag: !IMAGE_TAG!
echo.

REM ── Registry selection ───────────────────────────────────────────────────────
echo Select container registry:
echo   1. AWS ECR
echo   2. Docker Hub
set /p "REGISTRY_CHOICE=Enter choice [1]: "
if "!REGISTRY_CHOICE!"=="" set "REGISTRY_CHOICE=1"

if "!REGISTRY_CHOICE!"=="1" goto :ecr_setup
if "!REGISTRY_CHOICE!"=="2" goto :dockerhub_setup
echo Invalid choice. Exiting.
exit /b 1

:ecr_setup
echo.
echo --- AWS ECR Configuration ---
set /p "AWS_REGION=Enter AWS Region [us-east-1]: "
if "!AWS_REGION!"=="" set "AWS_REGION=us-east-1"

set /p "AWS_ACCOUNT_ID=Enter AWS Account ID (leave blank to auto-detect): "
if "!AWS_ACCOUNT_ID!"=="" (
    echo Fetching AWS Account ID...
    for /f "delims=" %%i in ('aws sts get-caller-identity --query Account --output text') do set "AWS_ACCOUNT_ID=%%i"
    echo Account ID: !AWS_ACCOUNT_ID!
)

set /p "ECR_REPO=Enter ECR repository name [!IMAGE_NAME!]: "
if "!ECR_REPO!"=="" set "ECR_REPO=!IMAGE_NAME!"

set "REGISTRY_URL=!AWS_ACCOUNT_ID!.dkr.ecr.!AWS_REGION!.amazonaws.com"
set "FULL_IMAGE_NAME=!REGISTRY_URL!/!ECR_REPO!:!IMAGE_TAG!"

echo.
echo Logging in to Amazon ECR...
aws ecr get-login-password --region !AWS_REGION! | docker login --username AWS --password-stdin !REGISTRY_URL!
if !ERRORLEVEL! neq 0 (
    echo ECR login failed.
    exit /b 1
)
echo ECR login successful.

REM Auto-create ECR repository if it doesn't exist
echo Checking ECR repository...
aws ecr describe-repositories --repository-names !ECR_REPO! --region !AWS_REGION! >nul 2>&1
if !ERRORLEVEL! neq 0 (
    echo Repository '!ECR_REPO!' not found. Creating...
    aws ecr create-repository --repository-name !ECR_REPO! --region !AWS_REGION!
    if !ERRORLEVEL! neq 0 (
        echo Failed to create ECR repository.
        exit /b 1
    )
    echo Repository created.
)
goto :build

:dockerhub_setup
echo.
echo --- Docker Hub Configuration ---
set /p "DOCKER_USERNAME=Enter Docker Hub username: "
set /p "DOCKER_PASSWORD=Enter Docker Hub password/token: "
set /p "DOCKER_NAMESPACE=Enter Docker Hub namespace [!DOCKER_USERNAME!]: "
if "!DOCKER_NAMESPACE!"=="" set "DOCKER_NAMESPACE=!DOCKER_USERNAME!"

set "FULL_IMAGE_NAME=!DOCKER_NAMESPACE!/!IMAGE_NAME!:!IMAGE_TAG!"

echo.
echo Logging in to Docker Hub...
echo !DOCKER_PASSWORD! | docker login --username !DOCKER_USERNAME! --password-stdin
if !ERRORLEVEL! neq 0 (
    echo Docker Hub login failed.
    exit /b 1
)
echo Docker Hub login successful.
goto :build

:build
echo.
echo Building Docker image: !FULL_IMAGE_NAME!
echo Build context: . (repository root)
echo.

docker build -f Dockerfile -t "!FULL_IMAGE_NAME!" .
if !ERRORLEVEL! neq 0 (
    echo Docker build failed.
    exit /b 1
)
echo.
echo Build successful.

echo Pushing image: !FULL_IMAGE_NAME!
docker push "!FULL_IMAGE_NAME!"
if !ERRORLEVEL! neq 0 (
    echo Docker push failed.
    exit /b 1
)

echo.
echo ==============================================
echo   Image pushed successfully!
echo   !FULL_IMAGE_NAME!
echo ==============================================

endlocal
