# 山海鲸「地图」分类同步（4.7.13 对照）

2026-11-06，用浏览器实机对照 workspace.shanhaibi.com 编辑器（项目「我的建筑底座场景A」，v4.7.13）盘点素材库「地图」分类 16 个组件与右侧属性面板，1:1 同步目录、卡片缩略图、数据模型、TS/SVG 渲染、Rust 看板渲染与属性面板。全程未保存山海鲸项目（插入→盘点→撤销还原，最终组件数 4/4）。

## 一、山海鲸实测记录

### 分类结构

素材库「地图」分类 16 项，子页签：**全部 / 轮廓地图 / 瓦片地图 / 三维地图**。面板 dialog 顶部另有 深色/浅色/资产库 视图切换（本项目暂不同步，画布外 UI 已 Semi 化）。

| 页签 | 组件（顺序即展示顺序） |
| --- | --- |
| 轮廓地图 | 中国地图 / 世界地图 / 美国地图 / 自定义地图 / 世界地图一（基）/ 世界地图二（基） |
| 瓦片地图 | GIS卫星地图（卫星）/ GIS电子地图（基础）/ GIS地图（黑金）/ GIS地图（蓝黑）/ GIS地图（草绿）/ GIS地图（浅蓝）/ GIS地图（深蓝） |
| 三维地图 | 3D GIS底座 / 科技风3D地图 / 写实风3D地图 |

「基」角标 = 山海鲸基础版可用标记，出现在世界地图一/二与全部 GIS 系卡片右上角（斜角蓝标）。

### 面板盘点（轮廓地图家族 6 项，实机逐分区展开）

面板头：组件名 + 版本（如「中国地图V3 | v0.1.0」）+ 查看教程链接。分区自上而下：

- **基本设置**：不透明度（0-100 滑条+%）、鼠标穿透、渲染模式（下拉，值 canvas）、地图投影方式（下拉，值 默认）；
  - 中国地图多：**地图区域**（下拉，值 全国）、**地图下钻**、**显示返回按钮**；
  - 美国地图多：**行政编码**（数字，默认 1100000000）；
  - 自定义地图多：**选择geojson文件**（点击选择文件）；
  - 世界地图：无额外项。
- **底图层**（内层「基本设置 / 提示信息」）：填充类型（颜色/图片单选）、默认颜色、高亮颜色、选中时的颜色、分界线颜色、分界线粗细(px)、外轮廓线颜色、外轮廓线粗细(px)、外轮廓线发光强度、外轮廓线发光颜色、分界线类型（实线/点线）、阴影大小(px)、阴影颜色、区域名称（开关）、强制显示所有区域名称（开关）、名称字体（字体下拉/字体大小/加粗/倾斜/下划线/删除线）。
- **呼吸点层**：显示名称、呼吸点形状（下拉，值 圆形）、呼吸点最小半径(px)、呼吸点最大半径(px)、呼吸点颜色。
- **热力层 / 柱状层 / 路线层 / 飞线层 / 标记层**：无数据时内层不渲染字段（只有「XX层基本设置」标题）。
- **展示设置**：播放动画、触发数据联动、动画延迟时长(秒)、单个滚动持续时长(秒)、循环播放动画、循环间隔(秒)。
- 公共分区：大小&位置（W/H 锁比例、组件位置 X/Y、组件旋转 X/Y/Z）、响应式布局（横向/纵向）、边框设置、背景设置、组件封面。

### 面板盘点（世界地图一/二 = 分组面板）

插入后是**分组**（世界地图一 内含 世界地图二 + 背景），组面板：不透明度、鼠标穿透、内部组件布局（静态/流式）、内部组件状态跟随、内部组件选中互斥、显示滚动条、滚轮缩放 + 允许缩放 + 展示设置 + 公共分区。两卡均带「基」角标。

### 面板盘点（瓦片地图家族，官方文档 + 实机部分）

实机插入 GIS 卡片受虚拟列表与合成事件过滤阻碍未完成全量快照，以官方文档（shanhaibi.com/docs「鲸地图」系列）补齐：瓦片地图变体**只有外观样式不同，功能设置相同**；属性面板 = 基本设置（不透明度/鼠标穿透）+ 公共分区；影像（Mapbox 测试源/天地图/自定义 URL+Token）与标绘（标记点/飞线/线段/图形/热力）、测绘、动效在**双击进入的编辑态**配置，不在属性面板。

## 二、同步实现

### 目录与卡片

- `frontend/src/data/mapCatalog.ts` 重构：16 项 1:1（label/category/顺序与山海鲸一致），chips = 全部/轮廓地图/瓦片地图/三维地图；「基」角标字段 `base`；世界地图一为 `group` 分组卡（点击整组插入 背景+世界地图二，对应山海鲸分组面板）。
- 卡片改图片式（`twin-thumb-img` 模式）：缩略图由 `pnpm thumbs:map`（`scripts/generate-map-thumbs.mjs` + `map-thumbs-entry.ts`）用**自家主题渲染**产图（headless Chrome CDP 截图 → lib-webp q60 → `public/reference/map-*.webp`），不拷贝山海鲸图片。
- 旧「数据图层」6 类（区域/点/飞线/热力/轨迹/柱状地图）：kind 保留、旧项目照常渲染，目录不再占位（山海鲸地图分类无此六项），仅在地图面板**搜索**时以「数据图层（旧）」分组出现。

### 数据模型（`node.data`，JSON 通路直达 Rust）

- `region`：china/world/usa/custom（地图区域）；`projection`：mercator/equirect（地图投影方式）；中国专属 `drill`（地图下钻）、`backButton`（显示返回按钮）；美国 `adminCode`（行政编码）；自定义 `geojson`（内嵌 FeatureJSON，≤1.5MB）。
- `map`（底图层全量字段）：fillType/fillImage/defaultColor/highlightColor/selectedColor/borderColor/borderWidth/borderStyle/outlineColor/outlineWidth/outlineGlow/glowColor/shadowSize/shadowColor/showRegionNames/forceShowNames/nameFont{family,size,bold,italic,underline,strike}。
- `breath`（呼吸点层）：showName/shape/minR/maxR/color。
- `show`（展示设置）：playAnim/triggerLinkage/animDelay/scrollDuration/loopAnim/loopInterval。
- `theme`（瓦片主题）+ `tile`：centerLon/centerLat/zoom/minZoom/maxZoom/moveZoom/tileSource。
- kind 新增 `mapOutline`/`mapTile`（editor.ts widgetLabels/controlPresets 默认 1280×720 + 上述默认配置 + MAP_CHINA_ROWS 省级示例数据）。

### 渲染（TS 与 Rust 同参数同视觉）

- 协议：`command_response.fbs` GeoFeature 加 `dataset:string`（world/china/usa），flatc 重新生成；`encodeGeoJsonDocument` 带 dataset；boardCanvas loadGeojson 合并下发三个数据集（china/usa 的小写 name 归一化为 NAME/NAME_ZH）。
- 数据：`public/gis/china-provinces.geojson`（DataV.GeoJSON 35 省份）+ `us-states.geojson`（US Census 州界 52），来源记录于 `public/gis/ATTRIBUTION.md`。
- `mapSvg.ts`：REGION_VIEWS（中国 73.4-135.2/15.6-54.3、美国 -125.6--65.4/23.6-50.6 墨卡托；世界等距圆柱）、makeProjector（zoom 语义同瓦片：每 +1 经度跨度减半）、MAP_THEMES 十种主题（outline/satellite/basic/black-gold/blue-black/grass-green/light-blue/deep-blue/gis3d-base/tech-3d/realistic-3d）、区域子集 byDataset、底图层全量绘制（填充/分界线实线点线/外轮廓发光/阴影/区域名称标注/名称字体）、呼吸点层（CSS map-breath 脉冲）、自定义 GeoJSON。
- Rust（engine-rs/data-wind-cpu/src/board/）：WIDGET_KINDS 加 mapOutline/mapTile；widgets.rs match 分支；maps.rs 重构——earcut 改在**经纬空间**做一次（三角剖分投影无关），Country 存 lonlat 环 + lonlat 三角网，区域视图重投影顶点即可（免缓存/免逐帧 earcut，自定义地图小数据逐帧解析）；paint_region 实现主题/区域/标注/呼吸点（clock 驱动脉冲）；probe 的 14 项看板测试遍历 WIDGET_KINDS 全白名单通过。

### 属性面板（WidgetProperties.tsx）

mapOutline/mapTile 专用分区（其余组件不变）：地图设置（地图标题/渲染模式/地图投影方式/地图区域/地图下钻/显示返回按钮/行政编码/选择geojson文件）→ 底图层（全量字段，mapOutline）→ 呼吸点层（mapOutline）→ 影像设置（底图样式十主题下拉 + 中心点/缩放级别，mapTile）→ 展示设置（mapOutline）→ 公共分区保留。地图类不再显示 组件内容/文本设置（对齐山海鲸）。

## 三、边界结论（不实现/近似项）

1. **三维地图 3 项**（3D GIS底座/科技风/写实风）：山海鲸为 3D 场景组件；本看板渲染器是 2D egui，目录按 1:1 收录，插入为 mapTile 2D 风格化近似（gis3d-base/tech-3d/realistic-3d 主题）。真 3D 底座后续走 3D GIS 素材库单独同步。
2. **瓦片地图在线影像**：山海鲸默认 Mapbox 测试源 + 天地图/自定义 URL；本项目离线优先，`tile.tileSource` 仅存配置，离线渲染始终用内置主题矢量边界（文档已在面板注明）。中心点/缩放级别为离线矢量渲染必需，作为面板配置项补入（山海鲸靠画布交互缩放）。
   - **2026-11-07 在线影像接入（补齐最后的质感差距）**：`tile.imagery` 三档——`内置主题 / 卫星影像（ArcGIS World Imagery）/ 电子地图（OSM）`，GIS卫星卡默认卫星影像、GIS电子卡默认电子地图。渲染分工：TS 侧按当前视野取 Web 墨卡托 XYZ 瓦片网格（z 分辨率对齐合成画布，≤48 片自动降级；跨节点 LRU 瓦片缓存 240），逐片到位后在 decodeCanvas 合成 2:1 底图 → set_image；Rust `paint_region` 影像存在时铺底并跳过海色/经纬网/陆地填充，矢量只叠加省界 + 区域名 + rows 半透明高亮。**离线 / 跨域 / 全部瓦片失败自动回退内置主题矢量**（无纹理即矢量分支）。坑：① uploadPixels 会重设 decodeCanvas.width（同值也清空画布），自拷贝前内容已被抹掉——合成器必须直接 getImageData + set_image；② 无 DOM 父节点的 `new Image()` 若无强引用会在加载中被 GC（请求无声消失）——立即挂入 resource.imagery.tiles。headless 实测 WebGPU 与 CPU 双路径均出真实影像（artifacts/map-components-imagery-satellite.webp）。
   - **2026-11-06 对齐山海鲸卡片补充**：GIS 七变体与三维地图 3 变体的 mapTile 预设默认 `region=china`、视野 centerLon 105 / centerLat 36，省界主题配色 + 区域名 + rows 首都（北京市）高亮——Rust `paint_region` 瓦片填充命中 rows 用主题高亮色，`mapSvg tileSvg` 缩略图同参数渲染，缩略图已按中国视图重产（`pnpm thumbs:map`）；世界地图一/二保持世界视野。headless 实测：素材面板 GIS 卡片与画布插入均为中国省级主题视图（artifacts/map-components-gis-china-*.webp），vitest 197 全绿。
3. **热力/柱状/路线/飞线/标记层**：山海鲸中国地图V3 把六类数据图层内嵌为一组件；本项目保留六类旧 kind（数据图层，搜索可见），mapOutline 当前内嵌 呼吸点层，其余层后续按需并入。
4. **地图下钻/返回按钮/行政编码**：配置先存储，渲染端暂未实现下钻导航。
5. **世界地图一/二**：以「背景 + 卫星/写实主题地图」两片分组近似山海鲸的浮雕分组模板；组面板的 内部组件布局/状态跟随/选中互斥/滚轮缩放 沿用现有分组能力，未逐项新增。

## 四、验证

- tsc 干净；oxlint 0 警告；vitest 全量通过（mapCatalog.test.ts 重写：16 项 1:1 断言/分组卡/墨卡托投影/主题表/旧六类兼容）；cargo test --workspace 全过（含 probe 14 项看板渲染）；`pnpm build:engine` 双变体 wasm 重建。
- `pnpm thumbs:map` 产图 16 张（7-48KB）；浏览器实测见 docs/screenshots（素材卡片/画布/面板）。
- 自定义地图 GeoJSON 上传链路 headless E2E 实测通过（2026-11-06）：面板选择文件 → Toast「GeoJSON 已加载」→ 按钮态「已加载 GeoJSON」→ 自定义多边形按世界视野渲染（截图 artifacts/map-components-custom.webp）。两点后续可改进：① 自定义区域沿用世界视野，小面积 GeoJSON（厂区级）仅数像素，建议按要素包围盒自适应视野（山海鲸行为）；② 预设省级 `rows` 仍作用于自定义地图，呼吸点会压在自定义多边形上方，自定义场景宜清空默认 rows。
- 山海鲸侧：全程未保存项目，插入组件已撤销，最终组件数 4/4 无残留。
