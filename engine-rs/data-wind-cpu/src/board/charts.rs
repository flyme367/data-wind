use std::{borrow::Cow, collections::HashSet, sync::Arc};

use egui::{Align2, Color32, FontId, Painter, Pos2, Rect, Shape, Stroke, StrokeKind, pos2, vec2};

use super::kit::KitGradient;
use super::widgets::{centered, label, line};
use super::{BoardNode, BoardScene, Clock, MUTED, PALETTE, TEXT, color, number, string};

mod axis;
mod extra;
mod flow;
mod interaction;
mod labels;
mod legend_text;
mod rank;
pub(super) mod zoom;

use interaction::{ChartArc, ChartDatum, ChartShape};
pub(super) use interaction::{ChartHit, ChartLayout};

pub(super) struct Row {
    pub name: String,
    pub values: [f32; 3],
}

fn supports_signed_scale(node: &BoardNode) -> bool {
    matches!(
        node.widget.kind.as_str(),
        "line"
            | "lineSmooth"
            | "lineMulti"
            | "area"
            | "areaGradient"
            | "bar"
            | "barGradient"
            | "barGrouped"
            | "barHorizontal"
    ) && !matches!(
        node.data["chart"]["variant"].as_str().unwrap_or(""),
        "rangeArea"
            | "rangeBar"
            | "horizontalRange"
            | "pictorial"
            | "path"
            | "pathAnimation"
            | "polarBar"
            | "colorRing"
            | "sankey"
            | "gantt"
            | "waterfall"
            | "stream"
            | "boxplot"
            | "bullet"
            | "dynamicBar"
    )
}

pub(super) fn rows(node: &BoardNode) -> Vec<Row> {
    let limit = if node.data["chart"]["variant"].as_str() == Some("calendarHeatmap") {
        371
    } else {
        30
    };
    let offset = node.data["__zoomRowOffset"].as_u64().unwrap_or(0) as usize;
    let signed = supports_signed_scale(node);
    node.data["rows"].as_array().map_or_else(Vec::new, |rows| {
        rows.iter()
            .take(limit)
            .enumerate()
            .map(|(i, row)| Row {
                name: row
                    .get("name")
                    .map_or_else(|| (i + offset + 1).to_string(), string),
                values: ["value", "value2", "value3"].map(|key| {
                    let value = number(&row[key], 0.0);
                    if signed { value } else { value.max(0.0) }
                }),
            })
            .collect()
    })
}

fn visible_rows(node: &BoardNode, variant: &str, hidden: Option<&HashSet<usize>>) -> Vec<Row> {
    let mut values = rows(node);
    if let Some(hidden) = hidden {
        if matches!(
            node.widget.kind.as_str(),
            "pie" | "pieBasic" | "pieRose" | "pie3d" | "donut3d" | "rose3d" | "roseRing3d"
        ) || matches!(variant, "polarBar" | "colorRing")
        {
            for (i, row) in values.iter_mut().enumerate() {
                if hidden.contains(&i) {
                    row.values[0] = 0.0;
                }
            }
        } else if !matches!(
            variant,
            "waterfall" | "rangeBar" | "horizontalRange" | "rangeArea"
        ) {
            for row in &mut values {
                for &index in hidden {
                    if index < row.values.len() {
                        row.values[index] = 0.0;
                    }
                }
            }
        }
    }
    values
}

fn series_color(node: &BoardNode, index: usize) -> Color32 {
    if let Some(value) = node.data["chart"]["colors"]
        .as_array()
        .and_then(|colors| {
            if node.data["chart"]["paletteCycle"] == true && !colors.is_empty() {
                colors.get(index % colors.len())
            } else {
                colors.get(index)
            }
        })
        .and_then(serde_json::Value::as_str)
    {
        color(value)
    } else if index == 0 {
        color(&node.color)
    } else {
        PALETTE[index % PALETTE.len()]
    }
}

/// Direct row comparisons use the original data, not the clamped chart value.
fn conditional_color(node: &BoardNode, row_index: usize, series: usize) -> Option<Color32> {
    let row = node.data["rows"].as_array()?.get(row_index)?;
    let rules = node.data["chart"]["colorConditions"].as_array()?;
    let numeric = |value: &serde_json::Value| {
        value
            .as_f64()
            .or_else(|| {
                value
                    .as_str()
                    .and_then(|text| text.trim().parse::<f64>().ok())
            })
            .filter(|value| value.is_finite())
    };
    for rule in rules.iter().take(32) {
        let target = rule["series"].as_str().unwrap_or("all");
        if target != "all" && target.parse::<usize>().ok() != Some(series + 1) {
            continue;
        }
        let Some(field) = rule["field"].as_str().and_then(|field| row.get(field)) else {
            continue;
        };
        let expected = &rule["value"];
        if expected.is_null() {
            continue;
        }
        let numbers = numeric(field).zip(numeric(expected));
        let matches = match rule["operator"].as_str().unwrap_or("gte") {
            "gt" => numbers.is_some_and(|(a, b)| a > b),
            "gte" => numbers.is_some_and(|(a, b)| a >= b),
            "lt" => numbers.is_some_and(|(a, b)| a < b),
            "lte" => numbers.is_some_and(|(a, b)| a <= b),
            "eq" => numbers.map_or_else(|| string(field) == string(expected), |(a, b)| a == b),
            "ne" => numbers.map_or_else(|| string(field) != string(expected), |(a, b)| a != b),
            _ => false,
        };
        if matches && let Some(value) = rule["color"].as_str() {
            return Some(color(value));
        }
    }
    None
}

fn series_label(node: &BoardNode, index: usize) -> String {
    node.data["chart"]["seriesLabels"][index]
        .as_str()
        .map_or_else(|| format!("值{}", index + 1), str::to_owned)
}

fn option_number(node: &BoardNode, key: &str, fallback: f32, min: f32, max: f32) -> f32 {
    number(&node.data["chart"][key], fallback).clamp(min, max)
}

fn option_bool(node: &BoardNode, key: &str, fallback: bool) -> bool {
    node.data["chart"][key].as_bool().unwrap_or(fallback)
}

fn option_color(node: &BoardNode, key: &str, fallback: &str) -> Color32 {
    color(node.data["chart"][key].as_str().unwrap_or(fallback))
}

fn nonzero_limit(value: f32) -> f32 {
    if value > 0.0 { value } else { 1.0 }
}

fn legend_position(node: &BoardNode) -> &str {
    let value = node.data["chart"]["legendPosition"]
        .as_str()
        .unwrap_or("auto");
    match value {
        "left" => "left-center",
        "right" => "right-center",
        "top" if node.data["__kitChart"] == true => "top-center",
        "bottom" if node.data["__kitChart"] == true => "bottom-center",
        _ => value,
    }
}

fn plot_rect(node: &BoardNode, rect: Rect, defaults: [f32; 4]) -> Rect {
    let padding = &node.data["chart"]["kitPadding"];
    let side = |index| number(&padding[index], defaults[index]);
    Rect::from_min_max(
        rect.min + vec2(side(0), side(1)),
        rect.max - vec2(side(2), side(3)),
    )
}

fn formatted_number(node: &BoardNode, value: f32) -> String {
    let decimals = option_number(node, "decimals", 0.0, 0.0, 6.0) as usize;
    let formatted = format!("{value:.decimals$}");
    if decimals > 0 && !option_bool(node, "labelPadZeros", true) {
        formatted
            .trim_end_matches('0')
            .trim_end_matches('.')
            .to_owned()
    } else {
        formatted
    }
}

fn value_text(node: &BoardNode, value: f32) -> String {
    let unit = node.data["chart"]["unit"].as_str().unwrap_or("");
    format!("{}{unit}", formatted_number(node, value))
}

fn polar(center: Pos2, radius: f32, angle: f32) -> Pos2 {
    center + vec2(angle.cos(), angle.sin()) * radius
}

fn ring(p: &Painter, center: Pos2, inner: f32, outer: f32, from: f32, to: f32, tint: Color32) {
    let count = ((to - from).abs() * 28.0).ceil().max(1.0) as usize;
    let mut mesh = egui::Mesh::default();
    for i in 0..=count {
        let angle = egui::lerp(from..=to, i as f32 / count as f32);
        for radius in [inner, outer] {
            mesh.vertices.push(egui::epaint::Vertex {
                pos: polar(center, radius, angle),
                uv: egui::epaint::WHITE_UV,
                color: tint,
            });
        }
        if i < count {
            let base = i as u32 * 2;
            mesh.indices
                .extend_from_slice(&[base, base + 1, base + 3, base, base + 3, base + 2]);
        }
    }
    p.add(Shape::mesh(mesh));
}

/// 伪 3D 明暗：t > 0 向白色靠近（顶面），t < 0 向黑色靠近（侧面）。
fn mix_to(tint: Color32, target: u8, t: f32) -> Color32 {
    let lerp = |channel: u8| (channel as f32 + (target as f32 - channel as f32) * t).round() as u8;
    Color32::from_rgb(lerp(tint.r()), lerp(tint.g()), lerp(tint.b()))
}

/// 椭圆投影点：radius 为横向半径，纵向按 squish 压扁，dy 为挤出深度偏移。
fn elliptic(center: Pos2, squish: f32, radius: f32, angle: f32, dy: f32) -> Pos2 {
    pos2(
        center.x + radius * angle.cos(),
        center.y + radius * squish * angle.sin() + dy,
    )
}

/// 椭圆楔形网格：inner == 0 为实心扇形，否则为环楔。
fn elliptic_wedge(
    p: &Painter,
    center: Pos2,
    squish: f32,
    inner: f32,
    outer: f32,
    from: f32,
    to: f32,
    tint: Color32,
) {
    let count = ((to - from).abs() * 32.0).ceil().max(1.0) as usize;
    if inner <= 0.0 {
        let mut mesh = egui::Mesh::default();
        mesh.vertices.push(egui::epaint::Vertex {
            pos: center,
            uv: egui::epaint::WHITE_UV,
            color: tint,
        });
        for i in 0..=count {
            let angle = egui::lerp(from..=to, i as f32 / count as f32);
            mesh.vertices.push(egui::epaint::Vertex {
                pos: elliptic(center, squish, outer, angle, 0.0),
                uv: egui::epaint::WHITE_UV,
                color: tint,
            });
            if i < count {
                mesh.indices
                    .extend_from_slice(&[0, i as u32 + 1, i as u32 + 2]);
            }
        }
        p.add(Shape::mesh(mesh));
    } else {
        let mut mesh = egui::Mesh::default();
        for i in 0..=count {
            let angle = egui::lerp(from..=to, i as f32 / count as f32);
            for radius in [inner, outer] {
                mesh.vertices.push(egui::epaint::Vertex {
                    pos: elliptic(center, squish, radius, angle, 0.0),
                    uv: egui::epaint::WHITE_UV,
                    color: tint,
                });
            }
            if i < count {
                let base = i as u32 * 2;
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
        p.add(Shape::mesh(mesh));
    }
}

/// 挤出侧壁带：弧段 [from, to] 向下挤出 depth；逐段凸四边形。
fn elliptic_wall(
    p: &Painter,
    center: Pos2,
    squish: f32,
    radius: f32,
    from: f32,
    to: f32,
    depth: f32,
    tint: Color32,
) -> Arc<egui::Mesh> {
    let count = ((to - from).abs() * 24.0).ceil().max(1.0) as usize;
    let mut mesh = egui::Mesh::default();
    for i in 0..=count {
        let angle = egui::lerp(from..=to, i as f32 / count as f32);
        for dy in [0.0, depth] {
            mesh.vertices.push(egui::epaint::Vertex {
                pos: elliptic(center, squish, radius, angle, dy),
                uv: egui::epaint::WHITE_UV,
                color: tint,
            });
        }
        if i < count {
            let base = i as u32 * 2;
            mesh.indices
                .extend_from_slice(&[base, base + 1, base + 3, base, base + 3, base + 2]);
        }
    }
    let mesh = Arc::new(mesh);
    p.add(Shape::Mesh(Arc::clone(&mesh)));
    mesh
}

fn paint_data_line(
    p: &Painter,
    node: &BoardNode,
    layout: &mut ChartLayout,
    points: &[Pos2],
    curved: bool,
    stroke: Stroke,
    datum: impl Fn(usize) -> ChartDatum,
    legend: Option<usize>,
) {
    if stroke.width <= 0.0 || points.len() < 2 {
        return;
    }
    let curved = curved && points.len() >= 3;
    let path = if curved {
        smooth(points)
    } else {
        points.to_vec()
    };
    let stride = if curved { SMOOTH_STEPS } else { 1 };
    layout.line(&path, stride, (stroke.width / 2.0).max(4.0), datum, legend);
    let shadow = option_color(node, "lineShadowColor", "transparent");
    if shadow.a() > 0 {
        let blur = option_number(node, "lineShadowBlur", 0.0, 0.0, 100.0);
        let offsets = &node.data["chart"]["lineShadowOffset"];
        let offset = vec2(number(&offsets[0], 0.0), number(&offsets[1], 0.0));
        let shifted: Vec<_> = path.iter().map(|point| *point + offset).collect();
        for layer in (0..=3).rev() {
            let width = stroke.width + blur * layer as f32 / 3.0;
            p.add(Shape::line(
                shifted.clone(),
                Stroke::new(
                    width,
                    shadow.gamma_multiply(if layer == 0 { 0.4 } else { 0.1 }),
                ),
            ));
        }
    }
    if node.data["chart"]["lineStyle"].as_str() == Some("dashed") {
        p.extend(Shape::dashed_line(&path, stroke, 7.0, 4.0));
    } else {
        p.add(Shape::line(path, stroke));
    }
}

fn series_style_node(node: &BoardNode, series: usize) -> Cow<'_, BoardNode> {
    if !option_bool(node, "seriesStyleEnabled", false) {
        return Cow::Borrowed(node);
    }
    let Some(style) = node.data["chart"]["seriesStyles"][series].as_object() else {
        return Cow::Borrowed(node);
    };
    let mut styled = node.clone();
    for (key, value) in style {
        styled.data["chart"][key] = value.clone();
    }
    Cow::Owned(styled)
}

fn line_segments(values: &[f32], remove_zero: bool, segment: bool) -> Vec<Vec<usize>> {
    let mut spans: Vec<Vec<usize>> = vec![Vec::new()];
    for (index, value) in values.iter().enumerate() {
        if remove_zero && *value == 0.0 {
            if segment && spans.last().is_some_and(|span| !span.is_empty()) {
                spans.push(Vec::new());
            }
        } else if let Some(span) = spans.last_mut() {
            span.push(index);
        }
    }
    spans.retain(|span| !span.is_empty());
    spans
}

fn paint_data_point(
    p: &Painter,
    node: &BoardNode,
    at: Pos2,
    radius: f32,
    tint: Color32,
    image: Option<&egui::TextureHandle>,
) -> ChartShape {
    let hit = radius.max(4.0);
    let rect = Rect::from_center_size(at, vec2(radius * 2.0, radius * 2.0));
    let shadow = option_color(node, "pointShadowColor", "transparent");
    if shadow.a() > 0 {
        let blur = option_number(node, "pointShadowBlur", 0.0, 0.0, 100.0);
        let offsets = &node.data["chart"]["pointShadowOffset"];
        let center = at + vec2(number(&offsets[0], 0.0), number(&offsets[1], 0.0));
        for layer in (0..=3).rev() {
            p.circle_filled(
                center,
                radius + blur * layer as f32 / 3.0,
                shadow.gamma_multiply(if layer == 0 { 0.4 } else { 0.1 }),
            );
        }
    }
    match node.data["chart"]["pointShape"]
        .as_str()
        .unwrap_or("circle")
    {
        "image" => {
            if let Some(texture) = image {
                p.image(
                    texture.id(),
                    rect,
                    Rect::from_min_max(pos2(0.0, 0.0), pos2(1.0, 1.0)),
                    Color32::WHITE,
                );
            } else {
                p.circle_filled(at, radius, tint);
            }
            ChartShape::Rect(Rect::from_center_size(at, vec2(hit * 2.0, hit * 2.0)))
        }
        "gradientCircle" => {
            let mut mesh = egui::Mesh::default();
            mesh.colored_vertex(at, tint);
            for index in 0..=24 {
                let angle = std::f32::consts::TAU * index as f32 / 24.0;
                mesh.colored_vertex(
                    at + vec2(angle.cos(), angle.sin()) * radius,
                    tint.gamma_multiply(0.12),
                );
                if index < 24 {
                    mesh.add_triangle(0, index + 1, index + 2);
                }
            }
            p.add(Shape::mesh(mesh));
            ChartShape::Circle(at, hit)
        }
        "square" | "squareEmpty" | "roundSquare" => {
            match node.data["chart"]["pointShape"].as_str() {
                Some("squareEmpty") => {
                    p.rect_stroke(rect, 0.0, Stroke::new(1.5, tint), StrokeKind::Inside);
                }
                Some("roundSquare") => {
                    p.rect_filled(rect, radius / 2.0, tint);
                }
                _ => {
                    p.rect_filled(rect, 0.0, tint);
                }
            }
            ChartShape::Rect(Rect::from_center_size(at, vec2(hit * 2.0, hit * 2.0)))
        }
        "circleEmpty" => {
            p.circle_stroke(at, radius, Stroke::new(1.5, tint));
            ChartShape::Circle(at, hit)
        }
        "triangle" | "diamond" => {
            let polygon = |size: f32| {
                if node.data["chart"]["pointShape"] == "triangle" {
                    vec![
                        at + vec2(0.0, -size),
                        at + vec2(size, size),
                        at + vec2(-size, size),
                    ]
                } else {
                    vec![
                        at + vec2(0.0, -size),
                        at + vec2(size, 0.0),
                        at + vec2(0.0, size),
                        at + vec2(-size, 0.0),
                    ]
                }
            };
            p.add(Shape::convex_polygon(polygon(radius), tint, Stroke::NONE));
            ChartShape::Polygon(polygon(hit).into_boxed_slice())
        }
        _ => {
            p.circle_filled(at, radius, tint);
            ChartShape::Circle(at, hit)
        }
    }
}

impl BoardScene {
    pub(super) fn paint_chart(
        &self,
        p: &Painter,
        node: &BoardNode,
        r: Rect,
        clock: &Clock,
        layout: &mut ChartLayout,
    ) {
        if r.width() < 2.0 || r.height() < 2.0 {
            return;
        }
        let kind = node.widget.kind.as_str();
        let variant = node.data["chart"]["variant"].as_str().unwrap_or("");
        let hidden = self.chart_hidden.get(&node.id);
        let is_hidden = |key: usize| hidden.is_some_and(|entries| entries.contains(&key));
        let legend_tint = |key: usize| {
            if is_hidden(key) {
                MUTED
            } else {
                series_color(node, key)
            }
        };
        let mut rows = visible_rows(node, variant, hidden);
        if (kind.starts_with("line") || kind.starts_with("area"))
            && !matches!(variant, "rangeArea" | "stream" | "path" | "pathAnimation")
            && node.data["chart"]["categoryVisibilityMode"] == "custom"
        {
            rows.truncate(option_number(node, "visibleCategoryCount", 10.0, 0.0, 30.0) as usize);
        }
        if rows.is_empty() {
            centered(p, r, 13.0, "暂无数据", MUTED);
            return;
        }
        let max = rows.iter().map(|r| r.values[0]).fold(1.0_f32, f32::max);
        let size = r.width().min(r.height());
        let tint = series_color(node, 0);
        let tau = std::f32::consts::TAU;
        let legend_visible = option_bool(node, "showLegend", true);
        let label_color = option_color(node, "labelColor", "#cde3f7");
        let label_size = option_number(node, "labelSize", 12.0, 6.0, 48.0);
        let legend_size = option_number(node, "legendFontSize", 10.0, 6.0, 36.0);
        if extra::paint_extra(p, node, r, &rows, variant, clock, layout, hidden) {
            return;
        }
        if matches!(variant, "polarBar" | "colorRing") {
            let radius = (size * 0.42).min(r.width() * if legend_visible { 0.26 } else { 0.45 });
            let center = if legend_visible {
                pos2(r.min.x + radius + 8.0, r.center().y)
            } else {
                r.center()
            };
            let from = option_number(node, "startAngle", -90.0, -360.0, 360.0).to_radians();
            let to = option_number(node, "endAngle", 270.0, -360.0, 720.0).to_radians();
            let step = (to - from).clamp(-tau, tau) / rows.len() as f32;
            let gap = (option_number(node, "segmentGap", 0.0, 0.0, 20.0).to_radians() / 2.0)
                .min(step.abs() / 2.0)
                * step.signum();
            let inner = if variant == "colorRing" {
                option_number(node, "innerRadius", 65.0, 0.0, 95.0) / 100.0
            } else {
                0.0
            };
            for (i, row) in rows.iter().enumerate() {
                let start = from + i as f32 * step;
                let outer = if variant == "polarBar" {
                    radius * (0.15 + 0.85 * row.values[0] / max)
                } else {
                    radius
                };
                let inside = (radius * inner).min(outer * 0.95);
                let (from, to) = (start + gap, start + step - gap);
                if !is_hidden(i) {
                    ring(p, center, inside, outer, from, to, series_color(node, i));
                    layout.category(ChartShape::arc(center, inside, outer, from, to), i);
                }
                if !is_hidden(i) && option_bool(node, "showLabels", variant == "colorRing") {
                    p.text(
                        polar(center, outer * (1.0 + inner) / 2.0, start + step / 2.0),
                        Align2::CENTER_CENTER,
                        value_text(node, row.values[0]),
                        FontId::proportional(label_size),
                        label_color,
                    );
                }
                if legend_visible && (i < 6 || node.data["chart"]["legendType"] == "scroll") {
                    let at = pos2(
                        center.x + radius + 18.0,
                        r.center().y - 60.0 + i as f32 * 23.0,
                    );
                    layout.legend(p, at, i, &row.name, legend_size, legend_tint(i));
                }
            }
            return;
        }
        if variant == "waterfall" {
            let plot = plot_rect(node, r, [34.0, 18.0, 10.0, 27.0]);
            if !plot.is_positive() {
                return;
            }
            let raw = node.data["rows"].as_array();
            let deltas: Vec<f32> = (0..rows.len())
                .map(|i| {
                    raw.and_then(|items| items.get(i))
                        .map_or(0.0, |item| number(&item["value"], 0.0))
                })
                .collect();
            let mut cumulative = vec![0.0];
            for value in &deltas {
                cumulative.push(cumulative.last().copied().unwrap_or(0.0) + value);
            }
            let lo = cumulative.iter().copied().fold(0.0_f32, f32::min);
            let hi = cumulative.iter().copied().fold(1.0_f32, f32::max);
            let y_of = |value: f32| plot.max.y - (value - lo) / (hi - lo).max(1.0) * plot.height();
            let axis_color = option_color(node, "axisColor", "#90acc1");
            let axis_size = option_number(node, "axisFontSize", 10.0, 6.0, 36.0);
            for i in 0..4 {
                let value = lo + (hi - lo) * i as f32 / 3.0;
                let y = y_of(value);
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
                        pos2(plot.min.x - 7.0, y),
                        Align2::RIGHT_CENTER,
                        format!("{value:.0}"),
                        FontId::proportional(axis_size),
                        axis_color,
                    );
                }
            }
            let step = plot.width() / rows.len() as f32;
            let configured = option_number(node, "barWidth", 0.0, 0.0, 200.0);
            let width = if configured > 0.0 {
                configured.min(step)
            } else {
                step * 0.6
            };
            for (i, row) in rows.iter().enumerate() {
                let x = plot.min.x + step * (i as f32 + 0.5);
                let top = y_of(cumulative[i].max(cumulative[i + 1]));
                let bottom = y_of(cumulative[i].min(cumulative[i + 1]));
                let key = usize::from(deltas[i] < 0.0);
                if !is_hidden(key) {
                    let rect = Rect::from_min_max(
                        pos2(x - width / 2.0, top),
                        pos2(x + width / 2.0, bottom),
                    );
                    p.rect_filled(
                        rect,
                        option_number(node, "barRadius", 1.0, 0.0, 30.0),
                        series_color(node, key),
                    );
                    layout.mark(ChartShape::Rect(rect), ChartDatum::Series(i, 0), Some(key));
                }
                if i + 1 < rows.len() {
                    line(
                        p,
                        pos2(x + width / 2.0, y_of(cumulative[i + 1])),
                        pos2(x + step - width / 2.0, y_of(cumulative[i + 1])),
                        1.0,
                        axis_color,
                    );
                }
                if option_bool(node, "showXAxis", true) {
                    p.text(
                        pos2(x, plot.max.y + 13.0),
                        Align2::CENTER_CENTER,
                        &row.name,
                        FontId::proportional(axis_size),
                        axis_color,
                    );
                }
                if !is_hidden(key) && option_bool(node, "showLabels", false) {
                    p.text(
                        pos2(x, top - 3.0),
                        Align2::CENTER_BOTTOM,
                        value_text(node, deltas[i]),
                        FontId::proportional(label_size),
                        label_color,
                    );
                }
            }
            if legend_visible {
                let y = if node.data["chart"]["legendPosition"].as_str() == Some("bottom") {
                    r.max.y - legend_size
                } else {
                    r.min.y
                };
                for (index, title) in ["增加", "减少"].iter().enumerate() {
                    let x = plot.max.x - (2 - index) as f32 * 54.0;
                    layout.legend(p, pos2(x, y), index, title, legend_size, legend_tint(index));
                }
            }
            return;
        }
        if matches!(kind, "pie" | "pieBasic" | "pieRose") {
            let position = legend_position(node);
            let horizontal_legend =
                legend_visible && (position.starts_with("top-") || position.starts_with("bottom-"));
            let base_radius = if horizontal_legend {
                (size * 0.37).min(r.width() * 0.45)
            } else {
                (size * 0.42).min(r.width() * if legend_visible { 0.26 } else { 0.45 })
            };
            let radius = base_radius * option_number(node, "pieSize", 100.0, 10.0, 100.0) / 100.0;
            let center = if !legend_visible {
                r.center()
            } else if horizontal_legend {
                r.center()
                    + vec2(
                        0.0,
                        if position.starts_with("top-") {
                            8.0
                        } else {
                            -8.0
                        },
                    )
            } else if position.starts_with("left-") {
                pos2(r.max.x - base_radius - 8.0, r.center().y)
            } else {
                pos2(r.min.x + base_radius + 8.0, r.center().y)
            };
            let sum = rows
                .iter()
                .map(|r| r.values[0])
                .sum::<f32>()
                .max(f32::EPSILON);
            let pie_max = rows
                .iter()
                .map(|row| row.values[0])
                .fold(f32::EPSILON, f32::max);
            let start_angle = option_number(node, "startAngle", -90.0, -360.0, 360.0).to_radians();
            let end_angle = option_number(node, "endAngle", 270.0, -360.0, 720.0).to_radians();
            let sweep = (end_angle - start_angle).clamp(-tau, tau);
            let gap = option_number(node, "segmentGap", 0.0, 0.0, 20.0).to_radians();
            let inner = option_number(node, "innerRadius", 65.0, 0.0, 95.0) / 100.0;
            let mut start = start_angle;
            for (i, row) in rows.iter().enumerate() {
                let end = start
                    + if kind == "pieRose" {
                        sweep / rows.len() as f32
                    } else {
                        row.values[0] / sum * sweep
                    };
                let outer = if kind == "pieRose" {
                    radius * (0.3 + row.values[0] / pie_max * 0.7)
                } else {
                    radius
                };
                let inset = (gap / 2.0).min((end - start).abs() / 2.0) * (end - start).signum();
                let is_ring = kind == "pie" || variant == "roseRing";
                let inside = if is_ring {
                    (radius * inner).min(outer * 0.95)
                } else {
                    0.0
                };
                let (from, to) = (start + inset, end - inset);
                if row.values[0] > 0.0 {
                    ring(p, center, inside, outer, from, to, series_color(node, i));
                    layout.category(ChartShape::arc(center, inside, outer, from, to), i);
                    let width = option_number(node, "pieBorderWidth", 0.0, 0.0, 20.0);
                    if width > 0.0 {
                        let count = ((to - from).abs() * 28.0).ceil().max(1.0) as usize;
                        let mut outline: Vec<_> = (0..=count)
                            .map(|step| {
                                polar(
                                    center,
                                    outer,
                                    egui::lerp(from..=to, step as f32 / count as f32),
                                )
                            })
                            .collect();
                        if inside > 0.0 {
                            outline.extend((0..=count).rev().map(|step| {
                                polar(
                                    center,
                                    inside,
                                    egui::lerp(from..=to, step as f32 / count as f32),
                                )
                            }));
                        } else {
                            outline.push(center);
                        }
                        p.add(Shape::closed_line(
                            outline,
                            Stroke::new(width, option_color(node, "pieBorderColor", "#ffffff")),
                        ));
                    }
                }
                if option_bool(node, "showLabels", false) && row.values[0] > 0.0 {
                    let at = polar(
                        center,
                        outer * if is_ring { (1.0 + inner) / 2.0 } else { 0.65 },
                        (start + end) / 2.0,
                    );
                    p.text(
                        at,
                        Align2::CENTER_CENTER,
                        if node.data["chart"]["labelFormat"] == "percent" {
                            format!("{}%", formatted_number(node, row.values[0] / sum * 100.0))
                        } else {
                            value_text(node, row.values[0])
                        },
                        FontId::proportional(label_size),
                        label_color,
                    );
                }
                start = end;
                if legend_visible && (i < 6 || node.data["chart"]["legendType"] == "scroll") {
                    let at = pos2(
                        center.x + radius + 18.0,
                        r.center().y - 60.0 + i as f32 * 23.0,
                    );
                    let value = number(&node.data["rows"][i]["value"], 0.0);
                    layout.legend(
                        p,
                        at,
                        i,
                        format!("{}  {}", row.name, value),
                        legend_size,
                        legend_tint(i),
                    );
                }
            }
            if kind == "pie" {
                centered(
                    p,
                    Rect::from_center_size(center, vec2(radius, radius)),
                    20.0,
                    format!("{sum:.0}"),
                    TEXT,
                );
            }
            return;
        }
        if matches!(kind, "radar" | "radarFilled") {
            let center = r.center();
            let radius = size * 0.36;
            let n = rows.len().max(3);
            let at = |i: usize, scale: f32| {
                polar(
                    center,
                    radius * scale,
                    i as f32 / n as f32 * tau - tau / 4.0,
                )
            };
            let levels = option_number(node, "radarLevels", 4.0, 1.0, 12.0) as usize;
            for level in 1..=levels {
                p.add(Shape::closed_line(
                    (0..n)
                        .map(|i| at(i, level as f32 / levels as f32))
                        .collect(),
                    Stroke::new(1.0, color("#6cbcff30")),
                ));
            }
            let points: Vec<Pos2> = rows
                .iter()
                .enumerate()
                .map(|(i, row)| at(i, row.values[0] / max.max(100.0)))
                .collect();
            for (i, row) in rows.iter().enumerate() {
                line(p, center, at(i, 1.0), 1.0, color("#6cbcff20"));
                p.text(
                    at(i, 1.2),
                    Align2::CENTER_CENTER,
                    &row.name,
                    FontId::proportional(11.0),
                    MUTED,
                );
                if kind == "radarFilled" {
                    let next = (i + 1) % points.len();
                    p.add(Shape::convex_polygon(
                        vec![center, points[i], points[next]],
                        tint.gamma_multiply(0.28),
                        Stroke::NONE,
                    ));
                    layout.band(
                        [points[i], points[next], center, center],
                        ChartDatum::Series(i, 0),
                        ChartDatum::Series(next, 0),
                        None,
                    );
                }
            }
            if layout.enabled() {
                let mut path = points.clone();
                path.push(points[0]);
                layout.line(
                    &path,
                    1,
                    4.0,
                    |i| ChartDatum::Series(i % rows.len(), 0),
                    None,
                );
            }
            p.add(Shape::closed_line(points, Stroke::new(2.0, tint)));
            return;
        }
        if matches!(kind, "gauge" | "waterball") {
            let value = rows[0].values[0];
            let min = option_number(node, "gaugeMin", 0.0, -1_000_000.0, 1_000_000.0);
            let max = option_number(node, "gaugeMax", 100.0, -1_000_000.0, 1_000_000.0);
            let percent = if kind == "gauge" {
                ((value - min) / (max - min).max(f32::EPSILON) * 100.0).clamp(0.0, 100.0)
            } else {
                value.clamp(0.0, 100.0)
            };
            let radius = size * 0.4;
            let center = r.center();
            if kind == "gauge" {
                let from = option_number(node, "startAngle", 135.0, -360.0, 360.0).to_radians();
                let to = option_number(node, "endAngle", 405.0, -360.0, 720.0).to_radians();
                let to = from + (to - from).clamp(-tau, tau);
                let inner =
                    radius * (1.0 - option_number(node, "gaugeWidth", 22.0, 2.0, 90.0) / 100.0);
                ring(p, center, inner, radius, from, to, color("#284a6d"));
                layout.series(ChartShape::arc(center, inner, radius, from, to), 0, 0);
                ring(
                    p,
                    center,
                    inner,
                    radius,
                    from,
                    from + (to - from) * percent / 100.0,
                    tint,
                );
            } else {
                p.circle_filled(center, radius, color("#14283d"));
                layout.series(ChartShape::Circle(center, radius), 0, 0);
                let water_y = center.y + radius - 2.0 * radius * percent / 100.0;
                let points: Vec<Pos2> = (0..96)
                    .map(|i| polar(center, radius, i as f32 / 96.0 * tau))
                    .collect();
                let mut filled: Vec<Pos2> = points.into_iter().filter(|p| p.y >= water_y).collect();
                if filled.len() >= 3 {
                    p.add(Shape::convex_polygon(
                        std::mem::take(&mut filled),
                        tint.gamma_multiply(0.6),
                        Stroke::NONE,
                    ));
                }
                p.circle_stroke(
                    center,
                    radius,
                    Stroke::new(option_number(node, "waterBorder", 2.0, 0.0, 20.0), tint),
                );
            }
            let value_label = p.text(
                center,
                Align2::CENTER_CENTER,
                format!("{percent:.0}%"),
                FontId::proportional(28.0),
                TEXT,
            );
            if kind == "gauge" {
                layout.series(ChartShape::Rect(value_label), 0, 0);
            }
            label(
                p,
                pos2(center.x - 24.0, center.y + 36.0),
                12.0,
                &rows[0].name,
                MUTED,
            );
            return;
        }
        if kind == "funnel" {
            let h = r.height() / rows.len() as f32;
            let gap = option_number(node, "funnelGap", 3.0, 0.0, 30.0).min(h / 2.0);
            let limit = rows
                .iter()
                .flat_map(|row| {
                    row.values
                        .iter()
                        .take(if variant == "compareFunnel" { 2 } else { 1 })
                })
                .copied()
                .fold(1.0_f32, f32::max);
            for (i, row) in rows.iter().enumerate() {
                let top = r.width() * 0.85 * row.values[0] / limit;
                let bottom = rows
                    .get(i + 1)
                    .map_or(top * 0.7, |next| r.width() * 0.85 * next.values[0] / limit);
                let y = r.min.y + i as f32 * h;
                if variant == "compareFunnel" {
                    let top2 = r.width() * 0.425 * row.values[1] / limit;
                    let bottom2 = rows.get(i + 1).map_or(top2 * 0.7, |next| {
                        r.width() * 0.425 * next.values[1] / limit
                    });
                    let center = r.center().x;
                    let left = [
                        pos2(center - top / 2.0, y),
                        pos2(center - 2.0, y),
                        pos2(center - 2.0, y + h - gap),
                        pos2(center - bottom / 2.0, y + h - gap),
                    ];
                    let right = [
                        pos2(center + 2.0, y),
                        pos2(center + top2, y),
                        pos2(center + bottom2, y + h - gap),
                        pos2(center + 2.0, y + h - gap),
                    ];
                    for (series, polygon) in [left, right].into_iter().enumerate() {
                        p.add(Shape::convex_polygon(
                            polygon.to_vec(),
                            series_color(node, series),
                            Stroke::NONE,
                        ));
                        layout.series(ChartShape::Polygon(Box::new(polygon)), i, series);
                    }
                } else {
                    let polygon = [
                        pos2(r.center().x - top / 2.0, y),
                        pos2(r.center().x + top / 2.0, y),
                        pos2(r.center().x + bottom / 2.0, y + h - gap),
                        pos2(r.center().x - bottom / 2.0, y + h - gap),
                    ];
                    p.add(Shape::convex_polygon(
                        polygon.to_vec(),
                        series_color(node, i),
                        Stroke::NONE,
                    ));
                    layout.series(ChartShape::Polygon(Box::new(polygon)), i, 0);
                }
                if option_bool(node, "showLabels", true) {
                    centered(
                        p,
                        Rect::from_min_size(pos2(r.min.x, y), vec2(r.width(), h)),
                        label_size,
                        format!("{}  {}", row.name, value_text(node, row.values[0])),
                        label_color,
                    );
                }
            }
            return;
        }
        if kind == "heatmap" {
            if variant == "treemap" {
                let total = rows.iter().map(|row| row.values[0]).sum::<f32>().max(1.0);
                let mut x = r.min.x;
                for (i, row) in rows.iter().enumerate() {
                    let width = r.width() * row.values[0] / total;
                    if width > 4.0 && r.height() > 4.0 {
                        let rect = Rect::from_min_size(pos2(x, r.min.y), vec2(width, r.height()))
                            .shrink(2.0);
                        p.rect_filled(rect, 0.0, series_color(node, i));
                        layout.series(ChartShape::Rect(rect), i, 0);
                        if option_bool(node, "showLabels", true) {
                            centered(
                                p,
                                rect,
                                label_size,
                                format!("{}\n{}", row.name, value_text(node, row.values[0])),
                                label_color,
                            );
                        }
                    }
                    x += width;
                }
                return;
            }
            let columns = option_number(node, "heatColumns", 7.0, 1.0, 53.0) as usize;
            if variant == "waffle" {
                let cell = vec2(r.width() / columns as f32, r.height() / 10.0);
                let gap =
                    option_number(node, "cellGap", 2.0, 0.0, 20.0).min(cell.x.min(cell.y) / 2.0);
                let total = rows.iter().map(|row| row.values[0]).sum::<f32>().max(1.0);
                for i in 0..columns * 10 {
                    let target = (i as f32 + 0.5) / (columns * 10) as f32 * total;
                    let mut sum = 0.0;
                    let category = rows
                        .iter()
                        .position(|row| {
                            sum += row.values[0];
                            target <= sum
                        })
                        .unwrap_or(rows.len() - 1);
                    let rect = Rect::from_min_size(
                        r.min + vec2((i % columns) as f32 * cell.x, (i / columns) as f32 * cell.y),
                        cell,
                    )
                    .shrink(gap);
                    p.rect_filled(rect, 1.0, series_color(node, category));
                    layout.series(ChartShape::Rect(rect), category, 0);
                    if option_bool(node, "showLabels", false)
                        && cell.x > label_size * 1.5
                        && cell.y > label_size
                    {
                        centered(
                            p,
                            rect,
                            label_size,
                            value_text(node, rows[category].values[0]),
                            label_color,
                        );
                    }
                }
                return;
            }
            let cell = vec2(
                r.width() / columns as f32,
                r.height() / rows.len().div_ceil(columns).max(1) as f32,
            );
            let gap = option_number(node, "cellGap", 2.0, 0.0, 20.0).min(cell.x.min(cell.y) / 2.0);
            for (i, row) in rows.iter().enumerate() {
                let (column, row_index) = (i % columns, i / columns);
                let rect = Rect::from_min_size(
                    r.min + vec2(column as f32 * cell.x, row_index as f32 * cell.y),
                    cell,
                )
                .shrink(gap);
                p.rect_filled(
                    rect,
                    2.0,
                    if variant == "colorBlocks" {
                        series_color(node, i)
                    } else {
                        tint.gamma_multiply(0.15 + row.values[0] / max * 0.85)
                    },
                );
                layout.series(ChartShape::Rect(rect), i, 0);
                if option_bool(node, "showLabels", true) {
                    centered(
                        p,
                        rect,
                        label_size,
                        value_text(node, row.values[0]),
                        label_color,
                    );
                }
            }
            return;
        }
        // ── 3D 饼状 / 环形 / 玫瑰 / 玫瑰环：椭圆投影 + 挤出深度 ──
        if matches!(kind, "pie3d" | "donut3d" | "rose3d" | "roseRing3d") {
            let squish = 0.44_f32;
            let inner_scale = if matches!(kind, "donut3d" | "roseRing3d") {
                0.48
            } else {
                0.0
            };
            let sum: f32 = rows.iter().map(|row| row.values[0]).sum::<f32>().max(1.0);
            let value_max = rows.iter().map(|row| row.values[0]).fold(1.0_f32, f32::max);
            let depth = 13.0_f32;
            let radius = (size * 0.30).clamp(28.0, 96.0);
            let center = if legend_visible {
                pos2(r.min.x + 12.0 + radius, r.center().y - 5.0)
            } else {
                r.center() - vec2(0.0, 5.0)
            };
            let span = |i: usize| -> (f32, f32) {
                if matches!(kind, "rose3d" | "roseRing3d") {
                    let step = tau / rows.len() as f32;
                    (
                        -tau / 4.0 + i as f32 * step,
                        -tau / 4.0 + (i + 1) as f32 * step,
                    )
                } else {
                    let mut cursor = -tau / 4.0;
                    for row in rows.iter().take(i) {
                        cursor += row.values[0] / sum * tau;
                    }
                    (cursor, cursor + rows[i].values[0] / sum * tau)
                }
            };
            let outer = |i: usize| -> f32 {
                if matches!(kind, "rose3d" | "roseRing3d") {
                    radius * (0.34 + rows[i].values[0] / value_max * 0.66)
                } else {
                    radius
                }
            };
            // 内孔后侧内壁（透过环孔可见，取 sin<0 的上半弧）→ 外壁（正对观察者的 sin>0 下半弧）→ 顶面
            if inner_scale > 0.0 {
                for i in 0..rows.len() {
                    if is_hidden(i) {
                        continue;
                    }
                    let (start, end) = span(i);
                    let a1 = start.max(std::f32::consts::PI);
                    let a2 = end.min(tau);
                    if a2 > a1 {
                        let mesh = elliptic_wall(
                            p,
                            center,
                            squish,
                            outer(i) * inner_scale,
                            a1,
                            a2,
                            depth,
                            series_color(node, i).gamma_multiply(0.4),
                        );
                        layout.category(ChartShape::Mesh(mesh), i);
                    }
                }
            }
            for i in 0..rows.len() {
                if is_hidden(i) {
                    continue;
                }
                let (start, end) = span(i);
                let a1 = start.max(0.0);
                let a2 = end.min(std::f32::consts::PI);
                if a2 > a1 {
                    let mesh = elliptic_wall(
                        p,
                        center,
                        squish,
                        outer(i),
                        a1,
                        a2,
                        depth,
                        series_color(node, i).gamma_multiply(0.58),
                    );
                    layout.category(ChartShape::Mesh(mesh), i);
                }
            }
            for i in 0..rows.len() {
                if is_hidden(i) {
                    continue;
                }
                let (from, to) = span(i);
                let (inner, outer) = (outer(i) * inner_scale, outer(i));
                elliptic_wedge(
                    p,
                    center,
                    squish,
                    inner,
                    outer,
                    from,
                    to,
                    series_color(node, i),
                );
                layout.category(
                    ChartShape::Arc(ChartArc {
                        center,
                        inner,
                        outer,
                        from,
                        to,
                        y_scale: squish,
                    }),
                    i,
                );
            }
            if kind == "donut3d" {
                centered(
                    p,
                    Rect::from_center_size(center, vec2(radius, radius)),
                    20.0,
                    format!("{sum:.0}"),
                    TEXT,
                );
            }
            for (i, row) in rows.iter().enumerate().take(if !legend_visible {
                0
            } else if node.data["chart"]["legendType"] == "scroll" {
                rows.len()
            } else {
                6
            }) {
                let at = pos2(
                    center.x + radius + 18.0,
                    r.center().y - 60.0 + i as f32 * 23.0,
                );
                let value = number(&node.data["rows"][i]["value"], 0.0);
                layout.legend(
                    p,
                    at,
                    i,
                    format!("{}  {}", row.name, value),
                    legend_size,
                    legend_tint(i),
                );
            }
            return;
        }
        // ── 3D 柱状：等轴测三面体（顶面亮 / 侧面暗 / 正面原色），自右向左绘制保证遮挡 ──
        if matches!(kind, "bar3dGrouped" | "bar3dStacked") {
            let plot = plot_rect(node, r, [34.0, 18.0, 16.0, 27.0]);
            if !plot.is_positive() {
                return;
            }
            let raw = self::rows(node);
            let inferred = if raw.iter().any(|row| row.values[2] > 0.0) {
                3
            } else if raw.iter().any(|row| row.values[1] > 0.0) {
                2
            } else {
                1
            };
            let series = option_number(node, "seriesCount", inferred as f32, 1.0, 3.0) as usize;
            let limit: f32 = if kind == "bar3dStacked" {
                rows.iter()
                    .map(|row| row.values.iter().take(series).sum())
                    .fold(1.0_f32, f32::max)
            } else {
                rows.iter()
                    .flat_map(|row| row.values.iter().take(series))
                    .copied()
                    .fold(1.0_f32, f32::max)
            };
            let axis_color = option_color(node, "axisColor", "#90acc1");
            let axis_size = option_number(node, "axisFontSize", 10.0, 6.0, 36.0);
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
                        pos2(plot.min.x - 7.0, y),
                        Align2::RIGHT_CENTER,
                        format!("{:.0}", limit * (1.0 - i as f32 / 3.0)),
                        FontId::proportional(axis_size),
                        axis_color,
                    );
                }
            }
            for s in 0..if legend_visible { series } else { 0 } {
                let x = plot.max.x - (series - s) as f32 * 54.0;
                let y = if node.data["chart"]["legendPosition"].as_str() == Some("bottom") {
                    r.max.y - legend_size
                } else {
                    r.min.y
                };
                layout.legend(
                    p,
                    pos2(x, y),
                    s,
                    series_label(node, s),
                    legend_size,
                    legend_tint(s),
                );
            }
            let dx = 9.0_f32;
            let dy = 6.0_f32;
            let step = plot.width() / rows.len() as f32;
            let mut face =
                |x: f32, width: f32, top: f32, bottom: f32, index: usize, series: usize| {
                    if bottom - top < 0.5 {
                        return;
                    }
                    let c = series_color(node, series);
                    let top_face = [
                        pos2(x, top),
                        pos2(x + width, top),
                        pos2(x + width + dx, top - dy),
                        pos2(x + dx, top - dy),
                    ];
                    let side_face = [
                        pos2(x + width, top),
                        pos2(x + width + dx, top - dy),
                        pos2(x + width + dx, bottom - dy),
                        pos2(x + width, bottom),
                    ];
                    for (polygon, tint) in [
                        (top_face, mix_to(c, 255, 0.32)),
                        (side_face, mix_to(c, 0, 0.30)),
                    ] {
                        p.add(Shape::convex_polygon(polygon.to_vec(), tint, Stroke::NONE));
                        layout.series(ChartShape::Polygon(Box::new(polygon)), index, series);
                    }
                    let rect = Rect::from_min_max(pos2(x, top), pos2(x + width, bottom));
                    p.rect_filled(rect, option_number(node, "barRadius", 1.0, 0.0, 30.0), c);
                    layout.series(ChartShape::Rect(rect), index, series);
                };
            if kind == "bar3dGrouped" {
                let auto = step * 0.58 / series as f32;
                let configured = option_number(node, "barWidth", 0.0, 0.0, 200.0);
                let bar_w = if configured > 0.0 {
                    configured.min(step / series as f32)
                } else {
                    auto
                };
                for i in (0..rows.len()).rev() {
                    for s in (0..series).rev() {
                        let value = rows[i].values[s];
                        let x = plot.min.x + step * i as f32 + step * 0.21 + bar_w * s as f32;
                        let top = plot.max.y - value / limit * plot.height();
                        face(x, (bar_w - 2.0).max(3.0), top, plot.max.y, i, s);
                    }
                }
            } else {
                for i in (0..rows.len()).rev() {
                    let mut lower = plot.max.y;
                    for s in 0..series {
                        let top = lower - rows[i].values[s] / limit * plot.height();
                        face(
                            plot.min.x + step * i as f32 + step * 0.22,
                            {
                                let width = option_number(node, "barWidth", 0.0, 0.0, 200.0);
                                if width > 0.0 {
                                    width.min(step)
                                } else {
                                    step * 0.56
                                }
                            },
                            top,
                            lower,
                            i,
                            s,
                        );
                        lower = top;
                    }
                }
            }
            for (i, row) in rows
                .iter()
                .enumerate()
                .filter(|_| option_bool(node, "showXAxis", true))
            {
                p.text(
                    pos2(plot.min.x + step * (i as f32 + 0.5), plot.max.y + 13.0),
                    Align2::CENTER_CENTER,
                    &row.name,
                    FontId::proportional(axis_size),
                    axis_color,
                );
            }
            if option_bool(node, "showLabels", false) {
                for (i, row) in rows.iter().enumerate() {
                    let value = if kind == "bar3dStacked" {
                        row.values.iter().take(series).sum()
                    } else {
                        row.values[0]
                    };
                    p.text(
                        pos2(
                            plot.min.x + step * (i as f32 + 0.5),
                            plot.max.y - value / limit * plot.height() - 8.0,
                        ),
                        Align2::CENTER_BOTTOM,
                        value_text(node, value),
                        FontId::proportional(label_size),
                        label_color,
                    );
                }
            }
            return;
        }
        let reserve_right = (variant != "rangeArea"
            && matches!(
                kind,
                "line" | "lineSmooth" | "lineMulti" | "area" | "areaGradient"
            )
            && option_number(node, "rightAxisStart", 0.0, 0.0, 3.0) > 0.0
            && option_bool(node, "showRightAxis", true))
            || (kind == "dualAxis" && option_bool(node, "showRightAxis", false));
        let plot = plot_rect(
            node,
            r,
            [
                34.0,
                18.0,
                if reserve_right {
                    50.0
                } else if matches!(kind, "barHorizontal" | "barHorizontalStacked")
                    && option_bool(node, "showRanking", false)
                {
                    option_number(node, "rankingBackgroundWidth", 50.0, 0.0, 1000.0) / 2.0
                } else {
                    10.0
                },
                27.0,
            ],
        );
        if !plot.is_positive() {
            return;
        }
        let chart_labels = labels::Labels::new(p, node, label_size, label_color);
        let line_labels = labels::Labels::line(p, node, label_size, label_color);
        let inferred_series = if matches!(
            kind,
            "barGrouped"
                | "barStacked"
                | "barPercent"
                | "barHorizontalStacked"
                | "lineMulti"
                | "areaStacked"
                | "dualAxis"
        ) {
            if self::rows(node).iter().any(|r| r.values[2] != 0.0) {
                3
            } else {
                2
            }
        } else {
            1
        };
        let series = if matches!(variant, "rangeBar" | "horizontalRange" | "rangeArea") {
            1
        } else if node.data["chart"]["seriesCount"].is_number() {
            option_number(node, "seriesCount", inferred_series as f32, 1.0, 3.0) as usize
        } else {
            inferred_series
        };
        let right_axis_index = option_number(node, "rightAxisStart", 0.0, 0.0, 3.0) as usize;
        let right_start = if variant != "rangeArea"
            && matches!(
                kind,
                "line" | "lineSmooth" | "lineMulti" | "area" | "areaGradient"
            )
            && (1..=series).contains(&right_axis_index)
        {
            Some(right_axis_index - 1)
        } else {
            None
        };
        let dual_reverse = kind == "dualAxis" && series >= 3 && variant == "dualReverse";
        let tooltip_right = if kind == "dualAxis" && series >= 2 {
            Some(if dual_reverse { 0 } else { series - 1 })
        } else {
            right_start
        };
        layout.set_plot(plot, tooltip_right, dual_reverse);
        if option_bool(node, "tooltipAxisTrigger", true)
            && variant != "rangeArea"
            && matches!(
                kind,
                "line"
                    | "lineSmooth"
                    | "lineMulti"
                    | "area"
                    | "areaGradient"
                    | "areaStacked"
                    | "dualAxis"
            )
        {
            layout.set_axis_categories(
                (0..rows.len())
                    .map(|index| {
                        plot.min.x + plot.width() * axis::category_fraction(node, index, rows.len())
                    })
                    .collect(),
                series,
            );
        }
        let stacked = matches!(
            kind,
            "barStacked" | "barPercent" | "barHorizontalStacked" | "areaStacked"
        );
        let limit = nonzero_limit(if kind == "barPercent" || variant == "horizontalPercent" {
            100.0
        } else if matches!(variant, "rangeBar" | "horizontalRange" | "rangeArea") {
            rows.iter()
                .map(|row| row.values[0].max(row.values[1]))
                .fold(0.0_f32, f32::max)
        } else if kind == "dualAxis" && series >= 3 {
            let bars = if variant == "dualReverse" {
                [1, 2]
            } else {
                [0, 1]
            };
            rows.iter()
                .map(|row| {
                    if variant == "dualStacked" {
                        row.values[bars[0]] + row.values[bars[1]]
                    } else {
                        row.values[bars[0]].max(row.values[bars[1]])
                    }
                })
                .fold(0.0_f32, f32::max)
        } else if stacked {
            rows.iter()
                .map(|r| r.values.iter().take(series).sum())
                .fold(0.0_f32, f32::max)
        } else {
            rows.iter()
                .flat_map(|r| r.values.iter().take(right_start.unwrap_or(series)))
                .copied()
                .fold(0.0_f32, f32::max)
        });
        let right_limit = right_start
            .map(|start| {
                nonzero_limit(
                    rows.iter()
                        .flat_map(|row| row.values.iter().take(series).skip(start))
                        .copied()
                        .fold(0.0_f32, f32::max),
                )
            })
            .or_else(|| {
                if kind != "dualAxis" || series < 2 {
                    return None;
                }
                let line_series = if series >= 3 && variant == "dualReverse" {
                    0
                } else {
                    series - 1
                };
                Some(nonzero_limit(
                    rows.iter()
                        .map(|row| row.values[line_series])
                        .fold(0.0_f32, f32::max),
                ))
            });
        let horizontal = matches!(kind, "barHorizontal" | "barHorizontalStacked");
        let paint_rank = || {
            if !matches!(variant, "rangeArea" | "rangeBar" | "horizontalRange") {
                rank::paint(
                    p,
                    node,
                    plot,
                    &rows,
                    series,
                    horizontal,
                    self.images.get(&node.id),
                );
            }
        };
        let signed_scale = supports_signed_scale(node);
        let left_scale = if signed_scale {
            axis::Scale::automatic(
                rows.iter()
                    .flat_map(|row| row.values.iter().take(right_start.unwrap_or(series)))
                    .copied(),
            )
            .configured(
                node,
                if horizontal {
                    "axisRangeModeX"
                } else {
                    "axisRangeModeY"
                },
                if horizontal { "axisMinX" } else { "axisMinY" },
                if horizontal { "axisMaxX" } else { "axisMaxY" },
            )
        } else {
            axis::Scale::from_limit(limit)
        };
        let right_scale = right_limit.map(|limit| {
            if let Some(start) = right_start {
                axis::Scale::automatic(
                    rows.iter()
                        .flat_map(|row| row.values.iter().take(series).skip(start))
                        .copied(),
                )
                .configured(
                    node,
                    "rightAxisRangeMode",
                    "rightAxisMin",
                    "rightAxisMax",
                )
            } else {
                axis::Scale::from_limit(limit)
            }
        });
        let bar_gradients: [Option<KitGradient>; 3] = std::array::from_fn(|index| {
            KitGradient::read(&node.data["chart"]["kitBarGradients"][index])
        });
        let area_gradients: [Option<KitGradient>; 3] = std::array::from_fn(|index| {
            KitGradient::read(&node.data["chart"]["kitAreaGradients"][index])
        });
        let bar_radius = option_number(node, "barRadius", 1.0, 0.0, 30.0);
        let axis_color = option_color(node, "axisColor", "#90acc1");
        let axis_size = option_number(node, "axisFontSize", 10.0, 6.0, 36.0);
        let x_axis_size = option_number(node, "xAxisFontSize", axis_size, 6.0, 36.0);
        let y_axis_size = option_number(node, "yAxisFontSize", axis_size, 6.0, 36.0);
        let x_axis_color = node.data["chart"]["xAxisColor"]
            .as_str()
            .map_or(axis_color, color);
        let y_axis_color = node.data["chart"]["yAxisColor"]
            .as_str()
            .map_or(axis_color, color);
        let grid = option_bool(node, "showGrid", true);
        // The category axis has one grid line per category; the numeric axis
        // uses the same tick positions as its labels below.
        if option_bool(
            node,
            if horizontal { "showGridY" } else { "showGridX" },
            false,
        ) {
            for i in 0..rows.len() {
                let fraction = axis::category_fraction(node, i, rows.len());
                if horizontal {
                    let y = plot.min.y + plot.height() * fraction;
                    axis::grid(p, node, pos2(plot.min.x, y), pos2(plot.max.x, y), false);
                } else {
                    let x = plot.min.x + plot.width() * fraction;
                    axis::grid(p, node, pos2(x, plot.min.y), pos2(x, plot.max.y), true);
                }
            }
        }
        let numeric_ticks = if horizontal {
            axis::ticks(left_scale, node, "axisIntervalModeX", "axisIntervalX")
        } else {
            axis::ticks(left_scale, node, "axisIntervalModeY", "axisIntervalY")
        };
        for &fraction in &numeric_ticks {
            if horizontal {
                let x = plot.min.x + plot.width() * fraction;
                if option_bool(node, "showGridX", grid) {
                    axis::grid(p, node, pos2(x, plot.min.y), pos2(x, plot.max.y), true);
                }
                if option_bool(node, "showXAxis", true) && option_bool(node, "showAxisLabelX", true)
                {
                    axis::label(
                        p,
                        node,
                        "axisLabelRotateX",
                        pos2(
                            x,
                            plot.max.y + number(&node.data["chart"]["xLabelOffset"], 5.0),
                        ),
                        Align2::CENTER_TOP,
                        axis::value(
                            node,
                            true,
                            left_scale.at(fraction),
                            variant == "horizontalPercent",
                        ),
                        (FontId::proportional(x_axis_size), x_axis_color),
                    );
                }
            } else {
                let y = plot.max.y - plot.height() * fraction;
                if option_bool(node, "showGridY", grid) {
                    axis::grid(p, node, pos2(plot.min.x, y), pos2(plot.max.x, y), false);
                }
                if option_bool(node, "showYAxis", true) && option_bool(node, "showAxisLabelY", true)
                {
                    axis::label(
                        p,
                        node,
                        "axisLabelRotateY",
                        pos2(
                            plot.min.x - number(&node.data["chart"]["yLabelOffset"], 7.0),
                            y,
                        ),
                        Align2::RIGHT_CENTER,
                        axis::value(node, false, left_scale.at(fraction), kind == "barPercent"),
                        (FontId::proportional(y_axis_size), y_axis_color),
                    );
                }
            }
        }
        axis::paint(p, node, plot, horizontal, rows.len(), &numeric_ticks);
        if let Some(scale) = right_scale
            && (right_start.is_some() || option_bool(node, "showRightAxis", false))
        {
            axis::paint_right(p, node, plot, scale);
        }
        if let Some(lines) = node.data["chart"]["referenceLines"].as_array() {
            for reference in lines.iter().take(32) {
                let value = number(&reference["value"], 0.0);
                if !value.is_finite() || !left_scale.contains(value) {
                    continue;
                }
                let fraction = left_scale.fraction(value);
                let (start, end) = if horizontal {
                    let x = plot.min.x + plot.width() * fraction;
                    (pos2(x, plot.min.y), pos2(x, plot.max.y))
                } else {
                    let y = plot.max.y - plot.height() * fraction;
                    (pos2(plot.min.x, y), pos2(plot.max.x, y))
                };
                let tint = color(reference["color"].as_str().unwrap_or("#ffb84d"));
                let width = number(&reference["width"], 1.0).clamp(1.0, 10.0);
                if reference["style"].as_str() == Some("dashed") {
                    let distance = start.distance(end);
                    let direction = (end - start).normalized();
                    let dash = number(&reference["dash"], 6.0).clamp(1.0, 100.0);
                    let gap = dash * (4.0 / 6.0);
                    let mut offset = 0.0;
                    while offset < distance {
                        line(
                            p,
                            start + direction * offset,
                            start + direction * (offset + dash).min(distance),
                            width,
                            tint,
                        );
                        offset += dash + gap;
                    }
                } else {
                    line(p, start, end, width, tint);
                }
                if let Some(name) = reference["name"].as_str().filter(|name| !name.is_empty()) {
                    let text_color = reference["textColor"].as_str().map(color).unwrap_or(tint);
                    let text_offset = &reference["textOffset"];
                    p.text(
                        start + vec2(number(&text_offset[0], 0.0), number(&text_offset[1], 0.0)),
                        Align2::LEFT_BOTTOM,
                        name,
                        FontId::proportional(10.0),
                        text_color,
                    );
                }
            }
        }
        for s in 0..if legend_visible { series } else { 0 } {
            let x = plot.max.x - (series - s) as f32 * 54.0;
            let y = if node.data["chart"]["legendPosition"].as_str() == Some("bottom") {
                r.max.y - legend_size
            } else {
                r.min.y
            };
            let title = if matches!(variant, "rangeBar" | "horizontalRange" | "rangeArea") {
                "区间".to_owned()
            } else {
                series_label(node, s)
            };
            layout.legend(p, pos2(x, y), s, title, legend_size, legend_tint(s));
        }
        if variant == "rangeArea" {
            let lower: Vec<Pos2> = rows
                .iter()
                .enumerate()
                .map(|(i, row)| {
                    pos2(
                        plot.min.x + plot.width() * axis::category_fraction(node, i, rows.len()),
                        plot.max.y - row.values[0].min(row.values[1]) / limit * plot.height(),
                    )
                })
                .collect();
            let upper: Vec<Pos2> = rows
                .iter()
                .enumerate()
                .map(|(i, row)| {
                    pos2(
                        plot.min.x + plot.width() * axis::category_fraction(node, i, rows.len()),
                        plot.max.y - row.values[0].max(row.values[1]) / limit * plot.height(),
                    )
                })
                .collect();
            let opacity = option_number(node, "fillOpacity", 35.0, 0.0, 100.0) / 100.0;
            for i in (0..rows.len().saturating_sub(1)).filter(|_| !is_hidden(0) && opacity > 0.0) {
                let polygon = [upper[i], upper[i + 1], lower[i + 1], lower[i]];
                p.add(Shape::convex_polygon(
                    polygon.to_vec(),
                    tint.gamma_multiply(opacity),
                    Stroke::NONE,
                ));
                layout.band(
                    polygon,
                    ChartDatum::Range(i),
                    ChartDatum::Range(i + 1),
                    Some(0),
                );
            }
            let stroke = Stroke::new(option_number(node, "lineWidth", 2.5, 0.5, 20.0), tint);
            for (is_upper, points) in [(false, &lower), (true, &upper)] {
                if is_hidden(0) {
                    break;
                }
                paint_data_line(
                    p,
                    node,
                    layout,
                    points,
                    option_bool(node, "smooth", false),
                    stroke,
                    ChartDatum::Range,
                    Some(0),
                );
                for (i, point) in points.iter().enumerate() {
                    if option_bool(node, "showPoints", true) {
                        let radius = option_number(node, "pointRadius", 3.0, 1.0, 20.0);
                        let shape = paint_data_point(
                            p,
                            node,
                            *point,
                            radius,
                            tint,
                            self.images
                                .get(&format!("{}0:{}", super::POINT_IMAGE_PREFIX, node.id)),
                        );
                        layout.mark(shape, ChartDatum::Range(i), Some(0));
                    }
                    chart_labels.point(
                        *point,
                        plot,
                        5.0,
                        &rows[i].name,
                        if is_upper {
                            rows[i].values[0].max(rows[i].values[1])
                        } else {
                            rows[i].values[0].min(rows[i].values[1])
                        },
                        tint,
                    );
                }
            }
            for (i, row) in rows.iter().enumerate().filter(|_| {
                option_bool(node, "showXAxis", true) && option_bool(node, "showAxisLabelX", true)
            }) {
                axis::label(
                    p,
                    node,
                    "axisLabelRotateX",
                    pos2(
                        plot.min.x + plot.width() * axis::category_fraction(node, i, rows.len()),
                        plot.max.y + number(&node.data["chart"]["xLabelOffset"], 13.0),
                    ),
                    Align2::CENTER_CENTER,
                    &row.name,
                    (FontId::proportional(x_axis_size), x_axis_color),
                );
            }
            return;
        }
        if kind == "dualAxis" && series >= 3 {
            let bars = if variant == "dualReverse" {
                [1, 2]
            } else {
                [0, 1]
            };
            let line_series = if variant == "dualReverse" { 0 } else { 2 };
            let line_max = nonzero_limit(
                rows.iter()
                    .map(|row| row.values[line_series])
                    .fold(0.0_f32, f32::max),
            );
            let step = plot.width() / rows.len() as f32;
            let configured = option_number(node, "barWidth", 0.0, 0.0, 200.0);
            let groups = if variant == "dualStacked" { 1 } else { 2 };
            let width = if configured > 0.0 {
                configured.min(step / groups as f32)
            } else {
                step * 0.62 / groups as f32
            };
            for (i, row) in rows.iter().enumerate() {
                let mut base = plot.max.y;
                for (group, index) in bars.into_iter().enumerate() {
                    if is_hidden(index) {
                        continue;
                    }
                    let height = row.values[index] / limit * plot.height();
                    let x = plot.min.x
                        + step * i as f32
                        + (step - width * groups as f32) / 2.0
                        + if groups > 1 {
                            group as f32 * width
                        } else {
                            0.0
                        };
                    let bottom = if groups == 1 { base } else { plot.max.y };
                    let rect =
                        Rect::from_min_max(pos2(x, bottom - height), pos2(x + width, bottom));
                    let condition = conditional_color(node, i, index);
                    if let Some(tint) = condition {
                        p.rect_filled(rect, bar_radius, tint);
                    } else if let Some(gradient) = &bar_gradients[index] {
                        gradient.rect(p, rect, bar_radius);
                    } else {
                        p.rect_filled(rect, bar_radius, series_color(node, index));
                    }
                    layout.series(ChartShape::Rect(rect), i, index);
                    if groups == 1 {
                        base -= height;
                    }
                    chart_labels.bar(
                        rect,
                        plot,
                        labels::Direction::Vertical,
                        &row.name,
                        row.values[index],
                        condition.unwrap_or_else(|| series_color(node, index)),
                    );
                }
                if option_bool(node, "showXAxis", true) && option_bool(node, "showAxisLabelX", true)
                {
                    axis::label(
                        p,
                        node,
                        "axisLabelRotateX",
                        pos2(
                            plot.min.x + step * (i as f32 + 0.5),
                            plot.max.y + number(&node.data["chart"]["xLabelOffset"], 13.0),
                        ),
                        Align2::CENTER_CENTER,
                        &row.name,
                        (FontId::proportional(x_axis_size), x_axis_color),
                    );
                }
            }
            if is_hidden(line_series) {
                paint_rank();
                return;
            }
            let points: Vec<Pos2> = rows
                .iter()
                .enumerate()
                .map(|(i, row)| {
                    pos2(
                        plot.min.x + step * (i as f32 + 0.5),
                        plot.max.y - row.values[line_series] / line_max * plot.height(),
                    )
                })
                .collect();
            let styled = series_style_node(node, line_series);
            let style = styled.as_ref();
            let stroke = Stroke::new(
                option_number(style, "lineWidth", 2.5, 0.0, 20.0),
                series_color(node, line_series),
            );
            paint_data_line(
                p,
                style,
                layout,
                &points,
                option_bool(style, "smooth", false),
                stroke,
                |i| ChartDatum::Series(i, line_series),
                Some(line_series),
            );
            flow::paint(
                p,
                node,
                &points,
                option_bool(style, "smooth", false),
                line_series,
                clock,
            );
            for (i, point) in points.into_iter().enumerate() {
                let radius = option_number(style, "pointRadius", 3.0, 0.0, 50.0);
                if option_bool(style, "showPoints", true) && radius > 0.0 {
                    let shape = paint_data_point(
                        p,
                        style,
                        point,
                        radius,
                        series_color(node, line_series),
                        self.images.get(&format!(
                            "{}{}:{}",
                            super::POINT_IMAGE_PREFIX,
                            line_series,
                            node.id
                        )),
                    );
                    layout.series(shape, i, line_series);
                }
                line_labels.point(
                    point,
                    plot,
                    5.0,
                    &rows[i].name,
                    rows[i].values[line_series],
                    series_color(node, line_series),
                );
            }
            paint_rank();
            return;
        }
        if horizontal {
            let step = plot.height() / rows.len() as f32;
            let clipped_painter = p.with_clip_rect(p.clip_rect().intersect(plot));
            let chart_painter = if signed_scale && left_scale.custom {
                layout.clip_marks(Some(plot));
                &clipped_painter
            } else {
                p
            };
            for (i, row) in rows.iter().enumerate() {
                let y = plot.min.y + step * i as f32;
                if option_bool(node, "showYAxis", true) && option_bool(node, "showAxisLabelY", true)
                {
                    axis::label(
                        p,
                        node,
                        "axisLabelRotateY",
                        pos2(
                            plot.min.x - number(&node.data["chart"]["yLabelOffset"], 5.0),
                            y + step / 2.0,
                        ),
                        Align2::RIGHT_CENTER,
                        &row.name,
                        (FontId::proportional(y_axis_size), y_axis_color),
                    );
                }
                let mut x = plot.min.x;
                let grouped = variant == "horizontalGrouped" || (signed_scale && series > 1);
                let total = nonzero_limit(row.values.iter().take(series).sum::<f32>());
                for s in 0..series {
                    if is_hidden(s) {
                        continue;
                    }
                    let value = if variant == "horizontalPercent" {
                        row.values[s] / total * 100.0
                    } else if variant == "horizontalRange" {
                        (row.values[1] - row.values[0]).abs()
                    } else {
                        row.values[s]
                    };
                    let width = value / limit * plot.width();
                    let configured = option_number(node, "barWidth", 0.0, 0.0, 200.0);
                    let groups = if grouped { series } else { 1 };
                    let height = if configured > 0.0 {
                        configured.min(step / groups as f32)
                    } else {
                        step * 0.6 / groups as f32
                    };
                    let yy = y
                        + (step - height * groups as f32) / 2.0
                        + if grouped { s as f32 * height } else { 0.0 };
                    let left = if variant == "horizontalRange" {
                        plot.min.x + row.values[0].min(row.values[1]) / limit * plot.width()
                    } else if grouped {
                        plot.min.x
                    } else {
                        x
                    };
                    let rect = if signed_scale {
                        let zero = (plot.left() + left_scale.fraction(0.0) * plot.width())
                            .clamp(plot.left(), plot.right());
                        let end = plot.left() + left_scale.fraction(value) * plot.width();
                        Rect::from_min_max(
                            pos2(zero.min(end), yy),
                            pos2(zero.max(end), yy + height),
                        )
                    } else {
                        Rect::from_min_size(pos2(left, yy), vec2(width, height))
                    };
                    let condition = conditional_color(node, i, s);
                    let c = condition.unwrap_or_else(|| series_color(node, s));
                    let datum = || {
                        if variant == "horizontalRange" {
                            ChartDatum::Range(i)
                        } else {
                            ChartDatum::Series(i, s)
                        }
                    };
                    layout.mark(ChartShape::Rect(rect), datum(), Some(s));
                    if condition.is_some() {
                        chart_painter.rect_filled(rect, bar_radius, c);
                    } else if let Some(gradient) = &bar_gradients[s] {
                        gradient.rect(chart_painter, rect, bar_radius);
                    } else if option_bool(node, "gradient", false) {
                        chart_painter.add(Shape::gradient_rect(
                            rect,
                            egui::Direction::LeftToRight,
                            if signed_scale && value < 0.0 {
                                [c, c.gamma_multiply(0.2)]
                            } else {
                                [c.gamma_multiply(0.2), c]
                            },
                        ));
                    } else {
                        chart_painter.rect_filled(rect, bar_radius, c);
                    }
                    if variant == "horizontalBubble" {
                        for dot in 0..8 {
                            let xx = rect.min.x + rect.width() * (dot as f32 + 0.5) / 8.0;
                            chart_painter.circle_filled(
                                pos2(xx, rect.center().y),
                                height.min(8.0) * 0.18,
                                Color32::WHITE.gamma_multiply(0.5),
                            );
                        }
                    }
                    if option_bool(node, "endCap", false) {
                        let end_x = if signed_scale && value < 0.0 {
                            rect.left()
                        } else {
                            rect.right()
                        };
                        let ends = [pos2(end_x, rect.min.y - 3.0), pos2(end_x, rect.max.y + 3.0)];
                        line(chart_painter, ends[0], ends[1], 2.0, c);
                        if rect.is_positive() {
                            layout.mark(ChartShape::Line(Box::new(ends), 2.0), datum(), Some(s));
                        }
                    }
                    if !signed_scale || !left_scale.custom || left_scale.contains(value) {
                        chart_labels.bar(
                            rect,
                            plot,
                            if signed_scale && value < 0.0 {
                                labels::Direction::Leftward
                            } else {
                                labels::Direction::Horizontal
                            },
                            &row.name,
                            if variant == "horizontalRange" {
                                row.values[0].max(row.values[1])
                            } else {
                                row.values[s]
                            },
                            c,
                        );
                    }
                    x = if grouped {
                        x.max(rect.max.x)
                    } else {
                        rect.max.x
                    };
                }
            }
            paint_rank();
            return;
        }
        let step = plot.width() / rows.len() as f32;
        let mut lower = vec![0.0_f32; rows.len()];
        let clipped_painter = p.with_clip_rect(p.clip_rect().intersect(plot));
        for s in 0..series {
            if is_hidden(s) {
                continue;
            }
            let c = series_color(node, s);
            let styled = series_style_node(node, s);
            let style = styled.as_ref();
            let own_limit = if right_start.is_some_and(|start| s >= start) {
                right_limit.unwrap_or(limit)
            } else if kind == "dualAxis" && s > 0 {
                nonzero_limit(rows.iter().map(|r| r.values[s]).fold(0.0_f32, f32::max))
            } else {
                limit
            };
            let series_scale = if signed_scale {
                if right_start.is_some_and(|start| s >= start) {
                    right_scale.unwrap_or(left_scale)
                } else {
                    left_scale
                }
            } else {
                axis::Scale::from_limit(own_limit)
            };
            let series_painter = if series_scale.custom {
                &clipped_painter
            } else {
                p
            };
            layout.clip_marks(series_scale.custom.then_some(plot));
            let values: Vec<f32> = rows
                .iter()
                .enumerate()
                .map(|(i, row)| {
                    let value = if variant == "rangeBar" {
                        row.values[0].max(row.values[1])
                    } else if kind == "barPercent" {
                        row.values[s] / nonzero_limit(row.values.iter().take(series).sum::<f32>())
                            * 100.0
                    } else {
                        row.values[s]
                    };
                    value + if stacked { lower[i] } else { 0.0 }
                })
                .collect();
            let points: Vec<Pos2> = values
                .iter()
                .enumerate()
                .map(|(i, value)| {
                    pos2(
                        plot.min.x + plot.width() * axis::category_fraction(node, i, rows.len()),
                        series_scale.y(plot, *value),
                    )
                })
                .collect();
            if kind.starts_with("bar") || (kind == "dualAxis" && s == 0) {
                for (i, point) in points.iter().enumerate() {
                    let condition = conditional_color(node, i, s);
                    let c = condition.unwrap_or(c);
                    let groups = if kind == "barGrouped" { series } else { 1 };
                    let auto = step * 0.62 / groups as f32;
                    let configured = option_number(node, "barWidth", 0.0, 0.0, 200.0);
                    let width = if configured > 0.0 {
                        configured.min(step / groups as f32)
                    } else {
                        auto
                    };
                    let x = plot.min.x
                        + step * i as f32
                        + (step - width * groups as f32) / 2.0
                        + if groups > 1 { width * s as f32 } else { 0.0 };
                    let bottom = if signed_scale {
                        series_scale.y(plot, 0.0).clamp(plot.top(), plot.bottom())
                    } else {
                        plot.max.y
                            - if variant == "rangeBar" {
                                rows[i].values[0].min(rows[i].values[1]) / limit * plot.height()
                            } else if stacked {
                                lower[i] / limit * plot.height()
                            } else {
                                0.0
                            }
                    };
                    let rect = if variant == "rainBars" {
                        Rect::from_min_max(
                            pos2(x, plot.min.y),
                            pos2(x + width, plot.min.y + plot.max.y - point.y),
                        )
                    } else {
                        Rect::from_min_max(
                            pos2(x, point.y.min(bottom)),
                            pos2(x + width, point.y.max(bottom)),
                        )
                    };
                    if variant != "pictorial" {
                        let datum = if variant == "rangeBar" {
                            ChartDatum::Range(i)
                        } else {
                            ChartDatum::Series(i, s)
                        };
                        layout.mark(ChartShape::Rect(rect), datum, Some(s));
                    }
                    if variant == "pictorial" {
                        let count = option_number(node, "symbolCount", 10.0, 2.0, 30.0) as usize;
                        let shown = (rows[i].values[s] / limit * count as f32).ceil() as usize;
                        let unit = plot.height() / count as f32;
                        for symbol in 0..shown.min(count) {
                            let center =
                                pos2(x + width / 2.0, plot.max.y - unit * (symbol as f32 + 0.5));
                            let radius = width.min(unit) * 0.36;
                            p.circle_filled(center, radius, c);
                            layout.series(ChartShape::Circle(center, radius), i, s);
                        }
                    } else if condition.is_some() {
                        series_painter.rect_filled(rect, bar_radius, c);
                    } else if let Some(gradient) = &bar_gradients[s] {
                        gradient.rect(series_painter, rect, bar_radius);
                    } else if kind == "barGradient" || variant == "bubbleBars" {
                        series_painter.add(Shape::gradient_rect(
                            rect,
                            egui::Direction::TopDown,
                            if signed_scale && rows[i].values[s] < 0.0 {
                                [c.gamma_multiply(0.15), c]
                            } else {
                                [c, c.gamma_multiply(0.15)]
                            },
                        ));
                    } else {
                        series_painter.rect_filled(rect, bar_radius, c);
                    }
                    if variant == "bubbleBars" {
                        for dot in 0..8 {
                            let y = rect.min.y + rect.height() * (dot as f32 + 0.5) / 8.0;
                            series_painter.circle_filled(
                                pos2(rect.center().x, y),
                                width.min(8.0) * 0.18,
                                Color32::WHITE.gamma_multiply(0.5),
                            );
                        }
                    } else if variant == "tBar" {
                        let end_y = if signed_scale && rows[i].values[s] < 0.0 {
                            rect.bottom()
                        } else {
                            rect.top()
                        };
                        let ends = [pos2(rect.min.x - 3.0, end_y), pos2(rect.max.x + 3.0, end_y)];
                        line(series_painter, ends[0], ends[1], 2.0, c);
                        if rect.is_positive() {
                            layout.series(ChartShape::Line(Box::new(ends), 2.0), i, s);
                        }
                    }
                    if !signed_scale || !series_scale.custom || series_scale.contains(values[i]) {
                        chart_labels.bar(
                            rect,
                            plot,
                            if variant == "rainBars" || (signed_scale && rows[i].values[s] < 0.0) {
                                labels::Direction::Downward
                            } else {
                                labels::Direction::Vertical
                            },
                            &rows[i].name,
                            if variant == "rangeBar" {
                                rows[i].values[0].max(rows[i].values[1])
                            } else {
                                rows[i].values[s]
                            },
                            c,
                        );
                    }
                }
            } else if kind == "scatter" || kind == "bubble" {
                if variant == "lineBubble" {
                    paint_data_line(
                        p,
                        node,
                        layout,
                        &points,
                        false,
                        Stroke::new(option_number(node, "lineWidth", 2.5, 0.5, 20.0), c),
                        |i| ChartDatum::Series(i, s),
                        Some(s),
                    );
                }
                let bubble_min = option_number(node, "bubbleMin", 5.0, 0.0, 150.0);
                let bubble_max = option_number(node, "bubbleMax", 30.0, bubble_min, 150.0);
                let largest = rows.iter().map(|row| row.values[1]).fold(1.0_f32, f32::max);
                let bubble_stroke = Stroke::new(
                    option_number(node, "bubbleStrokeWidth", 0.0, 0.0, 30.0),
                    option_color(node, "bubbleStrokeColor", "#1890ff"),
                );
                for (i, point) in points.iter().enumerate() {
                    let radius = if kind == "bubble" {
                        if node.data["chart"]["bubbleMin"].is_number() {
                            egui::lerp(bubble_min..=bubble_max, rows[i].values[1] / largest)
                        } else {
                            (4.0 + rows[i].values[1] / 10.0)
                                * option_number(node, "bubbleScale", 1.0, 0.1, 4.0)
                        }
                    } else {
                        option_number(node, "pointRadius", 4.0, 1.0, 30.0)
                    };
                    p.circle_filled(*point, radius, c.gamma_multiply(0.75));
                    if kind == "bubble" && bubble_stroke.width > 0.0 {
                        p.circle_stroke(*point, radius, bubble_stroke);
                    }
                    layout.series(ChartShape::Circle(*point, radius), i, s);
                    if option_bool(node, "showLabels", false) {
                        p.text(
                            *point - vec2(0.0, 6.0),
                            Align2::CENTER_BOTTOM,
                            value_text(node, rows[i].values[0]),
                            FontId::proportional(label_size),
                            label_color,
                        );
                    }
                }
            } else {
                let remove_zero = (kind.starts_with("line") || kind.starts_with("area"))
                    && option_bool(node, "zeroRemoval", false);
                let segments = line_segments(
                    &rows.iter().map(|row| row.values[s]).collect::<Vec<_>>(),
                    remove_zero,
                    node.data["chart"]["zeroRemovalMode"] == "segment",
                );
                if kind.starts_with("area") {
                    let opacity = option_number(
                        node,
                        "fillOpacity",
                        if kind == "areaGradient" { 22.0 } else { 35.0 },
                        0.0,
                        100.0,
                    ) / 100.0;
                    for pair in segments
                        .iter()
                        .flat_map(|span| span.windows(2))
                        .filter(|_| opacity > 0.0)
                    {
                        let i = pair[0];
                        let next = pair[1];
                        let base = |index: usize| {
                            pos2(
                                points[index].x,
                                if stacked {
                                    plot.max.y - lower[index] / limit * plot.height()
                                } else if signed_scale {
                                    series_scale.y(plot, 0.0).clamp(plot.top(), plot.bottom())
                                } else {
                                    plot.max.y
                                },
                            )
                        };
                        let polygon = [points[i], points[next], base(next), base(i)];
                        let paint = |polygon: &[Pos2]| {
                            if let Some(gradient) = &area_gradients[s] {
                                gradient.paint(series_painter, polygon, plot);
                            } else {
                                series_painter.add(Shape::convex_polygon(
                                    polygon.to_vec(),
                                    c.gamma_multiply(opacity),
                                    Stroke::NONE,
                                ));
                            }
                        };
                        let y = polygon[3].y;
                        if signed_scale && (polygon[0].y - y) * (polygon[1].y - y) < 0.0 {
                            let crossing = polygon[0].lerp(
                                polygon[1],
                                (y - polygon[0].y) / (polygon[1].y - polygon[0].y),
                            );
                            let first = [polygon[0], crossing, polygon[3]];
                            let second = [crossing, polygon[1], polygon[2]];
                            paint(&first);
                            paint(&second);
                            layout.mark(
                                ChartShape::Polygon(Box::new(first)),
                                ChartDatum::Series(i, s),
                                Some(s),
                            );
                            layout.mark(
                                ChartShape::Polygon(Box::new(second)),
                                ChartDatum::Series(next, s),
                                Some(s),
                            );
                        } else {
                            paint(&polygon);
                            layout.band(
                                polygon,
                                ChartDatum::Series(i, s),
                                ChartDatum::Series(next, s),
                                Some(s),
                            );
                        }
                    }
                }
                for span in &segments {
                    let visible_points: Vec<_> = span.iter().map(|index| points[*index]).collect();
                    paint_data_line(
                        series_painter,
                        style,
                        layout,
                        &visible_points,
                        option_bool(style, "smooth", kind == "lineSmooth"),
                        Stroke::new(option_number(style, "lineWidth", 2.5, 0.0, 20.0), c),
                        |i| ChartDatum::Series(span[i], s),
                        Some(s),
                    );
                    flow::paint(
                        series_painter,
                        node,
                        &visible_points,
                        option_bool(style, "smooth", kind == "lineSmooth"),
                        s,
                        clock,
                    );
                }
                for (i, point) in points.into_iter().enumerate() {
                    if remove_zero && rows[i].values[s] == 0.0 {
                        continue;
                    }
                    let radius = option_number(style, "pointRadius", 3.0, 0.0, 50.0);
                    if option_bool(style, "showPoints", true) && radius > 0.0 {
                        let shape = paint_data_point(
                            series_painter,
                            style,
                            point,
                            radius,
                            c,
                            self.images.get(&format!(
                                "{}{}:{}",
                                super::POINT_IMAGE_PREFIX,
                                s,
                                node.id
                            )),
                        );
                        layout.series(shape, i, s);
                    }
                    let labels = if (kind == "dualAxis" && s > 0)
                        || right_start.is_some_and(|start| s >= start)
                    {
                        &line_labels
                    } else {
                        &chart_labels
                    };
                    if !series_scale.custom || series_scale.contains(values[i]) {
                        labels.point(point, plot, 5.0, &rows[i].name, rows[i].values[s], c);
                    }
                }
            }
            if stacked {
                lower = values;
            }
        }
        for (i, row) in rows.iter().enumerate().filter(|_| {
            option_bool(node, "showXAxis", true) && option_bool(node, "showAxisLabelX", true)
        }) {
            axis::label(
                p,
                node,
                "axisLabelRotateX",
                pos2(
                    plot.min.x + plot.width() * axis::category_fraction(node, i, rows.len()),
                    plot.max.y + number(&node.data["chart"]["xLabelOffset"], 13.0),
                ),
                Align2::CENTER_CENTER,
                &row.name,
                (FontId::proportional(x_axis_size), x_axis_color),
            );
        }
        paint_rank();
    }
}

const SMOOTH_STEPS: usize = 12;

fn smooth(points: &[Pos2]) -> Vec<Pos2> {
    if points.len() < 3 {
        return points.to_vec();
    }
    let mut output = Vec::new();
    for i in 0..points.len() - 1 {
        let p0 = points[i.saturating_sub(1)].to_vec2();
        let p1 = points[i].to_vec2();
        let p2 = points[i + 1].to_vec2();
        let p3 = points[(i + 2).min(points.len() - 1)].to_vec2();
        for part in 0..SMOOTH_STEPS {
            let t = part as f32 / SMOOTH_STEPS as f32;
            output.push(
                ((p1 * 2.0
                    + (p2 - p0) * t
                    + (p0 * 2.0 - p1 * 5.0 + p2 * 4.0 - p3) * t * t
                    + (-p0 + p1 * 3.0 - p2 * 3.0 + p3) * t * t * t)
                    * 0.5)
                    .to_pos2(),
            );
        }
    }
    output.push(points[points.len() - 1]);
    output
}

#[cfg(test)]
mod tests {
    use super::line_segments;

    #[test]
    fn zero_removal_preserves_indices_and_distinguishes_gaps_from_skips() {
        let values = [2.0, 0.0, 3.0, 0.0, 0.0, 4.0];
        assert_eq!(
            line_segments(&values, false, false),
            vec![vec![0, 1, 2, 3, 4, 5]]
        );
        assert_eq!(line_segments(&values, true, false), vec![vec![0, 2, 5]]);
        assert_eq!(
            line_segments(&values, true, true),
            vec![vec![0], vec![2], vec![5]]
        );
        assert!(line_segments(&[0.0, 0.0], true, true).is_empty());
    }
}
