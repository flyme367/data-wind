# 双入口拆分：编辑器（React+Semi）/ 发布成品（零框架）

## 目标

Vite MPA 双入口，构建产物彻底分开：
- **`index.html` → 编辑器**：现状不动（React 19 + Semi Design）
- **`viewer.html` → 发布成品**：**零 React、零 Semi**，纯 TS/DOM，只含画面所需代码（WASM 引擎 + 看板 DOM + 交互）
- 首页卡片按参考图提供「全屏查看」（成品入口）与「编辑」两个动作 + 本地「已发布」绿点标记

## 复用边界（已验证无框架依赖，成品直接 import）

- `engine/` 全部（engineClient 租约、commandResponse、softwareRenderer、gpuProbe、modelLibrary、frameInput）— 对 store 仅 type-only import
- `workers/bridge.ts` + `workers/sceneModel.ts`（`flattenScene` 是纯模块，可主线程复用；场景树仍由 worker 权威维护，成品只读订阅、**不持久化**）
- `data/`、`state/projects.ts`、`types.ts`、`protocol/`、`wasm/`

## 新增文件（frontend/）

1. **`viewer.html`** — 成品外壳：`<div id="root">`、dark 主题、`/src/viewer/main.ts`
2. **`src/viewer/main.ts`** — 入口：URL 取 `?projectId=`（兼容 hash）→ `loadProjectData()`（localStorage：dw_scene_/dw_editor_/dw_board_/dw_projects，校验失败显示错误页）→ 装配 runtime；标题设为「{项目名} · 计蒙可视化」
3. **`src/viewer/canvasHost.ts`** — 从 `Viewport.tsx` 提取的无框架画布宿主（去掉编辑专属：TransformHandles、拖放、拖拽移动）：WebGPU 探测 → 引擎租约 / 软件渲染回退、rAF 循环 + take_response 分发（pick 回调驱动交互）、指针旋转/平移/缩放、resize、模型注册、环境/光照同步、`dw:camera`（focus 交互用）/`dw:reset-camera` 监听
4. **`src/viewer/runtime.ts`** — 运行时装配：bridge `openProject` + 订阅快照；`boardFit`（fit/cover/stretch）缩放计算；交互执行器（port `runInteractions`：message→toast、focus→dw:camera、color/show/hide/toggle→runtime 覆盖 → 重 flatten + sync_scene + 重渲染看板层）
5. **`src/viewer/boardRenderer.ts`** — 看板 DOM 渲染（port BoardOverlay 的 preview 路径）：按 boxSize 绝对定位、可见性沿父链判定、runtime 颜色覆盖、图表/表格/指标/文本/时钟/图片、时钟 1s 刷新、widget 点击/双击交互
6. **`src/viewer/toast.ts`** — 极简 DOM toast（成品内 message 交互提示）
7. **`src/viewer/viewer.css`** — 成品页自身样式（全屏布局、浮动全屏按钮、错误页）
8. **`src/styles/board.css`** — 从 app.css 抽出画面共享样式：`body[theme-mode=dark]` 非 Semi 基础 token、`.board-canvas`、`.board-widget*` 全家、`.viewport-*`、`.is-preview .board-canvas`。app.css 首行 `@import "./board.css"`（编辑器无感）
9. **`src/data/chartSvg.ts`** — 纯函数：`node.data.rows` → 柱/折/饼 SVG 字符串（几何与配色单源，编辑器与成品共用，防止两套渲染外观漂移）

## 修改文件

10. **`vite.config.ts`** — `build.rollupOptions.input = { main: index.html, viewer: viewer.html }`（dev 下 `/viewer.html?projectId=x` 直接可访问）
11. **`src/styles/app.css`** — 移除已抽出规则，`@import "./board.css";`
12. **`src/components/BoardComponents.tsx`** — `Chart` 的柱/折/饼几何改调 `chartSvg()`（编辑器外观不变）
13. **`src/state/projects.ts`** — `ProjectMeta` 增加 `publishedAt?: number`
14. **`src/pages/HomePage.tsx`** — ① 缩略图 hover 覆盖层改双按钮：「全屏查看」（新标签打开 `viewer.html?projectId=`）+「编辑」（原打开项目）；② footer 右侧 `publishedAt` 时显示绿点「已发布」（参考图样式）；③ 发布弹窗：导出项目文件 + 「发布/取消发布」（写 publishedAt，诚实本地语义）+ 「打开发布页」
15. **`src/components/TopMenuBar.tsx`** — 发布弹窗「打开预览」→「打开发布页」（新标签 viewer.html）；编辑器内 Esc 预览保留不动
16. **`README.md` + `CHANGELOG.md`** — 记录双入口与静态托管需 COOP/COEP 响应头

## 已知取舍（按你的选择）

- 看板 DOM 渲染存在两份（编辑器 React 版 / 成品 vanilla 版）；图表几何通过 `chartSvg.ts` 单源收敛，表格/文本等简单 DOM 各自实现
- 软件渲染（Canvas2D）回退下 `editable=false` 不拾取，成品中 3D 对象点击交互不生效 —— 与现有编辑器内预览行为一致

## 验证

1. `pnpm build`（tsc + vite build）通过；`dist/` 同时产出 `index.html` 与 `viewer.html`
2. **分包验证**：grep dist 产物，viewer 的 js chunk 不含 react/semi/douyinfe 字样，editor chunk 不受影响
3. dev 起服务，浏览器实测：编辑器回归正常；`/viewer.html?projectId=car` 全屏渲染场景 + 看板 widget，点击交互（message toast / toggle 显隐 / focus 相机）生效；无 WebGPU 时软件渲染回退可用