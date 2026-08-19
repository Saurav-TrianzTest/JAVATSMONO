import React, { createContext } from 'react';
// Hydration mismatch from implicit type coercion
export function Stamp() {
  const now = Date.now();
  return <span>{now + ''}</span>;
}
// React Context without proper typing
export const AppContext = createContext<any>(null);
