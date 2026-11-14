use std::{collections::HashSet, ops::Range, sync::Arc};

use egui::{
    Align2, Color32, FontId, Mesh, Painter, Pos2, Rect, Shape, Stroke, StrokeKind, TextFormat,
    TextureHandle, pos2, text::LayoutJob, vec2,
};
use serde_json::{Value, json};

use super::{
    BoardNode, axis, color, legend_position, number, option_bool, option_color, option_number,
    polar, series_color, series_label, string, value_text,
};

pub(in crate::board) enum ChartDatum {
    Series(usize, usize),
    Range(usize),
    Detail {
        index: Option<usize>,
        child: Option<usize>,
        name: String,
        value: Value,
        caption: &'static str,
    },
}

impl ChartDatum {
    pub(super) fn detail(
        index: Option<usize>,
        name: String,
        value: Value,
        caption: &'static str,
    ) -> Self {
        Self::Detail {
            index,
            child: None,
            name,
            value,
            caption,
        }
    }

    fn details(&self, node: &BoardNode) -> (String, Value, String) {
        let raw = &node.data["rows"];
        let name_at = |index: usize| {
            raw[index]
                .get("name")
                .map_or_else(|| (index + 1).to_string(), string)
        };
        match self {
            Self::Series(index, series) => {
                let row = &raw[*index];
                let value = if node.data["chart"]["variant"] == "stream"
                    && row["streamValues"].is_array()
                {
                    &row["streamValues"][*series]
                } else {
                    ["value", "value2", "value3"]
                        .get(*series)
                        .map_or(&Value::Null, |key| &row[*key])
                };
                (name_at(*index), value.clone(), series_label(node, *series))
            }
            Self::Range(index) => {
                let first = number(&raw[*index]["value"], 0.0);
                let second = number(&raw[*index]["value2"], 0.0);
                (
                    name_at(*index),
                    json!([first.min(second), first.max(second)]),
                    "区间".into(),
                )
            }
            Self::Detail {
                name,
                value,
                caption,
                ..
            } => (name.clone(), value.clone(), (*caption).into()),
        }
    }

    pub(in crate::board) fn payload(&self, node: &BoardNode) -> Value {
        let (name, value, caption) = self.details(node);
        let (index, series, child) = match self {
            Self::Series(index, series) => (Some(*index), series + 1, None),
            Self::Range(index) => (Some(*index), 1, None),
            Self::Detail { index, child, .. } => (*index, 1, *child),
        };
        let row = index.map_or(&Value::Null, |index| &node.data["rows"][index]);
        let row = child.map_or(row, |index| &row["children"][index]);
        json!({"__dwChartItem": true, "name": name, "value": value, "series": series,
            "index": index, "row": row, "label": caption, "childIndex": child})
    }
}

pub(super) enum ChartShape {
    Rect(Rect),
    Circle(Pos2, f32),
    Polygon(Box<[Pos2]>),
    Line(Box<[Pos2]>, f32),
    Arc(ChartArc),
    Mesh(Arc<Mesh>),
}

pub(super) struct ChartArc {
    pub center: Pos2,
    pub inner: f32,
    pub outer: f32,
    pub from: f32,
    pub to: f32,
    pub y_scale: f32,
}

impl ChartShape {
    fn pointer_anchor(&self, point: Pos2) -> Pos2 {
        match self {
            Self::Circle(center, _) => *center,
            Self::Rect(rect) => rect.center(),
            _ => point,
        }
    }

    pub(super) fn arc(center: Pos2, inner: f32, outer: f32, from: f32, to: f32) -> Self {
        Self::Arc(ChartArc {
            center,
            inner,
            outer,
            from,
            to,
            y_scale: 1.0,
        })
    }

    fn bounds(&self) -> Rect {
        match self {
            Self::Rect(rect) => *rect,
            Self::Circle(center, radius) => {
                Rect::from_center_size(*center, vec2(*radius, *radius) * 2.0)
            }
            Self::Polygon(points) => Rect::from_points(points),
            Self::Line(points, radius) => Rect::from_points(points).expand(*radius),
            Self::Arc(arc) => {
                Rect::from_center_size(arc.center, vec2(arc.outer, arc.outer * arc.y_scale) * 2.0)
            }
            Self::Mesh(mesh) => mesh.calc_bounds(),
        }
    }

    fn contains(&self, point: Pos2) -> bool {
        match self {
            Self::Rect(rect) => rect.contains(point),
            Self::Circle(center, radius) => center.distance_sq(point) <= radius * radius,
            Self::Polygon(points) => polygon_contains(points, point),
            Self::Line(points, radius) => points
                .windows(2)
                .any(|pair| distance_sq_to_segment(point, pair[0], pair[1]) <= radius * radius),
            Self::Arc(arc) => arc.contains(point),
            Self::Mesh(mesh) => mesh.indices.chunks_exact(3).any(|indices| {
                let [a, b, c] = [0, 1, 2].map(|i| mesh.vertices[indices[i] as usize].pos);
                triangle_contains([a, b, c], point)
            }),
        }
    }

    fn highlight(&self, p: &Painter) {
        let stroke = Stroke::new(1.5, Color32::WHITE);
        match self {
            Self::Rect(rect) => {
                p.rect_stroke(*rect, 1.0, stroke, StrokeKind::Inside);
            }
            Self::Circle(at, radius) => {
                p.circle_stroke(*at, *radius, stroke);
            }
            Self::Polygon(points) => {
                p.add(Shape::closed_line(points.to_vec(), stroke));
            }
            Self::Line(points, _) => {
                p.add(Shape::line(points.to_vec(), stroke));
            }
            Self::Arc(arc) => {
                p.add(Shape::closed_line(arc.outline(), stroke));
            }
            Self::Mesh(mesh) => {
                let mut overlay = (**mesh).clone();
                for vertex in &mut overlay.vertices {
                    vertex.color = Color32::from_white_alpha(56);
                }
                p.add(Shape::mesh(overlay));
            }
        }
    }
}

impl ChartArc {
    fn contains(&self, point: Pos2) -> bool {
        let offset = point - self.center;
        let scaled = vec2(offset.x, offset.y / self.y_scale);
        let radius = scaled.length();
        let span = self.to - self.from;
        if radius < self.inner || radius > self.outer || span.abs() <= f32::EPSILON {
            return false;
        }
        let angle = scaled.y.atan2(scaled.x);
        ((angle - self.from) * span.signum()).rem_euclid(std::f32::consts::TAU) <= span.abs()
    }

    fn outline(&self) -> Vec<Pos2> {
        let count = ((self.to - self.from).abs() * 24.0).ceil().max(1.0) as usize;
        let at = |radius: f32, i: usize| {
            let angle = egui::lerp(self.from..=self.to, i as f32 / count as f32);
            let point = polar(self.center, radius, angle);
            pos2(
                point.x,
                self.center.y + (point.y - self.center.y) * self.y_scale,
            )
        };
        let mut points: Vec<_> = (0..=count).map(|i| at(self.outer, i)).collect();
        if self.inner > 0.0 {
            points.extend((0..=count).rev().map(|i| at(self.inner, i)));
        } else {
            points.push(self.center);
        }
        points
    }
}

fn distance_sq_to_segment(point: Pos2, a: Pos2, b: Pos2) -> f32 {
    let edge = b - a;
    let length = edge.length_sq();
    let position = if length > 0.0 {
        ((point - a).dot(edge) / length).clamp(0.0, 1.0)
    } else {
        0.0
    };
    point.distance_sq(a + edge * position)
}

fn polygon_contains(points: &[Pos2], point: Pos2) -> bool {
    let mut inside = false;
    for (&a, &b) in points.iter().zip(points.iter().cycle().skip(1)) {
        if distance_sq_to_segment(point, a, b) <= 0.0001 {
            return true;
        }
        if (a.y > point.y) != (b.y > point.y)
            && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x
        {
            inside = !inside;
        }
    }
    inside
}

fn triangle_contains([a, b, c]: [Pos2; 3], point: Pos2) -> bool {
    let cross = |from: Pos2, to: Pos2, at: Pos2| {
        let edge = to - from;
        let offset = at - from;
        edge.x * offset.y - edge.y * offset.x
    };
    let orientation = cross(a, b, c);
    orientation.abs() > f32::EPSILON
        && [(a, b), (b, c), (c, a)]
            .into_iter()
            .all(|(from, to)| cross(from, to, point) * orientation.signum() >= 0.0)
}

pub(in crate::board) struct ChartMark {
    shape: ChartShape,
    bounds: Rect,
    clip: Rect,
    pub datum: ChartDatum,
    legend: Option<usize>,
}

pub(in crate::board) enum ChartHit<'a> {
    Legend(usize),
    LegendPage(usize),
    Item(&'a ChartMark),
}

/// The shapes painted in a chart's latest frame, kept in its local coordinate system.
pub(in crate::board) struct ChartLayout {
    clip: Rect,
    mark_clip: Rect,
    plot: Option<Rect>,
    right_start: Option<usize>,
    right_reverse: bool,
    axis_categories: Vec<f32>,
    axis_series: usize,
    enabled: bool,
    legend_enabled: bool,
    marks: Vec<ChartMark>,
    legends: Vec<(Rect, usize)>,
    legend_pages: Vec<(Rect, usize)>,
    legend_items: Vec<LegendItem>,
    row_offset: usize,
    zoom: Option<super::zoom::ZoomGeometry>,
}

struct LegendItem {
    at: Pos2,
    key: usize,
    title: String,
    size: f32,
    tint: Color32,
}

fn legend_page_ranges(lengths: &[f32], available: f32, spacing: f32) -> Vec<Range<usize>> {
    let mut pages = Vec::new();
    let mut start = 0;
    while start < lengths.len() {
        let mut end = start;
        let mut used = 0.0;
        while end < lengths.len() {
            let next = used + if end == start { 0.0 } else { spacing } + lengths[end];
            if end > start && next > available {
                break;
            }
            used = next;
            end += 1;
        }
        pages.push(start..end);
        start = end;
    }
    if pages.is_empty() {
        pages.push(0..0);
    }
    pages
}

fn format_tooltip_number(
    value: f64,
    decimals: usize,
    pad: bool,
    comma: bool,
    percent: bool,
) -> String {
    let adjusted = if percent { value * 100.0 } else { value };
    let mut text = format!("{adjusted:.decimals$}");
    if !pad && text.contains('.') {
        while text.ends_with('0') {
            text.pop();
        }
        if text.ends_with('.') {
            text.pop();
        }
    }
    if comma {
        let dot = text.find('.').unwrap_or(text.len());
        let start = usize::from(text.starts_with('-'));
        let mut index = dot;
        while index > start + 3 {
            index -= 3;
            text.insert(index, ',');
        }
    }
    if percent {
        text.push('%');
    }
    text
}

fn tooltip_value(node: &BoardNode, value: &Value, right: bool) -> String {
    let chart = &node.data["chart"];
    let prefix = if right { "tooltipRight" } else { "tooltip" };
    let key = |suffix: &str| format!("{prefix}{suffix}");
    let explicit = ["Format", "Decimals", "PadZeros", "Comma"]
        .iter()
        .any(|suffix| !chart[key(suffix)].is_null())
        || [
            "tooltipFormat",
            "tooltipDecimals",
            "tooltipPadZeros",
            "tooltipComma",
            "tooltipRightFormat",
            "tooltipRightDecimals",
            "tooltipRightPadZeros",
            "tooltipRightComma",
        ]
        .iter()
        .any(|key| !chart[*key].is_null())
        || !chart["tooltipShowUnitName"].is_null()
        || !chart["tooltipUnit"].is_null()
        || !chart["tooltipRightUnit"].is_null();
    let numeric = value
        .as_f64()
        .or_else(|| value.as_str().and_then(|v| v.parse().ok()));
    let Some(number_value) = numeric.filter(|value| value.is_finite()) else {
        return string(value);
    };
    if !explicit {
        return value_text(node, number_value as f32);
    }
    let decimals = option_number(
        node,
        &key("Decimals"),
        option_number(node, "decimals", 0.0, 0.0, 6.0),
        0.0,
        6.0,
    ) as usize;
    format_tooltip_number(
        number_value,
        decimals,
        option_bool(
            node,
            &key("PadZeros"),
            option_bool(node, "labelPadZeros", true),
        ),
        option_bool(node, &key("Comma"), false),
        chart[key("Format")] == "percent",
    )
}

impl ChartLayout {
    pub(in crate::board) fn new(node: &BoardNode, clip: Rect, preview: bool) -> Self {
        let enabled = preview && node.data["passThrough"].as_bool() != Some(true);
        Self {
            clip,
            mark_clip: clip,
            plot: None,
            right_start: None,
            right_reverse: false,
            axis_categories: Vec::new(),
            axis_series: 0,
            enabled,
            legend_enabled: enabled && option_bool(node, "legendInteractive", true),
            marks: Vec::new(),
            legends: Vec::new(),
            legend_pages: Vec::new(),
            legend_items: Vec::new(),
            row_offset: 0,
            zoom: None,
        }
    }

    pub(in crate::board) fn is_empty(&self) -> bool {
        self.marks.is_empty()
            && self.legends.is_empty()
            && self.legend_pages.is_empty()
            && self.zoom.is_none()
    }

    pub(super) fn set_plot(&mut self, plot: Rect, right_start: Option<usize>, right_reverse: bool) {
        self.plot = Some(plot);
        self.right_start = right_start;
        self.right_reverse = right_reverse;
    }

    pub(super) fn set_axis_categories(&mut self, categories: Vec<f32>, series: usize) {
        if self.enabled {
            self.axis_categories = categories;
            self.axis_series = series;
        }
    }

    pub(in crate::board) fn set_zoom(
        &mut self,
        geometry: super::zoom::ZoomGeometry,
        offset: usize,
    ) {
        self.row_offset = offset;
        if self.enabled {
            self.zoom = Some(geometry);
        }
    }

    pub(in crate::board) fn zoom_hit(
        &self,
        point: Pos2,
    ) -> Option<(super::zoom::ZoomGeometry, super::zoom::ZoomPart)> {
        self.zoom
            .and_then(|zoom| zoom.hit(point).map(|part| (zoom, part)))
    }

    pub(super) fn enabled(&self) -> bool {
        self.enabled
    }

    pub(super) fn clip_marks(&mut self, clip: Option<Rect>) {
        self.mark_clip = clip.map_or(self.clip, |clip| self.clip.intersect(clip));
    }

    pub(super) fn mark(&mut self, shape: ChartShape, datum: ChartDatum, legend: Option<usize>) {
        if !self.enabled {
            return;
        }
        let datum = match datum {
            ChartDatum::Series(index, series) => {
                ChartDatum::Series(index + self.row_offset, series)
            }
            ChartDatum::Range(index) => ChartDatum::Range(index + self.row_offset),
            other => other,
        };
        let bounds = shape.bounds().intersect(self.mark_clip);
        if bounds.is_positive() {
            self.marks.push(ChartMark {
                shape,
                bounds,
                clip: self.mark_clip,
                datum,
                legend,
            });
        }
    }

    pub(super) fn series(&mut self, shape: ChartShape, index: usize, series: usize) {
        self.mark(shape, ChartDatum::Series(index, series), Some(series));
    }

    pub(super) fn category(&mut self, shape: ChartShape, index: usize) {
        self.mark(shape, ChartDatum::Series(index, 0), Some(index));
    }

    pub(super) fn band(
        &mut self,
        [a, b, c, d]: [Pos2; 4],
        left: ChartDatum,
        right: ChartDatum,
        legend: Option<usize>,
    ) {
        if !self.enabled {
            return;
        }
        let top = a.lerp(b, 0.5);
        let bottom = d.lerp(c, 0.5);
        self.mark(
            ChartShape::Polygon(Box::new([a, top, bottom, d])),
            left,
            legend,
        );
        self.mark(
            ChartShape::Polygon(Box::new([top, b, c, bottom])),
            right,
            legend,
        );
    }

    pub(super) fn line(
        &mut self,
        points: &[Pos2],
        stride: usize,
        radius: f32,
        datum: impl Fn(usize) -> ChartDatum,
        legend: Option<usize>,
    ) {
        if !self.enabled {
            return;
        }
        for (index, start) in (0..points.len().saturating_sub(1))
            .step_by(stride)
            .enumerate()
        {
            let segment = &points[start..=start + stride];
            let (left, right): (Box<[Pos2]>, Box<[Pos2]>) = if stride == 1 {
                let middle = segment[0].lerp(segment[1], 0.5);
                (
                    Box::new([segment[0], middle]),
                    Box::new([middle, segment[1]]),
                )
            } else {
                (
                    Box::from(&segment[..=stride / 2]),
                    Box::from(&segment[stride / 2..]),
                )
            };
            self.mark(ChartShape::Line(left, radius), datum(index), legend);
            self.mark(ChartShape::Line(right, radius), datum(index + 1), legend);
        }
    }

    pub(super) fn legend(
        &mut self,
        _p: &Painter,
        at: Pos2,
        key: usize,
        title: impl ToString,
        size: f32,
        tint: Color32,
    ) {
        self.legend_items.push(LegendItem {
            at,
            key,
            title: title.to_string(),
            size,
            tint,
        });
    }

    /// Draw after the chart so explicit positioning and hit regions use the same geometry.
    pub(in crate::board) fn paint_legends(
        &mut self,
        p: &Painter,
        node: &BoardNode,
        rect: Rect,
        requested_page: usize,
        page_images: [Option<&TextureHandle>; 2],
    ) {
        if self.legend_items.is_empty() {
            return;
        }
        let options = &node.data["chart"];
        let requested = legend_position(node);
        // Reflow the legacy layout when spacing is explicitly edited.
        let scrolling = options["legendType"] == "scroll";
        let position = if requested == "auto" && (scrolling || options["legendGap"].is_number()) {
            if matches!(
                node.widget.kind.as_str(),
                "pie" | "pieBasic" | "pieRose" | "pie3d" | "donut3d" | "rose3d" | "roseRing3d"
            ) {
                "right-center"
            } else {
                "top-right"
            }
        } else if scrolling && requested == "top" {
            "top-right"
        } else if scrolling && requested == "bottom" {
            "bottom-right"
        } else {
            requested
        };
        let placed = position.starts_with("left-")
            || position.starts_with("right-")
            || position.starts_with("top-")
            || position.starts_with("bottom-");
        let vertical = position.starts_with("left-") || position.starts_with("right-");
        let marker_size = option_number(node, "legendMarkerSize", 6.0, 2.0, 40.0);
        let spacing = option_number(node, "legendGap", 10.0, 0.0, 100.0);
        let text_color = option_color(node, "legendColor", "#cde3f7");
        let text_style = super::legend_text::LegendText::new(node, false);
        let max_chars = option_number(node, "legendMaxChars", 100.0, 1.0, 1000.0) as usize;
        let marker_shape = options["legendMarker"].as_str().unwrap_or("circle");
        let labels: Vec<String> = self
            .legend_items
            .iter()
            .map(|item| {
                let mut chars = item.title.chars();
                let value: String = chars.by_ref().take(max_chars).collect();
                if chars.next().is_some() {
                    format!("{value}…")
                } else {
                    value
                }
            })
            .collect();
        let galleys: Vec<_> = self
            .legend_items
            .iter()
            .zip(&labels)
            .map(|(item, label)| text_style.layout(p, label, item.size, text_color))
            .collect();
        let custom_width = (options["legendTextMode"] == "custom")
            .then(|| option_number(node, "legendTextWidth", 30.0, 0.0, 2000.0));
        let sizes: Vec<_> = galleys
            .iter()
            .map(|galley| {
                let text = galley.size();
                vec2(
                    marker_size + 4.0 + custom_width.unwrap_or(text.x),
                    marker_size.max(text.y),
                )
            })
            .collect();
        let all_total = if vertical {
            vec2(
                sizes.iter().map(|s| s.x).fold(0.0, f32::max),
                sizes.iter().map(|s| s.y).sum::<f32>()
                    + spacing * sizes.len().saturating_sub(1) as f32,
            )
        } else {
            vec2(
                sizes.iter().map(|s| s.x).sum::<f32>()
                    + spacing * sizes.len().saturating_sub(1) as f32,
                sizes.iter().map(|s| s.y).fold(0.0, f32::max),
            )
        };
        let page_font_size = option_number(node, "legendPageTextSize", 12.0, 6.0, 48.0);
        let icon = option_number(node, "legendPageIconSize", 12.0, 4.0, 60.0);
        let item_gap = option_number(node, "legendPageItemGap", 12.0, 0.0, 100.0);
        let page_gap = option_number(node, "legendPageGap", 12.0, 0.0, 100.0);
        let page_color = option_color(node, "legendPageTextColor", "#ffffff");
        let page_style = super::legend_text::LegendText::new(node, true);
        let indicator = page_style
            .layout(p, "30/30", page_font_size, page_color)
            .size();
        let control_size = if vertical {
            vec2(
                icon.max(indicator.x),
                icon * 2.0 + item_gap * 2.0 + indicator.y,
            )
        } else {
            vec2(
                icon * 2.0 + item_gap * 2.0 + indicator.x,
                icon.max(indicator.y),
            )
        };
        let available = if vertical {
            rect.height()
        } else {
            rect.width()
        };
        let extent = if vertical { all_total.y } else { all_total.x };
        let controls_extent = if vertical {
            control_size.y
        } else {
            control_size.x
        };
        let pages = if scrolling && extent > available {
            let dimensions: Vec<f32> = sizes
                .iter()
                .map(|size| if vertical { size.y } else { size.x })
                .collect();
            legend_page_ranges(
                &dimensions,
                (available - controls_extent - page_gap).max(1.0),
                spacing,
            )
        } else {
            vec![0..sizes.len()]
        };
        let page = requested_page.min(pages.len() - 1);
        let selected = pages[page].clone();
        let selected_sizes = &sizes[selected.clone()];
        let items_total = if vertical {
            vec2(
                selected_sizes.iter().map(|size| size.x).fold(0.0, f32::max),
                selected_sizes.iter().map(|size| size.y).sum::<f32>()
                    + spacing * selected_sizes.len().saturating_sub(1) as f32,
            )
        } else {
            vec2(
                selected_sizes.iter().map(|size| size.x).sum::<f32>()
                    + spacing * selected_sizes.len().saturating_sub(1) as f32,
                selected_sizes.iter().map(|size| size.y).fold(0.0, f32::max),
            )
        };
        let total = if pages.len() > 1 {
            if vertical {
                vec2(
                    items_total.x.max(control_size.x),
                    items_total.y + page_gap + control_size.y,
                )
            } else {
                vec2(
                    items_total.x + page_gap + control_size.x,
                    items_total.y.max(control_size.y),
                )
            }
        } else {
            items_total
        };
        let aligned = |lo: f32, hi: f32, size: f32, align: &str| match align {
            "left" | "top" => lo,
            "center" => (lo + hi - size) / 2.0,
            _ => hi - size,
        };
        let parts: Vec<_> = position.split('-').collect();
        let (x_align, y_align) = if vertical {
            (
                parts.first().copied().unwrap_or("left"),
                parts.get(1).copied().unwrap_or("top"),
            )
        } else {
            (
                parts.get(1).copied().unwrap_or("right"),
                parts.first().copied().unwrap_or("top"),
            )
        };
        let origin = pos2(
            aligned(rect.min.x, rect.max.x, total.x, x_align),
            aligned(rect.min.y, rect.max.y, total.y, y_align),
        );
        let mut offset = 0.0;
        for (((item, title), size), galley) in self
            .legend_items
            .iter()
            .zip(labels)
            .zip(sizes)
            .zip(galleys)
            .skip(selected.start)
            .take(selected.len())
        {
            let at = if placed {
                origin
                    + if vertical {
                        vec2(0.0, offset)
                    } else {
                        vec2(offset, 0.0)
                    }
            } else {
                item.at
            };
            let marker = if placed {
                at + vec2(marker_size / 2.0, size.y / 2.0)
            } else {
                at + vec2(0.0, 5.0)
            };
            match marker_shape {
                "square" => {
                    p.rect_filled(
                        Rect::from_center_size(marker, vec2(marker_size, marker_size)),
                        0.0,
                        item.tint,
                    );
                }
                "roundSquare" => {
                    p.rect_filled(
                        Rect::from_center_size(marker, vec2(marker_size, marker_size)),
                        marker_size / 4.0,
                        item.tint,
                    );
                }
                "triangle" | "diamond" => {
                    let half = marker_size / 2.0;
                    let points = if marker_shape == "triangle" {
                        vec![
                            marker + vec2(0.0, -half),
                            marker + vec2(half, half),
                            marker + vec2(-half, half),
                        ]
                    } else {
                        vec![
                            marker + vec2(0.0, -half),
                            marker + vec2(half, 0.0),
                            marker + vec2(0.0, half),
                            marker + vec2(-half, 0.0),
                        ]
                    };
                    p.add(Shape::convex_polygon(points, item.tint, Stroke::NONE));
                }
                "line" => {
                    p.line_segment(
                        [
                            marker - vec2(marker_size / 2.0, 0.0),
                            marker + vec2(marker_size / 2.0, 0.0),
                        ],
                        Stroke::new(2.0, item.tint),
                    );
                }
                _ => {
                    p.circle_filled(marker, marker_size / 2.0, item.tint);
                }
            }
            let label_at = if placed {
                at + vec2(marker_size + 4.0, (size.y - galley.size().y) / 2.0)
            } else {
                at + vec2(marker_size + 1.0, 0.0)
            };
            let label = Rect::from_min_size(
                label_at,
                vec2(custom_width.unwrap_or(galley.size().x), galley.size().y),
            );
            text_style.draw(p, label_at, &title, galley, text_color, label.expand(0.5));
            if self.legend_enabled {
                let bounds = label
                    .union(Rect::from_center_size(
                        marker,
                        vec2(marker_size, marker_size),
                    ))
                    .expand(3.0)
                    .intersect(self.clip);
                if bounds.is_positive() {
                    self.legends.push((bounds, item.key));
                }
            }
            offset += if vertical {
                size.y + spacing
            } else {
                size.x + spacing
            };
        }
        if pages.len() > 1 {
            let start = if vertical {
                origin + vec2((total.x - control_size.x) / 2.0, items_total.y + page_gap)
            } else {
                origin + vec2(items_total.x + page_gap, (total.y - control_size.y) / 2.0)
            };
            let (previous, next, text_at) = if vertical {
                (
                    Rect::from_min_size(
                        start + vec2((control_size.x - icon) / 2.0, 0.0),
                        vec2(icon, icon),
                    ),
                    Rect::from_min_size(
                        start + vec2((control_size.x - icon) / 2.0, control_size.y - icon),
                        vec2(icon, icon),
                    ),
                    start + vec2(control_size.x / 2.0, icon + item_gap + indicator.y / 2.0),
                )
            } else {
                (
                    Rect::from_min_size(
                        start + vec2(0.0, (control_size.y - icon) / 2.0),
                        vec2(icon, icon),
                    ),
                    Rect::from_min_size(
                        start + vec2(control_size.x - icon, (control_size.y - icon) / 2.0),
                        vec2(icon, icon),
                    ),
                    start + vec2(icon + item_gap + indicator.x / 2.0, control_size.y / 2.0),
                )
            };
            let active = option_color(node, "legendPageIconColor", "#ffffff");
            let inactive = option_color(node, "legendPageInactiveColor", "#3c3c3c");
            for (index, (bounds, forward, enabled)) in [
                (previous, false, page > 0),
                (next, true, page + 1 < pages.len()),
            ]
            .into_iter()
            .enumerate()
            {
                let c = bounds.center();
                let d = icon * 0.35;
                let points = if vertical {
                    let sign = if forward { 1.0 } else { -1.0 };
                    vec![
                        c + vec2(0.0, sign * d),
                        c + vec2(-d, -sign * d),
                        c + vec2(d, -sign * d),
                    ]
                } else {
                    let sign = if forward { 1.0 } else { -1.0 };
                    vec![
                        c + vec2(sign * d, 0.0),
                        c + vec2(-sign * d, -d),
                        c + vec2(-sign * d, d),
                    ]
                };
                if let Some(image) = page_images[index] {
                    p.image(
                        image.id(),
                        bounds,
                        Rect::from_min_max(pos2(0.0, 0.0), pos2(1.0, 1.0)),
                        Color32::WHITE,
                    );
                }
                p.add(Shape::convex_polygon(
                    points,
                    if enabled { active } else { inactive },
                    Stroke::NONE,
                ));
                if enabled && self.enabled {
                    let hit = bounds.expand(3.0).intersect(self.clip).intersect(rect);
                    if hit.is_positive() {
                        self.legend_pages
                            .push((hit, if forward { page + 1 } else { page - 1 }));
                    }
                }
            }
            let page_label = format!("{}/{}", page + 1, pages.len());
            let galley = page_style.layout(p, &page_label, page_font_size, page_color);
            let at = text_at - galley.size() / 2.0;
            page_style.draw(p, at, &page_label, galley, page_color, self.clip);
        }
    }

    pub(in crate::board) fn hit(
        &self,
        point: Pos2,
        hidden: Option<&HashSet<usize>>,
    ) -> Option<ChartHit<'_>> {
        if !self.clip.contains(point) {
            return None;
        }
        if let Some((_, page)) = self
            .legend_pages
            .iter()
            .find(|(rect, _)| rect.contains(point))
        {
            return Some(ChartHit::LegendPage(*page));
        }
        if let Some((_, index)) = self
            .legends
            .iter()
            .rev()
            .find(|(rect, _)| rect.contains(point))
        {
            return Some(ChartHit::Legend(*index));
        }
        self.marks
            .iter()
            .rev()
            .find(|mark| {
                !mark
                    .legend
                    .is_some_and(|index| hidden.is_some_and(|set| set.contains(&index)))
                    && mark.bounds.contains(point)
                    && mark.shape.contains(point)
            })
            .map(ChartHit::Item)
    }

    pub(in crate::board) fn paint_hover(
        &self,
        p: &Painter,
        node: &BoardNode,
        point: Pos2,
        hidden: Option<&HashSet<usize>>,
        background: Option<&TextureHandle>,
    ) {
        if !option_bool(node, "showTooltip", true) {
            return;
        }
        let hit = self.hit(point, hidden);
        if matches!(hit, Some(ChartHit::Legend(_) | ChartHit::LegendPage(_))) {
            return;
        }
        let mark = if let Some(ChartHit::Item(mark)) = hit {
            Some(mark)
        } else {
            None
        };
        let axis_category = self.plot.filter(|plot| plot.contains(point)).and_then(|_| {
            self.axis_categories
                .iter()
                .enumerate()
                .min_by(|(_, a), (_, b)| (point.x - **a).abs().total_cmp(&(point.x - **b).abs()))
                .map(|(index, x)| (index + self.row_offset, *x))
        });
        if let Some(mark) = mark {
            mark.shape.highlight(&p.with_clip_rect(mark.clip));
        }
        let axis_data = axis_category.map(|(index, _)| {
            (0..self.axis_series.min(3))
                .filter(|series| {
                    let value = &node.data["rows"][index][["value", "value2", "value3"][*series]];
                    let remove_zero = (node.widget.kind.starts_with("line")
                        || node.widget.kind.starts_with("area"))
                        && option_bool(node, "zeroRemoval", false);
                    !hidden.is_some_and(|set| set.contains(series))
                        && !value.is_null()
                        && !(remove_zero && number(value, 0.0) == 0.0)
                })
                .map(|series| ChartDatum::Series(index, series))
                .collect::<Vec<_>>()
        });
        let data: Vec<&ChartDatum> = if let Some(data) = &axis_data {
            data.iter().collect()
        } else if let Some(mark) = mark {
            vec![&mark.datum]
        } else {
            return;
        };
        let Some(first) = data.first() else {
            return;
        };
        let name = first.details(node).0;
        let is_right = |series: usize| {
            self.right_start.is_some_and(|start| {
                if self.right_reverse {
                    series == start
                } else {
                    series >= start
                }
            })
        };
        let entries: Vec<_> = data
            .iter()
            .map(|datum| {
                let (_, value, caption) = datum.details(node);
                let series = if let ChartDatum::Series(_, series) = datum {
                    *series
                } else {
                    0
                };
                let right = is_right(series);
                let format = |value: &Value| tooltip_value(node, value, right);
                let text = if let Some(values) = value.as_array() {
                    values.iter().map(format).collect::<Vec<_>>().join(" – ")
                } else {
                    format(&value)
                };
                (caption, text, series, right)
            })
            .collect();
        let value_text = &entries[0].1;
        if let Some(plot) = self.plot {
            let vertical = option_bool(node, "tooltipShowVerticalPointer", false);
            let horizontal = option_bool(node, "tooltipShowHorizontalPointer", false);
            if vertical || horizontal {
                let anchor = if let Some((_, x)) = axis_category {
                    pos2(x, point.y)
                } else {
                    mark.map_or(point, |mark| mark.shape.pointer_anchor(point))
                }
                .clamp(plot.min, plot.max);
                let painter = p.with_clip_rect(plot);
                let line_color = option_color(node, "tooltipPointerColor", "#999999");
                let width = option_number(node, "tooltipPointerWidth", 1.0, 0.0, 20.0);
                let style = node.data["chart"]["tooltipPointerStyle"]
                    .as_str()
                    .unwrap_or("dashed");
                if vertical {
                    axis::stroke(
                        &painter,
                        pos2(anchor.x, plot.min.y),
                        pos2(anchor.x, plot.max.y),
                        width,
                        line_color,
                        style,
                        (4.0, 4.0),
                    );
                }
                if horizontal {
                    axis::stroke(
                        &painter,
                        pos2(plot.min.x, anchor.y),
                        pos2(plot.max.x, anchor.y),
                        width,
                        line_color,
                        style,
                        (4.0, 4.0),
                    );
                }
                if option_bool(node, "tooltipPointerLabel", false) {
                    let font = FontId::proportional(option_number(
                        node,
                        "tooltipPointerLabelSize",
                        12.0,
                        6.0,
                        48.0,
                    ));
                    let foreground = option_color(node, "tooltipPointerLabelColor", "#ffffff");
                    let background = option_color(node, "tooltipPointerLabelBackground", "#505765");
                    let label = |text: &str, center: Pos2| {
                        let size = p
                            .layout_no_wrap(text.to_owned(), font.clone(), foreground)
                            .size()
                            + vec2(8.0, 4.0);
                        let rect = Rect::from_center_size(center, size);
                        p.rect_filled(rect, 2.0, background);
                        p.text(
                            center,
                            Align2::CENTER_CENTER,
                            text,
                            font.clone(),
                            foreground,
                        );
                    };
                    if vertical {
                        label(&name, pos2(anchor.x, plot.max.y + font.size / 2.0 + 3.0));
                    }
                    if horizontal {
                        label(value_text, pos2(plot.min.x, anchor.y));
                    }
                }
            }
        }
        let font_size = option_number(node, "tooltipFontSize", 12.0, 6.0, 48.0);
        let value_color = option_color(node, "tooltipTextColor", "#cde3f7");
        let name_size = option_number(node, "tooltipNameSize", font_size, 6.0, 48.0);
        let name_color = option_color(
            node,
            "tooltipNameColor",
            node.data["chart"]["tooltipTextColor"]
                .as_str()
                .unwrap_or("#cde3f7"),
        );
        let title_size = option_number(node, "tooltipTitleSize", font_size, 6.0, 48.0);
        let title_color = option_color(
            node,
            "tooltipTitleColor",
            node.data["chart"]["tooltipTextColor"]
                .as_str()
                .unwrap_or("#cde3f7"),
        );
        let unit_size = option_number(node, "tooltipUnitSize", font_size, 6.0, 48.0);
        let unit_color = option_color(
            node,
            "tooltipUnitColor",
            node.data["chart"]["tooltipTextColor"]
                .as_str()
                .unwrap_or("#cde3f7"),
        );
        let chart = &node.data["chart"];
        let explicit_format = [
            "tooltipFormat",
            "tooltipDecimals",
            "tooltipPadZeros",
            "tooltipComma",
            "tooltipRightFormat",
            "tooltipRightDecimals",
            "tooltipRightPadZeros",
            "tooltipRightComma",
            "tooltipShowUnitName",
            "tooltipUnit",
            "tooltipRightUnit",
        ]
        .iter()
        .any(|key| !chart[*key].is_null());
        let details: Vec<_> = entries
            .iter()
            .map(|(caption, value, series, right)| {
                let unit_key = if *right {
                    "tooltipRightUnit"
                } else {
                    "tooltipUnit"
                };
                let unit = if explicit_format
                    && option_bool(
                        node,
                        "tooltipShowUnitName",
                        chart["unit"].as_str().is_some_and(|unit| !unit.is_empty()),
                    ) {
                    chart[unit_key]
                        .as_str()
                        .or_else(|| chart["unit"].as_str())
                        .unwrap_or("")
                } else {
                    ""
                };
                let mut detail = LayoutJob::default();
                let mut append = |value: &str, size: f32, color: Color32| {
                    detail.append(
                        value,
                        0.0,
                        TextFormat {
                            font_id: FontId::proportional(size),
                            color,
                            ..Default::default()
                        },
                    );
                };
                append(&format!("{caption}："), name_size, name_color);
                append(value, font_size, value_color);
                if !(unit == "%" && value.ends_with('%')) {
                    append(unit, unit_size, unit_color);
                }
                (p.layout_job(detail), *series)
            })
            .collect();
        let title = option_bool(node, "tooltipShowTitle", true)
            .then(|| p.layout_no_wrap(name, FontId::proportional(title_size), title_color));
        let pad_x = option_number(node, "tooltipPaddingX", 10.0, 0.0, 100.0);
        let pad_y = option_number(node, "tooltipPaddingY", 7.0, 0.0, 100.0);
        let icon_size = if option_bool(node, "tooltipShowIcon", false) {
            10.0
        } else {
            0.0
        };
        let title_height = title.as_ref().map_or(0.0, |title| title.size().y + 7.0);
        let detail_width = details
            .iter()
            .map(|(detail, _)| detail.size().x)
            .fold(0.0_f32, f32::max);
        let detail_height = details
            .iter()
            .map(|(detail, _)| detail.size().y)
            .sum::<f32>()
            + details.len().saturating_sub(1) as f32 * 3.0;
        let width = title
            .as_ref()
            .map_or(0.0, |title| title.size().x)
            .max(detail_width + icon_size)
            + 2.0 * pad_x;
        let size = vec2(
            width.min(self.clip.width()),
            (title_height + detail_height + 2.0 * pad_y).min(self.clip.height()),
        );
        let origin = if node.data["chart"]["tooltipPosition"].as_str() == Some("center") {
            self.clip.center() - size / 2.0
        } else {
            (point + vec2(12.0, 12.0)).clamp(self.clip.min, self.clip.max - size)
        };
        let rect = Rect::from_min_size(origin, size);
        let radius = option_number(node, "tooltipRadius", 4.0, 0.0, 50.0);
        p.rect_filled(
            rect,
            radius,
            option_color(node, "tooltipBackground", "#10243cf2"),
        );
        if let Some(image) = background {
            p.add(
                egui::epaint::RectShape::filled(rect, radius, Color32::WHITE).with_texture(
                    image.id(),
                    Rect::from_min_max(pos2(0.0, 0.0), pos2(1.0, 1.0)),
                ),
            );
        }
        p.rect_stroke(
            rect,
            radius,
            Stroke::new(1.0, color("#4c7192")),
            StrokeKind::Inside,
        );
        let text = p.with_clip_rect(rect);
        if let Some(title) = title {
            text.galley(origin + vec2(pad_x, pad_y), title, title_color);
        }
        let mut y = pad_y + title_height;
        for (detail, series) in details {
            if icon_size > 0.0 {
                text.circle_filled(
                    origin + vec2(pad_x + 3.0, y + detail.size().y / 2.0),
                    3.0,
                    series_color(node, series),
                );
            }
            let height = detail.size().y;
            text.galley(origin + vec2(pad_x + icon_size, y), detail, value_color);
            y += height + 3.0;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::board::{BoardDocument, BoardScene, Clock, WidgetStyle};

    #[test]
    fn tooltip_formats_values_independently_and_keeps_legacy_values() {
        let mut node = BoardNode {
            data: json!({"chart":{"unit":"kg", "decimals":1}}),
            ..BoardNode::default()
        };
        assert_eq!(tooltip_value(&node, &json!(1234.5), false), "1234.5kg");
        node.data["chart"] = json!({"tooltipFormat":"normal", "tooltipComma":true,
            "tooltipDecimals":2, "tooltipPadZeros":true, "tooltipRightFormat":"percent",
            "tooltipRightDecimals":1, "tooltipRightPadZeros":false});
        assert_eq!(tooltip_value(&node, &json!(-12345.6), false), "-12,345.60");
        assert_eq!(tooltip_value(&node, &json!(0.125), true), "12.5%");
        assert_eq!(tooltip_value(&node, &json!("12.5"), false), "12.50");
        assert_eq!(tooltip_value(&node, &json!("unknown"), false), "unknown");
        assert_eq!(format_tooltip_number(12.0, 3, false, false, false), "12");
    }

    #[test]
    fn legend_pagination_packs_variable_width_items_without_dropping_any() {
        assert_eq!(
            legend_page_ranges(&[40.0, 30.0, 90.0, 10.0], 80.0, 5.0),
            vec![0..2, 2..3, 3..4]
        );
        assert_eq!(legend_page_ranges(&[], 80.0, 5.0), vec![0..0]);
    }

    #[test]
    fn legend_page_buttons_switch_pages_and_keep_item_clicks() {
        let rows: Vec<_> = (0..12)
            .map(|index| json!({"name": format!("Category-{index}"), "value": index + 1}))
            .collect();
        let mut node = BoardNode {
            id: "chart".into(),
            x: 10.0,
            y: 10.0,
            width: 230.0,
            height: 150.0,
            color: "#7abaff".into(),
            widget: WidgetStyle {
                kind: "pieBasic".into(),
                opacity: 1.0,
                background: "transparent".into(),
                border_style: "none".into(),
                ..WidgetStyle::default()
            },
            data: json!({"__kitChart":true, "rows":rows, "chart":{"legendType":"scroll", "legendPosition":"top-left", "legendGap":4}}),
            ..BoardNode::default()
        };
        for position in ["top-left", "right-center"] {
            node.data["chart"]["legendPosition"] = json!(position);
            let mut scene = BoardScene::default();
            scene
                .sync(BoardDocument {
                    width: 400.0,
                    height: 300.0,
                    preview: true,
                    selected: vec![],
                    nodes: vec![node.clone()],
                })
                .unwrap();
            let clock = Clock::default();
            scene.frame(&clock, 400, 300, false).textures.clear();
            let layout = &scene.chart_layouts["chart"];
            let first_item = layout.legends[0].1;
            let next = layout
                .legend_pages
                .iter()
                .find(|(_, page)| *page == 1)
                .expect("next page")
                .0
                .center();
            scene.pointer("down", node.world(next));
            scene.pointer("up", node.world(next));
            assert_eq!(scene.chart_legend_pages["chart"], 1);
            scene.frame(&clock, 400, 300, false).textures.clear();
            let layout = &scene.chart_layouts["chart"];
            let (bounds, item) = layout.legends[0];
            assert!(item > first_item);
            scene.pointer("down", node.world(bounds.center()));
            scene.pointer("up", node.world(bounds.center()));
            assert!(scene.chart_hidden["chart"].contains(&item));
        }
    }

    #[test]
    fn chart_images_survive_sync_with_the_same_owner() {
        let mut scene = BoardScene::default();
        let node = BoardNode {
            id: "chart".into(),
            width: 100.0,
            height: 100.0,
            widget: WidgetStyle {
                kind: "pieBasic".into(),
                ..WidgetStyle::default()
            },
            ..BoardNode::default()
        };
        let document = BoardDocument {
            width: 200.0,
            height: 200.0,
            preview: false,
            selected: vec![],
            nodes: vec![node],
        };
        scene.sync(document.clone()).unwrap();
        let left = format!("{}chart", crate::board::LEGEND_LEFT_IMAGE_PREFIX);
        let right = format!("{}chart", crate::board::LEGEND_RIGHT_IMAGE_PREFIX);
        let tooltip = format!("{}chart", crate::board::TOOLTIP_IMAGE_PREFIX);
        let point = format!("{}1:chart", crate::board::POINT_IMAGE_PREFIX);
        for id in [
            "chart",
            left.as_str(),
            right.as_str(),
            tooltip.as_str(),
            point.as_str(),
        ] {
            scene.set_image(id, 1, 1, &[10, 20, 30, 255]).unwrap();
        }
        scene.sync(document).unwrap();
        assert!(
            [
                "chart",
                left.as_str(),
                right.as_str(),
                tooltip.as_str(),
                point.as_str()
            ]
            .iter()
            .all(|id| scene.images.contains_key(*id))
        );
        scene
            .sync(BoardDocument {
                width: 200.0,
                height: 200.0,
                preview: false,
                selected: vec![],
                nodes: vec![],
            })
            .unwrap();
        assert!(scene.images.is_empty());
    }
}
