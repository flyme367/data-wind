# Web 端 Rust 画布渲染验证

本文中的逐项浏览器测试记录来自 2026-11-01，早于 2026-11-04 的 Bevy 迁移；它们记录的是迁移前基线，不代表当前渲染后端的重新验收结果。当前实现仍聚焦 Web，没有引入 eframe 或原生串口依赖。

## 当前 Bevy 渲染架构

- 全局 Bevy 0.20 App 使用 winit 驱动浏览器帧循环；每个三维视口挂在 Bevy 窗口和 Core3d 相机上。
- 自定义 WebGPU 场景 pass 注册在 Bevy RenderApp 的 Core3d 调度中，并使用 Bevy 提供的 RenderDevice / RenderQueue。现有实例缓冲、GPU 剔除、飞线和模型绘制沿用仓库的 WGSL 与 oxgpu。
- 三维 HUD 通过 bevy_egui 的主上下文绘制。看板使用第二个 Core2d 窗口，并由 bevy_egui 绘制 Rust 看板生成的 egui 输出。
- `data-wind-cpu` 独立提供 CPU 三维兼容渲染、看板栅格化和 PNG 输出；只有这个 crate 生成 Rayon 并行 Wasm 变体。
- 前端仍以 FlatBuffers 命令和响应驱动场景同步、拾取与变换事件；Bevy 迁移保留了既有 Engine facade。

以下“渲染边界”和验证结果仅描述上述日期的迁移前实现。

## 渲染边界

- `engine-rs/data-wind-engine/src/board/`：全部 73 种看板组件的排版、几何、中文字体、绘制、旋转命中、选择框、控件值和软件栅格化。
- `web_gpu.rs`：二维与三维共用 GPU Instance、Adapter、Device 和 Queue；并发初始化等待同一次设备创建。
- `board_canvas.rs`：透明 WebGPU surface、CPU 输出、保留运行时值的 PNG 快照。
- `software.rs`：三维兼容渲染、相机投影、模型三角形、标记、围栏、飞线和拾取。截图不替换实时拾取状态。
- `frontend/src/engine/boardCanvas.ts`：编辑器与成品页共用的输入 / 媒体解码宿主。浏览器只提供解码像素、原生 IME / 文件选择能力和像素显示。
- React / DOM / SVG 继续用于画布外的工作台、表单与素材卡片缩略图。发布页没有 React 看板组件，PNG 不再使用 html2canvas。

二维与三维使用各自的 surface，共享 GPU Device / Queue。PNG 与 GPU 路径共用 Rust 产生的 egui 网格。WebGPU 不可用时，二维和三维都由 Rust 输出 RGBA，Canvas2D 仅执行像素传输。

## 自动验证

| 检查 | 结果 |
| --- | --- |
| `pnpm lint` | 通过，无前端 lint 警告 |
| `pnpm test` | 27 个文件，124 项测试通过 |
| `pnpm build` | 类型检查与编辑器 / viewer 双入口构建通过 |
| `pnpm test:board:wasm` | 生产 WASM 验证全部 73 种组件、中文字体、地图、控件值、导出像素与三维 CPU 渲染 |
| `pnpm test:protocol:wasm` | FlatBuffers ABI、内存扩容后读取与资源释放验证通过 |
| `cargo test -p native-probe --tests` | 原有测试与新增看板 / 三维兼容测试通过；新增缩放密度回归后共 30 项 |
| `cargo fmt --all -- --check` | 通过 |
| `cargo build -p data-wind-engine --target wasm32-unknown-unknown --release` | 通过，已更新仓库中的 WASM 与绑定 |
| `cargo clippy -p data-wind-engine --target wasm32-unknown-unknown` | 完成，仍有数值转换、文档与代码长度等警告 |

构建仍会报告 Semi 的间接依赖（lottie / MDX）的打包提示；没有将其当作构建失败。

## 真实浏览器验证

使用独立 Chrome 测试上下文，数据与用户浏览器的本地项目隔离。

1. 编辑器二维后端为 `Rust/WebGPU`，三维后端为 `WebGPU`，无浏览器错误。
2. 记录到 2 次 `requestDevice`：一次临时 WebGPU 绘制读回探测、一次实际共享设备创建。二维与三维没有各自创建实际设备。
3. 画布中 `.board-widget` DOM 节点数为 0。
4. 组件拖拽、八方向缩放与撤销通过。
5. 预览下拉选择触发 `dw:control-change`，值为「华北区域」；中文 IME 输入「泵站 A 中文输入」保留在导出图中。
6. 完整看板 PNG 成功下载，三维背景与 Rust 组件均可见。
7. 独立 viewer 使用相同 Rust 渲染器，无 DOM 看板组件。
8. 禁用 `navigator.gpu` 后，二维与三维通过 Rust CPU 路径显示。
9. 浏览器解码图片后交给 Rust，快照采样像素与输入一致：`[239, 109, 85, 255]`。
10. Rust 复选框运行时切换通过；原生文件选择框返回文件名数组，Rust 显示文件名。资源加载 / 上传状态与控件值分别保存，状态消息不产生伪造的值变更。

## 截图

- [Rust 组件总览（73 种）](../artifacts/rust-board-components.webp)
- [WebGPU 编辑器](../artifacts/rust-board-web-editor.webp)
- [WebGPU 预览与中文输入](../artifacts/rust-board-web-preview.webp)
- [完整看板 PNG](../artifacts/rust-board-web-export.webp)
- [独立发布页](../artifacts/rust-board-web-viewer.webp)
- [无 WebGPU 的 Rust CPU 发布页](../artifacts/rust-board-web-cpu.webp)
- [Rust 三维软件渲染](../artifacts/rust-3d-software.webp)

## 当前限制

任意网页 DOM 无法直接绘入 Rust 的 WebGPU 纹理，iframe 组件显示网址入口卡片，点击后在新标签页打开。媒体来源需要允许跨域读取像素；视频 / 音频当前提供 Rust 绘制的播放 / 暂停按钮。中文使用内置 Noto Sans SC，系统 CSS 字体名称通过 egui 内置字体回退显示，不保证与操作系统字体相同。

Rust CPU 路径用于兼容与导出；密集三维网格和大尺寸组件的帧率仍受 CPU 栅格化开销影响。当前没有引入专门的离屏渲染 Worker 或宣称固定的高频遥测帧率。
