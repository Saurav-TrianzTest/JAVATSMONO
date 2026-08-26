// Browser API access and config with SSR guards for ECS Fargate deployment
// Fixed: Replaced untyped string URLs with typed service URL factory using AWS Cloud Map
// Security: Added Zod validation and removed type bypassing (as any, !) for container security
import { getEnvVar, validateEnv } from './env-config';
import { getTypedServiceUrl, ServiceEndpoint } from './service-discovery';
import { getConfigValue } from './appconfig';
import { z } from 'zod';

// Zod schema for DOM element validation
const DOMElementSchema = z.object({
  id: z.string().optional(),
  className: z.string().optional(),
  tagName: z.string(),
  textContent: z.string().nullable()
}).passthrough(); // Allow additional properties

// Zod schema for token validation
const TokenSchema = z.string().min(1, 'Token must be a non-empty string');

// Type-safe wrapper for DOM element
interface SafeDOMElement {
  id?: string;
  className?: string;
  tagName: string;
  textContent: string | null;
  [key: string]: any;
}

/**
 * Validates and sanitizes DOM element access
 * Prevents type bypassing security issues in containerized environments
 */
function validateDOMElement(element: Element | null): SafeDOMElement | null {
  if (!element) {
    return null;
  }

  try {
    // Extract safe properties from DOM element
    const safeElement = {
      id: element.id || undefined,
      className: element.className || undefined,
      tagName: element.tagName,
      textContent: element.textContent
    };

    // Validate with Zod schema
    return DOMElementSchema.parse(safeElement);
  } catch (error) {
    console.error('DOM element validation failed:', error);
    return null;
  }
}

/**
 * Validates and sanitizes token value
 * Prevents null/undefined bypass with proper runtime validation
 */
function validateToken(token: string | null | undefined): string {
  if (token === null || token === undefined) {
    throw new Error('Token is required but was null or undefined');
  }

  try {
    // Validate with Zod schema
    const validatedToken = TokenSchema.parse(token.trim());
    return validatedToken;
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(`Token validation failed: ${error.errors.map(e => e.message).join(', ')}`);
    }
    throw error;
  }
}

export async function init() {
  // Guard all browser API access with typeof checks for SSR safety
  const w = typeof window !== 'undefined' ? window.innerWidth : 0;
  const rootEl = typeof document !== 'undefined' ? document.getElementById('root') : null;
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : 'SSR';
  
  // FIXED (cz-ts-1008): Use typed service URL factory with AWS Cloud Map service discovery
  // Replaces untyped string literals with compile-time validated service endpoints
  // The TypedServiceUrlFactory constructs URLs from Cloud Map DNS service discovery
  // providing type-safe API endpoint references that prevent incorrect URLs in containers
  
  // Type-safe service URL construction with compile-time validation
  // Validate environment variables at startup with type guards  
  // This ensures all required config is present before the container runs
  validateEnv();
  
  // FIXED (cz-ts-1008): Type-safe service URL with compile-time validation
  // Uses ServiceEndpoint enum instead of string literals for type safety
  // AWS Cloud Map service discovery constructs the URL from registered services
  const apiUrl = getTypedServiceUrl(ServiceEndpoint.API, '/api');
  
  const key = await getConfigValue<string>('apiKey', getEnvVar('REACT_APP_KEY'));
  
  // SECURITY FIX: Removed 'as any' type assertion and added proper validation
  // Guard document.querySelector with typeof check and validate the result
  const rawElement = typeof document !== 'undefined' ? document.querySelector('#x') : null;
  const el = validateDOMElement(rawElement);
  
  // SECURITY FIX: Removed '!' non-null assertion and added proper null checking
  // Validate token with runtime type checking instead of bypassing null safety
  const rawToken = getToken();
  const token = validateToken(rawToken);
  
  return { w, ua, apiUrl, key, el, token };
}

function getToken(): string | null { return null; }
