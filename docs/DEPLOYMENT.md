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

This guide covers building, pushing, and deploying the `storefront-backend` Spring Boot application as a containerized service on AWS ECS Fargate.

---

## Prerequisites

### Local Development
- Docker Desktop 24.x or later
- Docker Compose v2.x or later
- Java 17 (for local builds outside Docker)
- Maven 3.9.x (for local builds outside Docker)
- Node.js 20.x (for TypeScript frontend builds)

### AWS Deployment
- AWS CLI v2 configured with appropriate credentials (`aws configure`)
- IAM permissions for: ECS, ECR, CloudWatch Logs, IAM, ELBv2, VPC
- An existing AWS VPC with at least 2 subnets in different Availability Zones
- Security group allowing inbound TCP on port 8080 (and port 80 if using ALB)

---

## Project Structure

```
JAVATSMONO/
├── Dockerfile                    # Multi-stage build (TS typecheck + Java build + runtime)
├── docker-compose.yml            # Local development compose file
├── .dockerignore                 # Docker build context exclusions
├── pom.xml                       # Maven build descriptor
├── src/
│   └── main/
│       ├── java/com/trianz/storefront/
│       │   ├── StorefrontBackendApplication.java
│       │   ├── controller/HealthController.java
│       │   └── service/HealthService.java
│       └── resources/
│           └── application.properties
├── ts-frontend/                  # TypeScript frontend sources
│   ├── package.json
│   ├── tsconfig.json
│   └── *.ts / *.tsx
├── ecs/
│   ├── task-definition.json      # ECS Fargate task definition
│   └── service-definition.json   # ECS Fargate service definition
├── scripts/
│   ├── build-push.sh             # Linux/macOS: build & push to ECR or Docker Hub
│   ├── build-push.bat            # Windows: build & push to ECR or Docker Hub
│   ├── deploy-image.sh           # Linux/macOS: deploy to ECS Fargate
│   └── deploy-image.bat          # Windows: deploy to ECS Fargate
└── docs/
    └── DEPLOYMENT.md             # This file
```

---

## Local Development with Docker Compose

### Start the application locally

```bash
# Build and start
docker compose up --build

# Start in background
docker compose up --build -d

# View logs
docker compose logs -f storefront-backend

# Stop
docker compose down
```

### Access the application

- **Application**: http://localhost:8080
- **Health Check**: http://localhost:8080/api/health

### Environment Variables (docker-compose.yml)

| Variable | Default | Description |
|---|---|---|
| `JAVA_OPTS` | `-Xmx512m -Xms256m ...` | JVM memory and tuning flags |
| `SPRING_PROFILES_ACTIVE` | `docker` | Active Spring profile |
| `SPRING_APPLICATION_NAME` | `storefront-backend` | Application name |
| `SERVER_PORT` | `8080` | HTTP server port |
| `TZ` | `UTC` | Container timezone |

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

### What the script does

1. Sanitizes the image name to lowercase with hyphens
2. Prompts for an image tag (defaults to `latest`)
3. Prompts for registry type: **AWS ECR** or **Docker Hub**
4. For ECR: authenticates, auto-creates the repository if needed, builds and pushes
5. For Docker Hub: authenticates, builds and pushes

### Manual build (ECR example)

```bash
# Authenticate to ECR
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin \
  123456789.dkr.ecr.us-east-1.amazonaws.com

# Build
docker build -t 123456789.dkr.ecr.us-east-1.amazonaws.com/storefront-backend:latest .

# Push
docker push 123456789.dkr.ecr.us-east-1.amazonaws.com/storefront-backend:latest
```

---

## AWS ECS Fargate Prerequisites

### 1. AWS CLI Configuration

```bash
aws configure
# Enter: AWS Access Key ID, Secret Access Key, Region, Output format
```

### 2. IAM Roles

#### ECS Task Execution Role (`ecsTaskExecutionRole`)
Required for ECS to pull images from ECR and write logs to CloudWatch.

```bash
# Create the role (if it doesn't exist)
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

#### ECS Task Role (`ecsTaskRole`)
Optional role for the application container to access AWS services (S3, DynamoDB, etc.).

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
- A **security group** with inbound rules:
  - TCP port `8080` from your ALB security group (or `0.0.0.0/0` for testing)
  - TCP port `80` if using an ALB

```bash
# List your VPCs
aws ec2 describe-vpcs --query "Vpcs[*].{ID:VpcId,CIDR:CidrBlock}" --output table

# List subnets
aws ec2 describe-subnets --query "Subnets[*].{ID:SubnetId,AZ:AvailabilityZone,CIDR:CidrBlock}" --output table
```

### 4. CloudWatch Log Group

```bash
aws logs create-log-group --log-group-name /ecs/storefront-backend --region us-east-1
```

---

## ECS Task Definition Explained

File: `ecs/task-definition.json`

| Field | Value | Description |
|---|---|---|
| `family` | `storefront-backend-task` | Task definition family name |
| `requiresCompatibilities` | `["FARGATE"]` | Fargate launch type |
| `networkMode` | `awsvpc` | Required for Fargate |
| `cpu` | `"512"` | 0.5 vCPU |
| `memory` | `"1024"` | 1 GB RAM |
| `executionRoleArn` | `ecsTaskExecutionRole` | Allows ECR pull + CloudWatch logs |
| `taskRoleArn` | `ecsTaskRole` | Application AWS permissions |

### Valid Fargate CPU/Memory Combinations

| CPU | Memory Options |
|---|---|
| 256 (.25 vCPU) | 512, 1024, 2048 MB |
| **512 (.5 vCPU)** | **1024**, 2048, 3072, 4096 MB |
| 1024 (1 vCPU) | 2048–8192 MB |
| 2048 (2 vCPU) | 4096–16384 MB |
| 4096 (4 vCPU) | 8192–30720 MB |

### Container Definition

- **Port**: 8080 (TCP)
- **Log Driver**: `awslogs` → CloudWatch log group `/ecs/storefront-backend`
- **Environment Variables**: Spring profile, JVM options, timezone

---

## ECS Service Configuration

File: `ecs/service-definition.json`

| Field | Value | Description |
|---|---|---|
| `serviceName` | `storefront-backend-service` | ECS service name |
| `launchType` | `FARGATE` | Serverless container compute |
| `desiredCount` | `2` | Number of running tasks |
| `networkMode` | `awsvpc` | Each task gets its own ENI |
| `assignPublicIp` | `ENABLED` | Required for public subnet access |
| `maximumPercent` | `200` | Allow 2x tasks during rolling deploy |
| `minimumHealthyPercent` | `50` | Keep at least 1 task running |

---

## ECS Fargate Deployment Walkthrough

### Step 1: Build and push the image

```bash
./scripts/build-push.sh
# Select ECR, enter your region and account details
# Note the full image URI output (e.g. 123456789.dkr.ecr.us-east-1.amazonaws.com/storefront-backend:latest)
```

### Step 2: Run the deploy script

```bash
chmod +x scripts/deploy-image.sh
./scripts/deploy-image.sh
```

The script will prompt for:
- AWS Region
- ECS Cluster name
- ECR Image URI
- VPC ID
- Subnet IDs (comma-separated)
- Security Group ID
- Whether to create an Application Load Balancer

### Step 3: Verify the deployment

```bash
# Check service status
aws ecs describe-services \
  --cluster storefront-backend-cluster \
  --services storefront-backend-service \
  --region us-east-1

# List running tasks
aws ecs list-tasks \
  --cluster storefront-backend-cluster \
  --region us-east-1

# View application logs
aws logs tail /ecs/storefront-backend --follow --region us-east-1
```

### Step 4: Test the health endpoint

```bash
# If using ALB
curl http://<ALB_DNS_NAME>/api/health

# If using public IP (find task IP from ECS console or CLI)
curl http://<TASK_PUBLIC_IP>:8080/api/health
```

Expected response:
```json
{"status": "ok"}
```

---

## ECS-Specific Troubleshooting

### Task fails to start

```bash
# Check stopped task reason
aws ecs describe-tasks \
  --cluster storefront-backend-cluster \
  --tasks <TASK_ARN> \
  --region us-east-1 \
  --query "tasks[0].{Status:lastStatus,StopReason:stoppedReason,Containers:containers[*].{Name:name,Reason:reason,ExitCode:exitCode}}"
```

Common causes:
- **Image pull failure**: Check ECR permissions on `ecsTaskExecutionRole`
- **OOM killed**: Increase `memory` in task definition (use valid Fargate combination)
- **Port conflict**: Ensure `containerPort` matches `SERVER_PORT` env var
- **Missing IAM role**: Ensure `ecsTaskExecutionRole` exists and has correct policies

### CloudWatch logs not appearing

```bash
# Verify log group exists
aws logs describe-log-groups --log-group-name-prefix /ecs/storefront-backend

# Check execution role has CloudWatch permissions
aws iam get-role-policy --role-name ecsTaskExecutionRole --policy-name CloudWatchLogsPolicy
```

### Service stuck in PENDING

```bash
# Check service events
aws ecs describe-services \
  --cluster storefront-backend-cluster \
  --services storefront-backend-service \
  --query "services[0].events[0:5]"
```

Common causes:
- Subnets don't have internet access (need NAT Gateway or public subnet with `assignPublicIp: ENABLED`)
- Security group blocks outbound traffic (ECR requires HTTPS outbound on port 443)
- Invalid CPU/memory combination

### Invalid CPU/memory error

Ensure you use valid Fargate combinations. The default in this project is:
- `cpu: "512"` + `memory: "1024"` ✅

### Network connectivity issues

```bash
# Verify security group allows inbound on port 8080
aws ec2 describe-security-groups \
  --group-ids <SECURITY_GROUP_ID> \
  --query "SecurityGroups[0].IpPermissions"
```

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

For zero-downtime deployments, configure AWS CodeDeploy with ECS:

1. Create a CodeDeploy application and deployment group for ECS
2. Configure two target groups (blue and green) on your ALB
3. Update the ECS service to use `CODE_DEPLOY` deployment controller
4. Use `aws deploy create-deployment` to trigger blue/green deployments

### Rolling Update (default)

The current configuration uses rolling updates:
- `maximumPercent: 200` – allows double the tasks during deployment
- `minimumHealthyPercent: 50` – keeps at least 1 task running

---

## Configuration Management

### Environment Variables

Override application settings via ECS task definition environment variables:

```json
{
  "name": "SERVER_PORT",
  "value": "8080"
},
{
  "name": "SPRING_PROFILES_ACTIVE",
  "value": "production"
}
```

### AWS Secrets Manager Integration

For sensitive values (database passwords, API keys):

```bash
# Store a secret
aws secretsmanager create-secret \
  --name storefront-backend/db-password \
  --secret-string "your-password"
```

Reference in task definition:
```json
{
  "secrets": [{
    "name": "DB_PASSWORD",
    "valueFrom": "arn:aws:secretsmanager:us-east-1:123456789:secret:storefront-backend/db-password"
  }]
}
```

Add `secretsmanager:GetSecretValue` permission to `ecsTaskExecutionRole`.

### Spring Profiles

The application uses `SPRING_PROFILES_ACTIVE=docker` in containers. Create profile-specific configuration:

```
src/main/resources/
├── application.properties          # Base configuration
├── application-docker.properties   # Docker/ECS overrides
└── application-local.properties    # Local development
```

---

## Security Considerations

1. **Non-root user**: The Dockerfile creates and uses `appuser` (non-root) for the runtime process.
2. **No secrets in images**: Use AWS Secrets Manager or SSM Parameter Store for sensitive values.
3. **Minimal runtime image**: Uses `eclipse-temurin:17-jdk` – consider switching to `eclipse-temurin:17-jre-alpine` for a smaller attack surface in production.
4. **Network isolation**: Use private subnets with a NAT Gateway for production workloads; only expose the ALB publicly.
5. **Security group least privilege**: Restrict inbound rules to only the ALB security group.
6. **ECR image scanning**: Enable ECR image scanning on push:
   ```bash
   aws ecr put-image-scanning-configuration \
     --repository-name storefront-backend \
     --image-scanning-configuration scanOnPush=true
   ```
7. **IAM least privilege**: Scope `ecsTaskRole` permissions to only the AWS services the application needs.
8. **TLS termination**: Terminate TLS at the ALB (HTTPS listener with ACM certificate); the container communicates over HTTP internally.

---

## Java-Specific Notes

### JVM Container Awareness

The Dockerfile sets:
```
JAVA_OPTS=-Xmx512m -Xms256m -XX:+UseContainerSupport -XX:MaxRAMPercentage=75.0
```

- `-XX:+UseContainerSupport`: Enables JVM to respect container memory limits (Java 10+, backported to Java 8u191+)
- `-XX:MaxRAMPercentage=75.0`: JVM uses up to 75% of container memory for heap
- `-Xmx512m -Xms256m`: Explicit heap bounds for the 1024 MB Fargate task

### Spring Boot Actuator (Optional Enhancement)

Add Spring Boot Actuator for production-grade health and metrics:

```xml
<!-- pom.xml -->
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-actuator</artifactId>
</dependency>
```

```properties
# application.properties
management.endpoints.web.exposure.include=health,info,metrics
management.endpoint.health.show-details=always
```

This adds `/actuator/health`, `/actuator/info`, and `/actuator/metrics` endpoints.

### TypeScript Frontend Build Gates

The Dockerfile includes two build gates for the TypeScript frontend:

1. **cz-ts-1011 (Type-Check Gate)**: Runs `tsc --noEmit --strict` – fails the build if any weakly-typed React Context is detected.
2. **cz-ts-1003 (.d.ts Gate)**: Scans the compiled `dist/` for `.d.ts` files – fails the build if any declaration files would be included in the runtime image.

These gates ensure only type-safe, minimal frontend assets reach the production container.

### Graceful Shutdown

The `ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -jar app.jar"]` pattern ensures:
- The JVM receives `SIGTERM` from Docker/ECS for graceful shutdown
- Spring Boot's default 30-second graceful shutdown period applies
- In-flight requests complete before the container stops

### Logging

Configure structured JSON logging for better CloudWatch Insights queries:

```xml
<!-- pom.xml -->
<dependency>
    <groupId>net.logstash.logback</groupId>
    <artifactId>logstash-logback-encoder</artifactId>
    <version>7.4</version>
</dependency>
```

```xml
<!-- src/main/resources/logback-spring.xml -->
<configuration>
  <springProfile name="docker">
    <appender name="STDOUT" class="ch.qos.logback.core.ConsoleAppender">
      <encoder class="net.logstash.logback.encoder.LogstashEncoder"/>
    </appender>
    <root level="INFO"><appender-ref ref="STDOUT"/></root>
  </springProfile>
</configuration>
```
