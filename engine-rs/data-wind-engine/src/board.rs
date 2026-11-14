//! 看板渲染的 Bevy 侧：第二窗口 + `run_manually` egui 上下文 + wasm facade。
//!
//! 时钟由 JS `frame(w, h, clock)` 每 tick 供给；渲染由 bevy rAF 驱动
//! （`BoardContextPass` 手动 begin/end pass，输入零注入，与 CPU 路径同构）。
//! PNG 导出（snapshot）沿用 CPU 栅格化（Rasterizer），保留活动控件值。

use crate::app;
use crate::board_cache::BoardPaintCache;
use crate::common;
use bevy::camera::RenderTarget;
use bevy::render::camera::CameraRenderGraph;
use bevy::core_pipeline::Core2d;
use bevy::prelude::*;
use bevy::window::{CompositeAlphaMode, Window, WindowRef};
use bevy_egui::{
    EguiContext, EguiContextSettings, EguiFullOutput, EguiInput, EguiPostUpdateSet,
    EguiRenderOutput, PrimaryEguiContext,
};
use data_wind_cpu::board::{BoardScene, Clock, Rasterizer};
use data_wind_cpu::protocol;
use std::cell::RefCell;
use std::rc::Rc;
use wasm_bindgen::prelude::*;

pub(crate) const DW_BOARD_CANVAS: &str = "dw-board-canvas";

/// 上下文附着前不能落纹理句柄的操作队列（set_image/clear_image）。
pub(crate) enum BoardOp {
    Image { id: String, width: u32, height: u32, rgba: Vec<u8> },
    ClearImage(String),
}

pub(crate) struct BoardState {
    pub id: usize,
    pub scene: BoardScene,
    pub raster: Rasterizer,
    pub encoder: protocol::ResponseEncoder,
    pub window: Entity,
    pub clock: Option<Clock>,
    pub attached: bool,
    pub ops: Vec<BoardOp>,
    /// 重绘门控：场景/交互/时钟秒变/窗口尺寸变化置位，paint 后清零。
    /// 非脏帧复用处理过的绘制网格；bevy_egui 仍会提交绘制。
    pub dirty: bool,
    pub last_second: u32,
    pub last_canvas: (f32, f32, f32),
    pub cache: BoardPaintCache,
}

pub(crate) type BoardStateHandle = Rc<RefCell<BoardState>>;

impl BoardState {
    fn apply_op(&mut self, op: BoardOp) -> Result<(), String> {
        match op {
            BoardOp::Image { id, width, height, rgba } => {
                self.scene.set_image(&id, width as usize, height as usize, &rgba)
            }
            BoardOp::ClearImage(id) => {
                self.scene.clear_image(&id);
                Ok(())
            }
        }
    }
}

#[derive(Component)]
pub(crate) struct BoardViewport(pub usize);

/// 用新画布替换看板窗口、相机和状态。
pub(crate) fn ensure_board(canvas: &web_sys::HtmlCanvasElement, id: usize) -> Result<(), String> {
    // 同步设置 id（此刻元素已在 DOM，winit 稍后按选择器收养）
    let canvas_id = format!("{DW_BOARD_CANVAS}-{id}");
    canvas.set_id(&canvas_id);
    let scene = BoardScene::default();
    scene.set_font(data_wind_cpu::board_font().to_vec())?;
    app::invalidate_board_state();
    app::with_world(move |world| {
        world.remove_non_send::<BoardStateHandle>();
        let entities: Vec<_> = world
            .query_filtered::<Entity, With<BoardViewport>>()
            .iter(world)
            .collect();
        for entity in entities {
            world.despawn(entity);
        }
        let window = world
            .spawn((
                Window {
                    title: "计蒙看板".into(),
                    canvas: Some(format!("#{canvas_id}")),
                    fit_canvas_to_parent: true,
                    // 画布必须透出 DOM 背景色（.board-page-color）：transparent=false +
                    // Auto 合成时表面按 Opaque 处理，透明 clear 会变成黑底挡住背景色。
                    // bevy_egui 用 PREMULTIPLIED_ALPHA_BLENDING 累加帧缓冲，故配 PreMultiplied。
                    transparent: true,
                    composite_alpha_mode: CompositeAlphaMode::PreMultiplied,
                    ..default()
                },
                BoardViewport(id),
            ))
            .id();
        // auto_create=false 时 bevy_egui 不会给新相机建上下文——手动挂 EguiContext
        // （其 #[require] 链自动带上 EguiInput/EguiFullOutput/EguiRenderOutput 等），
        // 再把 settings 覆盖为 run_manually（本系统自己驱动 begin/end pass）。
        world.spawn((
            Camera {
                clear_color: ClearColorConfig::Custom(Color::srgba(0.0, 0.0, 0.0, 0.0)),
                ..default()
            },
            // physical_viewport_rect 的计算需要 Projection；缺了 EguiCameraView 不生成 → egui 不渲染
            bevy::camera::Projection::Perspective(bevy::camera::PerspectiveProjection::default()),
            CameraRenderGraph::new(Core2d),
            RenderTarget::Window(WindowRef::Entity(window)),
            EguiContext::default(),
            EguiContextSettings {
                run_manually: true,
                enable_ime: false,
                ..default()
            },
            BoardViewport(id),
        ));
        app::set_board_state(world, BoardState {
            id,
            scene,
            raster: Rasterizer::default(),
            encoder: protocol::ResponseEncoder::default(),
            window,
            clock: None,
            attached: false,
            ops: Vec::new(),
            dirty: true,
            last_second: 0,
            last_canvas: (0.0, 0.0, 0.0),
            cache: BoardPaintCache::default(),
        });
    });
    Ok(())
}

/// 看板 pass：附着上下文 → 排空队列 → 手动驱动 pass → 写回 `EguiFullOutput`。
fn board_pass_system(
    mut contexts: Query<
        (&mut EguiContext, &mut EguiInput, &mut EguiFullOutput),
        Without<PrimaryEguiContext>,
    >,
    board: Option<NonSend<BoardStateHandle>>,
    windows: Query<&Window>,
) -> Result {
    let Some(board) = board else { return Ok(()); };
    let mut board = board.borrow_mut();
    board.cache.begin_frame();
    let Ok((mut ctx, mut input, mut full)) = contexts.single_mut() else {
        return Ok(()); // 看板窗口未创建（无看板页面）
    };
    // `process_output_system` consumes one output on every frame for every context,
    // including frames where the canvas has no usable size yet.
    **full = Some(egui::FullOutput::default());
    // run_manually：丢弃 bevy 注入的输入，与 CPU 路径一致（无 egui 自采 hover）。
    let _ = input.take();
    let canvas = windows
        .get(board.window)
        .ok()
        .map(|window| {
            (egui::vec2(window.width(), window.height()), window.scale_factor())
        })
        .filter(|(size, _)| size.x > 1.0 && size.y > 1.0);
    let Some((canvas, pixels_per_point)) = canvas else {
        return Ok(());
    };

    if !board.attached {
        // 首帧：把 bevy_egui 上下文交给 BoardScene（纹理句柄随之落到正确上下文），
        // 重挂字体并排空附着前积压的图片操作。
        board.scene.context = ctx.get_mut().clone();
        board.scene.set_font(data_wind_cpu::board_font().to_vec())?;
        for op in std::mem::take(&mut board.ops) {
            board.apply_op(op)?;
        }
        board.attached = true;
    }
    // 时钟由 JS frame() 每 tick 供给（dirty 门控下约每秒一次）；未收到前用默认值画首帧。
    let clock = board.clock.clone().unwrap_or_default();
    let second = (clock.now / 1000.0) as u32;
    if second != board.last_second {
        board.last_second = second;
        board.dirty = true; // 时钟/日历组件秒级刷新
    }
    if (canvas.x, canvas.y, pixels_per_point) != board.last_canvas {
        board.last_canvas = (canvas.x, canvas.y, pixels_per_point);
        board.dirty = true; // 窗口尺寸变化
    }
    // 首个静态帧建立网格缓存；之后复用结果，避免重复合批。
    if !board.dirty {
        if let Some(output) = board.cache.reuse() {
            **full = Some(output);
            return Ok(());
        }
    }
    let mut output = board.scene.run_pass_into(&clock, canvas, true);
    // The mesh uses logical window coordinates; egui maps them to physical pixels.
    output.pixels_per_point = pixels_per_point;
    board.cache.mark_fresh(&output);
    board.dirty = false;
    **full = Some(output);
    Ok(())
}

fn restore_board_paint_jobs(
    board: Option<NonSend<BoardStateHandle>>,
    mut contexts: Query<(&BoardViewport, &mut EguiRenderOutput)>,
) {
    let Some(board) = board else { return; };
    let mut board = board.borrow_mut();
    if let Some((_, mut output)) = contexts.iter_mut().find(|(viewport, _)| viewport.0 == board.id) {
        board.cache.finish_frame(&mut output);
    }
}

pub(crate) fn board_plugin(app: &mut App) {
    // run_manually 的上下文不被 bevy_egui 的 pass loop 驱动：本系统挂在 Update 手动跑 pass
    app.add_systems(Update, board_pass_system);
    app.add_systems(
        PostUpdate,
        restore_board_paint_jobs
            .after(EguiPostUpdateSet::ProcessOutput)
            .before(EguiPostUpdateSet::PostProcessOutput),
    );
}

/// 引擎侧看板 wasm facade：GPU 可用时 JS 装载本模块（CPU 回退用 data-wind-cpu 的同名类）。
#[wasm_bindgen]
pub struct BoardCanvas {
    id: usize,
}

impl Drop for BoardCanvas {
    fn drop(&mut self) {
        let id = self.id;
        app::with_world(move |world| {
            if world
                .get_non_send::<BoardStateHandle>()
                .is_some_and(|board| board.borrow().id == id)
            {
                world.remove_non_send::<BoardStateHandle>();
            }
            let entities: Vec<_> = world
                .query::<(Entity, &BoardViewport)>()
                .iter(world)
                .filter_map(|(entity, viewport)| (viewport.0 == id).then_some(entity))
                .collect();
            for entity in entities {
                world.despawn(entity);
            }
        });
    }
}

#[wasm_bindgen]
impl BoardCanvas {
    pub async fn create(canvas: web_sys::HtmlCanvasElement, _gpu: bool) -> Result<BoardCanvas, JsValue> {
        app::ensure_app().map_err(crate::map_err)?;
        let id = app::next_viewport_id();
        ensure_board(&canvas, id).map_err(crate::map_err)?;
        app::kick();
        Ok(BoardCanvas { id })
    }

    pub fn is_gpu(&self) -> bool {
        true
    }

    pub fn clear_image(&self, id: &str) {
        let id = id.to_owned();
        let _ = app::with_board(move |board| {
            board.dirty = true;
            if board.attached {
                board.scene.clear_image(&id);
            } else {
                board.ops.push(BoardOp::ClearImage(id));
            }
        });
    }

    pub fn set_status(&self, id: &str, message: &str) {
        let id = id.to_owned();
        let message = message.to_owned();
        let _ = app::with_board(move |board| {
            board.scene.set_status(&id, &message);
            board.dirty = true;
        });
    }

    pub fn focus_node(&self, id: Option<String>) {
        let _ = app::with_board(move |board| {
            board.scene.focus_node(id.as_deref());
            board.dirty = true;
        });
    }

    pub fn activate(&self, id: &str) {
        let id = id.to_owned();
        let _ = app::with_board(move |board| {
            board.scene.activate(&id);
            board.dirty = true;
        });
    }

    /// CommandRequest(BoardSync)。
    pub fn sync_scene(&self, bytes: &[u8]) -> Result<(), JsValue> {
        let bytes = bytes.to_vec();
        app::with_board(move |board| -> Result<(), JsValue> {
            let document = protocol::decode_request(&bytes)
                .map_err(crate::map_err)?
                .payload_as_board_sync()
                .map(data_wind_cpu::board::BoardDocument::from_wire)
                .ok_or_else(|| JsValue::from_str("sync_scene 收到错误命令类型"))?;
            board.scene.sync(document).map_err(crate::map_err)?;
            board.dirty = true;
            Ok(())
        })
        .unwrap_or(Ok(()))
    }

    /// CommandRequest(GeoJsonDocument)。
    pub fn set_geojson(&self, bytes: &[u8]) -> Result<(), JsValue> {
        let bytes = bytes.to_vec();
        app::with_board(move |board| -> Result<(), JsValue> {
            let payload = protocol::decode_request(&bytes)
                .map_err(crate::map_err)?
                .payload_as_geo_json_document()
                .ok_or_else(|| JsValue::from_str("set_geojson 收到错误命令类型"))?;
            board.scene.set_geojson_wire(payload).map_err(crate::map_err)?;
            board.dirty = true;
            Ok(())
        })
        .unwrap_or(Ok(()))
    }

    pub fn set_image(
        &self,
        id: &str,
        width: u32,
        height: u32,
        rgba: &[u8],
    ) -> Result<(), JsValue> {
        let id = id.to_owned();
        let rgba = rgba.to_vec();
        app::with_board(move |board| -> Result<(), JsValue> {
            let op = BoardOp::Image {
                id,
                width,
                height,
                rgba,
            };
            board.dirty = true;
            if board.attached {
                board.apply_op(op).map_err(crate::map_err)
            } else {
                board.ops.push(op);
                Ok(())
            }
        })
        .unwrap_or(Ok(()))
    }

    /// 命中测试结果，HitResult 缓冲；空缓冲表示无命中。
    pub fn hit_test(&self, x: f32, y: f32) -> Result<Vec<u8>, JsValue> {
        Ok(app::read_board(move |board| {
            data_wind_cpu::encode_hit_result(board.scene.hit_test(egui::pos2(x, y)))
        })
        .unwrap_or_default())
    }

    pub fn pointer(&self, action: &str, x: f32, y: f32) {
        let action = action.to_owned();
        let _ = app::with_board(move |board| {
            board.scene.pointer(&action, egui::pos2(x, y));
            board.dirty = true;
        });
    }

    /// CommandRequest(SetValue)。
    pub fn set_value(&self, bytes: &[u8]) -> Result<(), JsValue> {
        let bytes = bytes.to_vec();
        app::with_board(move |board| -> Result<(), JsValue> {
            let payload = protocol::decode_request(&bytes)
                .map_err(crate::map_err)?
                .payload_as_set_value()
                .ok_or_else(|| JsValue::from_str("set_value 收到错误命令类型"))?;
            let value = payload
                .value()
                .as_ref()
                .map(protocol::json_value_from_wire)
                .ok_or_else(|| JsValue::from_str("set_value 缺少取值"))?;
            board.scene.set_value(payload.id(), value);
            board.dirty = true;
            Ok(())
        })
        .unwrap_or(Ok(()))
    }

    /// 排空交互事件，size-prefixed CommandResponse(DWCR) 缓冲；无事件返回零字节。
    pub fn take_events(&self) -> Result<Vec<u8>, JsValue> {
        Ok(app::read_board(move |board| {
            let mut events: Vec<common::EngineEvent> = board
                .scene
                .take_events()
                .into_iter()
                .map(|event| common::EngineEvent::BoardEvent {
                    id: event.id,
                    kind: event.kind,
                    action: event.action,
                    value: event.value,
                })
                .collect();
            board.encoder.encode(&mut events)
        })
        .unwrap_or_default())
    }

    /// bevy 自驱渲染；本调用只更新 JS 供给的看板时钟，返回空缓冲（GPU 约定）。
    pub fn frame(&self, _width: u32, _height: u32, clock: &[u8]) -> Result<Vec<u8>, JsValue> {
        let clock = clock.to_vec();
        let _ = app::with_board(move |board| {
            board.clock = data_wind_cpu::decode_board_clock(&clock).ok();
            board.dirty = true;
        });
        Ok(Vec::new())
    }

    /// Capture retains live control values and media textures, and excludes editor selection handles.
    /// CPU 栅格化（PNG 导出）：不依赖 bevy 上下文。
    pub fn snapshot(
        &self,
        width: u32,
        height: u32,
        clock: &[u8],
    ) -> Result<Vec<u8>, JsValue> {
        if width == 0 || height == 0 || u64::from(width) * u64::from(height) > 16_777_216 {
            return Err(JsValue::from_str("看板渲染最多支持 1600 万像素"));
        }
        let clock = clock.to_vec();
        Ok(app::read_board(move |board| -> Vec<u8> {
            let Ok(clock) = data_wind_cpu::decode_board_clock(&clock) else {
                return Vec::new();
            };
            let mut frame = board.scene.frame(&clock, width, height, false);
            board.raster.update(&frame.textures);
            let pixels = board.raster.render(&mut frame, width, height);
            data_wind_cpu::pack_rgba(width, height, pixels)
        })
        .unwrap_or_default())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bevy::window::RequestRedraw;
    use bevy_egui::{
        EguiGlobalSettings, input::WindowToEguiContextMap, output::process_output_system,
    };

    #[test]
    fn board_output_tracks_window_pixel_ratio() {
        let mut app = App::new();
        app.add_systems(Update, board_pass_system);
        let window = app.world_mut().spawn(Window {
            resolution: bevy::window::WindowResolution::new(2000, 1000)
                .with_scale_factor_override(2.0),
            ..default()
        }).id();
        let mut scene = BoardScene::default();
        scene.sync(data_wind_cpu::board::BoardDocument {
            width: 1000.0,
            height: 500.0,
            ..Default::default()
        }).expect("valid board");
        app::set_board_state(app.world_mut(), BoardState {
            id: 1,
            scene,
            raster: Rasterizer::default(),
            encoder: protocol::ResponseEncoder::default(),
            window,
            clock: None,
            attached: true,
            ops: vec![],
            dirty: true,
            last_second: 0,
            last_canvas: (0.0, 0.0, 0.0),
            cache: BoardPaintCache::default(),
        });
        let context = app.world_mut().spawn((
            EguiContext::default(), EguiInput::default(), EguiFullOutput::default(),
        )).id();
        app.update();
        let output = app.world().get::<EguiFullOutput>(context).unwrap();
        assert_eq!(output.0.as_ref().unwrap().pixels_per_point, 2.0);
        app.world_mut().get_mut::<EguiFullOutput>(context).unwrap()
            .0.as_mut().unwrap().textures_delta.clear();

        let mut window = app.world_mut().get_mut::<Window>(window).unwrap();
        window.resolution.set_scale_factor_override(Some(1.0));
        window.resolution.set_physical_resolution(1000, 500);
        app.update();
        let output = app.world().get::<EguiFullOutput>(context).unwrap();
        assert_eq!(output.0.as_ref().unwrap().pixels_per_point, 1.0);
        app.world_mut().get_mut::<EguiFullOutput>(context).unwrap()
            .0.as_mut().unwrap().textures_delta.clear();
    }

    #[test]
    fn static_output_is_restored_after_bevy_egui_processes_it() {
        let mut app = App::new();
        app.add_message::<RequestRedraw>();
        app.init_resource::<EguiGlobalSettings>();
        app.init_resource::<WindowToEguiContextMap>();
        app.add_systems(
            PostUpdate,
            process_output_system.in_set(EguiPostUpdateSet::ProcessOutput),
        );
        app.add_systems(
            PostUpdate,
            restore_board_paint_jobs
                .after(EguiPostUpdateSet::ProcessOutput)
                .before(EguiPostUpdateSet::PostProcessOutput),
        );
        let window = app.world_mut().spawn_empty().id();
        let mut context = EguiContext::default();
        context.get_mut().begin_pass(egui::RawInput::default());
        let mut initial = context.get_mut().end_pass();
        initial.textures_delta.clear();
        let fresh = egui::FullOutput {
            pixels_per_point: 1.0,
            shapes: vec![egui::epaint::ClippedShape {
                clip_rect: egui::Rect::EVERYTHING,
                shape: egui::Shape::rect_filled(
                    egui::Rect::from_min_size(egui::Pos2::ZERO, egui::Vec2::splat(10.0)),
                    0.0,
                    egui::Color32::RED,
                ),
            }],
            ..Default::default()
        };
        let mut cache = BoardPaintCache::default();
        cache.mark_fresh(&fresh);
        app::set_board_state(app.world_mut(), BoardState {
            id: 1,
            scene: BoardScene::default(),
            raster: Rasterizer::default(),
            encoder: protocol::ResponseEncoder::default(),
            window,
            clock: None,
            attached: false,
            ops: vec![],
            dirty: false,
            last_second: 0,
            last_canvas: (0.0, 0.0, 0.0),
            cache,
        });
        let entity = app
            .world_mut()
            .spawn((BoardViewport(1), context, EguiFullOutput(Some(fresh))))
            .id();
        app.update();
        let expected = app
            .world()
            .get::<EguiRenderOutput>(entity)
            .expect("output")
            .paint_jobs
            .clone();
        assert!(!expected.is_empty());
        for _ in 0..2 {
            let output = {
                let state = app.world()
                    .get_non_send::<BoardStateHandle>()
                    .expect("board state");
                let mut state = state.borrow_mut();
                state.cache.begin_frame();
                state.cache.reuse().expect("cached output")
            };
            app.world_mut().get_mut::<EguiFullOutput>(entity).expect("output").0 = Some(output);
            app.update();
        }
        let actual = &app.world().get::<EguiRenderOutput>(entity).expect("output").paint_jobs;
        assert_eq!(actual.len(), expected.len());
        let (egui::epaint::Primitive::Mesh(actual), egui::epaint::Primitive::Mesh(expected)) =
            (&actual[0].primitive, &expected[0].primitive)
        else {
            panic!("expected meshes");
        };
        assert_eq!(actual.vertices, expected.vertices);
        assert_eq!(actual.indices, expected.indices);
    }
}
