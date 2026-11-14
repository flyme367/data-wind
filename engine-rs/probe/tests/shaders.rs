use std::{fs, path::Path};

fn validate_shader(path: &Path) -> naga::Module {
    let source = fs::read_to_string(path).expect("shader file must exist");
    let module = naga::front::wgsl::parse_str(&source)
        .unwrap_or_else(|error| panic!("{}: {}", path.display(), error.emit_to_string(&source)));
    naga::valid::Validator::new(
        naga::valid::ValidationFlags::all(),
        naga::valid::Capabilities::all(),
    )
    .validate(&module)
    .unwrap_or_else(|error| panic!("{}: {error:?}", path.display()));
    module
}

#[test]
fn every_render_and_compute_shader_is_valid_wgsl() {
    for directory in ["../data-wind-engine/src/shaders", "../oxgpu/src/shaders"] {
        for entry in fs::read_dir(directory).expect("shader directory exists") {
            let path = entry.expect("read shader entry").path();
            if path
                .extension()
                .is_some_and(|extension| extension == "wgsl")
            {
                validate_shader(&path);
            }
        }
    }
}

#[test]
fn storage_array_strides_match_the_host_buffers() {
    let cases = [
        (
            "../data-wind-engine/src/shaders/water.wgsl",
            "WaterUniforms",
            752,
        ),
        (
            "../data-wind-engine/src/shaders/water_sim.wgsl",
            "WaterUniforms",
            752,
        ),
        ("../oxgpu/src/shaders/cull.wgsl", "BoundingSphere", 32),
        ("../oxgpu/src/shaders/flyline.wgsl", "Arc", 80),
        ("../data-wind-engine/src/shaders/arc.wgsl", "Arc", 80),
        ("../data-wind-engine/src/shaders/box.wgsl", "GInstance", 64),
        (
            "../data-wind-engine/src/shaders/model.wgsl",
            "GInstance",
            64,
        ),
        (
            "../data-wind-engine/src/shaders/terrain.wgsl",
            "TerrainUniforms",
            64,
        ),
    ];
    for (path, name, expected_span) in cases {
        let module = validate_shader(Path::new(path));
        let structure = module.types.iter().find_map(|(_, ty)| {
            if ty.name.as_deref() != Some(name) {
                return None;
            }
            if let naga::TypeInner::Struct { span, .. } = ty.inner {
                Some(span)
            } else {
                None
            }
        });
        assert_eq!(
            structure,
            Some(expected_span),
            "{path}: host/storage layout drift"
        );
    }
}

#[test]
fn frame_uniform_field_offsets_match_the_rust_layout_in_every_shader() {
    let expected = [
        ("vp", 0),
        ("view", 64),
        ("proj", 128),
        ("cam_pos", 192),
        ("misc", 208),
        ("misc2", 224),
        ("background", 240),
        ("ground", 256),
        ("light", 272),
        ("light_color", 288),
        ("light_vp", 304),
        ("shadow", 368),
    ];
    for entry in fs::read_dir("../data-wind-engine/src/shaders").expect("shader directory") {
        let path = entry.expect("shader entry").path();
        let module = validate_shader(&path);
        for (_, ty) in module.types.iter() {
            if ty.name.as_deref() != Some("FrameParams") {
                continue;
            }
            let naga::TypeInner::Struct { ref members, span } = ty.inner else {
                panic!("frame must be a struct")
            };
            assert_eq!(span, 384, "{}: uniform size", path.display());
            for (member, (name, offset)) in members.iter().zip(expected) {
                assert_eq!(
                    member.name.as_deref(),
                    Some(name),
                    "{}: field order",
                    path.display()
                );
                assert_eq!(member.offset, offset, "{}: {name} offset", path.display());
            }
            assert_eq!(members.len(), expected.len());
        }
    }
}
