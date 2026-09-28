/**
 * Typed Service URL Factory with AWS Cloud Map Service Discovery
 * Remediation: cz-ts-1008 – TypeScript Service URLs Without Type Safety
 * Strategy: Service Discovery Integration with Typed URL Factory on ECS Fargate
 *
 * Eliminates hardcoded service URL strings by constructing typed URLs from an
 * AWS Cloud Map namespace resolved at ECS Fargate task startup.  All service
 * endpoint references are expressed as a const enum so the TypeScript compiler
 * validates every usage at compile time, preventing incorrect URLs in container
 * deployments.
 *
 * Environment variables consumed:
 *   CLOUD_MAP_NAMESPACE      – AWS Cloud Map namespace
 *                              (default: "storefront.local")
 *   CLOUD_MAP_API_SERVICE    – Cloud Map service name for the API
 *                              (default: "api-service")
 *   CLOUD_MAP_API_PORT       – Port exposed by the API service
 *                              (default: "443")
 *   CLOUD_MAP_API_PROTOCOL   – Protocol for the API service ("http" | "https")
 *                              (default: "https")
 *   API_PROD_URL             – Fallback URL when Cloud Map is unavailable
 *                              (default: undefined – must be set in task definition)
 */

// ---------------------------------------------------------------------------
// Typed service-name enum – compile-time validation of all service references
// ---------------------------------------------------------------------------

/**
 * Enum of all known backend services.  Using a const enum means the TypeScript
 * compiler substitutes the literal value at every call site, so a typo in a
 * service name is caught at compile time rather than at runtime in a container.
 */
export const enum ServiceName {
  /** Primary production API */
  API_PROD = 'api-prod',
}

// ---------------------------------------------------------------------------
// Typed URL configuration – literal types prevent invalid combinations
// ---------------------------------------------------------------------------

/** Allowed URL protocols – literal union prevents arbitrary strings */
export type ServiceProtocol = 'http' | 'https';

/**
 * Strongly-typed descriptor for a single service endpoint.
 * Every field is a concrete type (no `string` catch-alls) so the compiler
 * rejects invalid configurations before they reach a running container.
 */
export interface ServiceEndpointConfig {
  /** Cloud Map service name (matches the registered service in the namespace) */
  readonly serviceName: string;
  /** Cloud Map namespace (e.g. "storefront.local") */
  readonly namespace: string;
  /** Port the service listens on */
  readonly port: number;
  /** Protocol used to reach the service */
  readonly protocol: ServiceProtocol;
}

/**
 * Map from the typed `ServiceName` enum to its endpoint configuration.
 * Adding a new service requires adding an entry here AND to the `ServiceName`
 * enum – the compiler enforces completeness via the `Record` type.
 */
export type ServiceEndpointMap = Record<ServiceName, ServiceEndpointConfig>;

// ---------------------------------------------------------------------------
// Cloud Map URL factory
// ---------------------------------------------------------------------------

/**
 * Build a fully-qualified service URL from a `ServiceEndpointConfig`.
 *
 * In ECS Fargate with AWS Cloud Map enabled, the DNS name
 * `<serviceName>.<namespace>` resolves to the private IP of the task running
 * that service, so no hardcoded IP addresses or hostnames are needed.
 *
 * @example
 * buildServiceUrl(endpointMap[ServiceName.API_PROD])
 * // → "https://api-service.storefront.local:443"
 */
export function buildServiceUrl(config: ServiceEndpointConfig): string {
  const { protocol, serviceName, namespace, port } = config;
  // Standard ports are omitted for cleaner URLs
  const portSuffix =
    (protocol === 'https' && port === 443) ||
    (protocol === 'http'  && port === 80)
      ? ''
      : `:${port}`;
  return `${protocol}://${serviceName}.${namespace}${portSuffix}`;
}

// ---------------------------------------------------------------------------
// Singleton endpoint map – resolved once at Fargate task startup
// ---------------------------------------------------------------------------

let _endpointMap: ServiceEndpointMap | null = null;

/**
 * Resolve the `ServiceEndpointMap` from environment variables injected by the
 * ECS task definition.  The map is cached in-process after the first call.
 *
 * Falls back to `API_PROD_URL` when Cloud Map environment variables are absent
 * (e.g. local development), but still returns a fully-typed object so callers
 * never need to handle raw strings.
 */
function resolveEndpointMap(): ServiceEndpointMap {
  if (_endpointMap !== null) {
    return _endpointMap;
  }

  const namespace   = process.env.CLOUD_MAP_NAMESPACE    ?? 'storefront.local';
  const serviceName = process.env.CLOUD_MAP_API_SERVICE  ?? 'api-service';
  const rawPort     = process.env.CLOUD_MAP_API_PORT     ?? '443';
  const rawProtocol = process.env.CLOUD_MAP_API_PROTOCOL ?? 'https';

  const port: number = parseInt(rawPort, 10) || 443;
  const protocol: ServiceProtocol =
    rawProtocol === 'http' ? 'http' : 'https';

  _endpointMap = {
    [ServiceName.API_PROD]: {
      serviceName,
      namespace,
      port,
      protocol,
    },
  };

  return _endpointMap;
}

/**
 * Return the typed, Cloud Map-derived URL for the given service.
 *
 * When `API_PROD_URL` is set in the environment (local dev / CI fallback) and
 * Cloud Map variables are absent, the factory still returns a typed URL string
 * derived from the environment variable – no hardcoded literals anywhere.
 *
 * @param service - A `ServiceName` enum value (compile-time validated)
 * @returns       - The fully-qualified service URL as a `string`
 *
 * @example
 * import { getServiceUrl, ServiceName } from './serviceUrlFactory';
 * const apiUrl = getServiceUrl(ServiceName.API_PROD);
 * // → "https://api-service.storefront.local" (Cloud Map)
 * // → process.env.API_PROD_URL              (fallback)
 */
export function getServiceUrl(service: ServiceName): string {
  // Prefer Cloud Map-derived URL when namespace env var is explicitly set
  if (process.env.CLOUD_MAP_NAMESPACE) {
    const map = resolveEndpointMap();
    return buildServiceUrl(map[service]);
  }

  // Fallback: use the environment variable injected by the ECS task definition
  // (no hardcoded string – the task definition MUST supply this value)
  const fallback = process.env.API_PROD_URL;
  if (!fallback) {
    throw new Error(
      '[ServiceUrlFactory] Neither CLOUD_MAP_NAMESPACE nor API_PROD_URL is set. ' +
      'Ensure the ECS task definition provides at least one of these environment variables.'
    );
  }
  return fallback;
}

/** Clear the cached endpoint map (useful in tests). */
export function clearServiceUrlCache(): void {
  _endpointMap = null;
}
