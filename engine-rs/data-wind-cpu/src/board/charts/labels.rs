use egui::{Align2, Color32, FontId, Painter, Pos2, Rect, TextFormat, Vec2, pos2, vec2};

use super::{BoardNode, color, number};

#[derive(Clone, Copy)]
pub(super) enum Direction {
    Vertical,
    Horizontal,
    Leftward,
    Downward,
}

fn bar_anchor(
    rect: Rect,
    plot: Rect,
    direction: Direction,
    position: &str,
    spacing: f32,
) -> (Pos2, Align2) {
    if position == "inside" {
        return (rect.center(), Align2::CENTER_CENTER);
    }
    if position == "top-align" {
        return match direction {
            Direction::Vertical | Direction::Downward => (
                pos2(rect.center().x, plot.top() - spacing),
                Align2::CENTER_BOTTOM,
            ),
            Direction::Horizontal | Direction::Leftward => (
                pos2(rect.center().x, rect.top() - spacing),
                Align2::CENTER_BOTTOM,
            ),
        };
    }
    match direction {
        Direction::Vertical => (
            pos2(rect.center().x, rect.top() - spacing),
            Align2::CENTER_BOTTOM,
        ),
        Direction::Downward => (
            pos2(rect.center().x, rect.bottom() + spacing),
            Align2::CENTER_TOP,
        ),
        Direction::Horizontal => (
            pos2(rect.right() + spacing, rect.center().y),
            Align2::LEFT_CENTER,
        ),
        Direction::Leftward => (
            pos2(rect.left() - spacing, rect.center().y),
            Align2::RIGHT_CENTER,
        ),
    }
}

pub(super) struct Labels<'a> {
    painter: &'a Painter,
    node: &'a BoardNode,
    font: FontId,
    color: Color32,
    secondary: bool,
}

impl<'a> Labels<'a> {
    pub(super) fn new(
        painter: &'a Painter,
        node: &'a BoardNode,
        size: f32,
        color: Color32,
    ) -> Self {
        Self {
            painter,
            node,
            font: FontId::proportional(size),
            color,
            secondary: false,
        }
    }

    pub(super) fn line(
        painter: &'a Painter,
        node: &'a BoardNode,
        size: f32,
        tint: Color32,
    ) -> Self {
        let chart = &node.data["chart"];
        Self {
            painter,
            node,
            font: FontId::proportional(number(&chart["lineLabelSize"], size).clamp(6.0, 48.0)),
            color: chart["lineLabelColor"].as_str().map_or(tint, color),
            secondary: true,
        }
    }

    fn setting(&self, key: &str) -> &serde_json::Value {
        let chart = &self.node.data["chart"];
        if self.secondary {
            let alternate = match key {
                "showLabels" => "showLineLabels",
                "labelFormat" => "lineLabelFormat",
                "decimals" => "lineLabelDecimals",
                "labelPadZeros" => "lineLabelPadZeros",
                "labelPosition" => "lineLabelPosition",
                "labelColorMode" => "lineLabelColorMode",
                "labelFollowDataColor" => "lineLabelFollowDataColor",
                "labelOffsetX" => "lineLabelOffsetX",
                "labelOffsetY" => "lineLabelOffsetY",
                "labelTilt" => "lineLabelTilt",
                "unit" => "lineLabelUnit",
                "labelUnitSize" => "lineLabelUnitSize",
                "labelUnitColor" => "lineLabelUnitColor",
                _ => "",
            };
            if !alternate.is_empty() && !chart[alternate].is_null() {
                return &chart[alternate];
            }
        }
        &chart[key]
    }

    fn flag(&self, key: &str, fallback: bool) -> bool {
        self.setting(key).as_bool().unwrap_or(fallback)
    }

    fn numeric(&self, key: &str, fallback: f32, min: f32, max: f32) -> f32 {
        number(self.setting(key), fallback).clamp(min, max)
    }

    fn offset(&self) -> Vec2 {
        vec2(
            self.numeric("labelOffsetX", 0.0, -500.0, 500.0),
            self.numeric("labelOffsetY", 0.0, -500.0, 500.0)
                + if self.secondary {
                    0.0
                } else {
                    self.numeric("labelVerticalOffset", 0.0, -500.0, 500.0)
                },
        )
    }

    fn paint(&self, position: Pos2, align: Align2, name: &str, value: f32, shape_color: Color32) {
        if !self.flag("showLabels", false)
            || (!self.secondary && value == 0.0 && self.flag("hideZeroLabels", false))
        {
            return;
        }
        let percent = self.setting("labelFormat").as_str() == Some("percent");
        let value = if percent { value * 100.0 } else { value };
        let decimals = self.numeric("decimals", 0.0, 0.0, 6.0) as usize;
        let formatted = format!("{value:.decimals$}");
        let formatted = if decimals > 0 && !self.flag("labelPadZeros", true) {
            formatted.trim_end_matches('0').trim_end_matches('.')
        } else {
            &formatted
        };
        let unit = self.setting("unit").as_str().unwrap_or("");
        let prefix = if !self.secondary && self.flag("labelShowCategory", false) && !name.is_empty()
        {
            format!("{name} ")
        } else {
            String::new()
        };
        let tint = if self.setting("labelColorMode") == "follow"
            || self.flag("labelFollowDataColor", false)
        {
            shape_color
        } else {
            self.color
        };
        let text = format!("{prefix}{formatted}{}", if percent { "%" } else { "" });
        let position = position + self.offset();
        let angle = self.numeric("labelTilt", 0.0, -360.0, 360.0).to_radians();
        if angle != 0.0
            || (!unit.is_empty()
                && (self.setting("labelUnitSize").is_number()
                    || self.setting("labelUnitColor").is_string()))
        {
            let size = self.numeric("labelUnitSize", self.font.size, 6.0, 48.0);
            let unit_tint = self.setting("labelUnitColor").as_str().map_or(tint, color);
            let mut job = egui::text::LayoutJob::default();
            job.append(
                &text,
                0.0,
                TextFormat {
                    font_id: self.font.clone(),
                    color: tint,
                    ..Default::default()
                },
            );
            job.append(
                unit,
                0.0,
                TextFormat {
                    font_id: FontId::proportional(size),
                    color: unit_tint,
                    ..Default::default()
                },
            );
            let galley = self.painter.layout_job(job);
            let at = align.anchor_size(position, galley.size()).min;
            self.painter.add(
                egui::epaint::TextShape::new(at, galley, tint).with_angle_and_anchor(angle, align),
            );
        } else {
            self.painter.text(
                position,
                align,
                format!("{text}{unit}"),
                self.font.clone(),
                tint,
            );
        }
    }

    pub(super) fn bar(
        &self,
        rect: Rect,
        plot: Rect,
        direction: Direction,
        name: &str,
        value: f32,
        color: Color32,
    ) {
        let fallback = if matches!(direction, Direction::Horizontal | Direction::Leftward) {
            4.0
        } else {
            3.0
        };
        let spacing = self.numeric("labelSpacing", fallback, -200.0, 200.0);
        let position = self.setting("labelPosition").as_str().unwrap_or("outside");
        let (anchor, align) = bar_anchor(rect, plot, direction, position, spacing);
        self.paint(anchor, align, name, value, color);
    }

    pub(super) fn point(
        &self,
        point: Pos2,
        plot: Rect,
        spacing: f32,
        name: &str,
        value: f32,
        color: Color32,
    ) {
        let (position, align) = if self.secondary && self.setting("labelPosition") == "top" {
            (pos2(point.x, plot.top()), Align2::CENTER_TOP)
        } else {
            (point - vec2(0.0, spacing), Align2::CENTER_BOTTOM)
        };
        self.paint(position, align, name, value, color);
    }
}

#[cfg(test)]
mod tests {
    use super::{Direction, bar_anchor};
    use egui::{Align2, Rect, pos2};

    #[test]
    fn label_anchors_follow_bar_geometry_and_negative_spacing() {
        let plot = Rect::from_min_max(pos2(0.0, 0.0), pos2(100.0, 100.0));
        let rect = Rect::from_min_max(pos2(20.0, 30.0), pos2(40.0, 80.0));
        assert_eq!(
            bar_anchor(rect, plot, Direction::Vertical, "inside", 5.0).0,
            rect.center()
        );
        assert_eq!(
            bar_anchor(rect, plot, Direction::Vertical, "outside", 5.0),
            (pos2(30.0, 25.0), Align2::CENTER_BOTTOM)
        );
        assert_eq!(
            bar_anchor(rect, plot, Direction::Horizontal, "outside", -4.0),
            (pos2(36.0, 55.0), Align2::LEFT_CENTER)
        );
        assert_eq!(
            bar_anchor(rect, plot, Direction::Leftward, "outside", 4.0),
            (pos2(16.0, 55.0), Align2::RIGHT_CENTER)
        );
        assert_eq!(
            bar_anchor(rect, plot, Direction::Downward, "outside", 3.0).0,
            pos2(30.0, 83.0)
        );
    }
}
