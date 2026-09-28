# Deployment Guide — storefront-backend on AWS ECS Fargate

## Table of Contents
1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Project Structure](#project-structure)
4. [Local Development with Docker Compose](#local-development-with-docker-compose)
5. [Build and Push Docker Image](#build-and-push-docker-image)
6. [AWS ECS Fargate Prerequisites](#aws-ecs-fargate-prerequisites)
7. [ECS Task Definition Explained](#ecs-task-definition-explained)
8. [ECS Service Configuration](#ecs-service-configuration)
9. [ECS Fargate Deployment Walkthrough](#ecs-fargate-deployment-walkthrough)
10. [ECS-Specific Troubleshooting](#ecs-specific-troubleshooting)
11. [Scaling and Management](#scaling-and-management)
12. [Configuration Management](#configuration-management)
13. [Security Considerations](#security-considerations)
14. [Java-Specific Notes](#java-specific-notes)

---

## Overview

**Application**: storefront-backend  
**Framework**: Spring Boot 3.2.5  
**Java Version**: 17  
**Build Tool**: Maven  
**Package Type**: Executable JAR  
**Application Port**: 8080  
**Health Endpoint**: `GET /api/health`  
**Runtime Base Image**: `amazoncorretto:17`  
**Target Platform**: AWS ECS Fargate  

---

## Prerequisites

### Local Development
| Tool | Version | Purpose |
|------|---------|---------|
| Docker Desktop | 24+ | Build and run containers locally |
| Docker Compose | v2+ | Multi-container local orchestration |
| Java JDK | 17 | Local development and testing |
| Maven | 3.9+ | Build tool |
| AWS CLI | v2 | Cloud deployment |

### AWS Deployment
| Tool | Version | Purpose |
|------|---------|---------|
| AWS CLI | v2 | ECS, ECR, CloudWatch operations |
| jq | 1.6+ | JSON processing in deploy scripts |
| Docker | 24+ | Image build and push |

Install AWS CLI v2:
```bash
# macOS
brew install awscli

# Linux
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip && sudo ./aws/install

# Windows
# Download from https://aws.amazon.com/cli/
```

Configure AWS credentials:
```bash
aws configure
# Enter: AWS Access Key ID, Secret Access Key, Region, Output format
```

---

## Project Structure

```
TS-Test/
├── Dockerfile                    # Multi-stage build (Maven builder + amazoncorretto:17 runtime)
├── .dockerignore                 # Excludes target/, wrapper files, IDE metadata
├── docker-compose.yml            # Local development (application only)
├── pom.xml                       # Maven build descriptor
├── src/
│   └── main/
│       ├── java/com/trianz/storefront/
│       │   ├── StorefrontBackendApplication.java
│       │   ├── controller/HealthController.java
│       │   └── service/HealthService.java
│       └── resources/
│           └── application.properties
├── scripts/
│   ├── build-push.sh             # Linux/macOS: build & push to ECR or Docker Hub
│   ├── build-push.bat            # Windows: build & push to ECR or Docker Hub
│   ├── deploy-image.sh           # Linux/macOS: deploy to ECS Fargate
│   └── deploy-image.bat          # Windows: deploy to ECS Fargate
├── ecs/
│   ├── task-definition.json      # ECS Fargate task definition
│   └── service-definition.json   # ECS Fargate service definition
└── docs/
    └── DEPLOYMENT.md             # This file
```

---

## Local Development with Docker Compose

### Build and Start
```bash
# From repository root
docker compose up --build

# Run in background
docker compose up --build -d
```

### Verify Application
```bash
# Health check
curl http://localhost:8080/api/health
# Expected: {"status":"ok"}
```

### View Logs
```bash
docker compose logs -f storefront-backend
```

### Stop
```bash
docker compose down
```

### Environment Variable Overrides
Create a `.env` file in the project root to override defaults:
```env
SPRING_PROFILES_ACTIVE=local
SERVER_PORT=8080
JAVA_OPTS=-XX:+UseContainerSupport -XX:MaxRAMPercentage=75.0 -Xms256m
```

---

## Build and Push Docker Image

### Linux / macOS
```bash
chmod +x scripts/build-push.sh
bash scripts/build-push.sh
```

### Windows
```cmd
scripts\build-push.bat
```

The script will prompt for:
1. **Image tag** (default: `latest`)
2. **Registry type**: AWS ECR or Docker Hub
3. **Registry credentials** (ECR: region + account ID; Docker Hub: username + password)

The script automatically:
- Sanitizes the image name to lowercase with hyphens
- Logs in to the selected registry
- Creates the ECR repository if it does not exist
- Builds the Docker image from the repository root
- Pushes the image to the registry

### Manual Build
```bash
# Build
docker build -t storefront-backend:latest .

# Tag for ECR
docker tag storefront-backend:latest \
  123456789.dkr.ecr.us-east-1.amazonaws.com/storefront-backend:latest

# Push
docker push 123456789.dkr.ecr.us-east-1.amazonaws.com/storefront-backend:latest
```

---

## AWS ECS Fargate Prerequisites

### 1. IAM Roles

#### ECS Task Execution Role
Required for ECS to pull images from ECR and write logs to CloudWatch.

```bash
# Create the role
aws iam create-role \
  --role-name ecsTaskExecutionRole \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": {"Service": "ecs-tasks.amazonaws.com"},
      "Action": "sts:AssumeRole"
    }]
  }'

# Attach the managed policy
aws iam attach-role-policy \
  --role-name ecsTaskExecutionRole \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
```

#### ECS Task Role (optional)
Required if the application needs to call other AWS services (S3, DynamoDB, etc.).

```bash
aws iam create-role \
  --role-name ecsTaskRole \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": {"Service": "ecs-tasks.amazonaws.com"},
      "Action": "sts:AssumeRole"
    }]
  }'
```

### 2. VPC and Networking

Fargate tasks require **awsvpc** network mode. You need:
- A VPC with at least **2 subnets** in different Availability Zones
- A **Security Group** that allows inbound TCP on port **8080**

```bash
# Create security group
aws ec2 create-security-group \
  --group-name storefront-backend-sg \
  --description "Security group for storefront-backend ECS tasks" \
  --vpc-id vpc-xxxxxxxxxxxxxxxxx

# Allow inbound on port 8080
aws ec2 authorize-security-group-ingress \
  --group-id sg-xxxxxxxxxxxxxxxxx \
  --protocol tcp \
  --port 8080 \
  --cidr 0.0.0.0/0
```

### 3. ECR Repository

```bash
aws ecr create-repository \
  --repository-name storefront-backend \
  --region us-east-1
```

### 4. CloudWatch Log Group

```bash
aws logs create-log-group \
  --log-group-name /ecs/storefront-backend \
  --region us-east-1
```

---

## ECS Task Definition Explained

File: `ecs/task-definition.json`

| Field | Value | Notes |
|-------|-------|-------|
| `family` | `storefront-backend-task` | Task definition family name |
| `requiresCompatibilities` | `["FARGATE"]` | Fargate launch type |
| `networkMode` | `awsvpc` | Required for Fargate |
| `cpu` | `"512"` | 0.5 vCPU |
| `memory` | `"1024"` | 1 GB RAM |
| `executionRoleArn` | `ecsTaskExecutionRole` | Allows ECR pull + CloudWatch logs |
| `taskRoleArn` | `ecsTaskRole` | Application-level AWS permissions |

### Valid Fargate CPU/Memory Combinations

| CPU | Memory Options |
|-----|---------------|
| 256 (.25 vCPU) | 512, 1024, 2048 MB |
| **512 (.5 vCPU)** | **1024**, 2048, 3072, 4096 MB |
| 1024 (1 vCPU) | 2048–8192 MB |
| 2048 (2 vCPU) | 4096–16384 MB |
| 4096 (4 vCPU) | 8192–30720 MB |

### Container Definition Key Fields
- **`essential: true`** — ECS stops the task if this container exits
- **`portMappings`** — Only `containerPort` is needed for Fargate (no `hostPort`)
- **`logConfiguration`** — CloudWatch Logs via `awslogs` driver
- **`environment`** — Static environment variables (use Secrets Manager for secrets)

---

## ECS Service Configuration

File: `ecs/service-definition.json`

| Field | Value | Notes |
|-------|-------|-------|
| `launchType` | `FARGATE` | Serverless compute |
| `desiredCount` | `2` | Two tasks for high availability |
| `networkMode` | `awsvpc` | Each task gets its own ENI |
| `assignPublicIp` | `ENABLED` | Required for public subnet tasks without NAT |
| `maximumPercent` | `200` | Allows 4 tasks during rolling deploy |
| `minimumHealthyPercent` | `50` | Keeps 1 task running during deploy |
| `propagateTags` | `SERVICE` | Tags propagate from service to tasks |

---

## ECS Fargate Deployment Walkthrough

### Step 1: Build and Push Image
```bash
bash scripts/build-push.sh
# Select ECR, enter region and account ID
# Note the full image URI output
```

### Step 2: Deploy to ECS
```bash
bash scripts/deploy-image.sh
```

The script will prompt for:
- AWS Region
- ECS Cluster name (creates if not exists)
- VPC ID
- Subnet IDs (comma-separated)
- Security Group ID
- ECR Image URI
- Load Balancer preference (y/n)

### Step 3: Verify Deployment
```bash
# Check service status
aws ecs describe-services \
  --cluster storefront-cluster \
  --services storefront-backend-service \
  --region us-east-1

# List running tasks
aws ecs list-tasks \
  --cluster storefront-cluster \
  --service-name storefront-backend-service \
  --region us-east-1

# View application logs
aws logs tail /ecs/storefront-backend --follow --region us-east-1
```

### Step 4: Test the Application
```bash
# If using ALB
curl http://<ALB_DNS_NAME>/api/health

# If using public IP (get from task ENI)
TASK_ARN=$(aws ecs list-tasks \
  --cluster storefront-cluster \
  --service-name storefront-backend-service \
  --query "taskArns[0]" --output text)

ENI_ID=$(aws ecs describe-tasks \
  --cluster storefront-cluster \
  --tasks $TASK_ARN \
  --query "tasks[0].attachments[0].details[?name=='networkInterfaceId'].value" \
  --output text)

PUBLIC_IP=$(aws ec2 describe-network-interfaces \
  --network-interface-ids $ENI_ID \
  --query "NetworkInterfaces[0].Association.PublicIp" \
  --output text)

curl http://${PUBLIC_IP}:8080/api/health
```

---

## ECS-Specific Troubleshooting

### Task Fails to Start

**Symptom**: Tasks stop immediately after starting.

```bash
# Check stopped task reason
aws ecs describe-tasks \
  --cluster storefront-cluster \
  --tasks <TASK_ARN> \
  --query "tasks[0].stoppedReason"

# Check container exit code
aws ecs describe-tasks \
  --cluster storefront-cluster \
  --tasks <TASK_ARN> \
  --query "tasks[0].containers[0].{ExitCode:exitCode,Reason:reason}"
```

**Common causes**:
- `CannotPullContainerError` → Check ECR permissions on `ecsTaskExecutionRole`
- `OutOfMemoryError` → Increase task memory in `task-definition.json`
- Application crash → Check CloudWatch logs

### Network Issues

**Symptom**: Tasks start but are unreachable.

```bash
# Verify security group allows port 8080
aws ec2 describe-security-groups \
  --group-ids <SECURITY_GROUP_ID> \
  --query "SecurityGroups[0].IpPermissions"

# Check task ENI and public IP
aws ecs describe-tasks \
  --cluster storefront-cluster \
  --tasks <TASK_ARN> \
  --query "tasks[0].attachments"
```

### CPU/Memory Errors

**Symptom**: `InvalidParameterException: Invalid CPU or memory value specified`.

Ensure you use valid Fargate combinations. Default in this project: `cpu: "512"`, `memory: "1024"`.

### CloudWatch Logs Not Appearing

```bash
# Verify log group exists
aws logs describe-log-groups \
  --log-group-name-prefix /ecs/storefront-backend

# Check execution role has CloudWatch permissions
aws iam get-role-policy \
  --role-name ecsTaskExecutionRole \
  --policy-name AmazonECSTaskExecutionRolePolicy
```

### Image Pull Failures

```bash
# Re-authenticate to ECR
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin \
  123456789.dkr.ecr.us-east-1.amazonaws.com

# Verify image exists
aws ecr describe-images \
  --repository-name storefront-backend \
  --region us-east-1
```

---

## Scaling and Management

### Manual Scaling
```bash
aws ecs update-service \
  --cluster storefront-cluster \
  --service storefront-backend-service \
  --desired-count 4 \
  --region us-east-1
```

### Auto Scaling
```bash
# Register scalable target
aws application-autoscaling register-scalable-target \
  --service-namespace ecs \
  --resource-id service/storefront-cluster/storefront-backend-service \
  --scalable-dimension ecs:service:DesiredCount \
  --min-capacity 2 \
  --max-capacity 10

# Create CPU-based scaling policy
aws application-autoscaling put-scaling-policy \
  --service-namespace ecs \
  --resource-id service/storefront-cluster/storefront-backend-service \
  --scalable-dimension ecs:service:DesiredCount \
  --policy-name storefront-backend-cpu-scaling \
  --policy-type TargetTrackingScaling \
  --target-tracking-scaling-policy-configuration '{
    "TargetValue": 70.0,
    "PredefinedMetricSpecification": {
      "PredefinedMetricType": "ECSServiceAverageCPUUtilization"
    },
    "ScaleInCooldown": 300,
    "ScaleOutCooldown": 60
  }'
```

### Blue/Green Deployment
Use AWS CodeDeploy with ECS for zero-downtime blue/green deployments:
1. Create a CodeDeploy application with `ECS` compute platform
2. Create a deployment group linked to the ECS service
3. Use `appspec.yaml` to define traffic shifting hooks
4. Trigger deployments via CodePipeline or CLI

### Rolling Update (default)
The current service configuration uses rolling updates:
- `maximumPercent: 200` — allows double capacity during deployment
- `minimumHealthyPercent: 50` — keeps at least 1 task healthy

---

## Configuration Management

### Environment Variables
Static, non-sensitive values are defined in `ecs/task-definition.json` under `environment`.

### Secrets (Recommended for sensitive values)
Use AWS Secrets Manager or Parameter Store:

```bash
# Store a secret
aws secretsmanager create-secret \
  --name /storefront-backend/database-password \
  --secret-string "my-db-password"
```

Reference in task definition:
```json
"secrets": [
  {
    "name": "DATABASE_PASSWORD",
    "valueFrom": "arn:aws:secretsmanager:us-east-1:123456789:secret:/storefront-backend/database-password"
  }
]
```

Add `secretsmanager:GetSecretValue` permission to `ecsTaskExecutionRole`.

### Spring Profiles
The application uses `SPRING_PROFILES_ACTIVE=docker` in containers.  
Create `src/main/resources/application-docker.properties` for Docker-specific overrides.

---

## Security Considerations

1. **Non-root user**: The Dockerfile creates and uses `appuser` (non-root) for the runtime process.
2. **Minimal base image**: `amazoncorretto:17` contains only the JRE — no build tools or shells in production.
3. **No secrets in images**: Use AWS Secrets Manager or Parameter Store for credentials.
4. **Security Groups**: Restrict inbound access to port 8080 to known CIDR ranges or ALB security group only.
5. **ECR image scanning**: Enable ECR image scanning on push:
   ```bash
   aws ecr put-image-scanning-configuration \
     --repository-name storefront-backend \
     --image-scanning-configuration scanOnPush=true
   ```
6. **IAM least privilege**: Grant only the permissions the task actually needs.
7. **VPC isolation**: Deploy tasks in private subnets with a NAT Gateway for outbound traffic.
8. **TLS termination**: Terminate TLS at the ALB (HTTPS listener with ACM certificate).

---

## Java-Specific Notes

### JVM Tuning for Containers
The following JVM flags are set via `JAVA_OPTS`:

| Flag | Purpose |
|------|---------|
| `-XX:+UseContainerSupport` | Respects cgroup CPU/memory limits (Java 10+) |
| `-XX:MaxRAMPercentage=75.0` | Caps heap at 75% of container memory (768 MB for 1 GB task) |
| `-Xms256m` | Initial heap — reduces startup latency |
| `-Djava.security.egd=file:/dev/./urandom` | Faster SecureRandom seeding in containers |
| `-Dfile.encoding=UTF-8` | Consistent character encoding |
| `-Duser.timezone=UTC` | Consistent timezone |

### Spring Boot Graceful Shutdown
Spring Boot 3.x supports graceful shutdown. Add to `application.properties`:
```properties
server.shutdown=graceful
spring.lifecycle.timeout-per-shutdown-phase=30s
```

ECS sends `SIGTERM` before `SIGKILL` (30-second grace period by default).

### Heap Sizing for 1 GB Fargate Task
- Container memory: 1024 MB
- JVM heap (75%): ~768 MB
- Non-heap (metaspace, threads, etc.): ~256 MB

For memory-intensive workloads, increase to `cpu: "1024"`, `memory: "2048"`.

### Startup Time
Spring Boot 3.x on Java 17 typically starts in 3–8 seconds in a container.  
The ECS service does not have a container-level health check — the ALB health check  
(targeting `/api/health`) handles readiness detection.

### Logging
Logs are sent to CloudWatch via the `awslogs` driver. View them:
```bash
aws logs tail /ecs/storefront-backend --follow --region us-east-1
```

For structured JSON logging, add `logstash-logback-encoder` to `pom.xml` and configure `logback-spring.xml`.
