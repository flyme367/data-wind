import type { SceneNode } from "../types";
import { modelAssetById } from "./modelCatalog";
import { modelNode } from "./modelNode";

function sceneBuilder(prefix: string) {
  let serial = 0;
  const nodes: SceneNode[] = [];
  const add = (partial: Partial<SceneNode> & { type: SceneNode["type"] }): SceneNode => {
    const node: SceneNode = {
      id: `${prefix}-${++serial}`, name: "场景对象", visible: true, locked: false, parentId: null,
      color: "#FFFFFF", transform: {
        position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
      }, ...partial,
    };
    nodes.push(node);
    return node;
  };
  const box = (name: string, position: number[], size: number[], color: string) => add({
    type: "model", name, color, boxSize: { x: size[0], y: size[1], z: size[2] },
    transform: { position: { x: position[0], y: position[1], z: position[2] },
      rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
  });
  const mesh = (id: string, x: number, z: number, parentId: string | null = null) => {
    const asset = modelAssetById.get(id);
    if (!asset) throw new Error(`Missing landscape resource: ${id}`);
    const partial = modelNode(asset);
    partial.transform!.position.x = x; partial.transform!.position.z = z;
    return add({ ...partial, parentId });
  };
  const mark = (name: string, position: number[], color: string) => add({
    type: "marker", name, color, boxSize: { x: .6, y: .6, z: .6 },
    transform: { position: { x: position[0], y: position[1], z: position[2] },
      rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
  });
  return { nodes, add, box, mesh, mark };
}

/** A local sample board using the actual CC0 terrain tiles in the library. */
export function terrainReference(): SceneNode[] {
  const { nodes, add, box, mesh } = sceneBuilder("terrain");
  box("地表样板底座", [0, -.45, 0], [37, .7, 30], "#43515A");
  const groups = new Map(["草地", "铺装", "水系"].map((name) => [name,
    add({ type: "group", name: `${name}地表` }).id,
  ]));
  const tiles = [
    "terrain-grass", "terrain-path-tile", "terrain-path-straight", "terrain-path-bend", "terrain-path-corner",
    "terrain-path-cross", "terrain-path-end", "terrain-path-split", "terrain-path-rocks", "terrain-grass",
    "terrain-river-tile", "terrain-river-straight", "terrain-river-bend", "terrain-river-corner", "terrain-river-cross",
    "terrain-river-end", "terrain-river-split", "terrain-river-rocks", "terrain-grass", "terrain-grass",
  ];
  tiles.forEach((id, index) => {
    const category = modelAssetById.get(id)!.category.split(" / ")[1];
    mesh(id, (index % 5 - 2) * 7, (Math.floor(index / 5) - 1.5) * 7, groups.get(category) ?? null);
  });
  return nodes;
}

/** Offline reference layers; coordinates on the diagram follow an equirectangular projection. */
export function gisReference(): SceneNode[] {
  const { nodes, add, box, mesh, mark } = sceneBuilder("gis");
  box("GIS 图层底座", [0, -.35, 0], [37, .7, 21], "#243544");
  mesh("gis-world-boundaries", 0, 0);
  const points = [
    { name: "北美监测点", lon: -74, lat: 40.7, color: "#F1C668" },
    { name: "欧洲监测点", lon: 2.3, lat: 48.9, color: "#73CAFF" },
    { name: "东亚监测点", lon: 121.5, lat: 31.2, color: "#74DEB7" },
    { name: "南美监测点", lon: -46.6, lat: -23.5, color: "#D291EB" },
    { name: "大洋洲监测点", lon: 151.2, lat: -33.9, color: "#F69E77" },
  ].map((point) => mark(point.name, [point.lon / 360 * 34, 2.8, -point.lat / 360 * 34], point.color));
  for (const [from, to] of [[0, 1], [1, 2], [2, 4], [0, 3]]) {
    add({ type: "flyline", name: `${points[from].name}链路`, color: points[to].color,
      to: { ...points[to].transform.position },
      transform: { position: { ...points[from].transform.position },
        rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    });
  }
  add({ type: "fence", name: "亚太覆盖区域", color: "#4ED9B2", boxSize: { x: 8, y: .1, z: 7 },
    transform: { position: { x: 10.5, y: .1, z: -.5 },
      rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
  });
  return nodes;
}
