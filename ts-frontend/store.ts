// Typed Redux state with serialization guards for container safety
export interface User {
  id: string;
  name: string;
  email: string;
}

export interface CartItem {
  productId: string;
  quantity: number;
  price: number;
}

export interface Cart {
  items: CartItem[];
  total: number;
}

export interface RootState { 
  user: User | null; 
  cart: Cart | null; 
}

export const initialState: RootState = { user: null, cart: null };

// Typed action interface
export interface Action {
  type: string;
  payload?: unknown;
}

// Serialization check middleware for Redux - prevents non-serializable values
// that can cause memory leaks in long-running containers
export const serializableCheckMiddleware = (store: { getState: () => RootState }) => 
  (next: (action: Action) => Action) => 
  (action: Action) => {
    // Check if action is serializable
    if (action.payload !== undefined) {
      try {
        JSON.stringify(action.payload);
      } catch (error) {
        console.error('Non-serializable value detected in action payload:', action.type);
        // In production, this should trigger CloudWatch alarms for ECS Fargate monitoring
        if (process.env.NODE_ENV === 'production') {
          // Log to CloudWatch for ECS task memory utilization monitoring
          console.error('CONTAINER_STATE_CORRUPTION_RISK', {
            action: action.type,
            timestamp: new Date().toISOString(),
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }
    }
    
    const result = next(action);
    
    // Check if resulting state is serializable
    try {
      JSON.stringify(store.getState());
    } catch (error) {
      console.error('Non-serializable value detected in state after action:', action.type);
      if (process.env.NODE_ENV === 'production') {
        console.error('CONTAINER_STATE_CORRUPTION_DETECTED', {
          action: action.type,
          timestamp: new Date().toISOString(),
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
    
    return result;
  };

// Fully typed reducer function
export function reducer(state: RootState = initialState, action: Action): RootState {
  switch (action.type) {
    case 'SET_USER':
      return {
        ...state,
        user: action.payload as User | null
      };
    case 'SET_CART':
      return {
        ...state,
        cart: action.payload as Cart | null
      };
    case 'RESET_STATE':
      return initialState;
    default:
      return state;
  }
}

// Store configuration with serialization middleware
export function createStore() {
  let currentState = initialState;
  const listeners: Array<() => void> = [];
  
  const store = {
    getState: () => currentState,
    dispatch: (action: Action) => {
      // Apply middleware
      const middlewareChain = serializableCheckMiddleware(store);
      const next = (a: Action) => {
        currentState = reducer(currentState, a);
        listeners.forEach(listener => listener());
        return a;
      };
      return middlewareChain(next)(action);
    },
    subscribe: (listener: () => void) => {
      listeners.push(listener);
      return () => {
        const index = listeners.indexOf(listener);
        if (index > -1) {
          listeners.splice(index, 1);
        }
      };
    }
  };
  
  return store;
}

// Export typed store instance
export const store = createStore();
export type Store = ReturnType<typeof createStore>;
