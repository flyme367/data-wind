//! Browser surface for the Rust board renderer. Canvas2D is only a pixel transport for CPU frames.

use flatbuffers::FlatBufferBuilder;
use wasm_bindgen::prelude::*;

use crate::board::{BoardScene, Clock, Rasterizer};
use crate::common::EngineEvent;
use crate::protocol::{self, wire};

#[wasm_bindgen]
pub struct SoftwareCanvas {
    scene: crate::software::SoftwareScene,
}

#[wasm_bindgen]
impl SoftwareCanvas {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            scene: crate::software::SoftwareScene::default(),
        }
    }

    pub fn register_mesh(&mut self, id: &str, bytes: &[u8]) -> Result<(), JsValue> {
        self.scene.register_mesh(id, bytes).map_err(crate::map_err)
    }

    pub fn register_model_asset(&mut self, id: &str, bytes: &[u8]) -> Result<(), JsValue> {
        self.scene.register_model_asset(id, bytes).map_err(crate::map_err)
    }

    pub fn set_model_materials(&mut self, id: &str, settings: &str) -> Result<(), JsValue> {
        self.scene.set_model_materials(id, settings).map_err(crate::map_err)
    }

    pub fn set_model_texture(
        &mut self, id: u32, width: u32, height: u32, rgba: &[u8],
    ) -> Result<(), JsValue> {
        self.scene.set_model_texture(id, width, height, rgba).map_err(crate::map_err)
    }

    pub fn pick(&self, x: f32, y: f32) -> Option<String> {
        self.scene.pick(egui::pos2(x, y)).map(str::to_owned)
    }

    /// CommandRequest(SoftwareFrame)。
    pub fn frame(
        &mut self,
        width: u32,
        height: u32,
        bytes: &[u8],
        snapshot: bool,
    ) -> Result<Vec<u8>, JsValue> {
        validate_size(width, height)?;
        let input = protocol::decode_request(bytes)
            .map_err(crate::map_err)?
            .payload_as_software_frame()
            .map(crate::software::SoftwareInput::from_wire)
            .ok_or_else(|| JsValue::from_str("frame 收到错误命令类型"))?;
        Ok(pack(
            width,
            height,
            self.scene.render(width, height, &input, snapshot),
        ))
    }
}

#[wasm_bindgen]
pub struct BoardCanvas {
    scene: BoardScene,
    raster: Rasterizer,
    response_encoder: protocol::ResponseEncoder,
}

#[wasm_bindgen]
impl BoardCanvas {
    // canvas/gpu 参数保留（JS 契约不变）；GPU 合成迁移到 bevy 看板窗口前暂走 CPU 栅格化。
    pub async fn create(_canvas: web_sys::HtmlCanvasElement, _gpu: bool) -> Result<Self, JsValue> {
        console_error_panic_hook::set_once();
        let scene = BoardScene::default();
        scene
            .set_font(include_bytes!("../assets/NotoSansSC-Regular.otf").to_vec())
            .map_err(crate::map_err)?;
        Ok(Self {
            scene,
            raster: Rasterizer::default(),
            response_encoder: protocol::ResponseEncoder::default(),
        })
    }

    pub fn is_gpu(&self) -> bool {
        false
    }

    pub fn clear_image(&mut self, id: &str) {
        self.scene.clear_image(id);
    }

    pub fn set_status(&mut self, id: &str, message: &str) {
        self.scene.set_status(id, message);
    }
    pub fn focus_node(&mut self, id: Option<String>) {
        self.scene.focus_node(id.as_deref());
    }
    pub fn activate(&mut self, id: &str) {
        self.scene.activate(id);
    }

    /// 组件类型目录，StringList 缓冲。
    pub fn supported_kinds() -> Vec<u8> {
        let mut builder = FlatBufferBuilder::with_capacity(2048);
        let items: Vec<_> = crate::board::WIDGET_KINDS
            .iter()
            .map(|kind| builder.create_string(kind))
            .collect();
        let items = builder.create_vector(&items);
        let root = wire::StringList::create(&mut builder, &wire::StringListArgs {
            items: Some(items),
        });
        builder.finish(root, None);
        builder.finished_data().to_vec()
    }

    /// Readable embedded attribution, also distributed as assets/OFL.txt in the source tree.
    pub fn font_license() -> String {
        include_str!("../assets/OFL.txt").into()
    }

    /// CommandRequest(BoardSync)。
    pub fn sync_scene(&mut self, bytes: &[u8]) -> Result<(), JsValue> {
        let document = protocol::decode_request(bytes)
            .map_err(crate::map_err)?
            .payload_as_board_sync()
            .map(crate::board::BoardDocument::from_wire)
            .ok_or_else(|| JsValue::from_str("sync_scene 收到错误命令类型"))?;
        self.scene.sync(document).map_err(crate::map_err)
    }

    /// CommandRequest(GeoJsonDocument)。
    pub fn set_geojson(&mut self, bytes: &[u8]) -> Result<(), JsValue> {
        let payload = protocol::decode_request(bytes)
            .map_err(crate::map_err)?
            .payload_as_geo_json_document()
            .ok_or_else(|| JsValue::from_str("set_geojson 收到错误命令类型"))?;
        self.scene.set_geojson_wire(payload).map_err(crate::map_err)
    }

    pub fn set_image(
        &mut self,
        id: &str,
        width: u32,
        height: u32,
        rgba: &[u8],
    ) -> Result<(), JsValue> {
        self.scene
            .set_image(id, width as usize, height as usize, rgba)
            .map_err(crate::map_err)
    }

    /// 命中测试结果，HitResult 缓冲；空缓冲表示无命中。
    pub fn hit_test(&self, x: f32, y: f32) -> Result<Vec<u8>, JsValue> {
        let Some(hit) = self.scene.hit_test(egui::pos2(x, y)) else {
            return Ok(Vec::new());
        };
        let mut builder = FlatBufferBuilder::with_capacity(64);
        let id = builder.create_string(&hit.id);
        let handle = hit.handle.map(|handle| builder.create_string(handle));
        let root = wire::HitResult::create(&mut builder, &wire::HitResultArgs {
            id: Some(id),
            handle,
            control: hit.control,
        });
        builder.finish(root, None);
        Ok(builder.finished_data().to_vec())
    }

    pub fn pointer(&mut self, action: &str, x: f32, y: f32) {
        self.scene.pointer(action, egui::pos2(x, y));
    }

    /// CommandRequest(SetValue)。
    pub fn set_value(&mut self, bytes: &[u8]) -> Result<(), JsValue> {
        let payload = protocol::decode_request(bytes)
            .map_err(crate::map_err)?
            .payload_as_set_value()
            .ok_or_else(|| JsValue::from_str("set_value 收到错误命令类型"))?;
        let value = payload
            .value()
            .as_ref()
            .map(protocol::json_value_from_wire)
            .ok_or_else(|| JsValue::from_str("set_value 缺少取值"))?;
        self.scene.set_value(payload.id(), value);
        Ok(())
    }

    /// 排空交互事件，size-prefixed CommandResponse(DWCR) 缓冲；无事件返回零字节。
    pub fn take_events(&mut self) -> Result<Vec<u8>, JsValue> {
        let mut events: Vec<EngineEvent> = self
            .scene
            .take_events()
            .into_iter()
            .map(|event| EngineEvent::BoardEvent {
                id: event.id,
                kind: event.kind,
                action: event.action,
                value: event.value,
            })
            .collect();
        Ok(self.response_encoder.encode(&mut events))
    }

    /// CommandRequest(BoardClock)。GPU draws return an empty buffer. CPU draws return an 8-byte size header followed by RGBA.
    pub fn frame(&mut self, width: u32, height: u32, clock: &[u8]) -> Result<Vec<u8>, JsValue> {
        let clock = decode_clock(clock)?;
        let mut frame = self.scene.frame(&clock, width, height, true);
        Ok(pack(
            width,
            height,
            self.raster.render(&mut frame, width, height),
        ))
    }

    /// Capture retains live control values and media textures, and excludes editor selection handles.
    pub fn snapshot(
        &mut self,
        width: u32,
        height: u32,
        clock: &[u8],
    ) -> Result<Vec<u8>, JsValue> {
        validate_size(width, height)?;
        let clock = decode_clock(clock)?;
        let mut frame = self.scene.frame(&clock, width, height, false);
        Ok(pack(
            width,
            height,
            self.raster.render(&mut frame, width, height),
        ))
    }
}

fn decode_clock(bytes: &[u8]) -> Result<Clock, JsValue> {
    protocol::decode_request(bytes)
        .map_err(crate::map_err)?
        .payload_as_board_clock()
        .map(Clock::from_wire)
        .ok_or_else(|| JsValue::from_str("时钟收到错误命令类型"))
}

pub(crate) fn validate_size(width: u32, height: u32) -> Result<(), JsValue> {
    if width == 0 || height == 0 || u64::from(width) * u64::from(height) > 16_777_216 {
        Err(JsValue::from_str("看板渲染最多支持 1600 万像素"))
    } else {
        Ok(())
    }
}

pub(crate) fn pack(width: u32, height: u32, pixels: Vec<u8>) -> Vec<u8> {
    let mut result = Vec::with_capacity(pixels.len() + 8);
    result.extend_from_slice(&width.to_le_bytes());
    result.extend_from_slice(&height.to_le_bytes());
    result.extend(pixels);
    result
}
