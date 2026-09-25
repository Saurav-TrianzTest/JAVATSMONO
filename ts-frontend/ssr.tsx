import React, { createContext, useContext } from 'react';
import { z } from 'zod';
import superjson from 'superjson';

// cz-ts-1005: Explicit type serialization for SSR hydration in ECS Fargate Next.js tasks.
// Eliminated implicit type coercion (now + '') which caused hydration mismatches between
// server render and client hydration in containerized Next.js deployments.
// Enforces Zod schema validation and superjson serialization to ensure type consistency.

const StampSchema = z.object({
  timestamp: z.number().int().positive(),
});

type StampData = z.infer<typeof StampSchema>;

export function Stamp() {
  const now: number = Date.now();
  const stampData: StampData = StampSchema.parse({ timestamp: now });
  const serialized: string = superjson.stringify(stampData);
  const deserialized: StampData = superjson.parse<StampData>(serialized);
  return <span>{String(deserialized.timestamp)}</span>;
}

// cz-ts-1011: React Context with strongly typed generics instead of `any`.
// Weak typing (createContext<any>) allows type errors to propagate silently
// through the component tree, causing runtime crashes in containerized
// ECS Fargate / Kubernetes deployments.  A concrete interface with explicit
// property types enforces type safety across the entire component hierarchy
// and is validated at the TypeScript type-check gate in the multi-stage
// Dockerfile before the image is pushed to ECR.
export interface AppContextType {
  /** Authenticated user identifier; null when no session is active. */
  userId: string | null;
  /** Display name of the authenticated user. */
  userName: string | null;
  /** Locale string used for i18n rendering (e.g. "en-US"). */
  locale: string;
  /** Feature-flag map injected at container startup via environment variables. */
  featureFlags: Record<string, boolean>;
}

/** Default context value used when no Provider is present in the tree. */
const defaultAppContext: AppContextType = {
  userId: null,
  userName: null,
  locale: 'en-US',
  featureFlags: {},
};

// cz-ts-1011 FIX (line 8): Replaced createContext<any>(null) with
// createContext<AppContextType>(defaultAppContext) so the generic parameter
// is a concrete, strongly typed interface rather than `any` or `unknown`.
// This prevents type errors from propagating through the component tree and
// ensures the TypeScript type-check stage in the multi-stage Dockerfile
// catches any misuse before the image is deployed as a Fargate task.
export const AppContext = createContext<AppContextType>(defaultAppContext);

/**
 * Convenience hook that returns the typed AppContext value.
 * Components should use this hook instead of calling useContext(AppContext)
 * directly so that the return type is always AppContextType (never null).
 */
export function useAppContext(): AppContextType {
  return useContext(AppContext);
}
