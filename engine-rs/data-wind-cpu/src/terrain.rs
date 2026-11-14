//! Height fields shared by GPU upload, coarse software rendering and ray picking.
//! Geometry is built only when the terrain changes, never when the camera moves.

pub use crate::common::TerrainConfig;
use crate::{mesh::ModelVertex, picking::MeshPicking};
use glam::{Vec2, Vec3};

pub const MAX_TERRAINS: usize = 16;
pub const GRID_CELLS: u32 = 64;
pub const HEIGHT_RESOLUTION: u32 = 257;

pub struct TerrainSurface {
    pub config: TerrainConfig,
    pub resolution: u32,
    pub heights: Vec<f32>,
    /// 32 × 32 cells for software fallback; independent of the GPU clipmap mesh.
    pub mesh: Vec<ModelVertex>,
    pub picking: Option<MeshPicking>,
}

impl TerrainSurface {
    pub fn new(config: TerrainConfig) -> Self {
        let custom = config.resolution > 0
            && config.resolution <= HEIGHT_RESOLUTION
            && config.heights.len() == (config.resolution * config.resolution) as usize;
        let resolution = if custom {
            config.resolution
        } else {
            HEIGHT_RESOLUTION
        };
        let mut heights = Vec::with_capacity((resolution * resolution) as usize);
        for z in 0..resolution {
            for x in 0..resolution {
                heights.push(if custom {
                    f32::from(config.heights[(z * resolution + x) as usize]) / 65_535.0
                } else {
                    procedural_height(
                        &config,
                        Vec2::new(x as f32, z as f32) / (resolution - 1) as f32,
                    )
                });
            }
        }
        let mut surface = Self {
            config,
            resolution,
            heights,
            mesh: Vec::new(),
            picking: None,
        };
        surface.mesh = surface.build_mesh(32);
        // Picking uses a finer, static height field. It never uses the camera-dependent rings.
        surface.picking = MeshPicking::new(surface.build_mesh(64).iter().map(|v| v.position));
        surface
    }

    pub fn sample(&self, uv: Vec2) -> f32 {
        let p = uv.clamp(Vec2::ZERO, Vec2::ONE) * (self.resolution - 1) as f32;
        let x = p.x.floor() as u32;
        let z = p.y.floor() as u32;
        let fetch = |x: u32, z: u32| {
            self.heights[(z.min(self.resolution - 1) * self.resolution + x.min(self.resolution - 1))
                as usize]
        };
        let a = fetch(x, z) + (fetch(x + 1, z) - fetch(x, z)) * p.x.fract();
        let b = fetch(x, z + 1) + (fetch(x + 1, z + 1) - fetch(x, z + 1)) * p.x.fract();
        a + (b - a) * p.y.fract()
    }

    pub fn material_color(&self, height: f32, normal_up: f32, tint: Vec3) -> Vec3 {
        let slope = 1.0 - normal_up.abs().clamp(0.0, 1.0);
        let rock = smooth(0.18, 0.55, slope);
        let snow = smooth(self.config.snow_line, self.config.snow_line + 0.08, height)
            * (1.0 - smooth(0.35, 0.65, slope));
        tint.lerp(Vec3::from(self.config.rock_color), rock)
            .lerp(Vec3::from(self.config.snow_color), snow)
    }

    fn build_mesh(&self, cells: u32) -> Vec<ModelVertex> {
        let mut mesh = Vec::with_capacity((cells * cells * 6) as usize);
        let position = |x: u32, z: u32| {
            let uv = Vec2::new(x as f32, z as f32) / cells as f32;
            Vec3::new(uv.x - 0.5, self.sample(uv) - 0.5, uv.y - 0.5)
        };
        for z in 0..cells {
            for x in 0..cells {
                let corners = [
                    position(x, z),
                    position(x, z + 1),
                    position(x + 1, z + 1),
                    position(x + 1, z),
                ];
                for indices in [[0, 1, 2], [0, 2, 3]] {
                    let normal = (corners[indices[1]] - corners[indices[0]])
                        .cross(corners[indices[2]] - corners[indices[0]])
                        .normalize_or_zero();
                    for index in indices {
                        let position = corners[index];
                        mesh.push(ModelVertex {
                            position: position.to_array(),
                            normal: normal.to_array(),
                            color: [1.0; 3],
                        });
                    }
                }
            }
        }
        mesh
    }
}

fn smooth(start: f32, end: f32, value: f32) -> f32 {
    let t = ((value - start) / (end - start)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

fn hash(x: i32, y: i32, seed: u32) -> f32 {
    let mut value = (x as u32).wrapping_mul(374_761_393)
        ^ (y as u32).wrapping_mul(668_265_263)
        ^ seed.wrapping_mul(2_654_435_761);
    value = (value ^ (value >> 13)).wrapping_mul(1_274_126_177);
    (value ^ (value >> 16)) as f32 / u32::MAX as f32
}

fn noise(p: Vec2, seed: u32) -> f32 {
    let x = p.x.floor() as i32;
    let y = p.y.floor() as i32;
    let f = p - p.floor();
    let f = f * f * (Vec2::splat(3.0) - 2.0 * f);
    let a = hash(x, y, seed) + (hash(x + 1, y, seed) - hash(x, y, seed)) * f.x;
    let b = hash(x, y + 1, seed) + (hash(x + 1, y + 1, seed) - hash(x, y + 1, seed)) * f.x;
    a + (b - a) * f.y
}

fn procedural_height(config: &TerrainConfig, uv: Vec2) -> f32 {
    if config.preset == "flat" {
        return 0.0;
    }
    let mut sum = 0.0;
    let mut weight = 0.55;
    let mut p = uv * 4.0 + Vec2::splat(config.seed as f32 * 0.013);
    for octave in 0..5 {
        sum += noise(p, config.seed + octave) * weight;
        p = p * 2.03 + Vec2::new(7.1, 3.7);
        weight *= 0.48;
    }
    let value = match config.preset.as_str() {
        "mountains" | "snow" => (1.0 - (2.0 * sum - 1.0).abs()).powi(2),
        "dunes" => {
            0.30 + 0.27 * (uv.x * 35.0 + uv.y * 16.0 + noise(uv * 3.0, config.seed) * 5.0).sin()
                + sum * 0.24
        }
        _ => sum * 0.85,
    };
    let edge = uv.x.min(uv.y).min(1.0 - uv.x).min(1.0 - uv.y);
    (value * smooth(0.0, 0.10, edge)).clamp(0.0, 1.0)
}

/// A fixed 65 × 65 grid, with a central square removed for every outer level.
/// Both meshes share one vertex buffer. Ring instance_index is the LOD level.
pub fn clipmap_mesh() -> (Vec<[f32; 2]>, Vec<u32>, Vec<u32>) {
    let mut vertices = Vec::with_capacity(((GRID_CELLS + 1).pow(2)) as usize);
    let mut center = Vec::with_capacity((GRID_CELLS * GRID_CELLS * 6) as usize);
    let mut ring = Vec::with_capacity((GRID_CELLS * GRID_CELLS * 6 * 3 / 4) as usize);
    for z in 0..=GRID_CELLS {
        for x in 0..=GRID_CELLS {
            vertices.push([x as f32 - 32.0, z as f32 - 32.0]);
        }
    }
    for z in 0..GRID_CELLS {
        for x in 0..GRID_CELLS {
            let a = z * (GRID_CELLS + 1) + x;
            let b = a + GRID_CELLS + 1;
            let indices = [a, b, b + 1, a, b + 1, a + 1];
            center.extend(indices);
            if !(16..48).contains(&x) || !(16..48).contains(&z) {
                ring.extend(indices);
            }
        }
    }
    (vertices, center, ring)
}

/// Reference of the WGSL ring coordinates, used to verify seams at snapped origins.
pub fn clipmap_position(vertex: Vec2, anchor: Vec2, spacing: f32, level: u32) -> Vec2 {
    let center = (anchor / (2.0 * spacing)).floor() * (2.0 * spacing);
    let radius = vertex.abs().max_element();
    let mut p = center + vertex * spacing;
    if level > 0 {
        let previous = (anchor / spacing).floor() * spacing;
        p += (previous - center) * ((24.0 - radius) / 8.0).clamp(0.0, 1.0);
    }
    let morph = smooth(
        24.0 * spacing,
        30.0 * spacing,
        (p - anchor).abs().max_element(),
    );
    let parent = (p / (2.0 * spacing) + Vec2::splat(0.5)).floor() * (2.0 * spacing);
    p.lerp(parent, morph)
}
