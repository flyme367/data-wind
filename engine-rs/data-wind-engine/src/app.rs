//! 全局 Bevy App 单例：winit 接管 rAF 帧循环（wasm 走 spawn_app 立即返回），
//! Engine / BoardCanvas 共享同一渲染世界，结构变更通过帧内队列执行。
//!
//! App 以**无主窗口**模式构建：3D 视口与看板各自按需 spawn Window + 相机
//! （顺序无关，页面可只有其一）。

use crate::board::{BoardState, BoardStateHandle, board_plugin};
use crate::gpu::DwGpuPlugin;
use crate::state::{self, EngineState};
use crate::world_access::WorldAccess;
use crate::{common::Mode, hud};
use bevy::camera::RenderTarget;
use bevy::core_pipeline::CorePipelinePlugin;
use bevy::prelude::*;
use bevy::render::RenderPlugin;
use bevy::render::camera::CameraRenderGraph;
use bevy::render::settings::{RenderCreation, WgpuSettings};
use bevy::time::Real;
use bevy::window::{ExitCondition, Window, WindowPlugin, WindowRef};
use bevy::winit::WinitPlugin;
use bevy_egui::{
    EguiContexts, EguiGlobalSettings, EguiPlugin, EguiPrimaryContextPass, PrimaryEguiContext,
};
use std::cell::RefCell;
use std::rc::{Rc, Weak};

/// 主视口画布的 DOM id（Engine::create 时由 Rust 侧设置，供 winit 按选择器收养）。
pub(crate) const DW_VIEWPORT_CANVAS: &str = "dw-viewport-canvas";

thread_local! {
    static APP: RefCell<Option<App>> = const { RefCell::new(None) };
    static WORLD_ACCESS: Rc<WorldAccess> = Rc::new(WorldAccess::default());
    static ENGINE_STATE: RefCell<Weak<RefCell<EngineState>>> = const { RefCell::new(Weak::new()) };
    static BOARD_STATE: RefCell<Weak<RefCell<BoardState>>> = const { RefCell::new(Weak::new()) };
}

// The World owns the strong handle; facade callbacks only retain a Weak handle.
// NonSend systems keep access on the browser thread, including during extraction.
pub(crate) type EngineStateHandle = Rc<RefCell<EngineState>>;

#[derive(Component)]
pub(crate) struct DwViewport(pub usize);

pub(crate) fn next_viewport_id() -> usize {
    static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(1);
    NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
}

/// 惰性创建全局 App（不启动帧循环；由 [`kick`] 在实体就位后启动）。
pub fn ensure_app() -> Result<(), String> {
    if WORLD_ACCESS.with(|access| access.closed()) {
        return Err("Bevy 渲染应用已关闭，请重新加载页面".into());
    }
    if WORLD_ACCESS.with(|access| access.initialized()) {
        return Ok(());
    }

    let mut app = App::new();
    // bevy/winit 内部日志经 LogPlugin → fmt 层直达 console；无它则窗口创建失败也静默
    app.insert_resource(EguiGlobalSettings {
        auto_create_primary_context: false,
        ..default()
    });
    app.add_plugins(bevy::log::LogPlugin {
        custom_layer: crate::pending_error_layer,
        ..default()
    })
    .add_plugins(MinimalPlugins)
    // bevy_winit 的 create_windows 读 AccessibilityRequested（A11yPlugin 提供）
    .add_plugins(bevy::a11y::AccessibilityPlugin::default())
    // bevy_egui 的纹理链路要 AssetServer/Assets<Image>；最小插件集需显式补装
    .add_plugins(bevy::asset::AssetPlugin::default())
    .add_plugins(bevy::image::ImagePlugin::default())
    .add_plugins(bevy::mesh::MeshPlugin::default())
    .add_plugins(bevy::camera::CameraPlugin::default())
    // bevy_egui 的输入系统读这些消息；缺注册 = Reader 校验 Err = Panic severity
    .add_plugins(bevy::input::InputPlugin::default())
    // 相机 Frustum/GlobalTransform 传播需要；缺了相机永远不被提取
    .add_plugins(bevy::transform::TransformPlugin::default())
    .add_plugins(RenderPlugin {
        render_creation: RenderCreation::Automatic(Box::new(WgpuSettings {
            power_preference: bevy::render::settings::PowerPreference::HighPerformance,
            ..Default::default()
        })),
        ..default()
    })
    .add_plugins(CorePipelinePlugin)
    .add_plugins(WindowPlugin {
        primary_window: None,
        exit_condition: ExitCondition::DontExit,
        ..default()
    })
    .add_plugins(WinitPlugin::default())
    .add_plugins(EguiPlugin::default())
    .add_plugins(DwEnginePlugin);

    APP.with(|slot| *slot.borrow_mut() = Some(app));
    Ok(())
}

/// 启动帧循环（幂等）。必须在窗口/相机实体就位之后调用：
/// bevy_egui 的 primary context 在 Startup（InitContexts）创建，晚于 run 的相机赶不上。
pub(crate) fn kick() {
    if let Some(mut app) = APP.with(|slot| slot.borrow_mut().take()) {
        // Startup must see the initial windows and primary egui context.
        apply_pending_world_operations(app.world_mut());
        // wasm：winit spawn_app 立即返回；实际 App 的所有权交给 runner。
        app.run();
    }
}

/// 用新画布替换 3D 视口窗口和相机。
pub fn ensure_viewport(canvas: &web_sys::HtmlCanvasElement, id: usize) {
    let canvas_id = format!("{DW_VIEWPORT_CANVAS}-{id}");
    canvas.set_id(&canvas_id);
    with_world(move |world| {
        let entities: Vec<_> = world
            .query_filtered::<Entity, With<DwViewport>>()
            .iter(world)
            .collect();
        for entity in entities {
            world.despawn(entity);
        }
        // 相机组件全家桶（缺一不可）：
        // - Transform/Visibility：GlobalTransform 传播 + Frustum/VisibleEntities 前置
        // - Projection：update_frusta 需要
        // - RenderTarget 组件：0.20 相机 target 是组件，缺了不被提取
        // - PrimaryEguiContext：bevy_egui 主上下文（HUD）
        let camera_bundle = (
            bevy::transform::components::Transform::default(),
            bevy::camera::visibility::Visibility::default(),
            Camera {
                clear_color: bevy::camera::ClearColorConfig::None,
                ..default()
            },
            bevy::camera::Projection::Perspective(bevy::camera::PerspectiveProjection::default()),
            CameraRenderGraph::new(bevy::core_pipeline::Core3d),
            // auto_create=false：主 egui 上下文需手动挂（require 链自动带输入/输出组件）
            bevy_egui::EguiContext::default(),
            bevy_egui::EguiContextSettings {
                enable_ime: false,
                ..default()
            },
            PrimaryEguiContext,
            DwViewport(id),
        );
        let window = world
            .spawn((
                Window {
                    title: "计蒙可视化".into(),
                    canvas: Some(format!("#{canvas_id}")),
                    fit_canvas_to_parent: true,
                    ..default()
                },
                DwViewport(id),
            ))
            .id();
        world.spawn((
            camera_bundle,
            RenderTarget::Window(WindowRef::Entity(window)),
        ));
    });
}

pub(crate) fn release_viewport(id: usize) {
    with_world(move |world| {
        let entities: Vec<_> = world
            .query::<(Entity, &DwViewport)>()
            .iter(world)
            .filter_map(|(entity, viewport)| (viewport.0 == id).then_some(entity))
            .collect();
        for entity in entities {
            world.despawn(entity);
        }
    });
}

pub(crate) fn with_world(f: impl FnOnce(&mut World) + 'static) {
    WORLD_ACCESS.with(|access| access.enqueue(f));
}

pub(crate) fn with_state<R>(f: impl FnOnce(&mut EngineState) -> R + Send + 'static) -> Option<R> {
    if WORLD_ACCESS.with(|access| access.closed()) {
        return None;
    }
    if !WORLD_ACCESS.with(|access| access.has_pending())
        && let Some(state) = ENGINE_STATE.with(|state| state.borrow().upgrade())
        && let Ok(mut state) = state.try_borrow_mut()
    {
        return Some(f(&mut state));
    }
    with_world(move |world| {
        if let Some(state) = world.get_non_send::<EngineStateHandle>() {
            f(&mut state.borrow_mut());
        }
    });
    None
}

pub(crate) fn read_state<R>(f: impl FnOnce(&mut EngineState) -> R) -> Option<R> {
    if WORLD_ACCESS.with(|access| access.closed()) {
        return None;
    }
    let state = ENGINE_STATE.with(|state| state.borrow().upgrade())?;
    let mut state = state.try_borrow_mut().ok()?;
    Some(f(&mut state))
}

pub(crate) fn with_board<R>(f: impl FnOnce(&mut BoardState) -> R + Send + 'static) -> Option<R> {
    if WORLD_ACCESS.with(|access| access.closed()) {
        return None;
    }
    if !WORLD_ACCESS.with(|access| access.has_pending())
        && let Some(board) = BOARD_STATE.with(|board| board.borrow().upgrade())
        && let Ok(mut board) = board.try_borrow_mut()
    {
        return Some(f(&mut board));
    }
    with_world(move |world| {
        if let Some(board) = world.get_non_send::<BoardStateHandle>() {
            f(&mut board.borrow_mut());
        }
    });
    None
}

pub(crate) fn read_board<R>(f: impl FnOnce(&mut BoardState) -> R) -> Option<R> {
    if WORLD_ACCESS.with(|access| access.closed()) {
        return None;
    }
    let board = BOARD_STATE.with(|board| board.borrow().upgrade())?;
    let mut board = board.try_borrow_mut().ok()?;
    Some(f(&mut board))
}

pub(crate) fn set_board_state(world: &mut World, board: BoardState) {
    let board = Rc::new(RefCell::new(board));
    BOARD_STATE.with(|slot| *slot.borrow_mut() = Rc::downgrade(&board));
    world.insert_non_send::<BoardStateHandle>(board);
}

pub(crate) fn invalidate_board_state() {
    BOARD_STATE.with(|slot| *slot.borrow_mut() = Weak::new());
}

pub(crate) struct DwEnginePlugin;

fn apply_pending_world_operations(world: &mut World) {
    if let Some(access) = WorldAccess::from_world(world) {
        access.flush(world);
    }
}

impl Plugin for DwEnginePlugin {
    fn build(&self, app: &mut App) {
        let access = WORLD_ACCESS.with(Rc::clone);
        access.attach(app.world_mut());
        let state = Rc::new(RefCell::new(EngineState::default()));
        ENGINE_STATE.with(|slot| *slot.borrow_mut() = Rc::downgrade(&state));
        app.world_mut().insert_non_send::<EngineStateHandle>(state);
        app.add_systems(bevy::app::First, apply_pending_world_operations)
            .add_systems(Update, engine_prepare_system)
            .add_systems(EguiPrimaryContextPass, hud_pass_system);
        app.add_plugins(DwGpuPlugin);
        app.add_plugins(crate::terrain_physics::TerrainPhysicsPlugin);
        board_plugin(app);
    }
}

/// 每帧 CPU 预计算（时间、相机、拾取、帧计划）。
fn engine_prepare_system(
    time: Res<Time>,
    real_time: Res<Time<Real>>,
    state: NonSend<EngineStateHandle>,
    viewports: Query<(), (With<DwViewport>, With<Camera>)>,
) {
    if viewports.is_empty() {
        return;
    }
    let mut state = state.borrow_mut();
    let dt = time.delta_secs().clamp(0.0, 0.1);
    state.prepare_frame(dt, real_time.delta_secs());
}

/// HUD（egui Window / egui_plot）画进 bevy_egui 主上下文（3D 视口相机）。
fn hud_pass_system(
    mut contexts: EguiContexts,
    state: NonSend<EngineStateHandle>,
    viewports: Query<(), (With<DwViewport>, With<Camera>)>,
) -> Result {
    if viewports.is_empty() {
        return Ok(());
    }
    let mut state = state.borrow_mut();
    let ctx = contexts.ctx_mut()?.clone();
    let stats = state.hud_stats();
    let view_m = state.camera.view();
    let mut actions = hud::HudActions::default();
    let s = &mut *state;
    hud::build_ui(
        &ctx,
        s.hud,
        &view_m,
        stats,
        &s.frame_times,
        &mut s.events,
        &mut actions,
    );
    if actions.grid.is_some() || actions.flylines.is_some() || actions.stats.is_some() {
        if let Some(g) = actions.grid {
            s.hud.grid = g;
        }
        if let Some(f) = actions.flylines {
            s.hud.flylines = f;
        }
        if let Some(v) = actions.stats {
            s.hud.stats = v;
        }
        s.push_hud_event();
    }
    if actions.reset_view {
        s.camera = state::camera_default(Mode::Editor);
    }
    s.egui_wants_pointer = ctx.egui_wants_pointer_input();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn facade_preserves_queued_writes_and_rejects_callbacks_after_shutdown() {
        let mut world = World::new();
        WORLD_ACCESS.with(|access| access.attach(&mut world));
        let state = Rc::new(RefCell::new(EngineState::default()));
        ENGINE_STATE.with(|slot| *slot.borrow_mut() = Rc::downgrade(&state));
        world.insert_non_send::<EngineStateHandle>(state.clone());

        // A synchronous callback while Bevy borrows the state must wait for First.
        let borrowed = state.borrow_mut();
        assert!(with_state(|state| state.time = 1.0).is_none());
        assert!(read_state(|_| panic!("busy reads must not run later")).is_none());
        drop(borrowed);
        assert!(with_state(|state| state.time *= 2.0).is_none());
        apply_pending_world_operations(&mut world);
        assert_eq!(read_state(|state| state.time), Some(2.0));

        with_world(|_| panic!("shutdown discards queued operations"));
        world.clear_all();
        // Keep a strong handle here to also test the explicit closed guard.
        assert!(read_state(|_| panic!("closed state is inaccessible")).is_none());
        assert!(with_state(|_| panic!("closed state rejects writes")).is_none());
        with_world(|_| panic!("closed World rejects structural changes"));
        WORLD_ACCESS.with(|access| access.flush(&mut world));
    }
}
