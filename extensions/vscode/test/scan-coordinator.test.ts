import { afterEach, describe, expect, it, vi } from "vitest";
import { createDebouncedTrigger, LatestRequestGate } from "../src/scan-coordinator.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("LatestRequestGate", () => {
  it("only accepts the most recently started request", () => {
    const gate = new LatestRequestGate();
    const first = gate.begin();
    const second = gate.begin();

    expect(gate.isCurrent(first)).toBe(false);
    expect(gate.isCurrent(second)).toBe(true);
  });

  it("keeps an older request superseded when its validation finishes last", async () => {
    const gate = new LatestRequestGate();
    const accepted: number[] = [];
    let finishFirst: (() => void) | undefined;
    let finishSecond: (() => void) | undefined;
    const firstValidation = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    const secondValidation = new Promise<void>((resolve) => {
      finishSecond = resolve;
    });
    const first = gate.begin();
    const firstRun = firstValidation.then(() => {
      if (gate.isCurrent(first)) accepted.push(first);
    });
    const second = gate.begin();
    const secondRun = secondValidation.then(() => {
      if (gate.isCurrent(second)) accepted.push(second);
    });

    finishSecond?.();
    await secondRun;
    finishFirst?.();
    await firstRun;

    expect(accepted).toEqual([second]);
  });
});

describe("createDebouncedTrigger", () => {
  it("coalesces bursts into one action", () => {
    vi.useFakeTimers();
    const action = vi.fn();
    const trigger = createDebouncedTrigger(action, 300);

    trigger.trigger();
    vi.advanceTimersByTime(150);
    trigger.trigger();
    vi.advanceTimersByTime(299);
    expect(action).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("cancels a pending action when disposed", () => {
    vi.useFakeTimers();
    const action = vi.fn();
    const trigger = createDebouncedTrigger(action, 300);

    trigger.trigger();
    trigger.dispose();
    vi.runAllTimers();

    expect(action).not.toHaveBeenCalled();
  });
});
