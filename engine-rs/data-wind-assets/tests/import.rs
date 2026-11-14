use std::collections::HashMap;
use std::io::Cursor;

use data_wind_assets::{AlphaMode, WrapMode, decode_asset, encode_asset, import_model};

fn png() -> Vec<u8> {
    let image = image::RgbaImage::from_raw(1, 1, vec![255, 32, 16, 255]).unwrap();
    let mut bytes = Cursor::new(Vec::new());
    image::DynamicImage::ImageRgba8(image).write_to(&mut bytes, image::ImageFormat::Png).unwrap();
    bytes.into_inner()
}

fn gltf_fixture() -> (Vec<u8>, HashMap<String, Vec<u8>>) {
    let mut bin = Vec::new();
    for value in [0.0_f32, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0,
        0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0,
        0.0, 0.0, 1.0, 0.0, 0.0, 1.0] { bin.extend_from_slice(&value.to_le_bytes()); }
    for index in [0_u16, 1, 2] { bin.extend_from_slice(&index.to_le_bytes()); }
    let json = serde_json::json!({
        "asset": {"version":"2.0"},
        "buffers": [{"byteLength":102,"uri":"mesh.bin"}],
        "bufferViews": [
            {"buffer":0,"byteOffset":0,"byteLength":36}, {"buffer":0,"byteOffset":36,"byteLength":36},
            {"buffer":0,"byteOffset":72,"byteLength":24}, {"buffer":0,"byteOffset":96,"byteLength":6}
        ],
        "accessors": [
            {"bufferView":0,"componentType":5126,"count":3,"type":"VEC3","min":[0,0,0],"max":[1,1,0]},
            {"bufferView":1,"componentType":5126,"count":3,"type":"VEC3"},
            {"bufferView":2,"componentType":5126,"count":3,"type":"VEC2"},
            {"bufferView":3,"componentType":5123,"count":3,"type":"SCALAR"}
        ],
        "images":[{"uri":"textures/color.png"}], "textures":[{"source":0}],
        "materials":[{"pbrMetallicRoughness":{"baseColorFactor":[0.5,1.0,1.0,1.0],"baseColorTexture":{"index":0}}}],
        "meshes":[{"name":"Triangle","primitives":[{"attributes":{"POSITION":0,"NORMAL":1,"TEXCOORD_0":2},"indices":3,"material":0}]}],
        "nodes":[{"mesh":0,"translation":[2,3,4],"scale":[-2,1,1]},{"mesh":0,"translation":[0,0,1]}],
        "scenes":[{"nodes":[0,1]}],"scene":0
    });
    let files = HashMap::from([("model/mesh.bin".into(), bin), ("model/textures/color.png".into(), png())]);
    (serde_json::to_vec(&json).unwrap(), files)
}

#[test]
fn gltf_preserves_attributes_textures_instances_and_transforms() {
    let (bytes, files) = gltf_fixture();
    let asset = import_model("model/scene.gltf", &bytes, &files).unwrap();
    assert_eq!(asset.primitives.len(), 2);
    assert_eq!(asset.textures.len(), 1);
    let mesh = &asset.primitives[0];
    assert_eq!(mesh.positions, vec![[2., 3., 4.], [0., 3., 4.], [2., 4., 4.]]);
    assert_eq!(mesh.normals, vec![[0., 0., 1.]; 3]);
    assert_eq!(mesh.texcoords, vec![[0., 0.], [1., 0.], [0., 1.]]);
    assert_eq!(mesh.source_texcoords, vec![(0, mesh.texcoords.clone())]);
    assert_eq!(mesh.indices, vec![0, 2, 1]);
    assert_eq!(mesh.texture_index, Some(0));
    assert_eq!(mesh.base_color, [0.5, 1., 1., 1.]);
    assert_eq!(asset.textures[0].rgba, vec![255, 32, 16, 255]);
    assert_eq!(decode_asset(&encode_asset(&asset).unwrap()).unwrap(), asset);
}

#[test]
fn gltf_texture_transform_applies_its_uv_set_scale_rotation_and_offset() {
    let (bytes, files) = gltf_fixture();
    let mut json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    json["extensionsUsed"] = serde_json::json!(["KHR_texture_transform"]);
    json["extensionsRequired"] = json["extensionsUsed"].clone();
    json["meshes"][0]["primitives"][0]["attributes"]["TEXCOORD_1"] = serde_json::json!(2);
    json["materials"][0]["pbrMetallicRoughness"]["baseColorTexture"]["extensions"] = serde_json::json!({
        "KHR_texture_transform": {
            "texCoord": 1, "scale": [2, 3], "rotation": std::f32::consts::FRAC_PI_2,
            "offset": [0.25, 0.5]
        }
    });
    let bytes = serde_json::to_vec(&json).unwrap();
    let asset = import_model("model/scene.gltf", &bytes, &files).unwrap();
    assert_eq!(asset.primitives[0].source_texcoords[1], (1, vec![[0., 0.], [1., 0.], [0., 1.]]));
    for (actual, expected) in asset.primitives[0].texcoords.iter().zip(
        [[0.25, 0.5], [0.25, 2.5], [-2.75, 0.5]],
    ) {
        assert!((actual[0] - expected[0]).abs() < 1e-6);
        assert!((actual[1] - expected[1]).abs() < 1e-6);
    }
}

#[test]
fn gltf_material_keeps_alpha_cutoff_wrapping_and_independent_emissive_uvs() {
    let (bytes, files) = gltf_fixture();
    let mut json: serde_json::Value = serde_json::from_slice(&bytes).expect("fixture JSON");
    json["extensionsUsed"] = serde_json::json!(["KHR_texture_transform"]);
    json["samplers"] = serde_json::json!([{"wrapS":33071,"wrapT":33648}]);
    json["textures"][0]["sampler"] = serde_json::json!(0);
    let material = &mut json["materials"][0];
    material["alphaMode"] = serde_json::json!("MASK");
    material["alphaCutoff"] = serde_json::json!(0.75);
    material["doubleSided"] = serde_json::json!(true);
    material["emissiveFactor"] = serde_json::json!([0.25, 0.5, 1.0]);
    material["emissiveTexture"] = serde_json::json!({"index":0,"extensions": {
        "KHR_texture_transform":{"offset":[0.25,-0.5]}
    }});
    material["normalTexture"] = serde_json::json!({"index":0,"scale":0.4,"extensions": {
        "KHR_texture_transform":{"offset":[0.5,0.25]}
    }});
    material["pbrMetallicRoughness"]["metallicRoughnessTexture"] = serde_json::json!({"index":0});
    material["pbrMetallicRoughness"]["metallicFactor"] = serde_json::json!(0.3);
    material["pbrMetallicRoughness"]["roughnessFactor"] = serde_json::json!(0.7);
    let bytes = serde_json::to_vec(&json).expect("modified JSON");
    let asset = import_model("model/scene.gltf", &bytes, &files).expect("material fixtures import");
    let mesh = &asset.primitives[0];
    assert_eq!(mesh.material.alpha_mode, AlphaMode::Mask);
    assert_eq!(mesh.material.alpha_cutoff, 0.75);
    assert!(mesh.material.double_sided);
    assert_eq!(mesh.material.wrap, [WrapMode::Clamp, WrapMode::Mirror]);
    assert_eq!(mesh.material.emissive, [0.25, 0.5, 1.0]);
    assert_eq!(mesh.material.emissive_texture_index, mesh.texture_index);
    assert_eq!(mesh.texcoords[0], [0.0, 0.0]);
    assert_eq!(mesh.material.emissive_texcoords[0], [0.25, -0.5]);
    assert_eq!(mesh.material.roughness, 0.7);
    assert_eq!(mesh.material.metallic, 0.3);
    let normal = mesh.material.normal_map.as_ref().expect("normal map");
    assert_eq!(normal.strength, 0.4);
    assert_eq!(normal.texcoords[0], [0.5, 0.25]);
    let packed = mesh.material.metallic_map.as_ref().expect("packed metallic map");
    assert_eq!(packed.texcoords, mesh.texcoords);
    assert_eq!(packed.wrap, [WrapMode::Clamp, WrapMode::Mirror]);
    let encoded = encode_asset(&asset).expect("encoded asset");
    assert_eq!(decode_asset(&encoded).expect("decoded asset"), asset);
}

#[test]
fn obj_triangulates_resolves_mtl_and_texture_and_generates_normals() {
    let obj = b"mtllib materials/test.mtl\no square\nv 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nvt 0 0\nvt 1 0\nvt 1 1\nvt 0 1\nusemtl paint\nf 1/1 2/2 3/3 4/4\n";
    let files = HashMap::from([
        ("scene/materials/test.mtl".into(), b"newmtl paint\nKd 0.25 0.5 0.75\nmap_Kd ../red.png\n".to_vec()),
        ("scene/red.png".into(), png()),
    ]);
    let asset = import_model("scene/square.obj", obj, &files).unwrap();
    let mesh = &asset.primitives[0];
    assert_eq!(mesh.indices.len(), 6);
    assert_eq!(mesh.positions.len(), 4);
    assert_eq!(mesh.texcoords[0], [0., 1.]);
    assert!(mesh.normals.iter().all(|n| *n == [0., 0., 1.]));
    assert_eq!(mesh.base_color, [0.25, 0.5, 0.75, 1.]);
    assert_eq!(asset.textures[0].rgba, vec![255, 32, 16, 255]);
    assert_eq!(decode_asset(&encode_asset(&asset).unwrap()).unwrap(), asset);
}

#[test]
fn missing_resources_malformed_buffers_and_untrusted_assets_fail_cleanly() {
    let (bytes, mut files) = gltf_fixture();
    files.remove("model/textures/color.png");
    assert!(import_model("model/scene.gltf", &bytes, &files).unwrap_err().contains("缺少"));
    files.insert("model/textures/color.png".into(), png());
    files.insert("model/mesh.bin".into(), vec![0; 4]);
    assert!(import_model("model/scene.gltf", &bytes, &files).is_err());
    assert!(decode_asset(b"not a flatbuffer").is_err());
    let obj = b"mtllib https://invalid/other.mtl\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n";
    assert!(import_model("scene.obj", obj, &HashMap::new()).is_err());
}
