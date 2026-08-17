/** A small hover/focus info glyph — native `title` tooltip on hover, `aria-label` for
 * screen readers, keyboard-focusable since it's a real `<button>`. Kept deliberately plain
 * (no custom popover) per the "don't over-design" rule (frontend-patterns skill). */
export function InfoTooltip({ label }: { label: string }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-neutral-300 text-[10px] font-medium leading-none text-neutral-500 hover:bg-neutral-100"
    >
      i
    </button>
  );
}
