import { nextAttemptState } from "./outboxDrain";

describe("nextAttemptState", () => {
  it("stays pending (retries) while under the max", () => {
    expect(nextAttemptState(0, 5)).toEqual({ status: "pending", attempts: 1 });
    expect(nextAttemptState(3, 5)).toEqual({ status: "pending", attempts: 4 });
  });

  it("moves to failed once the max is reached", () => {
    expect(nextAttemptState(4, 5)).toEqual({ status: "failed", attempts: 5 });
  });

  it("defaults to the module's max-attempts constant", () => {
    expect(nextAttemptState(3)).toEqual({ status: "pending", attempts: 4 });
    expect(nextAttemptState(4)).toEqual({ status: "failed", attempts: 5 });
  });
});
