import { loadCpuModule } from "./cpuClient";
import { decodePreviewFrame } from "./captureFrame";
import { encodeSoftwareFrame } from "./commands";
// Geometry, shading and rasterization live in Rust; JS forwards input and displays RGBA frames.
import type { FlatInstance } from "../types";
import type { ModelBuffer } from "./modelLibrary";

export interface SoftCamera {
  target: [number, number, number];
  yaw: number;
  pitch: number;
  dist: number;
}

type Vec3 = [number, number, number];

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Match the software camera's perspective when placing or moving objects. */
export function screenPointOnPlane(
  cam: SoftCamera, x: number, y: number, width: number, height: number, planeY: number,
): Vec3 | null {
  if (width <= 0 || height <= 0 || !Number.isFinite(planeY)) return null;
  const cp = Math.cos(cam.pitch);
  const eye: Vec3 = [
    cam.target[0] + cam.dist * Math.sin(cam.yaw) * cp,
    cam.target[1] + cam.dist * Math.sin(cam.pitch),
    cam.target[2] + cam.dist * Math.cos(cam.yaw) * cp,
  ];
  const back = norm(sub(eye, cam.target));
  const right = norm(cross([0, 1, 0], back));
  const up = cross(back, right);
  const scale = Math.tan(Math.PI / 8);
  const nx = (2 * x / width - 1) * scale * width / height;
  const ny = (1 - 2 * y / height) * scale;
  const direction = norm([
    right[0] * nx + up[0] * ny - back[0],
    right[1] * nx + up[1] * ny - back[1],
    right[2] * nx + up[2] * ny - back[2],
  ]);
  if (Math.abs(direction[1]) < 1e-6) return null;
  const distance = (planeY - eye[1]) / direction[1];
  if (!Number.isFinite(distance) || distance < 0 || distance > 600) return null;
  return [eye[0] + direction[0] * distance, planeY, eye[2] + direction[2] * distance];
}

/** Browser transport for the Rust compatibility renderer. */
export class SoftwareRenderer {
  private width = 1;
  private height = 1;
  private constructor(private readonly canvas: HTMLCanvasElement,
    private readonly surface: InstanceType<Awaited<ReturnType<typeof loadCpuModule>>["SoftwareCanvas"]>) {}

  static async create(canvas: HTMLCanvasElement): Promise<SoftwareRenderer> {
    const wasm = await loadCpuModule();
    return new SoftwareRenderer(canvas, new wasm.SoftwareCanvas());
  }

  registerModel(model: ModelBuffer): void { this.surface.register_mesh(model.id, model.bytes); }
  registerModelAsset(id: string, bytes: Uint8Array): void { this.surface.register_model_asset(id, bytes); }
  setModelMaterials(id: string, settings: object): void { this.surface.set_model_materials(id, JSON.stringify(settings)); }
  setModelTexture(id: number, width: number, height: number, rgba: Uint8Array): void {
    this.surface.set_model_texture(id, width, height, rgba);
  }
  pick(x: number, y: number): string | null { return this.surface.pick(x, y) ?? null; }
  get size(): { width: number; height: number } { return { width: this.width, height: this.height }; }
  resize(width: number, height: number): void {
    this.width = Math.max(1, Math.floor(width)); this.height = Math.max(1, Math.floor(height));
    if (this.canvas.width !== this.width) this.canvas.width = this.width;
    if (this.canvas.height !== this.height) this.canvas.height = this.height;
  }
  private draw(canvas: HTMLCanvasElement, width: number, height: number,
    instances: FlatInstance[], camera: SoftCamera, options: SoftwareOptions, snapshot: boolean): void {
    const frame = decodePreviewFrame(this.surface.frame(width, height,
      encodeSoftwareFrame(instances, camera, options), snapshot));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法显示 Rust 场景像素");
    context.putImageData(new ImageData(frame.pixels, width, height), 0, 0);
  }
  renderSnapshot(width: number, height: number, instances: FlatInstance[], camera: SoftCamera,
    options: SoftwareOptions): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    this.draw(canvas, width, height, instances, camera, options, true); return canvas;
  }
  render(instances: FlatInstance[], camera: SoftCamera, options: SoftwareOptions): void {
    this.draw(this.canvas, this.width, this.height, instances, camera, options, false);
  }
  dispose(): void { this.surface.free(); }
}

interface SoftwareOptions {
  grid: boolean; selectedId: string | null; time: number; background?: string;
  daylight?: number; selectedIds?: string[];
}

export function projectWorldPoint(cam: SoftCamera,p: Vec3,width: number,height: number): number[] {
  const cp=Math.cos(cam.pitch), eye:Vec3=[cam.target[0]+cam.dist*Math.sin(cam.yaw)*cp,cam.target[1]+cam.dist*Math.sin(cam.pitch),cam.target[2]+cam.dist*Math.cos(cam.yaw)*cp];
  const back=norm(sub(eye,cam.target)),right=norm(cross([0,1,0],back)),up=cross(back,right),delta=sub(p,eye),depth=-dot(delta,back);
  if(depth<=.01)return [];
  const f=1/Math.tan(Math.PI/8);
  return [(dot(delta,right)*f/(width/height)/depth+1)*width/2,(1-dot(delta,up)*f/depth)*height/2];
}
