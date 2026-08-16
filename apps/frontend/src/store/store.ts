import { combineReducers, configureStore } from "@reduxjs/toolkit";
import notifications from "./slices/notifications";
import { api } from "./api";

const rootReducer = combineReducers({ notifications, [api.reducerPath]: api.reducer });

/** Factory so tests can build an isolated store (see frontend-component-testing skill). */
export function makeStore(preloadedState?: Partial<ReturnType<typeof rootReducer>>) {
  return configureStore({
    reducer: rootReducer,
    preloadedState,
    middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(api.middleware),
  });
}

export const store = makeStore();

export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
