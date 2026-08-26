# AWS Cloud Map Service Discovery with Typed URL Factory

## Overview

This implementation provides type-safe service URL configuration for ECS Fargate deployments using AWS Cloud Map service discovery. It eliminates hardcoded string URLs and provides compile-time validation of service endpoints.

## Problem Solved (cz-ts-1008)

**Issue**: Frontend TypeScript with untyped service URL configuration (using string literals) prevents compile-time validation of endpoint correctness.

**Solution**: Typed service URL factory with AWS Cloud Map integration that:
- Uses TypeScript enums for compile-time validation of service endpoints
- Constructs URLs dynamically from Cloud Map DNS service discovery
- Validates all URLs at runtime using Zod schemas
- Prevents incorrect URLs in container deployments

## Architecture

### Components

1. **ServiceEndpoint Enum** (`service-discovery.ts`)
   - Compile-time validated literal types for all service endpoints
   - Prevents typos and invalid service names
   - Example: `ServiceEndpoint.API`, `ServiceEndpoint.AUTH`

2. **TypedServiceUrlFactory Class** (`service-discovery.ts`)
   - Constructs type-safe service URLs from Cloud Map DNS
   - Caches validated service configurations
   - Provides fallback to environment variables

3. **Service URL Schema** (`service-discovery.ts`)
   - Zod schema for runtime validation of URL components
   - Ensures protocol, host, port, and path are valid

## Usage

### Basic Usage

```typescript
import { getTypedServiceUrl, ServiceEndpoint } from './service-discovery';

// Type-safe service URL construction with compile-time validation
const apiUrl = getTypedServiceUrl(ServiceEndpoint.API, '/api/v1/users');
// Result: https://api.storefront.local/api/v1/users

const authUrl = getTypedServiceUrl(ServiceEndpoint.AUTH, '/oauth/token');
// Result: https://auth.storefront.local/oauth/token
```

### Advanced Usage

```typescript
import { getServiceUrlFactory, ServiceEndpoint } from './service-discovery';

// Get the factory instance
const factory = getServiceUrlFactory();

// Get service configuration
const apiConfig = factory.getServiceUrl(ServiceEndpoint.API);
console.log(apiConfig.url.host); // api.storefront.local
console.log(apiConfig.url.protocol); // https

// Build custom URLs
const customUrl = factory.buildUrl(ServiceEndpoint.PAYMENT, '/checkout/process');
```

## AWS Cloud Map Integration

### ECS Fargate Service Discovery

In ECS Fargate, services are registered in AWS Cloud Map with DNS-based service discovery:

```
Service DNS Format: <service-name>.<namespace>
Example: api.storefront.local
```

### ECS Task Definition Example

```json
{
  "family": "storefront-frontend",
  "networkMode": "awsvpc",
  "serviceRegistries": [
    {
      "registryArn": "arn:aws:servicediscovery:us-east-1:123456789012:service/srv-xxxxx",
      "containerName": "frontend",
      "containerPort": 3000
    }
  ],
  "containerDefinitions": [
    {
      "name": "frontend",
      "image": "storefront-frontend:latest",
      "environment": [
        {
          "name": "CLOUD_MAP_NAMESPACE",
          "value": "storefront.local"
        },
        {
          "name": "CLOUD_MAP_ENABLED",
          "value": "true"
        },
        {
          "name": "AWS_REGION",
          "value": "us-east-1"
        }
      ]
    }
  ]
}
```

## Environment Variables

### Required Variables

- `API_URL`: Backend API endpoint URL (fallback when Cloud Map is disabled)
- `REACT_APP_KEY`: API authentication key

### Cloud Map Configuration (Optional)

- `CLOUD_MAP_NAMESPACE`: AWS Cloud Map namespace (default: `storefront.local`)
- `CLOUD_MAP_ENABLED`: Enable Cloud Map service discovery (default: `true`)
- `AWS_REGION`: AWS region for Cloud Map (default: `us-east-1`)

### Service-Specific Overrides (Optional)

Override protocol, port, or base path for specific services:

- `API_PROTOCOL`: Protocol for API service (default: `https`)
- `API_PORT`: Port for API service (default: none)
- `API_BASE_PATH`: Base path for API service (default: empty)

Example:
```bash
export API_PROTOCOL=http
export API_PORT=8080
export API_BASE_PATH=/v1
```

## Type Safety Benefits

### Compile-Time Validation

```typescript
// ✅ Valid - ServiceEndpoint enum provides compile-time validation
const url1 = getTypedServiceUrl(ServiceEndpoint.API, '/users');

// ❌ Compile error - 'INVALID' is not a valid ServiceEndpoint
const url2 = getTypedServiceUrl('INVALID', '/users');

// ❌ Compile error - Type checking prevents typos
const url3 = getTypedServiceUrl(ServiceEndpoint.AP, '/users');
```

### Runtime Validation

```typescript
// All URLs are validated at runtime using Zod schemas
const factory = getServiceUrlFactory();

// Invalid protocol throws validation error
process.env.API_PROTOCOL = 'ftp'; // ❌ Invalid
const url = factory.buildUrl(ServiceEndpoint.API); // Throws ZodError

// Invalid port throws validation error
process.env.API_PORT = '-1'; // ❌ Invalid
const url2 = factory.buildUrl(ServiceEndpoint.API); // Throws ZodError
```

## Migration Guide

### Before (Untyped String URLs)

```typescript
// ❌ No compile-time validation
// ❌ Typos not caught until runtime
// ❌ No type safety
const apiUrl = await getConfigValue<string>('apiUrl', getEnvVar('API_URL'));
const response = await fetch(apiUrl + '/users'); // String concatenation
```

### After (Typed Service URLs)

```typescript
// ✅ Compile-time validation with ServiceEndpoint enum
// ✅ Typos caught at compile time
// ✅ Full type safety
const apiUrl = getTypedServiceUrl(ServiceEndpoint.API, '/users');
const response = await fetch(apiUrl);
```

## Testing

### Unit Tests

```typescript
import { TypedServiceUrlFactory, ServiceEndpoint, resetServiceUrlFactory } from './service-discovery';

describe('TypedServiceUrlFactory', () => {
  beforeEach(() => {
    resetServiceUrlFactory();
  });

  it('should construct Cloud Map DNS URLs', () => {
    process.env.CLOUD_MAP_NAMESPACE = 'test.local';
    process.env.CLOUD_MAP_ENABLED = 'true';
    
    const factory = new TypedServiceUrlFactory();
    const url = factory.buildUrl(ServiceEndpoint.API, '/health');
    
    expect(url).toBe('https://api.test.local/health');
  });

  it('should fallback to environment variables', () => {
    process.env.CLOUD_MAP_ENABLED = 'false';
    process.env.API_URL = 'http://localhost:8080/api';
    
    const factory = new TypedServiceUrlFactory();
    const url = factory.buildUrl(ServiceEndpoint.API, '/users');
    
    expect(url).toBe('http://localhost:8080/api/users');
  });
});
```

## Deployment Checklist

- [ ] Configure AWS Cloud Map namespace in ECS cluster
- [ ] Register services in Cloud Map with DNS-based discovery
- [ ] Set `CLOUD_MAP_NAMESPACE` environment variable in ECS task definition
- [ ] Set `CLOUD_MAP_ENABLED=true` to enable service discovery
- [ ] Configure service-specific overrides if needed (protocol, port, base path)
- [ ] Verify service DNS resolution in ECS tasks
- [ ] Test service-to-service communication using typed URLs

## Benefits

1. **Type Safety**: Compile-time validation prevents typos and invalid service names
2. **Service Discovery**: Dynamic URL construction from Cloud Map eliminates hardcoded URLs
3. **Runtime Validation**: Zod schemas ensure all URLs are properly formatted
4. **Caching**: Service configurations are cached for performance
5. **Flexibility**: Fallback to environment variables when Cloud Map is not available
6. **Testability**: Easy to mock and test with dependency injection

## References

- [AWS Cloud Map Documentation](https://docs.aws.amazon.com/cloud-map/)
- [ECS Service Discovery](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-discovery.html)
- [TypeScript Enums](https://www.typescriptlang.org/docs/handbook/enums.html)
- [Zod Validation](https://zod.dev/)
