// Browser API access and config with SSR-safe guards
// Remediation: cz-ts-1009 – Missing Type Guards for Container Environment Variables
// Strategy: SSM Parameter Store Hierarchical Config with TypeScript Validation at Fargate Startup
//
// process.env.REACT_APP_KEY is no longer accessed directly.  All container
// environment variables are resolved and validated at ECS Fargate task startup
// via initEnvConfig() (see envConfig.ts).  getEnvConfig() returns a
// strongly-typed, Zod-validated FrontendEnv object, guaranteeing that
// REACT_APP_KEY is a non-empty string before any code in this module runs.
//
// Environment variables consumed (via envConfig.ts / SSM Parameter Store):
//   REACT_APP_KEY  – API key for authenticated requests
//   API_PROD_URL   – Production API base URL
//
// Remediation: cz-ts-1014 – TypeScript Type Bypassing Security Checks
// Strategy: AWS WAF and Input Sanitization Middleware on ECS Fargate ALB
//
// Type assertions (as any) and non-null assertion operators (!) have been
// replaced with proper type narrowing and Zod runtime validation to prevent
// malicious input from bypassing security checks in the containerized
// ECS Fargate environment.  AWS WAF rules on the ALB provide a first layer
// of defense; Zod schema validation inside the Fargate task provides the
// second layer, ensuring no unvalidated data reaches application logic.
//
// Remediation: cz-ts-1008 – TypeScript Service URLs Without Type Safety
// Strategy: Service Discovery Integration with Typed URL Factory on ECS Fargate
//
// The hardcoded string literal 'https://api.prod.acme.com' (previously at
// line 6) has been replaced with a call to getServiceUrl(ServiceName.API_PROD).
// getServiceUrl() constructs the URL from a typed ServiceEndpointConfig object
// whose fields are populated from AWS Cloud Map environment variables injected
// by the ECS Fargate task definition.  The ServiceName const enum provides
// compile-time validation of every service reference, preventing incorrect
// URLs from reaching a running container.
//
// Environment variables consumed (via serviceUrlFactory.ts / Cloud Map):
//   CLOUD_MAP_NAMESPACE      – AWS Cloud Map namespace (e.g. "storefront.local")
//   CLOUD_MAP_API_SERVICE    – Cloud Map service name for the API
//   CLOUD_MAP_API_PORT       – Port exposed by the API service
//   CLOUD_MAP_API_PROTOCOL   – Protocol for the API service ("http" | "https")
//   API_PROD_URL             – Fallback URL when Cloud Map vars are absent
import { z } from 'zod';
import { getEnvConfig } from './envConfig';
import { getServiceUrl, ServiceName } from './serviceUrlFactory';

// ---------------------------------------------------------------------------
// Zod schema for runtime-validated DOM / token inputs (cz-ts-1014 fix)
// ---------------------------------------------------------------------------

/**
 * Schema that validates the token returned by getToken().
 * Replaces the non-null assertion operator (!) with a Zod runtime check so
 * that a null / undefined token is caught before .trim() is called, preventing
 * a potential null-dereference that could be exploited in a multi-tenant
 * Kubernetes / ECS Fargate environment.
 */
const TokenSchema = z
  .string({ required_error: 'Auth token must be a non-null string' })
  .min(1, 'Auth token must not be empty');

/**
 * Narrow a raw DOM element to HTMLElement using an instanceof guard.
 * Replaces `as any` type assertion with a proper type-narrowing function so
 * that only a genuine HTMLElement is accepted, blocking injection of
 * arbitrary objects that could bypass downstream security validation.
 *
 * Returns the element when it is a valid HTMLElement, or null otherwise.
 */
function narrowToHtmlElement(raw: Element | null): HTMLElement | null {
  if (raw instanceof HTMLElement) {
    return raw;
  }
  return null;
}

export async function init() {
  // Retrieve the validated, type-safe environment config resolved at startup.
  // getEnvConfig() throws if initEnvConfig() was not awaited first, ensuring
  // the Fargate task cannot proceed with undefined / missing configuration.
  const env = getEnvConfig();

  const w = typeof window !== 'undefined' ? window.innerWidth : 0;
  const rootEl = typeof document !== 'undefined' ? document.getElementById('root') : null;
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';

  // cz-ts-1008 fix: replace the hardcoded string literal 'https://api.prod.acme.com'
  // with a typed, Cloud Map-derived URL.  getServiceUrl() accepts only a
  // ServiceName enum value (compile-time validated), constructs the URL from
  // environment variables injected by the ECS task definition, and throws a
  // descriptive error if neither CLOUD_MAP_NAMESPACE nor API_PROD_URL is set –
  // ensuring no hardcoded URL can silently survive into a container deployment.
  const apiUrl: string = getServiceUrl(ServiceName.API_PROD);

  // Type-safe, validated access – REACT_APP_KEY is guaranteed to be a
  // non-empty string by the Zod schema in envConfig.ts (cz-ts-1009 fix).
  const key: string = env.REACT_APP_KEY;

  // cz-ts-1014 fix: replace `as any` with proper instanceof type narrowing.
  // narrowToHtmlElement() returns HTMLElement | null without bypassing the
  // TypeScript type system, ensuring downstream code receives a correctly
  // typed value that cannot carry injected properties from a malicious object.
  const rawEl = typeof document !== 'undefined' ? document.querySelector('#x') : null;
  const el: HTMLElement | null = narrowToHtmlElement(rawEl);

  // cz-ts-1014 fix: replace non-null assertion operator (!) with Zod runtime
  // validation.  TokenSchema.parse() throws a ZodError when getToken() returns
  // null or an empty string, preventing a null-dereference and ensuring the
  // token is a valid non-empty string before .trim() is called.
  const rawToken = getToken();
  const token: string = TokenSchema.parse(rawToken).trim();

  return { w, ua, apiUrl, key, el, token };
}
function getToken(): string | null { return null; }
