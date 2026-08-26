// Startup validation script for ECS Fargate tasks
// This script validates all environment variables before the application starts
// Ensures the container fails fast if required configuration is missing

import { validateEnv, fetchSSMParameters } from './env-config';
import { validateApiContractAtStartup } from './api';

/**
 * Main startup validation function
 * Called at container startup to validate all configuration
 * Exits with error code 1 if validation fails
 */
async function validateStartup(): Promise<void> {
  console.log('='.repeat(80));
  console.log('ECS Fargate Task Startup Validation');
  console.log('='.repeat(80));
  
  try {
    // Step 1: Validate environment variables with type guards
    console.log('\n[1/3] Validating environment variables...');
    validateEnv();
    console.log('✓ Environment variables validated successfully');
    
    // Step 2: Fetch SSM Parameter Store parameters (if configured)
    console.log('\n[2/3] Fetching AWS SSM Parameter Store parameters...');
    const ssmParams = await fetchSSMParameters();
    if (Object.keys(ssmParams).length > 0) {
      console.log(`✓ Fetched ${Object.keys(ssmParams).length} parameters from SSM`);
    } else {
      console.log('ℹ SSM Parameter Store not configured, using environment variables');
    }
    
    // Step 3: Validate API contract version
    console.log('\n[3/3] Validating API contract version...');
    const contractValid = await validateApiContractAtStartup();
    if (contractValid) {
      console.log('✓ API contract version validated successfully');
    } else {
      throw new Error('API contract version validation failed');
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('✓ Startup validation completed successfully');
    console.log('✓ ECS Fargate task is ready to accept traffic');
    console.log('='.repeat(80) + '\n');
    
  } catch (error) {
    console.error('\n' + '='.repeat(80));
    console.error('❌ Startup validation failed');
    console.error('='.repeat(80));
    console.error('\nError details:', error);
    console.error('\nECS Fargate task will exit with error code 1');
    console.error('Container orchestrator will restart the task with correct configuration');
    console.error('='.repeat(80) + '\n');
    
    // Exit with error code to signal container orchestrator
    process.exit(1);
  }
}

// Run startup validation if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  validateStartup().catch((error) => {
    console.error('Unexpected error during startup validation:', error);
    process.exit(1);
  });
}

export { validateStartup };
