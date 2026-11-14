import type { SceneNode } from "../types";

export const waterPresets = [
  { id: "ocean", name: "海洋", color: "#176B91", width: 512, length: 512, height: .65, waveLength: 24 },
  { id: "lake", name: "湖泊", color: "#287B80", width: 80, length: 60, height: .12, waveLength: 8 },
  { id: "pool", name: "泳池", color: "#27AFC5", width: 20, length: 32, height: .035, waveLength: 3 },
  { id: "river", name: "河流", color: "#328C9A", width: 64, length: 128, height: .08, waveLength: 5 },
  { id: "shallow", name: "浅水模拟", color: "#418F9B", width: 32, length: 32, height: .02, waveLength: 3 },
] as const;
export type WaterPreset = typeof waterPresets[number]["id"];
export interface WaterPoint { x: number; z: number }
export interface WaterSource extends WaterPoint {
  /** 每秒注入或抽出的体积，m³/s。坐标以组件宽深归一化到 -0.5..0.5。 */
  rate: number;
  /** 出水口半径占较短边的比例。 */
  radius: number;
}
export interface WaterConfig {
  preset: WaterPreset;
  waveHeight: number;
  waveLength: number;
  waveSpeed: number;
  direction: number;
  opacity: number;
  refractionColor: string;
  scatteringColor: string;
  transparencyDepth: number;
  roughness: number;
  foam: number;
  /** 河宽占组件较短边的比例。控制点为组件局部归一化坐标。 */
  riverWidth: number;
  points: WaterPoint[];
  running: boolean;
  initialDepth: number;
  sources: WaterSource[];
  resetVersion: number;
}
export const MAX_WATERS = 16;
export const MAX_SHALLOW_WATERS = 4;
export const defaultWater: WaterConfig = {
  preset: "lake", waveHeight: .12, waveLength: 8, waveSpeed: 1, direction: 30,
  opacity: .8, refractionColor: "#A3DFE6", scatteringColor: "#175C70",
  transparencyDepth: 5, roughness: .15, foam: .25, riverWidth: .16,
  points: [{ x: -.15, z: -.45 }, { x: .15, z: -.2 }, { x: -.12, z: .15 }, { x: .1, z: .45 }],
  running: true, initialDepth: .15,
  sources: [{ x: -.25, z: -.25, rate: 1, radius: .06 }], resetVersion: 0,
};
export function waterNode(preset: WaterPreset = "lake"): Partial<SceneNode> & { type: "water" } {
  const item = waterPresets.find((entry) => entry.id === preset) ?? waterPresets[1];
  return {
    type: "water", name: item.name, color: item.color,
    boxSize: { x: item.width, y: 2, z: item.length },
    transform: { position: { x: 0, y: preset === "ocean" ? 1 : .3, z: 0 },
      rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    water: { ...structuredClone(defaultWater), preset, waveHeight: item.height, waveLength: item.waveLength,
      waveSpeed: preset === "river" ? 2 : 1, transparencyDepth: preset === "pool" ? 3 : 5,
      foam: preset === "ocean" ? .5 : .2 },
  };
}
export function validateWater(value: unknown): asserts value is WaterConfig {
  const c = value as WaterConfig | undefined;
  const range = (v: unknown, min: number, max: number) => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
  const color = (v: unknown) => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
  const point = (p: WaterPoint) => p && range(p.x, -.5, .5) && range(p.z, -.5, .5);
  if (!c || !waterPresets.some((p) => p.id === c.preset)
    || !range(c.waveHeight, 0, 5) || !range(c.waveLength, 1, 200) || !range(c.waveSpeed, 0, 10)
    || !range(c.direction, -180, 180) || !range(c.opacity, 0, 1)
    || !color(c.refractionColor) || !color(c.scatteringColor) || !range(c.transparencyDepth, .1, 100)
    || !range(c.roughness, .02, 1) || !range(c.foam, 0, 1) || !range(c.riverWidth, .01, .8)
    || !Array.isArray(c.points) || c.points.length < 2 || c.points.length > 32 || !c.points.every(point)
    || c.points.slice(1).some((p, i) => Math.hypot(p.x - c.points[i].x, p.z - c.points[i].z) < .001)
    || typeof c.running !== "boolean" || !range(c.initialDepth, 0, 5)
    || !Number.isInteger(c.resetVersion) || !range(c.resetVersion, 0, 1_000_000)
    || !Array.isArray(c.sources) || c.sources.length > 8
    || !c.sources.every((s) => point(s) && range(s.rate, -20, 20) && range(s.radius, .02, .25))) {
    throw new Error("水体参数无效，请检查波浪、河道控制点或出水点");
  }
}
