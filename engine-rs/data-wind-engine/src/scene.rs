//! 场景数据：GPU 实例构建、登录页程序化城市。

use crate::common::{Fence, GInstance, Marker, Ring};
use crate::terrain::{MAX_TERRAINS, TerrainSurface};
use crate::water::{MAX_SHALLOW, MAX_WATERS, SIM_RESOLUTION, WaterConfig};
use glam::{EulerRot, Quat, Vec3};
use std::sync::Arc;

pub use crate::common::FlatInstanceIn;

/// 盒体拾取元数据。
pub struct PickBox {
    pub id: String,
    pub model_id: Option<String>,
    pub center: Vec3,
    pub half: Vec3,
    pub rot_y: f32,
    pub rotation: Quat,
    pub locked: bool,
}

/// 标记点拾取元数据。
pub struct PickMarker {
    pub id: String,
    pub center: Vec3,
}

pub struct ScenePools {
    pub instances: Vec<GInstance>,
    pub mesh_draws: Vec<(String, u32)>,
    pub markers: Vec<Marker>,
    pub fences: Vec<Fence>,
    pub arcs: Vec<oxgpu::Arc>,
    pub pick_boxes: Vec<PickBox>,
    pub pick_markers: Vec<PickMarker>,
    /// 视锥剔除包围球（与 instances 一一对应）
    pub cull_spheres: Vec<oxgpu::BoundingSphere>,
    pub terrains: Vec<TerrainDraw>,
    pub waters: Vec<WaterDraw>,
}

#[derive(Clone)]
pub struct TerrainDraw {
    pub id: String,
    pub index: u32,
    pub surface: Arc<TerrainSurface>,
}

#[derive(Clone, PartialEq)]
struct BedStamp {
    surface: usize,
    transform: [[f32; 4]; 3],
}

#[derive(Clone)]
pub struct WaterDraw {
    pub id: String,
    pub index: u32,
    pub config: WaterConfig,
    pub size: [f32; 3],
    pub bed: Arc<Vec<f32>>,
    pub picking: Option<Arc<crate::water::WaterPicking>>,
    pub center: [f32; 3],
    rotation: [f32; 4],
    terrain_stamps: Vec<BedStamp>,
}

impl TerrainDraw {
    pub fn triangles(&self) -> u32 {
        64 * 64 * 2 + (self.surface.config.levels - 1) * 64 * 64 * 2 * 3 / 4
    }
}

pub const MAX_BOXES: usize = 1024;
pub const MAX_MARKERS: usize = 128;
pub const MAX_FENCES: usize = 32;

impl ScenePools {
    pub fn empty() -> Self {
        Self {
            instances: Vec::new(),
            mesh_draws: Vec::new(),
            markers: Vec::new(),
            fences: Vec::new(),
            arcs: Vec::new(),
            pick_boxes: Vec::new(),
            pick_markers: Vec::new(),
            cull_spheres: Vec::new(),
            terrains: Vec::new(),
            waters: Vec::new(),
        }
    }

    /// 从前端 flat 实例构建 GPU 数据。
    pub fn from_flat(flat: &[FlatInstanceIn]) -> Self {
        Self::from_flat_cached(flat, &[])
    }

    pub fn from_flat_cached(flat: &[FlatInstanceIn], previous: &[TerrainDraw]) -> Self {
        Self::from_flat_with_water(flat, previous, &[])
    }

    pub fn from_flat_with_water(
        flat: &[FlatInstanceIn],
        previous: &[TerrainDraw],
        previous_water: &[WaterDraw],
    ) -> Self {
        let mut pools = Self::empty();
        for inst in flat {
            let color = [
                inst.color[0].clamp(0.0, 1.0),
                inst.color[1].clamp(0.0, 1.0),
                inst.color[2].clamp(0.0, 1.0),
                1.0,
            ];
            match inst.kind.as_str() {
                "box" | "mesh" | "terrain" | "water" => {
                    if pools.instances.len() >= MAX_BOXES {
                        continue;
                    }
                    if inst.kind == "terrain" && pools.terrains.len() >= MAX_TERRAINS {
                        continue;
                    }
                    if inst.kind == "water"
                        && (pools.waters.len() >= MAX_WATERS
                            || (inst.water.as_ref().is_some_and(|c| c.preset == "shallow")
                                && pools
                                    .waters
                                    .iter()
                                    .filter(|d| d.config.preset == "shallow")
                                    .count()
                                    >= MAX_SHALLOW))
                    {
                        continue;
                    }
                    let idx = pools.instances.len() as f32 + 1.0;
                    let half = [inst.size[0] * 0.5, inst.size[1] * 0.5, inst.size[2] * 0.5];
                    let mut color = color;
                    if inst.kind == "terrain" {
                        color[3] = 0.0;
                        let config = inst.terrain.clone().unwrap_or_default();
                        let surface = previous
                            .iter()
                            .find(|draw| draw.id == inst.id && draw.surface.config == config)
                            .map_or_else(
                                || Arc::new(TerrainSurface::new(config)),
                                |draw| draw.surface.clone(),
                            );
                        pools.terrains.push(TerrainDraw {
                            id: inst.id.clone(),
                            index: pools.instances.len() as u32,
                            surface,
                        });
                    }
                    if inst.kind == "water" {
                        color[3] = 0.0;
                        pools.waters.push(WaterDraw {
                            id: inst.id.clone(),
                            index: pools.instances.len() as u32,
                            config: inst.water.clone().unwrap_or_default(),
                            size: inst.size,
                            center: inst.pos,
                            rotation: [0.0, 0.0, 0.0, 1.0],
                            bed: Arc::new(Vec::new()),
                            picking: None,
                            terrain_stamps: Vec::new(),
                        });
                    }
                    if let Some(id) = inst.model_id.as_ref().filter(|_| inst.kind == "mesh") {
                        color[3] = 0.0;
                        pools
                            .mesh_draws
                            .push((id.clone(), pools.instances.len() as u32));
                    }
                    let angles = inst.rotation.unwrap_or([0.0, inst.rot_y, 0.0]);
                    let rotation = Quat::from_euler(EulerRot::YXZ, angles[1], angles[0], angles[2]);
                    pools.instances.push(GInstance {
                        center_rot: [inst.pos[0], inst.pos[1], inst.pos[2], inst.rot_y],
                        half_sel: [half[0], half[1], half[2], idx],
                        color,
                        rotation: rotation.to_array(),
                    });
                    let radius =
                        (half[0] * half[0] + half[1] * half[1] + half[2] * half[2]).sqrt() + 0.2;
                    pools.pick_boxes.push(PickBox {
                        id: inst.id.clone(),
                        model_id: inst.model_id.clone().filter(|_| inst.kind == "mesh"),
                        center: Vec3::from_array(inst.pos),
                        half: Vec3::from_array(half),
                        rot_y: inst.rot_y,
                        rotation,
                        locked: inst.locked.unwrap_or(false),
                    });
                    pools.cull_spheres.push(oxgpu::BoundingSphere {
                        center: [inst.pos[0], inst.pos[1], inst.pos[2], radius],
                        index: pools.instances.len() as u32 - 1,
                        _pad: [0, 0, 0],
                    });
                }
                "marker" => {
                    if pools.markers.len() >= MAX_MARKERS {
                        continue;
                    }
                    pools.markers.push(Marker {
                        pos_phase: [
                            inst.pos[0],
                            inst.pos[1],
                            inst.pos[2],
                            pools.markers.len() as f32 * 1.7,
                        ],
                        color,
                    });
                    pools.pick_markers.push(PickMarker {
                        id: inst.id.clone(),
                        center: Vec3::from_array(inst.pos),
                    });
                }
                "flyline" => {
                    if pools.arcs.len() >= 64 {
                        continue;
                    }
                    let to = inst.to.unwrap_or([
                        inst.pos[0] + 18.0,
                        inst.pos[1] + 2.0,
                        inst.pos[2] + 12.0,
                    ]);
                    let a = Vec3::from_array(inst.pos);
                    let c = Vec3::from_array(to);
                    let len = (c - a).length();
                    let b = (a + c) * 0.5 + Vec3::Y * (len * 0.35 + 2.0);
                    pools.arcs.push(oxgpu::Arc {
                        a: [a.x, a.y, a.z, 0.0],
                        b: [b.x, b.y, b.z, 0.0],
                        c: [c.x, c.y, c.z, 0.0],
                        color,
                        _count: 0,
                        _pad: [0, 0, 0],
                    });
                }
                "fence" => {
                    if pools.fences.len() >= MAX_FENCES {
                        continue;
                    }
                    pools.fences.push(Fence {
                        center: [
                            inst.pos[0],
                            0.0,
                            inst.pos[2],
                            pools.fences.len() as f32 * 1.3,
                        ],
                        half: [inst.size[0] * 0.5, inst.size[2] * 0.5, 0.0, 0.0],
                        color,
                    });
                }
                _ => {}
            }
        }
        let stamps: Vec<_> = pools
            .terrains
            .iter()
            .map(|draw| {
                let instance = pools.instances[draw.index as usize];
                BedStamp {
                    surface: Arc::as_ptr(&draw.surface) as usize,
                    transform: [instance.center_rot, instance.half_sel, instance.rotation],
                }
            })
            .collect();
        for draw in &mut pools.waters {
            let instance = pools.instances[draw.index as usize];
            draw.rotation = instance.rotation;
            let previous = previous_water.iter().find(|p| p.id == draw.id);
            let same_shape = previous.is_some_and(|p| {
                p.config.preset == draw.config.preset
                    && p.config.points == draw.config.points
                    && p.config.river_width == draw.config.river_width
                    && p.size == draw.size
            });
            draw.picking = if same_shape {
                previous.and_then(|p| p.picking.clone())
            } else {
                let mut config = draw.config.clone();
                config.wave_height = 0.0;
                crate::water::WaterPicking::new(
                    crate::water::software_mesh(&config, draw.size, 0.0, None)
                        .iter()
                        .map(|v| v.position),
                )
                .map(Arc::new)
            };
            let same_bed = previous.is_some_and(|p| {
                p.config.preset == draw.config.preset
                    && p.size == draw.size
                    && p.center == draw.center
                    && p.rotation == draw.rotation
                    && p.config.initial_depth == draw.config.initial_depth
                    && p.terrain_stamps == stamps
            });
            draw.bed = if same_bed {
                previous.map(|p| p.bed.clone()).unwrap_or_default()
            } else {
                let bed = crate::water::build_bed(
                    &draw.config,
                    draw.size,
                    Vec3::from(draw.center),
                    Quat::from_array(instance.rotation),
                    pools.terrains.iter().map(|t| {
                        let item = &pools.pick_boxes[t.index as usize];
                        (t.surface.as_ref(), item.center, item.half, item.rotation)
                    }),
                    SIM_RESOLUTION,
                );
                Arc::new(bed)
            };
            draw.terrain_stamps = stamps.clone();
        }
        pools
    }

    pub(crate) fn cull_spheres_push(&mut self, s: oxgpu::BoundingSphere) {
        self.cull_spheres.push(s);
    }

    /// 登录页程序化城市：白色组团 + 中央高塔。
    pub fn login_city() -> (Self, Vec<Ring>) {
        let mut pools = Self::empty();
        let hash = |i: u32| -> f32 {
            let x = (i as f32 * 12.9898).sin() * 43758.5453;
            x - x.floor()
        };
        let mut i = 0u32;
        let mut gx = -30.0f32;
        while gx <= 30.0 {
            let mut gz = -30.0f32;
            while gz <= 30.0 {
                i += 1;
                let r2 = gx * gx + gz * gz;
                if r2 < 64.0 {
                    gz += 6.0;
                    continue; // 中央广场
                }
                if hash(i * 7 + 3) < 0.25 {
                    gz += 6.0;
                    continue;
                }
                if pools.instances.len() >= MAX_BOXES - 1 {
                    break;
                }
                let height = (1.5 + hash(i) * 7.0) * (1.0 + 6.0 * (-r2 as f32 / 500.0).exp());
                let width = 2.5 + hash(i * 3) * 2.5;
                let depth = 2.5 + hash(i * 5) * 2.5;
                let shade = 0.92 + hash(i * 11) * 0.07;
                let tint_b = 0.97 + hash(i * 13) * 0.03;
                let idx = pools.instances.len() as f32 + 1.0;
                pools.instances.push(GInstance {
                    center_rot: [gx, height * 0.5, gz, 0.0],
                    half_sel: [width * 0.5, height * 0.5, depth * 0.5, idx],
                    color: [shade, shade, shade * tint_b, 1.0],
                    rotation: [0.0, 0.0, 0.0, 1.0],
                });
                let radius = (width * width + height * height + depth * depth).sqrt() * 0.5 + 0.2;
                pools.cull_spheres_push(oxgpu::BoundingSphere {
                    center: [gx, height * 0.5, gz, radius],
                    index: pools.instances.len() as u32 - 1,
                    _pad: [0, 0, 0],
                });
                pools.pick_boxes.push(PickBox {
                    id: format!("login-city-{i}"),
                    model_id: None,
                    center: Vec3::new(gx, height * 0.5, gz),
                    half: Vec3::new(width * 0.5, height * 0.5, depth * 0.5),
                    rot_y: 0.0,
                    rotation: Quat::IDENTITY,
                    locked: false,
                });
                gz += 6.0;
            }
            gx += 6.0;
        }
        // 中央塔
        pools.instances.push(GInstance {
            center_rot: [0.0, 5.0, 0.0, 0.0],
            half_sel: [3.0, 5.0, 3.0, pools.instances.len() as f32 + 1.0],
            color: [0.78, 0.80, 0.92, 1.0],
            rotation: [0.0, 0.0, 0.0, 1.0],
        });
        pools.cull_spheres_push(oxgpu::BoundingSphere {
            center: [0.0, 5.0, 0.0, 6.6],
            index: pools.instances.len() as u32 - 1,
            _pad: [0, 0, 0],
        });
        pools.pick_boxes.push(PickBox {
            id: "login-tower".into(),
            model_id: None,
            center: Vec3::new(0.0, 5.0, 0.0),
            half: Vec3::new(3.0, 5.0, 3.0),
            rot_y: 0.0,
            rotation: Quat::IDENTITY,
            locked: false,
        });

        let rings = vec![
            Ring {
                center: [0.0, 8.0, 0.0, 0.25],
                color_radius: [1.0, 0.45, 0.45, 8.5],
            },
            Ring {
                center: [0.0, 8.0, 0.0, -0.18],
                color_radius: [0.35, 0.82, 0.45, 10.5],
            },
            Ring {
                center: [0.0, 8.0, 0.0, 0.13],
                color_radius: [0.35, 0.6, 1.0, 12.5],
            },
        ];
        (pools, rings)
    }
}

// ScenePools 需要持有剔除球列表
impl ScenePools {
    pub fn take_cull_spheres(&mut self) -> Vec<oxgpu::BoundingSphere> {
        std::mem::take(&mut self.cull_spheres)
    }
}
