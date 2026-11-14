import type { FlatInstance, SceneNode } from "../types";

/** 引擎侧坐标的参考原点：只平移 XZ；Y 是地面高度，保持绝对值。 */
export interface ViewOrigin {
  x: number;
  z: number;
}

/**
 * wasm 引擎内所有坐标是 f32（约 7 位有效数字）：坐标绝对值超过该阈值后，
 * 厘米级细节开始抖动。绝对值更小的场景不启用原点平移，行为与历史版本一致。
 */
export const VIEW_ORIGIN_THRESHOLD = 1e5;

export const ZERO_ORIGIN: ViewOrigin = { x: 0, z: 0 };

/**
 * 场景加载时计算一次：可渲染对象（模型 / 标记点 / 飞线含端点 / 围栏）的
 * XZ 位置包围盒中心，取整到米。场景跨度小或为空时返回零原点。
 */
export function computeViewOrigin(tree: SceneNode[]): ViewOrigin {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const node of tree) {
    const position = node.transform?.position;
    if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.z)) continue;
    if (!["model", "terrain", "water", "marker", "flyline", "fence"].includes(node.type)) continue;
    minX = Math.min(minX, position.x);
    maxX = Math.max(maxX, position.x);
    minZ = Math.min(minZ, position.z);
    maxZ = Math.max(maxZ, position.z);
    if (node.type === "flyline" && node.to && Number.isFinite(node.to.x) && Number.isFinite(node.to.z)) {
      minX = Math.min(minX, node.to.x);
      maxX = Math.max(maxX, node.to.x);
      minZ = Math.min(minZ, node.to.z);
      maxZ = Math.max(maxZ, node.to.z);
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minZ)) return ZERO_ORIGIN;
  const spread = Math.max(Math.abs(minX), Math.abs(maxX), Math.abs(minZ), Math.abs(maxZ));
  if (spread <= VIEW_ORIGIN_THRESHOLD) return ZERO_ORIGIN;
  return { x: Math.round((minX + maxX) / 2), z: Math.round((minZ + maxZ) / 2) };
}

/** 世界坐标 → 引擎（原点相对）坐标；零原点时原样返回。 */
export function toEnginePoint(point: [number, number, number], origin: ViewOrigin): [number, number, number] {
  return origin.x === 0 && origin.z === 0 ? point : [point[0] - origin.x, point[1], point[2] - origin.z];
}

/** 引擎坐标 → 世界坐标；零原点时原样返回。 */
export function fromEnginePoint(point: [number, number, number], origin: ViewOrigin): [number, number, number] {
  return origin.x === 0 && origin.z === 0 ? point : [point[0] + origin.x, point[1], point[2] + origin.z];
}

/** 同步给 wasm 引擎的 flat 实例改为原点相对坐标（不修改入参）。 */
export function toEngineFlat(flat: FlatInstance[], origin: ViewOrigin): FlatInstance[] {
  if (origin.x === 0 && origin.z === 0) return flat;
  return flat.map((item) => {
    const shifted: FlatInstance = { ...item, pos: toEnginePoint(item.pos, origin) };
    if (item.to) shifted.to = toEnginePoint(item.to, origin);
    return shifted;
  });
}
