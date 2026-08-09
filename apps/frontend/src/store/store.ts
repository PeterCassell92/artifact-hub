import { configureStore, type PreloadedStateShapeFromReducersMapObject } from "@reduxjs/toolkit";
import notifications from "./slices/notifications";

const reducer = { notifications };

/** Factory so tests can build an isolated store (see frontend-component-testing skill). */
export function makeStore(
  preloadedState?: PreloadedStateShapeFromReducersMapObject<typeof reducer>,
) {
  return configureStore({ reducer, preloadedState });
}

export const store = makeStore();

export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
