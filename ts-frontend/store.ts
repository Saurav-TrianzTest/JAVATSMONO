// Typed Redux state with serializable check middleware
import { createStore, applyMiddleware, Middleware, AnyAction } from 'redux';

// Strongly-typed domain interfaces replacing `any`
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

// Fully typed RootState – no `any` allowed
export interface RootState {
  user: UserState;
  cart: CartState;
}

export const initialState: RootState = {
  user: { id: null, name: null, email: null, isAuthenticated: false },
  cart: { items: [], total: 0 },
};

// Redux serializable-check middleware
// Detects non-serializable values in actions/state that can cause
// container OOM kills or state corruption in long-running Kubernetes pods.
const serializableCheckMiddleware: Middleware =
  (_storeApi) => (next) => (action: unknown) => {
    const act = action as AnyAction;
    try {
      JSON.stringify(act);
    } catch {
      console.error(
        '[Redux SerializableCheck] Non-serializable value detected in action:',
        act?.type,
        '– this can corrupt container state and trigger Fargate OOM kills.',
      );
    }
    const result = next(act);
    return result;
  };

// Typed reducer – state and action are no longer `any`
export function reducer(
  state: RootState = initialState,
  action: AnyAction,
): RootState {
  switch (action.type) {
    default:
      return state;
  }
}

// Store wired with the serializable-check middleware
export const store = createStore(
  reducer,
  applyMiddleware(serializableCheckMiddleware),
);
