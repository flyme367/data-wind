//! 命令行校验模型文件能否通过 data-wind 导入门禁（2 万面 / 20 万顶点 / 网格属性合法性）。
//! 用法: cargo run -p data-wind-assets --example validate_model -- <model1> [model2 ...]
use std::collections::HashMap;

/// 复现导入器的节点遍历累计逻辑，定位顶点/三角面在哪一步超限。
fn debug_gltf_walk(path: &str, bytes: &[u8]) -> Result<(), String> {
    use gltf::Gltf;
    let source = Gltf::from_slice(bytes).map_err(|e| e.to_string())?;
    let blob = source.blob.clone().unwrap_or_default();
    let mut positions: usize = 0;
    let mut tris: usize = 0;
    let mut rows: Vec<String> = Vec::new();
    let roots: Vec<usize> = source.default_scene().or_else(|| source.scenes().next())
        .map(|scene| scene.nodes().map(|n| n.index()).collect()).unwrap_or_default();
    let mut stack: Vec<(usize, usize)> = roots.into_iter().map(|i| (i, 0usize)).collect();
    while let Some((index, depth)) = stack.pop() {
        let node = source.nodes().nth(index).ok_or("节点越界")?;
        if let Some(mesh) = node.mesh() {
            let mut mesh_positions = 0usize;
            let mut mesh_tris = 0usize;
            for primitive in mesh.primitives() {
                let reader = primitive.reader(|_| Some(blob.as_slice()));
                mesh_positions += reader.read_positions().map_or(0, |p| p.count());
                mesh_tris += reader.read_indices().map_or(0, |i| i.into_u32().count()) / 3;
            }
            positions += mesh_positions;
            tris += mesh_tris;
            rows.push(format!("d{depth}:{}/p{mesh_positions}/t{mesh_tris}", mesh.name().unwrap_or("?")));
        }
        for child in node.children() { stack.push((child.index(), depth + 1)); }
    }
    println!("{path}|DEBUG|verts={positions}|tris={tris}|{}", rows.join(" "));
    Ok(())
}

fn main() {
    for path in std::env::args().skip(1) {
        let bytes = match std::fs::read(&path) {
            Ok(bytes) => bytes,
            Err(error) => {
                println!("{path}|ERROR|读取失败：{error}");
                continue;
            }
        };
        let name = std::path::Path::new(&path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(&path)
            .to_string();
        match data_wind_assets::import_model(&path, &bytes, &HashMap::new()) {
            Ok(asset) => {
                let verts: usize = asset.primitives.iter().map(|p| p.positions.len()).sum();
                let tris: usize = asset.primitives.iter().map(|p| p.indices.len() / 3).sum();
                match asset.validate() {
                    Ok(()) => println!(
                        "{name}|OK|prims={}|verts={verts}|tris={tris}|textures={}",
                        asset.primitives.len(),
                        asset.textures.len()
                    ),
                    Err(error) => println!("{name}|INVALID|verts={verts}|tris={tris}|{error}"),
                }
            }
            Err(error) => {
                println!("{name}|PARSE_FAIL|{error}");
                if error.contains("20 万") {
                    if let Err(debug) = debug_gltf_walk(&path, &bytes) { println!("{name}|DEBUG_FAIL|{debug}"); }
                }
            }
        }
    }
}
