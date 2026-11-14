import { describe, expect, it } from "vitest";
import type { Interaction } from "../data/editor";
import { entranceAnimations, interactionSchedule } from "../data/interactionAnimation";

const rule = (overrides: Partial<Interaction> = {}): Interaction => ({
  id: "rule", event: "click", action: "playEntrance", targetId: "chart", value: "", ...overrides,
});

describe("interaction animation timing", () => {
  it("starts simultaneous actions together and waits for the longest one before the next group", () => {
    const schedule = interactionSchedule([
      rule({ id: "a", delayMs: 100, durationMs: 1000 }),
      rule({ id: "b", delayMs: 400, durationMs: 1500 }),
      rule({ id: "c", action: "message", sequence: "after", delayMs: 200 }),
      rule({ id: "d", sequence: "with", durationMs: 500 }),
      rule({ id: "e", action: "message", sequence: "after" }),
    ]);
    expect(schedule.map(item => [item.rule.id, item.at])).toEqual([
      ["a", 0], ["b", 0], ["c", 2100], ["d", 1900], ["e", 2400],
    ]);
  });

  it("replaces previous animations by default and stacks only active animations when requested", () => {
    const old = entranceAnimations(rule({ durationMs: 1000 }), null, 1000);
    expect(entranceAnimations(rule(), old, 1200)).toHaveLength(1);
    expect(entranceAnimations(rule({ animationStack: true, animation: "zoom" }), old, 1200))
      .toHaveLength(2);
    expect(entranceAnimations(rule({ animationStack: true }), old, 2100)).toHaveLength(1);
  });
});
