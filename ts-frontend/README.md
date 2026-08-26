# TypeScript Frontend - Containerization Ready

## Overview
This TypeScript frontend has been enhanced with containerization-ready API response validation to prevent pod crashes from malformed API responses in Kubernetes/ECS Fargate environments.

## Key Features

### 1. Zod Schema Validation
- **Runtime Type Safety**: All API responses are validated using Zod schemas at runtime
- **Prevents Container Crashes**: Invalid API responses are caught and handled gracefully
- **Type Inference**: TypeScript types are automatically inferred from Zod schemas

### 2. SSM Parameter Store API Contract Versioning
- **Contract Drift Detection**: ECS Fargate tasks validate API contract versions at startup
- **Graceful Exit**: Tasks exit cleanly if contract version mismatch is detected
- **Prevents Bad Data Processing**: Ensures containers don't process data with incompatible schemas

### 3. Environment Variables

#### Required for Runtime Configuration
- `API_URL`: Base URL for the API endpoint
- `AWS_APPCONFIG_ENDPOINT`: AWS AppConfig endpoint for dynamic configuration
- `AWS_APPCONFIG_APPLICATION`: AppConfig application name (default: 'storefront-app')
- `AWS_APPCONFIG_ENVIRONMENT`: AppConfig environment (default: NODE_ENV or 'production')
- `AWS_APPCONFIG_CONFIGURATION`: AppConfig configuration profile (default: 'feature-flags')

#### Required for API Contract Validation
- `SSM_API_CONTRACT_PARAMETER`: SSM Parameter Store path for API contract (default: '/storefront/api/contract')
- `API_CONTRACT_VERSION`: Expected API contract version (default: '1.0.0')
- `AWS_REGION`: AWS region for SSM Parameter Store (default: 'us-east-1')

#### Optional
- `SSM_ENDPOINT`: Custom SSM endpoint (for testing or VPC endpoints)

## Installation

```bash
cd ts-frontend
npm install
```

## Usage

### Validate API Contract at Startup
```typescript
import { validateApiContractAtStartup } from './api';

// In your application startup code (e.g., index.ts or main.ts)
const isValid = await validateApiContractAtStartup();
if (!isValid) {
  console.error('API contract validation failed - exiting');
  process.exit(1);
}
```

### Load Data with Validation
```typescript
import { load } from './api';

try {
  const data = await load();
  // data is fully typed and validated
  console.log(data.id, data.name, data.value);
} catch (error) {
  console.error('Failed to load data:', error);
  // Handle error gracefully - container stays healthy
}
```

### Handle User Input with Validation
```typescript
import { handleInput } from './api';

try {
  const userProfile = handleInput(rawJsonString);
  console.log(userProfile.id, userProfile.name);
} catch (error) {
  console.error('Invalid user input:', error);
  // Handle validation error
}
```

## Container Deployment

### Docker Environment Variables
```dockerfile
ENV API_URL=https://api.example.com
ENV AWS_APPCONFIG_ENDPOINT=https://appconfig.us-east-1.amazonaws.com
ENV SSM_API_CONTRACT_PARAMETER=/storefront/api/contract
ENV API_CONTRACT_VERSION=1.0.0
ENV AWS_REGION=us-east-1
```

### ECS Task Definition
```json
{
  "environment": [
    {"name": "API_URL", "value": "https://api.example.com"},
    {"name": "AWS_REGION", "value": "us-east-1"},
    {"name": "SSM_API_CONTRACT_PARAMETER", "value": "/storefront/api/contract"},
    {"name": "API_CONTRACT_VERSION", "value": "1.0.0"}
  ]
}
```

### Kubernetes Deployment
```yaml
env:
  - name: API_URL
    value: "https://api.example.com"
  - name: AWS_REGION
    value: "us-east-1"
  - name: SSM_API_CONTRACT_PARAMETER
    value: "/storefront/api/contract"
  - name: API_CONTRACT_VERSION
    value: "1.0.0"
```

## SSM Parameter Store Setup

### Create API Contract Parameter
```bash
aws ssm put-parameter \
  --name "/storefront/api/contract" \
  --type "String" \
  --value '{
    "version": "1.0.0",
    "schemaHash": "abc123",
    "endpoints": {
      "/data": {
        "method": "GET",
        "responseSchema": "ApiDataSchema"
      }
    }
  }' \
  --region us-east-1
```

### Update Contract Version
```bash
aws ssm put-parameter \
  --name "/storefront/api/contract" \
  --type "String" \
  --value '{"version": "1.1.0", ...}' \
  --overwrite \
  --region us-east-1
```

## Benefits for Containerization

1. **Prevents Pod Crashes**: Runtime validation catches malformed responses before they cause crashes
2. **Graceful Degradation**: Invalid data is handled with proper error messages
3. **Contract Versioning**: Detects API changes at startup, preventing incompatible deployments
4. **Type Safety**: Full TypeScript type inference from Zod schemas
5. **Observable**: Logs validation failures for monitoring and debugging
6. **Cloud-Native**: Integrates with AWS SSM Parameter Store and AppConfig

## Monitoring

Watch for these log messages:
- `API contract version X.X.X loaded from SSM Parameter Store` - Successful contract load
- `API contract version mismatch!` - Contract drift detected (task will exit)
- `API response validation failed` - Invalid API response caught
- `User input validation failed` - Invalid user input caught

## Dependencies

- **zod**: ^3.22.4 - Runtime schema validation
- **typescript**: ^5.3.0 - TypeScript compiler
- **@types/node**: ^20.0.0 - Node.js type definitions
