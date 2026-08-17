---
name: frontend-component-testing
description: How to unit-test Artifact Hub React components (*.test.tsx) with Jest + React Testing Library. Use whenever writing or reviewing frontend component tests. Enforces accessible queries, rendering with Redux Provider + router, deterministic assertions on in-DOM notifications, and NO reliance on window dialogs, toasts, or timers.
---

# Frontend component testing (Artifact Hub)

Runner: **Jest + React Testing Library** (`jsdom`). Tests live as `<Component>.test.tsx` next to
the component. See [docs/architecture/09-testing-strategy.md](../../../docs/architecture/09-testing-strategy.md)
§5 and the `frontend-patterns` skill.

## Render with the real providers

Wrap the unit under test in the app's providers so state/routing behave realistically:

```tsx
function renderWithProviders(ui, { store = makeTestStore(), route = "/" } = {}) {
  return render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
    </Provider>
  );
}
```

Provide a small `makeTestStore()` helper (RTK `configureStore` with the real reducers + optional
preloaded state).

## Query the way users perceive the UI

- Prefer **accessible queries**: `getByRole`, `getByLabelText`, `getByText`. Avoid test-ids and
  DOM-structure coupling.
- Interact via `userEvent` (clicks, typing), then assert on resulting DOM.

## Assert on in-DOM notifications, never dialogs/toasts

- Success/error feedback appears in the **`NotificationRegion`** — assert with
  `getByRole('alert')` / `getByRole('status')` / `getByText(...)`.
- Confirmations use an **in-app modal** — open it, assert `getByRole('dialog')`, click its buttons.
- ❌ Never write tests that spy on `window.alert/confirm/prompt` or wait for a toast to appear then
  disappear. If a component uses those, fix the component (see `frontend-patterns`), don't test around it.

## No timing dependence

- Notifications are **state-driven, not timer-driven**, so tests need **no fake timers** and no
  `waitFor` on a disappearing toast.
- Use `findBy*` only for genuine async (e.g. awaiting a mocked API resolve), not for animation/toast timing.

## Mock the boundary, keep types honest

- Mock the **API client** layer; type the mocks with `packages/contracts` so a contract change
  breaks the test (good).
- Don't mock Redux — use a real test store; that's the point of the Provider wrapper.

## Checklist

- [ ] Rendered with `Provider` (test store) + router
- [ ] Queries are role/label/text based
- [ ] Notification/confirmation assertions hit in-DOM `alert`/`status`/`dialog`
- [ ] No `window.*` dialog spies, no toast timing, no fake timers for notifications
- [ ] API mocked via the contracts types
