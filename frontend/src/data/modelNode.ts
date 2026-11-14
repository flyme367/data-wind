import type { SceneNode } from "../types";
import type { ModelAsset } from "./modelCatalog";

export function modelNode(asset: ModelAsset): Partial<SceneNode> & { type: "model" } {
  return {
    type: "model", name: asset.name, modelId: asset.id, color: "#FFFFFF",
    boxSize: { x: asset.size[0], y: asset.size[1], z: asset.size[2] },
    transform: {
      position: { x: 0, y: asset.size[1] / 2 + (asset.category.startsWith("地表") ? .02 : .12), z: 0 },
      rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
    },
  };
}
