#!/bin/bash
# =============================================================================
# build-push.sh – Build and push Docker image for storefront-backend
# Usage: ./scripts/build-push.sh
# Run from the repository root directory.
# =============================================================================
set -e
set -o pipefail

PROJECT_NAME="storefront-backend"

echo "=============================================="
echo "  storefront-backend – Docker Build & Push"
echo "=============================================="
echo ""

# ── Sanitize image name (lowercase, hyphens only) ──────────────────────────
IMAGE_NAME=$(echo "$PROJECT_NAME" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed 's/^-*//;s/-*$//')

# ── Prompt for image tag ────────────────────────────────────────────────────
read -rp "Enter image tag [latest]: " RAW_TAG
RAW_TAG="${RAW_TAG:-latest}"
IMAGE_TAG=$(echo "$RAW_TAG" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9._-' '-' | sed 's/^-*//;s/-*$//')
IMAGE_TAG="${IMAGE_TAG:-latest}"
echo "Using image tag: $IMAGE_TAG"
echo ""

# ── Registry selection ──────────────────────────────────────────────────────
echo "Select container registry:"
echo "  1. AWS ECR"
echo "  2. Docker Hub"
read -rp "Enter choice [1]: " REGISTRY_CHOICE
REGISTRY_CHOICE="${REGISTRY_CHOICE:-1}"

if [ "$REGISTRY_CHOICE" = "1" ]; then
  # ── AWS ECR ──────────────────────────────────────────────────────────────
  echo ""
  echo "--- AWS ECR Configuration ---"
  read -rp "Enter AWS Region [us-east-1]: " AWS_REGION
  AWS_REGION="${AWS_REGION:-us-east-1}"

  read -rp "Enter AWS Account ID: " AWS_ACCOUNT_ID
  if [ -z "$AWS_ACCOUNT_ID" ]; then
    echo "Fetching AWS Account ID..."
    AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    echo "Account ID: $AWS_ACCOUNT_ID"
  fi

  read -rp "Enter ECR repository name [$IMAGE_NAME]: " ECR_REPO
  ECR_REPO="${ECR_REPO:-$IMAGE_NAME}"

  REGISTRY_URL="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
  FULL_IMAGE_NAME="${REGISTRY_URL}/${ECR_REPO}:${IMAGE_TAG}"

  echo ""
  echo "Logging in to Amazon ECR..."
  aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$REGISTRY_URL"
  echo "ECR login successful."

  # Auto-create ECR repository if it doesn't exist
  echo "Checking ECR repository..."
  aws ecr describe-repositories --repository-names "$ECR_REPO" --region "$AWS_REGION" >/dev/null 2>&1 || {
    echo "Repository '$ECR_REPO' not found. Creating..."
    aws ecr create-repository --repository-name "$ECR_REPO" --region "$AWS_REGION"
    echo "Repository created."
  }

elif [ "$REGISTRY_CHOICE" = "2" ]; then
  # ── Docker Hub ────────────────────────────────────────────────────────────
  echo ""
  echo "--- Docker Hub Configuration ---"
  read -rp "Enter Docker Hub username: " DOCKER_USERNAME
  read -rsp "Enter Docker Hub password/token: " DOCKER_PASSWORD
  echo ""
  read -rp "Enter Docker Hub namespace [$DOCKER_USERNAME]: " DOCKER_NAMESPACE
  DOCKER_NAMESPACE="${DOCKER_NAMESPACE:-$DOCKER_USERNAME}"

  FULL_IMAGE_NAME="${DOCKER_NAMESPACE}/${IMAGE_NAME}:${IMAGE_TAG}"

  echo ""
  echo "Logging in to Docker Hub..."
  echo "$DOCKER_PASSWORD" | docker login --username "$DOCKER_USERNAME" --password-stdin
  echo "Docker Hub login successful."

else
  echo "Invalid choice. Exiting."
  exit 1
fi

echo ""
echo "Building Docker image: $FULL_IMAGE_NAME"
echo "Build context: . (repository root)"
echo ""

# ── Build ────────────────────────────────────────────────────────────────────
docker build -f Dockerfile -t "$FULL_IMAGE_NAME" .
echo ""
echo "Build successful."

# ── Push ─────────────────────────────────────────────────────────────────────
echo "Pushing image: $FULL_IMAGE_NAME"
docker push "$FULL_IMAGE_NAME"
echo ""
echo "=============================================="
echo "  Image pushed successfully!"
echo "  $FULL_IMAGE_NAME"
echo "=============================================="
