import type { SceneNode } from "../types";
import { modelAssetById } from "./modelCatalog";
import { modelNode } from "./modelNode";

/** A local example assembled from the attributed CC0 reference models. */
export function referenceCampus(): SceneNode[] {
  let serial = 0;
  const nodes: SceneNode[] = [];
  const add = (partial: Partial<SceneNode> & { type: SceneNode["type"] }) => {
    const node: SceneNode = {
      id: `reference-${++serial}`, name: "场景对象",
      visible: true, locked: false, parentId: null, color: "#FFFFFF",
      transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      ...partial,
    };
    nodes.push(node);
    return node;
  };
  const box = (name: string, x: number, z: number, width: number, depth: number, color: string, y = .1, height = .2) => add({
    type: "model", name, color, boxSize: { x: width, y: height, z: depth },
    transform: { position: { x, y, z }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
  });
  const model = (id: string, x: number, z: number, yaw = 0, scale = 1) => {
    const asset = modelAssetById.get(id);
    if (!asset) throw new Error(`Missing reference model: ${id}`);
    const instance = modelNode(asset);
    instance.transform!.position = { x, y: asset.size[1] * scale / 2 + .25, z };
    instance.transform!.rotation.y = yaw;
    instance.transform!.scale = { x: scale, y: scale, z: scale };
    return add(instance);
  };
  box("园区底座", 0, 0, 56, 46, "#58636B", -.25, .5);
  box("园区铺装", 0, 0, 54.5, 44.5, "#B7C1C4", .04, .08);
  for (const x of [-24,-18,-12,-6,6,12,18,24]) model("road", x, 0, 90);
  for (const z of [-18,-12,-6,6,12,18]) model("road", 0, z);
  model("road-junction", 0, 0);
  box("生产区草坪", -13, -12, 18, 16, "#557762", .13, .12);
  box("仓储区草坪", -13, 12, 18, 16, "#557762", .13, .12);
  box("办公区景观", 13, -12, 18, 16, "#557762", .13, .12);
  box("研发区景观", 13, 11, 18, 13, "#557762", .13, .12);
  model("industrial-c", -12, -12);
  model("industrial-a", -12, 11);
  model("industrial-j", -22, -12, 90, .52);
  model("office", 10, -12);
  model("tower-glass", 18, -13, 0, 1.25);
  model("office-low", 12, 10, 90, .85);
  model("chimney", -21, 8, 0, 1.25);
  model("tank", -21, 16, 0, .72);
  model("conveyor", -20, -6, 0, .65);
  model("crane", -12, -5, 90, .6);
  for (const [index,x] of [7,11,15,19,23].entries()) {
    box(`停车位 ${index+1}`, x, 19, 3.4, 5.2, "#87959C", .17, .08);
    box(`车位标线 ${index+1}`, x-1.55, 19, .08, 4.8, "#DFE4DD", .23, .02);
    model(index===4?"truck":index===3?"ambulance":"car", x, 19, 0, .72);
  }
  model("firetruck", -7, 18, 0, .75);
  for (const z of [-19,-12,-5,5,12,19]) {
    model("oak", 25, z, 0, .85);
    if (Math.abs(z)>15) model("pine", -25, z);
  }
  for (const x of [-18,-10,8,14,20]) model("tree", x, -20);
  for (const z of [-9,9]) for (const x of [-4,4]) model("streetlight", x, z);
  for (const x of [7,16,21]) model("bush", x, 5, 0, .25);
  add({ type: "marker", name: "生产监测点", color: "#4BA9FF", boxSize: { x: .6, y: .6, z: .6 },
    transform: { position: { x: -12, y: 7, z: -12 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } } });
  add({ type: "marker", name: "办公监测点", color: "#56E6AE", boxSize: { x: .6, y: .6, z: .6 },
    transform: { position: { x: 10, y: 11, z: -12 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } } });
  add({ type: "flyline", name: "园区数据链路", color: "#4BA9FF", boxSize: { x: .3, y: .3, z: .3 }, to: { x: 10, y: 10.5, z: -12 },
    transform: { position: { x: -12, y: 6.5, z: -12 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } } });
  return nodes;
}
