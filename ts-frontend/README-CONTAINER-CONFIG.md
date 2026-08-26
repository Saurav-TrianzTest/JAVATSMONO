# TypeScript Frontend - Container Environment Configuration

## Overview

This TypeScript frontend application has been enhanced with type-safe environment variable access and runtime validation for containerized deployments on AWS ECS Fargate. All environment variables are validated at startup using Zod schemas, ensuring the container fails fast if required configuration is missing.

## Environment Variables

### Required Variables

These environment variables **MUST** be set for the application to start:

- `API_URL` - Backend API endpoint URL (e.g., `https://api.example.com`)
- `REACT_APP_KEY` - API authentication key

### Optional Variables (with defaults)

- `AWS_APPCONFIG_ENDPOINT` - AWS AppConfig endpoint for dynamic configuration
- `AWS_APPCONFIG_APPLICATION` - AppConfig application name (default: `storefront-app`)
- `AWS_APPCONFIG_ENVIRONMENT` - AppConfig environment (default: `production`)
- `AWS_APPCONFIG_CONFIGURATION` - AppConfig configuration profile (default: `feature-flags`)
- `SSM_API_CONTRACT_PARAMETER` - SSM parameter path for API contract (default: `/storefront/api/contract`)
- `AWS_REGION` - AWS region (default: `us-east-1`)
- `SSM_ENDPOINT` - Custom SSM endpoint URL (optional)
- `API_CONTRACT_VERSION` - Expected API contract version (default: `1.0.0`)
- `SSR_ENABLED` - Enable server-side rendering (default: `false`)
- `NODE_ENV` - Node environment (default: `production`)

## AWS SSM Parameter Store Integration

The application supports hierarchical parameters from AWS SSM Parameter Store, which can be injected into ECS Fargate tasks using the `secrets` configuration in the task definition.

### Example ECS Task Definition

```json
{
  "family": "storefront-frontend",
  "taskRoleArn": "arn:aws:iam::123456789012:role/ecsTaskRole",
  "executionRoleArn": "arn:aws:iam::123456789012:role/ecsTaskExecutionRole",
  "containerDefinitions": [
    {
      "name": "frontend",
      "image": "storefront-frontend:latest",
      "secrets": [
        {
          "name": "API_URL",
          "valueFrom": "/storefront/fargate/api-url"
        },
        {
          "name": "REACT_APP_KEY",
          "valueFrom": "/storefront/fargate/api-key"
        }
      ],
      "environment": [
        {
          "name": "AWS_APPCONFIG_APPLICATION",
          "value": "storefront-app"
        },
        {
          "name": "AWS_APPCONFIG_ENVIRONMENT",
          "value": "production"
        },
        {
          "name": "NODE_ENV",
          "value": "production"
        }
      ]
    }
  ]
}
```

## Type-Safe Environment Variable Access

### Using `getEnvVar()`

All environment variable access should use the type-safe `getEnvVar()` function:

```typescript
import { getEnvVar } from './env-config';

// Type-safe access with automatic validation
const apiUrl = getEnvVar('API_URL');
const apiKey = getEnvVar('REACT_APP_KEY');
```

### Validating at Startup

The application automatically validates all environment variables at startup:

```typescript
import { validateEnv } from './env-config';

// Validate all environment variables
// Throws an error if validation fails
validateEnv();
```

### Checking Environment Validity

For health checks or conditional logic:

```typescript
import { isEnvValid } from './env-config';

if (isEnvValid()) {
  console.log('Environment is valid');
} else {
  console.error('Environment validation failed');
}
```

## Startup Validation

The application includes a comprehensive startup validation script that:

1. Validates all environment variables with type guards
2. Fetches AWS SSM Parameter Store parameters (if configured)
3. Validates API contract version

### Running Startup Validation

```bash
npm run validate-startup
```

This script will exit with code 1 if validation fails, causing the container to fail and restart.

## Container Deployment

### Dockerfile Example

```dockerfile
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm ci --production

# Copy application files
COPY . .

# Build TypeScript
RUN npm run build

# Validate environment at startup
CMD ["sh", "-c", "npm run validate-startup && node dist/index.js"]
```

### Health Check Endpoint

The Java backend includes a health check endpoint at `/api/health` that can be used for container health checks:

```yaml
healthCheck:
  command:
    - CMD-SHELL
    - curl -f http://localhost:8080/api/health || exit 1
  interval: 30s
  timeout: 5s
  retries: 3
  startPeriod: 40s
```

## Files Modified

### New Files

- `env-config.ts` - Type-safe environment variable configuration with Zod validation
- `startup-validation.ts` - Comprehensive startup validation script

### Modified Files

- `browser.ts` - Updated to use type-safe environment variable access
- `appconfig.ts` - Updated to use type-safe environment variable access
- `api.ts` - Updated to use type-safe environment variable access
- `angular-ssr.ts` - Updated to use type-safe environment variable access
- `package.json` - Added startup validation script

## Benefits

1. **Type Safety** - All environment variables are typed and validated at compile time
2. **Runtime Validation** - Environment variables are validated at startup, preventing runtime errors
3. **Fail Fast** - Container fails immediately if required configuration is missing
4. **AWS Integration** - Seamless integration with AWS SSM Parameter Store and AppConfig
5. **Documentation** - Clear error messages guide developers to fix configuration issues

## Troubleshooting

### Container Fails to Start

If the container fails to start with environment validation errors:

1. Check the container logs for detailed error messages
2. Verify all required environment variables are set in the ECS task definition
3. Ensure SSM Parameter Store parameters exist and the task role has permission to read them
4. Validate the parameter paths match the expected format

### Environment Variable Not Found

If you see "Environment variable validation failed" errors:

1. Check the `env-config.ts` file for the list of required variables
2. Verify the variable is set in your deployment configuration
3. For SSM parameters, ensure the task execution role has `ssm:GetParameter` permission

## References

- [AWS ECS Task Definition](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html)
- [AWS SSM Parameter Store](https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-parameter-store.html)
- [AWS AppConfig](https://docs.aws.amazon.com/appconfig/latest/userguide/what-is-appconfig.html)
- [Zod Schema Validation](https://zod.dev/)
