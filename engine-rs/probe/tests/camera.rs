#[path = "../../data-wind-cpu/src/camera.rs"]
mod camera;

use camera::{Camera, ray_box, ray_horizontal_plane, ray_sphere};
use glam::{Vec3, Vec4};

#[test]
fn webgpu_projection_keeps_world_up_on_the_top_of_the_screen() {
    let camera = Camera::new(Vec3::ZERO, 0.0, 0.0, 10.0);
    let bottom = camera.vp(1.0) * Vec4::new(0.0, 0.0, 0.0, 1.0);
    let top = camera.vp(1.0) * Vec4::new(0.0, 2.0, 0.0, 1.0);
    assert!(top.y / top.w > bottom.y / bottom.w);
    assert!((0.0..=1.0).contains(&(bottom.z / bottom.w)));
}

#[test]
fn frustum_planes_have_unit_spatial_normals() {
    let camera = Camera::new(Vec3::ZERO, 0.7, 0.4, 58.0);
    for [x, y, z, _distance] in camera.frustum_planes(16.0 / 9.0) {
        assert!((Vec3::new(x, y, z).length() - 1.0).abs() < 1e-5);
    }
}

#[test]
fn screen_projection_and_picking_agree() {
    let camera = Camera::new(Vec3::ZERO, 0.7, 0.4, 58.0);
    let world = Vec3::new(3.0, 4.0, -2.0);
    let clip = camera.vp(16.0 / 9.0) * world.extend(1.0);
    let ndc = clip.truncate() / clip.w;
    let (origin, direction) = camera.pick_ray(
        16.0 / 9.0,
        f64::from((ndc.x + 1.0) * 0.5 * 1280.0),
        f64::from((1.0 - ndc.y) * 0.5 * 720.0),
        1280.0,
        720.0,
    );
    assert!((world - origin).cross(direction).length() < 0.01);
    assert!(ray_sphere(origin, direction, world, 1.0).is_some());
}

#[test]
fn drag_ray_intersects_the_object_height_and_rejects_horizon() {
    let camera = Camera::new(Vec3::ZERO, 0.7, 0.4, 58.0);
    let (origin, direction) = camera.pick_ray(16.0 / 9.0, 640.0, 360.0, 1280.0, 720.0);
    let point = ray_horizontal_plane(origin, direction, 0.0).expect("center ray hits ground");
    assert!(point.length() < 0.01);
    assert!(ray_horizontal_plane(Vec3::Y, Vec3::X, 0.0).is_none());
    assert!(ray_horizontal_plane(Vec3::Y, Vec3::Y, 0.0).is_none());
}

#[test]
fn rotated_box_picking_uses_the_inverse_of_the_render_rotation() {
    let half = Vec3::new(4.0, 1.0, 0.5);
    let angle = std::f32::consts::FRAC_PI_4;
    let center_of_end = Vec3::new(3.5 * angle.cos(), 0.0, -3.5 * angle.sin());
    assert!(
        ray_box(
            center_of_end + Vec3::Y * 5.0,
            -Vec3::Y,
            Vec3::ZERO,
            half,
            angle
        )
        .is_some()
    );
    assert!(ray_box(Vec3::new(4.0, 5.0, 4.0), -Vec3::Y, Vec3::ZERO, half, angle).is_none());
}

#[test]
fn three_axis_box_picking_matches_the_rendering_rotation() {
    let rotation = glam::Quat::from_euler(glam::EulerRot::YXZ, 0.4, 0.7, -0.6);
    let center = Vec3::new(3.0, 4.0, -2.0);
    let origin = center + rotation * Vec3::new(0.0, 0.0, 8.0);
    let direction = rotation * -Vec3::Z;
    let distance = camera::ray_oriented_box(
        origin,
        direction,
        center,
        Vec3::new(1.0, 2.0, 3.0),
        rotation,
    );
    assert!((distance.expect("rotated box is hit") - 5.0).abs() < 0.0001);
}
