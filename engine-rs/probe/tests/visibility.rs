#[path = "../../data-wind-engine/src/visibility.rs"]
mod visibility;

use visibility::SceneVisibility;

const PLANES: [[f32; 4]; 6] = [
    [1.0, 0.0, 0.0, 1.0],
    [-1.0, 0.0, 0.0, 1.0],
    [0.0, 1.0, 0.0, 1.0],
    [0.0, -1.0, 0.0, 1.0],
    [0.0, 0.0, 1.0, 1.0],
    [0.0, 0.0, -1.0, 1.0],
];

#[test]
fn visibility_agrees_at_frustum_edges_and_counts_only_visible_geometry() {
    let mut scene = SceneVisibility::default();
    scene.update(
        &PLANES,
        [
            [0.0, 0.0, 0.0, 0.25],
            [4.0, 0.0, 0.0, 0.25],
            [1.25, 0.0, 0.0, 0.25],
            [0.0, 0.0, 0.0, 0.5],
        ],
        [(0, 100), (1, 300), (3, 0)],
    );
    assert!(scene.is_visible(0));
    assert!(!scene.is_visible(1));
    assert!(scene.is_visible(2));
    assert!(!scene.is_visible(4));
    assert_eq!(scene.instances, 3);
    // A real mesh, a box touching the frustum, and a mesh not registered yet.
    assert_eq!(scene.triangles, 100 + 12);
}

#[test]
fn moving_objects_and_clearing_a_scene_cannot_retain_previous_visibility() {
    let mut scene = SceneVisibility::default();
    scene.update(&PLANES, [[0.0, 0.0, 0.0, 0.25]], [(0, 100)]);
    assert_eq!(scene.triangles, 100);
    scene.update(&PLANES, [[4.0, 0.0, 0.0, 0.25]], [(0, 100)]);
    assert_eq!((scene.instances, scene.triangles), (0, 0));
    scene.update(&PLANES, [], []);
    assert!(!scene.is_visible(0));
    assert_eq!((scene.instances, scene.triangles), (0, 0));
}

#[test]
fn dense_mixed_scene_matches_independent_reference_statistics() {
    let bounds: Vec<_> = (0_u32..1024)
        .map(|i| [i as f32 / 100.0 - 5.0, 0.0, 0.0, 0.25])
        .collect();
    let meshes: Vec<_> = (0_usize..bounds.len())
        .filter(|i| i % 3 != 0)
        .map(|i| (i, if i % 5 == 0 { 0 } else { 240 }))
        .collect();
    let mut expected = (0, 0);
    for (index, [x, y, z, radius]) in bounds.iter().enumerate() {
        if PLANES
            .iter()
            .all(|p| p[0] * x + p[1] * y + p[2] * z + p[3] >= -radius)
        {
            expected.0 += 1;
            expected.1 += meshes
                .iter()
                .find(|(i, _)| *i == index)
                .map_or(12, |(_, tris)| *tris);
        }
    }
    let mut scene = SceneVisibility::default();
    scene.update(&PLANES, bounds, meshes);
    assert_eq!((scene.instances, scene.triangles), expected);
}
