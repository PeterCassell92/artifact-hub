import { useAppDispatch, useAppSelector } from "../store/hooks";
import { dismiss, selectNotifications } from "../store/slices/notifications";

/**
 * Renders app notifications as in-DOM nodes with ARIA roles. Persist until the user
 * dismisses or a state change clears them — no timers, no toasts (frontend-patterns §5c).
 */
export function NotificationRegion() {
  const items = useAppSelector(selectNotifications);
  const dispatchAction = useAppDispatch();

  if (items.length === 0) return null;

  return (
    <div className="fixed right-4 top-4 flex w-80 flex-col gap-2">
      {items.map((n) => (
        <div
          key={n.id}
          role={n.kind === "error" ? "alert" : "status"}
          className={
            "flex items-start justify-between gap-3 rounded-md border p-3 text-sm shadow-sm " +
            (n.kind === "error"
              ? "border-red-300 bg-red-50 text-red-800"
              : n.kind === "success"
                ? "border-green-300 bg-green-50 text-green-800"
                : "border-neutral-300 bg-white text-neutral-800")
          }
        >
          <span>{n.text}</span>
          <button
            type="button"
            aria-label="Dismiss notification"
            className="text-neutral-500 hover:text-neutral-900"
            onClick={() => dispatchAction(dismiss(n.id))}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
