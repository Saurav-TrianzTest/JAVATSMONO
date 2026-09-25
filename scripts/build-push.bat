@echo off
setlocal enabledelayedexpansion

REM =============================================================================
REM build-push.bat – Build and push the storefront-backend Docker image
REM Supports: AWS ECR and Docker Hub
REM Usage: scripts\build-push.bat  (run from repository root)
REM =============================================================================

set "PROJECT_NAME=storefront-backend"
set "DOCKERFILE_PATH=Dockerfile"
set "BUILD_CONTEXT=."

echo ==============================================
echo   storefront-backend - Docker Build ^& Push
echo ==============================================
echo.

REM ── Sanitize image name ───────────────────────────────────────────────────────
for /f "delims=" %%i in ('powershell -NoProfile -Command "\"storefront-backend\".ToLower() -replace '[^a-z0-9]','-' -replace '^-+','' -replace '-+$',''"') do set "IMAGE_NAME=%%i"
echo Image name: !IMAGE_NAME!

REM ── Prompt for image tag ──────────────────────────────────────────────────────
set /p IMAGE_TAG_INPUT="Enter image tag [latest]: "
if "!IMAGE_TAG_INPUT!"=="" set "IMAGE_TAG_INPUT=latest"
for /f "delims=" %%i in ('powershell -NoProfile -Command "\"!IMAGE_TAG_INPUT!\".ToLower() -replace '[^a-z0-9._-]','-' -replace '^-+','' -replace '-+$',''"') do set "IMAGE_TAG=%%i"
if "!IMAGE_TAG!"=="" set "IMAGE_TAG=latest"
echo Image tag: !IMAGE_TAG!
echo.

REM ── Registry selection ────────────────────────────────────────────────────────
echo Select container registry:
echo   1. AWS ECR
echo   2. Docker Hub
set /p REGISTRY_CHOICE="Enter choice [1]: "
if "!REGISTRY_CHOICE!"=="" set "REGISTRY_CHOICE=1"

if "!REGISTRY_CHOICE!"=="1" goto :ecr_setup
if "!REGISTRY_CHOICE!"=="2" goto :dockerhub_setup
echo Invalid choice. Exiting.
exit /b 1

:ecr_setup
REM ── AWS ECR ──────────────────────────────────────────────────────────────────
echo.
echo -- AWS ECR Configuration --
set /p AWS_REGION="Enter AWS Region [us-east-1]: "
if "!AWS_REGION!"=="" set "AWS_REGION=us-east-1"

set /p AWS_ACCOUNT_ID="Enter AWS Account ID (leave blank to auto-detect): "
if "!AWS_ACCOUNT_ID!"=="" (
    echo Fetching AWS Account ID...
    for /f "delims=" %%i in ('aws sts get-caller-identity --query Account --output text') do set "AWS_ACCOUNT_ID=%%i"
    echo Account ID: !AWS_ACCOUNT_ID!
)

set /p ECR_REPO_INPUT="Enter ECR repository name [!IMAGE_NAME!]: "
if "!ECR_REPO_INPUT!"=="" set "ECR_REPO_INPUT=!IMAGE_NAME!"
set "ECR_REPO=!ECR_REPO_INPUT!"

set "REGISTRY_URL=!AWS_ACCOUNT_ID!.dkr.ecr.!AWS_REGION!.amazonaws.com"
set "FULL_IMAGE_NAME=!REGISTRY_URL!/!ECR_REPO!:!IMAGE_TAG!"

echo.
echo Logging in to ECR...
aws ecr get-login-password --region !AWS_REGION! | docker login --username AWS --password-stdin !REGISTRY_URL!
if !ERRORLEVEL! neq 0 (
    echo ECR login failed.
    exit /b 1
)

echo Checking/creating ECR repository: !ECR_REPO! ...
aws ecr describe-repositories --repository-names !ECR_REPO! --region !AWS_REGION! >nul 2>&1
if !ERRORLEVEL! neq 0 (
    echo Creating ECR repository...
    aws ecr create-repository --repository-name !ECR_REPO! --region !AWS_REGION!
    if !ERRORLEVEL! neq 0 (
        echo Failed to create ECR repository.
        exit /b 1
    )
)
echo ECR repository ready.
goto :build_image

:dockerhub_setup
REM ── Docker Hub ────────────────────────────────────────────────────────────────
echo.
echo -- Docker Hub Configuration --
set /p DOCKER_USERNAME="Enter Docker Hub username: "
set /p DOCKER_PASSWORD="Enter Docker Hub password/token: "
set /p DOCKER_NAMESPACE_INPUT="Enter Docker Hub namespace [!DOCKER_USERNAME!]: "
if "!DOCKER_NAMESPACE_INPUT!"=="" set "DOCKER_NAMESPACE_INPUT=!DOCKER_USERNAME!"
set "DOCKER_NAMESPACE=!DOCKER_NAMESPACE_INPUT!"

set "FULL_IMAGE_NAME=!DOCKER_NAMESPACE!/!IMAGE_NAME!:!IMAGE_TAG!"

echo.
echo Logging in to Docker Hub...
echo !DOCKER_PASSWORD! | docker login --username !DOCKER_USERNAME! --password-stdin
if !ERRORLEVEL! neq 0 (
    echo Docker Hub login failed.
    exit /b 1
)
goto :build_image

:build_image
echo.
echo Full image name: !FULL_IMAGE_NAME!
echo.

REM ── Build Docker image ────────────────────────────────────────────────────────
echo Building Docker image...
docker build -f "!DOCKERFILE_PATH!" -t "!FULL_IMAGE_NAME!" "!BUILD_CONTEXT!"
if !ERRORLEVEL! neq 0 (
    echo Docker build failed.
    exit /b 1
)

echo.
echo Build successful: !FULL_IMAGE_NAME!

REM ── Push Docker image ─────────────────────────────────────────────────────────
echo.
echo Pushing image to registry...
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
