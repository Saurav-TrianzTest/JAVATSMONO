# Health Check Endpoint Implementation

## Overview
This document describes the health check endpoints implemented for containerized deployment on ECS Fargate.

## Health Check Endpoints

### 1. Spring Boot Backend (Java)

#### Actuator Health Endpoint
- **URL**: `/actuator/health`
- **Method**: GET
- **Response**: 
  ```json
  {
    "status": "UP"
  }
  ```
- **Port**: 8080
- **Framework**: Spring Boot Actuator

#### Custom Health Endpoint
- **URL**: `/api/health`
- **Method**: GET
- **Response**:
  ```json
  {
    "status": "ok"
  }
  ```
- **Port**: 8080
- **Implementation**: Custom HealthController

#### Configuration
**File**: `src/main/resources/application.properties`
```properties
# Spring Boot Actuator Health Check Configuration
management.endpoints.web.exposure.include=health,info
management.endpoint.health.show-details=when-authorized
management.health.defaults.enabled=true
```

**Dependency**: `pom.xml`
```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-actuator</artifactId>
</dependency>
```

### 2. Validation Sidecar (TypeScript/Node.js)

#### Health Endpoint
- **URL**: `/health`
- **Method**: GET
- **Response**:
  ```json
  {
    "status": "healthy",
    "timestamp": "2024-01-XX...",
    "uptime": 12345,
    "checks": {
      "mainApp": "connected"
    }
  }
  ```
- **Port**: 8080
- **Implementation**: Express.js endpoint in validation-sidecar.ts

## Docker Health Checks

### Backend Dockerfile
**File**: `Dockerfile`
```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:8080/actuator/health || exit 1
```

### Validation Sidecar Dockerfile
**File**: `Dockerfile.validation-sidecar`
```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1
```

### Health Check Parameters
- **interval**: 30 seconds - Time between health checks
- **timeout**: 5 seconds - Maximum time to wait for response
- **start-period**: 60 seconds - Grace period for application startup
- **retries**: 3 - Number of consecutive failures before marking unhealthy

## ECS Fargate Health Checks

### Task Definition Configuration
**File**: `ecs-task-definition.json`

Both containers include health check configuration:

```json
{
  "healthCheck": {
    "command": [
      "CMD-SHELL",
      "curl -f http://localhost:8080/health || exit 1"
    ],
    "interval": 30,
    "timeout": 5,
    "retries": 3,
    "startPeriod": 60
  }
}
```

### Container Dependencies
The validation sidecar depends on the main app being healthy:
```json
{
  "dependsOn": [
    {
      "containerName": "main-app",
      "condition": "HEALTHY"
    }
  ]
}
```

## CI/CD Integration

### Backend Build Validation
**File**: `buildspec-backend.yml`

The CI/CD pipeline validates health checks before deployment:
```yaml
post_build:
  commands:
    - # Start container temporarily
    - CONTAINER_ID=$(docker run -d -p 8080:8080 $REPOSITORY_URI:$IMAGE_TAG)
    - sleep 30
    - # Test health check
    - HEALTH_STATUS=$(docker exec $CONTAINER_ID curl -s http://localhost:8080/actuator/health)
    - # Fail build if health check fails
```

### Validation Sidecar Build
**File**: `buildspec.yml`

Similar validation for the TypeScript sidecar container.

## Testing Health Checks

### Local Testing

#### Backend
```bash
# Build and run
docker build -t storefront-backend .
docker run -d -p 8080:8080 --name backend storefront-backend

# Test actuator endpoint
curl http://localhost:8080/actuator/health

# Test custom endpoint
curl http://localhost:8080/api/health

# Check Docker health status
docker ps
# Look for "healthy" in STATUS column

# Cleanup
docker stop backend && docker rm backend
```

#### Validation Sidecar
```bash
# Build and run
docker build -t validation-sidecar -f Dockerfile.validation-sidecar .
docker run -d -p 8080:8080 --name sidecar validation-sidecar

# Test health endpoint
curl http://localhost:8080/health

# Check Docker health status
docker ps

# Cleanup
docker stop sidecar && docker rm sidecar
```

### ECS Fargate Testing

After deployment to ECS:
```bash
# Get task ARN
TASK_ARN=$(aws ecs list-tasks --cluster your-cluster --service-name storefront-service --query 'taskArns[0]' --output text)

# Describe task to check health status
aws ecs describe-tasks --cluster your-cluster --tasks $TASK_ARN --query 'tasks[0].containers[*].[name,healthStatus]'

# Expected output:
# [
#   ["main-app", "HEALTHY"],
#   ["validation-sidecar", "HEALTHY"]
# ]
```

## Health Check Flow

### Startup Sequence
1. **Main App Container Starts**
   - Application initializes
   - Health check enters start-period (60s grace period)
   - After start-period, health checks begin every 30s
   - After 3 successful checks, marked as HEALTHY

2. **Validation Sidecar Starts**
   - Waits for main-app to be HEALTHY (dependency)
   - Sidecar initializes
   - Health check enters start-period
   - After start-period, health checks begin
   - After 3 successful checks, marked as HEALTHY

3. **Load Balancer Integration**
   - ALB/NLB only routes traffic to HEALTHY targets
   - Unhealthy containers are automatically replaced

### Failure Handling
- **Health Check Fails**: Container marked as UNHEALTHY after 3 consecutive failures
- **Container Unhealthy**: ECS stops the task and starts a new one
- **Deployment**: New tasks must pass health checks before old tasks are stopped

## Monitoring

### CloudWatch Metrics
- `HealthCheckSuccessful` - Number of successful health checks
- `HealthCheckFailed` - Number of failed health checks
- `TargetHealthyHostCount` - Number of healthy targets behind load balancer

### CloudWatch Logs
Health check failures are logged to:
- `/ecs/storefront-main-app`
- `/ecs/storefront-validation-sidecar`

### Alarms
Recommended CloudWatch alarms:
```yaml
HealthCheckFailureAlarm:
  Type: AWS::CloudWatch::Alarm
  Properties:
    AlarmName: storefront-health-check-failures
    MetricName: HealthCheckFailed
    Namespace: AWS/ECS
    Statistic: Sum
    Period: 300
    EvaluationPeriods: 2
    Threshold: 5
    ComparisonOperator: GreaterThanThreshold
```

## Best Practices

1. **Start Period**: Set long enough for application initialization
2. **Interval**: Balance between quick detection and resource usage
3. **Timeout**: Should be less than interval
4. **Retries**: 3 is standard, prevents false positives
5. **Endpoint**: Should be lightweight, not trigger heavy operations
6. **Dependencies**: Use container dependencies to ensure proper startup order

## Troubleshooting

### Health Check Always Failing
1. Check application logs for startup errors
2. Verify port mapping is correct
3. Ensure curl is installed in container
4. Test endpoint manually: `docker exec <container> curl localhost:8080/health`
5. Increase start-period if application takes longer to initialize

### Intermittent Failures
1. Check application resource usage (CPU/memory)
2. Review timeout setting - may need to increase
3. Check for network issues
4. Review application logs for errors during health check

### Container Keeps Restarting
1. Health check may be too aggressive
2. Application may have memory leak
3. Check CloudWatch logs for error patterns
4. Verify environment variables are correct

## Related Files

- `src/main/java/com/trianz/storefront/controller/HealthController.java`
- `src/main/java/com/trianz/storefront/service/HealthService.java`
- `src/main/resources/application.properties`
- `Dockerfile`
- `Dockerfile.validation-sidecar`
- `ecs-task-definition.json`
- `buildspec-backend.yml`
- `buildspec.yml`

---

**Implementation Status**: ✅ Complete
**Health Check Type**: Docker + ECS Native
**Framework**: Spring Boot Actuator + Custom Express.js
**Deployment Target**: AWS ECS Fargate
