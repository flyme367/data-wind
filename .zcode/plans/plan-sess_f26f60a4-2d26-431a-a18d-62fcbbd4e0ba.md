# 智慧园区 · 数字孪生大屏 Demo 实施方案

## Context

用计蒙可视化现有产品链路做一个"华丽"的 3D 智慧园区数字孪生 demo:**站在用户角度**——从首页模板库一键创建"智慧园区 · 数字孪生大屏",进入即得成品:中央夜景 3D 园区(楼栋/电子围栏/标记光柱/数据飞线粒子/雾)+ 左右深色半透明数据面板 + 相机平滑巡游 + 点击交互 + 实时跳动的 mock 数据。

同时沉淀 4 个**通用产品能力**(纯前端,不动 Rust 引擎):相机平滑飞行、预览巡游控制条、模板环境预设、Vite dev mock 数据接口。视觉基调:夜景科技蓝。

## 复用的现有设施(已核实)

- 模板机制:`createTemplateScene`(`frontend/src/data/sceneTemplates.ts:9`)+ 模板注册表(`frontend/src/data/catalog.ts:11`);场景写法参考 `referenceScene.ts` 的 `referenceCampus()`(已验证的 205 个 Kenney 模型子集:industrial-a/c/f/j、tower-glass、office、chimney、tank、crane、conveyor、road、road-junction、car/truck/ambulance/firetruck、oak/pine/tree/bush/streetlight)
- 看板组件:场景树里的 `type:"widget"` 节点(boxSize=像素尺寸、position.x/y=1920×1080 画板坐标),约 30 种 SVG 图表,预设工厂 `widgetNode()`(`frontend/src/data/editor.ts:258`)
- 交互:`runInteractions`(`frontend/src/state/sceneActions.ts:36`)click → message/focus/color/show/hide/toggle,直接配置到节点 `interactions`
- 实时数据:`LiveDataManager` api 轮询(`frontend/src/data/liveData.ts`)+ `boundNode` bindings(editor.ts:357,支持 rows/value/text/visible/color)
- 相机:`dw:camera` 事件支持 `{cameraNode}`(Viewport.tsx:223-230,读节点 position + `to`),目前瞬移
- 环境同步:`settings` → `set_environment`(Viewport.tsx:47),hud 由 `settings.grid/flylines/stats` 派生(WorkspacePage.tsx:78)——夜景只需在模板创建时种入 settings
- 预览态:WorkspacePage `preview` 分支(191-198 行),Escape 退出

## 改动清单

1. **新增 `frontend/src/data/smartParkScene.ts`** — `smartParkScene(): SceneNode[]`,仿 referenceCampus 的 add/box/model 辅助函数:
   - 布局(底座约 110×90):南大门+门卫、主干道环+路口、生产区(industrial 系列、chimney、tank×2、crane、conveyor)、办公区(tower-glass×2、office、office-low)、物流停车区(车位标线+4 车)、数据中芯区(玻璃塔+发光围栏,6 条 flyline 汇入塔顶)、绿化+路灯
   - 数字孪生要素:8 个 marker 监测点(能耗/安防/环境/消防,多色)、3 个 fence(生产区青/数据中芯紫/仓储橙)、6 条 flyline;建筑底色选夜色下偏亮的蓝青色系
   - 5 个 camera 节点机位:全景鸟瞰/生产区/办公区/数据中芯/南大门
   - 看板 widget:顶部标题栏、左列(园区总览指标卡×2 + 能耗渐变面积图 + 安防事件表)、右列(设备状态环形图 + 入园车流柱状图 + 告警列表),自带静态 data.rows 兜底;图表挂 dataSource(api → /api/park/*,intervalMs 3000-5000)+ bindings
   - 交互:关键楼栋 click→message+focus;marker click→message+toggle 隐藏 dialog"点位详情"
2. **`frontend/src/data/sceneTemplates.ts`** — 注册 `smart-park` 分支;新增导出 `templateSettings(id): Partial<EditorSettings>`(smart-park → 夜景:background `#0a0f1e`、groundColor `#0b1020`、time≈2.2、fog 开、grid 关;其余模板返回 `{}`)
3. **`frontend/src/data/catalog.ts`** — templates 首位加"智慧园区 · 数字孪生大屏"(缩略图走 `/models/` 分支)
4. **`frontend/src/pages/HomePage.tsx`** — `newProject`(:65)创建后 `persistEditorSettings(project.id, {...defaultEditorSettings, ...templateSettings(id)})`
5. **`frontend/src/components/Viewport.tsx`** — `dw:camera` 处理改为平滑飞行:tween ≈1.4s easeInOutCubic 插值 target/yaw(最短角差)/pitch/dist,pointer_down/wheel/新视角指令立即打断;engine 与 software 两条路径都支持;focus/preset/bookmark/cameraNode 统一走平滑
6. **新增 `frontend/src/components/TourBar.tsx`** — 预览态毛玻璃巡游条:按场景 camera 节点生成机位按钮(dispatch `dw:camera {cameraNode}`)+"自动巡游"开关(8s 轮播);挂载到 WorkspacePage preview 分支
7. **`frontend/vite.config.ts`** — dev 中间件 `/api/park/overview|energy|security|traffic|devices`,模块级随机游走生成 JSON(仅 dev,不影响 build)
8. **测试 + 缩略图** — 新增 `frontend/tests/smartParkScene.test.ts`(id 唯一、各 kind 数量在引擎上限内 box≤1024/marker≤128/fence≤32/flyline≤64、widget 不出画板、camera 节点含 to);完成后从浏览器预览态截图存 `frontend/public/models/smart-park.preview.jpg` 作模板缩略图

## 明确不做(后续可加)

不动 Rust 引擎:bloom/阴影/车辆沿路动画都不在本次范围(夜景华丽度靠配色+发光层+雾;车辆动画需新增增量更新 API,另立任务)。

## 验证

1. `cd frontend && pnpm dev`(127.0.0.1:5173)——本次不编译 Rust,wasm 产物已提交
2. `pnpm vitest run`:新测试 + 既有测试通过;`pnpm build`(tsc)通过
3. 浏览器(Chrome,WebGPU 可用)走完整用户路径:首页 → 模板库选"智慧园区·数字孪生大屏" → 创建 → 编辑器确认夜景/围栏/飞线渲染 → 点楼栋出 Toast、点 marker 出详情弹窗 → 顶栏"预览" → 巡游条逐机位平滑飞行 + 自动巡游 → 图表数值随 mock 跳动 → Escape 退出预览
4. 浏览器截图核对华丽度,迭代配色/雾/布局参数;满意后截预览态图存为模板缩略图