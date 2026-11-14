#[path = "../../data-wind-cpu/src/picking.rs"]
mod picking;

use glam::{EulerRot, Quat, Vec3};
use picking::MeshPicking;

#[test]
fn incomplete_meshes_do_not_build_a_query_structure() {
    assert!(MeshPicking::new([]).is_none());
    assert!(MeshPicking::new([[0.0; 3]]).is_none());
}

#[test]
fn ray_queries_match_triangle_geometry_and_world_distance_after_transform() {
    let mesh = MeshPicking::new([[-0.5, -0.5, 0.0], [0.5, -0.5, 0.0], [-0.5, 0.5, 0.0]])
        .expect("valid triangle");
    let center = Vec3::new(3.0, 2.0, -4.0);
    let rotation = Quat::from_euler(EulerRot::YXZ, 0.4, 0.7, -0.6);
    let half = Vec3::new(2.0, 1.0, 0.5);
    let origin = center + rotation * Vec3::new(-1.0, -0.5, 5.0);
    let direction = rotation * -Vec3::Z;
    let hit = mesh
        .ray_distance(origin, direction, center, half, rotation)
        .expect("hit triangle");
    assert!((hit - 5.0).abs() < 0.0001);
    let miss = center + rotation * Vec3::new(1.5, 0.75, 5.0);
    assert!(
        mesh.ray_distance(miss, direction, center, half, rotation)
            .is_none()
    );
}
