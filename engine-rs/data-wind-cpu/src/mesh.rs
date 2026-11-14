//! Static model meshes prepared from the CC0 glTF reference library.
use bytemuck::{Pod, Zeroable};

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
pub struct ModelVertex {
    pub position: [f32; 3],
    pub normal: [f32; 3],
    pub color: [f32; 3],
}

/// 已解码、未上传的模型网格：主世界持有，渲染世界懒上传。
#[derive(Clone)]
pub struct CpuMesh {
    pub data: Vec<u8>,
    pub vertex_count: u32,
    pub picking: Option<crate::picking::MeshPicking>,
}

/// DWM1：头 8 字节（魔数 + 展开顶点数）+ 每顶点 36 字节 f32（position/normal/linear RGB）。
/// DWM2：头 16 字节（魔数 + 唯一顶点数 + 索引数 + flags）+ 唯一顶点 13 字节量化
/// （position u16×3 / 法线八面体 i16×2 / 颜色 u8×3）+ u16 或 u32 索引。
/// 两个版本都解码为逐角落展开的 [`ModelVertex`] 列表，下游 GPU 布局不变。
pub fn decode_mesh(bytes: &[u8]) -> Result<Vec<ModelVertex>, String> {
    if bytes.len() >= 4 && &bytes[..4] == b"DWM1" {
        decode_dwm1(bytes)
    } else if bytes.len() >= 4 && &bytes[..4] == b"DWM2" {
        decode_dwm2(bytes)
    } else {
        Err("Invalid model mesh header".into())
    }
}

fn decode_dwm1(bytes: &[u8]) -> Result<Vec<ModelVertex>, String> {
    if bytes.len() < 8 {
        return Err("Invalid model mesh header".into());
    }
    let count = u32::from_le_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]);
    if count == 0 || count > 1_000_000 || count % 3 != 0 {
        return Err("Model mesh must contain complete triangles".into());
    }
    let expected = usize::try_from(count).map_err(|error| error.to_string())?
        * std::mem::size_of::<ModelVertex>();
    if bytes.len() - 8 != expected {
        return Err("Model mesh vertex data is truncated".into());
    }
    let vertices: &[ModelVertex] = bytemuck::try_cast_slice(&bytes[8..])
        .map_err(|error| format!("Unaligned model mesh data: {error}"))?;
    if vertices.iter().any(|vertex| {
        vertex
            .position
            .iter()
            .chain(&vertex.normal)
            .chain(&vertex.color)
            .any(|value| !value.is_finite())
    }) {
        return Err("Model mesh contains invalid numeric values".into());
    }
    Ok(vertices.to_vec())
}

const DWM2_HEADER: usize = 16;
const DWM2_VERTEX_SIZE: usize = 13;

fn decode_dwm2(bytes: &[u8]) -> Result<Vec<ModelVertex>, String> {
    if bytes.len() < DWM2_HEADER || bytes[13..16] != [0, 0, 0] {
        return Err("Invalid model mesh header".into());
    }
    let read_u32 = |offset: usize| {
        u32::from_le_bytes([
            bytes[offset],
            bytes[offset + 1],
            bytes[offset + 2],
            bytes[offset + 3],
        ])
    };
    let vertex_count = read_u32(4);
    let index_count = read_u32(8);
    let flags = bytes[12];
    if flags > 1 {
        return Err("Unknown model mesh flags".into());
    }
    if vertex_count == 0 || vertex_count > 1_000_000 {
        return Err("Model mesh must contain vertices".into());
    }
    if index_count == 0 || index_count > 1_000_000 || index_count % 3 != 0 {
        return Err("Model mesh must contain complete triangles".into());
    }
    let vertex_count = usize::try_from(vertex_count).map_err(|error| error.to_string())?;
    let index_count = usize::try_from(index_count).map_err(|error| error.to_string())?;
    let index_size = if flags & 1 == 1 { 4 } else { 2 };
    if vertex_count * DWM2_VERTEX_SIZE > usize::MAX - DWM2_HEADER - index_count * index_size {
        return Err("Model mesh is too large".into());
    }
    let expected = DWM2_HEADER + vertex_count * DWM2_VERTEX_SIZE + index_count * index_size;
    if bytes.len() != expected {
        return Err("Model mesh vertex data is truncated".into());
    }
    let mut unique = Vec::with_capacity(vertex_count);
    let read_u16 = |base: usize| u16::from_le_bytes([bytes[base], bytes[base + 1]]);
    for index in 0..vertex_count {
        let base = DWM2_HEADER + index * DWM2_VERTEX_SIZE;
        let position = core::array::from_fn(|axis| {
            read_u16(base + axis * 2) as f32 / 65535.0 - 0.5
        });
        let normal = oct_decode(
            i16::from_le_bytes([bytes[base + 6], bytes[base + 7]]),
            i16::from_le_bytes([bytes[base + 8], bytes[base + 9]]),
        );
        let color = core::array::from_fn(|axis| bytes[base + 10 + axis] as f32 / 255.0);
        unique.push(ModelVertex { position, normal, color });
    }
    let mut vertices = Vec::with_capacity(index_count);
    let read_index = |offset: usize| -> u32 {
        if index_size == 4 {
            u32::from_le_bytes([
                bytes[offset],
                bytes[offset + 1],
                bytes[offset + 2],
                bytes[offset + 3],
            ])
        } else {
            u32::from(read_u16(offset))
        }
    };
    for index in 0..index_count {
        let vertex = read_index(DWM2_HEADER + vertex_count * DWM2_VERTEX_SIZE + index * index_size)
            as usize;
        let source = unique.get(vertex).ok_or("Model mesh index out of range")?;
        vertices.push(*source);
    }
    Ok(vertices)
}

/// 法线八面体编码（snorm16）解码；编码约定见 scripts/prepare-models.mjs 与 importGlb.ts。
fn oct_decode(encoded_x: i16, encoded_y: i16) -> [f32; 3] {
    let sign = |value: f32| if value < 0.0 { -1.0 } else { 1.0 };
    let x = encoded_x as f32 / 32767.0;
    let y = encoded_y as f32 / 32767.0;
    let z = 1.0 - x.abs() - y.abs();
    let (x, y, z) = if z < 0.0 {
        let previous_x = x;
        ((1.0 - y.abs()) * sign(x), (1.0 - previous_x.abs()) * sign(y), z)
    } else {
        (x, y, z)
    };
    let length = (x * x + y * y + z * z).sqrt();
    if length == 0.0 {
        return [0.0, 0.0, 1.0];
    }
    [x / length, y / length, z / length]
}

impl CpuMesh {
    pub fn decode(bytes: &[u8]) -> Result<Self, String> {
        let vertices = decode_mesh(bytes)?;
        let vertex_count = u32::try_from(vertices.len()).map_err(|error| error.to_string())?;
        Ok(Self {
            data: bytemuck::cast_slice(&vertices).to_vec(),
            vertex_count,
            picking: crate::picking::MeshPicking::new(vertices.iter().map(|vertex| vertex.position)),
        })
    }
}
