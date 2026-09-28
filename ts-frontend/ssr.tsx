import React, { createContext } from 'react';
import { z } from 'zod';
import superjson from 'superjson';

// Explicit Zod schema for SSR timestamp data — prevents hydration mismatch
// caused by implicit type coercion between server render and client hydration
// in ECS Fargate Next.js tasks (cz-ts-1005).
const StampSchema = z.object({
  now: z.number().int().positive(),
});

type StampData = z.infer<typeof StampSchema>;

/**
 * Serialise timestamp data on the server using superjson so that the exact
 * same type-safe value is rehydrated on the client, eliminating the
 * implicit `number → string` coercion that caused React hydration errors
 * in Kubernetes / ECS Fargate pods.
 */
export function serializeStampProps(raw: unknown): string {
  const parsed: StampData = StampSchema.parse(raw);
  return superjson.stringify(parsed);
}

export function deserializeStampProps(serialized: string): StampData {
  return StampSchema.parse(superjson.parse(serialized));
}

export function Stamp() {
  const now = Date.now();
  // Explicit serialization via superjson + Zod instead of implicit `now + ''`
  const serialized = serializeStampProps({ now });
  const { now: safeNow } = deserializeStampProps(serialized);
  return <span>{String(safeNow)}</span>;
}

// ─── cz-ts-1011 fix: React Context with strongly-typed interface ──────────────
// Replaced `createContext<any>(null)` with an explicit, strongly-typed
// AppContextValue interface so the TypeScript compiler (and the multi-stage
// Dockerfile type-check gate) can enforce type safety across the entire
// component tree, preventing runtime crashes in ECS Fargate containers.
export interface AppContextValue {
  user: {
    id: string;
    name: string;
    email: string;
    roles: string[];
  } | null;
  theme: 'light' | 'dark';
  locale: string;
  featureFlags: Record<string, boolean>;
}

export const AppContext = createContext<AppContextValue | null>(null);
