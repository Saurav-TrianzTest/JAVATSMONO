import { z } from 'zod';
// Zod schema validation for API responses
const UserSchema = z.object({ id: z.string(), name: z.string() });
export async function getUser() {
  const res = await fetch('/api/user');
  return UserSchema.parse(await res.json());
}
// Type-safe environment configuration
interface Env { API_URL: string; }
export const env: Env = { API_URL: import.meta.env.VITE_API_URL as string };
// Branded types for API identifiers
type UserId = string & { readonly __brand: 'UserId' };
export function makeId(s: string): UserId { return s as UserId; }
// SSR platform guard
export function safeWindow(): number {
  if (typeof window !== 'undefined') {
    return window.innerWidth;
  }
  return 0;
}
