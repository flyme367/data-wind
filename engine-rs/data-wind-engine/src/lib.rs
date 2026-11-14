//! # data-wind-engine
//!
//! 数字孪生 3D 渲染引擎（wasm32）：
//! - 渲染：Bevy 0.20（wgpu 30）+ bevy_egui 0.43（egui 0.36）——winit 接管 rAF 帧循环
//! - 计算：oxgpu（compute shader：飞线粒子 + 视锥剔除 + draw indirect）
//! - 场景 pass：自定义 Core3d 系统，离屏 sRGB 纹理 + blit + 读回预览
//! - 看板/软渲/CPU 栅格化在 `data-wind-cpu`（独立 wasm 产物，支持 atomics + rayon）
//!
//! JS 侧驱动：`Engine.create(canvas)` 建 App；命令仍走 FlatBuffers 方法调用，
//! 事件经 `take_response()` 返回。`frame(t)` 保留为兼容空操作（渲染由 bevy 自驱）。

mod app;
mod board;
mod board_cache;
mod cull_cache;
mod gpu;
mod hud;
mod model_batches;
mod preview;
mod scene;
mod state;
mod terrain_gpu;
mod water_gpu;
mod terrain_physics;
mod visibility;
mod world_access;

// CPU 渲染底座（看板/软渲/协议/相机/网格数据类型）下沉在 data-wind-cpu；
// 路径别名让既有 `crate::common` 等引用原样工作。
pub(crate) use data_wind_cpu::{camera, common, mesh, protocol, terrain, water};

use bevy::log::{
    BoxedLayer,
    tracing::{self, Subscriber},
    tracing_subscriber::{self, Layer},
};
use wasm_bindgen::prelude::*;

/// Captures error-level tracing and `log` records for the engine response queue.
struct PendingErrorLayer;

thread_local! {
    static PENDING_LOGS: std::cell::RefCell<Vec<String>> = const { std::cell::RefCell::new(Vec::new()) };
}

impl<S: Subscriber> Layer<S> for PendingErrorLayer {
    fn on_event(
        &self,
        event: &tracing::Event<'_>,
        _ctx: tracing_subscriber::layer::Context<'_, S>,
    ) {
        if event.metadata().level() != &tracing::Level::ERROR {
            return;
        }
        let mut message = None;
        event.record(&mut PendingErrorVisitor(&mut message));
        let msg = message.unwrap_or_else(|| {
            format!(
                "{} ({})",
                event.metadata().name(),
                event.metadata().target()
            )
        });
        PENDING_LOGS.with(|p| {
            let mut q = p.borrow_mut();
            if q.len() < 32 {
                q.push(msg);
            }
        });
    }
}

struct PendingErrorVisitor<'a>(&'a mut Option<String>);

impl tracing::field::Visit for PendingErrorVisitor<'_> {
    fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn std::fmt::Debug) {
        if field.name() == "message" {
            *self.0 = Some(format!("{value:?}"));
        }
    }
}

pub(crate) fn pending_error_layer(_app: &mut bevy::prelude::App) -> Option<BoxedLayer> {
    Some(Box::new(PendingErrorLayer))
}

pub(crate) fn drain_pending_logs(events: &mut Vec<common::EngineEvent>) {
    PENDING_LOGS.with(|p| {
        for msg in p.borrow_mut().drain(..) {
            events.push(common::EngineEvent::Error { message: msg });
        }
    });
}

fn map_err<E: std::fmt::Display>(e: E) -> JsValue {
    JsValue::from_str(&e.to_string())
}

#[wasm_bindgen]
pub struct Engine {
    id: usize,
}

impl Drop for Engine {
    fn drop(&mut self) {
        app::release_viewport(self.id);
    }
}

#[wasm_bindgen]
impl Engine {
    pub async fn create(canvas: web_sys::HtmlCanvasElement) -> Result<Engine, JsValue> {
        console_error_panic_hook::set_once();
        app::ensure_app().map_err(map_err)?;
        let id = app::next_viewport_id();
        app::ensure_viewport(&canvas, id);
        app::kick();
        Ok(Engine { id })
    }

    /// bevy 自驱渲染；保留空实现以兼容 JS 调用点。
    pub fn frame(&self, _time_ms: f64) {}

    // ---- CommandRequest 方法（全部委托主世界 EngineState） ----

    /// CommandRequest(SetMode)
    pub fn set_mode(&mut self, bytes: &[u8]) {
        let bytes = bytes.to_vec();
        let _ = app::with_state(move |state| state.set_mode(&bytes));
    }

    pub fn set_spin(&mut self, spin: bool) {
        app::with_state(move |state| state.set_spin(spin));
    }

    /// Register a prepared model once; instances reference its stable catalog identifier.
    pub fn register_mesh(&mut self, id: &str, bytes: &[u8]) -> Result<(), JsValue> {
        let id = id.to_owned();
        let bytes = bytes.to_vec();
        app::with_state(move |state| state.register_mesh(&id, &bytes))
            .unwrap_or(Ok(()))
            .map_err(map_err)
    }

    /// 同步场景（CommandRequest(SceneUpdate)）。
    pub fn sync_scene(&mut self, bytes: &[u8]) {
        let bytes = bytes.to_vec();
        let _ = app::with_state(move |state| state.sync_scene(&bytes));
    }

    pub fn set_selection(&mut self, id: Option<String>) {
        app::with_state(move |state| state.set_selection(id));
    }

    pub fn resize(&mut self, width: f64, height: f64, dpr: f64) {
        app::with_state(move |state| state.resize(width, height, dpr));
    }

    /// Change only the offscreen scene target, leaving the visible surface alone.
    /// Passing (0, 0) restores the ordinary surface-sized target.
    pub fn set_capture_size(&mut self, width: u32, height: u32) -> Result<(), JsValue> {
        app::with_state(move |state| state.set_capture_size(width, height))
            .unwrap_or(Ok(()))
            .map_err(map_err)
    }

    /// Project a screen coordinate onto a horizontal plane in world space.
    pub fn position_on_plane(&self, x: f64, y: f64, height: f32) -> Vec<f32> {
        app::read_state(move |state| state.position_on_plane(x, y, height)).unwrap_or_default()
    }

    pub fn pointer_down(&mut self, x: f64, y: f64, button: u32, editable: bool) {
        app::with_state(move |state| state.pointer_down(x, y, button, editable));
    }

    pub fn pointer_up(&mut self, x: f64, y: f64, button: u32) {
        app::with_state(move |state| state.pointer_up(x, y, button));
    }

    pub fn pointer_move(&mut self, x: f64, y: f64) {
        app::with_state(move |state| state.pointer_move(x, y));
    }

    pub fn wheel(&mut self, dy: f64) {
        app::with_state(move |state| state.wheel(dy));
    }

    /// CommandRequest(SetHud)：布尔字段总是显式写入，整体替换状态。
    pub fn set_hud(&mut self, bytes: &[u8]) {
        let bytes = bytes.to_vec();
        let _ = app::with_state(move |state| state.set_hud(&bytes));
    }

    /// Set a saved orbit view without recreating the GPU resources.
    pub fn camera_view(&mut self, x: f32, y: f32, z: f32, yaw: f32, pitch: f32, dist: f32) {
        app::with_state(move |state| state.camera_view(x, y, z, yaw, pitch, dist));
    }

    pub fn camera_state(&self) -> Vec<f32> {
        app::read_state(move |state| state.camera_state()).unwrap_or_default()
    }

    /// World to CSS pixels for the editing handles.
    pub fn screen_position(&self, x: f32, y: f32, z: f32) -> Vec<f32> {
        app::read_state(move |state| state.screen_position(x, y, z)).unwrap_or_default()
    }

    /// CommandRequest(SetEnvironment)；daylight/fogDistance 以 0 表示缺省。
    pub fn set_environment(&mut self, bytes: &[u8]) {
        let bytes = bytes.to_vec();
        let _ = app::with_state(move |state| state.set_environment(&bytes));
    }

    pub fn set_lighting(&mut self, x: f32, y: f32, z: f32, r: f32, g: f32, b: f32, intensity: f32) {
        app::with_state(move |state| state.set_lighting(x, y, z, r, g, b, intensity));
    }

    /// CommandRequest(SetSelections)。
    pub fn set_selections(&mut self, bytes: &[u8]) {
        let bytes = bytes.to_vec();
        let _ = app::with_state(move |state| state.set_selections(&bytes));
    }

    pub fn reset_camera(&mut self) {
        app::with_state(move |state| state.reset_camera());
    }

    /// 开启/关闭读回预览（rAF 被节流的环境使用）
    pub fn set_preview(&mut self, on: bool) {
        app::with_state(move |state| state.set_preview(on));
    }

    /// 取回最近一帧预览像素（RGBA8，紧凑行，alpha 强制 255）；无新帧返回空
    pub fn take_preview(&mut self) -> Vec<u8> {
        app::read_state(move |state| state.take_preview()).unwrap_or_default()
    }

    /// 返回宽、高的小端 u32 与紧凑 RGBA 像素，避免窗口改变尺寸后误读旧帧。
    pub fn take_preview_frame(&mut self) -> Vec<u8> {
        app::read_state(move |state| state.take_preview_frame()).unwrap_or_default()
    }

    pub fn take_preview_error(&mut self) -> Option<String> {
        app::read_state(move |state| state.take_preview_error()).flatten()
    }

    /// Drain an owned, size-prefixed CommandResponse (DWCR v1); no events return zero bytes.
    pub fn take_response(&mut self) -> Vec<u8> {
        app::read_state(move |state| state.take_response()).unwrap_or_default()
    }
}
