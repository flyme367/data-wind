# data-wind · 计蒙可视化

本地运行的可视化工作台应用，覆盖工作台、项目模板窗口、看板编辑器和 3D 编辑状态。

产品名**计蒙可视化**取自《山海经·中山经》：光山之神计蒙"人身而龙首，恒游于漳渊，出入必有飘风暴雨"——司风之神呼应仓库名 data-wind，"计"字扣数据与计算。代码标识（目录、crate、npm 包名）仍沿用 data-wind。

当前范围是**界面复刻和可运行的本地三维编辑流程**：深色导航、项目管理、模板选择、图层树、标尺画板、属性面板，以及独立的 Rust WebGPU 引擎。完整云端业务和高精度模板模型尚未实现，不能视为全量功能、场景资产均一致的成品。

## 技术栈

| 层 | 实现 |
| --- | --- |
| 页面、菜单、表单、面板 | React 19.3.1、Semi Design 2.104.0 |
| 构建、样式、检查 | Vite 8.3.5、TailwindCSS 4.3.3、Oxlint 1.90.0、TypeScript |
| 3D 数学 | Rust `glam` 0.34 |
| 3D 渲染引擎 | Rust **Bevy 0.20** + bevy_egui 0.43（wgpu 30）→ WebAssembly → 浏览器 WebGPU；HUD 与场景 pass 挂在 Core3d，winit 接管 rAF |
| GPU 计算 | 仓库内的 `oxgpu` crate：视锥剔除、间接绘制、飞线粒子模拟 |
| CPU 渲染 | 仓库内的 `data-wind-cpu` crate（无 bevy 依赖）：三维软渲 + 看板 73 种组件的 egui 0.36 栅格化；无 GPU 时的兼容路径 |
| 看板 GPU 窗口 | bevy 第二窗口（Core2d + bevy_egui `run_manually`）：GPU 环境下看板组件由 bevy_egui 直接渲染 |
| CPU 并行 | Rayon 1.12；CPU 渲染 wasm 另出 atomics 变体，浏览器通过 wasm-bindgen-rayon 1.3 初始化 Web Worker 线程池，按像素行并行栅格化 |
| 引擎事件通信 | wasm-bindgen 方法调用 → FlatBuffers `CommandResponse`（Rust / TypeScript 共用 schema） |
| 场景管理、素材检索 | 独立 Web Workers |

需求中的 `egpui` 和 `oxline` 沿用现有项目解释为 `egui` 和 `oxlint`。`oxgpu` 为此仓库的自有计算 crate，不是从 crates.io 引入的同名第三方包。

wasm 产物三件：`data_wind_engine`（Bevy 3D，主线程专用、非 atomic）、`data_wind_cpu`（portable，主线程软渲回退）与 `data_wind_cpu` 的 `cpu-parallel` 变体（atomics + rayon，渲染 Worker 专用）。bevy_egui 与 egui 在 `wasm32-atomics` 下不兼容（上游 `DroppedFileHandle` 无 `Send`），因此并行构建只覆盖 CPU 渲染 crate。

主应用聚焦 Web 端，不引入 `eframe`、原生串口或 MQTT TCP 依赖。`egui_plot` 0.37 对应 `egui` 0.36，版本兼容以依赖树为准，不要求所有库的版本数字相同。

Semi 与 Tailwind 按[官方说明](https://semi.design/zh-CN/ecosystem/tailwind)配置 CSS Layer；React 19 在入口引入 Semi 的 `react19-adapter`。菜单与属性表单使用 Semi，egui 负责画布中的文本、图表、表格、地图、媒体与控件；React / DOM 负责外围工作台与素材卡片预览。

## 启动

前端要求 Node.js 20.19+（或受 Vite 8 支持的较新版本）及 pnpm：

```bash
cd frontend
pnpm install
pnpm dev
```

浏览器访问 `http://127.0.0.1:5173/`。仓库包含已生成的 WASM，首次运行前端不必重新编译 Rust。

修改 Rust 后重新构建：

```bash
rustup target add wasm32-unknown-unknown --toolchain 1.99.1
rustup toolchain install nightly --profile minimal --component rust-src --target wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.129 --locked
cd frontend
pnpm build:engine
```

Cargo 工作区使用 `edition = "2024"`、`rust-version = "1.97"`，并继承 `unsafe_code`、Clippy `all`/`pedantic` 警告设置。仓库由 [rust-toolchain.toml](rust-toolchain.toml) 固定到 Rust 1.99.1；Bevy 0.20.1 至少需要 Rust 1.97.1。并行 CPU Wasm 单独使用 nightly 和 `rust-src` 重建标准库。WASM 绑定 CLI 与锁定依赖必须保持 0.2.129 一致。

`pnpm build:engine` 生成 Bevy 三维引擎、CPU 单线程兼容渲染和 CPU 多线程渲染三个 Wasm 产物。Bevy 引擎始终运行在主线程；Rayon 只用于 CPU 兼容渲染。也可分别使用 `pnpm build:engine:single`、`pnpm build:engine:parallel`。完整构建配置与加载方式见 [Rayon 接入说明](docs/rayon.md)。

引擎事件以带版本号的 FlatBuffers 二进制返回，前端直接读取字段；字段读取不需要 JSON 解析，跨 Wasm 边界仍使用独立字节副本。schema 与生成代码已包含在项目中。可用 `pnpm test:protocol:wasm` 验证真实 Wasm 返回值及内存扩容后的读取，详见 [引擎通信契约](docs/engine-protocol.md)。

## 已接通的操作

- 项目：创建、打开、搜索、排序、重命名、复制、移动至文件夹、JSON 导入/导出。
- 回收站：软删除与恢复，保留场景数据。
- 模板：公开参考缩略图、分类、模板选择、项目名称表单；园区、工业、城市、管道和车辆模板使用真实模型。
- 模型资源：205 个本地模型资源，涵盖医疗、家具、建筑、交通、植被、道路和地理轮廓；模型分类提供 188 项（含五种基础形状）。Semi Design 素材面板支持分级分类、搜索、点击添加、拖入画布和展开浏览，属性面板可替换模型。支持导入普通内嵌 GLB，导入的几何随项目保存和导出。
- 分类素材：GIS 11 项、地表 25 项、标绘 15 项、材质颜色 12 项、动效 8 项、场景 7 项；材质用于选中对象，组合场景以独立分组插入并支持整组撤销。
- 参数化地形：3D 编辑 → 地表 → 地形，提供平地、丘陵、山地、沙丘、雪山及高度图导入；GPU Clipmaps 固定网格、GPU 位移与 LOD 过渡，Avian 0.8 提供可选的局部 HeightField 碰撞。参数支持保存、撤销和发布，详见 [地形组件](docs/terrain.md)。
- 编辑器：看板 / 3D 编辑状态切换、画板缩放、适应窗口、完整预览、画板尺寸持久化。
- 场景：新增对象与分组、多选、复制粘贴、重命名、可见性、锁定、删除、图层排序、分组与取消分组、对齐和分布。
- 属性：三轴位置、旋转与缩放、几何尺寸、颜色和变换手柄；锁定对象需先解锁才能编辑或删除。场景支持环境、地面、雾、时间、光源以及曝光、对比度和饱和度设置。
- 组件：文本、数值、图表、表格、图片、按钮、时钟，以及下拉菜单、选项卡、进度条等控件。媒体分类对齐山海鲸全部 7 个组件（图片 / 视频 / 监控 / 轮播图 / 轮播视频 / 基础PDF / 音频，配置项见 docs/media-sync.md）。支持数据绑定和点击 / 双击交互，预览状态与已保存场景分离。
- 图表：素材库包含 85 个参考图表入口，实例化配置与 Rust 渲染支持范围、数据格式和未完成项见 [图表素材与配置](docs/chart-sync.md)。
- 数据：对象属性中的“数据”面板支持静态 JSON、导入 JSON / CSV / XLSX、API GET / POST 与定时轮询、原生 WebSocket、Socket.IO、限定来源的 PostMessage、本机 MySQL / PostgreSQL 查询和本机 Webhook 推送。Socket.IO 可配置命名空间、传输路径、事件名和认证 JSON；服务端事件的第一个参数作为数据，网络断线会自动重连，服务端主动断开则需手动刷新。图表、表格、控件、文字与三维对象均可绑定字段；编辑器预览、图片导出和本地发布页使用相同的数据解析。连接配置保存在项目中，接收的数据仅保存在运行时内存，并临时覆盖同名静态字段。数据库及 Webhook 的连接管理由[本机数据服务](local-db-gateway/README.md)处理。
- Excel：仅支持 `.xlsx`，多工作表可选择其中一张；第一行作为唯一非空表头，数字与布尔值保留类型，日期转换为 ISO 时间字符串。文件和导入数据各不超过 1 MB，解压后不超过 20 MB，单表最多 5000 行、256 列和 20 万个数据单元格。公式使用文件中已保存的结果，不执行重算；表格画布最多显示 50 行和 12 列。
- 保存：按 projectId 隔离场景并自动保存；手动保存、返回工作台、导出项目和发布包前会等待已排队的编辑完成。空场景也能保存并正确重开。
- 视口与导出：轨道旋转、右键平移、滚轮缩放、拾取、定位对象、视角书签、距离测量、三维视口截图和包含场景及组件的完整看板 PNG。
- 引擎：GPU 视锥剔除、storage buffer、draw indirect、动态飞线与粒子、egui 控件；不支持 WebGPU 时显示 Rust CPU 兼容渲染，浏览器 Canvas2D 仅接收 Rust 生成的像素。

快捷键：⌘/Ctrl+S 保存；⌘/Ctrl+Z 撤销；⌘/Ctrl+Shift+Z 重做；⌘/Ctrl+C/V 复制粘贴；⌘/Ctrl+D 复制副本；⌘/Ctrl+G 分组；Delete/Backspace 删除；F 定位选中对象；Esc 退出预览。文本输入期间保留正常的编辑快捷键。

## 路由与存储

- `#/`：项目工作台、回收站、素材广场。
- `#/project/layer?projectId=...`：项目编辑器；附加 `&preview=1` 打开预览。
- `#/login`：登录界面的本地演示；验证码为 `123456`，不发送短信，也不向任何服务器提交手机号。
- `viewer.html?projectId=...`：发布成品入口（独立构建产物）。

数据保存在当前浏览器 localStorage：`dw_projects`、`dw_scene_<id>`、`dw_editor_<id>`、`dw_board_<id>`、`dw_folders`。新浏览器首次使用会创建三个本地示例；已存在的项目不会被替换。导出 JSON 可用于场景备份和迁移。

## 双入口：编辑器与发布成品

Vite 以 MPA 双入口分别打包，构建产物互不掺和：

| 入口 | 文件 | 内容 |
| --- | --- | --- |
| 编辑器 | `index.html` | React 19 + Semi Design 完整工作台 |
| 发布成品 | `viewer.html` | 零框架（无 React、无 Semi），只含画面代码：Rust WASM 引擎 / Rust CPU 兼容路径、统一的 Rust 看板渲染与交互宿主 |

成品入口复用 `engine/`、`workers/`（scene worker 仍为场景权威，只读订阅、不持久化）、`data/` 层。看板组件的场景逻辑与 CPU 栅格器位于 `engine-rs/data-wind-cpu/src/board/`；GPU 页面由 `engine-rs/data-wind-engine/src/board.rs` 将 egui 绘制结果交给 bevy_egui。Rust 负责组件几何、中文文本排版、绘制、旋转命中、选择框与控件运行时值。`src/engine/boardCanvas.ts` 负责转发场景、输入和解码后的媒体像素；发布端 `boardRenderer.ts` 是同一宿主的薄封装。

Bevy 的 RenderApp 为三维 Core3d pass 和二维 Core2d 看板窗口提供同一套设备与队列。3D 引擎沿用自定义 wgpu 场景 pass，接入 Bevy 的相机、窗口和渲染调度；HUD 由 bevy_egui 绘制。看板 GPU 窗口通过 bevy_egui 绘制组件。PNG 导出继续使用 CPU 栅格器以保留控件值和媒体帧。WebGPU 不可用时，CPU 栅格器输出 RGBA，JavaScript 只调用 `putImageData` 显示；三维拾取仍由同一份场景状态处理。

本地「发布」是项目上的本机标记：在工作台发布弹窗点「发布」后项目卡片显示「已发布」；「打开发布页」和「导出发布包」可分别在本机查看或生成静态部署文件。成品页支持交互规则（message / focus / 显隐 / 换色）、下拉菜单、选项卡与全屏。

### 发布包（可分发静态导出）

发布弹窗中的「导出发布包」生成一个自包含的 zip：`index.html`（成品入口）+ `project.json`（场景数据）+ 运行时代码 + 场景引用的模型文件（按需打包，不全量携带 205 个模型）。导入模型和基础形状的网格随项目数据保存；使用地图组件时会一并打包地理边界数据。将 zip 解压上传到静态服务器的根目录或子目录，即可访问 `index.html` 查看成品；使用本机数据库源时，查看设备还需运行并授权本机数据库连接服务。

实现：`src/publish/exportBundle.ts` 在浏览器内从当前部署站点递归收集 viewer 入口的同源资产（按 Content-Type 校验，避免 SPA 回退污染），成品数据加载支持 `?projectId=<本地工作区>`、`?src=<url>` 与默认同目录 `project.json` 三种来源（`src/viewer/main.ts`）。导出发布包需要在生产构建（`pnpm build` 后的部署站点）中使用；开发模式下会明确提示。

发布包包含两种引擎，在普通静态服务器上自动使用单线程版本。启用 Rayon 多线程需要 HTTPS（本机可用 localhost）及 COOP/COEP 响应头；Vite 开发和预览服务器已配置这些响应头。部署要求见 [Rayon 接入说明](docs/rayon.md)。

## 验证

```bash
cd frontend
pnpm test
pnpm test:board:wasm
pnpm lint
pnpm build

cd ../engine-rs
cargo fmt --all -- --check
cargo test -p native-probe --tests
cargo build -p data-wind-engine --target wasm32-unknown-unknown --release
```

自动测试覆盖项目隔离、保存队列、空场景、变换撤销/重做、锁定、分组、数据校验、WASM 异步资源释放、截图读回和取消、相机投影与拾取、WGSL 编译，以及 CPU/GPU storage buffer 数组步长一致性。

## 参考模型

“参考模型 · 智慧园区”模板包含 70 个可编辑对象，由真实模型、园区底座、绿化和停车位组成。已有项目可从左侧“模型”素材库添加资源，也可以选中旧模型后在右侧“模型资源”中直接替换。原有项目数据不会自动覆盖。

本地资源包括 127 个 Kenney CC0 模型、76 个 3D Assets 医院主题 CC0 模型和 2 个 Natural Earth 公有领域地理轮廓。3D Assets 的医院主题模型为 AI 生成，素材卡片和属性面板均有标记；这些是低多边形参考资源，并非付费商业模型。原始 GLB、逐项来源与下载地址保存在 `frontend/public/models/`，详见 [素材来源](frontend/public/models/ATTRIBUTION.md)。

模型加载器对已完成的网格字节使用 64 MiB LRU 缓存，并合并同一模型的并发请求；超出预算的单个模型仍可加载，但不保留在该缓存中。该预算不包括进行中的请求、场景持有的数据、Rust 堆内存或 GPU 资源。

WebGPU 模型加载完成后使用 `parry3d` 网格 BVH 进行三角面射线拾取，点击和拖拽共用结果，并支持三轴旋转及非等比缩放。模型尚未加载或无法建立网格查询结构时沿用包围盒命中。软件兼容渲染按实际绘制的投影三角形和绘制深度拾取，并保留标记的扩大命中区域；截图不会覆盖实时拾取状态。网格 BVH 和软件渲染的投影命中数据会增加 CPU 内存占用。

“参考地表 · 拼接样板”展示 17 种草地、步道与河道模型；“参考 GIS · 地理图层”使用 Natural Earth 公有领域地理数据，配合监测点、覆盖区域与粒子飞线。两份模板都可以新建为独立项目，也能从“场景”分类中整组添加。

`pnpm prepare:models` 先从保留的 GeoJSON 生成 GIS 轮廓 GLB，再从全部 GLB 重新生成网格、缩略图与模型目录。需要重新下载本次扩展资源时，可先在项目根目录运行 `python3 frontend/scripts/expand-reference-models.py`。导入步骤包含节点变换、法线变换、三角形索引展开及色板采样；运行时只请求场景中使用的本地网格，由 Rust 校验二进制并上传 wgpu 顶点缓冲，每类模型只上传一次。模型缩放、Y 轴旋转、拾取和撤销使用同一份场景数据。Rust CPU 兼容模式也绘制相同三角形，复杂园区的帧率低于 WebGPU。

浏览器已实测 WebGPU 渲染、编辑状态切换、属性变更与撤销、独立项目创建、清空后重开、回收站恢复。

## 当前边界

- 部分模板缩略图来自公开网络素材；参考模型园区封面为本地场景截图。未复制任何第三方项目文件或用户账户数据。
- 静态模型库保留参考资源的几何与色板。运行时可导入普通内嵌 GLB（不超过 20 MB、2 万三角面），几何压缩需先解压；完整贴图 / PBR、骨骼动画、任意 glTF、GIS 流式瓦片、后处理与仿真系统尚未实现。
- 场景使用单个轨道相机，并可从相机节点或已保存视角定位；渲染使用第一个可见灯光节点及场景环境设置，尚未实现多灯光与完整光照系统。
- 看板 PNG 最大 1600 万像素。媒体需要来源允许跨域像素读取；解码由浏览器提供（HLS / FLV / PDF 走 hls.js、mpegts.js、pdfjs-dist），画面、控制条与翻页按钮由 Rust 绘制；RTSP / RTMP 浏览器无法播放。任意网页 DOM 无法绘入 Rust 纹理，iframe 组件统一显示网址入口卡片，预览点击后在新标签页打开。
- 实时接口请求遵循浏览器跨域规则。API 请求不携带 Cookie；Socket.IO 跨站请求默认不启用凭据，同站请求及 WebSocket 握手的 Cookie 由浏览器处理。用户配置的连接地址、请求头、请求体和 Socket.IO 认证信息会包含在项目及发布文件中。原生 WebSocket 与 Socket.IO 是不同协议；MySQL / PostgreSQL 查询和本机 Webhook 推送可通过[本机数据服务](local-db-gateway/README.md)接入。其他数据库及旧版 `.xls` 尚未接入。
- 真实短信登录、云端项目存储、多人协作、在线发布及 AI 服务未接入。编辑器与编辑器内预览照常可用；“发布”为本机标记 + 本地成品入口（`viewer.html`），配合导出备份，不会报告虚假的云端发布成功。
- 当前 GPU 池最多支持 1024 个模型、128 个标记、32 个围栏与 64 条飞线。

模型资源检查与浏览器验证记录见 [模型扩展验证记录](docs/model-library-expansion.md)、[分类素材验证记录](docs/asset-library-verification.md) 和 `docs/model-verification.md`。Rust Clippy 仍有图形数值转换、文档与未使用代码等警告，尚未清零。

验收截图：[工作台](docs/screenshots/workbench.webp)、[参考模型园区](docs/screenshots/reference-campus.webp)、[模型库](docs/screenshots/model-library.webp)。

新增截图：[GIS 分类素材与参考场景](artifacts/gis-library-preview.webp)。

Rust 组件验证：`pnpm test:board:wasm` 直接运行生产 WASM，检查前后端 73 种组件目录一致、中文字体、地图、运行时输入、导出像素与三维 CPU 渲染；生成 [组件总览](artifacts/rust-board-components.webp) 和 [三维兼容渲染](artifacts/rust-3d-software.webp)。内置 Noto Sans SC 字体按 SIL OFL 1.1 分发，来源及许可见 [字体说明](engine-rs/data-wind-engine/assets/README.md)。

本次 Web Rust 渲染架构与完整验证过程见 [Web 端 Rust 画布渲染验证](docs/rust-web-rendering-verification.md)。
