#!/usr/bin/env bash
# =============================================================================
# build-push.sh — Build and push the storefront-backend Docker image
# Supports: AWS ECR and Docker Hub
# Usage   : bash scripts/build-push.sh
# Run from: repository root (docker build context = .)
# =============================================================================
set -e
set -o pipefail

PROJECT_NAME="storefront-backend"
DOCKERFILE_PATH="Dockerfile"

echo "=============================================="
echo "  storefront-backend — Build & Push Script"
echo "=============================================="
echo ""

# ── Sanitize project name for use as Docker image name ───────────────────────
IMAGE_NAME=$(echo "$PROJECT_NAME" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed 's/^-*//;s/-*$//')

# ── Prompt for image tag ──────────────────────────────────────────────────────
read -rp "Enter image tag [latest]: " INPUT_TAG
INPUT_TAG=$(echo "${INPUT_TAG:-latest}" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9._-' '-' | sed 's/^-*//;s/-*$//')
IMAGE_TAG="${INPUT_TAG:-latest}"
echo "Using image tag: ${IMAGE_TAG}"
echo ""

# ── Registry selection ────────────────────────────────────────────────────────
echo "Select container registry:"
echo "  1) AWS ECR"
echo "  2) Docker Hub"
read -rp "Enter choice [1]: " REGISTRY_CHOICE
REGISTRY_CHOICE="${REGISTRY_CHOICE:-1}"

# ── AWS ECR ───────────────────────────────────────────────────────────────────
if [ "$REGISTRY_CHOICE" = "1" ]; then
  echo ""
  echo "── AWS ECR Configuration ──────────────────────────────────────────────"
  read -rp "AWS Region [us-east-1]: " AWS_REGION
  AWS_REGION="${AWS_REGION:-us-east-1}"

  read -rp "AWS Account ID: " ACCOUNT_ID
  if [ -z "$ACCOUNT_ID" ]; then
    echo "Fetching AWS Account ID from STS..."
    ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    echo "Account ID: ${ACCOUNT_ID}"
  fi

  read -rp "ECR repository name [${IMAGE_NAME}]: " ECR_REPO
  ECR_REPO="${ECR_REPO:-${IMAGE_NAME}}"

  REGISTRY_URL="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
  FULL_IMAGE_NAME="${REGISTRY_URL}/${ECR_REPO}:${IMAGE_TAG}"

  echo ""
  echo "Logging in to ECR..."
  aws ecr get-login-password --region "${AWS_REGION}" | \
    docker login --username AWS --password-stdin "${REGISTRY_URL}"

  echo "Ensuring ECR repository '${ECR_REPO}' exists..."
  aws ecr describe-repositories --repository-names "${ECR_REPO}" --region "${AWS_REGION}" >/dev/null 2>&1 || \
    aws ecr create-repository --repository-name "${ECR_REPO}" --region "${AWS_REGION}"
  echo "ECR repository ready."

# ── Docker Hub ────────────────────────────────────────────────────────────────
elif [ "$REGISTRY_CHOICE" = "2" ]; then
  echo ""
  echo "── Docker Hub Configuration ───────────────────────────────────────────"
  read -rp "Docker Hub username: " DOCKER_USERNAME
  read -rsp "Docker Hub password / access token: " DOCKER_PASSWORD
  echo ""
  read -rp "Docker Hub namespace (org or username) [${DOCKER_USERNAME}]: " DOCKER_NAMESPACE
  DOCKER_NAMESPACE="${DOCKER_NAMESPACE:-${DOCKER_USERNAME}}"

  FULL_IMAGE_NAME="${DOCKER_NAMESPACE}/${IMAGE_NAME}:${IMAGE_TAG}"

  echo ""
  echo "Logging in to Docker Hub..."
  echo "${DOCKER_PASSWORD}" | docker login --username "${DOCKER_USERNAME}" --password-stdin

else
  echo "Invalid choice. Exiting."
  exit 1
fi

# ── Build ─────────────────────────────────────────────────────────────────────
echo ""
echo "Building Docker image: ${FULL_IMAGE_NAME}"
echo "Build context        : . (repository root)"
echo "Dockerfile           : ${DOCKERFILE_PATH}"
echo ""
docker build \
  -f "${DOCKERFILE_PATH}" \
  -t "${FULL_IMAGE_NAME}" \
  .

echo ""
echo "Build successful: ${FULL_IMAGE_NAME}"

# ── Push ──────────────────────────────────────────────────────────────────────
echo ""
echo "Pushing image to registry..."
docker push "${FULL_IMAGE_NAME}"

echo ""
echo "=============================================="
echo "  Image pushed successfully!"
echo "  ${FULL_IMAGE_NAME}"
echo "=============================================="
