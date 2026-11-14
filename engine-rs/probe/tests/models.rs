#[path = "../../data-wind-cpu/src/mesh.rs"]
#[allow(dead_code)]
mod mesh;
#[path = "../../data-wind-cpu/src/picking.rs"]
#[allow(dead_code)]
mod picking;

use std::{fs, mem, path::Path};

#[test]
fn real_reference_models_have_valid_finite_gpu_vertices() {
    assert_eq!(mem::size_of::<mesh::ModelVertex>(), 36);
    let directory = Path::new("../../frontend/public/models");
    // GLB 原始源在 frontend/model-sources/（构建输入，不在 public/ 内）。
    let sources = Path::new("../../frontend/model-sources");
    let mut count = 0;
    for file in fs::read_dir(directory).expect("reference library exists") {
        let path = file.expect("model entry exists").path();
        if path
            .extension()
            .is_some_and(|extension| extension == "mesh")
        {
            let stem = path.file_stem().expect("mesh has a filename");
            assert!(
                sources
                    .join(stem)
                    .with_extension("glb")
                    .is_file()
            );
            assert!(directory.join(stem).with_extension("preview.webp").is_file());
            let data = fs::read(&path).expect("reference mesh is readable");
            let vertices = mesh::decode_mesh(&data).expect("reference mesh format is valid");
            assert!(
                vertices.len() > 3,
                "{} contains real geometry",
                path.display()
            );
            assert!(
                vertices
                    .iter()
                    .all(|v| v.position.iter().all(|p| p.abs() <= 0.501))
            );
            assert!(vertices.iter().all(|v| {
                let length = v.normal.iter().map(|n| n * n).sum::<f32>().sqrt();
                (length - 1.0).abs() < 0.001
            }));
            count += 1;
        }
    }
    let source_count = fs::read_dir(sources)
        .expect("model sources exist")
        .filter(|entry| {
            entry
                .as_ref()
                .is_ok_and(|entry| entry.path().extension().is_some_and(|ext| ext == "glb"))
        })
        .count();
    assert!(
        count >= 47,
        "the reference library must not lose its original models"
    );
    assert_eq!(
        count, source_count,
        "every source should have a prepared mesh"
    );
}

#[test]
fn corrupt_mesh_input_is_rejected_before_gpu_upload() {
    assert!(mesh::decode_mesh(b"glTF").is_err());
    let mut data = vec![0u8; 8 + 3 * 36];
    data[..4].copy_from_slice(b"DWM1");
    data[4..8].copy_from_slice(&3u32.to_le_bytes());
    assert!(mesh::decode_mesh(&data).is_ok());
    assert!(mesh::decode_mesh(&data[..data.len() - 1]).is_err());
    data[8..12].copy_from_slice(&f32::NAN.to_le_bytes());
    assert!(mesh::decode_mesh(&data).is_err());
}

#[test]
fn dwm2_mesh_roundtrips_and_is_validated() {
    let positions: [[f32; 3]; 3] = [[-0.5, -0.5, 0.0], [0.5, -0.5, 0.0], [0.0, 0.5, 0.0]];
    let mut data = vec![0u8; 16 + 3 * 13 + 3 * 2];
    data[..4].copy_from_slice(b"DWM2");
    data[4..8].copy_from_slice(&3u32.to_le_bytes());
    data[8..12].copy_from_slice(&3u32.to_le_bytes());
    data[12] = 0;
    for (index, position) in positions.iter().enumerate() {
        let base = 16 + index * 13;
        for (axis, value) in position.iter().enumerate() {
            let quantized = ((value + 0.5) * 65535.0).round() as u16;
            data[base + axis * 2..base + axis * 2 + 2].copy_from_slice(&quantized.to_le_bytes());
        }
        // (0,0,1) 编码为 (0,0)；颜色 1.0 → 255。
        data[base + 10..base + 13].copy_from_slice(&[255, 255, 255]);
    }
    for index in 0u16..3 {
        let base = 16 + 3 * 13 + index as usize * 2;
        data[base..base + 2].copy_from_slice(&index.to_le_bytes());
    }
    let vertices = mesh::decode_mesh(&data).expect("dwm2 decodes");
    assert_eq!(vertices.len(), 3);
    assert!((vertices[0].position[0] - (-0.5)).abs() < 0.001);
    assert!((vertices[1].position[0] - 0.5).abs() < 0.001);
    assert!((vertices[2].normal[2] - 1.0).abs() < 0.001);
    assert_eq!(vertices[0].color, [1.0, 1.0, 1.0]);
    assert!(mesh::decode_mesh(&data[..data.len() - 1]).is_err());
    let mut out_of_range = data.clone();
    out_of_range[16 + 3 * 13..16 + 3 * 13 + 2].copy_from_slice(&7u16.to_le_bytes());
    assert!(mesh::decode_mesh(&out_of_range).is_err());
    let mut unknown_flags = data.clone();
    unknown_flags[12] = 2;
    assert!(mesh::decode_mesh(&unknown_flags).is_err());
    let mut odd_indices = data.clone();
    odd_indices[8..12].copy_from_slice(&4u32.to_le_bytes());
    assert!(mesh::decode_mesh(&odd_indices).is_err());
}
