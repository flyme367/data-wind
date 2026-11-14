# 3D 图表组件（仿山海鲸 3D 分类）实现计划

## Context

山海鲸看板素材库有"3D"分类：左栏 3D（21 项），面板顶部子页签「全部/鲸孪生/3D图表」，3D图表下有 基础3D分组柱状图 / 基础3D堆积柱状图 / 基础3D饼状图 / 基础3D环形图 / 基础3D玫瑰图 / 基础3D玫瑰环图 6 种。目标是给 data-wind 增加同款能力：看板左栏 3D 改为组件分类（子页签：全部/3D图表，"鲸孪生"是山海鲸自有子库、无对应内容，不做），并实现全部 6 种 3D 图表。

**关键架构事实**（已核实）：看板像素由 Rust egui 引擎绘制——`BoardOverlay` → `RustBoardHost`（`frontend/src/engine/boardCanvas.ts`）→ `engine-rs/data-wind-engine/src/board/`。未知 kind 会被 `mod.rs:288` 拒绝整块看板同步（"Rust 渲染器不支持组件"）。TS 侧 `chartSvg.ts` 仅用于面板缩略图（`ChartThumb`/KitThumb）。**因此每种 3D 图表需要 TS（SVG 缩略图）与 Rust（egui 画板）双实现**，缺 Rust 侧会直接炸掉整个看板。

## 图表几何设计（伪 3D / 等轴测）

- **3D 柱状图**：每根柱 3 个面——正面矩形、顶面平行四边形（沿 (+dx,-dy) 斜切）、右侧面平行四边形；暗面用颜色加深。分组 = 每行各系列并排；堆积 = 同 x 纵向叠加；柱宽/间距复用现有 `barGrouped`/`barStacked` 布局参数；底部 x 轴标签 + 示例行名。
- **3D 饼/环形/玫瑰/玫瑰环**：椭圆投影（ry = rx×0.45）+ 挤出深度 depth ≈ size×0.12：先画各扇区**侧壁带**（分段凸四边形，同现有 `ring()` 的分段方式，外弧点 y+depth），再画**顶面椭圆楔形**；环形/玫瑰环 = 内半径椭圆挖洞；玫瑰 = 外半径按值映射（0.3+value/max×0.7）。颜色 `series_color`/`pieColors`，图例沿用现有 pie 分支的右侧图例（名称+数值）。
- 数据入口与 2D 图表一致：`rows()`（TS `chartRows`），value/value2/value3 多系列。

## TS 侧修改

1. **`frontend/src/data/editor.ts`**
   - `WidgetKind`（L4）追加 `bar3dGrouped | bar3dStacked | pie3d | donut3d | rose3d | roseRing3d`；
   - `widgetLabels`（L111，**编译关键**，Record 全量）加 6 项中文标签（基础3D分组柱状图 等）；
   - `chartWidgetKinds`（L128）追加 → `isChartWidget` 驱动的默认尺寸 420×260、属性面板"图表颜色"、MetadataPanel rows 绑定全部自动生效；
   - `chartSamples`（L136）加 3D 示例行。
2. **`frontend/src/data/chartCatalog.ts`**：`chartCategories`（L6）加 `"3D图表"` chip；`chartCatalog` 加 6 条 `{kind, label, category:"3D图表"}`。
3. **`frontend/src/data/chartSvg.ts`**：在 fallback（L326）前加 3D 分支，绘制上述几何（`polygon`/`path`，viewBox 400×190）。
4. **`frontend/src/components/BoardComponents.tsx`**
   - `ComponentPalette` 新分支 `category==="3D"`：顶部复用 `.palette-chips` 渲染子页签「全部/3D图表」（本地 useState，仿 `ChartPalette` L49-62 的 chip 模式），网格卡片复用 `ChartCard`（缩略图自动走新 chartSvg 分支）；
   - `boardCategoryCounts`（L22）加 `3D: 6`，"全部"分支（L321-336）加"3D图表"分区。
5. **`frontend/src/pages/WorkspacePage.tsx`**：删除 rail onClick 里 `itemKey==="3D"` 进入 3D 编辑的 hijack（L174），"3D" 变普通分类打开 `ComponentPalette category="3D"`；进入 3D 编辑保留现有三入口（双击画布 L194、底栏按钮 L205、顶栏菜单）。

## Rust 侧修改（engine-rs/data-wind-engine/src/board/）

1. **`mod.rs`** `WIDGET_KINDS`（L21）追加 6 个 kind 字符串。
2. **`widgets.rs`** dispatch（L108）把 3D kinds 并入 chart arm（label + `paint_chart`）。
3. **`charts.rs`** `paint_chart` 新增 3D 分支：
   - `bar3d`：按分组/堆积布局逐柱绘制三面（`Shape::convex_polygon`，明暗变体用 `Color32` 乘系数变暗）；
   - `pie3d/donut3d/rose3d/roseRing3d`：写一个椭圆挤出助手（分段楔形侧壁 + 顶面），参数化 inner/rose；
   - 注意绘制顺序：先侧壁后顶面、扇区按从后往前的角度序画避免遮挡错乱。
4. 环境怪癖：cargo 不在 PATH，需 `export PATH="$HOME/.cargo/bin:$PATH"`；构建用 `pnpm build:engine`（wasm-bindgen 会重新生成 `frontend/src/wasm` 绑定）。

## 测试

- 新增 `frontend/src/tests/chart3d.test.ts`（仿 `controlCatalog.test.ts`）：6 条目 kind/label 与 `widgetLabels` 对齐、`widgetNode(kind)` 默认尺寸与示例 rows、`chartSvg` 输出含 3D 特征（多边形面数/深度偏移）。
- 既有 catalog/editor 测试不受影响（`chartSamples`/`controlPresets` 是 Partial；唯一编译关键 `widgetLabels` 已覆盖）。

## 验证

1. `export PATH="$HOME/.cargo/bin:$PATH" && pnpm build:engine`（Rust 编译 + wasm 再生成），`pnpm typecheck && pnpm lint && pnpm test`。
2. `pnpm dev`（127.0.0.1:5173，复用常驻 dev server，HMR 加载 TS 改动；wasm 变更需硬刷新）。
3. 浏览器端到端（IAB，沿用既有技巧：locator click 会挂起 → evaluate dispatch；浮层断言在同一单元格）：
   - 看板模式左栏点 3D → 面板出现子页签 全部/3D图表 与 6 张卡片（缩略图为伪 3D SVG）；
   - 逐个添加到画板 → Rust egui 渲染与缩略图风格一致（对照山海鲸截图），无"Rust 渲染器不支持组件"报错；
   - 属性面板改标题/图表颜色生效；拖拽/缩放/右键菜单正常；预览（boardRenderer 同 Rust 渲染）一致；
   - 打开旧项目（不含 3D 组件）确认无回归；⌘Z 可撤销添加。