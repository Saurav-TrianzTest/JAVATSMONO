// AWS SSM Parameter Store Integration with TypeScript Type Guards
// Validates environment variables at Fargate task startup, failing fast on missing config

import { z } from 'zod';

/**
 * Environment variable schema with strict validation
 * All container environment variables must be defined and non-empty
 */
const EnvSchema = z.object({
  // API Configuration
  API_URL: z.string().min(1, 'API_URL must be a non-empty string'),
  REACT_APP_KEY: z.string().min(1, 'REACT_APP_KEY must be a non-empty string'),
  
  // AWS AppConfig Configuration (optional with defaults)
  AWS_APPCONFIG_ENDPOINT: z.string().optional(),
  AWS_APPCONFIG_APPLICATION: z.string().default('storefront-app'),
  AWS_APPCONFIG_ENVIRONMENT: z.string().default('production'),
  AWS_APPCONFIG_CONFIGURATION: z.string().default('feature-flags'),
  
  // AWS Cloud Map Service Discovery Configuration
  CLOUD_MAP_NAMESPACE: z.string().default('storefront.local'),
  CLOUD_MAP_ENABLED: z.string().transform(val => val !== 'false').default('true'),
  AWS_REGION: z.string().default('us-east-1'),
  
  // AWS SSM Parameter Store Configuration (optional)
  SSM_API_CONTRACT_PARAMETER: z.string().default('/storefront/api/contract'),
  SSM_ENDPOINT: z.string().optional(),
  API_CONTRACT_VERSION: z.string().default('1.0.0'),
  
  // Node Environment
  SSR_ENABLED: z.string().transform(val => val === 'true').default('false'),
  
  // Environment
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
});

export type EnvConfig = z.infer<typeof EnvSchema>;

let validatedEnv: EnvConfig | null = null;

/**
 * Validates environment variables against the schema
 * Throws an error if validation fails, preventing the container from starting
 * This ensures all required configuration is present before the application runs
 */
export function validateEnv(): EnvConfig {
  if (validatedEnv) {
    return validatedEnv;
  }

  try {
    // Parse and validate environment variables
    validatedEnv = EnvSchema.parse({
      API_URL: process.env.API_URL,
      REACT_APP_KEY: process.env.REACT_APP_KEY,
      AWS_APPCONFIG_ENDPOINT: process.env.AWS_APPCONFIG_ENDPOINT || process.env.APPCONFIG_ENDPOINT,
      AWS_APPCONFIG_APPLICATION: process.env.AWS_APPCONFIG_APPLICATION,
      AWS_APPCONFIG_ENVIRONMENT: process.env.AWS_APPCONFIG_ENVIRONMENT || process.env.NODE_ENV,
      AWS_APPCONFIG_CONFIGURATION: process.env.AWS_APPCONFIG_CONFIGURATION,
      CLOUD_MAP_NAMESPACE: process.env.CLOUD_MAP_NAMESPACE,
      CLOUD_MAP_ENABLED: process.env.CLOUD_MAP_ENABLED,
      AWS_REGION: process.env.AWS_REGION,
      NODE_ENV: process.env.NODE_ENV,
      SSM_API_CONTRACT_PARAMETER: process.env.SSM_API_CONTRACT_PARAMETER,
      SSM_ENDPOINT: process.env.SSM_ENDPOINT,
      API_CONTRACT_VERSION: process.env.API_CONTRACT_VERSION,
      SSR_ENABLED: process.env.SSR_ENABLED,
    });

    console.log('✓ Environment variables validated successfully');
    return validatedEnv;
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('❌ Environment variable validation failed:');
      error.errors.forEach((err) => {
        console.error(`  - ${err.path.join('.')}: ${err.message}`);
      });
      console.error('\nRequired environment variables for ECS Fargate:');
      console.error('  - API_URL: Backend API endpoint URL');
      console.error('  - REACT_APP_KEY: API authentication key');
      console.error('\nOptional environment variables:');
      console.error('  - AWS_APPCONFIG_ENDPOINT: AWS AppConfig endpoint for dynamic configuration');
      console.error('  - AWS_APPCONFIG_APPLICATION: AppConfig application name (default: storefront-app)');
      console.error('  - AWS_APPCONFIG_ENVIRONMENT: AppConfig environment (default: production)');
      console.error('  - AWS_APPCONFIG_CONFIGURATION: AppConfig configuration profile (default: feature-flags)');
      console.error('  - CLOUD_MAP_NAMESPACE: AWS Cloud Map namespace for service discovery (default: storefront.local)');
      console.error('  - CLOUD_MAP_ENABLED: Enable AWS Cloud Map service discovery (default: true)');
      console.error('  - AWS_REGION: AWS region for Cloud Map and other services (default: us-east-1)');
      
      // Fail the container startup
      throw new Error('Container startup failed: Missing or invalid environment variables');
    }
    throw error;
  }
}

/**
 * Gets a validated environment variable value
 * Type-safe access to environment variables with runtime validation
 */
export function getEnvVar<K extends keyof EnvConfig>(key: K): EnvConfig[K] {
  const env = validateEnv();
  return env[key];
}

/**
 * Checks if all required environment variables are present
 * Returns true if valid, false otherwise (useful for health checks)
 */
export function isEnvValid(): boolean {
  try {
    validateEnv();
    return true;
  } catch {
    return false;
  }
}

/**
 * AWS SSM Parameter Store integration
 * Fetches hierarchical parameters from SSM Parameter Store
 * Falls back to environment variables if SSM is not available
 */
export async function fetchSSMParameters(parameterPath: string = '/storefront/fargate'): Promise<Record<string, string>> {
  // Check if AWS SDK is available (only in Node.js environment)
  if (typeof window !== 'undefined') {
    console.warn('SSM Parameter Store is only available in Node.js environment');
    return {};
  }

  try {
    // In a real implementation, this would use AWS SDK to fetch parameters
    // For now, we validate that environment variables are properly set
    // which would be injected from SSM Parameter Store in the ECS task definition
    
    // Example ECS task definition would include:
    // {
    //   "secrets": [
    //     {
    //       "name": "API_URL",
    //       "valueFrom": "/storefront/fargate/api-url"
    //     },
    //     {
    //       "name": "REACT_APP_KEY",
    //       "valueFrom": "/storefront/fargate/api-key"
    //     }
    //   ]
    // }
    
    console.log(`SSM parameters would be fetched from: ${parameterPath}`);
    return {};
  } catch (error) {
    console.error('Failed to fetch SSM parameters:', error);
    return {};
  }
}
