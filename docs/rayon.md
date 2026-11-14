# Rayon CPU 并行

Rust 验证数字与 Chrome 实测记录的日期为 2026-11-02，早于 2026-11-04 的 Bevy 迁移；它们是迁移前基线，不能视为迁移后的重新验收结果。下方构建和模块说明已按当前三产物结构更新。

CPU 渲染 crate 使用 Rayon 1.12 并行处理软件栅格器的像素行，覆盖看板 PNG 导出、二维 CPU 画布和三维兼容渲染。Bevy 三维 GPU 引擎不依赖 Rayon，始终在主线程运行；GPU 对象不会传入 Rayon 任务。

每个任务拥有独立的 64 行 RGBA 切片，在切片内部按原有顺序绘制全部图元，再转换透明度。纹理更新在并行计算前应用，纹理释放在任务全部完成后处理。面积不足 65536 像素或只有一个工作线程时使用串行路径。

## 浏览器加载

`cpuClient.ts` 为看板 CPU 渲染和 CPU 三维兼容渲染加载模块：

1. 检查跨源隔离、SharedArrayBuffer、共享 Wasm 内存、Worker 和多核支持。
2. 满足条件时动态加载 `src/wasm/cpu-parallel/`，初始化 wasm-bindgen-rayon 线程池后才允许创建 CPU 渲染面。
3. 工作线程数量为 `min(8, max(2, hardwareConcurrency - 1))`。
4. 不满足条件或初始化失败时加载 `src/wasm/cpu/` 的单线程兼容版本。

三维 GPU 渲染由 `engineClient.ts` 加载 `src/wasm/data_wind_engine.js`，始终运行在主线程，不创建 Rayon 线程池。看板优先使用 Bevy Core2d / bevy_egui GPU 窗口，WebGPU 初始化失败时回退到 CPU 渲染模块。

生成后的 Worker 辅助脚本由 `scripts/rayon-worker-helpers.js` 提供：使用显式模块路径，同时处理 Worker 报错和 15 秒启动超时；失败后终止已创建的 Worker，允许宿主回退。构建脚本在每次生成绑定后复制该文件。

`cpu_threads()` 导出当前 CPU 渲染模块的 Rayon 工作线程数，兼容版本恒为 1，可用于诊断实际加载的 CPU 渲染器。

## 构建

Bevy 引擎使用仓库固定的 Rust 1.99.1。CPU 多线程 Wasm 还需要 nightly 和 `rust-src`：

```bash
rustup target add wasm32-unknown-unknown --toolchain 1.99.1
rustup toolchain install nightly --profile minimal --component rust-src --target wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.129 --locked
cd frontend
pnpm build:engine
```

`build:engine:single` 更新 Bevy 引擎和 CPU 单线程版本，`build:engine:parallel` 只更新 CPU 多线程版本。完整构建会生成三个产物。生成文件随项目保留，直接运行前端不需要先安装 nightly。

`scripts/build-engine.mjs` 为 CPU 多线程构建使用独立 Cargo 产物目录，启用 `parallel` feature、`atomics` / `bulk-memory`、共享与导入内存、TLS 导出，并通过 `-Z build-std=panic_abort,std` 重建支持线程的标准库；共享内存上限为 1 GiB。Bevy 引擎和 CPU 单线程构建使用稳定工具链与独立内存。

## 部署

浏览器多线程需要 HTTPS（本机允许 localhost）和以下响应头：

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Vite dev / preview 已配置。普通静态站点与导出的发布包无需配置也能使用单线程兼容版本。发布包递归收集两套引擎、Worker 代码及 Wasm，保持子目录部署的相对路径。

## 验证

```bash
cd engine-rs
cargo test -p native-probe --test raster_parallel
cargo test -p native-probe --tests
cargo fmt --all -- --check
cd ../frontend
pnpm test
pnpm test:rayon:workers
pnpm lint
pnpm build
pnpm test:board:wasm
```

原生像素测试使用独立的 1 线程和 4 线程池，逐字节比较包含半透明重叠、旋转、裁剪、纹理更新和不满 64 行尾带的画面。前端测试覆盖线程池只初始化一次、创建引擎前等待线程池、单线程回退和初始化失败后的重试。

2026-11-02 迁移前验证结果：

- Rust 原生测试 32 项、前端测试 134 项、Worker 启动 / 故障 / 超时测试 4 项全部通过；格式检查、前端 lint、TypeScript 与 Vite 生产构建通过。
- 原生 probe 和 Wasm 引擎各自适用目标的 Clippy 检查通过，保留项目已有的图形数值转换等警告。整个 workspace 的原生 Clippy 仍受既有 WebGPU Canvas / `web_gpu` 平台限制，不能作为原生引擎构建检查。
- 生产单线程 Wasm 的 79 类组件、中文字体、地图、输入、PNG 与三维兼容渲染检查通过。
- Chrome 中开发与生产构建均确认 Rayon 实际启动 4 个工作线程；没有跨源隔离以及 Worker 启动失败时均回退到单线程，失败的部分线程池已终止。
- 1024 × 769 的旋转半透明图元测试中，原版本、兼容版本和多线程版本的 RGBA 字节完全一致。一次本机测试的帧均耗时为单线程约 1157 ms、4 线程约 538 ms（约 2.1 倍），仅代表该场景与本机测试条件。
- 从生产界面实际导出的发布包包含 35 个文件、两套 Wasm 与 Worker；解压后在子目录中分别验证有 / 无跨源隔离的成品页，两种部署均无页面异常。

上游文档：[Rayon](https://docs.rs/rayon/1.12.0/rayon/)、[wasm-bindgen-rayon](https://docs.rs/wasm-bindgen-rayon/1.3.0/wasm_bindgen_rayon/)。
