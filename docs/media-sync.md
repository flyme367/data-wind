# 媒体类看板组件同步

2026-11-06，对齐山海鲸「媒体」分类的全部 7 个组件（图片 / 视频 / 监控 / 轮播图 / 轮播视频 / 基础PDF / 音频），并把每个组件右侧属性面板的配置项按官方帮助文档 1:1 复刻。此前仅实现 4 个组件的简化版配置（`轮播视频 / 监控 / 基础PDF` 因"需专有播放能力"未纳入），本次补齐组件并引入浏览器端流媒体 / PDF 解码能力。

## 同步来源（山海鲸官方帮助文档）

| 组件 | 官方文档 |
| --- | --- |
| 图片 | https://www.shanhaibi.com/docs/v1/qr4pw8ev8dfiv2cm/ |
| 视频 | https://www.shanhaibi.com/docs/v1/xg5c5qfyml34i6gs/ |
| 监控 | https://www.shanhaibi.com/docs/v1/gszgs6gh9xgy4187/ |
| 轮播图 | https://www.shanhaibi.com/docs/v1/gvt52t2uvrlygsei/ |
| 轮播视频 | https://www.shanhaibi.com/docs/v1/kh69770sxfnvbbyv/ |
| 基础PDF | https://www.shanhaibi.com/docs/v1/sggqmtw1iso2uafv/ |
| 音频 | https://www.shanhaibi.com/docs/v1/pg77p7xw0etescd6/ |

素材面板目录顺序对齐山海鲸「媒体」分类：图片 → 视频 → 监控 → 轮播图 → 轮播视频 → 基础PDF → 音频（chips 仍为 全部 / 默认媒体）。

## 组件清单与配置项

媒体配置项全部存 `node.data`（JsonValue 全链路透传，零协议改动）；`undefined` 一律按山海鲸默认值兜底。仅一个协议改动：`BoardAction` 枚举尾部追加 `Page`（value `-1`/`1`，轮播图切换按钮与基础PDF 翻页共用）。

| 组件 | WidgetKind | 默认尺寸 | 山海鲸分区 → 配置项（data 键） |
| --- | --- | --- | --- |
| 图片 | `image`（沿用） | 300×? | 图片设置：图片地址（`widget.image`）、填充方式 `objectFit`（拉伸填充\|居中，默认拉伸填充）、外框跟随图片尺寸 `frameFollowsImage`（仅居中时）。展示设置：播放动画 `playAnimation`、动画类型 `animType`（顺时针旋转\|逆时针旋转\|闪烁）、缓动方式 `easing`（10 项）、动画延迟时长 `animDelay`(1s)、单个动画持续时长 `animDuration`(1s)、循环播放 `animLoop`、循环间隔 `animInterval`(0s) |
| 视频 | `video`（沿用） | 480×270 | 播放设置：媒体地址 `src`、自动播放 `autoplay`(开)、循环播放 `loop`(开)、循环开始时间 `loopStart`(0s)、播放速度 `playbackRate`(2.0x\|1.5x\|1.0x\|0.5x)、静音 `muted`(开)、隐藏控制条 `hideControls`、播放方式 `playMode`（暂停继续\|从头播放）、黑色背景透明 `transparentBlack`（webm alpha） |
| 监控 | `monitor`（新增） | 480×270 | 监控设置：监控地址 `src`、协议类型 `protocol`（HLS\|RTSP\|RTMP\|FLV，默认 HLS）、RTSP 底层传输协议 `rtspTransport`（TCP\|UDP\|UDP_MULTICAST\|HTTP，默认 TCP）、支持 H265 `h265`、显示控制条 `showControls`(开)、隐藏后销毁等待时间 `destroyDelay`(10s)、静音 `muted`(开) |
| 轮播图 | `carousel`（沿用） | 480×270 | 轮播图设置：图片地址列表 `urls`、填充方式 `objectFit`（拉伸\|居中\|平铺）、显示风格 `displayStyle`（无\|卡片）、切换方向 `direction`（水平\|竖直）。切换按钮：位置 `buttonPosition`（内部\|外部）、按钮尺寸 `buttonSize`(30)、按钮颜色 `buttonColor`、按钮圆角 `buttonRadius`(0)、切换箭头 `arrows`（常显示\|移入显示\|不显示）。展示设置：播放动画 `playAnimation`(开)、动画类型 `animType`（平移\|翻转）、循环播放 `animLoop`(开)、单个轮播后停留时长 `interval`(3s，原默认 5s 按文档改为 3s) |
| 轮播视频 | `carouselVideo`（新增） | 480×270 | 视频地址列表 `urls`（按顺序自动循环）＋播放设置同视频（无黑色背景透明） |
| 基础PDF | `pdf`（新增） | 480×360 | PDF 设置：文件地址 `src`、加载时颜色 `loadingColor`、按钮大小 `buttonSize`(28)、按钮字号 `buttonFontSize`(13)、按钮字体颜色 `buttonFontColor`、点击切换下一页 `clickNext` |
| 音频 | `audio`（沿用） | 360×72 | 播放设置：音频地址 `src`、自动播放 `autoplay`(关)、开始时间 `startTime`(0s)、音量 `volume`(1–100)、循环播放 `loop`(开)、播放速度 `playbackRate`、隐藏控制条 `hideControls`、播放方式 `playMode`、黑色背景透明 `transparentBlack` |

说明：山海鲸把「视频/音频地址」「黑色背景透明」放在组件的「基本设置」分组，本项目公共「基础设置」分区已有同名分区，故并入各组件的「播放设置」分区承载，字段一一对应。

## 主要实现

- `frontend/src/data/editor.ts`：`WidgetKind` 新增 `monitor / carouselVideo / pdf`；`widgetLabels`、`controlPresets` 预设（默认值对齐山海鲸）；媒体下拉项常量（`mediaImageFitOptions`、`mediaCarouselFitOptions`、`mediaPlaybackRates`、`mediaPlayModes`、`monitorProtocols`、`monitorRtspTransports`、`mediaEasings`、`mediaImageAnimTypes`、`mediaCarouselAnimTypes`）；`mediaWidgetKinds` 白名单。
- `frontend/src/data/mediaCatalog.ts`：7 条目按山海鲸顺序。
- `frontend/src/components/BoardComponents.tsx`：`MediaThumb` 图标（lucide：Image/Video/Cctv/Images/ListVideo/FileText/Music）。
- `frontend/src/components/WidgetProperties.tsx`：媒体组件不走「组件内容」分区，改为山海鲸分组名「图片设置 / 展示设置 / 播放设置 / 监控设置 / 轮播图设置 / 切换按钮 / PDF 设置」；字段读写走 `patchData`（JSON 去重 + undo）。
- `frontend/src/engine/boardCanvas.ts`（解码管线核心）：
  - 监控：HLS 经 `hls.js`（Safari 原生 HLS 直连）、FLV 经 `mpegts.js`（HTTP-FLV 直播）、RTSP/RTMP 显示明确提示；`隐藏后销毁等待时间`：`loaded=false` 后台保活计时，超时销毁纹理与播放器，重新开启自动重建。
  - 轮播图：状态机（index / lastSwitch / playedOnce）替换原 `Date.now()/interval` 取帧；预览态按停留时长推进，「切换按钮」点击经 `BoardAction::Page` 步进；「平移 / 翻转」过渡在 TS 画布逐帧合成后整体 `set_image`（600ms，easeInOut）。
  - 图片展示动画：延迟 → 缓动旋转 / 闪烁 → 循环间隔，TS 画布逐帧合成；`外框跟随图片尺寸` 加载完成后一次性 resize（仅编辑态）。
  - 轮播视频：多 `<video>` 队列按顺序循环，`ended` 切换下一个，仅活动视频上传帧。
  - 基础PDF：`pdfjs-dist` 按需加载（worker 经 Vite `?url`），页面位图 → `set_image`；页码经 `setValue({page, pages})` 回传 Rust 显示。
  - 播放设置每秒同步：倍速 / 循环 / 静音 / 音量 / 开始时间即改即生效；循环开始时间在重启后落位；播放方式「从头播放」恢复播放时回到循环开始时间。
  - 自动播放：预览态起播（监控恒为自动），被浏览器策略拦截时提示。
- `protocol/command_response.fbs`：`BoardAction` 尾部追加 `Page`；`pnpm generate:protocol` 重新生成（Rust 产物目标已修正为 `data-wind-cpu/src/generated`——Bevy 迁移后协议下沉在 cpu crate，engine 侧死副本已删除）。
- `engine-rs/data-wind-cpu/src/board/mod.rs`：`WIDGET_KINDS` +3；`is_control()` +`monitor/carouselVideo/pdf/carousel`；预览命中区对「外部」切换按钮扩边（`media_hit_rect`）。
- `engine-rs/data-wind-cpu/src/board/widgets.rs`：媒体分支重构——填充方式（stretch / contain / tile，tile 为 Mesh 平铺多 quad）、监控与轮播视频复用纹理绘制、控制条受「隐藏控制条 / 显示控制条」控制、PDF 加载色 + 翻页按钮（◀ 页码 ▶）、轮播图切换按钮（内部/外部、尺寸、颜色、圆角、箭头可见性）。
- `engine-rs/data-wind-cpu/src/board/controls.rs`：`BoardAction::Media` 扩展到 monitor/carouselVideo；新增 `Page` 映射（按钮区域命中 → value ±1；pdf `clickNext` 时整体点击 = 下一页）。
- `frontend/src/components/TopMenuBar.tsx`：项目素材检查覆盖 monitor/carouselVideo/pdf 的地址与轮播列表。
- `frontend/src/components/MetadataPanel.tsx`：动态数据字段绑定补 `src`（监控/PDF）与 `urls`（轮播视频）。

新增依赖：`hls.js`（HLS）、`mpegts.js`（HTTP-FLV）、`pdfjs-dist`（PDF 解码），均按需动态加载，不进主包。

## 验证

- `pnpm exec tsc`、`pnpm exec oxlint src`（0 errors）、`pnpm exec vitest run`（媒体相关全绿：`mediaCatalog.test.ts` 7 组件目录与预设断言、`boardScene.test.ts` 前后端 kind 全量对照、`editor.test.ts`）。
- `cargo test -p native-probe --test board`（12 通过，新增：填充方式像素断言、监控/视频控制条开关、PDF 加载色 + 翻页按钮事件、轮播图切换按钮事件与「不显示/外部」边界）。
- `pnpm build:engine` 重建三个 wasm 产物。
- headless Chrome（WebGPU 路径）+ CDP 全流程实测：素材面板 7 卡片顺序与图标（artifacts/media-sync-palette.webp）、监控设置/播放设置/PDF 设置面板（media-sync-panel-monitor.webp、media-sync-editor-pdf.webp）、图片/轮播图纹理渲染与切换按钮（media-sync-preview-carousel.webp）、轮播点击切到第二张（media-sync-carousel-page2.webp）、PDF 翻页按钮 → 第二页 + 页码「2 / 2」（media-sync-pdf-page2.webp）；全程控制台零报错。

## 已知边界

- 浏览器无法播放 RTSP / RTMP：四协议下拉与 RTSP 底层传输协议、支持 H265 配置项齐全，但仅 HLS / FLV 实播；RTSP/RTMP 与 H265 由桌面播放器专有解码（山海鲸默认监控端口 26666 等桌面能力同样不适用）。
- 切换箭头「移入显示」按「常显示」处理（Rust 画布无鼠标悬停轨迹）。
- 图片「缓动方式」10 项按通用缓动族命名实现（线性/缓入/缓出/缓入缓出/回弹×3/弹性×3），名称待山海鲸实机核对。
- 图片展示动画与轮播过渡在 TS 侧逐帧合成上传（Rust 绘制静态纹理），导出 PNG 取当前帧；「黑色背景透明」依赖 webm alpha 通道，解码链路天然保留 alpha。
- 非静音自动播放受浏览器策略拦截时提示点击播放；监控「显示控制条」为常驻控制条（山海鲸为点击浮现，含全屏等原生能力）。
- PDF「加载时颜色」仅在解码期间显示；多页 PDF 显示页码指示，单页不显示。
- 媒体地址需允许跨域像素读取（现有约束不变），否则提示「媒体来源不允许读取像素」。
