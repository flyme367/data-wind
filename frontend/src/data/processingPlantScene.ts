import type { SceneNode } from "../types";
import { modelAssetById } from "./modelCatalog";
import { modelNode } from "./modelNode";

/** 「The processing plant」demo 场景的原始布局（中心化，单位米，rotY 单位度）。 */
const PLACEMENTS: Array<[modelId: string, x: number, z: number, rotY: number]> = [
  ["plant-metal3", 195.2, -69.9, 90.0],
  ["plant-road-t", 81.1, -89.5, 0.0],
  ["plant-road-3", 83.0, -79.8, -90.0],
  ["plant-building33", -193.3, 61.1, -0.0],
  ["plant-building42", -58.3, -126.6, 0.0],
  ["plant-building50", 96.4, 14.0, 0.0],
  ["plant-building51-1", 161.7, -34.4, -90.0],
  ["plant-building16-2", 71.5, 153.8, 0.0],
  ["plant-building13", -236.7, 160.9, 0.0],
  ["plant-building19", 28.7, -187.6, 0.0],
  ["plant-silos1", 240.3, 84.2, 0.0],
  ["plant-silo-1", 201.8, 172.2, 0.0],
  ["plant-building51-2", 89.0, -32.8, -0.0],
  ["plant-crane", 139.5, 33.0, 180.0],
  ["plant-road-6", 98.4, -68.5, 0.0],
  ["plant-building31-1", -240.3, 25.4, 90.0],
  ["plant-building48-2", 22.0, -84.5, 0.0],
  ["plant-building7", -119.4, -3.3, 0.0],
  ["plant-building14", -135.5, 120.1, 0.0],
  ["plant-40-2", 43.7, 84.2, 0.0],
  ["plant-building20", 203.7, -159.6, 90.0],
  ["plant-building4", 62.7, -152.6, 0.0],
  ["plant-building39", 7.2, 47.9, -10.0],
  ["plant-building52", 151.3, -79.1, -90.0],
  ["plant-building52-2", 71.0, -37.9, 0.0],
  ["plant-building52-3", 191.4, -27.9, 0.0],
  ["plant-metal4", 129.7, -128.6, 0.0],
  ["plant-building27", 50.7, 54.7, 0.0],
  ["plant-building28-1", 209.7, -106.6, 0.0],
  ["plant-building1", 9.5, 136.8, 0.0],
  ["plant-building9", -25.4, 32.4, 0.0],
  ["plant-building16-3", 62.8, 187.6, 0.0],
  ["plant-building15-2", -117.7, 78.5, 0.0],
  ["plant-tower1", 176.8, 171.2, 0.0],
  ["plant-metal2", 210.7, -50.0, 90.0],
  ["plant-metal5", 222.5, -25.5, 90.0],
  ["plant-roadturn", 48.7, -90.8, 0.0],
  ["plant-building36", -175.8, -17.4, 0.0],
  ["plant-building34", -63.2, 2.5, 0.0],
  ["plant-building44", -197.7, -128.6, 0.0],
  ["plant-building40", 39.5, 32.4, -7.5],
  ["plant-building51", 113.5, -34.2, -0.0],
  ["plant-building51-1", 139.4, -35.3, -90.0],
  ["plant-building11", -132.3, -124.6, 0.0],
  ["plant-building25", 64.8, 85.9, 0.0],
  ["plant-building21", -98.1, 112.0, 0.0],
  ["plant-building29", -7.3, -185.6, -0.0],
  ["plant-building28", 20.4, 5.8, 0.0],
  ["plant-building5", 125.5, 151.2, 0.0],
  ["plant-building3", 9.7, -128.6, 0.0],
  ["plant-building10", 103.7, -154.6, 90.0],
  ["plant-building8", -188.8, 132.0, 0.0],
  ["plant-building53", 190.1, 53.6, 0.0],
  ["plant-road-1", 74.3, -68.2, 180.0],
  ["plant-building29-1", -204.3, 24.5, 0.0],
  ["plant-building41", -167.8, -43.5, -90.0],
  ["plant-building37", -28.5, 62.8, 0.0],
  ["plant-mez-podgotovka", 13.6, -45.0, 0.0],
  ["plant-building15", -59.4, 132.1, 0.0],
  ["plant-building12", -102.9, 148.5, 0.0],
  ["plant-building18", -104.3, -180.6, 0.0],
  ["plant-building16", 94.9, 154.4, 0.0],
  ["plant-building26", 119.5, 57.4, 0.0],
  ["plant-building22", 45.2, -0.6, 0.0],
  ["plant-building2", 159.7, -126.6, 0.0],
  ["plant-metall1", 189.7, -103.6, 90.0],
  ["plant-road-plan", 103.3, -92.5, 0.0],
  ["plant-silos2", 180.8, 143.0, 0.0],
  ["plant-building47", -166.9, -73.6, 0.0],
  ["plant-building23", 8.5, 82.6, 0.0],
  ["plant-building32", -165.5, 15.7, 0.0],
  ["plant-building31", -169.2, 39.4, 0.0],
  ["plant-building36-2", -15.8, 4.0, 0.0],
  ["plant-building6", 104.6, 184.8, 0.0],
  ["plant-building11-2", -163.1, 62.5, -0.1],
  ["plant-21", 123.3, 108.1, 0.0],
  ["plant-building16-1", 72.0, 119.7, 0.0],
  ["plant-tower2", 156.7, 167.3, 0.0],
];

const v = (x: number, y: number, z: number) => ({ x, y, z });

/** 化工厂区：8K 泥地贴图烘顶色的大地面 + 原始布局的 78 个建筑/储罐/道路实例 + 低角度太阳。 */
export function processingPlantScene(): SceneNode[] {
  const nodes: SceneNode[] = [];
  let serial = 0;
  // 地面：520×420m，8K 泥地贴图按 5×3.9 平铺烘焙进顶点色（16000 tris）
  const ground = modelAssetById.get("plant-ground");
  if (ground) {
    const resource = modelNode(ground);
    const groundResource = {
      ...resource,
      transform: { ...resource.transform!, position: v(0, -0.02, 0) },
    };
    nodes.push({
      id: `processing-plant-${++serial}`, name: "厂区地面",
      visible: true, locked: false, parentId: null,
      modelId: "plant-ground", color: "#FFFFFF",
      boxSize: { x: ground.size[0], y: ground.size[1], z: ground.size[2] },
      ...groundResource,
    } as SceneNode);
  }
  // 太阳：低角度晨光（y≈0.48），影子比默认高顶光长得多
  nodes.push({
    id: "processing-plant-sun", name: "太阳", type: "light", visible: true,
    locked: false, parentId: null, color: "#FFF2E0", boxSize: { x: 0, y: 0, z: 0 },
    transform: { position: v(0.55, 0.48, 0.35), rotation: v(0, 0, 0), scale: v(1, 1, 1) },
    lightIntensity: 1,
  } as unknown as SceneNode);
  for (const [modelId, x, z, rotY] of PLACEMENTS) {
    const asset = modelAssetById.get(modelId);
    if (!asset) continue;
    const base = {
      id: `processing-plant-${++serial}`,
      name: asset.name,
      visible: true, locked: false, parentId: null,
      boxSize: { x: asset.size[0], y: asset.size[1], z: asset.size[2] },
      color: modelId.startsWith("plant-road") ? "#C9C3B8" : "#FFFFFF",
    } as const;
    const resource = modelNode(asset);
    resource.transform!.position.x = x;
    resource.transform!.position.z = z;
    resource.transform!.rotation.y = rotY;
    nodes.push({ ...base, ...resource } as SceneNode);
  }
  return nodes;
}
