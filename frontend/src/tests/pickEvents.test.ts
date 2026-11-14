import { describe, expect, it, vi } from "vitest";
import { createPickEvents } from "../engine/pickEvents";

describe("scene pick events", () => {
  it("dispatches a double click when the first GPU pick already arrived", () => {
    let time = 100;
    const callback = vi.fn(), events = createPickEvents(callback, () => time);
    events.click("model", 10, 20, false);
    time += 120;
    events.doubleClick(11, 21, false);
    expect(callback.mock.calls).toEqual([["model", false, "click"], ["model", false, "dblclick"]]);
  });

  it("waits for the GPU response if the double click arrives first", () => {
    let time = 100;
    const callback = vi.fn(), events = createPickEvents(callback, () => time);
    events.doubleClick(10, 20, true);
    time += 30;
    events.click("model", 10, 20, true);
    expect(callback.mock.calls).toEqual([["model", true, "click"], ["model", true, "dblclick"]]);
  });

  it("never applies a stale pick to a different location", () => {
    let time = 100;
    const callback = vi.fn(), events = createPickEvents(callback, () => time);
    events.click("first", 10, 20, false);
    time += 30;
    events.doubleClick(90, 100, false);
    time += 30;
    events.click("second", 90, 100, false);
    expect(callback.mock.calls).toEqual([["first", false, "click"], ["second", false, "click"], ["second", false, "dblclick"]]);
    events.clear();
  });
});
