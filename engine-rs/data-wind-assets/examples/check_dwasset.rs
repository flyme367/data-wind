//! 命令行校验 .dwasset（DWM1）文件能否被 decode_asset 正确解码。
//! 用法: cargo run -p data-wind-assets --example check_dwasset -- <file1.dwasset> [file2 ...]
fn main() {
    let mut ok = 0usize;
    let mut fail = 0usize;
    for path in std::env::args().skip(1) {
        match std::fs::read(&path) {
            Ok(bytes) => match data_wind_assets::decode_asset(&bytes) {
                Ok(asset) => match asset.validate() {
                    Ok(()) => {
                        let tris: usize = asset.primitives.iter().map(|p| p.indices.len() / 3).sum();
                        println!("{path}|OK|prims={}|tris={tris}|textures={}", asset.primitives.len(), asset.textures.len());
                        ok += 1;
                    }
                    Err(error) => {
                        println!("{path}|INVALID|{error}");
                        fail += 1;
                    }
                },
                Err(error) => {
                    println!("{path}|DECODE_FAIL|{error}");
                    fail += 1;
                }
            },
            Err(error) => {
                println!("{path}|READ_FAIL|{error}");
                fail += 1;
            }
        }
    }
    println!("SUMMARY ok={ok} fail={fail}");
    if fail > 0 {
        std::process::exit(1);
    }
}
