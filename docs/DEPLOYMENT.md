# Storefront Backend - Deployment Guide

## Table of Contents
1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Local Development Setup](#local-development-setup)
4. [Docker Deployment](#docker-deployment)
5. [AWS ECS Fargate Deployment](#aws-ecs-fargate-deployment)
6. [Configuration Management](#configuration-management)
7. [Monitoring and Logging](#monitoring-and-logging)
8. [Troubleshooting](#troubleshooting)
9. [Security Considerations](#security-considerations)

---

## Overview

This guide provides comprehensive instructions for deploying the **Storefront Backend** application, a Spring Boot 3.2.5 application running on Java 17. The application is containerized using Docker and can be deployed to AWS ECS Fargate for production workloads.

### Technology Stack
- **Framework**: Spring Boot 3.2.5
- **Java Version**: 17
- **Build Tool**: Maven 3.9.4
- **Package Type**: JAR
- **Application Port**: 8080
- **Health Endpoint**: `/actuator/health`
- **Base Image**: mcr.microsoft.com/openjdk/jdk:17-ubuntu

---

## Prerequisites

### Required Tools
- **Docker**: Version 20.10 or higher
- **Docker Compose**: Version 2.0 or higher
- **AWS CLI**: Version 2.x (for ECS deployment)
- **Java 17**: For local development
- **Maven 3.9+**: For building the application

### AWS Prerequisites (for ECS Fargate)
- AWS Account with appropriate permissions
- AWS CLI configured with credentials (`aws configure`)
- VPC with at least 2 subnets in different availability zones
- Security group allowing inbound traffic on port 8080
- IAM roles:
  - `ecsTaskExecutionRole`: For ECS to pull images and write logs
  - `ecsTaskRole`: For application to access AWS services (optional)

### Verify Prerequisites
```bash
# Check Docker
docker --version
docker-compose --version

# Check AWS CLI
aws --version
aws sts get-caller-identity

# Check Java and Maven
java -version
mvn -version
```

---

## Local Development Setup

### 1. Clone the Repository
```bash
git clone <repository-url>
cd JAVATSMONO
```

### 2. Build the Application Locally
```bash
# Build with Maven
mvn clean package -DskipTests

# Run the application
java -jar target/storefront-backend-1.0.0.jar
```

### 3. Access the Application
- **Application**: http://localhost:8080
- **Health Check**: http://localhost:8080/actuator/health
- **API Health**: http://localhost:8080/api/health

### 4. Run with Docker Compose
```bash
# Build and start the application
docker-compose up --build

# Run in detached mode
docker-compose up -d

# View logs
docker-compose logs -f

# Stop the application
docker-compose down
```

---

## Docker Deployment

### Build Docker Image

#### Using Build Script (Recommended)

**Linux/macOS:**
```bash
cd scripts
chmod +x build-push.sh
./build-push.sh
```

**Windows:**
```cmd
cd scripts
build-push.bat
```

The script will:
1. Prompt for image tag (default: latest)
2. Ask for registry selection (AWS ECR or Docker Hub)
3. Collect registry credentials
4. Build the Docker image
5. Push to the selected registry

#### Manual Build
```bash
# Build image
docker build -t storefront-backend:latest .

# Tag for registry
docker tag storefront-backend:latest <registry>/storefront-backend:latest

# Push to registry
docker push <registry>/storefront-backend:latest
```

### Docker Image Details
- **Multi-stage build**: Separate builder and runtime stages
- **Builder stage**: maven:3.9.4-eclipse-temurin-17
- **Runtime stage**: mcr.microsoft.com/openjdk/jdk:17-ubuntu
- **Non-root user**: Runs as user `spring` (UID 1001)
- **JVM Options**: Optimized for containerized environments
- **Size**: Approximately 300-400 MB

---

## AWS ECS Fargate Deployment

### Architecture Overview
```
Internet → ALB → ECS Service → ECS Tasks (Fargate) → CloudWatch Logs
                     ↓
                Target Group
                     ↓
              Health Checks
```

### Step 1: Prepare AWS Environment

#### Create VPC and Subnets (if not exists)
```bash
# Create VPC
aws ec2 create-vpc --cidr-block 10.0.0.0/16 --region us-east-1

# Create subnets in different AZs
aws ec2 create-subnet --vpc-id <vpc-id> --cidr-block 10.0.1.0/24 --availability-zone us-east-1a
aws ec2 create-subnet --vpc-id <vpc-id> --cidr-block 10.0.2.0/24 --availability-zone us-east-1b
```

#### Create Security Group
```bash
# Create security group
aws ec2 create-security-group \
  --group-name storefront-backend-sg \
  --description "Security group for Storefront Backend" \
  --vpc-id <vpc-id>

# Allow inbound traffic on port 8080
aws ec2 authorize-security-group-ingress \
  --group-id <sg-id> \
  --protocol tcp \
  --port 8080 \
  --cidr 0.0.0.0/0

# Allow inbound traffic on port 80 (for ALB)
aws ec2 authorize-security-group-ingress \
  --group-id <sg-id> \
  --protocol tcp \
  --port 80 \
  --cidr 0.0.0.0/0
```

#### Create IAM Roles

**ECS Task Execution Role:**
```bash
# Create trust policy
cat > trust-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "ecs-tasks.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF

# Create role
aws iam create-role \
  --role-name ecsTaskExecutionRole \
  --assume-role-policy-document file://trust-policy.json

# Attach managed policy
aws iam attach-role-policy \
  --role-name ecsTaskExecutionRole \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
```

### Step 2: Build and Push Docker Image

```bash
# Navigate to scripts directory
cd scripts

# Run build and push script
./build-push.sh

# Select AWS ECR when prompted
# Enter your AWS region
# Enter repository name: storefront-backend
```

### Step 3: Deploy to ECS Fargate

#### Using Deployment Script (Recommended)

**Linux/macOS:**
```bash
cd scripts
chmod +x deploy-image.sh
./deploy-image.sh
```

**Windows:**
```cmd
cd scripts
deploy-image.bat
```

The script will:
1. Prompt for AWS region
2. Prompt for ECS cluster name (creates if doesn't exist)
3. Collect network configuration (VPC, subnets, security group)
4. Ask if you need a load balancer
5. Create ALB and Target Group (if requested)
6. Register task definition
7. Create or update ECS service
8. Wait for service to stabilize
9. Display access information

#### Manual Deployment

**1. Create ECS Cluster:**
```bash
aws ecs create-cluster --cluster-name storefront-cluster --region us-east-1
```

**2. Create CloudWatch Log Group:**
```bash
aws logs create-log-group --log-group-name /ecs/storefront-backend --region us-east-1
```

**3. Register Task Definition:**
```bash
# Update placeholders in ecs/task-definition.json
# Then register:
aws ecs register-task-definition \
  --cli-input-json file://ecs/task-definition.json \
  --region us-east-1
```

**4. Create ECS Service:**
```bash
# Update placeholders in ecs/service-definition.json
# Then create:
aws ecs create-service \
  --cli-input-json file://ecs/service-definition.json \
  --region us-east-1
```

### Step 4: Verify Deployment

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

# View task details
aws ecs describe-tasks \
  --cluster storefront-cluster \
  --tasks <task-id> \
  --region us-east-1
```

### Step 5: Access the Application

If you created a load balancer:
```bash
# Get ALB DNS name
aws elbv2 describe-load-balancers \
  --names storefront-backend-alb \
  --query 'LoadBalancers[0].DNSName' \
  --output text

# Access application
curl http://<alb-dns-name>/actuator/health
```

---

## ECS Task Definition Explained

### CPU and Memory Configuration
The task definition uses Fargate-compatible CPU and memory values:
- **CPU**: 512 (.5 vCPU)
- **Memory**: 1024 MB (1 GB)

**Valid Fargate CPU/Memory Combinations:**
| CPU (vCPU) | Memory (MB) |
|------------|-------------|
| 256 (.25)  | 512, 1024, 2048 |
| 512 (.5)   | 1024, 2048, 3072, 4096 |
| 1024 (1)   | 2048-8192 (increments of 1024) |
| 2048 (2)   | 4096-16384 (increments of 1024) |
| 4096 (4)   | 8192-30720 (increments of 1024) |

### Container Definition
```json
{
  "name": "storefront-backend",
  "image": "{{IMAGE_URI}}",
  "essential": true,
  "portMappings": [
    {
      "containerPort": 8080,
      "protocol": "tcp"
    }
  ],
  "environment": [
    {
      "name": "SPRING_PROFILES_ACTIVE",
      "value": "production"
    },
    {
      "name": "JAVA_OPTS",
      "value": "-Xmx512m -Xms256m -XX:+UseContainerSupport -XX:MaxRAMPercentage=75.0"
    }
  ]
}
```

### Logging Configuration
Logs are sent to CloudWatch Logs:
- **Log Group**: `/ecs/storefront-backend`
- **Stream Prefix**: `ecs`
- **Region**: Configured during deployment

---

## ECS Service Configuration

### Launch Type
- **Type**: FARGATE
- **Platform Version**: LATEST

### Network Configuration
- **Network Mode**: awsvpc (required for Fargate)
- **Subnets**: At least 2 in different AZs
- **Security Groups**: Allow inbound on port 8080
- **Public IP**: ENABLED (for internet access)

### Deployment Configuration
- **Desired Count**: 2 (for high availability)
- **Maximum Percent**: 200 (allows rolling updates)
- **Minimum Healthy Percent**: 50 (ensures availability during updates)
- **Circuit Breaker**: Enabled with automatic rollback

### Load Balancer (Optional)
- **Type**: Application Load Balancer (ALB)
- **Target Type**: IP (required for Fargate)
- **Health Check Path**: `/actuator/health`
- **Health Check Interval**: 30 seconds
- **Healthy Threshold**: 2
- **Unhealthy Threshold**: 3

---

## Configuration Management

### Environment Variables

The application supports the following environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `SPRING_PROFILES_ACTIVE` | Active Spring profile | `production` |
| `JAVA_OPTS` | JVM options | `-Xmx512m -Xms256m` |
| `SERVER_PORT` | Application port | `8080` |
| `DATABASE_URL` | Database connection URL | - |
| `DATABASE_USERNAME` | Database username | - |
| `DATABASE_PASSWORD` | Database password | - |

### Spring Profiles

**Available Profiles:**
- `default`: Local development
- `docker`: Docker container environment
- `production`: Production environment

**Activate Profile:**
```bash
# Via environment variable
export SPRING_PROFILES_ACTIVE=production

# Via JVM argument
java -jar -Dspring.profiles.active=production app.jar
```

### External Configuration

**Using AWS Systems Manager Parameter Store:**
```bash
# Store configuration
aws ssm put-parameter \
  --name /storefront/database-url \
  --value "jdbc:postgresql://..." \
  --type SecureString

# Reference in task definition
{
  "secrets": [
    {
      "name": "DATABASE_URL",
      "valueFrom": "arn:aws:ssm:region:account:parameter/storefront/database-url"
    }
  ]
}
```

**Using AWS Secrets Manager:**
```bash
# Store secret
aws secretsmanager create-secret \
  --name storefront/db-password \
  --secret-string "your-password"

# Reference in task definition
{
  "secrets": [
    {
      "name": "DATABASE_PASSWORD",
      "valueFrom": "arn:aws:secretsmanager:region:account:secret:storefront/db-password"
    }
  ]
}
```

---

## Monitoring and Logging

### CloudWatch Logs

**View Logs:**
```bash
# Via AWS CLI
aws logs tail /ecs/storefront-backend --follow --region us-east-1

# Via AWS Console
https://console.aws.amazon.com/cloudwatch/home?region=us-east-1#logsV2:log-groups/log-group//ecs/storefront-backend
```

**Log Retention:**
```bash
# Set retention period (e.g., 7 days)
aws logs put-retention-policy \
  --log-group-name /ecs/storefront-backend \
  --retention-in-days 7 \
  --region us-east-1
```

### CloudWatch Metrics

**Key Metrics to Monitor:**
- `CPUUtilization`: CPU usage percentage
- `MemoryUtilization`: Memory usage percentage
- `TargetResponseTime`: Response time from targets
- `HealthyHostCount`: Number of healthy targets
- `UnHealthyHostCount`: Number of unhealthy targets

**Create CloudWatch Dashboard:**
```bash
aws cloudwatch put-dashboard \
  --dashboard-name storefront-backend \
  --dashboard-body file://dashboard.json
```

### Application Health Checks

**Spring Boot Actuator Endpoints:**
- `/actuator/health`: Overall health status
- `/actuator/info`: Application information
- `/actuator/metrics`: Application metrics

**Custom Health Check:**
```bash
# Check application health
curl http://<alb-dns>/actuator/health

# Expected response
{
  "status": "UP"
}
```

### Alarms

**Create CPU Alarm:**
```bash
aws cloudwatch put-metric-alarm \
  --alarm-name storefront-backend-high-cpu \
  --alarm-description "Alert when CPU exceeds 80%" \
  --metric-name CPUUtilization \
  --namespace AWS/ECS \
  --statistic Average \
  --period 300 \
  --threshold 80 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 2
```

---

## Troubleshooting

### Common Issues

#### 1. Task Fails to Start

**Symptoms:**
- Tasks transition to STOPPED state immediately
- Error: "CannotPullContainerError"

**Solutions:**
```bash
# Check task stopped reason
aws ecs describe-tasks \
  --cluster storefront-cluster \
  --tasks <task-id> \
  --query 'tasks[0].stoppedReason'

# Verify ECR permissions
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <account-id>.dkr.ecr.us-east-1.amazonaws.com

# Check execution role permissions
aws iam get-role --role-name ecsTaskExecutionRole
```

#### 2. Health Check Failures

**Symptoms:**
- Tasks are marked as unhealthy
- Service keeps replacing tasks

**Solutions:**
```bash
# Check application logs
aws logs tail /ecs/storefront-backend --follow

# Verify health endpoint
curl http://<task-ip>:8080/actuator/health

# Increase health check grace period
aws ecs update-service \
  --cluster storefront-cluster \
  --service storefront-backend-service \
  --health-check-grace-period-seconds 300
```

#### 3. Network Connectivity Issues

**Symptoms:**
- Cannot access application
- Timeout errors

**Solutions:**
```bash
# Check security group rules
aws ec2 describe-security-groups --group-ids <sg-id>

# Verify subnet routing
aws ec2 describe-route-tables --filters "Name=association.subnet-id,Values=<subnet-id>"

# Check NAT Gateway (if using private subnets)
aws ec2 describe-nat-gateways --filter "Name=subnet-id,Values=<subnet-id>"
```

#### 4. Out of Memory Errors

**Symptoms:**
- Tasks crash with OOMKilled
- Java heap space errors

**Solutions:**
```bash
# Increase task memory
# Update task definition with higher memory value

# Adjust JVM heap size
# Update JAVA_OPTS environment variable:
-Xmx768m -Xms384m

# Monitor memory usage
aws cloudwatch get-metric-statistics \
  --namespace AWS/ECS \
  --metric-name MemoryUtilization \
  --dimensions Name=ServiceName,Value=storefront-backend-service \
  --start-time 2024-01-01T00:00:00Z \
  --end-time 2024-01-01T23:59:59Z \
  --period 3600 \
  --statistics Average
```

#### 5. Invalid CPU/Memory Combination

**Symptoms:**
- Error: "Invalid CPU or memory value specified"

**Solution:**
Use valid Fargate combinations (see table above). Common fix:
```json
{
  "cpu": "512",
  "memory": "1024"
}
```

### Debug Commands

```bash
# Get service events
aws ecs describe-services \
  --cluster storefront-cluster \
  --services storefront-backend-service \
  --query 'services[0].events[0:10]'

# Get task details
aws ecs describe-tasks \
  --cluster storefront-cluster \
  --tasks <task-id>

# Check container logs
aws logs get-log-events \
  --log-group-name /ecs/storefront-backend \
  --log-stream-name ecs/<task-id>/storefront-backend

# Test connectivity from within VPC
aws ec2 run-instances \
  --image-id ami-xxxxx \
  --instance-type t2.micro \
  --subnet-id <subnet-id> \
  --security-group-ids <sg-id>
# SSH into instance and test:
curl http://<task-ip>:8080/actuator/health
```

---

## Security Considerations

### Container Security

1. **Non-root User**: Application runs as user `spring` (UID 1001)
2. **Minimal Base Image**: Uses official OpenJDK image
3. **No Unnecessary Tools**: Runtime image doesn't include curl, wget, etc.
4. **Read-only Filesystem**: Consider using read-only root filesystem

### Network Security

1. **Security Groups**: Restrict inbound traffic to necessary ports only
2. **Private Subnets**: Use private subnets with NAT Gateway for production
3. **VPC Endpoints**: Use VPC endpoints for AWS services (ECR, CloudWatch, etc.)

### Secrets Management

1. **Never hardcode secrets** in Dockerfile or task definition
2. **Use AWS Secrets Manager** or Systems Manager Parameter Store
3. **Rotate secrets regularly**
4. **Use IAM roles** for AWS service access

### IAM Best Practices

1. **Principle of Least Privilege**: Grant only necessary permissions
2. **Separate Roles**: Use different roles for task execution and task runtime
3. **Enable CloudTrail**: Audit all API calls

### Example Secure Task Definition

```json
{
  "family": "storefront-backend-task",
  "executionRoleArn": "arn:aws:iam::account:role/ecsTaskExecutionRole",
  "taskRoleArn": "arn:aws:iam::account:role/storefrontTaskRole",
  "containerDefinitions": [
    {
      "name": "storefront-backend",
      "image": "account.dkr.ecr.region.amazonaws.com/storefront-backend:latest",
      "secrets": [
        {
          "name": "DATABASE_PASSWORD",
          "valueFrom": "arn:aws:secretsmanager:region:account:secret:db-password"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/storefront-backend",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "ecs"
        }
      }
    }
  ]
}
```

---

## Scaling and Performance

### Auto Scaling

**Configure Service Auto Scaling:**
```bash
# Register scalable target
aws application-autoscaling register-scalable-target \
  --service-namespace ecs \
  --resource-id service/storefront-cluster/storefront-backend-service \
  --scalable-dimension ecs:service:DesiredCount \
  --min-capacity 2 \
  --max-capacity 10

# Create scaling policy (CPU-based)
aws application-autoscaling put-scaling-policy \
  --service-namespace ecs \
  --resource-id service/storefront-cluster/storefront-backend-service \
  --scalable-dimension ecs:service:DesiredCount \
  --policy-name cpu-scaling-policy \
  --policy-type TargetTrackingScaling \
  --target-tracking-scaling-policy-configuration file://scaling-policy.json
```

**scaling-policy.json:**
```json
{
  "TargetValue": 70.0,
  "PredefinedMetricSpecification": {
    "PredefinedMetricType": "ECSServiceAverageCPUUtilization"
  },
  "ScaleInCooldown": 300,
  "ScaleOutCooldown": 60
}
```

### JVM Performance Tuning

**Recommended JVM Options:**
```bash
JAVA_OPTS="-Xmx512m -Xms256m \
  -XX:+UseContainerSupport \
  -XX:MaxRAMPercentage=75.0 \
  -XX:+UseG1GC \
  -XX:MaxGCPauseMillis=200 \
  -XX:+ParallelRefProcEnabled \
  -XX:+UnlockExperimentalVMOptions \
  -XX:+UseCGroupMemoryLimitForHeap"
```

### Spring Boot Optimizations

**application.properties:**
```properties
# Connection pooling
spring.datasource.hikari.maximum-pool-size=10
spring.datasource.hikari.minimum-idle=5

# Tomcat tuning
server.tomcat.threads.max=200
server.tomcat.threads.min-spare=10
server.tomcat.accept-count=100

# Actuator optimization
management.endpoints.web.exposure.include=health,info
management.endpoint.health.show-details=when-authorized
```

---

## Blue/Green Deployments

### Using AWS CodeDeploy

1. **Create CodeDeploy Application:**
```bash
aws deploy create-application \
  --application-name storefront-backend \
  --compute-platform ECS
```

2. **Create Deployment Group:**
```bash
aws deploy create-deployment-group \
  --application-name storefront-backend \
  --deployment-group-name storefront-backend-dg \
  --service-role-arn arn:aws:iam::account:role/CodeDeployServiceRole \
  --ecs-services clusterName=storefront-cluster,serviceName=storefront-backend-service \
  --load-balancer-info targetGroupInfoList=[{name=storefront-backend-tg}] \
  --blue-green-deployment-configuration file://blue-green-config.json
```

3. **Deploy New Version:**
```bash
aws deploy create-deployment \
  --application-name storefront-backend \
  --deployment-group-name storefront-backend-dg \
  --revision revisionType=AppSpecContent,appSpecContent={content=file://appspec.yaml}
```

---

## Additional Resources

### Documentation
- [Spring Boot Documentation](https://docs.spring.io/spring-boot/docs/current/reference/html/)
- [AWS ECS Documentation](https://docs.aws.amazon.com/ecs/)
- [Docker Documentation](https://docs.docker.com/)

### Support
- GitHub Issues: <repository-url>/issues
- AWS Support: https://console.aws.amazon.com/support/

### Useful Commands

```bash
# Quick health check
curl http://<endpoint>/actuator/health

# View recent logs
aws logs tail /ecs/storefront-backend --since 1h

# Scale service
aws ecs update-service \
  --cluster storefront-cluster \
  --service storefront-backend-service \
  --desired-count 4

# Force new deployment
aws ecs update-service \
  --cluster storefront-cluster \
  --service storefront-backend-service \
  --force-new-deployment
```

---

## Conclusion

This deployment guide provides comprehensive instructions for deploying the Storefront Backend application to AWS ECS Fargate. Follow the steps carefully, and refer to the troubleshooting section if you encounter any issues.

For production deployments, ensure you:
- Use private subnets with NAT Gateway
- Enable auto-scaling
- Set up monitoring and alarms
- Implement proper secrets management
- Follow security best practices
- Configure backup and disaster recovery

Happy deploying! 🚀
