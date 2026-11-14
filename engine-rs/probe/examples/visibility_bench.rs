//! Compare the former per-sphere linear mesh search with the shared visibility pass.
//! Run: cargo run -p native-probe --release --example visibility_bench

#[path = "../../data-wind-engine/src/visibility.rs"]
mod visibility;

use std::hint::black_box;
use std::time::{Duration, Instant};
use visibility::SceneVisibility;

const ITERATIONS: u32 = 2_000;
const PLANES: [[f32; 4]; 6] = [
    [1.0, 0.0, 0.0, 1.0],
    [-1.0, 0.0, 0.0, 1.0],
    [0.0, 1.0, 0.0, 1.0],
    [0.0, -1.0, 0.0, 1.0],
    [0.0, 0.0, 1.0, 1.0],
    [0.0, 0.0, -1.0, 1.0],
];

fn former_statistics(bounds: &[[f32; 4]], meshes: &[(usize, u32)]) -> (u32, u32) {
    let mut visible = 0;
    let mut triangles = 0;
    for (index, [x, y, z, radius]) in bounds.iter().enumerate() {
        if PLANES
            .iter()
            .all(|p| p[0] * x + p[1] * y + p[2] * z + p[3] >= -radius)
        {
            visible += 1;
            triangles += meshes
                .iter()
                .find(|(i, _)| *i == index)
                .map_or(12, |(_, count)| *count);
        }
    }
    (visible, triangles)
}

fn measure(mut work: impl FnMut() -> (u32, u32)) -> Duration {
    for _ in 0..100 {
        black_box(work());
    }
    let start = Instant::now();
    for _ in 0..ITERATIONS {
        black_box(work());
    }
    start.elapsed() / ITERATIONS
}

fn main() {
    for count in [70, 1024] {
        let bounds = vec![[0.0, 0.0, 0.0, 0.5]; count];
        let meshes: Vec<_> = (0..count).map(|index| (index, 240)).collect();
        let mut visibility = SceneVisibility::default();
        visibility.update(&PLANES, bounds.iter().copied(), meshes.iter().copied());
        assert_eq!(
            (visibility.instances, visibility.triangles),
            former_statistics(&bounds, &meshes)
        );
        let before = measure(|| former_statistics(black_box(&bounds), black_box(&meshes)));
        let after = measure(|| {
            visibility.update(
                black_box(&PLANES),
                black_box(&bounds).iter().copied(),
                black_box(&meshes).iter().copied(),
            );
            (visibility.instances, visibility.triangles)
        });
        println!(
            "{count} visible meshes: former={:.2}us shared={:.2}us speedup={:.1}x",
            before.as_secs_f64() * 1e6,
            after.as_secs_f64() * 1e6,
            before.as_secs_f64() / after.as_secs_f64(),
        );
    }
}
