import type { SceneNode } from "../types";
import type { EditorSettings } from "./editor";
import { defaultScene } from "../workers/sceneModel";
import { referenceCampus } from "./referenceScene";
import { smartParkScene } from "./smartParkScene";
import { modelAssetById } from "./modelCatalog";
import { modelNode } from "./modelNode";
import { gisReference, terrainReference } from "./referenceLandscapes";
import { processingPlantScene } from "./processingPlantScene";

/** Editable procedural scenes; reference thumbnails are kept separate from scene geometry. */
export function createTemplateScene(id: string): SceneNode[] {
  if (id === "empty") return [];
  if (id === "smart-park") return smartParkScene();
  if (id === "terrain") return terrainReference();
  if (id === "processing-plant") return processingPlantScene();
  if (id === "gis-map") return gisReference();
  if (["reference-campus", "campus", "factory", "campus-b"].includes(id)) return referenceCampus();
  let serial = 0;
  const box = (name: string, p: number[], size: number[], color: string): SceneNode => ({
    id: `${id}-${++serial}`, name, type: "model", visible: true, locked: false,
    parentId: null, color, boxSize: { x: size[0], y: size[1], z: size[2] },
    transform: { position: { x: p[0], y: p[1], z: p[2] },
      rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
  });
  const mesh = (modelId: string, x: number, z: number): SceneNode => {
    const resource = modelNode(modelAssetById.get(modelId)!);
    resource.transform!.position.x = x;
    resource.transform!.position.z = z;
    return { ...box(resource.name!, [0, 0, 0], [1, 1, 1], "#FFFFFF"), ...resource };
  };
  if (id === "floors") return Array.from({ length: 12 }, (_, index) =>
    box(`第 ${index + 1} 层`, [0, index * 1.5 + 1, 0], [8, 1.2, 6], index % 2 ? "#B3C5DA" : "#DDE5EC"));
  if (id === "city") return Array.from({ length: 49 }, (_, index) => {
    return mesh(["tower", "tower-glass", "office"][index % 3], (index % 7 - 3) * 8, (Math.floor(index / 7) - 3) * 8);
  });
  if (id === "pipes") return [
    mesh("tank", -9, 0), mesh("tank", 9, 0),
    mesh("pipe", -4, 0), mesh("pipe", 1, 0), mesh("valve", 5, 0), mesh("pipe-bend", 0, 6),
    ...defaultScene().filter((n) => n.type === "flyline" || n.type === "marker"),
  ];
  if (id === "car") return [
    box("产品展示台", [0, -.4, 0], [20, .8, 16], "#414F62"),
    mesh("car", -5, -3), mesh("truck", 5, -3), mesh("ambulance", -5, 4), mesh("firetruck", 5, 4),
  ];
  if (id === "indoor") return Array.from({ length: 12 }, (_, index) =>
    box(`室内分区 ${index + 1}`, [(index % 4 - 1.5) * 7, 0.6, (Math.floor(index / 4) - 1) * 7], [6.5, 1.2, 6.5],
      index % 2 ? "#C8D8DB" : "#DBD2C3"));
  return [box("产品底座", [0, 0.4, 0], [12, 0.8, 12], "#59667C"),
    box("产品主体", [0, 4.4, 0], [3, 8, 2], "#7995C2")];
}

/** 模板自带的环境/看板预设:创建项目时合并进默认设置,其余模板保持现状返回空对象。 */
export function templateSettings(id: string): Partial<EditorSettings> {
  if (id === "processing-plant") return {
    // 清晨 9:30 晨光（daylight≈0.79），配合模板低角度太阳产生长影
    time: 9.5,
  };
  if (id === "smart-park") return {
    // 夜景科技蓝:深蓝天空/地面,清晨微光让楼体保留方向感,雾压缩远景,关闭网格线保留飞线
    background: "#0A0F1E", groundColor: "#0B1020", time: 8,
    fog: true, fogDistance: 210, grid: false, flylines: true, stats: false,
    boardColor: "#070B16",
  };
  return {};
}
