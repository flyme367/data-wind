//! 命令行把自包含 glTF/GLB 转成 .dwasset（DWM1）模型文件，与浏览器端
//! ModelImporter 走同一导入路径。用法:
//!   cargo run -p data-wind-assets --example convert_glb -- <model.glb> <out.dwasset>
use std::collections::HashMap;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 3 {
        eprintln!("用法: cargo run -p data-wind-assets --example convert_glb -- <model.glb> <out.dwasset>");
        std::process::exit(1);
    }
    let src = &args[1];
    let dest = &args[2];
    let bytes = match std::fs::read(src) {
        Ok(bytes) => bytes,
        Err(error) => {
            eprintln!("读取失败：{error}");
            std::process::exit(1);
        }
    };
    // import_model 只接受相对路径；GLB 贴图内嵌，无需附带文件
    let name = std::path::Path::new(src)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("model.glb")
        .to_string();
    match data_wind_assets::import_model(&name, &bytes, &HashMap::new()) {
        Ok(asset) => {
            let verts: usize = asset.primitives.iter().map(|p| p.positions.len()).sum();
            let tris: usize = asset.primitives.iter().map(|p| p.indices.len() / 3).sum();
            if let Err(error) = asset.validate() {
                eprintln!("{name} 未通过校验：{error}");
                std::process::exit(1);
            }
            match data_wind_assets::encode_asset(&asset) {
                Ok(encoded) => {
                    if let Err(error) = std::fs::write(dest, &encoded) {
                        eprintln!("写出失败：{error}");
                        std::process::exit(1);
                    }
                    println!(
                        "{name}|OK|prims={}|verts={verts}|tris={tris}|textures={}|bytes={}",
                        asset.primitives.len(),
                        asset.textures.len(),
                        encoded.len()
                    );
                }
                Err(error) => {
                    eprintln!("{name} 编码失败：{error}");
                    std::process::exit(1);
                }
            }
        }
        Err(error) => {
            eprintln!("{name} 导入失败：{error}");
            std::process::exit(1);
        }
    }
}
