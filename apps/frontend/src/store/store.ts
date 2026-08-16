import { combineReducers, configureStore } from "@reduxjs/toolkit";
import notifications from "./slices/notifications";

const rootReducer = combineReducers({ notifications });

/** Factory so tests can build an isolated store (see frontend-component-testing skill). */
export function makeStore(preloadedState?: Partial<ReturnType<typeof rootReducer>>) {
  return configureStore({ reducer: rootReducer, preloadedState });
}

export const store = makeStore();

export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
