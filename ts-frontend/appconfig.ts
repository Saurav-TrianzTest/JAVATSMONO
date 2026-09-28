/**
 * AWS AppConfig Integration for ECS Fargate
 *
 * Fetches runtime feature-flag / configuration values from the AWS AppConfig
 * local agent sidecar (http://localhost:2772) that runs alongside the ECS
 * Fargate task.  Falls back gracefully to environment variables so the module
 * works in local development without the sidecar present.
 *
 * Environment variables consumed:
 *   APPCONFIG_APPLICATION   – AppConfig application name  (default: "storefront")
 *   APPCONFIG_ENVIRONMENT   – AppConfig environment name  (default: "production")
 *   APPCONFIG_PROFILE       – AppConfig configuration profile (default: "feature-flags")
 *   APPCONFIG_AGENT_PORT    – Local agent port            (default: 2772)
 */

export interface AppConfig {
  /** Base URL for the public API, e.g. https://api.acme.com */
  API_BASE_URL?: string;
  /** Base URL for the production API, e.g. https://api.prod.acme.com */
  API_PROD_URL?: string;
  /** Any additional dynamic flags / values returned by AppConfig */
  [key: string]: string | boolean | number | undefined;
}

let cachedConfig: AppConfig | null = null;

/**
 * Retrieve the application configuration from AWS AppConfig.
 * Results are cached in-process for the lifetime of the module so that
 * repeated calls do not incur extra HTTP round-trips.
 */
export async function getAppConfig(): Promise<AppConfig> {
  if (cachedConfig !== null) {
    return cachedConfig;
  }

  const application = process.env.APPCONFIG_APPLICATION ?? 'storefront';
  const environment = process.env.APPCONFIG_ENVIRONMENT ?? 'production';
  const profile     = process.env.APPCONFIG_PROFILE     ?? 'feature-flags';
  const agentPort   = process.env.APPCONFIG_AGENT_PORT  ?? '2772';

  const agentUrl =
    `http://localhost:${agentPort}/applications/${encodeURIComponent(application)}` +
    `/environments/${encodeURIComponent(environment)}` +
    `/configurations/${encodeURIComponent(profile)}`;

  try {
    const response = await fetch(agentUrl, {
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      console.warn(
        `[AppConfig] Agent responded with HTTP ${response.status}. ` +
        'Falling back to environment variables.'
      );
      cachedConfig = buildFallbackConfig();
      return cachedConfig;
    }

    const text = await response.text();
    if (!text || text.trim() === '') {
      // AppConfig returns an empty body when the configuration has not changed
      cachedConfig = buildFallbackConfig();
      return cachedConfig;
    }

    const parsed: AppConfig = JSON.parse(text);
    cachedConfig = { ...buildFallbackConfig(), ...parsed };
    return cachedConfig;
  } catch (err) {
    console.warn(
      '[AppConfig] Could not reach local agent – falling back to environment variables.',
      err
    );
    cachedConfig = buildFallbackConfig();
    return cachedConfig;
  }
}

/** Build a config object from environment variables as a safe fallback. */
function buildFallbackConfig(): AppConfig {
  return {
    API_BASE_URL: process.env.API_BASE_URL,
    API_PROD_URL: process.env.API_PROD_URL,
  };
}

/** Clear the in-process cache (useful in tests). */
export function clearAppConfigCache(): void {
  cachedConfig = null;
}
