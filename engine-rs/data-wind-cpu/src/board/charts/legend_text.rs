use std::sync::Arc;

use egui::{
    Color32, FontId, Galley, Painter, Pos2, Rect, Stroke, TextFormat, text::LayoutJob, vec2,
};

use super::{BoardNode, color, number, option_bool, option_number};

pub(super) struct LegendText<'a> {
    node: &'a BoardNode,
    page: bool,
}

impl<'a> LegendText<'a> {
    pub(super) fn new(node: &'a BoardNode, page: bool) -> Self {
        Self { node, page }
    }

    fn key(&self, suffix: &str) -> String {
        format!("legend{}{suffix}", if self.page { "Page" } else { "" })
    }

    pub(super) fn layout(&self, p: &Painter, value: &str, size: f32, tint: Color32) -> Arc<Galley> {
        let chart = &self.node.data["chart"];
        let family = chart[self.key("FontFamily")]
            .as_str()
            .unwrap_or("sans-serif");
        let font = if family.to_ascii_lowercase().contains("mono") || family.contains("Courier") {
            FontId::monospace(size)
        } else {
            FontId::proportional(size)
        };
        let decoration = |key: &str| {
            if option_bool(self.node, &self.key(key), false) {
                Stroke::new(1.0, tint)
            } else {
                Stroke::NONE
            }
        };
        let format = TextFormat {
            font_id: font,
            color: tint,
            italics: option_bool(self.node, &self.key("Italic"), false),
            underline: decoration("Underline"),
            strikethrough: decoration("Strike"),
            ..Default::default()
        };
        let spacing = if self.page {
            0.0
        } else {
            option_number(self.node, "legendTextSpacing", 0.0, -10.0, 100.0)
        };
        let mut job = LayoutJob::default();
        if spacing.abs() <= f32::EPSILON {
            job.append(value, 0.0, format);
        } else {
            for (index, character) in value.chars().enumerate() {
                job.append(
                    &character.to_string(),
                    if index == 0 { 0.0 } else { spacing },
                    format.clone(),
                );
            }
        }
        p.layout_job(job)
    }

    pub(super) fn draw(
        &self,
        p: &Painter,
        at: Pos2,
        value: &str,
        galley: Arc<Galley>,
        tint: Color32,
        clip: Rect,
    ) {
        let chart = &self.node.data["chart"];
        if !self.page {
            let shadow = color(chart["legendShadowColor"].as_str().unwrap_or("transparent"));
            let blur = option_number(self.node, "legendShadowBlur", 0.0, 0.0, 100.0);
            let offsets = &chart["legendShadowOffset"];
            let offset = vec2(number(&offsets[0], 0.0), number(&offsets[1], 0.0));
            if shadow.a() > 0 && (blur > 0.0 || offset != egui::Vec2::ZERO) {
                let shadow_clip = if chart["legendTextMode"] == "custom" {
                    clip
                } else {
                    clip.expand(blur.min(30.0) / 2.0 + offset.x.abs().max(offset.y.abs()))
                };
                let painter = p.with_clip_rect(shadow_clip);
                let shadow = shadow.gamma_multiply(if blur > 0.0 { 0.13 } else { 0.6 });
                let glow = self.layout(
                    p,
                    value,
                    galley
                        .job
                        .sections
                        .first()
                        .map_or(12.0, |section| section.format.font_id.size),
                    shadow,
                );
                if blur > 0.0 {
                    let radius = blur.min(30.0) / 2.0;
                    for (x, y) in [
                        (-1.0, -1.0),
                        (0.0, -1.0),
                        (1.0, -1.0),
                        (-1.0, 0.0),
                        (1.0, 0.0),
                        (-1.0, 1.0),
                        (0.0, 1.0),
                        (1.0, 1.0),
                    ] {
                        painter.galley(
                            at + offset + vec2(x * radius, y * radius),
                            glow.clone(),
                            shadow,
                        );
                    }
                }
                painter.galley(at + offset, glow, shadow);
            }
        }
        let painter = p.with_clip_rect(clip);
        if option_bool(self.node, &self.key("Bold"), false) {
            painter.galley(at + vec2(0.4, 0.0), galley.clone(), tint);
        }
        painter.galley(at, galley, tint);
    }
}
