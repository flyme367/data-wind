use crate::generated::data_wind::model as wire;
use crate::{AlphaMode, Material, MaterialMap, ModelAsset, Primitive, Texture, WrapMode};

fn encode_wrap(mode: WrapMode) -> wire::WrapMode {
    match mode {
        WrapMode::Repeat => wire::WrapMode::Repeat,
        WrapMode::Clamp => wire::WrapMode::Clamp,
        WrapMode::Mirror => wire::WrapMode::Mirror,
    }
}

fn decode_wrap(mode: wire::WrapMode) -> Result<WrapMode, String> {
    match mode {
        wire::WrapMode::Repeat => Ok(WrapMode::Repeat),
        wire::WrapMode::Clamp => Ok(WrapMode::Clamp),
        wire::WrapMode::Mirror => Ok(WrapMode::Mirror),
        _ => Err("不支持此贴图寻址模式".into()),
    }
}

fn encode_map<'a>(builder: &mut flatbuffers::FlatBufferBuilder<'a>, map: &MaterialMap)
    -> Result<flatbuffers::WIPOffset<wire::MaterialMap<'a>>, String> {
    let texcoords = builder.create_vector(bytemuck::cast_slice::<[f32; 2], f32>(&map.texcoords));
    let texture_index = u32::try_from(map.texture_index).map_err(|e| e.to_string())?;
    Ok(wire::MaterialMap::create(builder, &wire::MaterialMapArgs {
        texcoords: Some(texcoords), texture_index, wrap_u: encode_wrap(map.wrap[0]),
        wrap_v: encode_wrap(map.wrap[1]), strength: map.strength,
    }))
}

fn decode_map(map: wire::MaterialMap<'_>, count: usize) -> Result<MaterialMap, String> {
    let coords = map.texcoords();
    if coords.len() != count * 2 { return Err("材质贴图 UV 数据长度无效".into()); }
    Ok(MaterialMap {
        texcoords: (0..coords.len()).step_by(2).map(|i| [coords.get(i), coords.get(i + 1)]).collect(),
        texture_index: map.texture_index() as usize,
        wrap: [decode_wrap(map.wrap_u())?, decode_wrap(map.wrap_v())?], strength: map.strength(),
    })
}

pub fn encode_asset(asset: &ModelAsset) -> Result<Vec<u8>, String> {
    asset.validate()?;
    let mut builder = flatbuffers::FlatBufferBuilder::new();
    let mut textures = Vec::with_capacity(asset.textures.len());
    for texture in &asset.textures {
        let name = builder.create_string(&texture.name);
        let rgba = builder.create_vector(&texture.rgba);
        textures.push(wire::Texture::create(&mut builder, &wire::TextureArgs {
            name: Some(name), width: texture.width, height: texture.height, rgba: Some(rgba),
        }));
    }
    let mut primitives = Vec::with_capacity(asset.primitives.len());
    for primitive in &asset.primitives {
        let name = builder.create_string(&primitive.name);
        let positions = builder.create_vector(bytemuck::cast_slice::<[f32; 3], f32>(&primitive.positions));
        let normals = builder.create_vector(bytemuck::cast_slice::<[f32; 3], f32>(&primitive.normals));
        let texcoords = builder.create_vector(bytemuck::cast_slice::<[f32; 2], f32>(&primitive.texcoords));
        let colors = builder.create_vector(bytemuck::cast_slice::<[f32; 4], f32>(&primitive.colors));
        let indices = builder.create_vector(&primitive.indices);
        let base_color = builder.create_vector(&primitive.base_color);
        let texture_index = primitive.texture_index.map_or(Ok(-1), |i| i32::try_from(i).map_err(|e| e.to_string()))?;
        let material = &primitive.material;
        let emissive = (material.emissive != [0.0; 3])
            .then(|| builder.create_vector(&material.emissive));
        let emissive_texcoords = (!material.emissive_texcoords.is_empty()).then(|| {
            builder.create_vector(bytemuck::cast_slice::<[f32; 2], f32>(&material.emissive_texcoords))
        });
        let emissive_texture_index = material.emissive_texture_index
            .map_or(Ok(-1), |i| i32::try_from(i).map_err(|e| e.to_string()))?;
        let uv_sets: Vec<_> = primitive.source_texcoords.iter().map(|(index, values)| {
            let values = builder.create_vector(bytemuck::cast_slice::<[f32; 2], f32>(values));
            wire::TexcoordSet::create(&mut builder, &wire::TexcoordSetArgs {
                index: *index, values: Some(values),
            })
        }).collect();
        let source_texcoords = (!uv_sets.is_empty()).then(|| builder.create_vector(&uv_sets));
        let normal_map = material.normal_map.as_ref().map(|map| encode_map(&mut builder, map)).transpose()?;
        let metallic_map = material.metallic_map.as_ref().map(|map| encode_map(&mut builder, map)).transpose()?;
        let object_normal_basis = material.object_normal_basis.as_ref().map(|basis| builder.create_vector(basis));
        primitives.push(wire::Primitive::create(&mut builder, &wire::PrimitiveArgs {
            name: Some(name), positions: Some(positions), normals: Some(normals),
            texcoords: Some(texcoords), colors: Some(colors), indices: Some(indices),
            base_color: Some(base_color), texture_index,
            alpha_mode: match material.alpha_mode {
                AlphaMode::Opaque => wire::AlphaMode::Opaque,
                AlphaMode::Mask => wire::AlphaMode::Mask,
                AlphaMode::Blend => wire::AlphaMode::Blend,
            },
            alpha_cutoff: material.alpha_cutoff, double_sided: material.double_sided,
            wrap_u: encode_wrap(material.wrap[0]), wrap_v: encode_wrap(material.wrap[1]),
            emissive, emissive_texture_index, emissive_texcoords,
            emissive_wrap_u: encode_wrap(material.emissive_wrap[0]),
            emissive_wrap_v: encode_wrap(material.emissive_wrap[1]),
            source_texcoords,
            metallic: material.metallic, roughness: material.roughness, normal_map, metallic_map, object_normal_basis,
        }));
    }
    let name = builder.create_string(&asset.name);
    let textures = builder.create_vector(&textures);
    let primitives = builder.create_vector(&primitives);
    let root = wire::ModelAsset::create(&mut builder, &wire::ModelAssetArgs {
        version: 1, name: Some(name), primitives: Some(primitives), textures: Some(textures),
    });
    wire::finish_model_asset_buffer(&mut builder, root);
    Ok(builder.finished_data().to_vec())
}

/// Verify the FlatBuffer and its mesh invariants before handing it to a consumer such as Bevy.
pub fn decode_asset(bytes: &[u8]) -> Result<ModelAsset, String> {
    if bytes.len() < 8 || bytes.len() > 80 * 1024 * 1024 || !wire::model_asset_buffer_has_identifier(bytes) {
        return Err("不是有效的 DWMA 模型资产".into());
    }
    let root = wire::root_as_model_asset(bytes).map_err(|e| format!("模型资产损坏：{e}"))?;
    if root.version() != 1 { return Err("不支持此模型资产版本".into()); }
    if root.primitives().len() > crate::MAX_TRIANGLES || root.textures().is_some_and(|v| v.len() > 1024) {
        return Err("模型资产包含过多网格或贴图".into());
    }
    let textures = root.textures().map_or_else(Vec::new, |items| items.iter().map(|texture| Texture {
        name: texture.name().unwrap_or_default().to_owned(), width: texture.width(), height: texture.height(),
        rgba: texture.rgba().bytes().to_vec(),
    }).collect());
    let mut primitives = Vec::new();
    for primitive in root.primitives() {
        if primitive.positions().len() > crate::MAX_VERTICES * 3
            || primitive.normals().len() > crate::MAX_VERTICES * 3
            || primitive.texcoords().is_some_and(|v| v.len() > crate::MAX_VERTICES * 2)
            || primitive.emissive_texcoords().is_some_and(|v| v.len() > crate::MAX_VERTICES * 2)
            || primitive.colors().is_some_and(|v| v.len() > crate::MAX_VERTICES * 4)
            || primitive.indices().len() > crate::MAX_TRIANGLES * 3 {
            return Err("模型网格数据过大".into());
        }
        let positions: Vec<_> = primitive.positions().iter().collect();
        let normals: Vec<_> = primitive.normals().iter().collect();
        let texcoords: Vec<_> = primitive.texcoords().map_or_else(Vec::new, |values| values.iter().collect());
        let colors: Vec<_> = primitive.colors().map_or_else(Vec::new, |values| values.iter().collect());
        let color: Vec<_> = primitive.base_color().iter().collect();
        let emissive_texcoords: Vec<_> = primitive.emissive_texcoords()
            .map_or_else(Vec::new, |values| values.iter().collect());
        let mut source_texcoords = Vec::new();
        if let Some(sets) = primitive.source_texcoords() {
            if sets.len() > 6 { return Err("模型原始 UV 集合过多".into()); }
            for set in sets {
                let values = set.values();
                if values.len() != positions.len() / 3 * 2 {
                    return Err("模型原始 UV 数据长度无效".into());
                }
                let coords = (0..values.len()).step_by(2)
                    .map(|index| [values.get(index), values.get(index + 1)]).collect();
                source_texcoords.push((set.index(), coords));
            }
        }
        let emissive = match primitive.emissive() {
            Some(values) if values.len() == 3 => [values.get(0), values.get(1), values.get(2)],
            None => [0.0; 3],
            _ => return Err("模型自发光颜色长度无效".into()),
        };
        if positions.len() % 3 != 0 || normals.len() % 3 != 0 || texcoords.len() % 2 != 0
            || emissive_texcoords.len() % 2 != 0 || primitive.emissive_texture_index() < -1
            || colors.len() % 4 != 0 || color.len() != 4 || primitive.texture_index() < -1 {
            return Err("模型属性长度无效".into());
        }
        let count = positions.len() / 3;
        let object_normal_basis = match primitive.object_normal_basis() {
            Some(values) if values.len() == 9 => Some(std::array::from_fn(|i| values.get(i))),
            None => None,
            _ => return Err("物体空间法线矩阵长度无效".into()),
        };
        primitives.push(Primitive {
            name: primitive.name().unwrap_or_default().to_owned(),
            positions: positions.chunks_exact(3).map(|v| [v[0], v[1], v[2]]).collect(),
            normals: normals.chunks_exact(3).map(|v| [v[0], v[1], v[2]]).collect(),
            texcoords: texcoords.chunks_exact(2).map(|v| [v[0], v[1]]).collect(),
            colors: colors.chunks_exact(4).map(|v| [v[0], v[1], v[2], v[3]]).collect(),
            indices: primitive.indices().iter().collect(), base_color: [color[0], color[1], color[2], color[3]],
            texture_index: usize::try_from(primitive.texture_index()).ok(),
            source_texcoords,
            material: Material {
                alpha_mode: match primitive.alpha_mode() {
                    wire::AlphaMode::Opaque => AlphaMode::Opaque,
                    wire::AlphaMode::Mask => AlphaMode::Mask,
                    wire::AlphaMode::Blend => AlphaMode::Blend,
                    _ => return Err("不支持此模型透明模式".into()),
                },
                alpha_cutoff: primitive.alpha_cutoff(), double_sided: primitive.double_sided(),
                wrap: [decode_wrap(primitive.wrap_u())?, decode_wrap(primitive.wrap_v())?],
                emissive, emissive_texture_index: usize::try_from(primitive.emissive_texture_index()).ok(),
                emissive_texcoords: emissive_texcoords.chunks_exact(2).map(|v| [v[0], v[1]]).collect(),
                emissive_wrap: [decode_wrap(primitive.emissive_wrap_u())?,
                    decode_wrap(primitive.emissive_wrap_v())?],
                metallic: primitive.metallic(), roughness: primitive.roughness(), object_normal_basis,
                normal_map: primitive.normal_map().map(|map| decode_map(map, count)).transpose()?,
                metallic_map: primitive.metallic_map().map(|map| decode_map(map, count)).transpose()?,
            },
        });
    }
    let asset = ModelAsset { name: root.name().to_owned(), primitives, textures };
    asset.validate()?;
    Ok(asset)
}
