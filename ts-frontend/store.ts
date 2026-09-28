// Typed Redux state with serialization guard middleware (cz-ts-1010)
// Replaces untyped `any` state fields with strict TypeScript interfaces to prevent
// state corruption, memory leaks, and OOM kills in long-running Kubernetes/ECS containers.

import { configureStore, createReducer, PayloadAction } from '@reduxjs/toolkit';
import { getDefaultMiddleware } from '@reduxjs/toolkit';

// ── Strongly-typed domain models ──────────────────────────────────────────────

/** Typed User state – replaces `user: any` (cz-ts-1010, line 2) */
export interface UserState {
  id: string | null;
  name: string | null;
  email: string | null;
  isAuthenticated: boolean;
}

/** Typed Cart item */
export interface CartItem {
  productId: string;
  name: string;
  quantity: number;
  price: number;
}

/** Typed Cart state – replaces `cart: any` (cz-ts-1010, line 2) */
export interface CartState {
  items: CartItem[];
  totalAmount: number;
}

/** Root application state – fully typed, no `any` (cz-ts-1010, line 2) */
export interface RootState {
  user: UserState;
  cart: CartState;
}

// ── Initial state ─────────────────────────────────────────────────────────────

const initialUserState: UserState = {
  id: null,
  name: null,
  email: null,
  isAuthenticated: false,
};

const initialCartState: CartState = {
  items: [],
  totalAmount: 0,
};

export const initialState: RootState = {
  user: initialUserState,
  cart: initialCartState,
};

// ── Typed action union ────────────────────────────────────────────────────────

/** Discriminated union of all known actions – replaces `action: any` (cz-ts-1010, line 4) */
export type AppAction =
  | PayloadAction<UserState, 'user/set'>
  | PayloadAction<CartItem, 'cart/addItem'>
  | PayloadAction<string, 'cart/removeItem'>
  | PayloadAction<undefined, 'cart/clear'>
  | { type: '@@INIT' };

// ── Typed reducer – no `any` parameters (cz-ts-1010, line 4) ─────────────────

export function reducer(
  state: RootState = initialState,
  action: AppAction,
): RootState {
  switch (action.type) {
    case 'user/set':
      return { ...state, user: action.payload };

    case 'cart/addItem': {
      const item = action.payload;
      const existing = state.cart.items.find(
        (i) => i.productId === item.productId,
      );
      const updatedItems = existing
        ? state.cart.items.map((i) =>
            i.productId === item.productId
              ? { ...i, quantity: i.quantity + item.quantity }
              : i,
          )
        : [...state.cart.items, item];
      const totalAmount = updatedItems.reduce(
        (sum, i) => sum + i.price * i.quantity,
        0,
      );
      return { ...state, cart: { items: updatedItems, totalAmount } };
    }

    case 'cart/removeItem': {
      const updatedItems = state.cart.items.filter(
        (i) => i.productId !== action.payload,
      );
      const totalAmount = updatedItems.reduce(
        (sum, i) => sum + i.price * i.quantity,
        0,
      );
      return { ...state, cart: { items: updatedItems, totalAmount } };
    }

    case 'cart/clear':
      return { ...state, cart: initialCartState };

    default:
      return state;
  }
}

// ── Redux Serializable Check Middleware (ECS Fargate / CloudWatch guard) ──────
// Detects non-serializable values in state/actions before they cause OOM kills
// in Fargate tasks. Pair with a CloudWatch alarm on ECS task memory utilization
// (threshold: 80 %) to receive early warning before the container is killed.

const serializabilityMiddleware = (storeAPI: { getState: () => RootState }) =>
  (next: (action: AppAction) => void) =>
  (action: AppAction): void => {
    try {
      JSON.stringify(action);
    } catch {
      console.error(
        '[Redux SerializabilityGuard] Non-serializable action detected – ' +
          'this can corrupt container state and trigger ECS OOM kills.',
        action,
      );
      return; // drop the action to protect container stability
    }
    next(action);
    try {
      JSON.stringify(storeAPI.getState());
    } catch {
      console.error(
        '[Redux SerializabilityGuard] Non-serializable state detected after action:',
        action.type,
      );
    }
  };

// ── Configured store with serialization guard ─────────────────────────────────

export const store = configureStore<RootState, AppAction>({
  reducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      // Built-in RTK serializableCheck – catches non-serializable values early
      serializableCheck: {
        warnAfter: 32,
      },
    }).concat(serializabilityMiddleware as any),
});

export type AppDispatch = typeof store.dispatch;
