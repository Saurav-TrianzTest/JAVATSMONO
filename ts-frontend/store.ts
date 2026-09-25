// Typed Redux state with serialization guard middleware
import { createStore, applyMiddleware, Middleware, Action } from 'redux';

// --- Strongly-typed state interfaces (replaces `any` on line 2) ---
export interface UserState {
  id: string | null;
  name: string | null;
  email: string | null;
  isAuthenticated: boolean;
}

export interface CartItem {
  productId: string;
  quantity: number;
  price: number;
}

export interface CartState {
  items: CartItem[];
  total: number;
}

export interface RootState {
  user: UserState;
  cart: CartState;
}

// --- Strongly-typed action interface (replaces `any` on line 4) ---
export interface AppAction extends Action<string> {
  payload?: Record<string, unknown>;
}

// --- Initial state ---
export const initialState: RootState = {
  user: { id: null, name: null, email: null, isAuthenticated: false },
  cart: { items: [], total: 0 },
};

// --- Redux serializable check middleware ---
// Detects non-serializable values in state/actions to prevent state corruption
// and memory leaks in long-running containers (ECS Fargate / Kubernetes pods).
const serializableCheckMiddleware: Middleware =
  (_storeApi) => (next) => (action: unknown) => {
    const typedAction = action as AppAction;

    const isSerializable = (value: unknown): boolean => {
      if (value === null || value === undefined) return true;
      const t = typeof value;
      if (t === 'string' || t === 'number' || t === 'boolean') return true;
      if (Array.isArray(value)) return value.every(isSerializable);
      if (t === 'object') {
        return Object.values(value as Record<string, unknown>).every(
          isSerializable
        );
      }
      return false;
    };

    if (!isSerializable(typedAction)) {
      console.error(
        '[Redux SerializableCheck] Non-serializable value detected in action:',
        typedAction.type
      );
    }

    const result = next(action);

    return result;
  };

// --- Typed reducer (replaces untyped `state: any` and `action: any` on line 4) ---
export function reducer(
  state: RootState = initialState,
  action: AppAction
): RootState {
  switch (action.type) {
    default:
      return state;
  }
}

// --- Store creation with serialization guard middleware ---
export const store = createStore(
  reducer,
  applyMiddleware(serializableCheckMiddleware)
);

export type AppDispatch = typeof store.dispatch;
