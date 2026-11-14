#[path = "../../data-wind-cpu/src/board/mod.rs"]
#[allow(dead_code)]
mod board;
#[path = "../../data-wind-cpu/src/camera.rs"]
#[allow(dead_code)]
mod camera;
#[path = "../../data-wind-cpu/src/common.rs"]
#[allow(dead_code)]
mod common;
#[path = "../../data-wind-cpu/src/mesh.rs"]
#[allow(dead_code)]
mod mesh;
#[path = "../../data-wind-cpu/src/picking.rs"]
#[allow(dead_code)]
mod picking;
#[path = "../../data-wind-cpu/src/protocol.rs"]
#[allow(dead_code)]
mod protocol;
#[path = "../../data-wind-engine/src/scene.rs"]
#[allow(dead_code)]
mod scene;
#[path = "../../data-wind-cpu/src/software.rs"]
#[allow(dead_code)]
mod software;
#[path = "../../data-wind-cpu/src/terrain.rs"]
#[allow(dead_code)]
mod terrain;

use scene::FlatInstanceIn;
use software::{SoftwareCamera, SoftwareInput, SoftwareOptions};

fn screen_point(camera: &camera::Camera, position: glam::Vec3) -> egui::Pos2 {
    let clip = camera.vp(1.0) * position.extend(1.0);
    egui::pos2(
        (clip.x / clip.w + 1.0) * 200.0,
        (1.0 - clip.y / clip.w) * 200.0,
    )
}

fn instance(
    id: &str,
    kind: &str,
    pos: [f32; 3],
    size: [f32; 3],
    color: [f32; 3],
) -> FlatInstanceIn {
    FlatInstanceIn {
        id: id.into(),
        kind: kind.into(),
        pos,
        size,
        rot_y: 0.0,
        rotation: None,
        color,
        locked: None,
        to: None,
        model_id: None,
        terrain: None,
        water: None,
    }
}

fn input(instances: Vec<FlatInstanceIn>) -> SoftwareInput {
    SoftwareInput {
        instances,
        camera: SoftwareCamera {
            target: [0.0, 0.0, 0.0],
            yaw: 0.0,
            pitch: 0.1,
            dist: 10.0,
        },
        options: SoftwareOptions::default(),
    }
}

#[test]
fn software_picking_uses_visible_triangles_and_selects_objects_behind_gaps() {
    let mut renderer = software::SoftwareScene::default();
    let positions = [[-0.5, -0.5, 0.0], [0.5, -0.5, 0.0], [-0.5, 0.5, 0.0]];
    let mut bytes = Vec::from(&b"DWM1\x03\0\0\0"[..]);
    for position in positions {
        let vertex = mesh::ModelVertex {
            position,
            normal: [0.0, 0.0, 1.0],
            color: [1.0; 3],
        };
        bytes.extend_from_slice(bytemuck::bytes_of(&vertex));
    }
    renderer
        .register_mesh("triangle", &bytes)
        .expect("valid triangle");
    let mut front = instance("front", "mesh", [0.0, 0.0, 0.0], [4.0, 4.0, 2.0], [1.0; 3]);
    front.model_id = Some("triangle".into());
    let back = instance("back", "box", [0.0, 0.0, -2.0], [4.0, 4.0, 1.0], [1.0; 3]);
    let camera = camera::Camera::new(glam::Vec3::ZERO, 0.0, 0.1, 10.0);
    let hit = screen_point(&camera, glam::Vec3::new(-1.0, -1.0, 0.0));
    let gap = screen_point(&camera, glam::Vec3::new(1.0, 1.0, 0.0));
    renderer.render(400, 400, &input(vec![front.clone()]), false);
    assert_eq!(renderer.pick(hit), Some("front"));
    assert_eq!(renderer.pick(gap), None);
    renderer.render(400, 400, &input(vec![front, back]), false);
    assert_eq!(renderer.pick(hit), Some("front"));
    assert_eq!(renderer.pick(gap), Some("back"));
    renderer.render(400, 400, &input(vec![]), true);
    assert_eq!(
        renderer.pick(gap),
        Some("back"),
        "captures must not replace live hit data"
    );
    renderer.render(400, 400, &input(vec![]), false);
    assert_eq!(renderer.pick(gap), None);
}

#[test]
fn software_marker_keeps_its_expanded_hit_area_in_front_of_a_mesh() {
    let scene = input(vec![
        instance(
            "background",
            "box",
            [0.0, 0.0, -4.0],
            [6.0, 6.0, 1.0],
            [1.0; 3],
        ),
        instance(
            "marker",
            "marker",
            [0.0, 0.0, 0.0],
            [1.0, 1.0, 1.0],
            [1.0, 0.0, 0.0],
        ),
    ]);
    let mut renderer = software::SoftwareScene::default();
    renderer.render(400, 400, &scene, false);
    let camera = camera::Camera::new(glam::Vec3::ZERO, 0.0, 0.1, 10.0);
    let center = screen_point(&camera, glam::Vec3::ZERO);
    assert_eq!(
        renderer.pick(center + egui::vec2(10.0, 0.0)),
        Some("marker")
    );
}

#[test]
fn rust_compatibility_rendering_and_capture_preserve_live_picking() {
    let input = |id: &str| SoftwareInput {
        instances: vec![instance(
            id,
            "box",
            [0.0, 0.0, 0.0],
            [5.0; 3],
            [0.3, 0.6, 0.9],
        )],
        camera: SoftwareCamera {
            target: [0.0, 0.0, 0.0],
            yaw: 0.75,
            pitch: 0.55,
            dist: 15.0,
        },
        options: SoftwareOptions {
            grid: true,
            time: 1.0,
            background: Some("#101a2c".into()),
            daylight: Some(1.0),
            ..SoftwareOptions::default()
        },
    };
    let mut renderer = software::SoftwareScene::default();
    let pixels = renderer.render(320, 240, &input("live"), false);
    assert_eq!(pixels.len(), 320 * 240 * 4);
    assert_eq!(renderer.pick(egui::pos2(160.0, 120.0)), Some("live"));
    assert_ne!(
        &pixels[(120 * 320 + 160) * 4..(120 * 320 + 160) * 4 + 3],
        &[16, 26, 44]
    );
    renderer.render(640, 480, &input("capture"), true);
    assert_eq!(renderer.pick(egui::pos2(160.0, 120.0)), Some("live"));
    assert!(renderer.register_mesh("bad", &[0; 20]).is_err());
}

#[path = "../../data-wind-cpu/src/water.rs"]
#[allow(dead_code)]
mod water;
