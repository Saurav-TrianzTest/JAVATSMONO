/**
 * SSM Parameter Store Hierarchical Config with TypeScript Validation
 * Remediation: cz-ts-1009 – Missing Type Guards for Container Environment Variables
 *
 * Fetches container environment configuration from AWS SSM Parameter Store
 * hierarchical parameters injected into ECS Fargate tasks.  A Zod schema
 * guard validates every required key at Fargate task startup; if any required
 * value is missing the task exits with a non-zero code so the ECS orchestrator
 * can restart / alert rather than silently running with undefined config.
 *
 * Environment variables consumed:
 *   SSM_ENV_CONFIG_PATH   – SSM Parameter Store path prefix for env config
 *                           (default: "/storefront/frontend")
 *   AWS_REGION            – AWS region for the SSM client
 *                           (default: "us-east-1")
 *   REACT_APP_KEY         – Fallback API key when SSM agent is unavailable
 *   API_PROD_URL          – Fallback production API URL
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Zod schema – single source of truth for required container env config
// ---------------------------------------------------------------------------

/**
 * Schema that validates all required frontend environment variables.
 * Any field that is `undefined` or empty will cause a Zod validation error,
 * which triggers a graceful task exit at startup.
 */
export const FrontendEnvSchema = z.object({
  /** API key for authenticated requests (REACT_APP_KEY / SSM injected) */
  REACT_APP_KEY: z
    .string({ required_error: 'REACT_APP_KEY is required but was not provided' })
    .min(1, 'REACT_APP_KEY must not be empty'),

  /** Production API base URL */
  API_PROD_URL: z
    .string({ required_error: 'API_PROD_URL is required but was not provided' })
    .url('API_PROD_URL must be a valid URL'),
});

/** Strongly-typed shape of the validated frontend environment config */
export type FrontendEnv = z.infer<typeof FrontendEnvSchema>;

// ---------------------------------------------------------------------------
// SSM Parameter Store helpers
// ---------------------------------------------------------------------------

/**
 * Fetch a single parameter value from the AWS SSM Parameter Store agent
 * sidecar running on localhost:2773 (ECS Fargate Parameters & Secrets
 * Lambda Extension).
 *
 * Returns `null` when the agent is unreachable or the parameter is missing.
 */
async function fetchSsmParameter(paramName: string): Promise<string | null> {
  const ssmUrl =
    `http://localhost:2773/systemsmanager/parameters/get` +
    `?name=${encodeURIComponent(paramName)}&withDecryption=true`;

  try {
    const res = await fetch(ssmUrl, {
      headers: {
        'X-Aws-Parameters-Secrets-Token': process.env.AWS_SESSION_TOKEN ?? '',
      },
    });

    if (!res.ok) {
      console.warn(
        `[SSM] Could not fetch parameter "${paramName}" (HTTP ${res.status}).`
      );
      return null;
    }

    const body = (await res.json()) as { Parameter?: { Value?: string } };
    return body?.Parameter?.Value ?? null;
  } catch (err) {
    console.warn(`[SSM] Agent unreachable while fetching "${paramName}".`, err);
    return null;
  }
}

/**
 * Resolve the frontend environment configuration using the following
 * priority order:
 *
 *   1. AWS SSM Parameter Store (hierarchical path, ECS Fargate sidecar)
 *   2. Process environment variables (local development / CI fallback)
 *
 * The resolved values are validated against `FrontendEnvSchema`.  If
 * validation fails the function throws so callers can exit the process.
 */
async function resolveFrontendEnv(): Promise<FrontendEnv> {
  const pathPrefix =
    process.env.SSM_ENV_CONFIG_PATH ?? '/storefront/frontend';

  // Attempt to load each required key from SSM Parameter Store
  const [ssmReactAppKey, ssmApiProdUrl] = await Promise.all([
    fetchSsmParameter(`${pathPrefix}/REACT_APP_KEY`),
    fetchSsmParameter(`${pathPrefix}/API_PROD_URL`),
  ]);

  // Build the raw config object, preferring SSM values over env vars
  const rawConfig = {
    REACT_APP_KEY: ssmReactAppKey ?? process.env.REACT_APP_KEY,
    API_PROD_URL:  ssmApiProdUrl  ?? process.env.API_PROD_URL,
  };

  // Validate with Zod – throws ZodError on missing / invalid values
  const result = FrontendEnvSchema.safeParse(rawConfig);

  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  • ${i.path.join('.')}: ${i.message}`)
      .join('\n');

    throw new Error(
      `[EnvConfig] Container environment validation failed at Fargate startup.\n` +
      `Missing or invalid configuration keys:\n${issues}\n` +
      `Ensure the SSM Parameter Store path "${pathPrefix}" contains all required parameters,\n` +
      `or set the corresponding environment variables in the ECS task definition.`
    );
  }

  return result.data;
}

// ---------------------------------------------------------------------------
// Module-level singleton – validated once at startup, cached thereafter
// ---------------------------------------------------------------------------

let _envConfig: FrontendEnv | null = null;

/**
 * Initialise and validate the frontend environment configuration.
 *
 * **Must be called once at ECS Fargate task startup** (before any other
 * module that needs env config).  If validation fails the returned promise
 * rejects; callers should catch the error and call `process.exit(1)` to
 * signal the ECS orchestrator that the task failed to start.
 *
 * @example
 * // In your entry-point (e.g. server.ts or index.ts):
 * import { initEnvConfig } from './envConfig';
 * initEnvConfig().catch((err) => { console.error(err); process.exit(1); });
 */
export async function initEnvConfig(): Promise<FrontendEnv> {
  if (_envConfig !== null) {
    return _envConfig;
  }

  _envConfig = await resolveFrontendEnv();

  console.info(
    '[EnvConfig] Container environment configuration validated successfully.'
  );

  return _envConfig;
}

/**
 * Return the already-initialised environment config synchronously.
 *
 * Throws if `initEnvConfig()` has not been awaited first, ensuring that
 * modules cannot accidentally access config before startup validation runs.
 */
export function getEnvConfig(): FrontendEnv {
  if (_envConfig === null) {
    throw new Error(
      '[EnvConfig] getEnvConfig() called before initEnvConfig() completed. ' +
      'Ensure initEnvConfig() is awaited at Fargate task startup.'
    );
  }
  return _envConfig;
}

/** Clear the cached config (useful in tests). */
export function clearEnvConfigCache(): void {
  _envConfig = null;
}
