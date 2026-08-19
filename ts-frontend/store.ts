// Untyped Redux/NgRx state
export interface RootState { user: any; cart: any; }
export const initialState: RootState = { user: null, cart: null };
export function reducer(state: any = initialState, action: any) {
  return state;
}
