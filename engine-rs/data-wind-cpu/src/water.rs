//! Static water geometry, source masks and a conservative shallow-water reference solver.
//! The production WebGPU implementation runs the same two virtual-pipe passes on the GPU.
pub use crate::common::WaterConfig;
use crate::mesh::ModelVertex;
pub use crate::picking::MeshPicking as WaterPicking;
use glam::{Vec2, Vec3};

pub const MAX_WATERS: usize = 16;
pub const MAX_SHALLOW: usize = 4;
pub const SIM_RESOLUTION: usize = 64;

/// Shared by all bodies. Vertex UVs also parameterize the river centre line.
pub fn grid_mesh(cells: u32) -> (Vec<[f32; 2]>, Vec<u32>) {
    let vertices = (0..=cells)
        .flat_map(|z| (0..=cells).map(move |x| [x as f32 / cells as f32, z as f32 / cells as f32]))
        .collect();
    let mut indices = Vec::with_capacity((cells * cells * 6) as usize);
    for z in 0..cells {
        for x in 0..cells {
            let a = z * (cells + 1) + x;
            indices.extend([a, a + cells + 1, a + 1, a + 1, a + cells + 1, a + cells + 2]);
        }
    }
    (vertices, indices)
}

pub fn river_points(config: &WaterConfig, size: [f32; 3]) -> Vec<[f32; 4]> {
    let mut length = 0.0;
    let mut points = Vec::with_capacity(config.points.len());
    for (index, p) in config.points.iter().enumerate() {
        if index > 0 {
            let a = config.points[index - 1];
            length += Vec2::new((p[0] - a[0]) * size[0], (p[1] - a[1]) * size[2]).length();
        }
        points.push([p[0], p[1], length, 0.0]);
    }
    for p in &mut points {
        p[2] /= length.max(0.0001);
    }
    points
}

pub fn surface_xz(config: &WaterConfig, size: [f32; 3], uv: Vec2) -> Vec2 {
    if config.preset != "river" {
        return (uv - Vec2::splat(0.5)) * Vec2::new(size[0], size[2]);
    }
    let points = river_points(config, size);
    river_xz(&points, config.river_width, size, uv)
}
fn river_xz(points: &[[f32; 4]], width: f32, size: [f32; 3], uv: Vec2) -> Vec2 {
    let index = (1..points.len())
        .find(|&i| uv.y <= points[i][2])
        .unwrap_or(points.len() - 1);
    let a = points[index - 1];
    let b = points[index];
    let t = ((uv.y - a[2]) / (b[2] - a[2]).max(0.0001)).clamp(0.0, 1.0);
    let p =
        Vec2::new(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t) * Vec2::new(size[0], size[2]);
    let tangent = Vec2::new((b[0] - a[0]) * size[0], (b[1] - a[1]) * size[2]).normalize_or_zero();
    (p + Vec2::new(tangent.y, -tangent.x) * (uv.x - 0.5) * width * size[0].min(size[2])).clamp(
        -Vec2::new(size[0], size[2]) * 0.5,
        Vec2::new(size[0], size[2]) * 0.5,
    )
}

pub fn wave_height(config: &WaterConfig, p: Vec2, time: f32) -> f32 {
    let angle = config.direction.to_radians();
    let direction = Vec2::new(angle.cos(), angle.sin());
    let phase = p.dot(direction) * std::f32::consts::TAU / config.wave_length
        - time * config.wave_speed * 1.6;
    config.wave_height
        * (0.6 * phase.sin()
            + 0.28 * (phase * 1.73 + 1.8).sin()
            + 0.12 * (phase * 3.1 - time * config.wave_speed * 0.7).sin())
}

/// Return a source field in m³/s per cell. Normalize each clipped footprint, including corners.
pub fn source_field(config: &WaterConfig, size: [f32; 3], n: usize) -> Vec<f32> {
    let mut rates = vec![0.0; n * n];
    for source in &config.sources {
        let radius = source[3] * size[0].min(size[2]);
        let mut weights = vec![0.0; n * n];
        for z in 0..n {
            for x in 0..n {
                let delta = Vec2::new(
                    (x as f32 / (n - 1) as f32 - 0.5 - source[0]) * size[0],
                    (z as f32 / (n - 1) as f32 - 0.5 - source[1]) * size[2],
                );
                weights[z * n + x] =
                    (1.0 - delta.length_squared() / (radius * radius).max(0.00001)).max(0.0);
            }
        }
        let total = weights.iter().sum::<f32>();
        if total <= 0.0 {
            let x = ((source[0] + 0.5) * (n - 1) as f32).round() as usize;
            let z = ((source[1] + 0.5) * (n - 1) as f32).round() as usize;
            rates[z.min(n - 1) * n + x.min(n - 1)] += source[2];
        }
        if total > 0.0 {
            for (rate, weight) in rates.iter_mut().zip(weights) {
                *rate += source[2] * weight / total;
            }
        }
    }
    rates
}

#[derive(Clone)]
pub struct ShallowWater {
    /// h (depth), bed (relative to initial surface), velocity X/Z.
    pub cells: Vec<[f32; 4]>,
    pub flux: Vec<[f32; 4]>,
    next: Vec<[f32; 4]>,
    pub rates: Vec<f32>,
    pub n: usize,
    pub spacing: Vec2,
}
impl ShallowWater {
    pub fn new(config: &WaterConfig, size: [f32; 3], bed: Vec<f32>, n: usize) -> Self {
        let cells: Vec<_> = bed
            .into_iter()
            .map(|b| [(-b).max(0.0), b, 0.0, 0.0])
            .collect();
        Self {
            next: cells.clone(),
            cells,
            flux: vec![[0.0; 4]; n * n],
            rates: source_field(config, size, n),
            n,
            spacing: Vec2::new(size[0], size[2]) / (n - 1) as f32,
        }
    }
    /// Fixed work, no traversal or mesh rebuild in the GPU path. Reflecting domain boundaries.
    pub fn step(&mut self, dt: f32) {
        let dt = dt.clamp(0.0, 0.025).min(self.spacing.min_element() * 0.02);
        if dt <= 0.0 {
            return;
        }
        let area = self.spacing.x * self.spacing.y;
        for z in 0..self.n {
            for x in 0..self.n {
                let i = z * self.n + x;
                let cell = self.cells[i];
                let mut flow = [0.0; 4];
                for (d, (dx, dz)) in [(-1, 0), (1, 0), (0, -1), (0, 1)].iter().enumerate() {
                    let nx = x as i32 + dx;
                    let nz = z as i32 + dz;
                    if nx < 0 || nz < 0 || nx >= self.n as i32 || nz >= self.n as i32 {
                        continue;
                    }
                    let other = self.cells[nz as usize * self.n + nx as usize];
                    let ratio = if d < 2 {
                        self.spacing.y / self.spacing.x
                    } else {
                        self.spacing.x / self.spacing.y
                    };
                    let wet = (cell[0] + cell[1] - cell[1].max(other[1])).max(0.0);
                    flow[d] = (self.flux[i][d] * (-dt * 0.8).exp()
                        + dt * 9.81 * wet * ratio * (cell[0] + cell[1] - other[0] - other[1]))
                        .max(0.0);
                }
                let scale =
                    (cell[0] * area / (dt * flow.iter().sum::<f32>()).max(0.0000001)).min(1.0);
                self.flux[i] = flow.map(|v| v * scale);
            }
        }
        for z in 0..self.n {
            for x in 0..self.n {
                let i = z * self.n + x;
                let incoming = [
                    if x > 0 { self.flux[i - 1][1] } else { 0.0 },
                    if x + 1 < self.n {
                        self.flux[i + 1][0]
                    } else {
                        0.0
                    },
                    if z > 0 { self.flux[i - self.n][3] } else { 0.0 },
                    if z + 1 < self.n {
                        self.flux[i + self.n][2]
                    } else {
                        0.0
                    },
                ];
                let outgoing = self.flux[i];
                let h = (self.cells[i][0]
                    + dt / area
                        * (incoming.iter().sum::<f32>() - outgoing.iter().sum::<f32>()
                            + self.rates[i]))
                    .max(0.0);
                let velocity = Vec2::new(
                    incoming[0] + outgoing[1] - incoming[1] - outgoing[0],
                    incoming[2] + outgoing[3] - incoming[3] - outgoing[2],
                ) / (Vec2::new(self.spacing.y, self.spacing.x) * h.max(0.01) * 2.0);
                self.next[i] = [
                    h,
                    self.cells[i][1],
                    velocity.x.clamp(-20.0, 20.0),
                    velocity.y.clamp(-20.0, 20.0),
                ];
            }
        }
        std::mem::swap(&mut self.cells, &mut self.next);
    }
    pub fn height(&self, uv: Vec2) -> (f32, f32) {
        let p = uv.clamp(Vec2::ZERO, Vec2::ONE) * (self.n - 1) as f32;
        let x = p.x as usize;
        let z = p.y as usize;
        let c = self.cells[z * self.n + x];
        (c[0] + c[1], c[0])
    }
}

pub fn software_mesh(
    config: &WaterConfig,
    size: [f32; 3],
    time: f32,
    simulation: Option<&ShallowWater>,
) -> Vec<ModelVertex> {
    let (vertices, indices) = grid_mesh(24);
    let mut mesh = Vec::with_capacity(indices.len());
    let path = river_points(config, size);
    for triangle in indices.chunks_exact(3) {
        let uv: Vec<Vec2> = triangle
            .iter()
            .map(|&i| Vec2::from(vertices[i as usize]))
            .collect();
        if config.preset == "lake" && uv.iter().all(|p| (*p - Vec2::splat(0.5)).length() > 0.5) {
            continue;
        }
        let mut positions = [Vec3::ZERO; 3];
        let mut wet = false;
        for j in 0..3 {
            let p = if config.preset == "river" {
                river_xz(&path, config.river_width, size, uv[j])
            } else {
                (uv[j] - Vec2::splat(0.5)) * Vec2::new(size[0], size[2])
            };
            let (height, depth) = simulation.map_or((0.0, 1.0), |s| s.height(uv[j]));
            wet |= depth > 0.002;
            let h = height + wave_height(config, p, time) * size[1] * 0.5 * depth.min(1.0);
            positions[j] = Vec3::new(p.x / size[0], h / size[1], p.y / size[2]);
        }
        if !wet {
            continue;
        }
        let normal = ((positions[1] - positions[0]) * Vec3::from(size))
            .cross((positions[2] - positions[0]) * Vec3::from(size))
            .normalize_or_zero();
        for p in positions {
            mesh.push(ModelVertex {
                position: p.to_array(),
                normal: normal.to_array(),
                color: [1.0; 3],
            });
        }
    }
    mesh
}

/// Sample along the body's local vertical axis.
/// Rotated terrain uses its cached collision mesh.
pub fn build_bed<'a>(
    config: &WaterConfig,
    size: [f32; 3],
    center: Vec3,
    rotation: glam::Quat,
    terrains: impl IntoIterator<Item = (&'a crate::terrain::TerrainSurface, Vec3, Vec3, glam::Quat)>,
    n: usize,
) -> Vec<f32> {
    let mut bed = vec![-config.initial_depth * size[1] * 0.5; n * n];
    if config.preset != "shallow" {
        return bed;
    }
    let terrains: Vec<_> = terrains.into_iter().collect();
    let up = rotation * Vec3::Y;
    for z in 0..n {
        for x in 0..n {
            let local = Vec3::new(
                (x as f32 / (n - 1) as f32 - 0.5) * size[0],
                0.0,
                (z as f32 / (n - 1) as f32 - 0.5) * size[2],
            );
            let world = center + rotation * local;
            for &(terrain, position, half, terrain_rotation) in &terrains {
                let rise = ((position - world).dot(up) + half.length() + 1.0).max(1.0);
                if let Some(distance) = terrain.picking.as_ref().and_then(|p| {
                    p.ray_distance(world + up * rise, -up, position, half, terrain_rotation)
                }) {
                    bed[z * n + x] = bed[z * n + x].max(rise - distance);
                }
            }
        }
    }
    bed
}
