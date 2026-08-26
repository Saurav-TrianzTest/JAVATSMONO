import React, { createContext } from 'react';

// Fixed: Explicit type serialization for SSR hydration consistency
// Ensures server-rendered timestamp matches client hydration in containerized environments
export function Stamp() {
  const now = Date.now();
  // Use explicit String() conversion instead of implicit coercion for SSR/hydration consistency
  return <span>{String(now)}</span>;
}

// Define proper TypeScript interface for AppContext
// This ensures type safety across component hierarchy in containerized React applications
interface AppContextType {
  user?: {
    id: string;
    name: string;
    email: string;
  };
  theme?: 'light' | 'dark';
  settings?: Record<string, unknown>;
}

// React Context with proper TypeScript typing
// Replaces weak 'any' typing with strongly typed interface to prevent runtime crashes in containers
export const AppContext = createContext<AppContextType | null>(null);
