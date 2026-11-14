//! Rust compatibility rendering for 3D scenes, using the board's egui mesh rasterizer.

use std::collections::HashMap;

use egui::{Color32, Pos2, Rect, Shape, Stroke, pos2, vec2};
use glam::{EulerRot, Quat, Vec3};

use crate::board::{BoardFrame, Rasterizer};
use crate::camera::Camera;
use crate::common::FlatInstanceIn;
use crate::mesh::{ModelVertex, decode_mesh};
use crate::protocol;

#[path = "software/materials.rs"]
mod materials;

#[derive(Default)]
pub struct SoftwareCamera {
    pub target: [f32; 3],
    pub yaw: f32,
    pub pitch: f32,
    pub dist: f32,
}

#[derive(Default)]
pub struct SoftwareOptions {
    pub grid: bool,
    pub selected_id: Option<String>,
    pub selected_ids: Vec<String>,
    pub time: f32,
    pub background: Option<String>,
    pub daylight: Option<f32>,
}

#[derive(Default)]
pub struct SoftwareInput {
    pub instances: Vec<FlatInstanceIn>,
    pub camera: SoftwareCamera,
    pub options: SoftwareOptions,
}

impl SoftwareInput {
    /// Decode a verified CommandRequest(SoftwareFrame)；""/0 哨兵表示缺省。
    pub(crate) fn from_wire(payload: protocol::wire::SoftwareFrame<'_>) -> Self {
        let camera = payload.camera();
        let options = payload.options();
        let target = camera.target();
        Self {
            instances: payload
                .instances()
                .iter()
                .map(FlatInstanceIn::from_wire)
                .collect(),
            camera: SoftwareCamera {
                target: [target.x(), target.y(), target.z()],
                yaw: camera.yaw(),
                pitch: camera.pitch(),
                dist: camera.dist(),
            },
            options: SoftwareOptions {
                grid: options.grid(),
                selected_id: options
                    .selected_id()
                    .filter(|id| !id.is_empty())
                    .map(str::to_owned),
                selected_ids: options
                    .selected_ids()
                    .map(|ids| ids.iter().map(str::to_owned).collect())
                    .unwrap_or_default(),
                time: options.time(),
                background: options
                    .background()
                    .filter(|value| !value.is_empty())
                    .map(str::to_owned),
                daylight: (options.daylight() != 0.0).then_some(options.daylight()),
            },
        }
    }
}

#[derive(Default)]
pub struct SoftwareScene {
    meshes: HashMap<String, Vec<ModelVertex>>,
    material_models: HashMap<String, data_wind_assets::ModelAsset>,
    material_overrides: HashMap<String, materials::Overrides>,
    material_textures: materials::Textures,
    material_hits: materials::Hits,
    hits: Vec<SoftwareHit>,
    context: egui::Context,
    raster: Rasterizer,
    terrains: HashMap<String, std::sync::Arc<crate::terrain::TerrainSurface>>,
    waters: HashMap<String, SoftwareWater>,
    terrain_revision: u64,
    terrain_transforms: Vec<(String, [f32; 3], [f32; 3], [f32; 3])>,
}

#[derive(Clone)]
struct SoftwareWater {
    config: crate::water::WaterConfig,
    transform: ([f32; 3], [f32; 3], [f32; 3]),
    terrain_revision: u64,
    simulation: Option<crate::water::ShallowWater>,
    last_time: f32,
    mesh: Vec<ModelVertex>,
}

struct SoftwareHit {
    id: String,
    bounds: Rect,
    geometry: HitGeometry,
}

enum HitGeometry {
    Triangles(Vec<HitTriangle>),
    Marker(f32),
}

struct HitTriangle {
    points: [Pos2; 3],
    depth: f32,
}

fn triangle_contains(points: [Pos2; 3], point: Pos2) -> bool {
    let edge = |a: Pos2, b: Pos2| (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
    let values = [
        edge(points[0], points[1]),
        edge(points[1], points[2]),
        edge(points[2], points[0]),
    ];
    let area = (points[1].x - points[0].x) * (points[2].y - points[0].y)
        - (points[1].y - points[0].y) * (points[2].x - points[0].x);
    area.abs() > 0.0001 && (values.iter().all(|v| *v >= 0.0) || values.iter().all(|v| *v <= 0.0))
}

impl SoftwareScene {
    pub fn register_mesh(&mut self, id: &str, bytes: &[u8]) -> Result<(), String> {
        self.meshes.insert(id.into(), decode_mesh(bytes)?);
        Ok(())
    }

    pub fn register_model_asset(&mut self, id: &str, bytes: &[u8]) -> Result<(), String> {
        self.material_models.insert(id.into(), data_wind_assets::decode_asset(bytes)?);
        Ok(())
    }

    pub fn set_model_materials(&mut self, id: &str, settings: &str) -> Result<(), String> {
        let parsed = serde_json::from_str(settings).map_err(|error| error.to_string())?;
        self.material_overrides.insert(id.into(), parsed);
        Ok(())
    }

    pub fn set_model_texture(
        &mut self, id: u32, width: u32, height: u32, rgba: &[u8],
    ) -> Result<(), String> {
        self.material_textures.insert(id, width, height, rgba)
    }

    pub fn pick(&self, point: Pos2) -> Option<&str> {
        if let Some(id) = self.material_hits.pick(point) {
            return Some(id);
        }
        self.hits
            .iter()
            .filter(|hit| hit.bounds.contains(point))
            .filter_map(|hit| {
                let depth = match &hit.geometry {
                    HitGeometry::Marker(depth) => Some(*depth),
                    HitGeometry::Triangles(triangles) => triangles
                        .iter()
                        .filter(|triangle| triangle_contains(triangle.points, point))
                        .map(|triangle| triangle.depth)
                        .min_by(f32::total_cmp),
                }?;
                Some((hit.id.as_str(), depth))
            })
            .min_by(|a, b| a.1.total_cmp(&b.1))
            .map(|(id, _)| id)
    }

    pub fn render(
        &mut self,
        width: u32,
        height: u32,
        input: &SoftwareInput,
        capture: bool,
    ) -> Vec<u8> {
        let saved_cache = capture.then(|| {
            (
                self.waters.clone(),
                self.terrains.clone(),
                self.terrain_revision,
                self.terrain_transforms.clone(),
            )
        });
        let cam = &input.camera;
        let options = &input.options;
        let terrain_transforms: Vec<_> = input
            .instances
            .iter()
            .filter(|i| i.kind == "terrain")
            .map(|i| {
                (
                    i.id.clone(),
                    i.pos,
                    i.size,
                    i.rotation.unwrap_or([0.0, i.rot_y, 0.0]),
                )
            })
            .collect();
        let mut terrain_changed = terrain_transforms != self.terrain_transforms;
        self.terrain_transforms = terrain_transforms;
        self.terrains.retain(|id, _| {
            input
                .instances
                .iter()
                .any(|i| i.kind == "terrain" && &i.id == id)
        });
        for instance in input.instances.iter().filter(|i| i.kind == "terrain") {
            let changed = self.terrains.get(&instance.id).is_none_or(|surface| {
                instance.terrain.as_ref().map_or_else(
                    || surface.config != Default::default(),
                    |config| surface.config != *config,
                )
            });
            if changed {
                terrain_changed = true;
                self.terrains.insert(
                    instance.id.clone(),
                    std::sync::Arc::new(crate::terrain::TerrainSurface::new(
                        instance.terrain.clone().unwrap_or_default(),
                    )),
                );
            }
        }
        if terrain_changed {
            self.terrain_revision = self.terrain_revision.wrapping_add(1);
        }
        self.waters.retain(|id, _| {
            input
                .instances
                .iter()
                .any(|i| i.kind == "water" && &i.id == id)
        });
        for instance in input
            .instances
            .iter()
            .filter(|i| i.kind == "water")
            .take(crate::water::MAX_WATERS)
        {
            let config = instance.water.clone().unwrap_or_default();
            let angles = instance.rotation.unwrap_or([0.0, instance.rot_y, 0.0]);
            let transform = (instance.pos, instance.size, angles);
            let cached = self.waters.get(&instance.id);
            let reset = cached.is_none_or(|w| {
                w.transform != transform
                    || w.config.preset != config.preset
                    || w.config.initial_depth != config.initial_depth
                    || w.config.reset_version != config.reset_version
                    || w.terrain_revision != self.terrain_revision
            });
            if reset {
                let simulation = if config.preset == "shallow" {
                    let rotation = Quat::from_euler(EulerRot::YXZ, angles[1], angles[0], angles[2]);
                    let bed = crate::water::build_bed(
                        &config,
                        instance.size,
                        Vec3::from(instance.pos),
                        rotation,
                        input
                            .instances
                            .iter()
                            .filter(|i| i.kind == "terrain")
                            .filter_map(|i| {
                                let surface = self.terrains.get(&i.id)?;
                                let [rx, ry, rz] = i.rotation.unwrap_or([0.0, i.rot_y, 0.0]);
                                Some((
                                    surface.as_ref(),
                                    Vec3::from(i.pos),
                                    Vec3::from(i.size) * 0.5,
                                    Quat::from_euler(EulerRot::YXZ, ry, rx, rz),
                                ))
                            }),
                        crate::water::SIM_RESOLUTION,
                    );
                    Some(crate::water::ShallowWater::new(
                        &config,
                        instance.size,
                        bed,
                        crate::water::SIM_RESOLUTION,
                    ))
                } else {
                    None
                };
                self.waters.insert(
                    instance.id.clone(),
                    SoftwareWater {
                        config: config.clone(),
                        transform,
                        terrain_revision: self.terrain_revision,
                        simulation,
                        last_time: options.time,
                        mesh: Vec::new(),
                    },
                );
            }
            if let Some(water) = self.waters.get_mut(&instance.id) {
                if let Some(sim) = &mut water.simulation {
                    if water.config.sources != config.sources {
                        sim.rates = crate::water::source_field(&config, instance.size, sim.n);
                    }
                    if config.running && !capture {
                        for _ in 0..4 {
                            sim.step((options.time - water.last_time).clamp(0.0, 0.1) * 0.25);
                        }
                    }
                }
                if !capture {
                    water.last_time = options.time;
                }
                water.mesh = crate::water::software_mesh(
                    &config,
                    instance.size,
                    options.time,
                    water.simulation.as_ref(),
                );
                water.config = config;
            }
        }
        let camera = Camera::new(Vec3::from(cam.target), cam.yaw, cam.pitch, cam.dist);
        let vp = camera.vp(width as f32 / height as f32);
        let project = |point: Vec3| -> Option<(Pos2, f32)> {
            let clip = vp * point.extend(1.0);
            if clip.w <= 0.05 {
                return None;
            }
            Some((
                pos2(
                    (clip.x / clip.w + 1.0) * width as f32 * 0.5,
                    (1.0 - clip.y / clip.w) * height as f32 * 0.5,
                ),
                clip.w,
            ))
        };
        let screen = Rect::from_min_size(Pos2::ZERO, vec2(width as f32, height as f32));
        let mut hits = Vec::new();
        let mut shapes = Vec::new();
        let mut material_frame = materials::Frame::new(screen);
        let light = Vec3::new(0.45, 0.85, 0.35).normalize();
        let cube: Vec<ModelVertex> = crate::common::box_mesh()
            .into_iter()
            .map(|v| ModelVertex {
                position: [v[0], v[1], v[2]],
                normal: [v[3], v[4], v[5]],
                color: [1.0; 3],
            })
            .collect();
        for instance in &input.instances {
            let position = Vec3::from(instance.pos);
            let size = Vec3::from(instance.size);
            let [rx, ry, rz] = instance.rotation.unwrap_or([0.0, instance.rot_y, 0.0]);
            let rotation = Quat::from_euler(EulerRot::YXZ, ry, rx, rz);
            let tint = Vec3::from(instance.color);
            let selected = options.selected_id.as_ref() == Some(&instance.id)
                || options.selected_ids.contains(&instance.id);
            if instance.kind == "mesh"
                && let Some(model) = instance.model_id.as_ref().and_then(|id| self.material_models.get(id))
            {
                let transform = glam::Mat4::from_scale_rotation_translation(size, rotation, position);
                material_frame.add_model(
                    &instance.id, model, self.material_overrides.get(&instance.id),
                    &self.material_textures, transform, vp, tint, selected,
                );
                continue;
            }
            if instance.kind == "box"
                || instance.kind == "mesh"
                || instance.kind == "terrain"
                || instance.kind == "water"
            {
                let mesh = self
                    .waters
                    .get(&instance.id)
                    .filter(|_| instance.kind == "water")
                    .map(|w| &w.mesh)
                    .or_else(|| {
                        self.terrains
                            .get(&instance.id)
                            .filter(|_| instance.kind == "terrain")
                            .map(|surface| &surface.mesh)
                    })
                    .or_else(|| {
                        instance
                            .model_id
                            .as_ref()
                            .and_then(|id| self.meshes.get(id))
                    })
                    .unwrap_or(&cube);
                let mut bounds = Rect::NOTHING;
                let mut hit_triangles = Vec::new();
                for triangle in mesh.chunks_exact(3) {
                    // 3D 空间退化（重复顶点）的三角形在羽化光栅化中会产生长刺伪影，跳过。
                    let degenerate = triangle[0].position == triangle[1].position
                        || triangle[1].position == triangle[2].position
                        || triangle[2].position == triangle[0].position;
                    if degenerate {
                        continue;
                    }
                    let projected: Vec<(Pos2, f32)> = triangle
                        .iter()
                        .filter_map(|vertex| {
                            project(rotation * (Vec3::from(vertex.position) * size) + position)
                        })
                        .collect();
                    if projected.len() != 3 {
                        continue;
                    }
                    let points: Vec<Pos2> = projected.iter().map(|v| v.0).collect();
                    // 退化三角形（共线/重叠顶点）在 egui 羽化光栅化中会产生 NaN 巨面，直接跳过。
                    if points.iter().any(|p| !p.x.is_finite() || !p.y.is_finite()) {
                        continue;
                    }
                    let area2 = ((points[1].x - points[0].x) * (points[2].y - points[0].y)
                        - (points[2].x - points[0].x) * (points[1].y - points[0].y))
                        .abs();
                    if !area2.is_finite() || area2 < 0.01 {
                        continue;
                    }
                    let triangle_bounds = Rect::from_points(&points);
                    if !triangle_bounds.intersects(screen) {
                        continue;
                    }
                    let depth = projected.iter().map(|v| v.1).sum::<f32>() / 3.0;
                    if !capture {
                        bounds = bounds.union(triangle_bounds);
                        hit_triangles.push(HitTriangle {
                            points: [points[0], points[1], points[2]],
                            depth: depth * depth,
                        });
                    }
                    let normal = rotation
                        * (Vec3::from(triangle[0].normal) / size.abs().max(Vec3::splat(0.0001)))
                            .normalize_or_zero();
                    let shade = 0.18
                        + options.daylight.unwrap_or(1.0)
                            * (0.37 + 0.6 * normal.dot(light).max(0.0));
                    let albedo = self
                        .terrains
                        .get(&instance.id)
                        .filter(|_| instance.kind == "terrain")
                        .map_or(Vec3::from(triangle[0].color) * tint, |surface| {
                            let up = (rotation.conjugate() * normal).y;
                            surface.material_color(triangle[0].position[1] + 0.5, up, tint)
                        });
                    let albedo = self
                        .waters
                        .get(&instance.id)
                        .filter(|_| instance.kind == "water")
                        .map_or(albedo, |w| {
                            albedo.lerp(Vec3::from(w.config.scattering_color), 0.35)
                                + Vec3::splat(normal.dot(light).max(0.0).powf(32.0) * 0.18)
                        });
                    let mut rgb = albedo * shade;
                    rgb = rgb.map(|v| {
                        if v <= 0.003_130_8 {
                            v * 12.92
                        } else {
                            1.055 * v.powf(1.0 / 2.4) - 0.055
                        }
                    });
                    if selected {
                        rgb = rgb * 0.85 + Vec3::new(0.25, 0.65, 1.0) * 0.15;
                    }
                    shapes.push((
                        depth,
                        Shape::convex_polygon(
                            points,
                            rgb_color(
                                rgb,
                                self.waters
                                    .get(&instance.id)
                                    .filter(|_| instance.kind == "water")
                                    .map_or(1.0, |w| w.config.opacity),
                            ),
                            Stroke::NONE,
                        ),
                    ));
                }
                if !hit_triangles.is_empty() {
                    hits.push(SoftwareHit {
                        id: instance.id.clone(),
                        bounds,
                        geometry: HitGeometry::Triangles(hit_triangles),
                    });
                }
            } else if instance.kind == "fence" {
                let points: Vec<Pos2> = [(-0.5, -0.5), (0.5, -0.5), (0.5, 0.5), (-0.5, 0.5)]
                    .into_iter()
                    .filter_map(|(x, z)| {
                        project(position + rotation * Vec3::new(x * size.x, 0.06, z * size.z))
                            .map(|v| v.0)
                    })
                    .collect();
                if points.len() == 4 {
                    shapes.push((
                        position.distance(camera.eye()),
                        Shape::convex_polygon(
                            points,
                            rgb_color(tint, 0.12),
                            Stroke::new(1.5, rgb_color(tint, 0.8)),
                        ),
                    ));
                }
            } else if instance.kind == "flyline" {
                let end = instance
                    .to
                    .map_or(position + Vec3::new(18.0, 2.0, 12.0), Vec3::from);
                let control =
                    (position + end) * 0.5 + Vec3::Y * (position.distance(end) * 0.35 + 2.0);
                let curve = |t: f32| {
                    position * (1.0 - t).powi(2) + control * (2.0 * t * (1.0 - t)) + end * t * t
                };
                let points: Vec<Pos2> = (0..=32)
                    .filter_map(|i| project(curve(i as f32 / 32.0)).map(|p| p.0))
                    .collect();
                shapes.push((
                    0.0,
                    Shape::line(points, Stroke::new(1.5, rgb_color(tint, 0.45))),
                ));
                for i in 0..12 {
                    let t = (options.time * 0.35 + i as f32 / 12.0).fract();
                    if let Some((point, _)) = project(curve(t)) {
                        shapes.push((
                            0.0,
                            Shape::circle_filled(
                                point,
                                2.2,
                                rgb_color(tint, 0.3 + 0.7 * (std::f32::consts::PI * t).sin()),
                            ),
                        ));
                    }
                }
            } else if instance.kind == "marker" {
                if let (Some((base, _)), Some((top, depth))) = (
                    project(Vec3::new(position.x, 0.05, position.z)),
                    project(position),
                ) {
                    let top = top + vec2(0.0, (options.time * 2.0 + position.x).sin() * 3.0);
                    shapes.push((
                        0.0,
                        Shape::line_segment([base, top], Stroke::new(1.5, rgb_color(tint, 0.5))),
                    ));
                    shapes.push((
                        0.0,
                        Shape::convex_polygon(
                            vec![
                                top - vec2(0.0, 7.0),
                                top + vec2(5.0, 0.0),
                                top + vec2(0.0, 7.0),
                                top - vec2(5.0, 0.0),
                            ],
                            rgb_color(tint, 0.95),
                            Stroke::NONE,
                        ),
                    ));
                    if !capture {
                        hits.push(SoftwareHit {
                            id: instance.id.clone(),
                            bounds: Rect::from_center_size(top, vec2(30.0, 32.0)),
                            geometry: HitGeometry::Marker(depth * depth * 0.8),
                        });
                    }
                }
            }
        }
        shapes.sort_by(|a, b| b.0.total_cmp(&a.0));
        self.context.begin_pass(egui::RawInput {
            screen_rect: Some(screen),
            time: Some(f64::from(options.time)),
            ..Default::default()
        });
        {
            let p = self.context.layer_painter(egui::LayerId::background());
            // 天空：解析近似大气渐变（与 GPU 端 sky.wgsl 的 Nishita 观感对齐；
            // CPU 软渲不做逐像素 raymarch，用分层色带近似）。
            let bg = crate::board::color(options.background.as_deref().unwrap_or("#23262e"));
            let daylight = options.daylight.unwrap_or(1.0).clamp(0.1, 1.0);
            let sun_y = 0.83_f32; // 引擎默认光源方向 [0.45,0.85,0.35] 的高度角
            let smooth = |t: f32| -> f32 {
                let t = t.clamp(0.0, 1.0);
                t * t * (3.0 - 2.0 * t)
            };
            let day = smooth((sun_y - 0.05) / 0.30);
            let sunset = (-(sun_y / 0.12) * (sun_y / 0.12)).exp();
            let mix3 = |a: [f32; 3], b: [f32; 3], t: f32| -> [f32; 3] {
                [
                    a[0] + (b[0] - a[0]) * t,
                    a[1] + (b[1] - a[1]) * t,
                    a[2] + (b[2] - a[2]) * t,
                ]
            };
            let zenith = mix3([0.30, 0.52, 0.86], [0.02, 0.03, 0.08], 1.0 - day);
            let mut horizon = mix3([0.74, 0.82, 0.93], [0.05, 0.06, 0.12], 1.0 - day);
            horizon[0] += 0.70 * sunset * day;
            horizon[1] += 0.28 * sunset * day;
            let bg_rgb = [
                bg.r() as f32 / 255.0,
                bg.g() as f32 / 255.0,
                bg.b() as f32 / 255.0,
            ];
            let lum = 0.55 + 0.45 * daylight * (0.35 + 0.65 * day);
            let bands = 48;
            for i in 0..bands {
                let t = i as f32 / (bands - 1) as f32; // 0=屏幕顶(天顶) 1=底部
                let c = mix3(zenith, horizon, smooth((t - 0.05) / 0.75));
                // 底部衔接背景色（地面/网格区域），弱化硬边
                let c = mix3(c, bg_rgb, smooth((t - 0.85) / 0.15));
                let color = Color32::from_rgb(
                    (c[0].clamp(0.0, 1.0) * lum * 255.0) as u8,
                    (c[1].clamp(0.0, 1.0) * lum * 255.0) as u8,
                    (c[2].clamp(0.0, 1.0) * lum * 255.0) as u8,
                );
                let y0 = height as f32 * i as f32 / bands as f32;
                let y1 = height as f32 * (i + 1) as f32 / bands as f32;
                p.rect_filled(
                    Rect::from_min_size(Pos2::ZERO, vec2(width as f32, y1 - y0 + 0.5))
                        .translate(vec2(0.0, y0)),
                    0.0,
                    color,
                );
            }
            if options.grid {
                let grid = crate::common::grid_mesh(
                    crate::common::EDITOR_GRID_EXTENT,
                    crate::common::EDITOR_GRID_STEP,
                );
                for line in grid.chunks_exact(2) {
                    let mut a = Vec3::from(line[0]);
                    let mut b = Vec3::from(line[1]);
                    // Clip lines crossing the camera plane before projecting their endpoints.
                    let aw = (vp * a.extend(1.0)).w;
                    let bw = (vp * b.extend(1.0)).w;
                    const NEAR_W: f32 = 0.1;
                    if aw <= NEAR_W && bw <= NEAR_W {
                        continue;
                    }
                    if aw <= NEAR_W {
                        a = a.lerp(b, (NEAR_W - aw) / (bw - aw));
                    } else if bw <= NEAR_W {
                        b = b.lerp(a, (NEAR_W - bw) / (aw - bw));
                    }
                    if let (Some((a, _)), Some((b, _))) = (project(a), project(b)) {
                        p.line_segment(
                            [a, b],
                            Stroke::new(1.0, Color32::from_rgba_unmultiplied(150, 160, 190, 33)),
                        );
                    }
                }
            }
            p.extend(shapes.drain(..).map(|(_, shape)| shape));
        }
        let output = self.context.end_pass();
        let mut frame = BoardFrame {
            primitives: self.context.tessellate(output.shapes, 1.0),
            textures: output.textures_delta,
        };
        if !capture {
            self.hits = hits;
        }
        let mut pixels = self.raster.render(&mut frame, width, height);
        let material_hits = material_frame.paint(
            &mut pixels, width, light, camera.eye(), options.daylight.unwrap_or(1.0), capture,
        );
        if !capture {
            self.material_hits = material_hits;
        }
        if let Some((waters, terrains, revision, transforms)) = saved_cache {
            self.waters = waters;
            self.terrains = terrains;
            self.terrain_revision = revision;
            self.terrain_transforms = transforms;
        }
        pixels
    }
}

fn rgb_color(rgb: Vec3, alpha: f32) -> Color32 {
    let rgb = rgb.clamp(Vec3::ZERO, Vec3::ONE) * 255.0;
    Color32::from_rgba_unmultiplied(
        rgb.x as u8,
        rgb.y as u8,
        rgb.z as u8,
        (alpha.clamp(0.0, 1.0) * 255.0) as u8,
    )
}
