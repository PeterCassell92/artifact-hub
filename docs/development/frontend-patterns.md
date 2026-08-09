# Frontend Development Patterns

*Status: standards. Related: [`../frontend/`](../frontend/) (what we build),
[`../architecture/09-testing-strategy.md`](../architecture/09-testing-strategy.md) (how we test),
and the Claude skills `frontend-patterns` + `frontend-component-testing`.*

These are the conventions the SPA is built to. They exist to keep the UI **modular, professional,
and deterministically testable**.

---

## 1. Stack

- **React** (SPA) + **TypeScript**.
- **Redux Toolkit (RTK)** for application state — slices + typed hooks (`useAppSelector` /
  `useAppDispatch`) + selectors. (RTK is the mainstream, batteries-included Redux; no hand-rolled
  store boilerplate.)
- **Tailwind CSS** for styling — utility-first, configured tokens.
- **Jest + React Testing Library** for component unit tests (`*.test.tsx`).
- Shared API/MCP types from `packages/contracts`.

## 2. Component principles

- **Small and modular** — one responsibility per component; compose rather than grow monoliths.
- **Presentational vs container** — keep data/state wiring at the edges (containers/hooks); keep
  leaf components pure and prop-driven so they're trivial to unit test.
- **Typed props**, no `any`; reuse `packages/contracts` types for API shapes.
- **Colocate tests** as `<Component>.test.tsx` next to the component.
- **Accessible by default** — real labels, roles, and semantics (this is also what makes tests
  robust; see §5).

## 3. State management (Redux Toolkit)

- **Global/cross-cutting state in RTK slices**: session/user, active filters & search, and the
  **notifications** slice (see §4). Server data via a thin API client + slices (or RTK Query if we
  adopt it later).
- **Local UI state stays local** (`useState`) — don't put ephemeral toggles in Redux.
- **Select via selectors**, not deep prop-drilling. Keep slices normalized and small.
- Components read state with `useAppSelector` and dispatch typed actions — never mutate outside a
  reducer.

## 4. Styling (Tailwind)

- **Utility-first**; extract a component when a class list repeats or a unit is reused.
- **Professional and restrained** — clean spacing, a small type scale, a limited neutral palette
  with one accent. **Do not over-design**: no bespoke illustration/asset work, no heavy animation.
  Consistency > flourish.
- Centralize tokens (colors, spacing, radius) in `tailwind.config` so the look is coherent.

---

## 5. Anti-patterns — DO NOT USE (testability rule)

Two notification anti-patterns are **banned** because they make the app hard/flaky to test —
especially once we consider automated UI testing:

### 5a. No browser dialogs: `window.alert` / `window.confirm` / `window.prompt`
- They render **outside the DOM** and **block the JS thread**, so React Testing Library cannot see
  or drive them, and end-to-end drivers can only handle them through brittle out-of-band hooks.
- **Instead:**
  - Notifications/errors → an **in-DOM** element (see 5c).
  - Confirmations (e.g. "revoke this link?") → an **in-app modal/dialog component** that renders in
    the DOM with buttons the tests can click (`getByRole('dialog')`, `getByRole('button', …)`).
  - Text input → a real form field, never `window.prompt`.

### 5b. No toast notifications
- Toasts **auto-dismiss on a timer**, creating a race between the assertion and the disappearance
  (flaky tests), and they're easy to miss. Timing-based UI is exactly what we're avoiding.
- **Instead:** use persistent, state-driven, in-DOM notifications (5c) that stay until the user
  dismisses them or the relevant state changes — **no timers**.

### 5c. The sanctioned pattern: a state-driven, in-DOM `NotificationRegion`
- A **notifications slice** holds an array of messages `{ id, kind: 'success'|'error'|'info', text }`.
- A **`NotificationRegion`** component renders them in the DOM with appropriate ARIA roles
  (`role="alert"` for errors, `role="status"` for info/success) so screen readers and tests both
  see them.
- Messages are **dismissed by the user** (a close button dispatches a remove action) or **cleared
  by a state transition** (e.g. navigating away, a successful re-fetch) — **never by a setTimeout**.
- Form-level feedback (validation, submit results) renders **inline next to the field/form**, not
  as a global popup.

Result: every notification is a queryable DOM node with no timing dependency, so
`getByRole('alert')` / `getByText(...)` assert reliably.

### 5d. A single base `Modal` component (if we use modals)
We may not need modals in the current scope, but **if/when we do**, build them all on one shared
base `Modal` so modal information is displayed consistently and accessibly — don't hand-roll each
dialog.

- One **`<Modal>`** primitive owns: the `role="dialog"` + `aria-modal`, focus trap + restore,
  **Escape to close**, backdrop click behaviour, and consistent Tailwind chrome (header/body/
  footer, spacing, close button).
- Specific dialogs (e.g. a **confirmation** dialog replacing `window.confirm`, or a details dialog)
  are thin components that render **inside** `<Modal>` and pass content + action buttons.
- Modal open/close state is driven by component or Redux state (never a browser dialog), so tests
  open it and assert `getByRole('dialog')` then click its buttons — fully in the DOM.

This gives us a ready pattern the moment a modal is needed, with uniform look, behaviour, and
testability.

---

## 6. Testing hooks (see 09 §5 and the `frontend-component-testing` skill)

- Render components wrapped in the **Redux `<Provider>`** (with a test store) and the **router**.
- **Query by role/label/text** (accessible queries) — not test-ids or DOM structure.
- Assert on **in-DOM notifications** (5c), never on alerts/toasts.
- Mock the API layer; keep `packages/contracts` types honest in the mocks.
- **No fake timers** for notification behaviour — because notifications don't rely on timers.
