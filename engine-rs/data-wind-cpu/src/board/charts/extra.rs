//! Additional chart geometries sharing the board painter and JSON data boundary.
use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
};

use egui::{Align2, FontId, Painter, Pos2, Rect, Shape, Stroke, StrokeKind, pos2, vec2};
use serde_json::{Value, json};

use super::axis::stroke;
use super::{
    ChartDatum, ChartLayout, ChartShape, Row, SMOOTH_STEPS, option_bool, option_color,
    option_number, paint_data_line, paint_data_point, plot_rect, polar, ring, series_color,
    series_label, smooth, value_text,
};
use crate::board::kit::KitGradient;
use crate::board::widgets::{centered, line};
use crate::board::{BoardNode, Clock, MUTED, TEXT, color, number, string};

fn axis(p: &Painter, node: &BoardNode, r: Rect, min: f32, max: f32) -> Rect {
    let plot = plot_rect(node, r, [40.0, 18.0, 12.0, 27.0]);
    if !plot.is_positive() {
        return plot;
    }
    let tint = option_color(node, "axisColor", "#90acc1");
    let size = option_number(node, "axisFontSize", 10.0, 6.0, 36.0);
    for i in 0..4 {
        let y = plot.min.y + plot.height() * i as f32 / 3.0;
        if option_bool(node, "showGrid", true) {
            line(
                p,
                pos2(plot.min.x, y),
                pos2(plot.max.x, y),
                1.0,
                color("#a4c4e31e"),
            );
        }
        if option_bool(node, "showYAxis", true) {
            p.text(
                pos2(plot.min.x - 6.0, y),
                Align2::RIGHT_CENTER,
                format!("{:.0}", egui::lerp(min..=max, 1.0 - i as f32 / 3.0)),
                FontId::proportional(size),
                tint,
            );
        }
    }
    plot
}

fn show_label(p: &Painter, node: &BoardNode, at: Pos2, value: impl ToString) {
    p.text(
        at,
        Align2::CENTER_CENTER,
        value.to_string(),
        FontId::proportional(option_number(node, "labelSize", 12.0, 6.0, 48.0)),
        option_color(node, "labelColor", "#cde3f7"),
    );
}

pub(super) fn paint_extra(
    p: &Painter,
    node: &BoardNode,
    r: Rect,
    rows: &[Row],
    variant: &str,
    clock: &Clock,
    layout: &mut ChartLayout,
    hidden: Option<&HashSet<usize>>,
) -> bool {
    match variant {
        "jade" => jade(p, node, r, rows, layout, hidden),
        "sankey" => sankey(p, node, r, layout),
        "gantt" => gantt(p, node, r, layout),
        "stream" => stream(p, node, r, rows, layout, hidden),
        "boxplot" => boxplot(p, node, r, layout),
        "bullet" => bullet(p, node, r, rows, layout),
        "path" => path(p, node, r, layout),
        "pizza" => pizza(p, node, r, rows, layout),
        "sunburst" => sunburst(p, node, r, layout),
        "dynamicBar" => dynamic_bar(p, node, r, clock, layout),
        "pathAnimation" => path_animation(p, node, r, clock, layout),
        _ => return false,
    }
    true
}

fn jade(
    p: &Painter,
    node: &BoardNode,
    r: Rect,
    rows: &[Row],
    layout: &mut ChartLayout,
    hidden: Option<&HashSet<usize>>,
) {
    let legend = option_bool(node, "showLegend", true);
    let radius =
        (r.width().min(r.height()) * 0.44).min(r.width() * if legend { 0.29 } else { 0.46 });
    let center = if legend {
        pos2(r.min.x + radius + 8.0, r.center().y)
    } else {
        r.center()
    };
    let inner = option_number(node, "innerRadius", 35.0, 0.0, 90.0) / 100.0;
    let width = radius * (1.0 - inner) / rows.len().max(1) as f32;
    let gap = option_number(node, "segmentGap", 2.0, 0.0, 20.0).min(width / 2.0);
    let start = option_number(node, "startAngle", -225.0, -360.0, 360.0).to_radians();
    let end = option_number(node, "endAngle", 45.0, -360.0, 720.0).to_radians();
    let span = (end - start).clamp(-std::f32::consts::TAU, std::f32::consts::TAU);
    let max = rows.iter().map(|row| row.values[0]).fold(1.0_f32, f32::max);
    for (i, row) in rows.iter().enumerate() {
        let outer = radius - i as f32 * width;
        let inside = (outer - width + gap).max(0.0);
        ring(
            p,
            center,
            inside,
            outer,
            start,
            start + span,
            color("#29405a"),
        );
        let active = !hidden.is_some_and(|set| set.contains(&i));
        if active {
            let end = start + span * row.values[0] / max;
            ring(p, center, inside, outer, start, end, series_color(node, i));
            layout.category(ChartShape::arc(center, inside, outer, start, end), i);
        }
        if legend && (i < 6 || node.data["chart"]["legendType"] == "scroll") {
            let at = pos2(
                center.x + radius + 12.0,
                r.center().y - 50.0 + i as f32 * 20.0,
            );
            let tint = if active { series_color(node, i) } else { MUTED };
            layout.legend(
                p,
                at,
                i,
                &row.name,
                option_number(node, "legendFontSize", 10.0, 6.0, 36.0),
                tint,
            );
        }
        if active && option_bool(node, "showLabels", false) {
            let at = polar(
                center,
                (inside + outer) / 2.0,
                start + span * row.values[0] / max,
            );
            show_label(p, node, at, value_text(node, row.values[0]));
        }
    }
}

struct FlowNode {
    name: String,
    level: usize,
    incoming: f32,
    outgoing: f32,
    rect: Rect,
    input_used: f32,
    output_used: f32,
}

fn sankey(p: &Painter, node: &BoardNode, r: Rect, layout: &mut ChartLayout) {
    let Some(raw) = node.data["rows"].as_array() else {
        return;
    };
    let mut names = HashMap::<String, usize>::new();
    let mut nodes = Vec::<FlowNode>::new();
    let mut edges = Vec::<(usize, usize, f32, usize)>::new();
    for (index, item) in raw.iter().take(100).enumerate() {
        let source = item
            .get("source")
            .or_else(|| item.get("节点1"))
            .map(string)
            .unwrap_or_default();
        let target = item
            .get("target")
            .or_else(|| item.get("节点2"))
            .map(string)
            .unwrap_or_default();
        let value = number(
            item.get("value")
                .or_else(|| item.get("数值"))
                .unwrap_or(&Value::Null),
            0.0,
        )
        .max(0.0);
        if source.is_empty() || target.is_empty() || source == target || value <= 0.0 {
            continue;
        }
        let mut node_index = |name: String| {
            *names.entry(name.clone()).or_insert_with(|| {
                nodes.push(FlowNode {
                    name,
                    level: 0,
                    incoming: 0.0,
                    outgoing: 0.0,
                    rect: Rect::from_min_size(Pos2::ZERO, egui::Vec2::ZERO),
                    input_used: 0.0,
                    output_used: 0.0,
                });
                nodes.len() - 1
            })
        };
        let a = node_index(source);
        let b = node_index(target);
        nodes[a].outgoing += value;
        nodes[b].incoming += value;
        edges.push((a, b, value, index));
    }
    if edges.is_empty() {
        centered(p, r, 13.0, "暂无有效流向数据", MUTED);
        return;
    }
    // Limit relaxation so malformed cycles stay finite.
    for _ in 0..nodes.len().min(8) {
        let mut changed = false;
        for &(a, b, _, _) in &edges {
            let next = (nodes[a].level + 1).min(8);
            if next > nodes[b].level {
                nodes[b].level = next;
                changed = true;
            }
        }
        if !changed {
            break;
        }
    }
    let levels = nodes.iter().map(|n| n.level).max().unwrap_or(1).max(1);
    let gap = option_number(node, "nodeGap", 8.0, 0.0, 30.0);
    let width = option_number(node, "nodeWidth", 10.0, 3.0, 40.0);
    let plot = r.shrink2(vec2(45.0, 10.0));
    if !plot.is_positive() {
        return;
    }
    let mut scale = f32::INFINITY;
    for level in 0..=levels {
        let same: Vec<_> = nodes.iter().filter(|n| n.level == level).collect();
        if same.is_empty() {
            continue;
        }
        let total = same
            .iter()
            .map(|n| n.incoming.max(n.outgoing))
            .sum::<f32>()
            .max(1.0);
        scale =
            scale.min((plot.height() - gap * same.len().saturating_sub(1) as f32).max(1.0) / total);
    }
    let mut offsets = vec![plot.min.y; levels + 1];
    for n in &mut nodes {
        let x = plot.min.x + (plot.width() - width).max(0.0) * n.level as f32 / levels as f32;
        let height = (n.incoming.max(n.outgoing) * scale).max(1.0);
        n.rect = Rect::from_min_size(pos2(x, offsets[n.level]), vec2(width, height));
        offsets[n.level] += height + gap;
    }
    let opacity = option_number(node, "linkOpacity", 35.0, 0.0, 100.0) / 100.0;
    for (a, b, value, index) in edges {
        let source = nodes[a].rect;
        let target = nodes[b].rect;
        let y1 = source.min.y + nodes[a].output_used * scale;
        let y2 = target.min.y + nodes[b].input_used * scale;
        nodes[a].output_used += value;
        nodes[b].input_used += value;
        let height = value * scale;
        let mut mesh = egui::Mesh::default();
        let tint = series_color(node, a).gamma_multiply(opacity);
        for i in 0..=20 {
            let t = i as f32 / 20.0;
            let smooth = t * t * (3.0 - 2.0 * t);
            let x = egui::lerp(source.max.x..=target.min.x, t);
            let y = egui::lerp(y1..=y2, smooth);
            for offset in [0.0, height] {
                mesh.vertices.push(egui::epaint::Vertex {
                    pos: pos2(x, y + offset),
                    uv: egui::epaint::WHITE_UV,
                    color: tint,
                });
            }
            if i < 20 {
                let base = i * 2;
                mesh.indices.extend_from_slice(&[
                    base,
                    base + 1,
                    base + 3,
                    base,
                    base + 3,
                    base + 2,
                ]);
            }
        }
        let mesh = Arc::new(mesh);
        p.add(Shape::Mesh(Arc::clone(&mesh)));
        if layout.enabled() && opacity > 0.0 {
            let datum = ChartDatum::detail(
                Some(index),
                format!("{} → {}", nodes[a].name, nodes[b].name),
                json!(value),
                "流量",
            );
            layout.mark(ChartShape::Mesh(mesh), datum, None);
        }
    }
    for (i, n) in nodes.iter().enumerate() {
        p.rect_filled(n.rect, 0.0, series_color(node, i));
        if layout.enabled() {
            let datum = ChartDatum::detail(
                None,
                n.name.clone(),
                json!(n.incoming.max(n.outgoing)),
                "节点流量",
            );
            layout.mark(ChartShape::Rect(n.rect), datum, None);
        }
        if option_bool(node, "showLabels", true) {
            let right = n.level == levels;
            p.text(
                if right {
                    n.rect.right_center() + vec2(4.0, 0.0)
                } else {
                    n.rect.left_center() - vec2(4.0, 0.0)
                },
                if right {
                    Align2::LEFT_CENTER
                } else {
                    Align2::RIGHT_CENTER
                },
                &n.name,
                FontId::proportional(option_number(node, "labelSize", 12.0, 6.0, 48.0)),
                option_color(node, "labelColor", "#cde3f7"),
            );
        }
    }
}

fn gantt(p: &Painter, node: &BoardNode, r: Rect, layout: &mut ChartLayout) {
    let Some(rows) = node.data["rows"].as_array() else {
        return;
    };
    let tasks: Vec<_> = rows
        .iter()
        .take(30)
        .enumerate()
        .filter_map(|(index, row)| {
            let (start, end) = (row["start"].as_f64()?, row["end"].as_f64()?);
            (end >= start).then_some((index, row, start, end))
        })
        .collect();
    if tasks.is_empty() {
        return;
    }
    let start = tasks
        .iter()
        .map(|task| task.2)
        .fold(f64::INFINITY, f64::min);
    let end = tasks
        .iter()
        .map(|task| task.3)
        .fold(f64::NEG_INFINITY, f64::max);
    let plot = plot_rect(node, r, [52.0, 16.0, 22.0, 27.0]);
    if !plot.is_positive() {
        return;
    }
    let x =
        |time: f64| plot.left() + ((time - start) / (end - start).max(1.0)) as f32 * plot.width();
    let step = plot.height() / tasks.len() as f32;
    let configured = option_number(node, "ganttHeight", 0.0, 0.0, 500.0);
    let height = if configured > 0.0 {
        configured.min(step)
    } else {
        step * 0.55
    };
    let chart = &node.data["chart"];
    let font_x = FontId::proportional(option_number(node, "xAxisFontSize", 12.0, 6.0, 48.0));
    let font_y = FontId::proportional(option_number(node, "yAxisFontSize", 12.0, 6.0, 48.0));
    let tint_x = option_color(node, "xAxisColor", "#a9b1c9");
    let tint_y = option_color(node, "yAxisColor", "#a9b1c9");
    for (suffix, visible, ends) in [
        (
            "X",
            option_bool(node, "showXAxis", true),
            [plot.left_bottom(), plot.right_bottom()],
        ),
        (
            "Y",
            option_bool(node, "showYAxis", true),
            [plot.left_top(), plot.left_bottom()],
        ),
    ] {
        if !visible || !option_bool(node, &format!("showAxisLine{suffix}"), true) {
            continue;
        }
        let dash = &chart[format!("axisLineDash{suffix}")];
        stroke(
            p,
            ends[0],
            ends[1],
            option_number(node, &format!("axisLineWidth{suffix}"), 1.0, 0.0, 20.0),
            option_color(node, &format!("axisLineColor{suffix}"), "#cccccc"),
            chart[format!("axisLineStyle{suffix}")]
                .as_str()
                .unwrap_or("solid"),
            (number(&dash[0], 2.0), number(&dash[1], 5.0)),
        );
    }
    if let Some(ticks) = chart["ganttTicks"].as_array() {
        for tick in ticks.iter().take(30) {
            let Some(time) = tick["time"]
                .as_f64()
                .filter(|time| *time >= start && *time <= end)
            else {
                continue;
            };
            let axis_x = x(time);
            if option_bool(node, "showGridX", false) {
                let dash = option_number(node, "gridDashX", 4.0, 0.5, 100.0);
                stroke(
                    p,
                    pos2(axis_x, plot.top()),
                    pos2(axis_x, plot.bottom()),
                    option_number(node, "gridWidthX", 1.0, 0.0, 20.0),
                    option_color(node, "gridColorX", "#a4c4e31e"),
                    chart["gridStyleX"].as_str().unwrap_or("solid"),
                    (dash, dash),
                );
            }
            if option_bool(node, "showXAxis", true) && option_bool(node, "showAxisLabelX", true) {
                let label = tick["label"].as_str().unwrap_or("");
                let offset = option_number(node, "xLabelOffset", 8.0, -50.0, 100.0);
                p.text(
                    pos2(axis_x, plot.bottom() + offset),
                    Align2::CENTER_TOP,
                    label,
                    font_x.clone(),
                    tint_x,
                );
            }
        }
    }
    for (slot, (index, row, start, end)) in tasks.into_iter().enumerate() {
        let y = plot.top() + step * (slot as f32 + 0.5);
        if option_bool(node, "showGridY", false) {
            let dash = option_number(node, "gridDashY", 4.0, 0.5, 100.0);
            stroke(
                p,
                pos2(plot.left(), y),
                pos2(plot.right(), y),
                option_number(node, "gridWidthY", 1.0, 0.0, 20.0),
                option_color(node, "gridColorY", "#a4c4e31e"),
                chart["gridStyleY"].as_str().unwrap_or("solid"),
                (dash, dash),
            );
        }
        let name = row["name"].as_str().unwrap_or("");
        if option_bool(node, "showYAxis", true) && option_bool(node, "showAxisLabelY", true) {
            let offset = option_number(node, "yLabelOffset", 7.0, -50.0, 100.0);
            p.text(
                pos2(plot.left() - offset, y),
                Align2::RIGHT_CENTER,
                name,
                font_y.clone(),
                tint_y,
            );
        }
        let left = x(start).min(plot.right() - 1.0);
        let width = (x(end) - left).max(1.0);
        let bar = Rect::from_min_size(pos2(left, y - height / 2.0), vec2(width, height));
        let progress = number(&row["value"], 0.0).clamp(0.0, 1.0);
        let completed = Rect::from_min_size(bar.min, vec2(width * progress, height));
        let style = &chart["ganttStyles"][index];
        let fill = |bounds: Rect, gradient: &Value, tint: &Value, fallback| {
            if let Some(gradient) = KitGradient::read(gradient) {
                gradient.rect(p, bounds, 0.0);
            } else {
                p.rect_filled(bounds, 0.0, tint.as_str().map_or(fallback, color));
            }
        };
        fill(
            bar,
            &style["planGradient"],
            &style["planColor"],
            series_color(node, index).gamma_multiply(0.35),
        );
        if completed.is_positive() {
            fill(
                completed,
                &style["finishGradient"],
                &style["finishColor"],
                series_color(node, index),
            );
        }
        layout.series(ChartShape::Rect(bar), index, 0);
        if option_bool(node, "showLabels", false) {
            let at = if chart["labelPosition"] == "inside" {
                bar.center()
            } else {
                bar.right_center()
                    + vec2(option_number(node, "labelSpacing", 10.0, 0.0, 100.0), 0.0)
            };
            show_label(p, node, at, format!("{:.0}%", progress * 100.0));
        }
    }
}

fn stream(
    p: &Painter,
    node: &BoardNode,
    r: Rect,
    rows: &[Row],
    layout: &mut ChartLayout,
    hidden: Option<&HashSet<usize>>,
) {
    let kit = node.data["chart"]["riverTop"].is_number();
    let series =
        option_number(node, "seriesCount", 3.0, 1.0, if kit { 30.0 } else { 3.0 }) as usize;
    let count = if kit && node.data["chart"]["categoryVisibilityMode"] == "custom" {
        option_number(node, "visibleCategoryCount", 10.0, 0.0, 30.0) as usize
    } else {
        rows.len()
    };
    let rows = &rows[..rows.len().min(count)];
    if rows.is_empty() {
        return;
    }
    let is_hidden = |i| hidden.is_some_and(|set| set.contains(&i));
    let value = |i: usize, s: usize| {
        let values = &node.data["rows"][i]["streamValues"];
        if kit {
            number(&values[s], 0.0).max(0.0)
        } else {
            rows[i].values[s]
        }
    };
    let visible: Vec<_> = (0..series).filter(|&s| !is_hidden(s)).collect();
    let total: Vec<f32> = (0..rows.len())
        .map(|i| visible.iter().map(|&s| value(i, s)).sum())
        .collect();
    let max = total.iter().copied().fold(1.0_f32, f32::max);
    let mut plot = if kit {
        plot_rect(node, r, [34.0, 18.0, 10.0, 27.0])
    } else {
        axis(p, node, r, 0.0, max)
    };
    let axis_y = plot.bottom();
    plot.min.y += option_number(node, "riverTop", 0.0, 0.0, plot.height().max(0.0));
    plot.max.y -= option_number(node, "riverBottom", 0.0, 0.0, plot.height().max(0.0));
    if !plot.is_positive() {
        return;
    }
    let step = plot.width() / rows.len().max(1) as f32;
    let mut lower: Vec<f32> = total.iter().map(|sum| (max - sum) / 2.0).collect();
    for s in visible {
        let upper: Vec<f32> = lower
            .iter()
            .enumerate()
            .map(|(i, low)| low + value(i, s))
            .collect();
        let at = |i: usize, value: f32| {
            pos2(
                plot.min.x + step * (i as f32 + 0.5),
                plot.max.y - value / max * plot.height(),
            )
        };
        let opacity = option_number(
            node,
            "fillOpacity",
            if kit { 100.0 } else { 60.0 },
            0.0,
            100.0,
        ) / 100.0;
        let tint = series_color(node, s);
        for i in (0..rows.len().saturating_sub(1)).filter(|_| opacity > 0.0) {
            let polygon = [
                at(i, upper[i]),
                at(i + 1, upper[i + 1]),
                at(i + 1, lower[i + 1]),
                at(i, lower[i]),
            ];
            p.add(Shape::convex_polygon(
                polygon.to_vec(),
                tint.gamma_multiply(opacity),
                Stroke::NONE,
            ));
            layout.band(
                polygon,
                ChartDatum::Series(i, s),
                ChartDatum::Series(i + 1, s),
                Some(s),
            );
        }
        let points: Vec<_> = upper
            .iter()
            .enumerate()
            .map(|(i, value)| at(i, *value))
            .collect();
        let border = option_number(
            node,
            if kit { "riverBorder" } else { "lineWidth" },
            if kit { 0.0 } else { 2.5 },
            0.0,
            20.0,
        );
        if border > 0.0 {
            let stroke = Stroke::new(
                border,
                if kit {
                    option_color(node, "riverBorderColor", "#ffffff")
                } else {
                    tint
                },
            );
            if kit {
                p.add(Shape::line(
                    lower
                        .iter()
                        .enumerate()
                        .map(|(i, low)| at(i, *low))
                        .collect(),
                    stroke,
                ));
            }
            paint_data_line(
                p,
                node,
                layout,
                &points,
                option_bool(node, "smooth", false),
                stroke,
                |i| ChartDatum::Series(i, s),
                Some(s),
            );
        }
        for (i, point) in points.iter().enumerate() {
            if !kit && option_bool(node, "showPoints", true) {
                let radius = option_number(node, "pointRadius", 3.0, 1.0, 20.0);
                let shape = paint_data_point(p, node, *point, radius, series_color(node, s), None);
                layout.series(shape, i, s);
            }
            if option_bool(node, "showLabels", false) {
                show_label(
                    p,
                    node,
                    *point - vec2(0.0, 8.0),
                    value_text(node, value(i, s)),
                );
            }
        }
        lower = upper;
    }
    if option_bool(node, "showLegend", true) {
        let size = option_number(node, "legendFontSize", 10.0, 6.0, 36.0);
        let y = if node.data["chart"]["legendPosition"].as_str() == Some("bottom") {
            r.max.y - size
        } else {
            r.min.y
        };
        for i in 0..series {
            let x = plot.max.x - (series - i) as f32 * 54.0;
            let tint = if is_hidden(i) {
                MUTED
            } else {
                series_color(node, i)
            };
            layout.legend(p, pos2(x, y), i, series_label(node, i), size, tint);
        }
    }
    if option_bool(node, "showXAxis", true) && option_bool(node, "showAxisLabelX", true) {
        for (i, row) in rows.iter().enumerate() {
            p.text(
                pos2(plot.min.x + step * (i as f32 + 0.5), axis_y + 12.0),
                Align2::CENTER_CENTER,
                &row.name,
                FontId::proportional(option_number(node, "axisFontSize", 10.0, 6.0, 36.0)),
                option_color(node, "axisColor", "#90acc1"),
            );
        }
    }
}

fn boxplot(p: &Painter, node: &BoardNode, r: Rect, layout: &mut ChartLayout) {
    let Some(raw) = node.data["rows"].as_array() else {
        return;
    };
    let boxes: Vec<_> = raw
        .iter()
        .take(30)
        .map(|item| {
            let mut v = ["min", "q1", "median", "q3", "max"].map(|key| number(&item[key], 0.0));
            v.sort_by(f32::total_cmp);
            (item.get("name").map(string).unwrap_or_default(), v)
        })
        .collect();
    let min = boxes
        .iter()
        .map(|(_, values)| values[0])
        .fold(0.0_f32, f32::min);
    let max = boxes
        .iter()
        .map(|(_, values)| values[4])
        .fold(0.0_f32, f32::max)
        .max(min + 1.0);
    let plot = axis(p, node, r, min, max);
    if !plot.is_positive() || boxes.is_empty() {
        return;
    }
    let step = plot.width() / boxes.len() as f32;
    let fallback_width = option_number(node, "barWidth", 0.0, 0.0, 200.0);
    let configured = option_number(node, "boxWidth", fallback_width, 0.0, 200.0);
    let width = if configured > 0.0 {
        configured.min(step * 0.8)
    } else {
        step * 0.45
    };
    let y = |value: f32| plot.max.y - (value - min) / (max - min) * plot.height();
    let border = option_number(node, "boxBorder", 1.5, 0.0, 20.0);
    let fills = node.data["chart"]["boxFills"].as_array();
    for (i, (name, values)) in boxes.iter().enumerate() {
        let x = plot.min.x + step * (i as f32 + 0.5);
        let c = series_color(node, i);
        let datum = || ChartDatum::detail(Some(i), name.clone(), json!(values), "五数概括");
        let whisker = [pos2(x, y(values[0])), pos2(x, y(values[4]))];
        line(p, whisker[0], whisker[1], border, c);
        if layout.enabled() {
            layout.mark(ChartShape::Line(Box::new(whisker), 3.0), datum(), None);
        }
        for value in [values[0], values[4]] {
            let ends = [
                pos2(x - width / 2.0, y(value)),
                pos2(x + width / 2.0, y(value)),
            ];
            line(p, ends[0], ends[1], border, c);
            if layout.enabled() {
                layout.mark(ChartShape::Line(Box::new(ends), 3.0), datum(), None);
            }
        }
        let rect = Rect::from_min_max(
            pos2(x - width / 2.0, y(values[3])),
            pos2(x + width / 2.0, y(values[1])),
        );
        let fill = fills
            .filter(|items| !items.is_empty())
            .and_then(|items| items[i % items.len()].as_str())
            .map_or_else(|| c.gamma_multiply(0.55), color);
        p.rect_filled(rect, 1.0, fill);
        if border > 0.0 {
            p.rect_stroke(rect, 1.0, Stroke::new(border, c), StrokeKind::Inside);
        }
        if layout.enabled() {
            layout.mark(ChartShape::Rect(rect), datum(), None);
        }
        line(
            p,
            pos2(x - width / 2.0, y(values[2])),
            pos2(x + width / 2.0, y(values[2])),
            border,
            TEXT,
        );
        if option_bool(node, "showXAxis", true) && option_bool(node, "showAxisLabelX", true) {
            p.text(
                pos2(x, plot.max.y + 13.0),
                Align2::CENTER_CENTER,
                name,
                FontId::proportional(option_number(node, "axisFontSize", 10.0, 6.0, 36.0)),
                option_color(node, "axisColor", "#90acc1"),
            );
        }
        if option_bool(node, "showLabels", false) {
            show_label(
                p,
                node,
                pos2(x, y(values[4]) - 9.0),
                value_text(node, values[4]),
            );
        }
    }
}

fn bullet(p: &Painter, node: &BoardNode, r: Rect, rows: &[Row], layout: &mut ChartLayout) {
    let max = rows
        .iter()
        .flat_map(|row| row.values.iter())
        .copied()
        .fold(1.0_f32, f32::max);
    let plot = r.shrink2(vec2(45.0, 12.0));
    if !plot.is_positive() {
        return;
    }
    let step = plot.height() / rows.len().max(1) as f32;
    let axis_size = option_number(node, "axisFontSize", 10.0, 6.0, 36.0);
    let axis_color = option_color(node, "axisColor", "#90acc1");
    for i in 0..4 {
        let x = plot.min.x + plot.width() * i as f32 / 3.0;
        if option_bool(node, "showGrid", true) {
            line(
                p,
                pos2(x, plot.min.y),
                pos2(x, plot.max.y),
                1.0,
                color("#a4c4e31e"),
            );
        }
        if option_bool(node, "showXAxis", true) {
            p.text(
                pos2(x, plot.max.y + 3.0),
                Align2::CENTER_TOP,
                format!("{:.0}", max * i as f32 / 3.0),
                FontId::proportional(axis_size),
                axis_color,
            );
        }
    }
    for (i, row) in rows.iter().enumerate() {
        let y = plot.min.y + step * i as f32;
        let h = step * 0.55;
        for (factor, shade) in [(1.0, "#23384b"), (0.7, "#344e62"), (0.4, "#496579")] {
            p.rect_filled(
                Rect::from_min_size(
                    pos2(plot.min.x, y + (step - h) / 2.0),
                    vec2(plot.width() * factor, h),
                ),
                0.0,
                color(shade),
            );
        }
        let configured = option_number(node, "barWidth", 0.0, 0.0, 200.0);
        let height = if configured > 0.0 {
            configured.min(step * 0.8)
        } else {
            step * 0.2
        };
        let rect = Rect::from_min_size(
            pos2(plot.min.x, y + (step - height) / 2.0),
            vec2(plot.width() * row.values[0] / max, height),
        );
        p.rect_filled(rect, 0.0, series_color(node, 0));
        layout.series(ChartShape::Rect(rect), i, 0);
        let target = plot.min.x + plot.width() * row.values[1] / max;
        let ends = [pos2(target, y + step * 0.2), pos2(target, y + step * 0.8)];
        line(p, ends[0], ends[1], 2.0, series_color(node, 1));
        layout.series(ChartShape::Line(Box::new(ends), 3.0), i, 1);
        if option_bool(node, "showYAxis", true) {
            p.text(
                pos2(plot.min.x - 5.0, y + step / 2.0),
                Align2::RIGHT_CENTER,
                &row.name,
                FontId::proportional(axis_size),
                axis_color,
            );
        }
        if option_bool(node, "showLabels", false) {
            show_label(
                p,
                node,
                pos2(plot.max.x, y + step / 2.0),
                value_text(node, row.values[0]),
            );
        }
    }
}

fn path(p: &Painter, node: &BoardNode, r: Rect, layout: &mut ChartLayout) {
    let Some(raw) = node.data["rows"].as_array() else {
        return;
    };
    let values: Vec<_> = raw
        .iter()
        .take(30)
        .enumerate()
        .map(|(i, row)| {
            (
                number(&row["x"], i as f32),
                number(&row["value"], 0.0),
                row.get("name").map(string).unwrap_or_default(),
            )
        })
        .collect();
    if values.is_empty() {
        return;
    }
    let xmax = values.iter().map(|v| v.0).fold(1.0_f32, f32::max);
    let ymax = values.iter().map(|v| v.1).fold(1.0_f32, f32::max);
    let plot = axis(p, node, r, 0.0, ymax);
    if !plot.is_positive() {
        return;
    }
    let points: Vec<_> = values
        .iter()
        .map(|(x, y, _)| {
            pos2(
                plot.min.x + x.max(0.0) / xmax * plot.width(),
                plot.max.y - y.max(0.0) / ymax * plot.height(),
            )
        })
        .collect();
    let stroke = Stroke::new(
        option_number(node, "lineWidth", 2.5, 0.5, 20.0),
        series_color(node, 0),
    );
    paint_data_line(
        p,
        node,
        layout,
        &points,
        option_bool(node, "smooth", false),
        stroke,
        |i| ChartDatum::Series(i, 0),
        None,
    );
    if option_bool(node, "showXAxis", true) {
        for i in 0..4 {
            let x = plot.min.x + plot.width() * i as f32 / 3.0;
            p.text(
                pos2(x, plot.max.y + 5.0),
                Align2::CENTER_TOP,
                format!("{:.0}", xmax * i as f32 / 3.0),
                FontId::proportional(option_number(node, "axisFontSize", 10.0, 6.0, 36.0)),
                option_color(node, "axisColor", "#90acc1"),
            );
        }
    }
    for (i, point) in points.iter().enumerate() {
        if option_bool(node, "showPoints", true) {
            let radius = option_number(node, "pointRadius", 3.0, 1.0, 20.0);
            let shape = paint_data_point(p, node, *point, radius, series_color(node, 0), None);
            layout.series(shape, i, 0);
        }
        if option_bool(node, "showLabels", false) {
            show_label(p, node, *point - vec2(0.0, 10.0), &values[i].2);
        }
    }
}

fn pizza(p: &Painter, node: &BoardNode, r: Rect, rows: &[Row], layout: &mut ChartLayout) {
    let center = r.center();
    let radius = r.width().min(r.height()) * 0.38;
    let count = rows.len().max(3);
    let tau = std::f32::consts::TAU;
    let levels = option_number(node, "radarLevels", 4.0, 1.0, 12.0) as usize;
    for level in 1..=levels {
        p.circle_stroke(
            center,
            radius * level as f32 / levels as f32,
            Stroke::new(1.0, color("#6cbcff30")),
        );
    }
    let max = rows.iter().map(|row| row.values[0]).fold(1.0_f32, f32::max);
    for (i, row) in rows.iter().enumerate() {
        let angle = i as f32 / count as f32 * tau - tau / 4.0;
        line(
            p,
            center,
            polar(center, radius, angle),
            1.0,
            color("#6cbcff20"),
        );
        let at = polar(center, radius * row.values[0] / max, angle);
        let point_radius = option_number(node, "pointRadius", 4.0, 1.0, 20.0);
        p.circle_filled(at, point_radius, series_color(node, i));
        layout.series(ChartShape::Circle(at, point_radius), i, 0);
        if option_bool(node, "showLabels", true) {
            show_label(p, node, polar(center, radius + 15.0, angle), &row.name);
        }
    }
}

fn sunburst(p: &Painter, node: &BoardNode, r: Rect, layout: &mut ChartLayout) {
    let Some(items) = node.data["rows"].as_array() else {
        return;
    };
    let center = r.center();
    let radius = r.width().min(r.height()) * 0.42;
    let start = option_number(node, "startAngle", -90.0, -360.0, 360.0).to_radians();
    let end = option_number(node, "endAngle", 270.0, -360.0, 720.0).to_radians();
    let span = (end - start).clamp(-std::f32::consts::TAU, std::f32::consts::TAU);
    let total = items
        .iter()
        .map(|item| number(&item["value"], 0.0).max(0.0))
        .sum::<f32>()
        .max(1.0);
    let gap = option_number(node, "segmentGap", 0.0, 0.0, 20.0).to_radians() / 2.0;
    let mut angle = start;
    for (i, item) in items.iter().take(30).enumerate() {
        let value = number(&item["value"], 0.0).max(0.0);
        let next = angle + span * value / total;
        let inset = gap.min((next - angle).abs() / 2.0) * (next - angle).signum();
        ring(
            p,
            center,
            0.0,
            radius * 0.52,
            angle + inset,
            next - inset,
            series_color(node, i),
        );
        layout.category(
            ChartShape::arc(center, 0.0, radius * 0.52, angle + inset, next - inset),
            i,
        );
        if let Some(children) = item["children"].as_array() {
            let sum = children
                .iter()
                .map(|child| number(&child["value"], 0.0).max(0.0))
                .sum::<f32>()
                .max(1.0);
            let mut child_angle = angle;
            for (j, child) in children.iter().take(30).enumerate() {
                let child_end =
                    child_angle + (next - angle) * number(&child["value"], 0.0).max(0.0) / sum;
                let child_gap = gap.min((child_end - child_angle).abs() / 2.0)
                    * (child_end - child_angle).signum();
                ring(
                    p,
                    center,
                    radius * 0.53,
                    radius,
                    child_angle + child_gap,
                    child_end - child_gap,
                    series_color(node, i + j),
                );
                if layout.enabled() {
                    let datum = ChartDatum::Detail {
                        index: Some(i),
                        child: Some(j),
                        name: child
                            .get("name")
                            .map_or_else(|| (j + 1).to_string(), string),
                        value: child["value"].clone(),
                        caption: "值",
                    };
                    let shape = ChartShape::arc(
                        center,
                        radius * 0.53,
                        radius,
                        child_angle + child_gap,
                        child_end - child_gap,
                    );
                    layout.mark(shape, datum, None);
                }
                child_angle = child_end;
            }
        }
        if option_bool(node, "showLabels", false) {
            show_label(
                p,
                node,
                polar(center, radius * 0.32, (angle + next) / 2.0),
                item.get("name").map(string).unwrap_or_default(),
            );
        }
        angle = next;
    }
}

fn animation_elapsed(node: &BoardNode, clock: &Clock) -> f64 {
    if !option_bool(node, "playAnimation", true) {
        return 0.0;
    }
    let start = node.data["chart"]["startAt"].as_f64().unwrap_or(0.0);
    (clock.now - start).max(0.0)
        / (f64::from(option_number(node, "duration", 3.0, 0.2, 60.0)) * 1000.0)
}

fn dynamic_bar(p: &Painter, node: &BoardNode, r: Rect, clock: &Clock, layout: &mut ChartLayout) {
    let Some(raw) = node.data["rows"].as_array() else {
        return;
    };
    let mut periods = Vec::<String>::new();
    let mut frames = HashMap::<String, Vec<(String, f32, usize)>>::new();
    for (index, item) in raw.iter().take(5000).enumerate() {
        let period = item
            .get("period")
            .or_else(|| item.get("月份"))
            .map(string)
            .unwrap_or_default();
        let name = item
            .get("name")
            .or_else(|| item.get("种类"))
            .map(string)
            .unwrap_or_default();
        let value = number(
            item.get("value")
                .or_else(|| item.get("销量"))
                .unwrap_or(&Value::Null),
            0.0,
        )
        .max(0.0);
        if name.is_empty() {
            continue;
        }
        if !frames.contains_key(&period) {
            periods.push(period.clone());
        }
        frames.entry(period).or_default().push((name, value, index));
    }
    if periods.is_empty() {
        centered(p, r, 13.0, "暂无数据", MUTED);
        return;
    }
    let elapsed = animation_elapsed(node, clock);
    let current = (elapsed.floor() as usize) % periods.len();
    let next = (current + 1) % periods.len();
    let blend = elapsed.fract() as f32;
    let next_values: HashMap<_, _> = frames[&periods[next]]
        .iter()
        .map(|(name, value, _)| (name.as_str(), *value))
        .collect();
    let mut values: Vec<_> = frames[&periods[current]]
        .iter()
        .map(|(name, value, index)| {
            let next_value = next_values.get(name.as_str()).copied().unwrap_or(*value);
            (
                name.as_str(),
                egui::lerp(*value..=next_value, blend),
                *index,
            )
        })
        .collect();
    values.sort_by(|a, b| b.1.total_cmp(&a.1));
    values.truncate(option_number(node, "maxItems", 5.0, 1.0, 20.0) as usize);
    if values.is_empty() {
        return;
    }
    let max = values.iter().map(|item| item.1).fold(1.0_f32, f32::max);
    let plot = r.shrink2(vec2(48.0, 24.0));
    if !plot.is_positive() {
        return;
    }
    let axis_size = option_number(node, "axisFontSize", 10.0, 6.0, 36.0);
    let axis_color = option_color(node, "axisColor", "#90acc1");
    for i in 0..4 {
        let x = plot.min.x + plot.width() * i as f32 / 3.0;
        if option_bool(node, "showGrid", true) {
            line(
                p,
                pos2(x, plot.min.y),
                pos2(x, plot.max.y),
                1.0,
                color("#a4c4e31e"),
            );
        }
        if option_bool(node, "showXAxis", true) {
            p.text(
                pos2(x, plot.max.y + 4.0),
                Align2::CENTER_TOP,
                format!("{:.0}", max * i as f32 / 3.0),
                FontId::proportional(axis_size),
                axis_color,
            );
        }
    }
    let step = plot.height() / values.len() as f32;
    let configured = option_number(node, "barWidth", 0.0, 0.0, 200.0);
    let height = if configured > 0.0 {
        configured.min(step)
    } else {
        step * 0.45
    };
    for (i, &(name, value, index)) in values.iter().enumerate() {
        let y = plot.min.y + step * (i as f32 + 0.5);
        let width = plot.width() * value / max;
        let rect = Rect::from_min_size(pos2(plot.min.x, y - height / 2.0), vec2(width, height));
        p.rect_filled(
            rect,
            option_number(node, "barRadius", 1.0, 0.0, 30.0),
            series_color(node, 0),
        );
        if layout.enabled() {
            let datum = ChartDatum::detail(Some(index), name.to_owned(), json!(value), "值");
            layout.mark(ChartShape::Rect(rect), datum, None);
        }
        if option_bool(node, "showYAxis", true) {
            p.text(
                pos2(plot.min.x - 5.0, y),
                Align2::RIGHT_CENTER,
                name,
                FontId::proportional(axis_size),
                axis_color,
            );
        }
        if option_bool(node, "showLabels", false) {
            p.text(
                pos2(plot.min.x + width + 5.0, y),
                Align2::LEFT_CENTER,
                value_text(node, value),
                FontId::proportional(option_number(node, "labelSize", 12.0, 6.0, 48.0)),
                option_color(node, "labelColor", "#cde3f7"),
            );
        }
    }
    p.text(
        pos2(plot.max.x, r.min.y),
        Align2::RIGHT_TOP,
        &periods[current],
        FontId::proportional(axis_size),
        axis_color,
    );
}

fn path_animation(p: &Painter, node: &BoardNode, r: Rect, clock: &Clock, layout: &mut ChartLayout) {
    let Some(raw) = node.data["rows"].as_array() else {
        return;
    };
    let points: Vec<_> = raw
        .iter()
        .take(100)
        .map(|item| {
            pos2(
                r.min.x + number(&item["x"], 0.0).clamp(0.0, 1.0) * r.width(),
                r.min.y + number(&item["y"], 0.0).clamp(0.0, 1.0) * r.height(),
            )
        })
        .collect();
    if points.len() < 2 {
        return;
    }
    let curved = option_bool(node, "smooth", false) && points.len() >= 3;
    let points = if curved { smooth(&points) } else { points };
    let tint = series_color(node, 0);
    let stroke = Stroke::new(option_number(node, "lineWidth", 2.5, 0.5, 20.0), tint);
    let stride = if curved { SMOOTH_STEPS } else { 1 };
    layout.line(
        &points,
        stride,
        (stroke.width / 2.0).max(4.0),
        |index| {
            let row = &raw[index];
            let name = row
                .get("name")
                .map_or_else(|| format!("路径点 {}", index + 1), string);
            let value = json!([number(&row["x"], 0.0), number(&row["y"], 0.0)]);
            ChartDatum::detail(Some(index), name, value, "位置")
        },
        None,
    );
    let lengths: Vec<f32> = points
        .windows(2)
        .map(|pair| pair[0].distance(pair[1]))
        .collect();
    let distance = lengths.iter().sum::<f32>() * animation_elapsed(node, clock).fract() as f32;
    let mut remaining = distance;
    let mut at = points[0];
    for (index, length) in lengths.iter().enumerate() {
        if remaining <= *length {
            at = points[index].lerp(
                points[index + 1],
                if *length > 0.0 {
                    remaining / length
                } else {
                    0.0
                },
            );
            break;
        }
        remaining -= length;
    }
    p.add(Shape::line(points, stroke));
    if option_bool(node, "showPoints", true) {
        let radius = option_number(node, "pointRadius", 3.0, 1.0, 20.0);
        p.circle_filled(at, radius, tint);
        if layout.enabled() {
            let value = json!([(at.x - r.min.x) / r.width(), (at.y - r.min.y) / r.height()]);
            layout.mark(
                ChartShape::Circle(at, radius.max(4.0)),
                ChartDatum::detail(None, "动画点".into(), value, "位置"),
                None,
            );
        }
    }
}
