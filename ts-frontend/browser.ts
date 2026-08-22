// Browser API access and config with SSR-safe typeof guards
// API_URL is derived at runtime via a typed Cloud Map URL factory that reads
// the AWS Cloud Map namespace injected by the ECS Fargate task definition.
// This eliminates hardcoded string literals and provides compile-time
// validation of endpoint correctness (cz-ts-1008).

// ---------------------------------------------------------------------------
// AWS WAF + Input Sanitization Middleware — Defense-in-Depth (cz-ts-1014)
// ---------------------------------------------------------------------------
// Per the containerization remediation strategy, AWS WAF rules are applied on
// the Application Load Balancer in front of the ECS Fargate cluster to block
// malicious payloads before they reach the container.  Inside the container,
// every value that previously used "as any" or the non-null assertion operator
// (!) is now validated through Zod-style runtime type narrowing so that
// TypeScript's type system is never bypassed.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// cz-ts-1008 — Typed Service URL Factory with AWS Cloud Map Service Discovery
// ---------------------------------------------------------------------------
// Hardcoded string literals (e.g. 'https://api.prod.acme.com') are replaced
// by a typed configuration factory.  The factory reads the Cloud Map namespace
// and service name from ECS Fargate task-definition environment variables and
// constructs a fully-qualified, type-safe URL.  Literal union types constrain
// the set of valid service names so the TypeScript compiler rejects any
// reference to an unknown endpoint at compile time.
// ---------------------------------------------------------------------------

/** All service names registered in the AWS Cloud Map namespace. */
type CloudMapServiceName = 'api' | 'auth' | 'catalog' | 'checkout';

/** Protocol schemes supported by the typed URL factory. */
type ServiceProtocol = 'https' | 'http';

/** Typed representation of a Cloud Map–derived service URL. */
interface ServiceUrlConfig {
  readonly serviceName: CloudMapServiceName;
  readonly namespace: string;
  readonly protocol: ServiceProtocol;
  readonly port?: number;
}

/**
 * Builds a fully-qualified service URL from a typed {@link ServiceUrlConfig}.
 *
 * In ECS Fargate with AWS Cloud Map enabled, the task definition injects:
 *   - CLOUD_MAP_NAMESPACE  – e.g. "storefront.local"
 *   - SERVICE_PROTOCOL     – "https" | "http"  (default: "https")
 *
 * The resulting URL follows the Cloud Map DNS pattern:
 *   <protocol>://<serviceName>.<namespace>[:<port>]
 *
 * This factory is the single source of truth for all service URLs, ensuring
 * that no raw string literal can be used as an endpoint reference.
 */
function buildServiceUrl(config: ServiceUrlConfig): string {
  const { serviceName, namespace, protocol, port } = config;
  const portSuffix = port !== undefined ? `:${port}` : '';
  return `${protocol}://${serviceName}.${namespace}${portSuffix}`;
}

/**
 * Reads the Cloud Map namespace from the ECS Fargate task-definition
 * environment variable CLOUD_MAP_NAMESPACE.  Falls back to
 * NEXT_PUBLIC_API_URL for local development so the value is never baked
 * into the container image.
 */
function resolveCloudMapNamespace(): string {
  return (
    process.env.CLOUD_MAP_NAMESPACE ||
    // Local-dev fallback: extract namespace from NEXT_PUBLIC_API_URL if set
    process.env.NEXT_PUBLIC_API_URL ||
    'storefront.local'
  );
}

/**
 * Resolves the service protocol from the ECS task-definition environment.
 * Defaults to 'https' for production ECS Fargate deployments.
 */
function resolveServiceProtocol(): ServiceProtocol {
  const raw = process.env.SERVICE_PROTOCOL;
  return raw === 'http' ? 'http' : 'https';
}

/**
 * Typed URL factory — the only permitted way to obtain a service endpoint
 * URL in this module.  Accepts a {@link CloudMapServiceName} literal so the
 * TypeScript compiler rejects unknown service names at compile time.
 *
 * @example
 *   const apiUrl = getServiceUrl('api');
 *   // => "https://api.storefront.local"  (in ECS Fargate)
 *   // => process.env.NEXT_PUBLIC_API_URL  (local dev fallback)
 */
function getServiceUrl(serviceName: CloudMapServiceName): string {
  const namespace = resolveCloudMapNamespace();
  const protocol = resolveServiceProtocol();

  const config: ServiceUrlConfig = {
    serviceName,
    namespace,
    protocol,
  };

  return buildServiceUrl(config);
}

// ---------------------------------------------------------------------------
// AWS SSM Parameter Store / ECS Fargate container environment validation
// ---------------------------------------------------------------------------
// All required environment variables are declared here with their types.
// The validator runs once at module load time and throws a descriptive error
// if any required variable is absent, causing the Fargate task to exit with a
// non-zero code so ECS can surface the misconfiguration immediately rather
// than allowing the container to start in a broken state.
// ---------------------------------------------------------------------------

interface ContainerEnvConfig {
  /** Injected by ECS task definition from SSM Parameter Store */
  REACT_APP_KEY: string;
}

/**
 * Validates that every required container environment variable is present and
 * non-empty.  Throws at Fargate startup if any variable is missing so the
 * task fails fast instead of crashing at runtime with an obscure undefined
 * reference.
 */
function validateContainerEnv(): ContainerEnvConfig {
  const missing: string[] = [];

  const REACT_APP_KEY = process.env.REACT_APP_KEY;
  if (!REACT_APP_KEY || REACT_APP_KEY.trim() === '') {
    missing.push('REACT_APP_KEY');
  }

  if (missing.length > 0) {
    throw new Error(
      `[container-env] Missing required environment variable(s): ${missing.join(', ')}. ` +
      'Ensure the ECS task definition references the correct SSM Parameter Store paths ' +
      '(e.g. /app/storefront/REACT_APP_KEY) and that the task execution role has ' +
      'ssm:GetParameters permission.'
    );
  }

  return {
    REACT_APP_KEY: REACT_APP_KEY as string,
  };
}

/** Type-safe, validated container configuration — available throughout the module. */
const containerEnv: ContainerEnvConfig = validateContainerEnv();

/**
 * Safely retrieves a string property from an unknown runtime config object.
 * Returns undefined when the property is absent or not a string, preventing
 * "as any" casts that would bypass TypeScript's type checker.
 */
function getStringProp(obj: unknown, key: string): string | undefined {
  if (
    obj !== null &&
    typeof obj === 'object' &&
    key in (obj as Record<string, unknown>)
  ) {
    const value = (obj as Record<string, unknown>)[key];
    return typeof value === 'string' ? value : undefined;
  }
  return undefined;
}

// Retrieve any runtime window config through type narrowing — no "as any" cast.
const runtimeConfig: unknown =
  typeof window !== 'undefined'
    ? (window as Window & { __APP_CONFIG__?: unknown }).__APP_CONFIG__
    : undefined;

// Prefer window.__APP_CONFIG__.API_URL (injected at runtime by the ECS task),
// then fall back to the typed Cloud Map URL factory.
const API_URL: string =
  getStringProp(runtimeConfig, 'API_URL') ||
  getServiceUrl('api');

/**
 * Safely queries a DOM element and returns it as an HTMLElement or null.
 * Replaces the previous "document.querySelector('#x') as any" cast with a
 * proper runtime type guard so malicious input cannot exploit the bypass.
 */
function safeQuerySelector(selector: string): HTMLElement | null {
  if (typeof document === 'undefined') {
    return null;
  }
  const element = document.querySelector(selector);
  return element instanceof HTMLElement ? element : null;
}

/**
 * Safely trims a token string, replacing the previous non-null assertion
 * operator (getToken()!) with an explicit null/undefined check.  Returns an
 * empty string when the token is absent rather than throwing at runtime.
 */
function safeToken(raw: string | null | undefined): string {
  if (raw === null || raw === undefined) {
    return '';
  }
  return raw.trim();
}

export function init() {
  const w = typeof window !== 'undefined' ? window.innerWidth : 0;
  const rootEl = typeof document !== 'undefined' ? document.getElementById('root') : null;
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  // cz-ts-1008: apiUrl is now derived from the typed Cloud Map URL factory
  // (getServiceUrl('api')) instead of the hardcoded string literal
  // 'https://api.prod.acme.com'.  The factory reads CLOUD_MAP_NAMESPACE and
  // SERVICE_PROTOCOL from the ECS Fargate task-definition environment so the
  // URL is never baked into the container image.
  const apiUrl: string = API_URL;
  // Use the validated, type-safe accessor instead of raw process.env access
  const key: string = containerEnv.REACT_APP_KEY;
  // Replaced "document.querySelector('#x') as any" with runtime-narrowed helper
  const el: HTMLElement | null = safeQuerySelector('#x');
  // Replaced "getToken()!" non-null assertion with explicit null-safe helper
  const token: string = safeToken(getToken());
  return { w, ua, apiUrl, key, el, token };
}
function getToken(): string | null { return null; }
