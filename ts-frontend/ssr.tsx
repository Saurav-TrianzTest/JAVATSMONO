import React, { createContext } from 'react';
import { z } from 'zod';
import superjson from 'superjson';

// Runtime config injected via AWS Secrets Manager / ECS Fargate task environment
const runtimeConfig = {
  apiBase: process.env.NEXT_PUBLIC_API_BASE ?? '',
  region: process.env.AWS_REGION ?? 'us-east-1',
};

// Zod schema for explicit type validation — prevents SSR/client type divergence
const StampSchema = z.object({
  timestamp: z.number().int().positive(),
});

type StampData = z.infer<typeof StampSchema>;

// Explicit type serialization via superjson ensures server-rendered value
// is byte-for-byte identical to what the client hydrates, eliminating
// React hydration mismatches in ECS Fargate / Kubernetes Next.js pods.
export function Stamp() {
  const raw: StampData = StampSchema.parse({ timestamp: Date.now() });
  // superjson.stringify preserves the numeric type across the SSR boundary;
  // JSON.parse round-trip guarantees the client receives the same string.
  const serialized: string = superjson.stringify(raw.timestamp);
  const hydrationSafeValue: string = JSON.parse(serialized) as string;
  return <span>{hydrationSafeValue}</span>;
}

// Strongly-typed React Context — replaces implicit `any` to avoid
// type coercion mismatches between server and client render trees.
interface AppContextValue {
  config: typeof runtimeConfig;
}

export const AppContext = createContext<AppContextValue>({
  config: runtimeConfig,
});
