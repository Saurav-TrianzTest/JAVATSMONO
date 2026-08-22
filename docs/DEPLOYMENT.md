# Deployment Guide – storefront-backend on AWS ECS Fargate

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
11. [ECS Fargate Scaling and Management](#ecs-fargate-scaling-and-management)
12. [Configuration Management](#configuration-management)
13. [Security Considerations](#security-considerations)
14. [Java-Specific Notes](#java-specific-notes)

---

## Overview

**Application**: storefront-backend  
**Framework**: Spring Boot 3.2.5  
**Java Version**: 17  
**Build Tool**: Maven  
**Package Type**: JAR  
**Application Port**: 8080  
**Health Endpoint**: `/api/health`  
**Target Platform**: AWS ECS Fargate  
**Runtime Base Image**: `mcr.microsoft.com/openjdk/jdk:17-ubuntu`

The `storefront-backend` is a Spring Boot REST API that serves as the enterprise backend for the storefront-ts application. It includes a TypeScript type-check gate in the Dockerfile that enforces strict TypeScript compilation before the Java image is built.

---

## Prerequisites

### Local Development
- Docker Desktop 24.x or later
- Docker Compose v2.x or later
- Java 17 (for local builds without Docker)
- Maven 3.9.x (for local builds without Docker)
- Node.js 20.x (for TypeScript type-check gate)

### AWS Deployment
- AWS CLI v2 configured with appropriate credentials (`aws configure`)
- IAM permissions for: ECS, ECR, CloudWatch Logs, IAM, ELBv2, VPC
- An existing AWS VPC with at least 2 subnets in different Availability Zones
- Security group allowing inbound TCP on port 8080 (and port 80 if using ALB)

---

## Project Structure

```
JAVATSGIT/
├── Dockerfile                    # Multi-stage build (TS gate + Java build + runtime)
├── docker-compose.yml            # Local development compose file
├── .dockerignore                 # Excludes build artifacts and TS sources
├── pom.xml                       # Maven build descriptor
├── tsconfig.json                 # TypeScript compiler configuration
├── ts-frontend/                  # TypeScript frontend sources (type-checked only)
├── src/
│   └── main/
│       ├── java/com/trianz/storefront/
│       │   ├── StorefrontBackendApplication.java
│       │   ├── controller/HealthController.java
│       │   └── service/HealthService.java
│       └── resources/
│           └── application.properties
├── scripts/
│   ├── build-push.sh             # Linux/macOS: build and push to ECR or Docker Hub
│   ├── build-push.bat            # Windows: build and push to ECR or Docker Hub
│   ├── deploy-image.sh           # Linux/macOS: deploy to AWS ECS Fargate
│   └── deploy-image.bat          # Windows: deploy to AWS ECS Fargate
├── ecs/
│   ├── task-definition.json      # ECS Fargate task definition
│   └── service-definition.json   # ECS Fargate service definition
└── docs/
    └── DEPLOYMENT.md             # This file
```

---

## Local Development with Docker Compose

### Start the application locally

```bash
# From the repository root
docker compose up --build
```

The application will be available at: `http://localhost:8080`

### Verify health

```bash
curl http://localhost:8080/api/health
# Expected: {"status":"ok"}
```

### Stop the application

```bash
docker compose down
```

### View logs

```bash
docker compose logs -f storefront-backend
```

### Environment variable overrides

Edit `docker-compose.yml` to customize:
- `JAVA_OPTS` – JVM heap and GC settings
- `SPRING_PROFILES_ACTIVE` – Spring profile (default: `docker`)
- `SERVER_PORT` – Application port (default: `8080`)

---

## Build and Push Docker Image

### Linux / macOS

```bash
chmod +x scripts/build-push.sh
./scripts/build-push.sh
```

### Windows

```cmd
scripts\build-push.bat
```

The script will prompt you to:
1. Select registry type: **1. AWS ECR** or **2. Docker Hub**
2. Enter registry credentials and details
3. Enter an image tag (defaults to `latest`)

The script automatically:
- Sanitizes the image name to lowercase with hyphens
- Creates the ECR repository if it doesn't exist (ECR only)
- Builds the Docker image from the repository root
- Pushes the image to the selected registry

### Manual build

```bash
# Build
docker build -t storefront-backend:latest .

# Tag for ECR
docker tag storefront-backend:latest \
  123456789012.dkr.ecr.us-east-1.amazonaws.com/storefront-backend:latest

# Push
docker push 123456789012.dkr.ecr.us-east-1.amazonaws.com/storefront-backend:latest
```

---

## AWS ECS Fargate Prerequisites

### 1. AWS CLI Configuration

```bash
aws configure
# Enter: AWS Access Key ID, Secret Access Key, Region, Output format
```

### 2. IAM Roles

Create the ECS task execution role (if it doesn't exist):

```bash
# Create execution role
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

# Attach managed policy
aws iam attach-role-policy \
  --role-name ecsTaskExecutionRole \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
```

Create the ECS task role (for application-level AWS API access):

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

### 3. VPC and Networking

Ensure you have:
- A VPC with DNS resolution enabled
- At least **2 public or private subnets** in different Availability Zones
- A security group with inbound rules:
  - TCP port **8080** from your application clients (or ALB security group)
  - TCP port **80** if using an Application Load Balancer

```bash
# List available VPCs
aws ec2 describe-vpcs --query "Vpcs[*].{ID:VpcId,CIDR:CidrBlock}" --output table

# List subnets
aws ec2 describe-subnets --query "Subnets[*].{ID:SubnetId,AZ:AvailabilityZone,CIDR:CidrBlock}" --output table
```

### 4. ECR Repository

```bash
# Create ECR repository
aws ecr create-repository --repository-name storefront-backend --region us-east-1

# Authenticate Docker to ECR
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin \
  123456789012.dkr.ecr.us-east-1.amazonaws.com
```

### 5. CloudWatch Log Group

```bash
aws logs create-log-group --log-group-name /ecs/storefront-backend --region us-east-1
```

---

## ECS Task Definition Explained

The task definition (`ecs/task-definition.json`) configures how the container runs on Fargate:

| Field | Value | Description |
|-------|-------|-------------|
| `family` | `storefront-backend-task` | Task definition family name |
| `requiresCompatibilities` | `["FARGATE"]` | Fargate launch type |
| `networkMode` | `awsvpc` | Required for Fargate; each task gets its own ENI |
| `cpu` | `"512"` | 0.5 vCPU |
| `memory` | `"1024"` | 1 GB RAM |
| `executionRoleArn` | `ecsTaskExecutionRole` | Allows ECS to pull images and write logs |
| `taskRoleArn` | `ecsTaskRole` | Grants the application AWS API permissions |

### Container Definition

| Field | Value | Description |
|-------|-------|-------------|
| `name` | `storefront-backend` | Container name |
| `image` | `{{IMAGE_URI}}` | Replaced by deploy script |
| `containerPort` | `8080` | Application port |
| `SPRING_PROFILES_ACTIVE` | `docker` | Spring Boot profile |
| `JAVA_OPTS` | JVM flags | Memory and GC tuning |
| `logDriver` | `awslogs` | CloudWatch Logs integration |

### Valid Fargate CPU/Memory Combinations

| CPU | Memory Options |
|-----|---------------|
| 256 (.25 vCPU) | 512, 1024, 2048 MB |
| **512 (.5 vCPU)** | **1024**, 2048, 3072, 4096 MB |
| 1024 (1 vCPU) | 2048–8192 MB |
| 2048 (2 vCPU) | 4096–16384 MB |
| 4096 (4 vCPU) | 8192–30720 MB |

---

## ECS Service Configuration

The service definition (`ecs/service-definition.json`) controls how tasks are scheduled:

| Field | Value | Description |
|-------|-------|-------------|
| `serviceName` | `storefront-backend-service` | ECS service name |
| `launchType` | `FARGATE` | Serverless compute |
| `desiredCount` | `2` | Number of running tasks |
| `maximumPercent` | `200` | Max tasks during rolling deploy |
| `minimumHealthyPercent` | `50` | Min healthy tasks during deploy |
| `assignPublicIp` | `ENABLED` | Required for public subnet tasks |

---

## ECS Fargate Deployment Walkthrough

### Step 1: Build and push the image

```bash
./scripts/build-push.sh
# Select AWS ECR, enter region and account details
```

### Step 2: Deploy to ECS Fargate

```bash
chmod +x scripts/deploy-image.sh
./scripts/deploy-image.sh
```

The deploy script will prompt for:
- AWS Region (e.g., `us-east-1`)
- ECS Cluster name (creates if not exists)
- VPC ID
- Subnet IDs (comma-separated)
- Security Group ID
- ECR Image URI
- Whether to create an Application Load Balancer

### Step 3: Verify deployment

```bash
# Check service status
aws ecs describe-services \
  --cluster storefront-backend-cluster \
  --services storefront-backend-service \
  --region us-east-1

# List running tasks
aws ecs list-tasks \
  --cluster storefront-backend-cluster \
  --service-name storefront-backend-service \
  --region us-east-1

# View logs
aws logs tail /ecs/storefront-backend --follow --region us-east-1
```

### Step 4: Test the application

```bash
# If using ALB
curl http://<ALB-DNS-NAME>/api/health

# If using direct task IP (find from describe-tasks)
curl http://<TASK-PUBLIC-IP>:8080/api/health
```

---

## ECS-Specific Troubleshooting

### Task fails to start

```bash
# Check stopped task reason
aws ecs describe-tasks \
  --cluster storefront-backend-cluster \
  --tasks <task-arn> \
  --region us-east-1 \
  --query "tasks[0].{Status:lastStatus,StopReason:stoppedReason,Containers:containers[*].{Name:name,Reason:reason,ExitCode:exitCode}}"
```

Common causes:
- **ImagePullBackOff**: ECR authentication failed or image URI incorrect
- **ResourceInitializationError**: Execution role missing ECR/CloudWatch permissions
- **OutOfMemoryError**: Increase `memory` in task definition (use valid Fargate combination)
- **Port conflict**: Ensure `containerPort` matches `server.port` in application.properties

### Network connectivity issues

```bash
# Verify security group allows port 8080
aws ec2 describe-security-groups \
  --group-ids <sg-id> \
  --query "SecurityGroups[0].IpPermissions"

# Check task ENI
aws ecs describe-tasks \
  --cluster storefront-backend-cluster \
  --tasks <task-arn> \
  --query "tasks[0].attachments"
```

### CloudWatch logs not appearing

- Verify `/ecs/storefront-backend` log group exists
- Confirm `ecsTaskExecutionRole` has `logs:CreateLogStream` and `logs:PutLogEvents` permissions
- Check `awslogs-region` matches the deployment region

### JVM memory issues

If tasks are killed with exit code 137 (OOM):
1. Increase task `memory` to `2048` and `cpu` to `1024`
2. Adjust `JAVA_OPTS`: `-Xmx1g -Xms512m`
3. Enable container-aware GC: `-XX:+UseContainerSupport -XX:MaxRAMPercentage=75.0`

---

## ECS Fargate Scaling and Management

### Manual scaling

```bash
aws ecs update-service \
  --cluster storefront-backend-cluster \
  --service storefront-backend-service \
  --desired-count 4 \
  --region us-east-1
```

### Auto Scaling

```bash
# Register scalable target
aws application-autoscaling register-scalable-target \
  --service-namespace ecs \
  --resource-id service/storefront-backend-cluster/storefront-backend-service \
  --scalable-dimension ecs:service:DesiredCount \
  --min-capacity 2 \
  --max-capacity 10

# Create CPU-based scaling policy
aws application-autoscaling put-scaling-policy \
  --service-namespace ecs \
  --resource-id service/storefront-backend-cluster/storefront-backend-service \
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

### Blue/Green Deployment with CodeDeploy

For zero-downtime deployments, configure CodeDeploy with ECS:
1. Create a CodeDeploy application with `ECS` compute platform
2. Create a deployment group linked to the ECS service
3. Use `appspec.yaml` to define the deployment lifecycle
4. Trigger deployments via CodePipeline or CLI

### Rolling Update (default)

The service definition uses rolling updates by default:
- `maximumPercent: 200` – Allows double the desired count during deployment
- `minimumHealthyPercent: 50` – Keeps at least half the tasks running

---

## Configuration Management

### Environment Variables

Override application settings via ECS task definition environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `SPRING_PROFILES_ACTIVE` | `docker` | Active Spring profile |
| `SERVER_PORT` | `8080` | Application port |
| `JAVA_OPTS` | JVM flags | JVM memory and GC settings |
| `TZ` | `UTC` | Container timezone |

### AWS Secrets Manager Integration

For sensitive configuration (database passwords, API keys):

```bash
# Store secret
aws secretsmanager create-secret \
  --name storefront-backend/db-password \
  --secret-string "your-password"
```

Add to task definition `secrets` array:
```json
"secrets": [
  {
    "name": "DB_PASSWORD",
    "valueFrom": "arn:aws:secretsmanager:us-east-1:123456789012:secret:storefront-backend/db-password"
  }
]
```

Grant the execution role access:
```bash
aws iam attach-role-policy \
  --role-name ecsTaskExecutionRole \
  --policy-arn arn:aws:iam::aws:policy/SecretsManagerReadWrite
```

---

## Security Considerations

1. **Non-root container user**: The Dockerfile creates and uses `appuser` (non-root)
2. **No sensitive data in images**: Use environment variables or Secrets Manager
3. **Minimal runtime image**: Uses `mcr.microsoft.com/openjdk/jdk:17-ubuntu` – no build tools
4. **No wrapper scripts in image**: `.dockerignore` excludes `mvnw`, `.mvn/`
5. **No TypeScript sources in image**: `.dockerignore` excludes `ts-frontend/`, `**/*.ts`
6. **Security groups**: Restrict inbound access to only required ports
7. **Private subnets**: Consider deploying tasks in private subnets with NAT Gateway
8. **ECR image scanning**: Enable ECR vulnerability scanning:
   ```bash
   aws ecr put-image-scanning-configuration \
     --repository-name storefront-backend \
     --image-scanning-configuration scanOnPush=true
   ```
9. **Task role least privilege**: Grant `ecsTaskRole` only the permissions the application needs
10. **VPC endpoints**: Use VPC endpoints for ECR and CloudWatch to avoid public internet traffic

---

## Java-Specific Notes

### JVM Tuning for Containers

The `JAVA_OPTS` environment variable is pre-configured with container-aware settings:

```
-Xmx512m                          # Maximum heap size
-Xms256m                          # Initial heap size
-XX:+UseContainerSupport          # Enable container CPU/memory awareness
-XX:MaxRAMPercentage=75.0         # Use 75% of container memory for heap
-XX:+UnlockExperimentalVMOptions  # Enable experimental JVM options
-Djava.security.egd=file:/dev/./urandom  # Faster random number generation
```

### Spring Boot Profile

The `docker` Spring profile is activated by default. Create `application-docker.properties` or `application-docker.yml` to override settings for containerized deployments.

### Startup Time

Spring Boot applications typically take 10–30 seconds to start. The ECS service health check grace period is set to 300 seconds when using a load balancer to accommodate JVM warm-up time.

### TypeScript Type-Check Gate

The Dockerfile includes a TypeScript type-check stage (Stage 1) that runs `tsc --noEmit` before the Java build. This enforces strict TypeScript compilation and prevents images with type errors from being built and deployed. The `buildspec-image-gate.yml` provides an additional CodeBuild gate that scans the pushed image for `.d.ts` files.

### Graceful Shutdown

Spring Boot 3.x supports graceful shutdown out of the box. ECS sends `SIGTERM` to containers before stopping them, allowing in-flight requests to complete. To enable:

```properties
# application.properties
server.shutdown=graceful
spring.lifecycle.timeout-per-shutdown-phase=30s
```

### Monitoring with CloudWatch

Application logs are streamed to CloudWatch Logs under `/ecs/storefront-backend`. To add custom metrics, consider integrating:
- **Micrometer** with CloudWatch registry
- **AWS X-Ray** for distributed tracing
- **Spring Boot Actuator** for JVM and application metrics
