import type { SceneNode } from "../types";

export const terrainPresets = [
  { id: "flat", name: "平地", color: "#71965A", height: .1 },
  { id: "hills", name: "丘陵", color: "#60844B", height: 24 },
  { id: "mountains", name: "山地", color: "#657C50", height: 64 },
  { id: "dunes", name: "沙丘", color: "#C8A469", height: 20 },
  { id: "snow", name: "雪山", color: "#67786B", height: 80 },
] as const;

export type TerrainPreset = typeof terrainPresets[number]["id"];
export interface Heightmap {
  name: string;
  resolution: number;
  /** 归一化到 0..65535，保存解码后的像素，不依赖原始文件或外部 URL。 */
  samples: number[];
}
export interface TerrainConfig {
  preset: TerrainPreset;
  seed: number;
  levels: number;
  detailScale: number;
  rockColor: string;
  snowColor: string;
  /** 0..1 为雪线，1.1 关闭积雪。 */
  snowLine: number;
  collision: boolean;
  heightmap?: Heightmap;
}

export const MAX_TERRAINS = 16;
export const HEIGHTMAP_RESOLUTION = 257;
export const defaultTerrain: TerrainConfig = {
  preset: "hills", seed: 42, levels: 6, detailScale: 16,
  rockColor: "#80796D", snowColor: "#EAF0F2", snowLine: 1.1, collision: false,
};

export function terrainNode(preset: TerrainPreset = "hills"): Partial<SceneNode> & { type: "terrain" } {
  const item = terrainPresets.find((entry) => entry.id === preset) ?? terrainPresets[1];
  return {
    type: "terrain", name: item.name, color: item.color,
    boxSize: { x: 256, y: item.height, z: 256 },
    transform: {
      position: { x: 0, y: item.height / 2 + .03, z: 0 },
      rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
    },
    terrain: { ...defaultTerrain, preset, snowLine: preset === "snow" ? .62 : 1.1 },
  };
}

export function validateTerrain(value: unknown): asserts value is TerrainConfig {
  const config = value as TerrainConfig | undefined;
  if (config && typeof config === "object") {
    if (config.collision === undefined) config.collision = false;
    // Generic snapshot JSON represents explicit undefined as null; both mean no custom map.
    if (config.heightmap == null) delete config.heightmap;
  }
  const color = (v: unknown) => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
  if (!config || !terrainPresets.some((item) => item.id === config.preset)
    || !Number.isInteger(config.seed) || config.seed < 0 || config.seed > 1_000_000
    || !Number.isInteger(config.levels) || config.levels < 3 || config.levels > 8
    || !Number.isFinite(config.detailScale) || config.detailScale < 1 || config.detailScale > 128
    || !Number.isFinite(config.snowLine) || config.snowLine < 0 || config.snowLine > 1.1
    || typeof config.collision !== "boolean"
    || !color(config.rockColor) || !color(config.snowColor)) throw new Error("地形参数无效");
  if (config.heightmap !== undefined) {
    const map = config.heightmap;
    if (!map || typeof map.name !== "string" || map.name.length > 200
      || ![33, 65, 129, 257].includes(map.resolution)
      || !Array.isArray(map.samples) || map.samples.length !== map.resolution ** 2
      || map.samples.some((v) => !Number.isInteger(v) || v < 0 || v > 65535)) {
      throw new Error("高度图必须是有效的方形采样数据（最大 257 × 257）");
    }
  }
}

export async function importHeightmap(file: File): Promise<Heightmap> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 10 * 1024 * 1024) {
    throw new Error("请选择 10 MB 以内的 PNG、JPEG 或 WebP 高度图");
  }
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width > 8192 || bitmap.height > 8192) throw new Error("高度图边长不能超过 8192 像素");
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = HEIGHTMAP_RESOLUTION;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("无法读取高度图像素");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const samples = Array.from({ length: canvas.width * canvas.height }, (_, i) =>
      Math.round((rgba[i * 4] * .2126 + rgba[i * 4 + 1] * .7152 + rgba[i * 4 + 2] * .0722) * 257));
    return { name: file.name.slice(0, 200), resolution: HEIGHTMAP_RESOLUTION, samples };
  } finally { bitmap.close(); }
}
