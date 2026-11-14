//! # data-wind-cpu
//!
//! 数字孪生 CPU 渲染：三维软渲（egui Shape + 栅格化）与看板渲染器（egui 即时模式画布 + CPU 栅格化）。
//! 刻意不依赖 bevy / wgpu —— 作为独立 wasm 产物在渲染 Worker（atomics + rayon 线程池）与
//! 主线程软渲回退中运行；也是 Bevy 主引擎（data-wind-engine）的看板/软渲逻辑底座。
//!
//! JS 契约：`SoftwareCanvas.frame` 只收 FlatBuffers（`CommandRequest(SoftwareFrame)`），
//! `BoardCanvas.frame/snapshot` CPU 路径返回 8 字节宽高头 + 紧凑 RGBA。

mod software;
pub mod board;
#[cfg(all(target_arch = "wasm32", feature = "wasm"))]
mod board_canvas;
pub mod camera;
pub mod common;
pub mod mesh;
pub mod picking;
pub mod protocol;
pub mod terrain;
pub mod water;

#[cfg(all(target_arch = "wasm32", feature = "wasm"))]
pub use board_canvas::{BoardCanvas, SoftwareCanvas};
pub use common::{EngineEvent, FlatInstanceIn, FrameParams, GInstance, HudState, Mode};

#[cfg(all(target_arch = "wasm32", feature = "parallel"))]
pub use wasm_bindgen_rayon::init_thread_pool;

use wasm_bindgen::prelude::*;

/// Number of workers available to CPU rendering (one in the portable Wasm build).
#[cfg(all(target_arch = "wasm32", feature = "wasm"))]
#[wasm_bindgen]
pub fn cpu_threads() -> usize {
    #[cfg(any(not(target_arch = "wasm32"), feature = "parallel"))]
    return rayon::current_num_threads();

    #[cfg(all(target_arch = "wasm32", not(feature = "parallel")))]
    1
}

pub fn map_err<E: std::fmt::Display>(e: E) -> JsValue {
    JsValue::from_str(&e.to_string())
}

/// 看板内嵌字体（NotoSansSC，OFL 许可，见 `board_font_license`）。
pub fn board_font() -> &'static [u8] {
    include_bytes!("../assets/NotoSansSC-Regular.otf")
}

/// Readable embedded attribution, also distributed as assets/OFL.txt in the source tree.
pub fn board_font_license() -> &'static str {
    include_str!("../assets/OFL.txt")
}

/// CommandRequest(BoardClock) 解码（bevy 侧看板 pass 的时钟由 JS 持续供给）。
pub fn decode_board_clock(bytes: &[u8]) -> Result<board::Clock, String> {
    protocol::decode_request(bytes)
        .map_err(|e| e.to_string())?
        .payload_as_board_clock()
        .map(board::Clock::from_wire)
        .ok_or_else(|| "时钟收到错误命令类型".to_owned())
}

/// 命中测试结果编码为 HitResult FlatBuffers；空缓冲表示无命中。
pub fn encode_hit_result(hit: Option<board::Hit>) -> Vec<u8> {
    let Some(hit) = hit else {
        return Vec::new();
    };
    let mut builder = flatbuffers::FlatBufferBuilder::with_capacity(64);
    let id = builder.create_string(&hit.id);
    let handle = hit.handle.as_deref().map(|handle| builder.create_string(handle));
    let root = protocol::wire::HitResult::create(&mut builder, &protocol::wire::HitResultArgs {
        id: Some(id),
        handle,
        control: hit.control,
    });
    builder.finish(root, None);
    builder.finished_data().to_vec()
}

/// 8 字节小端宽高头 + 紧凑 RGBA（CPU 帧传输格式）。
pub fn pack_rgba(width: u32, height: u32, pixels: Vec<u8>) -> Vec<u8> {
    let mut result = Vec::with_capacity(pixels.len() + 8);
    result.extend_from_slice(&width.to_le_bytes());
    result.extend_from_slice(&height.to_le_bytes());
    result.extend(pixels);
    result
}
