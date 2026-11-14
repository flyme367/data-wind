//! Reuse the board's processed egui geometry on frames without a new board pass.

use bevy_egui::EguiRenderOutput;

#[derive(Default)]
enum PendingOutput {
    #[default]
    None,
    Prime,
    Reuse,
}

#[derive(Default)]
pub(crate) struct BoardPaintCache {
    paint_jobs: Option<Vec<egui::ClippedPrimitive>>,
    shapes: Option<Vec<egui::epaint::ClippedShape>>,
    pixels_per_point: f32,
    geometry_revision: u64,
    pending: PendingOutput,
}

impl BoardPaintCache {
    pub(crate) fn begin_frame(&mut self) {
        self.pending = PendingOutput::None;
    }

    pub(crate) fn reuse(&mut self) -> Option<egui::FullOutput> {
        let shapes = if self.paint_jobs.is_some() {
            self.pending = PendingOutput::Reuse;
            Vec::new()
        } else {
            let shapes = self.shapes.as_ref()?.clone();
            self.pending = PendingOutput::Prime;
            shapes
        };
        Some(egui::FullOutput {
            shapes,
            pixels_per_point: self.pixels_per_point,
            ..Default::default()
        })
    }

    pub(crate) fn mark_fresh(&mut self, output: &egui::FullOutput) {
        self.pixels_per_point = output.pixels_per_point;
        self.geometry_revision = self.geometry_revision.wrapping_add(1);
        self.shapes = Some(output.shapes.clone());
        self.paint_jobs = None;
        self.pending = PendingOutput::None;
    }

    /// Called after bevy_egui processes outputs and before render extraction.
    pub(crate) fn finish_frame(&mut self, output: &mut EguiRenderOutput) {
        output.static_geometry_revision = Some(self.geometry_revision);
        match std::mem::take(&mut self.pending) {
            PendingOutput::None => {}
            PendingOutput::Prime => {
                self.paint_jobs = Some(output.paint_jobs.clone());
                self.shapes = None;
            }
            PendingOutput::Reuse => {
                if let Some(cached) = &self.paint_jobs {
                    output.paint_jobs.clone_from(cached);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mesh(x: f32) -> egui::ClippedPrimitive {
        let mut mesh = egui::Mesh::default();
        mesh.add_colored_rect(
            egui::Rect::from_min_size(egui::pos2(x, 0.0), egui::vec2(1.0, 1.0)),
            egui::Color32::WHITE,
        );
        egui::ClippedPrimitive {
            clip_rect: egui::Rect::EVERYTHING,
            primitive: egui::epaint::Primitive::Mesh(mesh),
        }
    }

    fn first_x(output: &EguiRenderOutput) -> f32 {
        let egui::epaint::Primitive::Mesh(mesh) = &output.paint_jobs[0].primitive else {
            panic!("expected mesh");
        };
        mesh.vertices[0].pos.x
    }

    #[test]
    fn reuses_only_geometry_and_replaces_cache_after_a_fresh_pass() {
        let mut cache = BoardPaintCache::default();
        assert!(cache.reuse().is_none());

        let fresh = egui::FullOutput {
            pixels_per_point: 2.0,
            shapes: vec![egui::epaint::ClippedShape {
                clip_rect: egui::Rect::EVERYTHING,
                shape: egui::Shape::rect_filled(
                    egui::Rect::from_min_size(egui::Pos2::ZERO, egui::Vec2::splat(1.0)),
                    0.0,
                    egui::Color32::WHITE,
                ),
            }],
            ..Default::default()
        };
        cache.mark_fresh(&fresh);
        let initial_revision = cache.geometry_revision;
        let mut output = EguiRenderOutput {
            paint_jobs: vec![mesh(1.0)],
            ..Default::default()
        };
        cache.finish_frame(&mut output);
        assert_eq!(output.static_geometry_revision, Some(initial_revision));
        assert!(
            cache.paint_jobs.is_none(),
            "dynamic frames must not clone meshes"
        );

        cache.begin_frame();
        let prime = cache.reuse().expect("first static frame");
        assert_eq!(prime.shapes.len(), 1);
        cache.finish_frame(&mut output);

        cache.begin_frame();
        let reused = cache.reuse().expect("cached geometry");
        assert!(reused.shapes.is_empty());
        assert_eq!(reused.pixels_per_point, 2.0);
        let mut output = EguiRenderOutput::default();
        output
            .textures_delta
            .free
            .insert(egui::TextureId::Managed(7));
        cache.finish_frame(&mut output);
        assert_eq!(first_x(&output), 1.0);
        assert!(
            output
                .textures_delta
                .free
                .contains(&egui::TextureId::Managed(7))
        );
        output.textures_delta.clear();

        cache.begin_frame();
        cache.mark_fresh(&fresh);
        assert_eq!(cache.geometry_revision, initial_revision + 1);
        output.paint_jobs = vec![mesh(9.0)];
        cache.finish_frame(&mut output);
        cache.begin_frame();
        cache.reuse().expect("first frame after update");
        cache.finish_frame(&mut output);
        cache.begin_frame();
        cache.reuse().expect("updated cache");
        output.paint_jobs.clear();
        cache.finish_frame(&mut output);
        assert_eq!(first_x(&output), 9.0);

        cache.begin_frame();
        cache.mark_fresh(&fresh);
        output.paint_jobs.clear();
        cache.finish_frame(&mut output);
        cache.begin_frame();
        cache.reuse().expect("first empty frame");
        cache.finish_frame(&mut output);
        cache.begin_frame();
        cache.reuse().expect("empty output is still cached");
        output.paint_jobs.push(mesh(3.0));
        cache.finish_frame(&mut output);
        assert!(output.paint_jobs.is_empty());
    }

    #[test]
    fn cached_jobs_match_egui_tessellation() {
        let ctx = egui::Context::default();
        ctx.begin_pass(egui::RawInput::default());
        let mut initial = ctx.end_pass();
        initial.textures_delta.clear();
        let shapes = [(egui::Color32::RED, 0.0), (egui::Color32::GREEN, 20.0)]
            .into_iter()
            .map(|(color, x)| egui::epaint::ClippedShape {
                clip_rect: egui::Rect::EVERYTHING,
                shape: egui::Shape::rect_filled(
                    egui::Rect::from_min_size(egui::pos2(x, 0.0), egui::vec2(10.0, 10.0)),
                    0.0,
                    color,
                ),
            })
            .collect();
        let fresh = egui::FullOutput {
            shapes,
            pixels_per_point: 1.0,
            ..Default::default()
        };
        let expected = ctx.tessellate(fresh.shapes.clone(), fresh.pixels_per_point);
        let mut cache = BoardPaintCache::default();
        cache.mark_fresh(&fresh);
        cache.begin_frame();
        let first_idle = cache.reuse().expect("first idle frame");
        let mut processed = EguiRenderOutput {
            paint_jobs: ctx.tessellate(first_idle.shapes, first_idle.pixels_per_point),
            ..Default::default()
        };
        cache.finish_frame(&mut processed);

        cache.begin_frame();
        let idle = cache.reuse().expect("cached frame");
        assert!(idle.shapes.is_empty());
        let mut reused = EguiRenderOutput::default();
        cache.finish_frame(&mut reused);
        assert_eq!(reused.paint_jobs.len(), expected.len());
        for (actual, expected) in reused.paint_jobs.iter().zip(&expected) {
            assert_eq!(actual.clip_rect, expected.clip_rect);
            let (egui::epaint::Primitive::Mesh(actual), egui::epaint::Primitive::Mesh(expected)) =
                (&actual.primitive, &expected.primitive)
            else {
                panic!("expected meshes");
            };
            assert_eq!(actual.indices, expected.indices);
            assert_eq!(actual.vertices, expected.vertices);
            assert_eq!(actual.texture_id, expected.texture_id);
        }
    }
}
