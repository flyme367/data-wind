use std::cell::RefCell;
use std::collections::HashMap;
use std::io::Cursor;

use base64::Engine as _;
use glam::{Mat3, Mat4, Vec2, Vec3};
use image::ImageReader;
use percent_encoding::percent_decode_str;

use crate::{AlphaMode, Material, MaterialMap, MAX_INPUT_BYTES, MAX_TEXTURE_BYTES, MAX_TRIANGLES, MAX_VERTICES,
    ModelAsset, Primitive, Texture, WrapMode};

fn texture_wrap(texture: &gltf::Texture<'_>) -> [WrapMode; 2] {
    let sampler = texture.sampler();
    [sampler.wrap_s(), sampler.wrap_t()].map(|mode| match mode {
        gltf::texture::WrappingMode::Repeat => WrapMode::Repeat,
        gltf::texture::WrappingMode::ClampToEdge => WrapMode::Clamp,
        gltf::texture::WrappingMode::MirroredRepeat => WrapMode::Mirror,
    })
}

/// Paths are resolved only against files supplied by the user, never the network or filesystem.
pub(crate) fn normalize_path(base: &str, path: &str) -> Result<String, String> {
    if path.contains(':') || path.starts_with('/') || path.starts_with('\\') || path.contains('\0') {
        return Err(format!("不支持外部或绝对路径：{path}"));
    }
    let decoded = percent_decode_str(path).decode_utf8().map_err(|_| "资源路径不是有效 UTF-8")?;
    let path = decoded.replace('\\', "/");
    if path.starts_with('/') || path.contains(':') || path.contains('\0') {
        return Err("资源路径无效".into());
    }
    let mut parts: Vec<&str> = base.split('/').filter(|v| !v.is_empty()).collect();
    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." => { if parts.pop().is_none() { return Err("资源路径超出所选目录".into()); } }
            _ => parts.push(part),
        }
    }
    if parts.is_empty() { return Err("资源路径为空".into()); }
    Ok(parts.join("/"))
}

fn directory(path: &str) -> &str { path.rsplit_once('/').map_or("", |(parent, _)| parent) }

fn resolve<'a>(base: &str, uri: &str, files: &'a HashMap<String, Vec<u8>>) -> Result<&'a [u8], String> {
    let path = normalize_path(base, uri)?;
    files.get(&path).map(Vec::as_slice).ok_or_else(|| format!("缺少关联文件：{path}，请同时选择模型及其资源文件"))
}

fn uri_bytes(base: &str, uri: &str, files: &HashMap<String, Vec<u8>>) -> Result<Vec<u8>, String> {
    if let Some(data) = uri.strip_prefix("data:") {
        let (metadata, content) = data.split_once(',').ok_or("无效的内嵌资源 URI")?;
        if metadata.ends_with(";base64") {
            base64::engine::general_purpose::STANDARD.decode(content).map_err(|e| format!("内嵌资源解码失败：{e}"))
        } else {
            Ok(percent_decode_str(content).collect())
        }
    } else {
        Ok(resolve(base, uri, files)?.to_vec())
    }
}

fn texture(name: String, bytes: &[u8]) -> Result<Texture, String> {
    let mut reader = ImageReader::new(Cursor::new(bytes)).with_guessed_format()
        .map_err(|e| format!("无法识别贴图 {name}：{e}"))?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(4096);
    limits.max_image_height = Some(4096);
    limits.max_alloc = Some(MAX_TEXTURE_BYTES as u64);
    reader.limits(limits);
    let image = reader.decode().map_err(|e| format!("无法解析贴图 {name}：{e}"))?.into_rgba8();
    Ok(Texture { name, width: image.width(), height: image.height(), rgba: image.into_raw() })
}

/// Parse one selected model; companions are keyed by their selected relative paths.
pub fn import_model(path: &str, bytes: &[u8], files: &HashMap<String, Vec<u8>>) -> Result<ModelAsset, String> {
    let total = files.values().try_fold(0usize, |sum, bytes| sum.checked_add(bytes.len())).ok_or("输入文件过大")?;
    let extra = if files.contains_key(path) { 0 } else { bytes.len() };
    if total.saturating_add(extra) > MAX_INPUT_BYTES { return Err("所选文件总大小不能超过 20 MB".into()); }
    let extension = path.rsplit('.').next().unwrap_or_default().to_ascii_lowercase();
    let asset = match extension.as_str() {
        "gltf" | "glb" => import_gltf(path, bytes, files)?,
        "obj" => import_obj(path, bytes, files)?,
        _ => return Err("请选择 GLB、glTF 或 OBJ 模型".into()),
    };
    asset.validate()?;
    Ok(asset)
}

fn import_gltf(path: &str, bytes: &[u8], files: &HashMap<String, Vec<u8>>) -> Result<ModelAsset, String> {
    let source = gltf::Gltf::from_slice(bytes).map_err(|e| format!("glTF 文件无效：{e}"))?;
    for extension in source.extensions_required() {
        if matches!(extension, "KHR_draco_mesh_compression" | "EXT_meshopt_compression") {
            return Err("请先解压 Draco / Meshopt 几何后再导入".into());
        }
    }
    let mut buffers = Vec::new();
    let mut total = 0usize;
    for buffer in source.buffers() {
        let data = match buffer.source() {
            gltf::buffer::Source::Bin => source.blob.clone().ok_or("GLB 缺少 BIN 数据")?,
            gltf::buffer::Source::Uri(uri) => uri_bytes(directory(path), uri, files)?,
        };
        total = total.saturating_add(data.len());
        if data.len() < buffer.length() || total > MAX_INPUT_BYTES {
            return Err("glTF 缓冲区不完整或过大".into());
        }
        buffers.push(data);
    }
    for view in source.views() {
        let buffer = buffers.get(view.buffer().index()).ok_or("glTF 缓冲区不存在")?;
        if view.offset().checked_add(view.length()).is_none_or(|end| end > buffer.len()) {
            return Err("glTF 缓冲区视图超出范围".into());
        }
    }
    for accessor in source.accessors() {
        if accessor.sparse().is_some() { return Err("暂不支持稀疏访问器，请在 Blender 中重新导出模型".into()); }
        let count = accessor.count();
        if count == 0 || count > MAX_VERTICES * 3 { return Err("glTF 顶点数据为空或过大".into()); }
        let view = accessor.view().ok_or("glTF 访问器缺少缓冲区视图")?;
        let stride = view.stride().unwrap_or(accessor.size());
        if stride < accessor.size() || accessor.offset().checked_add(
            stride.checked_mul(count - 1).ok_or("glTF 访问器超出范围")?
        ).and_then(|end| end.checked_add(accessor.size())).is_none_or(|end| end > view.length()) {
            return Err("glTF 访问器超出缓冲区范围".into());
        }
    }
    let mut state = GltfState { path, files, buffers, primitives: Vec::new(), textures: Vec::new(), texture_map: HashMap::new(), vertices: 0, triangles: 0 };
    let roots: Vec<_> = if let Some(scene) = source.default_scene().or_else(|| source.scenes().next()) {
        scene.nodes().collect()
    } else {
        let children: std::collections::HashSet<_> = source.nodes().flat_map(|node| node.children().map(|child| child.index()).collect::<Vec<_>>()).collect();
        source.nodes().filter(|node| !children.contains(&node.index())).collect()
    };
    for node in roots { state.visit(node, Mat4::IDENTITY, &mut Vec::new())?; }
    Ok(ModelAsset { name: file_name(path), primitives: state.primitives, textures: state.textures })
}

struct GltfState<'a> {
    path: &'a str,
    files: &'a HashMap<String, Vec<u8>>,
    buffers: Vec<Vec<u8>>,
    primitives: Vec<Primitive>,
    textures: Vec<Texture>,
    texture_map: HashMap<usize, usize>,
    vertices: usize,
    triangles: usize,
}

impl GltfState<'_> {
    fn visit(&mut self, node: gltf::Node<'_>, parent: Mat4, ancestors: &mut Vec<usize>) -> Result<(), String> {
        if ancestors.len() >= 128 || ancestors.contains(&node.index()) { return Err("glTF 节点结构存在循环或层级过深".into()); }
        if node.skin().is_some() { return Err("暂不支持骨骼蒙皮模型，请在 Blender 中应用变形后导出".into()); }
        ancestors.push(node.index());
        let transform = parent * Mat4::from_cols_array_2d(&node.transform().matrix());
        let linear = Mat3::from_mat4(transform);
        if !transform.is_finite() || linear.determinant().abs() < 1e-12 { return Err("模型节点变换无效或缩放为零".into()); }
        let normal_transform = linear.inverse().transpose();
        if let Some(mesh) = node.mesh() {
            for primitive in mesh.primitives() {
                if primitive.mode() != gltf::mesh::Mode::Triangles { return Err("仅支持三角形网格，请在 Blender 中先三角化".into()); }
                if primitive.morph_targets().next().is_some() { return Err("暂不支持形态键，请先应用变形后导出".into()); }
                let reader = primitive.reader(|buffer| self.buffers.get(buffer.index()).map(Vec::as_slice));
                let positions: Vec<[f32; 3]> = reader.read_positions().ok_or("模型缺少顶点坐标")?
                    .map(|p| transform.transform_point3(Vec3::from_array(p)).to_array()).collect();
                let normals: Vec<[f32; 3]> = reader.read_normals().map_or_else(Vec::new, |values| values
                    .map(|n| (normal_transform * Vec3::from_array(n)).normalize_or_zero().to_array()).collect());
                let colors: Vec<[f32; 4]> = reader.read_colors(0).map_or_else(Vec::new, |values| values.into_rgba_f32().collect());
                let mut indices: Vec<u32> = if let Some(values) = reader.read_indices() { values.into_u32().collect() } else {
                    (0..u32::try_from(positions.len()).map_err(|e| e.to_string())?).collect()
                };
                if linear.determinant() < 0.0 { for triangle in indices.chunks_exact_mut(3) { triangle.swap(1, 2); } }
                self.vertices = self.vertices.saturating_add(positions.len());
                self.triangles = self.triangles.saturating_add(indices.len() / 3);
                if self.vertices > MAX_VERTICES || self.triangles > MAX_TRIANGLES { return Err("模型超过 20 万个顶点或 2 万个三角面，请先简化模型".into()); }
                let source_material = primitive.material();
                let pbr = source_material.pbr_metallic_roughness();
                let texture = pbr.base_color_texture();
                let emissive_texture = source_material.emissive_texture();
                let read_transformed_uvs = |uv_set, scale: [f32; 2], angle, offset: [f32; 2]| {
                    let mut uvs: Vec<[f32; 2]> = reader.read_tex_coords(uv_set)
                        .map_or_else(Vec::new, |values| values.into_f32().collect());
                    if scale != [1.0; 2] || angle != 0.0 || offset != [0.0; 2] {
                        let scale = Vec2::from_array(scale);
                        let rotation = glam::Mat2::from_angle(angle);
                        let offset = Vec2::from_array(offset);
                        for uv in &mut uvs {
                            *uv = (offset + rotation * (Vec2::from_array(*uv) * scale)).to_array();
                        }
                    }
                    uvs
                };
                let read_uvs = |info: Option<&gltf::texture::Info<'_>>| {
                    let set = info.map_or(0, gltf::texture::Info::tex_coord);
                    match info.and_then(gltf::texture::Info::texture_transform) {
                        Some(t) => read_transformed_uvs(t.tex_coord().unwrap_or(set), t.scale(), t.rotation(), t.offset()),
                        None => read_transformed_uvs(set, [1.0; 2], 0.0, [0.0; 2]),
                    }
                };
                let texcoords = read_uvs(texture.as_ref());
                let source_texcoords = (0_u8..6).filter_map(|index| {
                    reader.read_tex_coords(u32::from(index))
                        .map(|values| (index, values.into_f32().collect()))
                }).collect();
                let emissive_texcoords = emissive_texture.as_ref().map_or_else(Vec::new, |info| read_uvs(Some(info)));
                let wrap = texture.as_ref().map_or([WrapMode::Repeat; 2], |info| texture_wrap(&info.texture()));
                let emissive_wrap = emissive_texture.as_ref().map_or([WrapMode::Repeat; 2], |info| texture_wrap(&info.texture()));
                let metallic_map = pbr.metallic_roughness_texture().map(|info| {
                    (info.texture(), read_uvs(Some(&info)), 1.0)
                });
                let normal_map = source_material.normal_texture().map(|info| {
                    let extension = info.extension_value("KHR_texture_transform");
                    let pair = |key| extension.and_then(|e| e.get(key)).and_then(|v| {
                        Some([v.get(0)?.as_f64()? as f32, v.get(1)?.as_f64()? as f32])
                    });
                    let set = extension.and_then(|e| e.get("texCoord")).and_then(|v| v.as_u64())
                        .and_then(|value| u32::try_from(value).ok()).unwrap_or_else(|| info.tex_coord());
                    let angle = extension.and_then(|e| e.get("rotation")).and_then(|v| v.as_f64())
                        .unwrap_or(0.0) as f32;
                    let coords = read_transformed_uvs(set, pair("scale").unwrap_or([1.0; 2]),
                        angle, pair("offset").unwrap_or([0.0; 2]));
                    (info.texture(), coords, info.scale())
                });
                let texture_index = texture.map(|info| self.load_texture(info.texture().source())).transpose()?;
                let emissive_texture_index = emissive_texture.map(|info| self.load_texture(info.texture().source())).transpose()?;
                let mut load_map = |(texture, texcoords, strength): (gltf::Texture<'_>, Vec<[f32; 2]>, f32)| {
                    if texcoords.is_empty() { return Ok::<_, String>(None); }
                    let texture_index = self.load_texture(texture.source())?;
                    Ok(Some(MaterialMap { texture_index, texcoords, wrap: texture_wrap(&texture), strength }))
                };
                let normal_map = normal_map.map(&mut load_map).transpose()?.flatten();
                let metallic_map = metallic_map.map(load_map).transpose()?.flatten();
                let material = Material {
                    alpha_mode: match source_material.alpha_mode() {
                        gltf::material::AlphaMode::Opaque => AlphaMode::Opaque,
                        gltf::material::AlphaMode::Mask => AlphaMode::Mask,
                        gltf::material::AlphaMode::Blend => AlphaMode::Blend,
                    },
                    alpha_cutoff: source_material.alpha_cutoff().unwrap_or(0.5),
                    double_sided: source_material.double_sided(),
                    wrap, emissive: source_material.emissive_factor(),
                    emissive_texture_index, emissive_texcoords, emissive_wrap,
                    metallic: pbr.metallic_factor(), roughness: pbr.roughness_factor(), normal_map,
                    metallic_map, object_normal_basis: Some(normal_transform.to_cols_array()),
                };
                let name = node.name().or_else(|| mesh.name()).unwrap_or("mesh");
                let name = if mesh.primitives().len() > 1 {
                    format!("{name}_primitive{}", primitive.index())
                } else { name.to_owned() };
                let mut mesh = Primitive { name, positions, normals,
                    texcoords, colors, indices, base_color: pbr.base_color_factor(), texture_index,
                    material, source_texcoords };
                ensure_normals(&mut mesh)?;
                self.primitives.push(mesh);
            }
        }
        for child in node.children() { self.visit(child, transform, ancestors)?; }
        ancestors.pop();
        Ok(())
    }

    fn load_texture(&mut self, image: gltf::Image<'_>) -> Result<usize, String> {
        if let Some(&index) = self.texture_map.get(&image.index()) { return Ok(index); }
        let name = image.name().unwrap_or("texture").to_owned();
        let bytes = match image.source() {
            gltf::image::Source::Uri { uri, .. } => uri_bytes(directory(self.path), uri, self.files)?,
            gltf::image::Source::View { view, .. } => {
                let buffer = self.buffers.get(view.buffer().index()).ok_or("贴图缓冲区不存在")?;
                buffer.get(view.offset()..view.offset() + view.length()).ok_or("贴图超出缓冲区范围")?.to_vec()
            }
        };
        let texture = texture(name, &bytes)?;
        let total = self.textures.iter().map(|item| item.rgba.len()).sum::<usize>();
        if total.saturating_add(texture.rgba.len()) > MAX_TEXTURE_BYTES { return Err("贴图总大小超过 64 MiB".into()); }
        let index = self.textures.len();
        self.textures.push(texture);
        self.texture_map.insert(image.index(), index);
        Ok(index)
    }
}

fn import_obj(path: &str, bytes: &[u8], files: &HashMap<String, Vec<u8>>) -> Result<ModelAsset, String> {
    let material_dirs = RefCell::new(HashMap::new());
    let material_error = RefCell::new(None::<String>);
    let result = tobj::load_obj_buf(&mut Cursor::new(bytes), &tobj::GPU_LOAD_OPTIONS, |mtl_path| {
        let name = mtl_path.to_string_lossy();
        let load = || -> Result<_, String> {
            let full_path = normalize_path(directory(path), &name)?;
            let data = files.get(&full_path).ok_or_else(|| format!("缺少材质文件：{full_path}"))?;
            let result = tobj::load_mtl_buf(&mut Cursor::new(data)).map_err(|e| format!("材质文件无效：{e}"))?;
            for material in &result.0 { material_dirs.borrow_mut().insert(material.name.clone(), directory(&full_path).to_owned()); }
            Ok(result)
        };
        match load() { Ok(result) => Ok(result), Err(error) => { *material_error.borrow_mut() = Some(error); Err(tobj::LoadError::OpenFileFailed) } }
    }).map_err(|e| format!("OBJ 文件无效：{e}"))?;
    let materials = result.1.map_err(|e| material_error.into_inner().unwrap_or_else(|| format!("材质文件无效：{e}")))?;
    let mut textures = Vec::new();
    let mut texture_map = HashMap::new();
    let mut primitives = Vec::new();
    let mut vertices = 0usize;
    let mut triangles = 0usize;
    for model in result.0 {
        let mesh = model.mesh;
        vertices = vertices.saturating_add(mesh.positions.len() / 3);
        triangles = triangles.saturating_add(mesh.indices.len() / 3);
        if vertices > MAX_VERTICES || triangles > MAX_TRIANGLES { return Err("模型超过 20 万个顶点或 2 万个三角面，请先简化模型".into()); }
        if mesh.positions.len() % 3 != 0 || mesh.normals.len() % 3 != 0 || mesh.texcoords.len() % 2 != 0 || mesh.vertex_color.len() % 3 != 0 {
            return Err("OBJ 顶点数据不完整".into());
        }
        let material = mesh.material_id.and_then(|id| materials.get(id));
        let diffuse = material.and_then(|m| m.diffuse).unwrap_or([1.0; 3]);
        let texture_index = if let Some(material) = material {
            if let Some(name) = &material.diffuse_texture {
                let dirs = material_dirs.borrow();
                let base = dirs.get(&material.name).map_or(directory(path), String::as_str);
                let full_path = normalize_path(base, name)?;
                if let Some(&index) = texture_map.get(&full_path) { Some(index) } else {
                    let data = files.get(&full_path).ok_or_else(|| format!("缺少贴图文件：{full_path}"))?;
                    let image = texture(full_path.clone(), data)?;
                    let total = textures.iter().map(|item: &Texture| item.rgba.len()).sum::<usize>();
                    if total.saturating_add(image.rgba.len()) > MAX_TEXTURE_BYTES { return Err("贴图总大小超过 64 MiB".into()); }
                    let index = textures.len();
                    textures.push(image);
                    texture_map.insert(full_path, index);
                    Some(index)
                }
            } else { None }
        } else { None };
        let mut primitive = Primitive {
            name: model.name,
            positions: mesh.positions.chunks_exact(3).map(|v| [v[0], v[1], v[2]]).collect(),
            normals: mesh.normals.chunks_exact(3).map(|v| [v[0], v[1], v[2]]).collect(),
            // OBJ uses a bottom-left texture origin; DWMA/glTF use a top-left origin.
            texcoords: mesh.texcoords.chunks_exact(2).map(|v| [v[0], 1.0 - v[1]]).collect(),
            colors: mesh.vertex_color.chunks_exact(3).map(|v| [v[0], v[1], v[2], 1.0]).collect(),
            indices: mesh.indices, base_color: [diffuse[0], diffuse[1], diffuse[2], material.and_then(|m| m.dissolve).unwrap_or(1.0)], texture_index,
            material: Material {
                alpha_mode: if material.and_then(|m| m.dissolve).is_some_and(|v| v < 1.0) {
                    AlphaMode::Blend
                } else { AlphaMode::Opaque },
                double_sided: true,
                ..Material::default()
            },
            source_texcoords: Vec::new(),
        };
        ensure_normals(&mut primitive)?;
        primitives.push(primitive);
    }
    Ok(ModelAsset { name: file_name(path), primitives, textures })
}

fn ensure_normals(mesh: &mut Primitive) -> Result<(), String> {
    if !mesh.normals.is_empty() { return Ok(()); }
    let mut normals = vec![Vec3::ZERO; mesh.positions.len()];
    for triangle in mesh.indices.chunks_exact(3) {
        let [a, b, c] = [triangle[0] as usize, triangle[1] as usize, triangle[2] as usize];
        let (Some(pa), Some(pb), Some(pc)) = (mesh.positions.get(a), mesh.positions.get(b), mesh.positions.get(c)) else { return Err("模型索引超出顶点范围".into()); };
        let normal = (Vec3::from_array(*pb) - Vec3::from_array(*pa)).cross(Vec3::from_array(*pc) - Vec3::from_array(*pa));
        normals[a] += normal;
        normals[b] += normal;
        normals[c] += normal;
    }
    mesh.normals = normals.into_iter().map(|v| v.try_normalize().unwrap_or(Vec3::Y).to_array()).collect();
    Ok(())
}

fn file_name(path: &str) -> String {
    let name = path.rsplit('/').next().unwrap_or(path);
    name.rsplit_once('.').map_or(name, |(name, _)| name).to_owned()
}
