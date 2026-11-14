//! 引擎公共类型：帧参数 uniform、各类实例 storage 结构、网格构建、事件。

use bytemuck::{Pod, Zeroable};

#[path = "terrain_config.rs"]
mod terrain_config;
pub use terrain_config::TerrainConfig;
#[path = "water_config.rs"]
mod water_config;
pub use water_config::WaterConfig;

/// 帧级 uniform（WGSL `struct FrameParams`，384 字节）。
#[repr(C)]
#[derive(Copy, Clone, Pod, Zeroable, Debug)]
pub struct FrameParams {
    pub vp: [[f32; 4]; 4],
    pub view: [[f32; 4]; 4],
    pub proj: [[f32; 4]; 4],
    pub cam_pos: [f32; 4],
    /// x: time(s), y: mode(0=editor, 1=login), z: fog_start, w: fog_end
    pub misc: [f32; 4],
    /// x: selected(实例下标+1，0 表示无), 其余保留
    pub misc2: [f32; 4],
    pub background: [f32; 4],
    pub ground: [f32; 4],
    pub light: [f32; 4],
    pub light_color: [f32; 4],
    /// 方向光（阴影贴图）的正交视投影矩阵
    pub light_vp: [[f32; 4]; 4],
    /// x: 阴影启用(0/1), y: 深度偏移, z/w 保留
    pub shadow: [f32; 4],
}

/// 盒体实例（WGSL `struct GInstance`，64 字节）。
/// center_rot.w = rotY；half_sel.xyz = 半尺寸，half_sel.w = 实例下标+1（选中高亮）。
#[repr(C)]
#[derive(Copy, Clone, Pod, Zeroable, Debug)]
pub struct GInstance {
    pub center_rot: [f32; 4],
    pub half_sel: [f32; 4],
    pub color: [f32; 4],
    pub rotation: [f32; 4],
}

/// 标记点实例（32 字节）。
#[repr(C)]
#[derive(Copy, Clone, Pod, Zeroable, Debug)]
pub struct Marker {
    pub pos_phase: [f32; 4],
    pub color: [f32; 4],
}

/// 电子围栏实例（48 字节）。
#[repr(C)]
#[derive(Copy, Clone, Pod, Zeroable, Debug)]
pub struct Fence {
    pub center: [f32; 4],
    pub half: [f32; 4],
    pub color: [f32; 4],
}

/// 登录页轨道环（32 字节）。
#[repr(C)]
#[derive(Copy, Clone, Pod, Zeroable, Debug)]
pub struct Ring {
    pub center: [f32; 4],
    pub color_radius: [f32; 4],
}

/// 顶点格式：position + normal（各 f32×3）。
pub type MeshVertex = [f32; 6];

/// 单位立方体网格（36 顶点，面法线）。
pub fn box_mesh() -> Vec<MeshVertex> {
    let h = 0.5f32;
    let mut v = Vec::with_capacity(36);
    let face = |v: &mut Vec<MeshVertex>, quad: [[f32; 3]; 4], n: [f32; 3]| {
        for idx in [0usize, 1, 2, 0, 2, 3] {
            let p = quad[idx];
            v.push([p[0], p[1], p[2], n[0], n[1], n[2]]);
        }
    };
    // +Y / -Y
    face(
        &mut v,
        [[-h, h, -h], [h, h, -h], [h, h, h], [-h, h, h]],
        [0.0, 1.0, 0.0],
    );
    face(
        &mut v,
        [[-h, -h, h], [h, -h, h], [h, -h, -h], [-h, -h, -h]],
        [0.0, -1.0, 0.0],
    );
    // +X / -X
    face(
        &mut v,
        [[h, -h, -h], [h, h, -h], [h, h, h], [h, -h, h]],
        [1.0, 0.0, 0.0],
    );
    face(
        &mut v,
        [[-h, -h, h], [-h, h, h], [-h, h, -h], [-h, -h, -h]],
        [-1.0, 0.0, 0.0],
    );
    // +Z / -Z
    face(
        &mut v,
        [[h, -h, h], [h, h, h], [-h, h, h], [-h, -h, h]],
        [0.0, 0.0, 1.0],
    );
    face(
        &mut v,
        [[-h, -h, -h], [-h, h, -h], [h, h, -h], [h, -h, -h]],
        [0.0, 0.0, -1.0],
    );
    v
}

/// 单位八面体网格（标记点钻石造型，24 顶点）。
pub fn octa_mesh() -> Vec<MeshVertex> {
    let t = [0.0f32, 1.0, 0.0];
    let b = [0.0f32, -1.0, 0.0];
    let r = [
        [1.0f32, 0.0, 0.0],
        [0.0f32, 0.0, 1.0],
        [-1.0f32, 0.0, 0.0],
        [0.0f32, 0.0, -1.0],
    ];
    let mut v = Vec::with_capacity(24);
    let tri = |v: &mut Vec<MeshVertex>, a: [f32; 3], b: [f32; 3], c: [f32; 3]| {
        let n = {
            let e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
            let e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
            let n = [
                e1[1] * e2[2] - e1[2] * e2[1],
                e1[2] * e2[0] - e1[0] * e2[2],
                e1[0] * e2[1] - e1[1] * e2[0],
            ];
            let len = (n[0] * n[0] + n[1] * n[1] + n[2] * n[2]).sqrt();
            [n[0] / len, n[1] / len, n[2] / len]
        };
        for p in [a, b, c] {
            v.push([p[0], p[1], p[2], n[0], n[1], n[2]]);
        }
    };
    for i in 0..4 {
        let j = (i + 1) % 4;
        tri(&mut v, t, r[i], r[j]);
        tri(&mut v, b, r[j], r[i]);
    }
    v
}

/// 图元种类（与前端 shape 字段对应）。
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Shape {
    Box,
    Sphere,
    Cylinder,
    Cone,
    Torus,
}

impl Shape {
    pub fn from_str(s: &str) -> Shape {
        match s {
            "sphere" => Shape::Sphere,
            "cylinder" => Shape::Cylinder,
            "cone" => Shape::Cone,
            "torus" => Shape::Torus,
            _ => Shape::Box,
        }
    }
}

/// 球体：经纬网格，法线即单位方向。
pub fn sphere_mesh(segments: u32, stacks: u32) -> Vec<MeshVertex> {
    let r = 0.5f32;
    let mut v = Vec::new();
    let dir = |ix: u32, iy: u32| -> [f32; 3] {
        let phi = (ix as f32) / (segments as f32) * std::f32::consts::TAU;
        let theta = (iy as f32) / (stacks as f32) * std::f32::consts::PI;
        [
            theta.sin() * phi.cos(),
            theta.cos(),
            theta.sin() * phi.sin(),
        ]
    };
    for iy in 0..stacks {
        for ix in 0..segments {
            let a = dir(ix, iy);
            let b = dir(ix + 1, iy);
            let c = dir(ix + 1, iy + 1);
            let d = dir(ix, iy + 1);
            for p in [a, b, c, a, c, d] {
                v.push([p[0] * r, p[1] * r, p[2] * r, p[0], p[1], p[2]]);
            }
        }
    }
    v
}

/// 圆柱体：侧面 + 上下盖。
pub fn cylinder_mesh(segments: u32) -> Vec<MeshVertex> {
    let r = 0.5f32;
    let h = 0.5f32;
    let mut v = Vec::new();
    let pt = |ix: u32, y: f32| -> [f32; 3] {
        let a = (ix as f32) / (segments as f32) * std::f32::consts::TAU;
        [a.cos() * r, y, a.sin() * r]
    };
    // 侧面
    for ix in 0..segments {
        let (x0, z0) = {
            let a = (ix as f32) / (segments as f32) * std::f32::consts::TAU;
            (a.cos(), a.sin())
        };
        let (x1, z1) = {
            let a = ((ix + 1) as f32) / (segments as f32) * std::f32::consts::TAU;
            (a.cos(), a.sin())
        };
        let n = [x0.max(x1) * 0.0 + (x0 + x1) * 0.5, 0.0, (z0 + z1) * 0.5];
        let len = (n[0] * n[0] + n[2] * n[2]).sqrt();
        let n = [n[0] / len, 0.0, n[2] / len];
        let p00 = pt(ix, -h);
        let p10 = pt(ix + 1, -h);
        let p11 = pt(ix + 1, h);
        let p01 = pt(ix, h);
        for (p, n) in [(p00, n), (p10, n), (p11, n), (p00, n), (p11, n), (p01, n)] {
            v.push([p[0], p[1], p[2], n[0], n[1], n[2]]);
        }
    }
    // 盖面
    for (y, ny) in [(-h, -1.0f32), (h, 1.0f32)] {
        let center = [0.0, y, 0.0];
        for ix in 0..segments {
            let p0 = pt(ix, y);
            let p1 = pt(ix + 1, y);
            let tri: [[f32; 3]; 3] = if ny > 0.0 {
                [center, p0, p1]
            } else {
                [center, p1, p0]
            };
            for p in tri {
                v.push([p[0], p[1], p[2], 0.0, ny, 0.0]);
            }
        }
    }
    v
}

/// 圆锥体：底面 + 斜面。
pub fn cone_mesh(segments: u32) -> Vec<MeshVertex> {
    let r = 0.5f32;
    let mut v = Vec::new();
    let base = |ix: u32| -> [f32; 3] {
        let a = (ix as f32) / (segments as f32) * std::f32::consts::TAU;
        [a.cos() * r, -0.5, a.sin() * r]
    };
    let apex = [0.0f32, 0.5, 0.0];
    // 斜面（法线取斜率近似）
    for ix in 0..segments {
        let p0 = base(ix);
        let p1 = base(ix + 1);
        let (x0, z0) = (p0[0], p0[2]);
        let (x1, z1) = (p1[0], p1[2]);
        let n = {
            let raw = [(x0 + x1) * 0.5, 0.35, (z0 + z1) * 0.5];
            let len = (raw[0] * raw[0] + raw[1] * raw[1] + raw[2] * raw[2]).sqrt();
            [raw[0] / len, raw[1] / len, raw[2] / len]
        };
        for p in [apex, p1, p0] {
            v.push([p[0], p[1], p[2], n[0], n[1], n[2]]);
        }
    }
    // 底面
    for ix in 0..segments {
        let p0 = base(ix);
        let p1 = base(ix + 1);
        for p in [[0.0, -0.5, 0.0], p1, p0] {
            v.push([p[0], p[1], p[2], 0.0, -1.0, 0.0]);
        }
    }
    v
}

/// 圆环体：主环 × 管截面。
pub fn torus_mesh(main_segments: u32, tube_segments: u32) -> Vec<MeshVertex> {
    let r_main = 0.35f32;
    let r_tube = 0.15f32;
    let mut v = Vec::new();
    let point = |iu: u32, iv: u32| -> ([f32; 3], [f32; 3]) {
        let u = (iu as f32) / (main_segments as f32) * std::f32::consts::TAU;
        let w = (iv as f32) / (tube_segments as f32) * std::f32::consts::TAU;
        let cu = u.cos();
        let su = u.sin();
        let cw = w.cos();
        let sw = w.sin();
        let center = [cu * r_main, 0.0, su * r_main];
        let normal = [cu * cw, sw, su * cw];
        let p = [
            center[0] + normal[0] * r_tube,
            center[1] + normal[1] * r_tube,
            center[2] + normal[2] * r_tube,
        ];
        (p, normal)
    };
    for iu in 0..main_segments {
        for iv in 0..tube_segments {
            let (a, na) = point(iu, iv);
            let (b, nb) = point(iu + 1, iv);
            let (c, nc) = point(iu + 1, iv + 1);
            let (d, nd) = point(iu, iv + 1);
            for (p, n) in [(a, na), (b, nb), (c, nc), (a, na), (c, nc), (d, nd)] {
                v.push([p[0], p[1], p[2], n[0], n[1], n[2]]);
            }
        }
    }
    v
}

/// 地面四边形（6 顶点，世界坐标）。
pub fn ground_mesh(extent: f32) -> Vec<[f32; 3]> {
    vec![
        [-extent, 0.0, -extent],
        [extent, 0.0, -extent],
        [extent, 0.0, extent],
        [-extent, 0.0, -extent],
        [extent, 0.0, extent],
        [-extent, 0.0, extent],
    ]
}

/// 编辑器网格从场景中心向每个方向延伸的距离。
pub const EDITOR_GRID_EXTENT: f32 = 120.0;
/// 编辑器网格的线间距。
pub const EDITOR_GRID_STEP: f32 = 4.0;

/// 网格线顶点（line list）。
pub fn grid_mesh(range: f32, step: f32) -> Vec<[f32; 3]> {
    let mut v = Vec::new();
    let mut x = -range;
    while x <= range + 0.001 {
        v.push([x, 0.0, -range]);
        v.push([x, 0.0, range]);
        x += step;
    }
    let mut z = -range;
    while z <= range + 0.001 {
        v.push([-range, 0.0, z]);
        v.push([range, 0.0, z]);
        z += step;
    }
    v
}

/// 引擎 → JS 事件。
#[derive(Clone, Debug)]
pub enum EngineEvent {
    Pick {
        id: Option<String>,
    },
    Transform {
        id: String,
        position: [f32; 3],
    },
    Stats {
        backend: String,
        fps: f32,
        instances: u32,
        visible: u32,
        particles: u32,
        tris: u32,
    },
    Hud {
        grid: bool,
        flylines: bool,
        stats: bool,
    },
    Error {
        message: String,
    },
    Probe {
        rgba: [u8; 4],
    },
    /// 看板（egui）交互事件，与引擎事件共用同一条 DWCR 事件队列。
    BoardEvent {
        id: String,
        kind: String,
        action: crate::protocol::wire::BoardAction,
        value: serde_json::Value,
    },
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Mode {
    Editor,
    Login,
}

impl Mode {
    pub fn as_f32(self) -> f32 {
        match self {
            Mode::Editor => 0.0,
            Mode::Login => 1.0,
        }
    }
}

#[derive(Copy, Clone, Debug)]
pub struct HudState {
    pub grid: bool,
    pub flylines: bool,
    pub stats: bool,
}

impl Default for HudState {
    fn default() -> Self {
        Self {
            grid: true,
            flylines: true,
            stats: true,
        }
    }
}

/// 与前端 `FlatInstance` 对应（camelCase）。
#[derive(Clone, Debug)]
pub struct FlatInstanceIn {
    pub id: String,
    pub kind: String,
    pub pos: [f32; 3],
    pub size: [f32; 3],
    pub rot_y: f32,
    pub rotation: Option<[f32; 3]>,
    pub color: [f32; 3],
    pub locked: Option<bool>,
    pub to: Option<[f32; 3]>,
    pub model_id: Option<String>,
    pub terrain: Option<TerrainConfig>,
    pub water: Option<WaterConfig>,
}

impl FlatInstanceIn {
    /// 从已验证的 `wire::Instance` 构建；id/kind/pos/size/color 都是 required。
    pub fn from_wire(item: crate::protocol::wire::Instance<'_>) -> Self {
        let triple = |vector: Option<flatbuffers::Vector<'_, f32>>| -> Option<[f32; 3]> {
            let vector: Vec<f32> = vector?.iter().collect();
            Some([
                vector.first().copied()?,
                vector.get(1).copied()?,
                vector.get(2).copied()?,
            ])
        };
        let pos = item.pos();
        let size = item.size();
        let color = item.color();
        Self {
            id: item.id().to_owned(),
            kind: item.kind().to_owned(),
            pos: [pos.x(), pos.y(), pos.z()],
            size: [size.x(), size.y(), size.z()],
            rot_y: item.rot_y(),
            rotation: triple(item.rotation()),
            color: [color.x(), color.y(), color.z()],
            locked: item.locked(),
            to: triple(item.to()),
            model_id: item.model_id().map(str::to_owned),
            terrain: item.terrain().map(TerrainConfig::from_wire),
            water: item.water().map(WaterConfig::from_wire),
        }
    }
}
