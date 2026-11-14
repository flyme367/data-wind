import type { SceneNode, Vec3 } from "../types";
import type { Interaction, WidgetConfig, WidgetKind } from "./editor";
import { widgetNode } from "./editor";
import type { DataSourceConfig } from "./dataSources";
import { modelAssetById } from "./modelCatalog";
import { modelNode } from "./modelNode";

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

/** 夜景配色:深蓝底座 + 高饱和发光要素(围栏/飞线/标记),建筑模型统一冷蓝 tint。 */
const PALETTE = {
  base: "#202A42",
  pavement: "#2C3757",
  lawn: "#1C3E4C",
  parking: "#2C3654",
  laneMark: "#7E8BA6",
  gate: "#2A3554",
  guard: "#33406B",
  tint: "#CFDCFF",
  tree: "#B9CCE8",
  vehicle: "#E8EEFF",
  cyan: "#4BA9FF",
  teal: "#22D3EE",
  green: "#56E6AE",
  orange: "#FFB547",
  purple: "#B48CFF",
  red: "#FF6B81",
} as const;

const apiSource = (endpoint: string, intervalMs: number): DataSourceConfig =>
  ({ kind: "api", enabled: true, url: `/api/park/${endpoint}`, path: "", method: "GET", headers: {}, body: "", intervalMs });

/** 智慧园区 · 数字孪生大屏:夜景园区 + 监测点/围栏/数据飞线 + 看板面板 + 巡游机位。 */
export function smartParkScene(): SceneNode[] {
  let serial = 0;
  const nodes: SceneNode[] = [];
  const add = (partial: Partial<SceneNode> & { type: SceneNode["type"] }) => {
    const node: SceneNode = {
      id: `smart-park-${++serial}`, name: "场景对象",
      visible: true, locked: false, parentId: null, color: "#FFFFFF",
      transform: { position: v(0, 0, 0), rotation: v(0, 0, 0), scale: v(1, 1, 1) },
      ...partial,
    };
    nodes.push(node);
    return node;
  };
  const box = (name: string, x: number, z: number, width: number, depth: number, color: string, y = .1, height = .2) =>
    add({ type: "model", name, color, boxSize: { x: width, y: height, z: depth }, transform: { position: v(x, y, z), rotation: v(0, 0, 0), scale: v(1, 1, 1) } });
  const model = (id: string, x: number, z: number, yaw = 0, scale = 1, color: string = PALETTE.tint, name?: string) => {
    const asset = modelAssetById.get(id);
    if (!asset) throw new Error(`Missing reference model: ${id}`);
    const instance = modelNode(asset);
    instance.transform!.position = { x, y: asset.size[1] * scale / 2 + .25, z };
    instance.transform!.rotation.y = yaw;
    instance.transform!.scale = { x: scale, y: scale, z: scale };
    return add({ ...instance, name: name ?? instance.name!, color });
  };
  /** 模型摆放后的顶部高度,用于楼顶标记点 / 发光塔冠 / 飞线起点。 */
  const topOf = (id: string, scale = 1) => (modelAssetById.get(id)?.size[1] ?? 2) * scale + .25;

  // —— 告警详情弹窗(默认隐藏,由监测点点击唤出) ——
  const dialog = add({
    type: "widget", id: "smart-park-dialog", name: "点位详情弹窗", visible: false,
    color: PALETTE.teal, boxSize: { x: 440, y: 250, z: 1 },
    transform: { position: v(740, 380, 0), rotation: v(0, 0, 0), scale: v(1, 1, 1) },
    widget: { ...widgetNode("dialog").widget!, text: "监测点详情", value: "点击园区内任意监测点,查看该点位的实时详情(能耗 / 环境 / 安防 / 消防等 8 类,数据每 4 秒自动刷新)。",
      background: "#0D1730F2", borderColor: PALETTE.teal, opacity: 1, radius: 10 },
  });

  const marker = (name: string, x: number, z: number, color: string, y = .8, info = name) => add({
    type: "marker", name, color, boxSize: { x: .6, y: .6, z: .6 },
    transform: { position: v(x, y, z), rotation: v(0, 0, 0), scale: v(1, 1, 1) },
    interactions: [
      { id: `smart-park-int-${++serial}`, event: "click", action: "message", targetId: "", value: `${name} · ${info}` },
      { id: `smart-park-int-${++serial}`, event: "click", action: "toggle", targetId: dialog.id, value: "" },
    ] satisfies Interaction[],
  });
  const flyline = (name: string, from: Vec3, color: string) => add({
    type: "flyline", name, color, boxSize: { x: .3, y: .3, z: .3 },
    transform: { position: from, rotation: v(0, 0, 0), scale: v(1, 1, 1) },
    to: DATA_TOP,
  });
  const fence = (name: string, x: number, z: number, width: number, depth: number, color: string) => add({
    type: "fence", name, color, boxSize: { x: width, y: .1, z: depth },
    transform: { position: v(x, .05, z), rotation: v(0, 0, 0), scale: v(1, 1, 1) },
  });

  // —— 数据中芯塔顶:全部飞线的汇聚点 ——
  const DATA_TOP = v(-14, topOf("tower-glass", 1.15) + 1.2, 12);

  // —— 地基与道路 ——
  box("园区底座", 0, 0, 64, 48, PALETTE.base, -.25, .5);
  box("园区铺装", 0, 0, 62.5, 46.5, PALETTE.pavement, .04, .08);
  for (const x of [-30, -24, -18, -12, -6, 6, 12, 18, 24, 30]) model("road", x, 0, 90);
  for (const z of [-21, -15, -9, -3, 3, 9, 15, 21]) model("road", 0, z);
  model("road-junction", 0, 0, 0, 1, PALETTE.tint, "中心路口");

  // —— 四大功能区草坪 ——
  box("生产区地坪", -16.5, -12.5, 25, 19, PALETTE.lawn, .13, .12);
  box("办公区景观", 16.5, -12.5, 25, 19, PALETTE.lawn, .13, .12);
  box("数据中芯区景观", -16.5, 12.5, 25, 19, PALETTE.lawn, .13, .12);
  box("物流区地坪", 16.5, 12.5, 25, 19, PALETTE.lawn, .13, .12);

  // —— 生产区(西南) ——
  model("industrial-c", -19, -13, 0, 1, PALETTE.tint, "生产厂房 A");
  model("industrial-a", -10, -13, 0, 1, PALETTE.tint, "生产厂房 B");
  model("industrial-j", -26.5, -13, 90, .55, PALETTE.tint, "装配车间");
  model("chimney", -26, -7, 0, 1.25, PALETTE.tint, "锅炉烟囱");
  model("tank", -26, -14, 0, .7, PALETTE.tint, "原料储罐");
  model("conveyor", -14, -6.5, 0, .6, PALETTE.tint, "输送廊道");
  model("crane", -10, -6.5, 90, .55, PALETTE.tint, "龙门吊");
  fence("生产区电子围栏", -16.5, -12.5, 25, 19, PALETTE.teal);

  // —— 办公区(东北) ——
  model("tower-glass", 12, -14, 0, 1.3, "#BFD8FF", "研发中心 A");
  model("office", 20, -14, 0, 1, PALETTE.tint, "研发中心 B");
  model("office-low", 12, -6.5, 90, .8, PALETTE.tint, "综合服务楼");
  model("office", 20, -6.5, 0, .85, PALETTE.tint, "企业孵化楼");
  box("研发中心A塔冠", 12, -14, 2.6, 2.6, PALETTE.cyan, topOf("tower-glass", 1.3) + .1, .25);

  // —— 数据中芯(西北) ——
  model("tower-glass", -14, 12, 0, 1.15, "#BFD8FF", "数据中芯");
  model("office-low", -24, 12, 90, .7, PALETTE.tint, "运维中心");
  box("数据中芯塔冠", -14, 12, 2.8, 2.8, PALETTE.purple, topOf("tower-glass", 1.15) + .1, .25);
  fence("数据中芯围栏", -16.5, 12.5, 25, 19, PALETTE.purple);

  // —— 物流区(东南) ——
  model("industrial-a", 14, 10, 0, 1, PALETTE.tint, "物流仓库");
  fence("物流区围栏", 16.5, 12.5, 25, 19, PALETTE.orange);
  const vehicles = ["car", "car", "truck", "ambulance", "car", "truck"];
  for (const [index, x] of [7, 10.5, 14, 17.5, 21, 24.5].entries()) {
    box(`停车位 ${index + 1}`, x, 19, 3.4, 5.2, PALETTE.parking, .17, .08);
    box(`车位标线 ${index + 1}`, x - 1.55, 19, .08, 4.8, PALETTE.laneMark, .23, .02);
    model(vehicles[index]!, x, 19, 0, .72, PALETTE.vehicle);
  }

  // —— 南大门 ——
  box("门卫亭", 5.5, 22.5, 3, 3, PALETTE.guard, 1.4, 2.6);
  box("大门立柱(西)", -3.5, 22.5, .8, .8, PALETTE.gate, 1.6, 3.2);
  box("大门立柱(东)", 3.5, 22.5, .8, .8, PALETTE.gate, 1.6, 3.2);
  fence("门禁感应线", 0, 22.5, 7.8, .6, PALETTE.orange);
  model("firetruck", -5.5, 19, 0, .75, PALETTE.vehicle, "消防值勤车");

  // —— 绿化与路灯 ——
  for (const x of [-24, -16, -8, 8, 16, 24]) model("tree", x, 22.6, 0, .9, PALETTE.tree);
  for (const z of [-15, -7, 7, 15]) {
    model("oak", 29.5, z, 0, .85, PALETTE.tree);
    model("pine", -29.5, z, 0, .9, PALETTE.tree);
  }
  for (const [x, z] of [[-4, 20], [4, 20]] as const) model("bush", x, z, 0, .3, PALETTE.tree);
  for (const [x, z] of [[-3.5, -12], [3.5, -12], [-3.5, 12], [3.5, 12]] as const) model("streetlight", x, z, 0, 1, PALETTE.tint);

  // —— 监测点(八处) ——
  marker("能耗总表监测点", -14, 12, PALETTE.cyan, topOf("tower-glass", 1.15) + .6, "数据中芯 · 实时负荷 4,210 kW");
  marker("环境监测点", 16, -16, PALETTE.green, .8, "PM2.5 32μg/m³ · 温度 18.4℃");
  marker("安防监控点", -2, 22.5, PALETTE.orange, .8, "南大门 · 人脸识别闸机 ×4");
  marker("消防水压监测点", -24, -10, PALETTE.red, .8, "管网压力 0.68MPa · 正常区间");
  marker("车流闸口监测点", 2, 22.5, PALETTE.cyan, .8, "今日入园 486 车 · 出园 452 车");
  marker("光伏发电监测点", 12, -6.5, PALETTE.green, topOf("office-low", .8) + .6, "屋顶光伏 · 今日发电 2,340 kWh");
  marker("仓储安防监测点", 14, 10, PALETTE.orange, topOf("industrial-a", 1) + .6, "物流仓库 · 出入库 1,860 件");
  marker("电梯运行监测点", 20, -14, PALETTE.cyan, topOf("office", 1) + .6, "研发中心 B · 电梯 6 部运行正常");

  // —— 数据飞线:各楼宇汇入数据中芯 ——
  flyline("生产数据链路", v(-19, topOf("industrial-c", 1) + .5, -13), PALETTE.cyan);
  flyline("研发数据链路", v(12, topOf("tower-glass", 1.3) + .5, -14), PALETTE.teal);
  flyline("孵化数据链路", v(20, topOf("office", 1) + .5, -14), PALETTE.green);
  flyline("物流数据链路", v(14, topOf("industrial-a", 1) + .5, 10), PALETTE.orange);
  flyline("门禁数据链路", v(5.5, 3.2, 22.5), PALETTE.red);
  flyline("运维数据链路", v(-24, topOf("office-low", .7) + .5, 12), PALETTE.purple);

  // —— 巡游机位(position 为相机眼位,to 为注视点) ——
  const camera = (name: string, eye: Vec3, to: Vec3) => add({
    type: "camera", name, parentId: null, color: "#666666", boxSize: { x: 0, y: 0, z: 0 },
    transform: { position: eye, rotation: v(0, 0, 0), scale: v(1, 1, 1) }, to,
  });
  camera("全景鸟瞰", v(34, 68, 46), v(0, 0, 2));
  camera("生产区视角", v(-16, 12, 2), v(-16, 2, -12));
  camera("办公区视角", v(20, 11, -1), v(17, 3, -13));
  camera("数据中芯视角", v(0, 22, 34), v(-15, 2, 12));
  camera("南大门视角", v(0, 8, 9), v(0, 2, 23));

  // —— 夜景补光(低强度冷色平行光) ——
  add({ type: "light", name: "夜景补光", parentId: null, color: "#7FA8FF", boxSize: { x: 0, y: 0, z: 0 },
    transform: { position: v(10, 20, 8), rotation: v(0, 0, 0), scale: v(1, 1, 1) }, lightIntensity: .85 });

  // —— 看板面板 ——
  const widget = (
    kind: WidgetKind, name: string, x: number, y: number, w: number, h: number,
    overrides: { color?: string; widget?: Partial<WidgetConfig>; data?: Record<string, unknown>; dataSource?: DataSourceConfig; bindings?: Record<string, string> } = {},
  ) => {
    const base = widgetNode(kind);
    return add({
      type: "widget", name, color: overrides.color ?? base.color ?? PALETTE.cyan,
      boxSize: { x: w, y: h, z: 1 },
      transform: { position: v(x, y, 0), rotation: v(0, 0, 0), scale: v(1, 1, 1) },
      widget: { ...base.widget!, text: name, background: "#0D1730E0", borderColor: "#22406B", radius: 8, ...overrides.widget },
      data: overrides.data ?? base.data,
      dataSource: overrides.dataSource, bindings: overrides.bindings,
    });
  };
  widget("text", "计蒙智慧园区 · 数字孪生中心", 0, 0, 1920, 84, {
    color: "#8FC7FF",
    widget: { text: "计蒙智慧园区 · 数字孪生中心", fontSize: 30, align: "center", fontWeight: 600,
      background: "#0A1226E6", borderColor: "#1E3A5F", borderWidth: 1 },
  });
  widget("metric", "在园人数", 24, 104, 194, 116, {
    color: PALETTE.cyan,
    widget: { value: "1,286", unit: "人", fontSize: 34, background: "#0D1730E0", borderColor: "#22406B" },
    dataSource: apiSource("overview", 4000), bindings: { value: "people" },
  });
  widget("metric", "今日产值", 234, 104, 190, 116, {
    color: PALETTE.green,
    widget: { value: "862", unit: "万元", fontSize: 34, background: "#0D1730E0", borderColor: "#22406B" },
    dataSource: apiSource("overview", 4000), bindings: { value: "output" },
  });
  widget("areaGradient", "园区能耗趋势 (kWh)", 24, 240, 400, 290, {
    data: { rows: Array.from({ length: 12 }, (_, i) => ({ name: `${String(8 + i).padStart(2, "0")}:00`, value: 320 + Math.round(180 * Math.sin(i / 2.4) + 90 * Math.sin(i / 5)) })) },
    dataSource: apiSource("energy", 4000), bindings: { rows: "rows" },
  });
  widget("table", "安防事件", 24, 550, 400, 280, {
    data: { columns: ["时间", "区域", "事件"], rows: [
      ["10:21", "南大门", "人员翻越预警"], ["09:58", "生产区", "温感报警恢复"], ["09:36", "物流区", "货车超速提醒"], ["09:12", "数据中芯", "门禁异常闯入"], ["08:47", "办公区", "消防通道占用"],
    ] },
    dataSource: apiSource("security", 5000), bindings: { rows: "rows" },
  });
  widget("gauge", "设备在线率", 24, 850, 194, 200, {
    color: PALETTE.green, data: { rows: [{ name: "在线率", value: 98.6 }] },
    dataSource: apiSource("overview", 4000), bindings: { rows: "rows" },
  });
  widget("waterball", "消防水压", 234, 850, 190, 200, {
    color: PALETTE.red, data: { rows: [{ name: "水压", value: 68 }] },
  });
  widget("pie", "设备状态分布", 1496, 104, 400, 300, {
    data: { rows: [{ name: "运行", value: 128 }, { name: "预警", value: 9 }, { name: "离线", value: 4 }, { name: "检修", value: 3 }] },
    dataSource: apiSource("devices", 5000), bindings: { rows: "rows" },
  });
  widget("barGradient", "入园车流 (辆/时)", 1496, 424, 400, 260, {
    data: { rows: ["08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00"].map((name, i) => ({ name, value: 40 + Math.round(50 * Math.sin(i / 2.6) + 30 * ((i * 7) % 5)) })) },
    dataSource: apiSource("traffic", 4000), bindings: { rows: "rows" },
  });
  widget("list", "实时告警", 1496, 704, 400, 300, {
    data: { items: ["10:21 南大门 · 人员翻越预警", "10:07 生产区B · 温感报警恢复", "09:58 物流区 · 货车超速提醒", "09:36 数据中芯 · 门禁异常闯入", "09:12 办公区 · 消防通道占用"] },
    dataSource: apiSource("alarms", 5000), bindings: { items: "rows" },
  });

  // —— 关键楼栋交互:点击弹信息 + 聚焦 ——
  const describe = (name: string, node: SceneNode, info: string) => {
    node.interactions = [
      { id: `smart-park-int-${++serial}`, event: "click", action: "message", targetId: "", value: `${name} · ${info}` },
      { id: `smart-park-int-${++serial}`, event: "click", action: "focus", targetId: node.id, value: "" },
    ];
  };
  describe("数据中芯", nodes.find((n) => n.name === "数据中芯")!, "机柜 1,200 架 · PUE 1.21 · 承载园区全部数据链路");
  describe("研发中心 A", nodes.find((n) => n.name === "研发中心 A")!, "18 层 · 入驻率 92% · 今日用电 3,240 kWh");
  describe("研发中心 B", nodes.find((n) => n.name === "研发中心 B")!, "入驻企业 12 家 · 电梯 6 部运行正常");
  describe("生产厂房 A", nodes.find((n) => n.name === "生产厂房 A")!, "今日产量 4,280 件 · 良率 99.2%");
  describe("物流仓库", nodes.find((n) => n.name === "物流仓库")!, "今日出入库 1,860 件 · 月台占用 3/6");

  return nodes;
}
