import { describe, expect, it } from "vitest";
import { screenPointOnPlane, type SoftCamera } from "../engine/softwareRenderer";

describe("software camera placement", () => {
  it("projects the view center onto the target height and rejects the horizon", () => {
    const camera: SoftCamera = { target: [0, 0, 0], yaw: 0.7, pitch: 0.4, dist: 58 };
    const point = screenPointOnPlane(camera, 640, 360, 1280, 720, 0)!;
    expect(point[0]).toBeCloseTo(0);
    expect(point[1]).toBe(0);
    expect(point[2]).toBeCloseTo(0);
    expect(screenPointOnPlane({ ...camera, pitch: 0 }, 640, 360, 1280, 720, -1)).toBeNull();
  });
});
