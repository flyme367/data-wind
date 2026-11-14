# Bevy / bevy_egui 使用与优化验收

更新日期：2026-11-07。本文记录当前实现与本轮验证；早期迁移前截图和帧率不能作为本轮基线。

## 当前分工

| 模块 | 职责 |
| --- | --- |
| `engine-rs/data-wind-engine/src/app.rs` | 按需创建共享 Bevy App；winit 驱动帧循环；管理三维窗口、HUD 与 facade 状态句柄 |
| `engine-rs/data-wind-engine/src/gpu.rs` | 从主世界提取帧计划、上传增量数据；在 Core3d 调度中执行自定义场景 pass、blit 与预览读回 |
| `engine-rs/data-wind-engine/src/board.rs` | 第二个 Core2d 窗口；手动驱动看板 egui pass；复用静态输出 |
| `engine-rs/vendor/bevy_egui` | 本地 0.43.1 补丁，缓存稳定几何与图片 bind group |
| `engine-rs/data-wind-cpu` | 共享协议、看板布局、软件栅格化与导出；独立构建 CPU 单线程与 Rayon WASM |
| `engine-rs/oxgpu` | 飞线计算、视锥剔除与间接绘制相关 GPU 资源 |

Bevy 使用精简 feature / 插件集，提供窗口、输入、相机、资产和 RenderDevice / RenderQueue。
三维模型使用项目自己的实例与网格管线；三维 HUD 和二维看板分别使用 bevy_egui 上下文。
JS 的 `Engine.frame()` 保留为兼容空操作，渲染由 winit 驱动。

## 已完成的优化

- 模型按可见实例分组，场景和相机静止时复用 CPU 可见性与批次结果。
- 实例移动、选择与剔除球使用增量上传；存在完整待上传数据时合并修改。
- 相机矩阵、可见性版本与数量未变时跳过 GPU 剔除的参数上传、间接缓冲重置和 dispatch。
- 看板只在内容、交互、时间或尺寸变化时重新生成输出；静态帧复用 tessellation 结果。
- bevy_egui 在静态几何版本、像素比和视口一致时复用顶点 / 索引缓冲；纹理绑定按实际资源身份缓存。
- 无 OIT 相机时不创建 OIT resolve bind group。最后一个 OIT 相机移除后额外准备一次绑定，释放对旧大缓冲的引用。
- FPS 使用实际经过时间内的帧数计算；动画 dt 仍有独立上限，停顿不会被错误计成高帧率。

## facade 生命周期修复

浏览器退出时，winit 会清空 World。此前 facade 缓存 World 裸指针，迟到回调会在已清空的世界中读取 `EngineState` 并 panic；World 在 extract 中交换也使这种访问难以保证有效。

当前实现不保存 World 指针，也不泄漏 App：

1. 启动前由线程局部 `Option<App>` 持有 App，启动时把所有权交给 winit。
2. 窗口 / 相机创建与销毁进入队列，首次启动前和后续 `First` 调度中执行。
3. World 强持有 `Rc<RefCell<State>>`，facade 仅保存 Weak；系统通过 NonSend 访问状态，extract 显式带 `NonSendMarker`。
4. 状态忙时将写命令排队并保留顺序；读取返回空，不把事件排空操作延迟执行。
5. World 清空或销毁时关闭队列、丢弃待执行工作；迟到回调返回空或不执行。

看板替换时先使旧 facade 状态句柄失效，随后执行排队的创建和状态同步。
主线程约束可参阅 [Bevy NonSendMarker 文档](https://docs.rs/bevy/latest/bevy/ecs/system/struct.NonSendMarker.html)。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| `cargo test -p data-wind-engine --lib` | 15 项通过；原生 GPU 测试默认忽略并单独运行 |
| GPU 集成测试 `oit_bind_group_preparation_tracks_camera_lifecycle` | 通过；包含真实 RenderPlugin、CorePipeline、EguiPlugin 和 DwEnginePlugin，覆盖无 OIT、启用、移除、稳定空闲帧与 World 清空后的 facade 回调 |
| `pnpm test` | 40 个文件、198 项通过 |
| `pnpm build:engine:single` | 通过；更新引擎与 CPU 单线程 WASM / 绑定 |
| WASM 二进制验证 | 引擎 31,829,193 字节、CPU 12,990,956 字节；均通过 `WebAssembly.validate` |
| `pnpm build` | 类型检查和生产构建通过；保留现有依赖打包提示 |

原生生命周期测试还覆盖：启动 / 重入命令顺序、忙状态下读取不延迟执行、World 清空与销毁后的回调丢弃。

Chrome 使用生产构建、园区示例项目和两个 614 × 346 的实际渲染画布，预热后采样 6,006 ms：

| 计数 | 结果 |
| --- | ---: |
| 自定义场景 pass | 308 |
| OIT resolve bind group 创建 | 0 |
| 静态视锥剔除 dispatch | 0 |
| 飞线计算 pass | 308（场景包含动画） |
| egui 顶点 / 索引上传 | 各 321 次（包含每帧 HUD 与变动看板） |
| 采样结束时显示 FPS | 53 |
| 初始化与采样期间控制台错误 | 0 |

同一页从编辑器返回工作台后再次进入，双画布 ID 从 1 / 2 更新为 3 / 4，后端恢复 WebGPU，控制台无错误。
采样插桩页仅用于本地验证，验收后删除，不进入正式入口。

本轮较早的开发环境采样曾记录 247 次场景 pass 同时创建 247 次 OIT bind group。
这证明了无用工作的存在；两次采样的画布尺寸和前端状态不同，不能据此计算 FPS 提升比例。
上述计数也不等同于 GPU timestamp；当前没有宣称固定 FPS 或 GPU 执行时间降幅。

## 后续测量边界

持续动画仍会提交场景和 HUD 绘制。若要进一步改变渲染分辨率、合并 pass 或减少动画更新，需先在固定画布尺寸、同一场景和同一浏览器条件下测量 GPU 时间及交互延迟，再决定具体取舍。
本轮已修复的冗余工作与生命周期问题不依赖这类画质或刷新频率取舍。
