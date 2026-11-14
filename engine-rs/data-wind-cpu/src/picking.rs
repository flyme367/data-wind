//! Mesh ray queries in model space. Ray parameters remain in world-distance units.
use glam::{Quat, Vec3};
use parry3d::math::Vector;
use parry3d::query::{Ray, RayCast};
use parry3d::shape::TriMesh;

#[derive(Clone)]
pub struct MeshPicking(TriMesh);

impl MeshPicking {
    pub fn new(positions: impl IntoIterator<Item = [f32; 3]>) -> Option<Self> {
        let vertices: Vec<Vector> = positions.into_iter().map(Vector::from_array).collect();
        if vertices.is_empty() || vertices.len() % 3 != 0 {
            return None;
        }
        let indices = (0..u32::try_from(vertices.len()).ok()?)
            .step_by(3)
            .map(|index| [index, index + 1, index + 2])
            .collect();
        TriMesh::new(vertices, indices).ok().map(Self)
    }

    pub fn ray_distance(
        &self,
        origin: Vec3,
        direction: Vec3,
        center: Vec3,
        half: Vec3,
        rotation: Quat,
    ) -> Option<f32> {
        let size = (half * 2.0).abs().max(Vec3::splat(0.001));
        let inverse = rotation.conjugate();
        let origin = (inverse * (origin - center)) / size;
        let direction = (inverse * direction) / size;
        if !origin.is_finite() || !direction.is_finite() {
            return None;
        }
        let ray = Ray::new(
            Vector::from_array(origin.to_array()),
            Vector::from_array(direction.to_array()),
        );
        self.0.cast_local_ray(&ray, f32::MAX, false)
    }
}
