---
name: frontend-patterns
description: Frontend development conventions for Artifact Hub's React SPA (apps/frontend). Use whenever writing or editing React components, Redux state, or Tailwind styling. Locks in modular components, Redux Toolkit state, Tailwind usage, and the BANNED anti-patterns — no window.alert/confirm/prompt and no toasts; use state-driven in-DOM notifications and in-app modals instead.
---

# Frontend patterns (Artifact Hub)

Stack: **React + TypeScript**, **Redux Toolkit** (state), **Tailwind** (styling), **Jest + React
Testing Library** (tests). Full rationale in
[docs/development/frontend-patterns.md](../../../docs/development/frontend-patterns.md).

## Do

- **Small, modular, single-responsibility components.** Keep leaf components pure/prop-driven;
  push state wiring to containers/hooks. Colocate `<Component>.test.tsx`.
- **Redux Toolkit** for cross-cutting state (session, filters/search, notifications). Local
  ephemeral UI state stays in `useState`. Read via `useAppSelector` + selectors; dispatch typed
  actions. Reuse `packages/contracts` types for API shapes.
- **Tailwind** utility-first; extract a component when class lists repeat. Professional and
  restrained — small type scale, limited neutral palette + one accent, tokens in `tailwind.config`.
  **Do not over-design** (no bespoke assets, no heavy animation).
- **Accessible markup** (roles/labels) — it doubles as robust test surface.

## DO NOT (banned anti-patterns — testability)

- ❌ **`window.alert` / `window.confirm` / `window.prompt`** — they live outside the DOM and block
  the thread; RTL/E2E can't drive them cleanly.
- ❌ **Toasts / auto-dismissing popups** — timer-based dismissal races test assertions → flaky.

## USE INSTEAD

- **Notifications** → a **notifications slice** + a **`NotificationRegion`** that renders messages
  in the DOM with ARIA roles (`role="alert"` for errors, `role="status"` for success/info).
  Messages persist until the **user dismisses** them or a **state transition** clears them —
  **never a `setTimeout`**.
- **Confirmations** ("revoke this share link?") → an **in-app modal/dialog** component in the DOM
  (`role="dialog"` + real buttons), not `window.confirm`.
- **Modals** → build them all on **one shared base `<Modal>`** component (owns `role="dialog"` +
  `aria-modal`, focus trap/restore, Escape-to-close, backdrop, consistent Tailwind chrome). Specific
  dialogs are thin wrappers rendered inside it. May not be needed yet — but if a modal is required,
  use this base so all modals are consistent and testable. See
  [docs/development/frontend-patterns.md](../../../docs/development/frontend-patterns.md) §5d.
- **Text input** → a real form field, not `window.prompt`.
- **Form feedback** (validation/submit results) → **inline** next to the field/form.

## Quick checklist before finishing a component

- [ ] No `window.alert/confirm/prompt`, no toast library
- [ ] Notifications/confirmations go through the slice + `NotificationRegion` / modal
- [ ] Cross-cutting state in RTK; local state in `useState`
- [ ] Typed props from `packages/contracts` where relevant
- [ ] Accessible roles/labels present
- [ ] `<Component>.test.tsx` added (see the `frontend-component-testing` skill)
