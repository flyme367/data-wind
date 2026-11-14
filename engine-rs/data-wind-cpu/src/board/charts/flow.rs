use egui::{Painter, Pos2, Rect, Shape, Stroke, StrokeKind, vec2};

use super::{BoardNode, Clock, color, number, option_bool, smooth};

/// Paint one moving marker and its fading tail along the visible polyline.
pub(super) fn paint(
    painter: &Painter,
    node: &BoardNode,
    points: &[Pos2],
    curved: bool,
    series: usize,
    clock: &Clock,
) {
    if !option_bool(node, "flowEnabled", false) || points.len() < 2 {
        return;
    }
    let style = &node.data["chart"]["flowStyles"][series];
    if style["enabled"] != true {
        return;
    }
    let path = if curved {
        smooth(points)
    } else {
        points.to_vec()
    };
    let lengths: Vec<_> = path
        .windows(2)
        .map(|pair| pair[0].distance(pair[1]))
        .collect();
    let length: f32 = lengths.iter().sum();
    if !length.is_finite() || length <= f32::EPSILON {
        return;
    }
    let duration = number(&style["duration"], 10.0).clamp(0.1, 3600.0);
    let start = node.data["chart"]["startAt"].as_f64().unwrap_or(0.0);
    let elapsed = if option_bool(node, "playAnimation", true) && clock.now.is_finite() {
        (clock.now - start).max(0.0)
    } else {
        0.0
    };
    let phase = (elapsed / f64::from(duration * 1000.0)).rem_euclid(1.0) as f32;
    let head = phase * length;
    let trail = length * number(&style["trailLength"], 10.0).clamp(0.0, 100.0) / 100.0;
    let tail = (head - trail).max(0.0);
    let size = number(&style["size"], 8.0).clamp(0.0, 100.0);
    if size <= 0.0 {
        return;
    }
    let tint = color(style["color"].as_str().unwrap_or("#ffffff"));
    let mut previous = 0.0;
    let mut marker = path[0];
    for (pair, step) in path.windows(2).zip(lengths) {
        let next = previous + step;
        if step > f32::EPSILON {
            if head >= previous && head <= next {
                marker = pair[0].lerp(pair[1], (head - previous) / step);
            }
            let begin = previous.max(tail);
            let end = next.min(head);
            if end > begin && trail > f32::EPSILON {
                let a = pair[0].lerp(pair[1], (begin - previous) / step);
                let b = pair[0].lerp(pair[1], (end - previous) / step);
                let opacity = ((begin + end) / 2.0 - tail) / trail;
                painter.line_segment(
                    [a, b],
                    Stroke::new((size * 0.3).max(1.0), tint.gamma_multiply(opacity)),
                );
            }
        }
        previous = next;
    }
    let radius = size / 2.0;
    let rect = Rect::from_center_size(marker, vec2(size, size));
    match style["shape"].as_str().unwrap_or("circle") {
        "squareEmpty" => {
            painter.rect_stroke(rect, 0.0, Stroke::new(1.5, tint), StrokeKind::Inside);
        }
        "roundSquare" => {
            painter.rect_filled(rect, radius / 2.0, tint);
        }
        "circleEmpty" => {
            painter.circle_stroke(marker, radius, Stroke::new(1.5, tint));
        }
        "triangle" | "diamond" => {
            let points = if style["shape"] == "triangle" {
                vec![
                    marker + vec2(0.0, -radius),
                    marker + vec2(radius, radius),
                    marker + vec2(-radius, radius),
                ]
            } else {
                vec![
                    marker + vec2(0.0, -radius),
                    marker + vec2(radius, 0.0),
                    marker + vec2(0.0, radius),
                    marker + vec2(-radius, 0.0),
                ]
            };
            painter.add(Shape::convex_polygon(points, tint, Stroke::NONE));
        }
        _ => {
            painter.circle_filled(marker, radius, tint);
        }
    }
}
