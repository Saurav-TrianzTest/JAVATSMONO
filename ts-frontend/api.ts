// Typed API response with Zod schema validation + SSM Parameter Store API contract versioning
// Remediation: cz-ts-1007 – Untyped API Response Handling in Containers
// Strategy: SSM Parameter Store API Contract Versioning for ECS Fargate
//
// Remediation: cz-ts-1015 – Unvalidated User Input Types in Frontend
// Strategy: Multi-Container ECS Fargate Task with Validation Sidecar using io-ts
//
// The handleInput function now uses io-ts codec-based runtime type validation.
// In a Multi-Container ECS Fargate deployment, a sidecar validation container
// intercepts all inbound traffic and validates it using the same io-ts codecs
// before forwarding requests to the primary application container.
//
// At ECS Fargate task startup the module fetches the expected API contract
// version from SSM Parameter Store.  If the live API reports a different
// version the task exits gracefully (non-zero) before processing any data,
// preventing pod crashes from malformed / incompatible responses.
//
// Environment variables consumed:
//   SSM_API_CONTRACT_PARAM   – SSM parameter name that holds the expected
//                              API contract version string
//                              (default: "/storefront/api/contract-version")
//   AWS_REGION               – AWS region for the SSM client
//                              (default: "us-east-1")
//   API_BASE_URL             – Fallback base URL when AppConfig is unavailable
//                              (default: "https://api.acme.com")

import { z } from 'zod';
import * as t from 'io-ts';
import { isLeft } from 'fp-ts/Either';
import { PathReporter } from 'io-ts/PathReporter';
import { getAppConfig } from './appconfig';

// ---------------------------------------------------------------------------
// Zod schemas – single source of truth for the API contract (cz-ts-1007)
// ---------------------------------------------------------------------------

/** Schema for the /data endpoint response */
export const DataResponseSchema = z.object({
  id:        z.string(),
  name:      z.string(),
  value:     z.unknown().optional(),
  timestamp: z.string().optional(),
});

/** Schema for the /version endpoint response (API contract version check) */
const ApiVersionSchema = z.object({
  contractVersion: z.string(),
});

// Inferred TypeScript types – no more `any`
export type DataResponse = z.infer<typeof DataResponseSchema>;

// ---------------------------------------------------------------------------
// io-ts codecs – codec-based runtime type validation for user input (cz-ts-1015)
// ---------------------------------------------------------------------------

/**
 * io-ts codec for a validated user-profile payload.
 *
 * Remediation for cz-ts-1015: Replaces the unsafe `JSON.parse(raw) as UserProfile`
 * cast with a codec-based runtime type validation approach.  In the Multi-Container
 * ECS Fargate Task deployment, a sidecar validation container uses this same codec
 * to intercept and validate all inbound traffic before passing it to the primary
 * application container, ensuring runtime type safety that complements compile-time
 * checks and prevents crashes or security issues in Kubernetes / ECS pods.
 */
export const UserProfileCodec = t.type({
  id:   t.string,
  name: t.string,
});

/** TypeScript type inferred from the io-ts codec – no manual interface needed */
export type UserProfile = t.TypeOf<typeof UserProfileCodec>;

// ---------------------------------------------------------------------------
// SSM Parameter Store helpers (ECS Fargate contract-version check)
// ---------------------------------------------------------------------------

/**
 * Fetch the *expected* API contract version from AWS SSM Parameter Store.
 * Returns `null` when the SSM call fails so callers can decide whether to
 * treat that as a hard error or a soft warning.
 */
async function getExpectedContractVersion(): Promise<string | null> {
  const paramName = process.env.SSM_API_CONTRACT_PARAM ?? '/storefront/api/contract-version';

  const ssmUrl =
    `http://localhost:2773/systemsmanager/parameters/get` +
    `?name=${encodeURIComponent(paramName)}&withDecryption=false`;

  try {
    const res = await fetch(ssmUrl, {
      headers: {
        'X-Aws-Parameters-Secrets-Token': process.env.AWS_SESSION_TOKEN ?? '',
      },
    });

    if (!res.ok) {
      console.warn(
        `[SSM] Could not fetch contract version parameter "${paramName}" ` +
        `(HTTP ${res.status}). Skipping contract-version check.`
      );
      return null;
    }

    const body = await res.json() as { Parameter?: { Value?: string } };
    return body?.Parameter?.Value ?? null;
  } catch (err) {
    console.warn('[SSM] SSM agent unreachable – skipping contract-version check.', err);
    return null;
  }
}

/**
 * Fetch the *actual* contract version advertised by the live API.
 * Returns `null` when the endpoint is unavailable.
 */
async function getLiveContractVersion(apiBaseUrl: string): Promise<string | null> {
  try {
    const res = await fetch(`${apiBaseUrl}/version`);
    if (!res.ok) return null;

    const raw  = await res.json() as unknown;
    const parsed = ApiVersionSchema.safeParse(raw);
    return parsed.success ? parsed.data.contractVersion : null;
  } catch {
    return null;
  }
}

/**
 * Validate that the live API contract version matches the version stored in
 * SSM Parameter Store.  If they differ the ECS Fargate task exits with a
 * non-zero code so the orchestrator can restart / alert rather than silently
 * processing malformed data.
 *
 * Call this function once during application startup.
 */
export async function validateApiContractVersion(apiBaseUrl: string): Promise<void> {
  const [expected, live] = await Promise.all([
    getExpectedContractVersion(),
    getLiveContractVersion(apiBaseUrl),
  ]);

  if (expected === null || live === null) {
    // One side is unavailable – log a warning but do not block startup
    console.warn(
      '[ContractVersion] Unable to perform full contract-version check ' +
      `(expected=${expected ?? 'unavailable'}, live=${live ?? 'unavailable'}). ` +
      'Proceeding with caution.'
    );
    return;
  }

  if (expected !== live) {
    console.error(
      `[ContractVersion] API contract drift detected! ` +
      `Expected "${expected}" (from SSM) but live API reports "${live}". ` +
      'Exiting to prevent processing of incompatible data.'
    );
    // Graceful exit – ECS Fargate will restart the task and trigger an alert
    process.exit(1);
  }

  console.info(`[ContractVersion] API contract version "${live}" verified successfully.`);
}

// ---------------------------------------------------------------------------
// Public API functions – fully typed, validated
// ---------------------------------------------------------------------------

/**
 * Load data from the /data endpoint.
 *
 * - Resolves API base URL from AppConfig / environment variable (no hardcoded URL).
 * - Validates the response against `DataResponseSchema` at runtime.
 * - Throws a descriptive error (instead of crashing with a type error) when
 *   the response does not match the expected schema.
 */
export async function load(): Promise<DataResponse> {
  const config     = await getAppConfig();
  const apiBaseUrl = config.API_BASE_URL ?? process.env.API_BASE_URL ?? 'https://api.acme.com';

  const res = await fetch(`${apiBaseUrl}/data`);

  if (!res.ok) {
    throw new Error(
      `[load] API request failed: HTTP ${res.status} ${res.statusText}`
    );
  }

  const raw    = await res.json() as unknown;
  const parsed = DataResponseSchema.safeParse(raw);

  if (!parsed.success) {
    throw new Error(
      `[load] API response failed schema validation: ${parsed.error.message}`
    );
  }

  return parsed.data;
}

/**
 * Parse and validate a raw user-profile JSON string using io-ts codec-based
 * runtime type validation.
 *
 * Remediation for cz-ts-1015 (Lines 9–9 of source api.ts):
 * Replaces the previous `JSON.parse(raw) as UserProfile` cast (which provided
 * no runtime safety) with an io-ts codec decode that produces a detailed
 * validation report when the input does not conform to the expected shape.
 *
 * In the Multi-Container ECS Fargate Task deployment, a sidecar validation
 * container intercepts all inbound traffic and applies the same UserProfileCodec
 * before forwarding validated requests to the primary application container,
 * ensuring no type-confused data reaches the core business logic.
 */
export function handleInput(raw: string): UserProfile {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`[handleInput] Invalid JSON input: ${(err as Error).message}`);
  }

  // io-ts codec-based runtime type validation (cz-ts-1015 remediation)
  const decodeResult = UserProfileCodec.decode(parsed);

  if (isLeft(decodeResult)) {
    // PathReporter produces human-readable validation error messages
    const validationErrors = PathReporter.report(decodeResult).join('; ');
    throw new Error(
      `[handleInput] Input failed io-ts codec validation: ${validationErrors}`
    );
  }

  return decodeResult.right;
}
