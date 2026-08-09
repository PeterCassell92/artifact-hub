import { createSlice, nanoid, type PayloadAction } from "@reduxjs/toolkit";
import type { NotificationKind } from "contracts";

/**
 * The sanctioned notification pattern (docs/development/frontend-patterns.md §5c):
 * state-driven, in-DOM, dismissed by the USER or a state change — NEVER a timer.
 * No toasts, no window.alert.
 */
export interface AppNotification {
  id: string;
  kind: NotificationKind;
  text: string;
}

interface NotificationsState {
  items: AppNotification[];
}

const initialState: NotificationsState = { items: [] };

const slice = createSlice({
  name: "notifications",
  initialState,
  reducers: {
    notify: {
      reducer(state, action: PayloadAction<AppNotification>) {
        state.items.push(action.payload);
      },
      prepare(kind: NotificationKind, text: string) {
        return { payload: { id: nanoid(), kind, text } };
      },
    },
    dismiss(state, action: PayloadAction<string>) {
      state.items = state.items.filter((n) => n.id !== action.payload);
    },
    clearAll(state) {
      state.items = [];
    },
  },
});

export const { notify, dismiss, clearAll } = slice.actions;
export default slice.reducer;

export const selectNotifications = (s: {
  notifications: NotificationsState;
}): AppNotification[] => s.notifications.items;
