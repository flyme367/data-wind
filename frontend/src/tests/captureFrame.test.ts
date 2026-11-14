import { describe, expect, it } from "vitest";
import { captureSceneFrame, decodePreviewFrame, registerSceneCapture } from "../engine/captureFrame";

describe("scene frame capture", () => {
  it("decodes dimensions and tightly packed RGBA without retaining the source bytes", () => {
    const bytes = new Uint8Array([2, 0, 0, 0, 1, 0, 0, 0, 1, 2, 3, 255, 4, 5, 6, 255]);
    const frame = decodePreviewFrame(bytes);
    expect([frame.width, frame.height, ...frame.pixels]).toEqual([2, 1, 1, 2, 3, 255, 4, 5, 6, 255]);
    bytes[8] = 99;
    expect(frame.pixels[0]).toBe(1);
    expect(() => decodePreviewFrame(bytes.subarray(0, 10))).toThrow("尺寸");
    expect(() => decodePreviewFrame(new Uint8Array(4))).toThrow("不完整");
  });

  it("does not unregister a newer viewport when an older viewport is disposed", async () => {
    const first = {} as HTMLCanvasElement, second = {} as HTMLCanvasElement;
    const disposeFirst = registerSceneCapture(async () => first);
    const disposeSecond = registerSceneCapture(async () => second);
    disposeFirst();
    await expect(captureSceneFrame()).resolves.toBe(second);
    disposeSecond();
    await expect(captureSceneFrame()).rejects.toThrow("尚未就绪");
  });
});
