# 主渲染器迁移 Bevy + bevy_egui：版本归一 → 渲染层重写

## 背景

Cargo.lock 现存双版本：**wgpu 29.0.4（←bevy-demo 的 bevy 0.19.1）+ 30.0.1（←主引擎）**、**egui 0.36.2（←bevy_egui 0.42）+ 0.37.0（←主引擎）**。用户拍板：移除手写 wgpu+egui 渲染层，改用 Bevy + bevy_egui 最新版作主渲染器，workspace 归一到单一 wgpu、单一 egui（2026-11-03"替换 bevy-demo"旧任务作废）。

已核实的版本锚点（crates.io API，2026-11-04）：
- **bevy 0.20.1**（2026-10-28）→ bevy_render 0.20.1 锁 **wgpu ^30** —— 与主引擎同行，oxgpu 的 wgpu 30 代码不用动
- **bevy_egui 0.43.1**（2026-10-10，要求 Rust 1.95）→ 锁 **bevy ^0.20 + egui ^0.36**（硬依赖 bevy_winit+winit）
- **egui-wgpu 0.36** 锁 wgpu ^30.0；**egui_plot 0.37.0** 锁 egui ^0.36

终态版本矩阵：bevy 0.20.1 / bevy_egui 0.43.1 / egui 0.36.x（全 workspace 唯一）/ egui-wgpu 0.36.x / egui_plot 0.37 / wgpu 30.0.1（唯一）。

**关键推论**：egui 必须统一到 0.36（bevy_egui 的锁），即主引擎看板/HUD/软渲代码 0.37→0.36 降级适配——这一步无论如何都绕不开（bevy_egui 一进依赖树 0.36 就进锁），是阶段 2 的硬前置。egui-wgpu 0.36 同锁 wgpu 30，阶段 1 不会制造第二份 wgpu。

## 阶段 1：版本归一（硬前置，先行落地，JS 零改动）

### 1. bevy-demo 升级（消灭 wgpu 29 的唯一来源）
- `engine-rs/bevy-demo/Cargo.toml`：bevy 0.19→**0.20.1**、bevy_egui 0.42→**0.43.1**
- `src/main.rs`（121 行）按官方迁移指南适配（bevy 0.20 把 render 拆出 bevy_extract/bevy_ui_render 等子 crate，feature 名/插件 API 可能有变；bevy_egui 0.42→0.43 看其 CHANGELOG）：
  - https://github.com/bevyengine/bevy/tree/main/release-content （0.19→0.20 迁移指南）
  - https://github.com/vladbat00/bevy_egui （README/CHANGELOG）
- 验证 `pnpm build:bevy-demo` 出 wasm 正常

### 2. 主引擎 egui 0.37→0.36 降级适配
- `engine-rs/Cargo.toml` workspace deps：egui 0.37→0.36（保留 default_fonts）、egui-wgpu 0.37→0.36、egui_plot 0.38→0.37；wgpu 保持 "30" 不动
- 已知 API 逆向点（以 https://docs.rs/egui/0.36 为准逐点核对）：
  - `render.rs` run_egui（L648-758）：`Context::run_pass` → 0.36 的 `Context::run`
  - `board/mod.rs`（L499-501）：0.37 的 `RawInput.viewports + native_pixels_per_point` 视口字段在 0.36 不存在，回退为直接 screen_rect 传入
  - `board/mod.rs` 的 `Ui::new(ctx, id, UiBuilder)` 五参签名 → 0.36 的 `ctx.new_ui(UiBuilder, …)`
  - 其余触点（board/charts.rs 手拼 Mesh、controls.rs ComboBox::from_id_salt / color_picker::show_color_at、widgets.rs epaint::Shadow / StrokeKind / LayoutJob、maps.rs、raster.rs、hud.rs egui_plot、software.rs）大体 0.36 兼容，逐文件 cargo check 修
  - egui-wgpu 0.36 Renderer：`Renderer::new(device, format, RendererOptions)` + update_buffers/render 流程不变（Engine GPU 路径与 BoardGpu 共用此改法）
- 不改任何 wasm-bindgen 导出签名、协议、JS 代码

### 3. 阶段 1 验证
- `cargo check --workspace`（注意 dev-env：`export PATH="$HOME/.cargo/bin:$PATH"`；rsproxy 若未同步 bevy 0.20.1 就对该版本直接走 crates.io）
- 断言 Cargo.lock：`egui` 恰好一个（0.36.x）、`wgpu` 恰好一个（30.0.1）、无 29 残留
- `pnpm build:engine` 重建 wasm → 按 [[dw-visual-verify-workflow]] headless Chrome + CDP 实测：3D 编辑器（HUD/网格/飞线/选中）、看板 GPU 路径、`dw_disable_webgpu=1` CPU 路径、viewer、PNG 导出、登录页 ring
- `pnpm test`（vitest 全量）

## 阶段 2：GPU 渲染层迁移 Bevy（主重写，阶段 1 验证通过后开）

### 架构决策
- **全局单例 Bevy App**（MinimalPlugins + WinitPlugin + RenderPlugin + bevy_egui），winit 接管 rAF 帧循环（bevy_egui 0.43 硬依赖 winit，无法 headless 绕开）。App 由首个 wasm 类（Engine/BoardCanvas）惰性创建，wasm 单线程无重入
- **主窗口** = 3D 视口画布（Window.canvas 挂 DOM selector），**看板画布争取第二窗口**；web 多窗口受限（https://github.com/bevyengine/bevy/issues/12562）时的 fallback：看板 egui 走 bevy_egui render-to-image 纹理 + 复用 blit.wgsl 思路小型节点贴到看板 canvas surface（同为 bevy device，跨 surface 不可直拷但可渲染），版本目标不受影响
- **场景 11 管线 + oxgpu 原样包进一个自定义 render graph 节点**：在 bevy RenderDevice 的原始 device（`wgpu_device()`）上建资源，oxgpu（514 行 wgpu compute）零改写地接 bevy 的 device/queue，raw wgpu 录制（含 draw_indirect、preview readback 的 map_buffer_on_submit）——管线代码与现 do_frame 1:1 平移
- **HUD**：hud.rs 挂到 bevy_egui 主窗口 context；**看板 3444 行 egui 画布代码**（board/）在 bevy_egui context 下继续用 egui::Painter 绘制，逻辑不变
- **wasm facade 与 FlatBuffers 协议全保留**（Engine/BoardCanvas/SoftwareCanvas 方法签名、CommandRequest/DWCR、commands.ts 唯一编码入口）；JS 驱动调整：Viewport.tsx 渲染环瘦身（bevy 自驱渲染，JS 保留 take_response 轮询 + 相机补间下发）；软渲 worker 路径（SoftwareCanvas，纯 CPU 无 wgpu）完全不动
- **收尾**：主引擎 Bevy 化完成后删除 bevy-demo 及 4 处构建链（workspace members、build-bevy-demo.mjs、package.json 脚本、README 章节）——旧任务回收

### 风险与对策
- bevy wasm 构建 × parallel 变体（atomics/build-std nightly 链）：build-engine.mjs 需带 bevy 重验，风险中；不行则 parallel 变体仅软渲路径继续走旧构建
- rsproxy 滞后 bevy 0.20.1 → 单版本可临时直连 crates.io
- bevy 0.20 wasm feature 命名变化 → 以迁移指南为准
- WebGPU 劣化/兼容面与现引擎同风险，验证流程不变

## 实施顺序（本次批准后先做阶段 1）
1. bevy-demo 升 0.20.1/0.43.1 → build 验证
2. 主引擎 egui 三件套降级 + 全 workspace cargo check
3. lock 断言 + wasm 重建 + 浏览器全路径视觉验证 + vitest
4. 阶段 1 汇报后开阶段 2（另起任务清单）