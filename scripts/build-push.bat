@echo off
setlocal enabledelayedexpansion

REM Build and Push Script for Docker Images (Windows)
REM Supports AWS ECR and Docker Hub registries
REM Includes automatic tag sanitization and ECR repository creation

echo ==========================================
echo Docker Build and Push Script
echo ==========================================
echo.

REM Project configuration
set PROJECT_NAME=storefront-backend

REM Prompt for image tag
set /p IMAGE_TAG="Enter image tag (default: latest): "
if "!IMAGE_TAG!"=="" set IMAGE_TAG=latest

REM Sanitize tag using PowerShell
for /f "delims=" %%i in ('powershell -Command "$tag = '%IMAGE_TAG%'; $tag = $tag.ToLower(); $tag = $tag -replace '[^a-z0-9.-]', '-'; $tag = $tag -replace '^-+', ''; $tag = $tag -replace '-+$', ''; Write-Output $tag"') do set IMAGE_TAG=%%i
echo Sanitized tag: !IMAGE_TAG!
echo.

REM Sanitize project name
for /f "delims=" %%i in ('powershell -Command "$name = '%PROJECT_NAME%'; $name = $name.ToLower(); $name = $name -replace '[^a-z0-9]', '-'; $name = $name -replace '^-+', ''; $name = $name -replace '-+$', ''; Write-Output $name"') do set IMAGE_NAME=%%i

REM Registry selection
echo Select Docker Registry:
echo 1. AWS ECR (Elastic Container Registry)
echo 2. Docker Hub
echo.
set /p REGISTRY_CHOICE="Enter choice (1 or 2): "

if "!REGISTRY_CHOICE!"=="1" (
    echo.
    echo === AWS ECR Configuration ===
    
    REM Prompt for AWS region
    set /p AWS_REGION="Enter AWS region (e.g., us-east-1): "
    if "!AWS_REGION!"=="" (
        echo Error: AWS region is required
        exit /b 1
    )
    
    REM Prompt for ECR repository name
    set /p ECR_REPO="Enter ECR repository name (default: !IMAGE_NAME!): "
    if "!ECR_REPO!"=="" set ECR_REPO=!IMAGE_NAME!
    
    REM Get AWS account ID
    echo Getting AWS account ID...
    for /f "delims=" %%i in ('aws sts get-caller-identity --query Account --output text') do set AWS_ACCOUNT_ID=%%i
    if "!AWS_ACCOUNT_ID!"=="" (
        echo Error: Failed to get AWS account ID. Ensure AWS CLI is configured.
        exit /b 1
    )
    
    set REGISTRY_URL=!AWS_ACCOUNT_ID!.dkr.ecr.!AWS_REGION!.amazonaws.com
    set FULL_IMAGE_NAME=!REGISTRY_URL!/!ECR_REPO!:!IMAGE_TAG!
    
    echo.
    echo Authenticating with AWS ECR...
    for /f "delims=" %%i in ('aws ecr get-login-password --region !AWS_REGION!') do set ECR_PASSWORD=%%i
    echo !ECR_PASSWORD! | docker login --username AWS --password-stdin !REGISTRY_URL!
    
    if !ERRORLEVEL! neq 0 (
        echo Error: ECR authentication failed
        exit /b 1
    )
    
    REM Check if repository exists, create if not
    echo Checking if ECR repository exists...
    aws ecr describe-repositories --repository-names !ECR_REPO! --region !AWS_REGION! >nul 2>&1
    if !ERRORLEVEL! neq 0 (
        echo Repository does not exist. Creating ECR repository: !ECR_REPO!
        aws ecr create-repository --repository-name !ECR_REPO! --region !AWS_REGION!
        if !ERRORLEVEL! neq 0 (
            echo Error: Failed to create ECR repository
            exit /b 1
        )
        echo ECR repository created successfully
    )
    
) else if "!REGISTRY_CHOICE!"=="2" (
    echo.
    echo === Docker Hub Configuration ===
    
    REM Prompt for Docker Hub credentials
    set /p DOCKER_USERNAME="Enter Docker Hub username: "
    if "!DOCKER_USERNAME!"=="" (
        echo Error: Docker Hub username is required
        exit /b 1
    )
    
    set /p DOCKER_PASSWORD="Enter Docker Hub password or access token: "
    if "!DOCKER_PASSWORD!"=="" (
        echo Error: Docker Hub password is required
        exit /b 1
    )
    
    set FULL_IMAGE_NAME=!DOCKER_USERNAME!/!IMAGE_NAME!:!IMAGE_TAG!
    
    echo.
    echo Authenticating with Docker Hub...
    echo !DOCKER_PASSWORD! | docker login --username !DOCKER_USERNAME! --password-stdin
    
    if !ERRORLEVEL! neq 0 (
        echo Error: Docker Hub authentication failed
        exit /b 1
    )
    
) else (
    echo Error: Invalid choice. Please select 1 or 2.
    exit /b 1
)

echo.
echo ==========================================
echo Building Docker Image
echo ==========================================
echo Image: !FULL_IMAGE_NAME!
echo.

REM Build Docker image
docker build -t !FULL_IMAGE_NAME! .

if !ERRORLEVEL! neq 0 (
    echo Error: Docker build failed
    exit /b 1
)

echo.
echo ==========================================
echo Pushing Docker Image
echo ==========================================
echo.

REM Push Docker image
docker push !FULL_IMAGE_NAME!

if !ERRORLEVEL! neq 0 (
    echo Error: Docker push failed
    exit /b 1
)

echo.
echo ==========================================
echo Build and Push Completed Successfully!
echo ==========================================
echo Image: !FULL_IMAGE_NAME!
echo.
echo You can now deploy this image to your container orchestration platform.

endlocal
