// AWS Cloud Map Service Discovery Integration for ECS Fargate
// Provides type-safe service URL configuration with compile-time validation

import { z } from 'zod';

/**
 * Service endpoint types - compile-time validated literal types
 * These represent the services registered in AWS Cloud Map
 */
export enum ServiceEndpoint {
  API = 'api',
  AUTH = 'auth',
  PAYMENT = 'payment',
  INVENTORY = 'inventory'
}

/**
 * Service URL configuration schema with strict type validation
 * Ensures all service URLs are properly formatted and validated at runtime
 */
const ServiceUrlSchema = z.object({
  protocol: z.enum(['http', 'https']),
  host: z.string().min(1),
  port: z.number().int().positive().optional(),
  basePath: z.string().default(''),
});

export type ServiceUrl = z.infer<typeof ServiceUrlSchema>;

/**
 * Complete service configuration with type-safe URL construction
 */
interface ServiceConfig {
  readonly endpoint: ServiceEndpoint;
  readonly url: ServiceUrl;
}

/**
 * AWS Cloud Map namespace configuration
 * In ECS Fargate, services are registered in Cloud Map with DNS-based service discovery
 */
const CloudMapConfig = z.object({
  namespace: z.string().min(1, 'Cloud Map namespace is required'),
  region: z.string().default('us-east-1'),
  enabled: z.boolean().default(true),
});

type CloudMapConfigType = z.infer<typeof CloudMapConfig>;

/**
 * Typed URL Factory for Service Discovery
 * Constructs type-safe service URLs from AWS Cloud Map service discovery
 * Prevents hardcoded string URLs and provides compile-time validation
 */
export class TypedServiceUrlFactory {
  private readonly cloudMapConfig: CloudMapConfigType;
  private readonly serviceCache: Map<ServiceEndpoint, ServiceConfig> = new Map();

  constructor(cloudMapNamespace?: string, region?: string) {
    // Validate Cloud Map configuration from environment
    this.cloudMapConfig = CloudMapConfig.parse({
      namespace: cloudMapNamespace || process.env.CLOUD_MAP_NAMESPACE || 'storefront.local',
      region: region || process.env.AWS_REGION || 'us-east-1',
      enabled: process.env.CLOUD_MAP_ENABLED !== 'false',
    });

    console.log(`✓ TypedServiceUrlFactory initialized with Cloud Map namespace: ${this.cloudMapConfig.namespace}`);
  }

  /**
   * Constructs a type-safe service URL from Cloud Map service discovery
   * @param endpoint - The service endpoint enum (compile-time validated)
   * @returns Validated ServiceConfig with type-safe URL
   */
  public getServiceUrl(endpoint: ServiceEndpoint): ServiceConfig {
    // Check cache first
    if (this.serviceCache.has(endpoint)) {
      return this.serviceCache.get(endpoint)!;
    }

    // Construct service URL from Cloud Map DNS
    const serviceUrl = this.constructServiceUrl(endpoint);
    
    // Validate the constructed URL
    const validatedUrl = ServiceUrlSchema.parse(serviceUrl);

    const config: ServiceConfig = {
      endpoint,
      url: validatedUrl,
    };

    // Cache the validated configuration
    this.serviceCache.set(endpoint, config);
    return config;
  }

  /**
   * Constructs the full URL string from ServiceConfig
   * Type-safe URL construction with compile-time validation
   */
  public buildUrl(endpoint: ServiceEndpoint, path: string = ''): string {
    const config = this.getServiceUrl(endpoint);
    const { protocol, host, port, basePath } = config.url;
    
    const portStr = port ? `:${port}` : '';
    const fullPath = `${basePath}${path}`.replace(/\/+/g, '/');
    
    return `${protocol}://${host}${portStr}${fullPath}`;
  }

  /**
   * Constructs service URL from AWS Cloud Map service discovery
   * In ECS Fargate, services are registered with DNS names like:
   * <service-name>.<namespace>
   */
  private constructServiceUrl(endpoint: ServiceEndpoint): ServiceUrl {
    if (!this.cloudMapConfig.enabled) {
      // Fallback to environment variables if Cloud Map is disabled
      return this.getServiceUrlFromEnv(endpoint);
    }

    // AWS Cloud Map DNS format: <service-name>.<namespace>
    // Example: api.storefront.local
    const serviceDns = `${endpoint}.${this.cloudMapConfig.namespace}`;

    // In ECS Fargate, services typically use HTTP on port 80 or HTTPS on port 443
    // The protocol and port can be overridden via environment variables
    const protocol = this.getServiceProtocol(endpoint);
    const port = this.getServicePort(endpoint);

    return {
      protocol,
      host: serviceDns,
      port,
      basePath: this.getServiceBasePath(endpoint),
    };
  }

  /**
   * Gets service URL from environment variables (fallback)
   * Maintains type safety even when not using Cloud Map
   */
  private getServiceUrlFromEnv(endpoint: ServiceEndpoint): ServiceUrl {
    const envKey = `${endpoint.toUpperCase()}_URL`;
    const url = process.env[envKey];

    if (!url) {
      throw new Error(`Service URL not found for ${endpoint}. Set ${envKey} environment variable or enable Cloud Map.`);
    }

    // Parse the URL to extract components
    try {
      const parsed = new URL(url);
      return {
        protocol: parsed.protocol.replace(':', '') as 'http' | 'https',
        host: parsed.hostname,
        port: parsed.port ? parseInt(parsed.port, 10) : undefined,
        basePath: parsed.pathname,
      };
    } catch (error) {
      throw new Error(`Invalid URL format for ${endpoint}: ${url}`);
    }
  }

  /**
   * Gets the protocol for a service (http or https)
   * Can be overridden via environment variables
   */
  private getServiceProtocol(endpoint: ServiceEndpoint): 'http' | 'https' {
    const envKey = `${endpoint.toUpperCase()}_PROTOCOL`;
    const protocol = process.env[envKey] || 'https';
    return protocol as 'http' | 'https';
  }

  /**
   * Gets the port for a service
   * Can be overridden via environment variables
   */
  private getServicePort(endpoint: ServiceEndpoint): number | undefined {
    const envKey = `${endpoint.toUpperCase()}_PORT`;
    const port = process.env[envKey];
    return port ? parseInt(port, 10) : undefined;
  }

  /**
   * Gets the base path for a service
   * Can be overridden via environment variables
   */
  private getServiceBasePath(endpoint: ServiceEndpoint): string {
    const envKey = `${endpoint.toUpperCase()}_BASE_PATH`;
    return process.env[envKey] || '';
  }

  /**
   * Clears the service cache
   * Useful for testing or when service configuration changes
   */
  public clearCache(): void {
    this.serviceCache.clear();
  }
}

/**
 * Singleton instance of TypedServiceUrlFactory
 * Initialized with Cloud Map configuration from environment
 */
let factoryInstance: TypedServiceUrlFactory | null = null;

/**
 * Gets the singleton TypedServiceUrlFactory instance
 * Lazy initialization with Cloud Map configuration
 */
export function getServiceUrlFactory(): TypedServiceUrlFactory {
  if (!factoryInstance) {
    factoryInstance = new TypedServiceUrlFactory();
  }
  return factoryInstance;
}

/**
 * Type-safe helper to get a service URL
 * Provides compile-time validation of service endpoints
 */
export function getTypedServiceUrl(endpoint: ServiceEndpoint, path: string = ''): string {
  const factory = getServiceUrlFactory();
  return factory.buildUrl(endpoint, path);
}

/**
 * Resets the factory instance (useful for testing)
 */
export function resetServiceUrlFactory(): void {
  factoryInstance = null;
}
