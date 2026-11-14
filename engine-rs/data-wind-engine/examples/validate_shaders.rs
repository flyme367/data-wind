//! 命令行验证所有 WGSL 着色器能被 naga 正确解析与校验（与 wgpu 30 的编译前端一致）。
//! 用法: cargo run -p data-wind-engine --example validate_shaders
fn main() {
    let manifest = env!("CARGO_MANIFEST_DIR");
    let shaders = [
        "sky", "model", "ground", "box", "grid", "marker", "fence", "arc", "particle",
        "ring", "blit", "shadow",
    ];
    let mut failures = 0usize;
    for name in shaders {
        let path = format!("{manifest}/src/shaders/{name}.wgsl");
        let source = match std::fs::read_to_string(&path) {
            Ok(source) => source,
            Err(error) => {
                println!("{name}|READ_FAIL|{error}");
                failures += 1;
                continue;
            }
        };
        // wgpu 的深度管线会做 uniformity 分析：这里用同样严格的 valid 校验
        let parsed = match naga::front::wgsl::parse_str(&source) {
            Ok(module) => module,
            Err(errors) => {
                failures += 1;
                println!("{name}|PARSE_ERROR|{errors}");
                continue;
            }
        };
        let mut validator = naga::valid::Validator::new(
            naga::valid::ValidationFlags::all(),
            naga::valid::Capabilities::all(),
        );
        match validator.validate(&parsed) {
            Ok(_) => println!("{name}|OK"),
            Err(errors) => {
                failures += 1;
                println!("{name}|VALIDATE_ERROR|{errors}");
            }
        }
    }
    println!("SUMMARY ok={} fail={}", shaders.len() - failures, failures);
    if failures > 0 {
        std::process::exit(1);
    }
}
