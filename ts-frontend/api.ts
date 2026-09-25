// cz-ts-1015: io-ts codec-based runtime type validation for ECS Fargate sidecar pattern.
// All inbound data is validated through io-ts codecs before being passed to the primary
// application container, preventing type-confused data from reaching business logic.
// The sidecar validation container intercepts traffic and applies these codecs at the
// ECS Fargate task boundary, ensuring runtime type safety in containerized deployments.
import * as t from 'io-ts';
import { isRight } from 'fp-ts/Either';

// ── API base URL from ECS Fargate task environment variable ──────────────────
const API_BASE_URL: string = process.env.API_BASE_URL ?? '';

// ── io-ts codec definitions ──────────────────────────────────────────────────
// DataResponse codec: validates the shape of /data endpoint responses at runtime.
const DataResponseCodec = t.type({
  id: t.string,
  payload: t.unknown,
});

/** Strongly-typed shape returned by the /data endpoint. */
export type DataResponse = t.TypeOf<typeof DataResponseCodec>;

// UserProfile codec: validates raw user input before it enters the application.
const UserProfileCodec = t.type({
  id: t.string,
  name: t.string,
});

/** Strongly-typed user profile validated at runtime via io-ts codec. */
export type UserProfile = t.TypeOf<typeof UserProfileCodec>;

// ── Sidecar validation helper ────────────────────────────────────────────────
/**
 * Decodes a value using the provided io-ts codec.
 * Mirrors the sidecar validation container's codec-based interception logic:
 * if the value does not conform to the codec, an error is thrown so the
 * ECS Fargate task fails fast rather than propagating malformed data.
 *
 * @param codec  - io-ts codec to validate against
 * @param value  - raw unknown value received from the network or user input
 * @param label  - human-readable label used in error messages
 */
function decodeOrThrow<A>(codec: t.Decoder<unknown, A>, value: unknown, label: string): A {
  const result = codec.decode(value);
  if (isRight(result)) {
    return result.right;
  }
  // Collect all validation errors from the io-ts PathReporter for diagnostics.
  const errors = result.left
    .map((e) => e.context.map((c) => c.key).join('.') + ': ' + e.message)
    .join('; ');
  throw new Error(
    `[cz-ts-1015] Runtime type validation failed for "${label}". ` +
      `io-ts codec errors: ${errors}. ` +
      `Container will reject this payload to prevent type-confused data from reaching the application.`
  );
}

// ── Typed API response with io-ts runtime validation ────────────────────────
/**
 * Fetches /data and validates the response against DataResponseCodec at runtime.
 * Replaces the previous untyped `Promise<any>` signature that allowed malformed
 * responses to propagate silently and crash the container.
 *
 * The io-ts codec decode step mirrors the sidecar validation container's
 * interception logic in the ECS Fargate multi-container task.
 */
export async function load(): Promise<DataResponse> {
  const res = await fetch(`${API_BASE_URL}/data`);
  if (!res.ok) {
    throw new Error(
      `[cz-ts-1015] /data request failed with HTTP ${res.status}`
    );
  }
  const raw: unknown = await res.json();
  // io-ts codec-based runtime validation – throws if the server returns an
  // unexpected shape, enabling the container to fail fast before processing.
  return decodeOrThrow(DataResponseCodec, raw, 'DataResponse');
}

// ── Input handling with io-ts codec runtime validation ───────────────────────
/**
 * Parses and validates raw JSON input against UserProfileCodec at runtime.
 * Replaces the previous unsafe `JSON.parse(raw) as UserProfile` cast that
 * bypassed runtime type checks and allowed type-confused data into the app.
 *
 * The sidecar validation container applies the same UserProfileCodec to
 * intercept and validate all inbound user-supplied payloads at the ECS
 * Fargate task boundary before forwarding to the primary application container.
 */
export function handleInput(raw: string): UserProfile {
  const parsed: unknown = JSON.parse(raw);
  // io-ts codec decode – throws a descriptive error instead of silently
  // accepting bad data, preventing crashes in Kubernetes / ECS Fargate pods.
  return decodeOrThrow(UserProfileCodec, parsed, 'UserProfile');
}
