// AWS AppConfig Integration for Dynamic Runtime Configuration
// This replaces build-time constants with runtime-fetched configuration
import { getEnvVar, isEnvValid } from './env-config';

interface AppConfig {
  apiUrl: string;
  featureFlags: Record<string, boolean>;
  [key: string]: any;
}

let cachedConfig: AppConfig | null = null;
let configPromise: Promise<AppConfig> | null = null;

/**
 * Fetches configuration from AWS AppConfig at runtime
 * Uses environment variables for AppConfig connection details
 */
async function fetchAppConfig(): Promise<AppConfig> {
  // Validate environment variables before accessing them
  if (!isEnvValid()) {
    throw new Error('Environment validation failed - cannot fetch AppConfig');
  }
  
  // Type-safe access to validated environment variables
  const appConfigEndpoint = getEnvVar('AWS_APPCONFIG_ENDPOINT');
  const application = getEnvVar('AWS_APPCONFIG_APPLICATION');
  const environment = getEnvVar('AWS_APPCONFIG_ENVIRONMENT');
  const configuration = getEnvVar('AWS_APPCONFIG_CONFIGURATION');
  
  if (!appConfigEndpoint) {
    // Fallback to environment variables if AppConfig is not configured
    console.warn('AWS AppConfig endpoint not configured, using environment variables');
    return {
      apiUrl: getEnvVar('API_URL'),
      featureFlags: {}
    };
  }

  try {
    // Fetch configuration from AWS AppConfig
    const url = `${appConfigEndpoint}/applications/${application}/environments/${environment}/configurations/${configuration}`;
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`AppConfig fetch failed: ${response.status}`);
    }

    const config = await response.json();
    cachedConfig = config;
    return config;
  } catch (error) {
    console.error('Failed to fetch AppConfig, using fallback configuration:', error);
    // Fallback configuration from environment variables
    return {
      apiUrl: getEnvVar('API_URL'),
      featureFlags: {}
    };
  }
}

/**
 * Gets the application configuration from AWS AppConfig
 * Caches the result to avoid repeated fetches
 */
export async function getAppConfig(): Promise<AppConfig> {
  if (cachedConfig) {
    return cachedConfig;
  }

  if (!configPromise) {
    configPromise = fetchAppConfig();
  }

  return configPromise;
}

/**
 * Gets a specific configuration value by key
 */
export async function getConfigValue<T = any>(key: string, defaultValue?: T): Promise<T> {
  const config = await getAppConfig();
  return (config[key] as T) ?? defaultValue;
}

/**
 * Refreshes the configuration cache
 * Call this periodically or on-demand to get updated configuration
 */
export async function refreshConfig(): Promise<AppConfig> {
  cachedConfig = null;
  configPromise = null;
  return getAppConfig();
}
