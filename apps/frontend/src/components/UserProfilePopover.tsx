import { useEffect, useRef, useState } from "react";
import type { UserView } from "contracts";

interface UserProfilePopoverProps {
  user: UserView;
}

/** Click the name/email in the header nav to reveal a small popover with profile details. */
export function UserProfilePopover({ user }: UserProfilePopoverProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onPointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open]);

  const joinDate = new Date(user.createdAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className="rounded-md px-1 py-1 font-medium text-neutral-700 hover:bg-neutral-100"
      >
        {user.name}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Your profile"
          className="absolute right-0 top-full z-20 mt-2 w-64 rounded-md border border-neutral-200 bg-white p-4 text-sm shadow-lg"
        >
          <dl className="space-y-2">
            <div>
              <dt className="text-xs font-medium text-neutral-500">Email</dt>
              <dd className="text-neutral-900">{user.email}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-neutral-500">Groups</dt>
              <dd className="text-neutral-900">{user.groupNames.join(", ") || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-neutral-500">Joined</dt>
              <dd className="text-neutral-900">{joinDate}</dd>
            </div>
          </dl>
        </div>
      )}
    </div>
  );
}
