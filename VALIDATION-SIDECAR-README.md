# Multi-Container ECS Fargate Task with Validation Sidecar

## Overview

This application implements a **Multi-Container ECS Fargate Task** with a **Validation Sidecar** pattern to ensure runtime type safety using **io-ts** codec-based validation. This architecture prevents type-confused data from reaching the main application container, ensuring containerized applications remain stable and secure.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    ECS Fargate Task                         │
│                                                             │
│  ┌──────────────────────┐      ┌──────────────────────┐   │
│  │  Validation Sidecar  │      │    Main Application  │   │
│  │    Container         │      │      Container       │   │
│  │                      │      │                      │   │
│  │  Port: 8080          │─────▶│  Port: 3000          │   │
│  │  io-ts validation    │      │  Business logic      │   │
│  │  Request/Response    │      │  API endpoints       │   │
│  │  validation          │      │                      │   │
│  └──────────────────────┘      └──────────────────────┘   │
│           ▲                                                 │
│           │                                                 │
└───────────┼─────────────────────────────────────────────────┘
            │
    ┌───────┴────────┐
    │  Application   │
    │  Load Balancer │
    └────────────────┘
```

## Traffic Flow

1. **External Request** → Application Load Balancer (ALB)
2. **ALB** → Validation Sidecar Container (Port 8080)
3. **Validation Sidecar** validates request using io-ts codecs
4. **If valid** → Forwards to Main Application Container (Port 3000)
5. **Main Application** processes request and returns response
6. **Validation Sidecar** validates response using io-ts codecs
7. **If valid** → Returns to ALB → Client

## Key Components

### 1. io-ts Codecs (`ts-frontend/api.ts`)

Runtime type validation using io-ts codecs:

```typescript
import * as t from 'io-ts';

const ApiDataCodec = t.type({
  id: t.string,
  name: t.string,
  value: t.union([t.string, t.number])
});

type ApiData = t.TypeOf<typeof ApiDataCodec>;
```

**Benefits:**
- Codec-based validation (composable, reusable)
- Runtime type safety complementing TypeScript compile-time checks
- Shared between main app and validation sidecar
- Prevents type-confused data from crashing containers

### 2. Validation Sidecar (`ts-frontend/validation-sidecar.ts`)

Intercepts and validates all inbound/outbound traffic:

```typescript
function validateRequestBody(body: unknown, codec: t.Type<any>) {
  const validationResult = codec.decode(body);
  
  if (isRight(validationResult)) {
    return { valid: true, data: validationResult.right };
  } else {
    const errors = PathReporter.report(validationResult);
    return { valid: false, errors };
  }
}
```

**Features:**
- Request validation before forwarding to main app
- Response validation before returning to client
- Configurable validation modes (strict/permissive)
- Health check endpoint for ECS

### 3. ECS Task Definition (`ecs-task-definition.json`)

Defines multi-container task with:
- **Validation Sidecar Container** (Port 8080)
- **Main Application Container** (Port 3000)
- Shared network namespace (localhost communication)
- Container dependencies (sidecar depends on main app being healthy)
- Health checks for both containers
- CloudWatch Logs integration

## Deployment

### Prerequisites

1. AWS CLI configured
2. Docker installed
3. ECR repositories created:
   - `storefront-validation-sidecar`
   - `storefront-main-app`

### Build and Push Containers

```bash
# Build validation sidecar
docker build -f Dockerfile.validation-sidecar -t storefront-validation-sidecar:latest .

# Tag and push to ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com
docker tag storefront-validation-sidecar:latest ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/storefront-validation-sidecar:latest
docker push ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/storefront-validation-sidecar:latest

# Build main application
docker build -t storefront-main-app:latest .
docker tag storefront-main-app:latest ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/storefront-main-app:latest
docker push ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/storefront-main-app:latest
```

### Register Task Definition

```bash
# Update ecs-task-definition.json with your ACCOUNT_ID and REGION
aws ecs register-task-definition --cli-input-json file://ecs-task-definition.json
```

### Create ECS Service

```bash
aws ecs create-service \
  --cluster storefront-cluster \
  --service-name storefront-service \
  --task-definition storefront-app-with-validation-sidecar \
  --desired-count 2 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-xxx,subnet-yyy],securityGroups=[sg-xxx],assignPublicIp=ENABLED}" \
  --load-balancers "targetGroupArn=arn:aws:elasticloadbalancing:REGION:ACCOUNT_ID:targetgroup/storefront-tg/xxx,containerName=validation-sidecar,containerPort=8080"
```

## Environment Variables

### Validation Sidecar

| Variable | Description | Default |
|----------|-------------|---------|
| `MAIN_APP_HOST` | Main app hostname | `localhost` |
| `MAIN_APP_PORT` | Main app port | `3000` |
| `SIDECAR_PORT` | Sidecar listening port | `8080` |
| `VALIDATION_MODE` | Validation strictness | `strict` |
| `LOG_LEVEL` | Logging level | `info` |

### Main Application

| Variable | Description | Required |
|----------|-------------|----------|
| `API_URL` | Backend API URL | Yes |
| `AWS_REGION` | AWS region | Yes |
| `SSM_API_CONTRACT_PARAMETER` | SSM parameter for API contract | Yes |
| `API_CONTRACT_VERSION` | Expected API contract version | Yes |
| `DB_PASSWORD` | Database password (from Secrets Manager) | Yes |

## Validation Modes

### Strict Mode (Recommended for Production)

- All requests must have defined io-ts codecs
- Requests without codecs are rejected (400 Bad Request)
- Response validation is enforced
- Maximum type safety

### Permissive Mode (Development/Testing)

- Requests without codecs are forwarded without validation
- Response validation is optional
- Useful for gradual migration

## Health Checks

### Validation Sidecar Health Check

```bash
curl http://localhost:8080/health
```

Response:
```json
{
  "status": "healthy",
  "service": "validation-sidecar",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

### Main Application Health Check

```bash
curl http://localhost:3000/api/health
```

Response:
```json
{
  "status": "UP"
}
```

## Monitoring

### CloudWatch Logs

- **Validation Sidecar**: `/ecs/storefront-validation-sidecar`
- **Main Application**: `/ecs/storefront-main-app`

### Key Metrics to Monitor

1. **Validation Failures**: Count of requests rejected by sidecar
2. **Response Time**: Latency added by validation layer
3. **Container Health**: ECS health check status
4. **Error Rate**: 4xx/5xx responses from sidecar

### CloudWatch Alarms

```bash
# Create alarm for validation failures
aws cloudwatch put-metric-alarm \
  --alarm-name storefront-validation-failures \
  --alarm-description "Alert on high validation failure rate" \
  --metric-name ValidationFailures \
  --namespace Storefront/ValidationSidecar \
  --statistic Sum \
  --period 300 \
  --threshold 100 \
  --comparison-operator GreaterThanThreshold
```

## Security Considerations

1. **Non-root User**: Both containers run as non-root user (UID 1001)
2. **Network Isolation**: Containers communicate via localhost only
3. **Secrets Management**: Sensitive data stored in AWS Secrets Manager
4. **IAM Roles**: Task role with least-privilege permissions
5. **Input Validation**: All user input validated before processing

## Troubleshooting

### Validation Sidecar Not Starting

Check logs:
```bash
aws logs tail /ecs/storefront-validation-sidecar --follow
```

Common issues:
- Missing environment variables
- Main app container not healthy
- Port conflicts

### Requests Being Rejected

Check validation errors in logs:
```bash
aws logs filter-pattern "Validation failed" /ecs/storefront-validation-sidecar
```

Verify codec definitions match expected data structure.

### High Latency

Validation adds ~5-10ms overhead. If higher:
- Check network configuration
- Verify container resources (CPU/memory)
- Review codec complexity

## Benefits of This Architecture

1. **Type Safety**: Runtime validation prevents type-confused data
2. **Container Stability**: Invalid data rejected before reaching main app
3. **Separation of Concerns**: Validation logic isolated in sidecar
4. **Reusability**: io-ts codecs shared across containers
5. **Observability**: Centralized validation logging and metrics
6. **Security**: Additional layer of input sanitization
7. **Scalability**: Sidecar scales with main application

## Migration from Zod

This implementation replaces Zod with io-ts for codec-based validation suitable for sidecar patterns:

**Before (Zod):**
```typescript
import { z } from 'zod';
const schema = z.object({ id: z.string() });
const data = schema.parse(input);
```

**After (io-ts):**
```typescript
import * as t from 'io-ts';
const codec = t.type({ id: t.string });
const result = codec.decode(input);
if (isRight(result)) { /* use result.right */ }
```

**Why io-ts?**
- Codec-based (composable, reusable)
- Better suited for sidecar validation patterns
- Functional programming approach with fp-ts
- Explicit error handling with Either type

## References

- [io-ts Documentation](https://github.com/gcanti/io-ts)
- [fp-ts Documentation](https://github.com/gcanti/fp-ts)
- [ECS Fargate Multi-Container Tasks](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definitions.html)
- [AWS Systems Manager Parameter Store](https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-parameter-store.html)
