import { useEffect, type Dispatch, type RefObject, type SetStateAction } from "react";

/** Closes an open popover/dropdown when the user presses Escape or clicks/touches outside
 * `containerRef`. Shared by UserProfilePopover and the ArtifactFilters "Filters" dropdown. */
export function useCloseOnOutsideOrEscape(
  containerRef: RefObject<HTMLElement | null>,
  open: boolean,
  setOpen: Dispatch<SetStateAction<boolean>>,
) {
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
  }, [open, setOpen, containerRef]);
}
