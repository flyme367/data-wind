// 最小 WebGPU 类型声明（探测用途）
interface Navigator {
  readonly gpu?: {
    requestAdapter(options?: unknown): Promise<GPUAdapter | null>;
  };
}
interface GPUAdapter {
  requestDevice(): Promise<GPUDevice>;
}
interface GPUDevice extends EventTarget {
  destroy(): void;
  createTexture(descriptor: GPUTextureDescriptor): GPUTexture;
  createShaderModule(descriptor: { code: string }): unknown;
  createRenderPipeline(descriptor: unknown): unknown;
  createCommandEncoder(descriptor?: { label?: string }): GPUCommandEncoder;
  createBuffer(descriptor: GPUBufferDescriptor): GPUBuffer;
  queue: { submit(commandBuffers: unknown[]): void };
}
interface GPUTexture {
  destroy(): void;
  createView(): unknown;
}
interface GPUTextureDescriptor {
  size: { width: number; height: number };
  format: string;
  usage: number;
}
interface GPUBufferDescriptor {
  size: number;
  usage: number;
  mappedAtCreation?: boolean;
}
interface GPUCommandEncoder {
  beginRenderPass(descriptor: unknown): GPURenderPassEncoder;
  copyTextureToBuffer(
    source: { texture: GPUTexture; origin?: { x: number; y: number } },
    destination: { buffer: GPUBuffer; bytesPerRow: number },
    copySize: { width: number; height: number },
  ): void;
  finish(): unknown;
}
interface GPURenderPassEncoder {
  setPipeline(pipeline: unknown): void;
  draw(count: number): void;
  end(): void;
}
interface GPUBuffer {
  destroy(): void;
  mapAsync(mode: number, offset?: number, size?: number): Promise<void>;
  getMappedRange(offset?: number, size?: number): ArrayBuffer;
  unmap(): void;
}
declare const GPUTextureUsage: { RENDER_ATTACHMENT: number; COPY_SRC: number };
declare const GPUBufferUsage: { COPY_DST: number; MAP_READ: number };
declare const GPUMapMode: { READ: number };
