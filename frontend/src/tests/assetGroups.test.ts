import { describe, expect, it } from "vitest";
import { buildAssetFolders, childChips, matchesAssetFolder } from "../data/assetGroups";
import type { AssetItem } from "../workers/assets.worker";

const items: AssetItem[] = [
  { id: "bed", name: "病床", library: "模型", category: "医疗 / 病房护理", type: "model", color: "#fff", tags: [] },
  { id: "mri", name: "核磁共振仪", library: "模型", category: "医疗 / 影像诊疗", type: "model", color: "#fff", tags: [] },
  { id: "tree", name: "树", library: "模型", category: "植被 / 树木", type: "model", color: "#fff", tags: [] },
  { id: "map", name: "地图", library: "GIS", category: "GIS / 地图", type: "model", color: "#fff", tags: [] },
];

describe("asset folder hierarchy", () => {
  it("counts each group and child only within the selected library", () => {
    const folders = buildAssetFolders(items, "模型");
    expect(folders.map(({ label, count }) => [label, count])).toEqual([["医疗设备", 2], ["植被", 1]]);
    expect(folders[0].children.map(({ label, count }) => [label, count])).toEqual([["病房护理", 1], ["影像诊疗", 1]]);
    expect(items.filter((item) => matchesAssetFolder(item, "模型", folders[0].key)).map((item) => item.id)).toEqual(["bed", "mri"]);
    expect(items.filter((item) => matchesAssetFolder(item, "模型", folders[0].children[1].key)).map((item) => item.id)).toEqual(["mri"]);
  });

  it("groups all libraries separately and supports their nested categories", () => {
    const folders = buildAssetFolders(items, "全部");
    const gis = folders.find((folder) => folder.label === "GIS")!;
    expect(gis.count).toBe(1);
    expect(items.filter((item) => matchesAssetFolder(item, "全部", gis.children[0].key)).map((item) => item.id)).toEqual(["map"]);
    expect(items.filter((item) => matchesAssetFolder(item, "全部", "all"))).toHaveLength(4);
  });
});

const items2: AssetItem[] = [
  { id: "cam", name: "相机", library: "场景", category: "场景 / 相机", type: "camera", color: "#fff", tags: [] },
  { id: "car", name: "车", library: "模型", category: "交通 / 车辆", type: "model", color: "#fff", tags: [] },
  { id: "ground", name: "地表样板", library: "地表", category: "地表 / 拼接样板", type: "scene", color: "#fff", tags: [] },
  { id: "flow", name: "飞线", library: "动效", category: "动效 / 粒子飞线", type: "flyline", color: "#fff", tags: [] },
];

describe("3D 资产库分类（山海鲸 8 分类）", () => {
  it("全部视图按素材 rail 顺序分组", () => {
    const folders = buildAssetFolders(items2, "全部");
    expect(folders.map((folder) => folder.label)).toEqual(["模型", "地表", "动效", "场景"]);
  });
});

describe("建筑物三级分类 chips（山海鲸图一）", () => {
  const buildingItems: AssetItem[] = [
    { id: "house", name: "住宅楼", library: "模型", category: "建筑 / 住宅建筑", type: "model", color: "#fff", tags: [] },
    { id: "mall", name: "商业楼", library: "模型", category: "建筑 / 商业建筑", type: "model", color: "#fff", tags: [] },
    { id: "tower", name: "冷却塔", library: "模型", category: "建筑 / 构筑物", type: "model", color: "#fff", tags: [] },
    { id: "depot", name: "仓储中心", library: "模型", category: "建筑 / 工业建筑", type: "model", color: "#fff", tags: [] },
    { id: "wall", name: "隔断墙", library: "模型", category: "建筑 / 其他建筑", type: "model", color: "#fff", tags: [] },
  ];

  it("chips 全量输出山海鲸 8 分类（含空分类占位）并按固定顺序排列", () => {
    const folders = buildAssetFolders(buildingItems, "模型");
    const buildings = folders.find((folder) => folder.label === "建筑物")!;
    const chips = childChips(buildings);
    expect(chips.map((chip) => chip.label))
      .toEqual(["住宅建筑", "商业建筑", "工厂建筑", "公共建筑", "公共设备", "构筑物", "其他建筑", "工业建筑"]);
    expect(chips.map((chip) => chip.count)).toEqual([1, 1, 0, 0, 0, 1, 1, 1]);
  });

  it("chip 子分类过滤命中对应模型", () => {
    const folders = buildAssetFolders(buildingItems, "模型");
    const buildings = folders.find((folder) => folder.label === "建筑物")!;
    const depot = buildings.children.find((child) => child.label === "工业建筑")!;
    expect(buildingItems.filter((item) => matchesAssetFolder(item, "模型", depot.key)).map((item) => item.id))
      .toEqual(["depot"]);
    expect(buildingItems.filter((item) => matchesAssetFolder(item, "模型", buildings.key))).toHaveLength(5);
  });
});

describe("其余栏目三级分类 chips（山海鲸全栏目）", () => {
  const items: AssetItem[] = [
    { id: "oak", name: "乔木 · 橡树", library: "模型", category: "植被 / 乔木", type: "model", color: "#fff", tags: [] },
    { id: "bush", name: "大型灌木", library: "模型", category: "植被 / 灌木", type: "model", color: "#fff", tags: [] },
    { id: "flower", name: "红色花朵", library: "模型", category: "植被 / 草本植物", type: "model", color: "#fff", tags: [] },
    { id: "taxi", name: "出租车", library: "模型", category: "交通 / 中小型汽车", type: "model", color: "#fff", tags: [] },
    { id: "truck", name: "载货卡车", library: "模型", category: "交通 / 货车", type: "model", color: "#fff", tags: [] },
    { id: "pin", name: "标记点", library: "标绘", category: "标绘 / 通用标记", type: "marker", color: "#fff", tags: [] },
    { id: "paint", name: "混凝土灰", library: "材质", category: "材质 / 墙砖", type: "material", color: "#fff", tags: [] },
  ];

  it("植被 chips 按山海鲸顺序并含空分类占位", () => {
    const folders = buildAssetFolders(items, "模型");
    const plant = folders.find((folder) => folder.label === "植被")!;
    expect(childChips(plant).map((chip) => [chip.label, chip.count]))
      .toEqual([["推荐", 0], ["风格化", 0], ["乔木", 1], ["草本植物", 1], ["灌木", 1], ["水生植物", 0]]);
  });

  it("交通工具 chips 全量输出", () => {
    const folders = buildAssetFolders(items, "模型");
    const cars = folders.find((folder) => folder.label === "交通工具")!;
    expect(childChips(cars).map((chip) => chip.label))
      .toEqual(["中小型汽车", "工具类汽车", "货车", "特殊车辆", "飞行器", "船舶"]);
  });

  it("标绘/材质 rail 分类 chips 全量输出", () => {
    const markers = buildAssetFolders(items, "标绘").find((folder) => folder.label === "标绘")!;
    expect(childChips(markers).map((chip) => chip.label))
      .toEqual(["通用标记", "免费标记", "智慧园区", "智慧城市", "大场景标记", "智慧管廊", "主题标记", "浅色系"]);
    const materials = buildAssetFolders(items, "材质").find((folder) => folder.label === "材质")!;
    expect(childChips(materials).map((chip) => chip.label))
      .toEqual(["墙砖", "大理石", "地砖", "水磨石", "铺路石", "花岗岩"]);
  });

  it("空占位 chips 与 static 静态栏目过滤为空", () => {
    const folders = buildAssetFolders(items, "模型");
    const plant = folders.find((folder) => folder.label === "植被")!;
    const water = childChips(plant).find((chip) => chip.label === "水生植物")!;
    expect(items.filter((item) => matchesAssetFolder(item, "模型", water.key))).toHaveLength(0);
    expect(items.filter((item) => matchesAssetFolder(item, "模型", "static:3D地图"))).toHaveLength(0);
  });
});
