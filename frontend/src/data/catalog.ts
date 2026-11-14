const asset = (name: string) => `/reference/${name}`;

export const templateCategories = [
  { id: "charts", label: "大屏看板", image: asset("charts.de171fe0.webp") },
  { id: "meshes", label: "数字孪生", image: asset("meshes.1143a0d2.webp") },
  { id: "simulation", label: "物理和仿真", image: asset("phySim.3b8cd25d.webp") },
  { id: "gis", label: "GIS和地图", image: asset("gis.ad2294d4.webp") },
  { id: "report", label: "BI报表看板", image: asset("report.dcc4514d.webp") },
];

export const templates = [
  ["smart-park", "智慧园区 · 数字孪生大屏", "smart-park.preview.webp", "夜景智慧园区:楼栋/电子围栏/监测光柱/数据飞线,配左右数据面板、巡游机位与实时 mock 数据", "本地"],
  ["reference-campus", "参考模型 · 智慧园区", "reference-campus.webp", "厂房、办公楼、储罐、车辆、道路与植被组成的可编辑园区，使用 Kenney CC0 真实模型", "3.2MB"],
  ["terrain", "参考地表 · 拼接样板", "terrain-river-cross.preview.webp", "草地、步道、铺装与河道组成的地表样板，包含 17 种可复用的 Kenney CC0 地表模型", "120KB"],
  ["gis-map", "参考 GIS · 地理图层", "gis-world-boundaries.preview.webp", "基于 Natural Earth 的本地地理轮廓，配合监测点位、覆盖区域与数据飞线", "3MB"],
  ["empty", "空白地面3D场景", "msad6egw3fqc7xuhvzjh5suzsky0rpjs.webp", "这是一个黄色的空地场景，配置中等视效，适用于3D园区类项目", "3MB"],
  ["floors", "楼层分层动画示例", "a9dusk8ij4Azgz3tgjyxl51ugr5pog0m.webp", "多层建筑场景，适用于楼宇与楼层可视化项目", "12MB"],
  ["factory", "工厂底座场景", "gm0wnqievpsc5rnypnx394dmu5sn6t4y.webp", "完整的工厂园区布局，开启你的数字孪生项目", "24MB"],
  ["processing-plant", "化工厂区 · PBR 布局模板", "processing-plant.webp", "78 个 PBR 化工建筑/储罐/管廊按原始厂区布局自动摆放，真实米制比例（56MB 素材包）", "56MB"],
  ["car", "产品展示示例", "j7oykpdarazewxkAbo2zlguakpxh15es.webp", "产品展示场景，可自由调整产品颜色、位置与视角", "15MB"],
  ["pipes", "管道3D场景示例", "xp5tiqshdltu44bwjarhp3s6ewbrdqeu.webp", "工业管道与设备场景，包含流动飞线与设备标记", "18MB"],
  ["campus", "建筑底座场景A（性能优先）", "vqydfoqq95fdqzkxhoaa6rukdv0j9g3f.webp", "建筑园区场景，适用于园区与智慧工厂类项目", "26MB"],
  ["campus-b", "建筑底座场景B（视觉优先）", "hqlc8trexbawd1eoj0nnhaAk5s2kq4pk.webp", "更丰富的建筑布局与园区可视化场景", "32MB"],
  ["city", "科技风3D城市", "lchygdzxdisyxbdxdlgsatemayxl10hi.webp", "科技蓝色风格的城市建筑与动态飞线", "22MB"],
  ["product", "产品展示3D场景", "p4uwj1q5gethlnl4e8vccccfj816chfv.webp", "简洁的产品展示场景，适用于产品可视化", "8MB"],
  ["indoor", "二维孪生示例", "ib5dmohuott1vubv8qqf9csrthh9emew.webp", "室内空间和设备布局场景", "10MB"],
].map(([id, name, image, description, size]) => ({ id, name,
  image: ["smart-park", "reference-campus", "terrain", "gis-map"].includes(id) ? `/models/${image}` : asset(image), description, size }));

/** 山海鲸「3D → 鲸孪生」子库的同步实现，本地更名「锦绣孪生」：点击整组插入画布的孪生场景模板。 */
export const twinCatalog = [
  "empty", "gis-map", "campus", "campus-b", "factory", "processing-plant", "city", "product", "car", "pipes", "floors", "indoor",
  "smart-park", "reference-campus", "terrain",
].map((id) => templates.find((template) => template.id === id)!);
