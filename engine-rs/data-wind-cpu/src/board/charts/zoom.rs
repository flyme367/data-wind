//! Data-window navigator for ordinary Cartesian charts.
use egui::{Painter, Pos2, Rect, Shape, Stroke, StrokeKind, pos2, vec2};

use super::{
    BoardNode, axis, number, option_bool, option_color, option_number, supports_signed_scale,
};

#[derive(Clone, Copy, Debug, PartialEq)]
pub(in crate::board) struct ZoomRange {
    pub start: f32,
    pub end: f32,
}

impl ZoomRange {
    fn normalized(start: f32, end: f32, count: usize) -> Self {
        let min_span = 1.0 / count.max(1) as f32;
        let start = start.clamp(0.0, 1.0 - min_span);
        let end = end.clamp(start + min_span, 1.0);
        Self { start, end }
    }

    fn indices(self, count: usize) -> (usize, usize) {
        // Floating point coordinates at an item boundary must not add a neighbour.
        let first = ((self.start * count as f32 + 0.00001).floor() as usize).min(count - 1);
        let last = ((self.end * count as f32 - 0.00001).ceil() as usize).clamp(first + 1, count);
        (first, last)
    }
}

#[derive(Clone, Copy, Debug)]
pub(in crate::board) enum ZoomPart {
    Start,
    End,
    Window,
}

#[derive(Clone, Copy, Debug)]
pub(in crate::board) struct ZoomGeometry {
    track: Rect,
    range: ZoomRange,
    handle_size: f32,
    count: usize,
}

impl ZoomGeometry {
    pub(in crate::board) fn hit(self, point: Pos2) -> Option<ZoomPart> {
        let left = self.track.left() + self.track.width() * self.range.start;
        let right = self.track.left() + self.track.width() * self.range.end;
        let hit = self.track.expand2(vec2(
            4.0,
            ((self.handle_size - self.track.height()) / 2.0).max(5.0),
        ));
        if !hit.contains(point) {
            return None;
        }
        let distance_left = (point.x - left).abs();
        let distance_right = (point.x - right).abs();
        let tolerance = 4.0;
        if distance_left.min(distance_right) <= tolerance {
            Some(if distance_left <= distance_right {
                ZoomPart::Start
            } else {
                ZoomPart::End
            })
        } else if point.x >= left && point.x <= right {
            Some(ZoomPart::Window)
        } else {
            None
        }
    }

    pub(in crate::board) fn drag(self, part: ZoomPart, dx: f32) -> ZoomRange {
        let delta = dx / self.track.width().max(1.0);
        let minimum = 1.0 / self.count.max(1) as f32;
        match part {
            ZoomPart::Start => ZoomRange {
                start: (self.range.start + delta).clamp(0.0, self.range.end - minimum),
                ..self.range
            },
            ZoomPart::End => ZoomRange {
                end: (self.range.end + delta).clamp(self.range.start + minimum, 1.0),
                ..self.range
            },
            ZoomPart::Window => {
                let width = self.range.end - self.range.start;
                let start = (self.range.start + delta).clamp(0.0, 1.0 - width);
                ZoomRange {
                    start,
                    end: start + width,
                }
            }
        }
    }
}

pub(in crate::board) struct ZoomDrag {
    pub id: String,
    pub origin: Pos2,
    pub geometry: ZoomGeometry,
    pub part: ZoomPart,
}

fn supported(node: &BoardNode) -> bool {
    let kind = node.widget.kind.as_str();
    let variant = node.data["chart"]["variant"].as_str().unwrap_or("");
    matches!(
        kind,
        "bar"
            | "barGradient"
            | "barGrouped"
            | "barStacked"
            | "barPercent"
            | "barHorizontal"
            | "barHorizontalStacked"
            | "line"
            | "lineSmooth"
            | "lineMulti"
            | "area"
            | "areaGradient"
            | "areaStacked"
            | "dualAxis"
    ) && !matches!(
        variant,
        "polarBar"
            | "colorRing"
            | "sankey"
            | "gantt"
            | "pathAnimation"
            | "waterfall"
            | "stream"
            | "boxplot"
            | "bullet"
            | "path"
            | "dynamicBar"
    )
}

pub(in crate::board) fn configured_range(node: &BoardNode) -> (f32, f32) {
    (
        option_number(node, "zoomStart", 0.0, 0.0, 100.0) / 100.0,
        option_number(node, "zoomEnd", 100.0, 0.0, 100.0) / 100.0,
    )
}

/// Keep the source node unchanged: the temporary copy is used only for rendering.
pub(in crate::board) fn prepare(
    node: &BoardNode,
    rect: Rect,
    runtime: Option<ZoomRange>,
) -> Option<(BoardNode, Rect, ZoomGeometry, usize)> {
    if !supported(node) || !option_bool(node, "showDataZoom", false) {
        return None;
    }
    let raw = node.data["rows"].as_array()?;
    let count = raw.len().min(30);
    if count == 0 {
        return None;
    }
    let height = option_number(node, "zoomHeight", 16.0, 4.0, 60.0);
    let bottom = option_number(node, "zoomBottom", 10.0, 0.0, 100.0);
    let top = rect.max.y - bottom - height;
    if top - rect.min.y < 55.0 || rect.width() < 80.0 {
        return None;
    }
    let track = Rect::from_min_max(
        pos2(rect.min.x + 34.0, top),
        pos2(rect.max.x - 10.0, top + height),
    );
    let (start, end) = configured_range(node);
    let range = runtime.unwrap_or_else(|| ZoomRange::normalized(start, end, count));
    let range = ZoomRange::normalized(range.start, range.end, count);
    let (first, last) = range.indices(count);
    let mut filtered = node.clone();
    filtered.data["rows"] = serde_json::Value::Array(raw[first..last].to_vec());
    filtered.data["__zoomRowOffset"] = serde_json::Value::from(first);
    let chart_rect = Rect::from_min_max(rect.min, pos2(rect.max.x, top - 4.0));
    Some((
        filtered,
        chart_rect,
        ZoomGeometry {
            track,
            range,
            count,
            handle_size: option_number(node, "zoomHandleSize", 28.0, 2.0, 40.0),
        },
        first,
    ))
}

pub(in crate::board) fn paint(p: &Painter, node: &BoardNode, geometry: ZoomGeometry) {
    let rect = geometry.track;
    let selection = Rect::from_min_max(
        pos2(
            rect.left() + rect.width() * geometry.range.start,
            rect.top(),
        ),
        pos2(
            rect.left() + rect.width() * geometry.range.end,
            rect.bottom(),
        ),
    );
    p.rect_filled(rect, 0.0, option_color(node, "zoomBackground", "#4161800d"));
    if let Some(rows) = node.data["rows"].as_array() {
        let signed = supports_signed_scale(node);
        let values: Vec<_> = rows
            .iter()
            .take(geometry.count)
            .map(|row| {
                let value = number(&row["value"], 0.0);
                if signed { value } else { value.max(0.0) }
            })
            .collect();
        let scale = axis::Scale::automatic(values.iter().copied());
        if values.len() > 1 {
            let points: Vec<Pos2> = values
                .iter()
                .enumerate()
                .map(|(i, value)| {
                    pos2(
                        rect.left() + rect.width() * i as f32 / (values.len() - 1) as f32,
                        scale.y(rect, *value),
                    )
                })
                .collect();
            let mesh = |fill| {
                let mut mesh = egui::Mesh::default();
                let bottom = scale.y(rect, 0.0);
                let mut triangle = |points: [Pos2; 3]| {
                    let first = mesh.vertices.len() as u32;
                    for point in points {
                        mesh.colored_vertex(point, fill);
                    }
                    mesh.add_triangle(first, first + 1, first + 2);
                };
                for pair in points.windows(2) {
                    let [a, b] = [pair[0], pair[1]];
                    let left = pos2(a.x, bottom);
                    let right = pos2(b.x, bottom);
                    if (a.y - bottom) * (b.y - bottom) < 0.0 {
                        let crossing = a.lerp(b, (bottom - a.y) / (b.y - a.y));
                        triangle([a, crossing, left]);
                        triangle([crossing, b, right]);
                    } else {
                        triangle([a, left, b]);
                        triangle([left, right, b]);
                    }
                }
                mesh
            };
            let width = option_number(node, "zoomDataLineWidth", 1.0, 0.0, 10.0);
            p.add(Shape::mesh(mesh(option_color(
                node,
                "zoomDataAreaColor",
                "#1890ff55",
            ))));
            if width > 0.0 {
                p.add(Shape::line(
                    points.clone(),
                    Stroke::new(width, option_color(node, "zoomDataLineColor", "#1890ff")),
                ));
            }
            let selected = p.with_clip_rect(p.clip_rect().intersect(selection));
            selected.add(Shape::mesh(mesh(option_color(
                node,
                "zoomSelectedAreaColor",
                "#1c6cb855",
            ))));
            if width > 0.0 {
                selected.add(Shape::line(
                    points,
                    Stroke::new(
                        width,
                        option_color(node, "zoomSelectedLineColor", "#1c6cb8"),
                    ),
                ));
            }
        }
    }
    p.rect_filled(
        selection,
        0.0,
        option_color(node, "zoomForeground", "#5b8ff926"),
    );
    p.rect_stroke(
        rect,
        0.0,
        Stroke::new(1.0, option_color(node, "zoomBorderColor", "#cccccc")),
        StrokeKind::Inside,
    );
    let top_height = option_number(node, "zoomSliderHeight", 5.0, 0.0, 30.0).min(rect.height());
    p.rect_filled(
        Rect::from_min_max(
            selection.min,
            pos2(selection.right(), selection.top() + top_height),
        ),
        0.0,
        option_color(node, "zoomSliderColor", "#5b8ff926"),
    );
    let handle_color = option_color(node, "zoomHandleColor", "#f7f7f7");
    for x in [selection.left(), selection.right()] {
        p.rect_filled(
            Rect::from_center_size(pos2(x, rect.center().y), vec2(4.0, geometry.handle_size)),
            1.0,
            handle_color,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::{ZoomGeometry, ZoomPart, ZoomRange};
    use egui::{Rect, pos2};

    #[test]
    fn item_boundaries_and_narrow_window_are_stable() {
        let range = ZoomRange::normalized(0.4, 0.8, 5);
        assert_eq!(range.indices(5), (2, 4));
        let range = ZoomRange::normalized(0.5, 0.5 + 1.0 / 30.0, 30);
        let geometry = ZoomGeometry {
            track: Rect::from_min_max(pos2(0.0, 0.0), pos2(300.0, 16.0)),
            range,
            handle_size: 28.0,
            count: 30,
        };
        assert!(matches!(
            geometry.hit(pos2(155.0, 8.0)),
            Some(ZoomPart::Window)
        ));
        assert_eq!(geometry.drag(ZoomPart::Window, 10.0).indices(30), (16, 17));
        assert_eq!(geometry.drag(ZoomPart::Start, 100.0).indices(30), (15, 16));
    }
}
