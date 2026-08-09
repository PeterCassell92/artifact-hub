import { useEffect, type ReactNode } from "react";

interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

/**
 * The single base modal (docs/development/frontend-patterns.md §5d). All dialogs — including
 * confirmations that REPLACE window.confirm — render inside this so they are consistent and
 * testable (`getByRole('dialog')`). Owns role/aria, Escape-to-close, backdrop.
 */
export function Modal({ open, title, onClose, children, footer }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/40"
        aria-hidden="true"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative z-10 w-full max-w-md rounded-lg bg-white p-5 shadow-xl"
      >
        <h2 className="text-lg font-semibold">{title}</h2>
        <div className="mt-3 text-sm text-neutral-700">{children}</div>
        {footer ? (
          <div className="mt-4 flex justify-end gap-2">{footer}</div>
        ) : null}
      </div>
    </div>
  );
}
