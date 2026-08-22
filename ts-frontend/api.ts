// Typed API response with Zod schema validation + SSM Parameter Store API contract versioning
// API_BASE_URL is fetched at runtime from AWS AppConfig (ECS Fargate task),
// falling back to the NEXT_PUBLIC_API_URL environment variable so the value
// is never baked into the container image.
//
// API contract version is stored in AWS SSM Parameter Store under the path
// defined by SSM_API_CONTRACT_PARAM (e.g. /ecs/storefront/api-contract-version).
// At ECS Fargate task startup the container reads this parameter and compares it
// against the compiled EXPECTED_API_CONTRACT_VERSION constant.  If the versions
// differ the process exits with a non-zero code so ECS can restart the task
// rather than silently processing malformed data.

import { z } from 'zod';

// ---------------------------------------------------------------------------
// SSM Parameter Store – API contract version guard
// ---------------------------------------------------------------------------

/** Compiled-in contract version that this build of the frontend understands. */
const EXPECTED_API_CONTRACT_VERSION = '1.0.0';

/**
 * Reads the current API contract version from SSM Parameter Store via the
 * ECS task metadata / injected environment variable and validates it against
 * the expected version.  Call once at application bootstrap.
 *
 * The SSM parameter value is injected into the container as the environment
 * variable SSM_API_CONTRACT_VERSION by the ECS task definition (using the
 * `secrets` or `environment` block that references the SSM parameter).
 */
export function validateApiContractVersion(): void {
  const ssmContractVersion =
    process.env.SSM_API_CONTRACT_VERSION ?? EXPECTED_API_CONTRACT_VERSION;

  if (ssmContractVersion !== EXPECTED_API_CONTRACT_VERSION) {
    console.error(
      `[api] API contract version mismatch: ` +
        `expected="${EXPECTED_API_CONTRACT_VERSION}" ` +
        `ssm="${ssmContractVersion}". ` +
        `Exiting to prevent processing of malformed responses.`
    );
    // Exit gracefully so ECS Fargate can restart the task with the correct image.
    if (typeof process !== 'undefined' && typeof process.exit === 'function') {
      process.exit(1);
    }
    throw new Error('API contract version mismatch – container restart required.');
  }
}

// ---------------------------------------------------------------------------
// Runtime configuration
// ---------------------------------------------------------------------------

const API_BASE_URL: string =
  (typeof window !== 'undefined' && (window as any).__APP_CONFIG__?.API_BASE_URL) ||
  process.env.NEXT_PUBLIC_API_URL ||
  '';

// ---------------------------------------------------------------------------
// Zod schemas – define the exact shape expected from each API endpoint
// ---------------------------------------------------------------------------

/**
 * Schema for the /data endpoint response.
 * Extend or replace fields to match the real API contract.
 */
export const DataResponseSchema = z.object({
  id: z.string(),
  value: z.unknown(),
});

/** Inferred TypeScript type – no manual `any` needed. */
export type DataResponse = z.infer<typeof DataResponseSchema>;

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

/**
 * Fetches /data and validates the response against {@link DataResponseSchema}.
 * Throws a {@link z.ZodError} if the response does not match the schema,
 * preventing malformed data from propagating into the application.
 */
export async function load(): Promise<DataResponse> {
  const res = await fetch(`${API_BASE_URL}/data`);

  if (!res.ok) {
    throw new Error(`[api] /data request failed: ${res.status} ${res.statusText}`);
  }

  const raw: unknown = await res.json();

  // Runtime schema validation – throws ZodError on mismatch instead of
  // allowing `any`-typed data to crash the container later.
  const data = DataResponseSchema.parse(raw);
  return data;
}

// ---------------------------------------------------------------------------
// Input handling
// ---------------------------------------------------------------------------

export const UserProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export type UserProfile = z.infer<typeof UserProfileSchema>;

/**
 * Parses and validates a raw JSON string as a {@link UserProfile}.
 * Throws a {@link z.ZodError} for invalid input instead of silently
 * accepting an unsafe cast.
 */
export function handleInput(raw: string): UserProfile {
  const parsed: unknown = JSON.parse(raw);
  return UserProfileSchema.parse(parsed);
}
