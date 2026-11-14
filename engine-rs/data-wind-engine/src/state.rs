//! 主世界引擎状态：全部 CPU 侧逻辑（协议解码、相机、拾取、拖拽、事件队列）。
//! GPU 资源在渲染世界（`gpu.rs`），两界通过 `DwFramePlan` / extract 队列交接。

use crate::camera::Camera;
use crate::common::{EngineEvent, FrameParams, GInstance, HudState, Marker, Mode};
use crate::model_batches::ModelBatches;
use crate::protocol;
use crate::{camera, common, hud, mesh, preview, protocol::wire, scene, visibility};
use std::collections::HashSet;
use std::sync::{Arc, Mutex};

pub(crate) const MAX_BOXES: u32 = 1024;
pub(crate) const MAX_MARKERS: u32 = 128;
pub(crate) const MAX_FENCES: u32 = 32;
pub(crate) const MAX_RINGS: u32 = 4;

#[derive(Copy, Clone, PartialEq)]
enum DragKind {
    Orbit,
    Pan,
    Move,
}

struct MoveTarget {
    id: String,
    start_position: glam::Vec3,
    position: glam::Vec3,
    offset: glam::Vec3,
}

struct DragState {
    kind: DragKind,
    last: egui::Pos2,
    start: egui::Pos2,
    moved: bool,
    target: Option<MoveTarget>,
}

/// 单帧 CPU 预计算结果：extract 拷入渲染世界供场景 pass 消费。
pub(crate) struct DwFramePlan {
    pub params: FrameParams,
    /// 视锥剔除平面（与 visibility.update 同源）。
    pub planes: [[f32; 4]; 6],
    /// CPU 可见性重算时递增，用于使 GPU 视锥缓存失效。
    pub visibility_revision: u64,
    pub mode: Mode,
    pub grid: bool,
    pub need_flyline: bool,
    pub need_cull: bool,
    pub dt: f32,
    pub box_count: u32,
    pub marker_count: u32,
    pub fence_count: u32,
    pub ring_count: u32,
    pub model_batches: Arc<ModelBatches>,
}

/// 上传队列：extract 时从 EngineState 搬到渲染世界。
#[derive(Default)]
pub(crate) struct DwUploads {
    pub meshes: Vec<(String, mesh::CpuMesh)>,
    pub instances: Option<Vec<GInstance>>,
    pub instance_updates: Vec<(usize, GInstance)>,
    pub markers: Option<Vec<Marker>>,
    pub fences: Option<Vec<common::Fence>>,
    pub rings: Option<Vec<common::Ring>>,
    pub arcs: Option<Vec<oxgpu::Arc>>,
    pub cull_spheres: Option<Vec<oxgpu::BoundingSphere>>,
    pub sphere_updates: Vec<oxgpu::BoundingSphere>,
    pub terrains: Option<Vec<scene::TerrainDraw>>,
    pub waters: Option<Vec<scene::WaterDraw>>,
}

/// 主世界拥有的引擎状态，通过非 Send 句柄供系统与 facade 访问。
pub(crate) struct EngineState {
    pub mode: Mode,
    pub spin: bool,
    pub camera: Camera,
    pub hud: HudState,
    pub background: [f32; 4],
    pub ground_color: [f32; 4],
    pub daylight: f32,
    pub fog_distance: f32,
    pub light_direction: [f32; 4],
    pub light_color: [f32; 4],
    pub selected: u32,
    pub backend_name: String,
    pub egui_wants_pointer: bool,

    pub time: f32,
    pub fps: f32,
    stats_elapsed: f32,
    stats_frames: u32,
    /// 最近帧耗时（ms），供 HUD egui_plot 曲线使用。
    pub frame_times: std::collections::VecDeque<f32>,

    pub events: Vec<EngineEvent>,
    pub response_encoder: protocol::ResponseEncoder,
    drag: Option<DragState>,
    pick_request: Option<(f64, f64)>,

    pub logical_size: (f64, f64),
    /// 截图覆盖尺寸（None = 跟随窗口）。
    pub capture_size: Option<(u32, u32)>,
    pub no_surface: bool,
    pub preview_state: Arc<Mutex<preview::PreviewState>>,

    pub meshes: std::collections::HashMap<String, mesh::CpuMesh>,
    mesh_draws: Arc<[(String, u32)]>,
    pub instances_cpu: Vec<GInstance>,
    pub cull_spheres_cpu: Vec<oxgpu::BoundingSphere>,
    visibility: visibility::SceneVisibility,
    visibility_dirty: bool,
    visibility_vp: Option<[[f32; 4]; 4]>,
    visibility_revision: u64,
    model_batches: Arc<ModelBatches>,
    pick_boxes: Vec<scene::PickBox>,
    pick_markers: Vec<scene::PickMarker>,
    pub(crate) terrains: Vec<scene::TerrainDraw>,
    pub(crate) waters: Vec<scene::WaterDraw>,
    pub box_count: u32,
    pub marker_count: u32,
    pub fence_count: u32,
    pub ring_count: u32,

    pub uploads: DwUploads,
    /// 最近一帧的 CPU 预计算结果（渲染世界 extract 取走）。
    pub plan: Option<DwFramePlan>,
    /// 已上传的飞线弧线数（stats 统计用，与 FlylineSim.active_arcs 对齐）。
    pub active_arcs: u32,
}

impl Default for EngineState {
    fn default() -> Self {
        Self {
            mode: Mode::Editor,
            spin: false,
            camera: camera_default(Mode::Editor),
            hud: HudState::default(),
            background: [0.105, 0.115, 0.15, 1.0],
            ground_color: [0.105, 0.115, 0.15, 1.0],
            daylight: 1.0,
            fog_distance: 240.0,
            light_direction: [0.45, 0.85, 0.35, 1.0],
            light_color: [1.0, 1.0, 1.0, 1.0],
            selected: 0,
            backend_name: "GPU".to_string(),
            egui_wants_pointer: false,
            time: 0.0,
            fps: 0.0,
            stats_elapsed: 0.0,
            stats_frames: 0,
            frame_times: std::collections::VecDeque::with_capacity(121),
            events: Vec::new(),
            response_encoder: protocol::ResponseEncoder::default(),
            drag: None,
            pick_request: None,
            logical_size: (1.0, 1.0),
            capture_size: None,
            no_surface: false,
            preview_state: Arc::new(Mutex::new(preview::PreviewState::default())),
            meshes: std::collections::HashMap::new(),
            mesh_draws: Arc::from([]),
            instances_cpu: Vec::new(),
            cull_spheres_cpu: Vec::new(),
            visibility: visibility::SceneVisibility::default(),
            visibility_dirty: true,
            visibility_vp: None,
            visibility_revision: 0,
            model_batches: Arc::new(ModelBatches::default()),
            pick_boxes: Vec::new(),
            pick_markers: Vec::new(),
            terrains: Vec::new(),
            waters: Vec::new(),
            box_count: 0,
            marker_count: 0,
            fence_count: 0,
            ring_count: 0,
            uploads: DwUploads::default(),
            plan: None,
            active_arcs: 0,
        }
    }
}

impl EngineState {
    /// 每帧 CPU 预计算，动画使用模拟时间，帧率使用实际时间。
    pub fn prepare_frame(&mut self, dt: f32, real_dt: f32) {
        self.time += dt;
        if real_dt > 0.0 {
            self.stats_elapsed += real_dt;
            self.stats_frames += 1;
            self.frame_times.push_back(real_dt * 1000.0);
            while self.frame_times.len() > 120 {
                self.frame_times.pop_front();
            }
        }
        if self.spin && self.mode == Mode::Login {
            self.camera.yaw += 0.07 * dt;
        }

        let aspect = self.aspect();
        if let Some((x, y)) = self.pick_request.take() {
            self.process_pick(x, y, aspect);
        }

        let view = self.camera.view();
        let proj = self.camera.proj(aspect);
        let vp = proj * view;
        let eye = self.camera.eye();
        let (fog_start, fog_end) = match self.mode {
            Mode::Editor => (self.fog_distance * 0.4, self.fog_distance),
            Mode::Login => (60.0, 240.0),
        };
        let params = {
            // 阴影：方向光的正交视投影，覆盖以相机注视点为中心的范围
            let light_dir = glam::Vec3::new(
                self.light_direction[0],
                self.light_direction[1],
                self.light_direction[2],
            )
            .normalize_or_zero();
            let shadow_enabled = self.mode == Mode::Editor && light_dir.length_squared() > 0.5;
            let radius = (self.camera.dist * 1.1).clamp(30.0, 400.0);
            let light_eye = self.camera.target + light_dir * radius * 2.5;
            let up = if light_dir.y.abs() > 0.98 {
                glam::Vec3::Z
            } else {
                glam::Vec3::Y
            };
            let light_view =
                glam::camera::rh::view::look_at_mat4(light_eye, self.camera.target, up);
            let light_proj = glam::camera::rh::proj::directx::orthographic(
                -radius,
                radius,
                -radius,
                radius,
                0.1,
                radius * 5.0,
            );
            FrameParams {
                vp: vp.to_cols_array_2d(),
                view: view.to_cols_array_2d(),
                proj: proj.to_cols_array_2d(),
                cam_pos: [eye.x, eye.y, eye.z, 1.0],
                misc: [self.time, self.mode.as_f32(), fog_start, fog_end],
                misc2: [self.selected as f32, 0.0, self.daylight, 0.0],
                background: self.background,
                ground: self.ground_color,
                light: self.light_direction,
                light_color: self.light_color,
                light_vp: (light_proj * light_view).to_cols_array_2d(),
                shadow: [if shadow_enabled { 1.0 } else { 0.0 }, 0.0015, 2.0, 0.0],
            }
        };

        let planes = self.camera.frustum_planes(aspect);
        let vp_array = vp.to_cols_array_2d();
        if self.visibility_dirty || self.visibility_vp != Some(vp_array) {
            self.visibility.update(
                &planes,
                self.cull_spheres_cpu.iter().map(|sphere| sphere.center),
                self.mesh_draws
                    .iter()
                    .map(|(id, index)| {
                        (
                            *index as usize,
                            self.meshes.get(id).map_or(0, |m| m.vertex_count / 3),
                        )
                    })
                    .chain(
                        self.terrains
                            .iter()
                            .map(|draw| (draw.index as usize, draw.triangles())),
                    )
                    .chain(
                        self.waters
                            .iter()
                            .map(|draw| (draw.index as usize, 64 * 64 * 2)),
                    ),
            );
            self.model_batches = Arc::new(ModelBatches::build(&self.mesh_draws, |index| {
                self.visibility.is_visible(index)
            }));
            self.visibility_vp = Some(vp_array);
            self.visibility_dirty = false;
            self.visibility_revision = self.visibility_revision.wrapping_add(1);
        }

        self.plan = Some(DwFramePlan {
            params,
            planes,
            visibility_revision: self.visibility_revision,
            mode: self.mode,
            grid: self.hud.grid,
            need_flyline: self.mode == Mode::Editor && self.hud.flylines,
            need_cull: self.box_count > 0,
            dt,
            box_count: self.box_count,
            marker_count: self.marker_count,
            fence_count: self.fence_count,
            ring_count: self.ring_count,
            model_batches: self.model_batches.clone(),
        });

        if self.stats_elapsed >= 0.5 {
            self.fps = self.stats_frames as f32 / self.stats_elapsed;
            self.stats_elapsed = 0.0;
            self.stats_frames = 0;
            let particles = self.active_arcs * oxgpu::FlylineSim::PARTICLES_PER_ARC;
            let tris = self.visibility.triangles + self.marker_count * 8 + particles * 2;
            self.events.push(EngineEvent::Stats {
                backend: self.backend_name.clone(),
                fps: self.fps,
                instances: self.box_count,
                visible: self.visibility.instances,
                particles,
                tris,
            });
        }
    }

    /// 当前帧宽高比：截图覆盖尺寸优先，否则逻辑尺寸。
    pub fn aspect(&self) -> f32 {
        match self.capture_size {
            Some((w, h)) => w as f32 / h.max(1) as f32,
            None => (self.logical_size.0 / self.logical_size.1.max(1.0)) as f32,
        }
    }

    // ---- 命令（CommandRequest 解码，原 Engine 方法平移） ----

    pub fn set_mode(&mut self, bytes: &[u8]) {
        let Ok(request) = protocol::decode_request(bytes) else {
            return;
        };
        let Some(payload) = request.payload_as_set_mode() else {
            return;
        };
        let mode = match payload.mode() {
            wire::Mode::Login => Mode::Login,
            _ => Mode::Editor,
        };
        if mode != self.mode {
            self.mode = mode;
            self.camera = camera_default(mode);
            self.spin = mode == Mode::Login;
            if mode == Mode::Login {
                let (pools, rings) = scene::ScenePools::login_city();
                self.apply_pools(pools);
                self.ring_count = rings.len().min(MAX_RINGS as usize) as u32;
                self.uploads.rings = Some(rings);
            }
        }
    }

    pub fn set_spin(&mut self, spin: bool) {
        self.spin = spin;
    }

    /// Register a prepared model once; instances reference its stable catalog identifier.
    pub fn register_mesh(&mut self, id: &str, bytes: &[u8]) -> Result<(), String> {
        if self.meshes.contains_key(id) {
            return Ok(());
        }
        let mesh = mesh::CpuMesh::decode(bytes)?;
        self.uploads.meshes.push((id.to_owned(), mesh.clone()));
        self.meshes.insert(id.to_owned(), mesh);
        self.visibility_dirty = true;
        Ok(())
    }

    /// 同步场景（CommandRequest(SceneUpdate)）。
    pub fn sync_scene(&mut self, bytes: &[u8]) {
        if self.mode == Mode::Login {
            return; // 登录页使用内置城市
        }
        let flat: Vec<scene::FlatInstanceIn> = match protocol::decode_request(bytes) {
            Ok(request) => match request.payload_as_scene_update() {
                Some(payload) => payload
                    .instances()
                    .iter()
                    .map(scene::FlatInstanceIn::from_wire)
                    .collect(),
                None => {
                    self.events.push(EngineEvent::Error {
                        message: "sync_scene 收到错误命令类型".into(),
                    });
                    return;
                }
            },
            Err(e) => {
                self.events.push(EngineEvent::Error { message: e });
                return;
            }
        };
        let pools = scene::ScenePools::from_flat_with_water(&flat, &self.terrains, &self.waters);
        let selected_id = self
            .selected
            .checked_sub(1)
            .and_then(|index| self.pick_boxes.get(index as usize))
            .map(|item| item.id.clone());
        self.apply_pools(pools);
        self.selected = 0;
        if let Some(id) = selected_id {
            self.set_selection_impl(&Some(id));
        }
    }

    pub fn set_selection(&mut self, id: Option<String>) {
        self.set_selection_impl(&id);
    }

    pub fn resize(&mut self, width: f64, height: f64, _dpr: f64) {
        self.logical_size = (width.max(1.0), height.max(1.0));
    }

    /// Change only the offscreen scene target. Passing (0, 0) restores the ordinary target.
    pub fn set_capture_size(&mut self, width: u32, height: u32) -> Result<(), String> {
        let restoring = width == 0 && height == 0;
        if !restoring
            && (width == 0 || height == 0 || u64::from(width) * u64::from(height) > 16_777_216)
        {
            return Err("截图尺寸超过当前设备支持的范围".into());
        }
        self.capture_size = if restoring {
            None
        } else {
            Some((width, height))
        };
        if let Ok(mut preview) = self.preview_state.lock() {
            preview.invalidate();
        }
        Ok(())
    }

    /// Project a screen coordinate onto a horizontal plane in world space.
    pub fn position_on_plane(&self, x: f64, y: f64, height: f32) -> Vec<f32> {
        self.plane_point(x, y, height)
            .map_or_else(Vec::new, |point| point.to_array().to_vec())
    }

    pub fn pointer_down(&mut self, x: f64, y: f64, button: u32, editable: bool) {
        let pos = egui::pos2(x as f32, y as f32);
        if self.mode == Mode::Login || self.egui_wants_pointer {
            return;
        }
        let mut target = None;
        let kind = match button {
            0 => {
                if editable {
                    if let Some(index) = self.movable_box_at(x, y) {
                        let picked = &self.pick_boxes[index];
                        if let Some(point) = self.plane_point(x, y, picked.center.y) {
                            target = Some(MoveTarget {
                                id: picked.id.clone(),
                                start_position: picked.center,
                                position: picked.center,
                                offset: picked.center - point,
                            });
                            self.selected = index as u32 + 1;
                        }
                    }
                }
                if target.is_some() {
                    DragKind::Move
                } else {
                    DragKind::Orbit
                }
            }
            2 => DragKind::Pan,
            _ => return,
        };
        self.drag = Some(DragState {
            kind,
            last: pos,
            start: pos,
            moved: false,
            target,
        });
    }

    pub fn pointer_up(&mut self, x: f64, y: f64, button: u32) {
        if let Some(d) = self.drag.take() {
            match d.kind {
                DragKind::Orbit if !d.moved && button == 0 => {
                    self.pick_request = Some((x, y));
                }
                DragKind::Move => {
                    if let Some(target) = d.target {
                        self.events.push(EngineEvent::Pick {
                            id: Some(target.id.clone()),
                        });
                        if d.moved && target.position != target.start_position {
                            self.events.push(EngineEvent::Transform {
                                id: target.id,
                                position: target.position.to_array(),
                            });
                        }
                    }
                }
                _ => {}
            }
        }
    }

    pub fn pointer_move(&mut self, x: f64, y: f64) {
        let pos = egui::pos2(x as f32, y as f32);
        let Some(mut d) = self.drag.take() else {
            return;
        };
        let dx = pos.x - d.last.x;
        let dy = pos.y - d.last.y;
        d.last = pos;
        if (pos - d.start).length() > 4.0 {
            d.moved = true;
        }
        match d.kind {
            DragKind::Orbit => {
                self.camera.yaw -= dx * 0.006;
                // 不允许视角钻到棋盘地面以下（与软渲染路径 [0.05, 1.52] 对齐）
                self.camera.pitch = (self.camera.pitch + dy * 0.006).clamp(0.05, 1.52);
            }
            DragKind::Pan => {
                let s = self.camera.dist * 0.0016;
                let (sy, cy) = (self.camera.yaw.sin(), self.camera.yaw.cos());
                let right = glam::Vec3::new(cy, 0.0, -sy);
                let fwd = glam::Vec3::new(-sy, 0.0, -cy);
                self.camera.target -= right * (dx * s);
                self.camera.target += fwd * (dy * s);
                self.camera.target.y = self.camera.target.y.clamp(0.0, 60.0);
            }
            DragKind::Move => {
                if d.moved {
                    if let Some(target) = d.target.as_mut() {
                        if let Some(point) = self.plane_point(x, y, target.start_position.y) {
                            let moved = point + target.offset;
                            target.position =
                                glam::Vec3::new(moved.x, target.start_position.y, moved.z);
                            self.move_instance(&target.id, target.position);
                        }
                    }
                }
            }
        }
        self.drag = Some(d);
    }

    pub fn wheel(&mut self, dy: f64) {
        if self.mode == Mode::Login || self.egui_wants_pointer {
            return;
        }
        self.camera.dist = (self.camera.dist * (dy as f32 * 0.0012).exp()).clamp(6.0, 260.0);
    }

    /// CommandRequest(SetHud)：布尔字段总是显式写入，整体替换状态。
    pub fn set_hud(&mut self, bytes: &[u8]) {
        let Ok(request) = protocol::decode_request(bytes) else {
            return;
        };
        let Some(payload) = request.payload_as_set_hud() else {
            return;
        };
        self.hud.grid = payload.grid();
        self.hud.flylines = payload.flylines();
        self.hud.stats = payload.stats();
    }

    /// Set a saved orbit view without recreating GPU resources.
    pub fn camera_view(&mut self, x: f32, y: f32, z: f32, yaw: f32, pitch: f32, dist: f32) {
        if [x, y, z, yaw, pitch, dist].iter().all(|v| v.is_finite()) {
            self.camera = Camera::new(
                glam::Vec3::new(x, y, z),
                yaw,
                pitch.clamp(0.01, 1.56),
                dist.clamp(2.0, 500.0),
            );
        }
    }

    pub fn camera_state(&self) -> Vec<f32> {
        vec![
            self.camera.target.x,
            self.camera.target.y,
            self.camera.target.z,
            self.camera.yaw,
            self.camera.pitch,
            self.camera.dist,
        ]
    }

    /// World to CSS pixels for the editing handles.
    pub fn screen_position(&self, x: f32, y: f32, z: f32) -> Vec<f32> {
        let aspect = (self.logical_size.0 / self.logical_size.1.max(1.0)) as f32;
        let p = self.camera.vp(aspect) * glam::Vec4::new(x, y, z, 1.0);
        if p.w <= 0.001 {
            return Vec::new();
        }
        vec![
            (p.x / p.w + 1.0) * 0.5 * self.logical_size.0 as f32,
            (1.0 - p.y / p.w) * 0.5 * self.logical_size.1 as f32,
        ]
    }

    /// CommandRequest(SetEnvironment)；daylight/fogDistance 以 0 表示缺省。
    pub fn set_environment(&mut self, bytes: &[u8]) {
        let Ok(request) = protocol::decode_request(bytes) else {
            return;
        };
        let Some(payload) = request.payload_as_set_environment() else {
            return;
        };
        let color = |value: Option<&wire::Color4>| -> Option<[f32; 4]> {
            let value = value?;
            Some([value.r(), value.g(), value.b(), value.a()])
        };
        if let Some(value) = color(payload.background()) {
            self.background = value;
        }
        if let Some(value) = color(payload.ground()) {
            self.ground_color = value;
        }
        if payload.daylight() != 0.0 {
            self.daylight = payload.daylight().clamp(0.1, 1.0);
        }
        if payload.fog_distance() != 0.0 {
            self.fog_distance = payload.fog_distance().clamp(20.0, 10000.0);
        }
    }

    pub fn set_lighting(&mut self, x: f32, y: f32, z: f32, r: f32, g: f32, b: f32, intensity: f32) {
        let raw = glam::Vec3::new(x, y, z);
        let direction = if raw.length_squared() > 0.000001 {
            raw.normalize()
        } else {
            glam::Vec3::Y
        };
        self.light_direction = [
            direction.x,
            direction.y,
            direction.z,
            intensity.clamp(0.0, 5.0),
        ];
        self.light_color = [r.clamp(0.0, 1.0), g.clamp(0.0, 1.0), b.clamp(0.0, 1.0), 1.0];
    }

    /// CommandRequest(SetSelections)。
    pub fn set_selections(&mut self, bytes: &[u8]) {
        let ids = protocol::decode_request(bytes)
            .ok()
            .and_then(|request| request.payload_as_set_selections())
            .and_then(|payload| payload.ids());
        let Some(ids) = ids else {
            return;
        };
        let ids: HashSet<&str> = ids.iter().collect();
        let mut changed = Vec::new();
        for (index, item) in self.instances_cpu.iter_mut().enumerate() {
            let selected = self
                .pick_boxes
                .get(index)
                .is_some_and(|item| ids.contains(item.id.as_str()));
            let selection = (index as f32 + 1.0) * if selected { -1.0 } else { 1.0 };
            if item.half_sel[3] != selection {
                item.half_sel[3] = selection;
                changed.push(index);
            }
        }
        if changed.is_empty() {
            return;
        }
        if let Some(pending) = &mut self.uploads.instances {
            for index in changed {
                pending[index] = self.instances_cpu[index];
            }
        } else if changed.len() > 2 {
            self.uploads.instances = Some(self.instances_cpu.clone());
            self.uploads.instance_updates.clear();
        } else {
            for index in changed {
                let instance = self.instances_cpu[index];
                if let Some((_, pending)) = self
                    .uploads
                    .instance_updates
                    .iter_mut()
                    .find(|(pending_index, _)| *pending_index == index)
                {
                    *pending = instance;
                } else {
                    self.uploads.instance_updates.push((index, instance));
                }
            }
        }
    }

    pub fn reset_camera(&mut self) {
        self.camera = camera_default(self.mode);
    }

    /// 开启/关闭读回预览（rAF 被节流的环境使用）。
    pub fn set_preview(&mut self, on: bool) {
        if let Ok(mut preview) = self.preview_state.lock() {
            preview.set_enabled(on);
        }
    }

    /// 取回最近一帧预览像素（RGBA8，紧凑行，alpha 强制 255）；无新帧返回空。
    pub fn take_preview(&mut self) -> Vec<u8> {
        self.preview_state
            .lock()
            .ok()
            .and_then(|mut state| state.take())
            .map_or_else(Vec::new, |frame| frame.pixels)
    }

    /// 返回宽、高的小端 u32 与紧凑 RGBA 像素，避免窗口改变尺寸后误读旧帧。
    pub fn take_preview_frame(&mut self) -> Vec<u8> {
        let Some(frame) = self
            .preview_state
            .lock()
            .ok()
            .and_then(|mut state| state.take())
        else {
            return Vec::new();
        };
        let mut result = Vec::with_capacity(8 + frame.pixels.len());
        result.extend_from_slice(&frame.width.to_le_bytes());
        result.extend_from_slice(&frame.height.to_le_bytes());
        result.extend_from_slice(&frame.pixels);
        result
    }

    pub fn take_preview_error(&mut self) -> Option<String> {
        self.preview_state
            .lock()
            .ok()
            .and_then(|mut state| state.take_error())
    }

    /// Drain an owned, size-prefixed CommandResponse (DWCR v1); no events return zero bytes.
    pub fn take_response(&mut self) -> Vec<u8> {
        crate::drain_pending_logs(&mut self.events);
        self.response_encoder.encode(&mut self.events)
    }

    // ---- 内部 ----

    fn plane_point(&self, x: f64, y: f64, height: f32) -> Option<glam::Vec3> {
        let aspect = (self.logical_size.0 / self.logical_size.1.max(1.0)) as f32;
        let (origin, direction) =
            self.camera
                .pick_ray(aspect, x, y, self.logical_size.0, self.logical_size.1);
        camera::ray_horizontal_plane(origin, direction, height)
    }

    fn movable_box_at(&self, x: f64, y: f64) -> Option<usize> {
        let aspect = (self.logical_size.0 / self.logical_size.1.max(1.0)) as f32;
        let (origin, direction) =
            self.camera
                .pick_ray(aspect, x, y, self.logical_size.0, self.logical_size.1);
        let mut best: Option<(f32, Option<usize>)> = None;
        for (index, item) in self.pick_boxes.iter().enumerate() {
            if let Some(distance) = self.pick_box_distance(item, origin, direction) {
                if best.is_none_or(|(current, _)| distance < current) {
                    best = Some((distance, Some(index)));
                }
            }
        }
        for item in &self.pick_markers {
            if let Some(distance) = camera::ray_sphere(origin, direction, item.center, 1.1) {
                if best.is_none_or(|(current, _)| distance < current) {
                    best = Some((distance, None));
                }
            }
        }
        best.and_then(|(_, index)| index)
            .filter(|&index| !self.pick_boxes[index].locked)
    }

    fn pick_box_distance(
        &self,
        item: &scene::PickBox,
        origin: glam::Vec3,
        direction: glam::Vec3,
    ) -> Option<f32> {
        if let Some(draw) = self.waters.iter().find(|draw| draw.id == item.id) {
            return draw.picking.as_ref()?.ray_distance(
                origin,
                direction,
                item.center,
                item.half,
                item.rotation,
            );
        }
        if let Some(draw) = self.terrains.iter().find(|draw| draw.id == item.id) {
            return draw.surface.picking.as_ref()?.ray_distance(
                origin,
                direction,
                item.center,
                item.half,
                item.rotation,
            );
        }
        if let Some(picking) = item
            .model_id
            .as_ref()
            .and_then(|id| self.meshes.get(id))
            .and_then(|mesh| mesh.picking.as_ref())
        {
            return picking.ray_distance(origin, direction, item.center, item.half, item.rotation);
        }
        camera::ray_oriented_box(origin, direction, item.center, item.half, item.rotation)
    }

    fn move_instance(&mut self, id: &str, position: glam::Vec3) {
        let Some(index) = self.pick_boxes.iter().position(|item| item.id == id) else {
            return;
        };
        self.pick_boxes[index].center = position;
        self.visibility_dirty = true;
        if let Some(instance) = self.instances_cpu.get_mut(index) {
            instance.center_rot[..3].copy_from_slice(&position.to_array());
            if let Some(instances) = &mut self.uploads.instances {
                instances[index] = *instance;
            } else if let Some((_, pending)) = self
                .uploads
                .instance_updates
                .iter_mut()
                .find(|(i, _)| *i == index)
            {
                *pending = *instance;
            } else {
                self.uploads.instance_updates.push((index, *instance));
            }
        }
        if let Some(sphere) = self.cull_spheres_cpu.get_mut(index) {
            sphere.center[..3].copy_from_slice(&position.to_array());
            if let Some(pending) = self
                .uploads
                .sphere_updates
                .iter_mut()
                .find(|s| s.index == sphere.index)
            {
                *pending = *sphere;
            } else {
                self.uploads.sphere_updates.push(*sphere);
            }
        }
    }

    fn set_selection_impl(&mut self, id: &Option<String>) {
        self.selected = id
            .as_ref()
            .and_then(|id| self.pick_boxes.iter().position(|b| &b.id == id))
            .map(|i| i as u32 + 1)
            .unwrap_or(0);
    }

    pub fn apply_pools(&mut self, pools: scene::ScenePools) {
        let scene::ScenePools {
            instances,
            markers,
            fences,
            arcs,
            pick_boxes,
            pick_markers,
            cull_spheres,
            mesh_draws,
            terrains,
            waters,
        } = pools;
        self.waters = waters;
        self.uploads.waters = Some(self.waters.clone());
        self.terrains = terrains;
        self.uploads.terrains = Some(self.terrains.clone());
        self.mesh_draws = mesh_draws.into();
        self.visibility_dirty = true;
        self.box_count = instances.len() as u32;
        self.marker_count = markers.len() as u32;
        self.fence_count = fences.len() as u32;
        self.instances_cpu = instances;
        self.uploads.instances = Some(self.instances_cpu.clone());
        self.uploads.instance_updates.clear();
        self.uploads.sphere_updates.clear();
        self.uploads.markers = Some(markers);
        self.uploads.fences = Some(fences);
        self.active_arcs = arcs.len().min(oxgpu::FlylineSim::MAX_ARCS as usize) as u32;
        self.uploads.arcs = Some(arcs);
        self.uploads.cull_spheres = Some(cull_spheres.clone());
        self.cull_spheres_cpu = cull_spheres;
        self.pick_boxes = pick_boxes;
        self.pick_markers = pick_markers;
    }

    /// HUD 统计快照（性能统计面板 + Stats 事件共用）。
    pub fn hud_stats(&self) -> hud::StatsSnapshot {
        let particles = self.active_arcs * oxgpu::FlylineSim::PARTICLES_PER_ARC;
        hud::StatsSnapshot {
            backend: "GPU",
            fps: self.fps,
            instances: self.box_count,
            visible: self.visibility.instances,
            particles,
            tris: self.visibility.triangles + self.marker_count * 8 + particles * 2,
        }
    }

    pub fn push_hud_event(&mut self) {
        self.events.push(EngineEvent::Hud {
            grid: self.hud.grid,
            flylines: self.hud.flylines,
            stats: self.hud.stats,
        });
    }

    fn process_pick(&mut self, x: f64, y: f64, aspect: f32) {
        if self.mode != Mode::Editor {
            return;
        }
        let (origin, dir) =
            self.camera
                .pick_ray(aspect, x, y, self.logical_size.0, self.logical_size.1);
        let mut best: Option<(f32, String)> = None;
        for b in &self.pick_boxes {
            if let Some(t) = self.pick_box_distance(b, origin, dir) {
                if best.as_ref().is_none_or(|(bt, _)| t < *bt) {
                    best = Some((t, b.id.clone()));
                }
            }
        }
        for m in &self.pick_markers {
            if let Some(t) = camera::ray_sphere(origin, dir, m.center, 1.1) {
                if best.as_ref().is_none_or(|(bt, _)| t < *bt) {
                    best = Some((t, m.id.clone()));
                }
            }
        }
        self.events.push(EngineEvent::Pick {
            id: best.map(|(_, id)| id),
        });
    }
}

pub(crate) fn camera_default(mode: Mode) -> Camera {
    match mode {
        Mode::Editor => Camera::new(glam::Vec3::new(2.0, 2.0, 0.0), 0.75, 0.55, 72.0),
        Mode::Login => Camera::new(glam::Vec3::new(0.0, 6.0, 0.0), 0.9, 0.36, 44.0),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn selections(ids: &[&str]) -> Vec<u8> {
        let mut builder = flatbuffers::FlatBufferBuilder::new();
        let names: Vec<_> = ids.iter().map(|id| builder.create_string(id)).collect();
        let names = builder.create_vector(&names);
        let selection = wire::SetSelections::create(
            &mut builder,
            &wire::SetSelectionsArgs { ids: Some(names) },
        );
        let request = wire::CommandRequest::create(
            &mut builder,
            &wire::CommandRequestArgs {
                protocol_version: protocol::PROTOCOL_VERSION,
                payload_type: wire::CommandPayload::SetSelections,
                payload: Some(selection.as_union_value()),
            },
        );
        builder.finish(request, None);
        builder.finished_data().to_vec()
    }

    #[test]
    fn selection_uploads_only_changes_and_preserves_pending_moves() {
        let mut state = EngineState::default();
        let (pools, _) = scene::ScenePools::login_city();
        let ids: Vec<String> = pools
            .pick_boxes
            .iter()
            .map(|item| item.id.clone())
            .collect();
        assert!(ids.len() >= 3);
        state.apply_pools(pools);

        // A selection before the first upload must update the pending full buffer.
        state.set_selections(&selections(&[&ids[0]]));
        assert!(state.uploads.instances.as_ref().expect("full upload")[0].half_sel[3] < 0.0);
        assert!(state.uploads.instance_updates.is_empty());
        let _ = std::mem::take(&mut state.uploads);

        // Repeating the same selection must not upload anything.
        state.set_selections(&selections(&[&ids[0]]));
        assert!(state.uploads.instances.is_none());
        assert!(state.uploads.instance_updates.is_empty());

        // Switching selection changes only the two affected instances.
        state.set_selections(&selections(&[&ids[1]]));
        assert!(state.uploads.instances.is_none());
        assert_eq!(state.uploads.instance_updates.len(), 2);
        assert!(state.instances_cpu[0].half_sel[3] > 0.0);
        assert!(state.instances_cpu[1].half_sel[3] < 0.0);
        let _ = std::mem::take(&mut state.uploads);

        // A selection change and a move of the same instance share the latest update.
        state.move_instance(&ids[1], glam::Vec3::new(7.0, 8.0, 9.0));
        state.set_selections(&selections(&[]));
        assert_eq!(state.uploads.instance_updates.len(), 1);
        let (_, updated) = &state.uploads.instance_updates[0];
        assert_eq!(updated.center_rot[..3], [7.0, 8.0, 9.0]);
        assert!(updated.half_sel[3] > 0.0);

        // A bulk selection replaces pending partial writes with a complete buffer.
        state.set_selections(&selections(&[&ids[0], &ids[1], &ids[2]]));
        let full = state.uploads.instances.as_ref().expect("bulk upload");
        assert!(full[..3].iter().all(|instance| instance.half_sel[3] < 0.0));
        assert_eq!(full[1].center_rot[..3], [7.0, 8.0, 9.0]);
        assert!(state.uploads.instance_updates.is_empty());
    }

    #[test]
    fn stats_measure_elapsed_time_across_stalls_and_short_frames() {
        let mut state = EngineState::default();
        state.prepare_frame(0.1, 0.495);
        state.prepare_frame(0.002, 0.002);
        assert!(state.events.is_empty());

        state.prepare_frame(0.005, 0.005);
        assert!(matches!(
            state.events.as_slice(),
            [EngineEvent::Stats { fps, .. }] if (*fps - 3.0 / 0.502).abs() < 0.001
        ));
        assert!((state.frame_times[0] - 495.0).abs() < 0.001);
        assert!((state.time - 0.107).abs() < 0.001);
    }

    #[test]
    fn visibility_tracks_scene_and_camera_changes_after_a_static_frame() {
        let mut state = EngineState::default();
        let (pools, _) = scene::ScenePools::login_city();
        state.apply_pools(pools);
        state.prepare_frame(0.016, 0.016);
        let visible_before = state.visibility.instances;
        let static_revision = state.plan.as_ref().expect("frame plan").visibility_revision;
        let index = (0..state.pick_boxes.len())
            .find(|index| state.visibility.is_visible(*index))
            .expect("a visible object");
        let id = state.pick_boxes[index].id.clone();

        state.prepare_frame(0.016, 0.016);
        assert_eq!(state.visibility.instances, visible_before);
        assert_eq!(
            state.plan.as_ref().expect("frame plan").visibility_revision,
            static_revision,
            "static scene frames retain the cull revision"
        );
        state.move_instance(&id, glam::Vec3::splat(10_000.0));
        state.prepare_frame(0.016, 0.016);
        assert_eq!(state.visibility.instances + 1, visible_before);
        let moved_revision = state.plan.as_ref().expect("frame plan").visibility_revision;
        assert_ne!(moved_revision, static_revision);

        state.camera.target = glam::Vec3::splat(10_000.0);
        state.prepare_frame(0.016, 0.016);
        assert!(state.visibility.is_visible(index));
        assert_ne!(
            state.plan.as_ref().expect("frame plan").visibility_revision,
            moved_revision,
            "camera changes invalidate cached GPU culling"
        );
    }

    #[test]
    fn moving_instances_coalesces_updates_and_respects_full_uploads() {
        let mut state = EngineState::default();
        let (pools, _) = scene::ScenePools::login_city();
        let id = pools.pick_boxes[0].id.clone();
        state.apply_pools(pools);
        state.move_instance(&id, glam::Vec3::new(1.0, 2.0, 3.0));
        assert_eq!(
            state.uploads.instances.as_ref().unwrap()[0].center_rot[..3],
            [1.0, 2.0, 3.0]
        );
        assert!(state.uploads.instance_updates.is_empty());

        let _ = std::mem::take(&mut state.uploads);
        state.move_instance(&id, glam::Vec3::new(4.0, 5.0, 6.0));
        state.move_instance(&id, glam::Vec3::new(7.0, 8.0, 9.0));
        assert!(state.uploads.instances.is_none());
        assert_eq!(state.uploads.instance_updates.len(), 1);
        assert_eq!(
            state.uploads.instance_updates[0].1.center_rot[..3],
            [7.0, 8.0, 9.0]
        );
        assert_eq!(state.uploads.sphere_updates.len(), 1);
        assert_eq!(state.uploads.sphere_updates[0].center[..3], [7.0, 8.0, 9.0]);

        state.apply_pools(scene::ScenePools::empty());
        assert!(state.uploads.instance_updates.is_empty());
        assert!(state.uploads.sphere_updates.is_empty());
    }
}
