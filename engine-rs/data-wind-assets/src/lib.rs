//! Import Blender-exported glTF/GLB and OBJ into the portable DWMA FlatBuffers format.

mod codec;
#[cfg(feature = "import")]
mod importer;
#[allow(clippy::all, clippy::pedantic, dead_code, unused_imports, unsafe_code)]
mod generated {
    include!("generated/model_asset_generated.rs");
}

pub use codec::{decode_asset, encode_asset};
#[cfg(feature = "import")]
pub use importer::import_model;

/// The maximum number of input bytes accepted across all selected files.
pub const MAX_INPUT_BYTES: usize = 20_000_000;
/// Existing editor renderer and project storage support at most 20,000 triangles.
pub const MAX_TRIANGLES: usize = 20_000;
pub const MAX_VERTICES: usize = 200_000;
pub const MAX_TEXTURE_BYTES: usize = 64 * 1024 * 1024;

#[derive(Clone, Debug, PartialEq)]
pub struct Texture {
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum AlphaMode {
    #[default]
    Opaque,
    Mask,
    Blend,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum WrapMode {
    #[default]
    Repeat,
    Clamp,
    Mirror,
}

#[derive(Clone, Debug, PartialEq)]
pub struct MaterialMap {
    pub texture_index: usize,
    pub texcoords: Vec<[f32; 2]>,
    pub wrap: [WrapMode; 2],
    pub strength: f32,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Material {
    pub alpha_mode: AlphaMode,
    pub alpha_cutoff: f32,
    pub double_sided: bool,
    pub wrap: [WrapMode; 2],
    pub emissive: [f32; 3],
    pub emissive_texture_index: Option<usize>,
    pub emissive_texcoords: Vec<[f32; 2]>,
    pub emissive_wrap: [WrapMode; 2],
    pub metallic: f32,
    pub roughness: f32,
    pub normal_map: Option<MaterialMap>,
    pub metallic_map: Option<MaterialMap>,
    pub object_normal_basis: Option<[f32; 9]>,
}

impl Default for Material {
    fn default() -> Self {
        Self {
            alpha_mode: AlphaMode::Opaque,
            alpha_cutoff: 0.5,
            double_sided: false,
            wrap: [WrapMode::Repeat; 2],
            emissive: [0.0; 3],
            emissive_texture_index: None,
            emissive_texcoords: Vec::new(),
            emissive_wrap: [WrapMode::Repeat; 2],
            metallic: 0.0,
            roughness: 1.0,
            normal_map: None,
            metallic_map: None,
            object_normal_basis: None,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Primitive {
    pub name: String,
    pub positions: Vec<[f32; 3]>,
    pub normals: Vec<[f32; 3]>,
    pub texcoords: Vec<[f32; 2]>,
    pub colors: Vec<[f32; 4]>,
    pub indices: Vec<u32>,
    pub base_color: [f32; 4],
    pub texture_index: Option<usize>,
    pub material: Material,
    pub source_texcoords: Vec<(u8, Vec<[f32; 2]>)>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ModelAsset {
    pub name: String,
    pub primitives: Vec<Primitive>,
    pub textures: Vec<Texture>,
}

impl ModelAsset {
    /// Validate semantic constraints after parsing or decoding an untrusted FlatBuffer.
    pub fn validate(&self) -> Result<(), String> {
        if self.name.is_empty() || self.primitives.is_empty() {
            return Err("模型没有可用的三角形网格".into());
        }
        let mut vertices = 0usize;
        let mut triangles = 0usize;
        for primitive in &self.primitives {
            let count = primitive.positions.len();
            let material = &primitive.material;
            let mut uv_sets = [false; 6];
            for (index, values) in &primitive.source_texcoords {
                let slot = uv_sets.get_mut(*index as usize).ok_or("UV 集合编号无效")?;
                if *slot || values.len() != count || values.iter().flatten().any(|v| !v.is_finite()) {
                    return Err("模型原始 UV 数据无效".into());
                }
                *slot = true;
            }
            vertices = vertices.saturating_add(count);
            triangles = triangles.saturating_add(primitive.indices.len() / 3);
            if count == 0 || primitive.normals.len() != count
                || (!primitive.texcoords.is_empty() && primitive.texcoords.len() != count)
                || (!primitive.colors.is_empty() && primitive.colors.len() != count)
                || primitive.indices.is_empty() || primitive.indices.len() % 3 != 0
                || primitive.indices.iter().any(|&index| index as usize >= count)
                || primitive.texture_index.is_some_and(|index| index >= self.textures.len())
                || material.emissive_texture_index.is_some_and(|index| index >= self.textures.len())
                || [material.metallic, material.roughness].iter().any(|v| !(0.0..=1.0).contains(v))
                || material.object_normal_basis.is_some_and(|m| m.iter().any(|v| !v.is_finite()))
                || [&material.normal_map, &material.metallic_map].into_iter().flatten().any(|map| {
                    map.texture_index >= self.textures.len() || !map.strength.is_finite()
                        || map.texcoords.len() != count || map.texcoords.iter().flatten().any(|v| !v.is_finite())
                })
                || (!material.emissive_texcoords.is_empty() && material.emissive_texcoords.len() != count)
                || !material.alpha_cutoff.is_finite() || material.alpha_cutoff < 0.0
                || primitive.positions.iter().flatten().chain(primitive.normals.iter().flatten())
                    .chain(primitive.texcoords.iter().flatten()).chain(primitive.colors.iter().flatten())
                    .chain(primitive.base_color.iter()).chain(material.emissive.iter())
                    .chain(material.emissive_texcoords.iter().flatten()).any(|v| !v.is_finite())
            {
                return Err("模型网格属性、索引或材质无效".into());
            }
        }
        if vertices > MAX_VERTICES || triangles > MAX_TRIANGLES {
            return Err("模型超过 20 万个顶点或 2 万个三角面，请先简化模型".into());
        }
        let mut texture_bytes = 0usize;
        for texture in &self.textures {
            let size = (texture.width as usize).checked_mul(texture.height as usize)
                .and_then(|size| size.checked_mul(4)).ok_or("贴图尺寸过大")?;
            texture_bytes = texture_bytes.saturating_add(size);
            if texture.width == 0 || texture.height == 0 || texture.width > 4096
                || texture.height > 4096 || size != texture.rgba.len()
                || texture_bytes > MAX_TEXTURE_BYTES
            {
                return Err("贴图尺寸或像素数据无效（最大 4096×4096，总计 64 MiB）".into());
            }
        }
        Ok(())
    }
}

/// Browser API: files are supplied explicitly; no external URLs are fetched.
#[cfg(all(feature = "import", target_arch = "wasm32"))]
mod wasm {
    use super::*;
    use std::collections::HashMap;
    use wasm_bindgen::prelude::*;

    #[wasm_bindgen]
    pub struct ModelImporter {
        files: HashMap<String, Vec<u8>>,
        total: usize,
    }

    #[wasm_bindgen]
    impl ModelImporter {
        #[wasm_bindgen(constructor)]
        pub fn new() -> Self {
            Self { files: HashMap::new(), total: 0 }
        }

        pub fn add_file(&mut self, path: &str, data: &[u8]) -> Result<(), JsValue> {
            let path = importer::normalize_path("", path).map_err(|e| JsValue::from_str(&e))?;
            if self.files.contains_key(&path) {
                return Err(JsValue::from_str(&format!("文件路径重复：{path}")));
            }
            self.total = self.total.checked_add(data.len()).ok_or_else(|| JsValue::from_str("文件过大"))?;
            if self.total > MAX_INPUT_BYTES {
                return Err(JsValue::from_str("所选文件总大小不能超过 20 MB"));
            }
            self.files.insert(path, data.to_vec());
            Ok(())
        }

        pub fn convert(&self, path: &str) -> Result<Vec<u8>, JsValue> {
            let path = importer::normalize_path("", path).map_err(|e| JsValue::from_str(&e))?;
            let data = self.files.get(&path).ok_or_else(|| JsValue::from_str("找不到模型文件"))?;
            let asset = import_model(&path, data, &self.files).map_err(|e| JsValue::from_str(&e))?;
            encode_asset(&asset).map_err(|e| JsValue::from_str(&e))
        }
    }

    /// Verify imported `.dwasset` files before persisting them.
    #[wasm_bindgen]
    pub fn validate_model_asset(bytes: &[u8]) -> Result<(), JsValue> {
        decode_asset(bytes).map(|_| ()).map_err(|e| JsValue::from_str(&e))
    }
}
