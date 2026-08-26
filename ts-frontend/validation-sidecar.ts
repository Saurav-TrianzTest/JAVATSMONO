// Validation Sidecar Container for ECS Fargate Multi-Container Task
// This sidecar intercepts and validates all inbound traffic using io-ts codecs
// before forwarding to the main application container

import * as t from 'io-ts';
import { isRight } from 'fp-ts/Either';
import { PathReporter } from 'io-ts/PathReporter';
import { codecs } from './api';

/**
 * Validation Sidecar Configuration
 * 
 * ECS Fargate Task Definition should include:
 * 1. Main application container (port 3000)
 * 2. Validation sidecar container (port 8080)
 * 
 * Traffic flow:
 * External → ALB → Validation Sidecar (8080) → Main App (3000)
 * 
 * Environment Variables Required:
 * - MAIN_APP_HOST: localhost (containers share network namespace)
 * - MAIN_APP_PORT: 3000
 * - SIDECAR_PORT: 8080
 * - VALIDATION_MODE: strict|permissive
 * - LOG_LEVEL: debug|info|warn|error
 */

interface ValidationSidecarConfig {
  mainAppHost: string;
  mainAppPort: number;
  sidecarPort: number;
  validationMode: 'strict' | 'permissive';
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

/**
 * Load configuration from environment variables
 */
function loadConfig(): ValidationSidecarConfig {
  return {
    mainAppHost: process.env.MAIN_APP_HOST || 'localhost',
    mainAppPort: parseInt(process.env.MAIN_APP_PORT || '3000', 10),
    sidecarPort: parseInt(process.env.SIDECAR_PORT || '8080', 10),
    validationMode: (process.env.VALIDATION_MODE as 'strict' | 'permissive') || 'strict',
    logLevel: (process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error') || 'info'
  };
}

/**
 * Validates request body using io-ts codec
 */
function validateRequestBody(body: unknown, codec: t.Type<any>): { valid: boolean; data?: any; errors?: string[] } {
  const validationResult = codec.decode(body);
  
  if (isRight(validationResult)) {
    return { valid: true, data: validationResult.right };
  } else {
    const errors = PathReporter.report(validationResult);
    return { valid: false, errors };
  }
}

/**
 * Route-specific codec mapping
 * Maps API endpoints to their corresponding io-ts codecs
 */
const routeCodecMap: Record<string, t.Type<any>> = {
  '/api/data': codecs.ApiDataCodec,
  '/api/user': codecs.UserProfileCodec,
  '/api/contract': codecs.ApiContractCodec
};

/**
 * Validation middleware for sidecar
 * Intercepts requests, validates using io-ts, and forwards to main app
 */
async function validateAndForward(
  request: {
    method: string;
    path: string;
    headers: Record<string, string>;
    body?: unknown;
  },
  config: ValidationSidecarConfig
): Promise<{ status: number; body: any; headers: Record<string, string> }> {
  
  const codec = routeCodecMap[request.path];
  
  // If no codec defined for this route, forward without validation (permissive mode)
  if (!codec && config.validationMode === 'permissive') {
    console.log(`[SIDECAR] No codec for ${request.path}, forwarding without validation`);
    return forwardToMainApp(request, config);
  }
  
  // Strict mode: reject requests without defined codecs
  if (!codec && config.validationMode === 'strict') {
    console.error(`[SIDECAR] No codec defined for ${request.path}, rejecting request`);
    return {
      status: 400,
      body: { error: 'No validation codec defined for this endpoint' },
      headers: { 'Content-Type': 'application/json' }
    };
  }
  
  // Validate request body if present
  if (request.body && codec) {
    const validation = validateRequestBody(request.body, codec);
    
    if (!validation.valid) {
      console.error(`[SIDECAR] Validation failed for ${request.path}:`, validation.errors);
      return {
        status: 400,
        body: { 
          error: 'Request validation failed',
          details: validation.errors 
        },
        headers: { 'Content-Type': 'application/json' }
      };
    }
    
    console.log(`[SIDECAR] Validation passed for ${request.path}`);
  }
  
  // Forward validated request to main application
  return forwardToMainApp(request, config);
}

/**
 * Forwards validated request to main application container
 */
async function forwardToMainApp(
  request: {
    method: string;
    path: string;
    headers: Record<string, string>;
    body?: unknown;
  },
  config: ValidationSidecarConfig
): Promise<{ status: number; body: any; headers: Record<string, string> }> {
  
  const mainAppUrl = `http://${config.mainAppHost}:${config.mainAppPort}${request.path}`;
  
  try {
    const response = await fetch(mainAppUrl, {
      method: request.method,
      headers: request.headers,
      body: request.body ? JSON.stringify(request.body) : undefined
    });
    
    const responseBody = await response.json();
    const responseHeaders: Record<string, string> = {};
    
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });
    
    // Validate response if codec exists
    const codec = routeCodecMap[request.path];
    if (codec && config.validationMode === 'strict') {
      const validation = validateRequestBody(responseBody, codec);
      
      if (!validation.valid) {
        console.error(`[SIDECAR] Response validation failed for ${request.path}:`, validation.errors);
        return {
          status: 502,
          body: { 
            error: 'Response validation failed',
            details: validation.errors 
          },
          headers: { 'Content-Type': 'application/json' }
        };
      }
    }
    
    return {
      status: response.status,
      body: responseBody,
      headers: responseHeaders
    };
  } catch (error) {
    console.error(`[SIDECAR] Failed to forward request to main app:`, error);
    return {
      status: 502,
      body: { error: 'Failed to communicate with main application' },
      headers: { 'Content-Type': 'application/json' }
    };
  }
}

/**
 * Health check endpoint for validation sidecar
 * ECS uses this to determine container health
 */
function healthCheck(): { status: number; body: any } {
  return {
    status: 200,
    body: {
      status: 'healthy',
      service: 'validation-sidecar',
      timestamp: new Date().toISOString()
    }
  };
}

/**
 * Start validation sidecar server
 * This would typically use Express, Fastify, or similar framework
 */
export async function startValidationSidecar(): Promise<void> {
  const config = loadConfig();
  
  console.log('[SIDECAR] Starting validation sidecar container');
  console.log(`[SIDECAR] Listening on port ${config.sidecarPort}`);
  console.log(`[SIDECAR] Forwarding to ${config.mainAppHost}:${config.mainAppPort}`);
  console.log(`[SIDECAR] Validation mode: ${config.validationMode}`);
  
  // In production, implement actual HTTP server here
  // Example with Node.js http module or Express
  
  console.log('[SIDECAR] Validation sidecar ready');
}

// Export for use in ECS Fargate task
export { validateAndForward, healthCheck, loadConfig };
