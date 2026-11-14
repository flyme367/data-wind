//! CPU visibility shared by model drawing, the HUD and statistics events.

#[derive(Default)]
pub(crate) struct SceneVisibility {
    mask: Vec<bool>,
    pub instances: u32,
    pub triangles: u32,
}

impl SceneVisibility {
    /// Mesh entries use the same indices as the bounds, with at most one entry per instance.
    /// Reuse the mask allocation and visit each bound and mesh once: O(bounds + meshes).
    pub fn update(
        &mut self,
        planes: &[[f32; 4]; 6],
        bounds: impl IntoIterator<Item = [f32; 4]>,
        meshes: impl IntoIterator<Item = (usize, u32)>,
    ) {
        self.mask.clear();
        self.instances = 0;
        for [x, y, z, radius] in bounds {
            let visible = planes
                .iter()
                .all(|plane| plane[0] * x + plane[1] * y + plane[2] * z + plane[3] >= -radius);
            self.mask.push(visible);
            self.instances += u32::from(visible);
        }
        // Primitive boxes have 12 triangles; replace that count for each visible mesh.
        self.triangles = self.instances * 12;
        for (index, triangles) in meshes {
            if self.is_visible(index) {
                self.triangles = self.triangles - 12 + triangles;
            }
        }
    }

    pub fn is_visible(&self, index: usize) -> bool {
        self.mask.get(index).copied().unwrap_or(false)
    }
}
