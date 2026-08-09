import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { makeStore } from "../store/store";
import { notify } from "../store/slices/notifications";
import { NotificationRegion } from "./NotificationRegion";

function renderWithStore(store = makeStore()) {
  render(
    <Provider store={store}>
      <NotificationRegion />
    </Provider>,
  );
  return store;
}

test("shows an error notification as role=alert and dismisses it on click", async () => {
  const store = makeStore();
  store.dispatch(notify("error", "Something failed"));
  renderWithStore(store);

  const alert = screen.getByRole("alert");
  expect(alert).toHaveTextContent("Something failed");

  await userEvent.click(
    screen.getByRole("button", { name: /dismiss notification/i }),
  );

  // In-DOM + state-driven → deterministic, no timers to wait on.
  expect(screen.queryByRole("alert")).toBeNull();
});

test("renders nothing when there are no notifications", () => {
  renderWithStore();
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
});
