//! 静止时复用 GPU 视锥剔除结果，输入变化后再重新计算。

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct CullSignature {
    pub visibility_revision: u64,
    pub planes: [[f32; 4]; 6],
    pub box_count: u32,
}

#[derive(Default)]
pub(crate) struct CullDispatchCache {
    last: Option<CullSignature>,
}

impl CullDispatchCache {
    /// Return true when the GPU cull result must be rebuilt for this frame.
    pub(crate) fn should_dispatch(&mut self, signature: CullSignature) -> bool {
        if self.last == Some(signature) {
            return false;
        }

        self.last = Some(signature);
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn signature() -> CullSignature {
        CullSignature {
            visibility_revision: 1,
            planes: [[0.0, 0.0, 0.0, 1.0]; 6],
            box_count: 32,
        }
    }

    #[test]
    fn static_inputs_reuse_the_previous_gpu_result() {
        let mut cache = CullDispatchCache::default();
        let signature = signature();

        assert!(cache.should_dispatch(signature));
        assert!(!cache.should_dispatch(signature));
        assert!(!cache.should_dispatch(signature));
    }

    #[test]
    fn scene_camera_or_count_changes_invalidate_the_cached_result() {
        let mut cache = CullDispatchCache::default();
        let signature = signature();
        assert!(cache.should_dispatch(signature));

        let mut changed = signature;
        changed.visibility_revision += 1;
        assert!(cache.should_dispatch(changed), "scene changes invalidate");
        assert!(!cache.should_dispatch(changed));

        changed.planes[0][3] += 0.25;
        assert!(cache.should_dispatch(changed), "camera planes invalidate");
        assert!(!cache.should_dispatch(changed));

        changed.box_count -= 1;
        assert!(cache.should_dispatch(changed), "instance count invalidates");
    }
}
