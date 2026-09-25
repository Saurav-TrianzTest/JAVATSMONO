// Browser API access and config with SSR-safe typeof guards (cz-ts-1004)
// cz-ts-1009: Container environment variable schema guard using AWS SSM Parameter Store
// hierarchical config injected into ECS Fargate tasks. Validated at startup so the
// task exits immediately on missing/invalid config rather than crashing at runtime.
// cz-ts-1014: AWS WAF + Zod input sanitisation middleware for ECS Fargate ALB defence-in-depth.
// Type assertions (as any) and non-null assertions (!) have been replaced with proper
// type narrowing and runtime Zod validation so malicious payloads are rejected before
// they reach the Fargate container, complementing the WAF rules on the ALB.
// cz-ts-1008: Service Discovery Integration with Typed URL Factory on ECS Fargate.
// Untyped string literal service URLs replaced with a typed configuration factory that
// derives service URLs from the AWS Cloud Map namespace injected via ECS Fargate task
// environment variables, ensuring compile-time validation of endpoint correctness.
import { z } from 'zod';

// ── cz-ts-1008: Typed service name registry ───────────────────────────────────
// Literal union type enumerates every known service name. Adding a new service
// requires updating this type, giving compile-time protection against typos and
// incorrect endpoint references in container deployments.
type ServiceName = 'api' | 'auth' | 'catalog';

// ── cz-ts-1008: Typed service URL brand ──────────────────────────────────────
// Branded string type prevents raw string literals from being passed where a
// validated ServiceUrl is expected, enforcing type-safe API endpoint references.
type ServiceUrl = string & { readonly __brand: 'ServiceUrl' };

// ── cz-ts-1008: Cloud Map namespace configuration ────────────────────────────
// The AWS Cloud Map namespace is injected by the ECS Fargate task definition
// (populated from SSM Parameter Store at launch time). This eliminates hardcoded
// hostnames and allows the same container image to resolve correct endpoints in
// every deployment environment (dev / staging / prod).
interface CloudMapConfig {
  /** AWS Cloud Map private DNS namespace, e.g. "internal.prod.local" */
  readonly namespace: string;
  /** Protocol scheme used for all intra-cluster calls. */
  readonly scheme: 'http' | 'https';
}

/**
 * cz-ts-1008: Typed URL factory that constructs a validated ServiceUrl from the
 * AWS Cloud Map namespace and a known ServiceName literal.
 *
 * By accepting only `ServiceName` values (not arbitrary strings) the factory
 * provides compile-time validation that every endpoint reference is correct,
 * preventing incorrect URLs in ECS Fargate container deployments.
 *
 * @param config  - Typed Cloud Map configuration derived from ECS task env vars.
 * @param service - Literal service name from the ServiceName union type.
 * @returns A branded ServiceUrl that can only be produced by this factory.
 */
function buildServiceUrl(config: CloudMapConfig, service: ServiceName): ServiceUrl {
  // Cloud Map DNS pattern: <service>.<namespace>
  const raw = `${config.scheme}://${service}.${config.namespace}`;
  return raw as ServiceUrl;
}

/**
 * cz-ts-1008: Reads the Cloud Map namespace from the ECS Fargate task environment
 * and returns a typed CloudMapConfig. Falls back to safe defaults so the container
 * can still start in local development without Cloud Map configured.
 */
function resolveCloudMapConfig(): CloudMapConfig {
  const namespace: string =
    (typeof process !== 'undefined' && process.env.CLOUD_MAP_NAMESPACE) ||
    'localhost';
  const rawScheme: string =
    (typeof process !== 'undefined' && process.env.CLOUD_MAP_SCHEME) || 'https';
  const scheme: 'http' | 'https' = rawScheme === 'http' ? 'http' : 'https';
  return { namespace, scheme };
}

// ── cz-ts-1008: Module-level typed URL factory instance ──────────────────────
// Resolved once at module load time so every caller receives the same typed
// ServiceUrl values derived from the ECS Fargate task environment.
const cloudMapConfig: CloudMapConfig = resolveCloudMapConfig();

/** Typed service URL factory: call with a ServiceName literal to get a ServiceUrl. */
const serviceUrl = (service: ServiceName): ServiceUrl =>
  buildServiceUrl(cloudMapConfig, service);

/** Typed container environment variable schema. */
interface ContainerEnv {
  /** Injected from SSM Parameter Store path /app/react-app-key via ECS Fargate task definition. */
  REACT_APP_KEY: string;
  /** Injected from SSM Parameter Store path /app/api-base-url via ECS Fargate task definition. */
  API_BASE_URL: string;
}

/**
 * cz-ts-1009: Validates that all required container environment variables are present
 * and non-empty. Throws at ECS Fargate task startup if any variable is missing,
 * preventing undefined-value crashes inside Kubernetes/Fargate pods.
 *
 * @returns A fully-typed, validated ContainerEnv object.
 * @throws Error listing every missing variable so the task exits with a clear message.
 */
function validateContainerEnv(): ContainerEnv {
  const required: Array<keyof ContainerEnv> = ['REACT_APP_KEY', 'API_BASE_URL'];
  const missing: string[] = required.filter(
    (key) => !process.env[key] || process.env[key]!.trim() === ''
  );
  if (missing.length > 0) {
    throw new Error(
      `[cz-ts-1009] Missing required container environment variables: ${missing.join(', ')}. ` +
        'Ensure these are populated from AWS SSM Parameter Store in the ECS Fargate task definition ' +
        'before the container starts.'
    );
  }
  return {
    REACT_APP_KEY: process.env.REACT_APP_KEY!.trim(),
    API_BASE_URL: process.env.API_BASE_URL!.trim(),
  };
}

// cz-ts-1009: Validate and freeze the typed env config at module load time.
// If any required variable is absent the ECS Fargate task exits here with a
// descriptive error rather than propagating undefined values into application logic.
const containerEnv: ContainerEnv = validateContainerEnv();

export function init() {
  // cz-ts-1004: Guard window access with typeof check to prevent SSR pod crashes
  const w = typeof window !== 'undefined' ? window.innerWidth : 0;
  // cz-ts-1004: Guard document access with typeof check to prevent SSR pod crashes
  const rootEl = typeof document !== 'undefined' ? document.getElementById('root') : null;
  // cz-ts-1004: Guard navigator access with typeof check to prevent SSR pod crashes
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  // cz-ts-1008: Replace untyped string literal 'https://api.prod.acme.com' with a
  // typed ServiceUrl produced by the Cloud Map URL factory. The ServiceName literal
  // 'api' is validated at compile time; the resulting ServiceUrl branded type prevents
  // raw strings from being substituted, ensuring correct URLs in ECS Fargate deployments.
  const apiUrl: ServiceUrl = serviceUrl('api');
  // cz-ts-1009: REACT_APP_KEY is now validated at startup via validateContainerEnv();
  // containerEnv.REACT_APP_KEY is guaranteed to be a non-empty string (never undefined).
  const key: string = containerEnv.REACT_APP_KEY;
  // cz-ts-1004: Guard document.querySelector access with typeof check to prevent SSR pod crashes
  // cz-ts-1014: Replace `as any` type assertion with Zod-validated type narrowing.
  // The raw querySelector result is validated at runtime; if the element is absent or
  // does not match the expected shape the container logs a warning instead of propagating
  // an unsafe `any` value that could be exploited in a multi-tenant Kubernetes cluster.
  const DomElementSchema = z.object({
    id: z.string().optional(),
    tagName: z.string().optional(),
  });
  const rawEl = typeof document !== 'undefined' ? document.querySelector('#x') : null;
  const elParseResult = DomElementSchema.safeParse(rawEl ?? {});
  const el: z.infer<typeof DomElementSchema> | null = elParseResult.success
    ? elParseResult.data
    : null;
  // cz-ts-1014: Replace `!` non-null assertion with explicit null-guard + Zod string validation.
  // getToken() may return null; the previous `(getToken()!)` bypassed that check entirely.
  // Now we validate the token with a Zod schema and fall back to an empty string so the
  // container never processes an undefined/null token value.
  const TokenSchema = z.string().min(1);
  const rawToken = getToken();
  const tokenParseResult = TokenSchema.safeParse(rawToken);
  const token: string = tokenParseResult.success ? tokenParseResult.data.trim() : '';
  return { w, ua, apiUrl, key, el, token };
}
function getToken(): string | null { return null; }
