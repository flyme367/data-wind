export interface CaptureSize { width: number; height: number }
type CaptureHandler = (size?: CaptureSize) => Promise<HTMLCanvasElement>;

let activeCapture: CaptureHandler | null = null;

/** The mounted viewport owns the handler and unregisters it before freeing its engine. */
export function registerSceneCapture(handler: CaptureHandler): () => void {
  activeCapture = handler;
  return () => { if (activeCapture === handler) activeCapture = null; };
}

export async function captureSceneFrame(size?: CaptureSize): Promise<HTMLCanvasElement> {
  if (!activeCapture) throw new Error("三维场景尚未就绪，请稍后重试");
  return activeCapture(size);
}

/** Rust prefixes each tightly packed RGBA frame with its captured width and height. */
export function decodePreviewFrame(data: Uint8Array): { width: number; height: number; pixels: Uint8ClampedArray<ArrayBuffer> } {
  if (data.length < 8) throw new Error("GPU 截图数据不完整");
  const header = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const width = header.getUint32(0, true), height = header.getUint32(4, true);
  const bytes = width * height * 4;
  if (!width || !height || !Number.isSafeInteger(bytes) || bytes !== data.length - 8) {
    throw new Error("GPU 截图尺寸与像素数据不匹配");
  }
  return { width, height, pixels: new Uint8ClampedArray(data.slice(8)) };
}

export async function canvasPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("PNG 编码失败")), "image/png");
    } catch (error) {
      reject(error instanceof DOMException && error.name === "SecurityError"
        ? new Error("图片来源不允许跨域导出，请改用本地图片")
        : error instanceof Error ? error : new Error("PNG 编码失败"));
    }
  });
}
