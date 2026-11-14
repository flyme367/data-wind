import { describe, expect, it, vi } from "vitest";
import { createPointerInput } from "../engine/frameInput";

const point = (clientX: number, clientY = 0) => ({ clientX, clientY });

describe("pointer motion coalescing", () => {
  it("delivers only the latest hover position for a burst between frames", () => {
    const consume = vi.fn();
    const input = createPointerInput(consume);
    for (let x = 0; x < 100; x += 1) input.push(point(x));
    expect(consume).not.toHaveBeenCalled();
    input.flush();
    input.flush();
    expect(consume).toHaveBeenCalledExactlyOnceWith(point(99));
  });

  it("preserves a drag excursion that returns before a frame and coalesces later motion", () => {
    const consume = vi.fn();
    const input = createPointerInput(consume);
    input.start(point(0));
    input.push(point(3));
    expect(consume).not.toHaveBeenCalled();
    input.push(point(40));
    expect(consume).toHaveBeenCalledExactlyOnceWith(point(40));
    for (let x = 39; x >= 0; x -= 1) input.push(point(x));
    expect(consume).toHaveBeenCalledTimes(1);
    input.end(point(0));
    expect(consume.mock.calls.map(([p]) => p.clientX)).toEqual([40, 0]);
  });

  it("uses the release coordinates even if no animation frame has run", () => {
    const consume = vi.fn();
    const input = createPointerInput(consume);
    input.start(point(10));
    input.push(point(12));
    input.end(point(14));
    input.flush();
    expect(consume).toHaveBeenCalledExactlyOnceWith(point(14));
  });

  it("keeps the last motion on cancellation and discards input on disposal", () => {
    const consume = vi.fn();
    const input = createPointerInput(consume);
    input.start(point(10));
    input.push(point(12));
    input.end();
    expect(consume).toHaveBeenCalledExactlyOnceWith(point(12));
    input.push(point(20));
    input.clear();
    input.flush();
    expect(consume).toHaveBeenCalledTimes(1);
    input.start(point(30));
    input.push(point(35));
    expect(consume).toHaveBeenLastCalledWith(point(35));
  });
});
