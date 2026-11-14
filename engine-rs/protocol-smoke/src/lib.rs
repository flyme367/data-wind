//! Exercise the real engine encoder/decoder and Wasm return ABI without creating a GPU device.

#[allow(dead_code)]
#[path = "../../data-wind-cpu/src/common.rs"]
mod common;
#[path = "../../data-wind-cpu/src/protocol.rs"]
mod protocol;
#[path = "../../probe/tests/support/response_events.rs"]
mod response_events;

use wasm_bindgen::prelude::*;

/// Test harness with the same owned byte return type as `Engine::take_response`.
#[wasm_bindgen]
#[derive(Default)]
pub struct ProtocolHarness {
    encoder: protocol::ResponseEncoder,
    events: Vec<common::EngineEvent>,
}

#[wasm_bindgen]
impl ProtocolHarness {
    #[wasm_bindgen(constructor)]
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    pub fn queue_sample(&mut self) {
        self.events.extend(response_events::sample_events());
    }

    pub fn queue_board_sample(&mut self) {
        self.events.extend(response_events::sample_board_events());
    }

    pub fn take_response(&mut self) -> Vec<u8> {
        self.encoder.encode(&mut self.events)
    }

    /// Decode a frontend SceneUpdate buffer and report the instance count (0 on rejection).
    #[must_use]
    pub fn decode_scene_update_count(&self, bytes: &[u8]) -> u32 {
        protocol::decode_request(bytes)
            .ok()
            .and_then(|request| request.payload_as_scene_update())
            .map_or(0, |payload| {
                payload.instances().len() as u32
            })
    }

    /// Decode a frontend SetHud buffer as "grid/flylines/stats" (empty on rejection).
    #[must_use]
    pub fn decode_set_hud(&self, bytes: &[u8]) -> String {
        protocol::decode_request(bytes)
            .ok()
            .and_then(|request| request.payload_as_set_hud())
            .map_or_else(String::new, |payload| {
                format!("{}/{}/{}", payload.grid(), payload.flylines(), payload.stats())
            })
    }
}
