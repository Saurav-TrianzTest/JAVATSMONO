// Fixed: Added io-ts codec-based validation for Multi-Container ECS Fargate Task with Validation Sidecar
// This ensures type safety at API boundaries and prevents pod crashes from malformed responses
// io-ts codecs enable validation sidecar containers to intercept and validate inbound traffic
import { getConfigValue } from './appconfig';
import { getEnvVar, validateEnv } from './env-config';
import * as t from 'io-ts';
import { isRight } from 'fp-ts/Either';
import { PathReporter } from 'io-ts/PathReporter';

// io-ts codec for API response validation
// Codecs are composable and can be shared between main app and validation sidecar
const ApiDataCodec = t.type({
  id: t.string,
  name: t.string,
  value: t.union([t.string, t.number]),
  timestamp: t.union([t.string, t.undefined]),
  metadata: t.union([t.record(t.string, t.unknown), t.undefined])
});

type ApiData = t.TypeOf<typeof ApiDataCodec>;

// API contract version codec for SSM Parameter Store
// Validation sidecar uses this to enforce contract versioning
const ApiContractCodec = t.type({
  version: t.string,
  schemaHash: t.string,
  endpoints: t.record(t.string, t.type({
    method: t.string,
    responseSchema: t.string
  }))
});

type ApiContract = t.TypeOf<typeof ApiContractCodec>;

// Cache for API contract from SSM Parameter Store
let cachedApiContract: ApiContract | null = null;

/**
 * Fetches API contract version from AWS SSM Parameter Store
 * This enables ECS Fargate tasks to detect API contract drift at startup
 * Validation sidecar container uses this to configure runtime validation rules
 */
async function fetchApiContract(): Promise<ApiContract | null> {
  if (cachedApiContract) {
    return cachedApiContract;
  }

  // Validate environment variables before accessing them
  validateEnv();
  
  // Type-safe access to validated environment variables
  const ssmParameterName = getEnvVar('SSM_API_CONTRACT_PARAMETER');
  const awsRegion = getEnvVar('AWS_REGION');
  
  try {
    // In a real implementation, this would use AWS SDK to fetch from SSM
    // For containerized environments, AWS SDK will use IAM role credentials
    const ssmEndpoint = getEnvVar('SSM_ENDPOINT') || `https://ssm.${awsRegion}.amazonaws.com`;
    
    // Fetch API contract from SSM Parameter Store
    // Note: In production, use AWS SDK for Node.js (@aws-sdk/client-ssm)
    const response = await fetch(`${ssmEndpoint}/parameters${ssmParameterName}`, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      console.warn(`Failed to fetch API contract from SSM: ${response.status}`);
      return null;
    }

    const data = await response.json();
    
    // Validate using io-ts codec
    const validationResult = ApiContractCodec.decode(data);
    
    if (isRight(validationResult)) {
      cachedApiContract = validationResult.right;
      console.log(`API contract version ${cachedApiContract.version} loaded from SSM Parameter Store`);
      return cachedApiContract;
    } else {
      const errors = PathReporter.report(validationResult);
      console.error('API contract validation failed:', errors);
      return null;
    }
  } catch (error) {
    console.error('Failed to fetch or validate API contract from SSM:', error);
    // Allow application to continue with runtime validation only
    return null;
  }
}

/**
 * Validates API contract version at startup
 * ECS Fargate tasks will exit gracefully if contract drift is detected
 * Validation sidecar container enforces this check before allowing traffic
 */
export async function validateApiContractAtStartup(): Promise<boolean> {
  const contract = await fetchApiContract();
  
  if (!contract) {
    console.warn('API contract validation skipped - SSM parameter not available');
    return true; // Allow startup but rely on runtime validation
  }

  const expectedVersion = getEnvVar('API_CONTRACT_VERSION');
  
  if (contract.version !== expectedVersion) {
    console.error(
      `API contract version mismatch! Expected: ${expectedVersion}, Got: ${contract.version}`
    );
    console.error('ECS Fargate task will exit to prevent processing bad data');
    return false; // Signal to exit gracefully
  }

  console.log(`API contract version ${contract.version} validated successfully`);
  return true;
}

/**
 * Loads data from API with proper type validation using io-ts codecs
 * Prevents pod crashes from malformed responses in Kubernetes/ECS
 * Validation sidecar intercepts this traffic and validates before forwarding
 */
export async function load(): Promise<ApiData> {
  // Fetch API URL from AWS AppConfig at runtime instead of using build-time constant
  const apiUrl = await getConfigValue<string>('apiUrl', getEnvVar('API_URL'));
  
  try {
    const res = await fetch(`${apiUrl}/data`);
    
    if (!res.ok) {
      throw new Error(`API request failed with status ${res.status}`);
    }
    
    const rawData = await res.json();
    
    // Runtime codec validation with io-ts - prevents invalid data from crashing the container
    // Validation sidecar performs this same validation on inbound traffic
    const validationResult = ApiDataCodec.decode(rawData);
    
    if (isRight(validationResult)) {
      return validationResult.right;
    } else {
      const errors = PathReporter.report(validationResult);
      console.error('API response validation failed:', errors);
      throw new Error(`Invalid API response schema: ${errors.join(', ')}`);
    }
  } catch (error) {
    throw error;
  }
}

// User profile codec with validation
// Validation sidecar uses this codec to validate user input before forwarding to main app
const UserProfileCodec = t.type({
  id: t.string,
  name: t.string,
  email: t.union([t.string, t.undefined]),
  role: t.union([t.string, t.undefined])
});

type UserProfile = t.TypeOf<typeof UserProfileCodec>;

/**
 * Handles user input with proper validation using io-ts codecs
 * Prevents crashes from malformed JSON input
 * Validation sidecar intercepts user input and validates using this codec
 */
export function handleInput(raw: string): UserProfile {
  try {
    const parsed = JSON.parse(raw);
    
    // Validate using io-ts codec - suitable for validation sidecar pattern
    const validationResult = UserProfileCodec.decode(parsed);
    
    if (isRight(validationResult)) {
      return validationResult.right;
    } else {
      const errors = PathReporter.report(validationResult);
      console.error('User input validation failed:', errors);
      throw new Error(`Invalid user profile data: ${errors.join(', ')}`);
    }
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('Failed to parse user input JSON');
    }
    throw error;
  }
}

/**
 * Export codecs for use by validation sidecar container
 * Sidecar can import these codecs to perform validation before forwarding traffic
 */
export const codecs = {
  ApiDataCodec,
  ApiContractCodec,
  UserProfileCodec
};
