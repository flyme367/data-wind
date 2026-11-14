import { describe, expect, it, vi } from "vitest";
import { triggerDataEdge } from "../data/interactionEdges";

describe("data-triggered interactions", () => {
  it("does not repeat a matching action during a synchronous data update, but can trigger on a later edge", () => {
    const matches = new Map<string, boolean>();
    const run = vi.fn(() => triggerDataEdge(matches, "rule", true, run));
    triggerDataEdge(matches, "rule", true, run);
    expect(run).toHaveBeenCalledTimes(1);
    triggerDataEdge(matches, "rule", false, run);
    triggerDataEdge(matches, "rule", true, run);
    expect(run).toHaveBeenCalledTimes(2);
  });
});
