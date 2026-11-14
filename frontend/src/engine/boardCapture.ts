import type { CaptureSize } from "./captureFrame";

type BoardCapture = (size: CaptureSize) => Promise<HTMLCanvasElement>;
let active: BoardCapture | null = null;

export function registerBoardCapture(capture: BoardCapture): () => void {
  active = capture;
  return () => { if (active === capture) active = null; };
}

export function captureBoardWidgets(size: CaptureSize): Promise<HTMLCanvasElement> {
  if (!active) throw new Error("Rust 看板渲染器尚未就绪，请稍后重试");
  return active(size);
}
