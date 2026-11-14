use egui::epaint::{CornerRadiusF32, Vertex, WHITE_UV, tessellator::path::rounded_rectangle};
use egui::{
    Align, Align2, Color32, FontId, Mesh, Painter, Pos2, Rect, Shape, Stroke, StrokeKind, Vec2,
    pos2, vec2,
};
use serde_json::Value;

use super::widgets::table_grid;
use super::{BoardNode, BoardScene, Clock, color, number};

fn table_dimensions(node: &BoardNode) -> (f32, f32, f32) {
    let style = &node.data["__kitTable"];
    let header = number(&style["headerHeight"], 30.0).clamp(0.0, node.height);
    let header_gap = number(&style["headerGap"], 0.0).max(0.0);
    let gap = number(&style["rowGap"], 0.0).max(0.0);
    let count = number(&style["rowCount"], 5.0).clamp(1.0, 50.0);
    let pagination = number(&style["paginationHeight"], 0.0).max(0.0);
    let available = (node.height - header - header_gap - pagination - (count - 1.0) * gap).max(0.0);
    let row = number(&style["rowHeight"], available / count).max(1.0);
    (header + header_gap, row, gap)
}

pub(super) fn kit_table_row(node: &BoardNode, point: Pos2) -> Option<usize> {
    let (top, height, gap) = table_dimensions(node);
    let local = point.y - top;
    if local < 0.0 || point.x < 0.0 || point.x > node.width || point.y > node.height {
        return None;
    }
    let index = (local / (height + gap)).floor() as usize;
    let count = number(&node.data["__kitTable"]["rowCount"], 5.0).clamp(1.0, 50.0) as usize;
    let rows = node.data["rows"].as_array()?;
    (index < count && index < rows.len() && local % (height + gap) <= height).then_some(index)
}

fn table_style_at(styles: &Value, index: usize) -> &Value {
    let Some(styles) = styles.as_array() else {
        return &Value::Null;
    };
    if styles.is_empty() {
        &Value::Null
    } else {
        &styles[index % styles.len()]
    }
}

fn table_condition<'a>(node: &BoardNode, column: &'a Value, row: &[String]) -> Option<&'a Value> {
    let fields = node.data["__kitTable"]["fields"].as_array()?;
    column["conditions"].as_array()?.iter().find(|condition| {
        let Some(pair) = condition["field"].as_array() else {
            return false;
        };
        let Some(field) = pair.first().and_then(Value::as_str) else {
            return false;
        };
        let Some(index) = fields.iter().position(|item| item.as_str() == Some(field)) else {
            return false;
        };
        let actual = row.get(index).map_or("", String::as_str);
        let expected = super::string(&condition["value"]);
        let operator = pair.get(1).and_then(Value::as_str).unwrap_or("==");
        match operator {
            "==" | "=" => actual == expected,
            "!=" => actual != expected,
            ">" | ">=" | "<" | "<=" => {
                let (Ok(left), Ok(right)) = (actual.parse::<f64>(), expected.parse::<f64>()) else {
                    return false;
                };
                match operator {
                    ">" => left > right,
                    ">=" => left >= right,
                    "<" => left < right,
                    _ => left <= right,
                }
            }
            "contains" => actual.contains(&expected),
            _ => false,
        }
    })
}

fn table_value(value: &str, style: &Value) -> String {
    let kind = style["type"].as_str().unwrap_or("text");
    if !matches!(kind, "number" | "percentage") {
        return value.to_owned();
    }
    let Ok(mut number) = value.parse::<f64>() else {
        return value.to_owned();
    };
    if kind == "percentage" && style["percentageType"] == "float" {
        number *= 100.0;
    }
    let decimals = super::number(&style["decimals"], 2.0).clamp(0.0, 12.0) as usize;
    let mut output = format!("{number:.decimals$}");
    if style["completeZero"] != true && output.contains('.') {
        while output.ends_with('0') {
            output.pop();
        }
        if output.ends_with('.') {
            output.pop();
        }
    }
    if kind == "percentage" {
        output.push('%');
    }
    output
}

pub(super) struct KitGradient {
    direction: Vec2,
    stops: Vec<(f32, Color32)>,
}

impl KitGradient {
    pub(super) fn read(value: &Value) -> Option<Self> {
        let mut stops: Vec<_> = value["stops"]
            .as_array()?
            .iter()
            .filter_map(|stop| {
                let position = (number(&stop["position"], 0.0) / 100.0).clamp(0.0, 1.0);
                Some((position, color(stop["color"].as_str()?)))
            })
            .collect();
        if stops.len() < 2 {
            return None;
        }
        stops.sort_by(|a, b| a.0.total_cmp(&b.0));
        if stops[0].0 > 0.0 {
            stops.insert(0, (0.0, stops[0].1));
        }
        if let Some(&(position, tint)) = stops.last()
            && position < 1.0
        {
            stops.push((1.0, tint));
        }
        let (sin, cos) = number(&value["angle"], 0.0).to_radians().sin_cos();
        Some(Self {
            direction: vec2(sin, -cos),
            stops,
        })
    }

    pub(super) fn rect(&self, painter: &Painter, rect: Rect, radius: f32) {
        if !rect.is_positive() {
            return;
        }
        let mut path = Vec::new();
        rounded_rectangle(&mut path, rect, CornerRadiusF32::same(radius));
        self.paint(painter, &path, rect);
    }

    fn color_at(&self, point: Pos2, bounds: Rect) -> Color32 {
        let extent = self.direction.abs().dot(bounds.size());
        if extent <= f32::EPSILON {
            return self.stops[0].1;
        }
        let fraction = (point - bounds.center()).dot(self.direction) / extent + 0.5;
        for stop in self.stops.windows(2) {
            let (low, low_color) = stop[0];
            let (high, high_color) = stop[1];
            if fraction <= high && high - low > f32::EPSILON {
                return low_color.lerp_to_gamma(
                    high_color,
                    ((fraction - low) / (high - low)).clamp(0.0, 1.0),
                );
            }
        }
        self.stops
            .last()
            .map_or(Color32::TRANSPARENT, |stop| stop.1)
    }

    pub(super) fn paint(&self, painter: &Painter, points: &[Pos2], bounds: Rect) {
        let extent = self.direction.abs().dot(bounds.size());
        if extent <= f32::EPSILON {
            return;
        }
        let fraction = |point: Pos2| (point - bounds.center()).dot(self.direction) / extent + 0.5;
        let mut mesh = Mesh::default();
        for stop in self.stops.windows(2) {
            let (low, low_color) = stop[0];
            let (high, high_color) = stop[1];
            if high - low <= f32::EPSILON {
                continue;
            }
            let strip = clip_color_stop(points, |point| fraction(point) - low);
            let strip = clip_color_stop(&strip, |point| high - fraction(point));
            let start = mesh.vertices.len() as u32;
            mesh.vertices.extend(strip.iter().map(|point| Vertex {
                pos: *point,
                uv: WHITE_UV,
                color: low_color.lerp_to_gamma(
                    high_color,
                    ((fraction(*point) - low) / (high - low)).clamp(0.0, 1.0),
                ),
            }));
            for i in 1..strip.len().saturating_sub(1) as u32 {
                mesh.add_triangle(start, start + i, start + i + 1);
            }
        }
        if !mesh.is_empty() {
            painter.add(Shape::mesh(mesh));
        }
    }
}

fn clip_color_stop(points: &[Pos2], distance: impl Fn(Pos2) -> f32) -> Vec<Pos2> {
    let Some(&last) = points.last() else {
        return Vec::new();
    };
    let mut previous = last;
    let mut clipped = Vec::new();
    for &point in points {
        let start = distance(previous);
        let end = distance(point);
        if (start >= 0.0) != (end >= 0.0) {
            clipped.push(previous.lerp(point, start / (start - end)));
        }
        if end >= 0.0 {
            clipped.push(point);
        }
        previous = point;
    }
    clipped
}

fn fill(painter: &Painter, rect: Rect, style: &Value) {
    let radius = number(&style["radius"], 0.0);
    if let Some(gradient) = KitGradient::read(&style["gradient"]) {
        gradient.rect(painter, rect, radius);
    } else if let Some(tint) = style["fill"].as_str() {
        painter.rect_filled(rect, radius, color(tint));
    }
    let width = number(&style["borderWidth"], 0.0);
    if width > 0.0
        && let Some(tint) = style["borderColor"].as_str()
    {
        let stroke = Stroke::new(width, color(tint));
        match style["borderStyle"].as_str() {
            Some(kind @ ("dashed" | "dotted")) => {
                let rect = rect.shrink(width * 0.5);
                let points = [
                    rect.left_top(),
                    rect.right_top(),
                    rect.right_bottom(),
                    rect.left_bottom(),
                    rect.left_top(),
                ];
                let length = if kind == "dotted" {
                    width.max(1.0)
                } else {
                    7.0
                };
                painter.extend(Shape::dashed_line(&points, stroke, length, 4.0));
            }
            _ => {
                painter.rect_stroke(rect, radius, stroke, StrokeKind::Inside);
            }
        }
    }
}

fn text(painter: &Painter, rect: Rect, style: &Value, caption: &str) {
    let size = number(&style["fontSize"], 16.0);
    if !caption.is_empty() && size > 0.0 && style["textVisible"] != false {
        let padding = &style["padding"];
        let min = rect.min + vec2(number(&padding[3], 0.0), number(&padding[0], 0.0));
        let max = pos2(
            (rect.max.x - number(&padding[1], 0.0)).max(min.x),
            (rect.max.y - number(&padding[2], 0.0)).max(min.y),
        );
        let rect = Rect::from_min_max(min, max);
        let tint = color(style["color"].as_str().unwrap_or("#d5d5d6"));
        let x = match style["align"].as_str() {
            Some("left") => Align::Min,
            Some("right") => Align::Max,
            _ => Align::Center,
        };
        let y = match style["vertical"].as_str() {
            Some("top" | "start") => Align::Min,
            Some("bottom" | "end") => Align::Max,
            _ => Align::Center,
        };
        let align = Align2([x, y]);
        let offset = vec2(
            number(&style["offset"][0], 0.0),
            number(&style["offset"][1], 0.0),
        );
        if style.get("fontFamily").is_some() {
            let family = style["fontFamily"]
                .as_str()
                .unwrap_or("")
                .to_ascii_lowercase();
            let format = egui::TextFormat {
                font_id: if family.contains("mono") || family.contains("courier") {
                    FontId::monospace(size)
                } else {
                    FontId::proportional(size)
                },
                color: tint,
                italics: style["fontItalic"] == true,
                underline: if style["fontUnderline"] == true {
                    Stroke::new(1.0, tint)
                } else {
                    Stroke::NONE
                },
                strikethrough: if style["fontStrike"] == true {
                    Stroke::new(1.0, tint)
                } else {
                    Stroke::NONE
                },
                extra_letter_spacing: number(&style["letterSpacing"], 0.0),
                ..Default::default()
            };
            let caption = if style["arrangement"] == "vertical" {
                caption
                    .chars()
                    .map(|ch| ch.to_string())
                    .collect::<Vec<_>>()
                    .join("\n")
            } else {
                caption.to_owned()
            };
            let mut job = egui::text::LayoutJob::default();
            if style["textOverflow"] == "ellipsis" {
                job.wrap = egui::text::TextWrapping::truncate_at_width(rect.width().max(0.0));
                if style["arrangement"] == "vertical" {
                    let row_height = painter
                        .fonts_mut(|fonts| fonts.row_height(&format.font_id))
                        .max(1.0);
                    job.wrap.max_rows = (rect.height() / row_height).floor().max(1.0) as usize;
                }
            }
            job.append(&caption, number(&style["textIndent"], 0.0), format);
            let galley = painter.layout_job(job);
            let mut at = align.pos_in_rect(&rect) + offset;
            at.x -= match x {
                Align::Min => 0.0,
                Align::Center => galley.size().x * 0.5,
                Align::Max => galley.size().x,
            };
            at.y -= match y {
                Align::Min => 0.0,
                Align::Center => galley.size().y * 0.5,
                Align::Max => galley.size().y,
            };
            let blur = number(&style["glowBlur"], -1.0).clamp(-1.0, 40.0);
            let glow = color(style["glowColor"].as_str().unwrap_or("transparent"));
            if blur >= 0.0 && glow.a() > 0 {
                let offset = vec2(
                    number(&style["glowOffset"][0], 0.0),
                    number(&style["glowOffset"][1], 0.0),
                );
                if blur > 0.0 {
                    for (radius, alpha) in [(blur * 0.35, 0.1), (blur * 0.7, 0.06)] {
                        for direction in [
                            vec2(1.0, 0.0),
                            vec2(-1.0, 0.0),
                            vec2(0.0, 1.0),
                            vec2(0.0, -1.0),
                            vec2(0.707, 0.707),
                            vec2(-0.707, 0.707),
                            vec2(0.707, -0.707),
                            vec2(-0.707, -0.707),
                        ] {
                            painter.galley_with_override_text_color(
                                at + offset + direction * radius,
                                galley.clone(),
                                glow.gamma_multiply(alpha),
                            );
                        }
                    }
                }
                painter.galley_with_override_text_color(at + offset, galley.clone(), glow);
            }
            if style["fontBold"] == true {
                painter.galley(at + vec2(0.4, 0.0), galley.clone(), tint);
            }
            painter.galley(at, galley, tint);
        } else {
            painter.text(
                align.pos_in_rect(&rect) + offset,
                align,
                caption,
                FontId::proportional(size),
                tint,
            );
        }
    }
}

fn table_label(painter: &Painter, rect: Rect, value: &str, align: &Value, size: f32, tint: &str) {
    let (position, anchor) = match align.as_str() {
        Some("left") => (
            pos2(rect.left() + 8.0, rect.center().y),
            Align2::LEFT_CENTER,
        ),
        Some("right") => (
            pos2(rect.right() - 8.0, rect.center().y),
            Align2::RIGHT_CENTER,
        ),
        _ => (rect.center(), Align2::CENTER_CENTER),
    };
    painter.with_clip_rect(rect).text(
        position,
        anchor,
        value,
        FontId::proportional(size.max(1.0)),
        color(tint),
    );
}

fn table_line(painter: &Painter, from: Pos2, to: Pos2, style: &Value) {
    let width = number(&style["width"], 0.0);
    if width > 0.0 {
        painter.line_segment(
            [from, to],
            Stroke::new(
                width,
                color(style["color"].as_str().unwrap_or("transparent")),
            ),
        );
    }
}

impl BoardScene {
    pub(super) fn kit_texture(
        &self,
        painter: &Painter,
        rect: Rect,
        image: &Value,
        fit: &Value,
        patch: &Value,
    ) {
        let Some(texture) = image.as_str().and_then(|id| self.images.get(id)) else {
            return;
        };
        let size = texture.size_vec2();
        let uv = Rect::from_min_max(Pos2::ZERO, pos2(1.0, 1.0));
        if patch.is_object() {
            let fraction = |side| (number(&patch[side], 0.0) / 100.0).clamp(0.0, 0.49);
            let left = fraction("left");
            let right = fraction("right");
            let top = fraction("top");
            let bottom = fraction("bottom");
            let x = [0.0, left, 1.0 - right, 1.0];
            let y = [0.0, top, 1.0 - bottom, 1.0];
            let dx = (size.x * left).min(rect.width() * 0.49);
            let ex = (size.x * right).min(rect.width() * 0.49);
            let dy = (size.y * top).min(rect.height() * 0.49);
            let ey = (size.y * bottom).min(rect.height() * 0.49);
            let px = [rect.min.x, rect.min.x + dx, rect.max.x - ex, rect.max.x];
            let py = [rect.min.y, rect.min.y + dy, rect.max.y - ey, rect.max.y];
            for row in 0..3 {
                for column in 0..3 {
                    let target = Rect::from_min_max(
                        pos2(px[column], py[row]),
                        pos2(px[column + 1], py[row + 1]),
                    );
                    let part = Rect::from_min_max(
                        pos2(x[column], y[row]),
                        pos2(x[column + 1], y[row + 1]),
                    );
                    if target.is_positive() {
                        painter.image(texture.id(), target, part, Color32::WHITE);
                    }
                }
            }
            return;
        }
        if fit == "tile" {
            let columns = (rect.width() / size.x).ceil().clamp(1.0, 128.0) as usize;
            let rows = (rect.height() / size.y).ceil().clamp(1.0, 128.0) as usize;
            for row in 0..rows {
                for column in 0..columns {
                    let origin = rect.min + vec2(column as f32 * size.x, row as f32 * size.y);
                    let tile = Rect::from_min_size(origin, size).intersect(rect);
                    let partial = Rect::from_min_max(
                        Pos2::ZERO,
                        pos2(tile.width() / size.x, tile.height() / size.y),
                    );
                    painter.image(texture.id(), tile, partial, Color32::WHITE);
                }
            }
        } else {
            let target = if fit == "none" || fit == "center" {
                Rect::from_center_size(rect.center(), size.min(rect.size()))
            } else {
                rect
            };
            painter.image(texture.id(), target, uv, Color32::WHITE);
        }
    }

    fn kit_style_texture(&self, painter: &Painter, rect: Rect, style: &Value) {
        if style["fit"] == "none" && style.get("imageScale").is_some() {
            if let Some(texture) = style["image"].as_str().and_then(|id| self.images.get(id)) {
                let scale = (number(&style["imageScale"], 100.0) / 100.0).clamp(0.0, 10.0);
                let offset = vec2(
                    number(&style["imageOffset"][0], 0.0),
                    number(&style["imageOffset"][1], 0.0),
                );
                let target =
                    Rect::from_center_size(rect.center() + offset, texture.size_vec2() * scale);
                painter
                    .with_clip_rect(painter.clip_rect().intersect(rect))
                    .image(
                        texture.id(),
                        target,
                        Rect::from_min_max(Pos2::ZERO, pos2(1.0, 1.0)),
                        Color32::WHITE,
                    );
            }
        } else {
            self.kit_texture(
                painter,
                rect,
                &style["image"],
                &style["fit"],
                &style["ninePatch"],
            );
        }
    }

    pub(super) fn paint_kit_dropdown(&self, painter: &Painter, node: &BoardNode) -> bool {
        let dropdown = &node.data["__kitDropdown"];
        if !dropdown.is_object() {
            return false;
        }
        let header = Rect::from_min_size(
            Pos2::ZERO,
            vec2(
                node.width,
                number(&dropdown["headerHeight"], 30.0).clamp(0.0, node.height),
            ),
        );
        let style = &dropdown["header"];
        fill(painter, header, style);
        self.kit_texture(
            painter,
            header,
            &style["image"],
            &style["fit"],
            &style["ninePatch"],
        );
        let left = number(&dropdown["selectPadding"][0], 0.0).max(0.0);
        let right = number(&dropdown["selectPadding"][1], 0.0).max(0.0);
        let state = self.controls.get(&node.id);
        let value = state.map(|state| &state.value);
        let tree = dropdown["tree"].as_array();
        let label = |value: &str| {
            tree.and_then(|nodes| super::controls::dropdown_tree_label(nodes, value))
                .unwrap_or_else(|| value.to_owned())
        };
        let multiple = value.and_then(Value::as_array).map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .map(label)
                .collect::<Vec<_>>()
                .join(", ")
        });
        let single = value.and_then(Value::as_str).map(label);
        let caption = state
            .filter(|state| state.open && !state.search.is_empty())
            .map(|state| state.search.as_str())
            .or_else(|| {
                multiple
                    .as_deref()
                    .filter(|value| !value.is_empty())
                    .or(single.as_deref())
            })
            .unwrap_or(&node.widget.text);
        let caption_rect =
            Rect::from_min_max(header.min + vec2(left, 0.0), header.max - vec2(right, 0.0));
        text(
            &painter.with_clip_rect(header),
            caption_rect,
            style,
            caption,
        );
        if dropdown["icon"]
            .as_str()
            .is_some_and(|icon| !icon.is_empty())
        {
            let size = vec2(
                number(&dropdown["iconSize"][0], 20.0).max(0.0),
                number(&dropdown["iconSize"][1], 20.0).max(0.0),
            );
            let margin = number(&dropdown["iconMargin"], 0.0);
            let target = Rect::from_center_size(
                pos2(header.right() - margin - size.x / 2.0, header.center().y),
                size,
            );
            self.kit_texture(
                painter,
                target,
                &dropdown["icon"],
                &Value::Null,
                &Value::Null,
            );
        }
        true
    }

    pub(super) fn paint_kit_dropdown_popup(&self, painter: &Painter, node: &BoardNode) -> bool {
        let dropdown = &node.data["__kitDropdown"];
        if !dropdown.is_object() {
            return false;
        }
        let bounds = self.popup_rect(node);
        let popup = &dropdown["popup"];
        fill(painter, bounds, popup);
        self.kit_texture(
            painter,
            bounds,
            &popup["image"],
            &popup["fit"],
            &popup["ninePatch"],
        );
        let painter = painter.with_clip_rect(bounds);
        let options = self.dropdown_items(node);
        let visible = number(&dropdown["maxOptions"], 5.0).clamp(1.0, 500.0) as usize;
        let offset = self
            .controls
            .get(&node.id)
            .map_or(0, |state| state.popup_offset)
            .min(options.len().saturating_sub(visible));
        let value = self.controls.get(&node.id).map(|state| &state.value);
        let (top, horizontal, _) = super::controls::dropdown_padding(node);
        let height = super::controls::dropdown_row_height(node);
        let items = if options.is_empty() {
            vec![super::controls::DropdownItem {
                label: dropdown["noData"].as_str().unwrap_or("no data").to_owned(),
                value: String::new(),
                path: String::new(),
                depth: 0,
                branch: false,
                expanded: false,
            }]
        } else {
            options
        };
        for (position, item) in items.iter().skip(offset).take(visible).enumerate() {
            let row = Rect::from_min_size(
                bounds.min + vec2(horizontal, top + position as f32 * height),
                vec2((bounds.width() - horizontal * 2.0).max(0.0), height),
            );
            let selected = value.and_then(Value::as_array).map_or_else(
                || value.and_then(Value::as_str).unwrap_or(&node.widget.text) == item.value,
                |values| {
                    values
                        .iter()
                        .any(|value| value.as_str() == Some(item.value.as_str()))
                },
            );
            let style = if selected {
                &dropdown["selected"]
            } else {
                &dropdown["item"]
            };
            fill(&painter, row, style);
            self.kit_texture(
                &painter,
                row,
                &style["image"],
                &style["fit"],
                &style["ninePatch"],
            );
            let padding = number(&dropdown["leftPadding"], 10.0).max(0.0);
            let indent = if dropdown["tree"].is_array() {
                (item.depth + 1) as f32 * 16.0
            } else {
                0.0
            };
            if item.branch {
                let arrow = Rect::from_min_size(
                    row.min + vec2(padding + item.depth as f32 * 16.0, 0.0),
                    vec2(16.0, row.height()),
                );
                text(
                    &painter,
                    arrow,
                    style,
                    if item.expanded { "▾" } else { "▸" },
                );
            }
            let caption = Rect::from_min_max(
                row.min + vec2(padding + indent, 0.0),
                row.max - vec2(padding, 0.0),
            );
            text(&painter, caption, style, &item.label);
        }
        true
    }

    pub(super) fn paint_kit_table(
        &self,
        painter: &Painter,
        node: &BoardNode,
        pointer: Option<Pos2>,
    ) -> bool {
        let style = &node.data["__kitTable"];
        if !style.is_object() {
            return false;
        }
        let (columns, rows) = table_grid(node);
        if columns.is_empty() {
            return true;
        }
        let rect = node.rect();
        let painter = painter.with_clip_rect(rect);
        let (top, row_height, row_gap) = table_dimensions(node);
        let header_height = number(&style["headerHeight"], 30.0).clamp(0.0, rect.height());
        let header = Rect::from_min_size(rect.min, vec2(rect.width(), header_height));
        let columns_style = style["columns"].as_array().map_or(&[][..], Vec::as_slice);
        let width = |index: usize| {
            let col = columns_style.get(index).unwrap_or(&Value::Null);
            number(
                &col[if style["autoWidth"] == true {
                    "widthAuto"
                } else {
                    "width"
                }],
                100.0,
            )
            .max(0.0)
        };
        let total = (0..columns.len()).map(width).sum::<f32>();
        let factor = if style["autoWidth"] == true && total > 0.0 {
            rect.width() / total
        } else {
            1.0
        };
        let widths: Vec<f32> = (0..columns.len())
            .map(|index| width(index) * factor)
            .collect();
        if header_height > 0.0 {
            fill(&painter, header, &style["header"]);
            self.kit_texture(
                &painter,
                header,
                &style["header"]["image"],
                &style["header"]["fit"],
                &style["header"]["ninePatch"],
            );
            let mut x = rect.left();
            for (index, caption) in columns.iter().enumerate() {
                let cell =
                    Rect::from_min_size(pos2(x, rect.top()), vec2(widths[index], header_height));
                table_label(
                    &painter,
                    cell,
                    caption,
                    &style["header"]["align"],
                    number(&style["header"]["fontSize"], 14.0),
                    style["header"]["color"].as_str().unwrap_or("#cccccc"),
                );
                table_line(
                    &painter,
                    cell.right_top(),
                    cell.right_bottom(),
                    &style["headerVerticalLine"],
                );
                x += widths[index];
            }
            table_line(
                &painter,
                header.left_bottom(),
                header.right_bottom(),
                &style["headerHorizontalLine"],
            );
        }
        let selected = self
            .controls
            .get(&node.id)
            .and_then(|state| state.value["index"].as_u64())
            .map(|index| index as usize)
            .or_else(|| (style["firstSelected"] == true).then_some(0));
        let hovered = pointer.and_then(|point| kit_table_row(node, point));
        let count = number(&style["rowCount"], 5.0).clamp(1.0, 50.0) as usize;
        for (row_index, row) in rows.iter().take(count).enumerate() {
            let y = top + row_index as f32 * (row_height + row_gap);
            if y >= rect.bottom() {
                break;
            }
            let row_rect =
                Rect::from_min_size(pos2(rect.left(), y), vec2(rect.width(), row_height));
            let row_style = table_style_at(&style["rows"], row_index);
            fill(&painter, row_rect, row_style);
            self.kit_texture(
                &painter,
                row_rect,
                &row_style["image"],
                &row_style["fit"],
                &row_style["ninePatch"],
            );
            let active = if selected == Some(row_index) {
                Some("selected")
            } else if hovered == Some(row_index) {
                Some("hover")
            } else {
                None
            };
            if let Some(active) = active {
                if let Some(tint) = row_style[active].as_str() {
                    painter.rect_filled(row_rect, 0.0, color(tint));
                }
                self.kit_texture(
                    &painter,
                    row_rect,
                    &row_style[format!("{active}Image")],
                    &row_style["fit"],
                    &row_style["ninePatch"],
                );
            }
            let mut x = rect.left();
            for (column_index, caption) in row.iter().take(columns.len()).enumerate() {
                let cell = Rect::from_min_size(pos2(x, y), vec2(widths[column_index], row_height));
                let column = columns_style.get(column_index).unwrap_or(&Value::Null);
                let condition = table_condition(node, column, row).unwrap_or(&Value::Null);
                let fill = condition["fill"]
                    .as_str()
                    .or_else(|| column["fill"].as_str())
                    .unwrap_or("transparent");
                painter.rect_filled(cell, 0.0, color(fill));
                self.kit_texture(
                    &painter,
                    cell,
                    &column["image"],
                    &column["fit"],
                    &column["ninePatch"],
                );
                if let Some(icon) = column["icons"]
                    .as_array()
                    .and_then(|icons| icons.get(row_index))
                {
                    let icon_size = vec2(
                        number(&column["iconSize"][0], 20.0),
                        number(&column["iconSize"][1], 20.0),
                    );
                    self.kit_texture(
                        &painter,
                        Rect::from_center_size(cell.center(), icon_size),
                        icon,
                        &Value::Null,
                        &Value::Null,
                    );
                }
                let tint = condition["color"]
                    .as_str()
                    .or_else(|| column["color"].as_str())
                    .or_else(|| row_style["color"].as_str())
                    .unwrap_or("#d7e6ff");
                let size = number(
                    &condition["fontSize"],
                    number(&column["fontSize"], number(&row_style["fontSize"], 14.0)),
                );
                let align = if condition["align"].is_string() {
                    &condition["align"]
                } else {
                    &column["align"]
                };
                let content = condition["replacement"].as_str().unwrap_or(caption);
                let kind = column["type"].as_str().unwrap_or("text");
                if matches!(kind, "bar-chart" | "percentage-chart") {
                    let value = caption.parse::<f32>().unwrap_or(0.0);
                    let values = rows
                        .iter()
                        .filter_map(|row| row.get(column_index)?.parse::<f32>().ok());
                    let max = match column["chartMethod"].as_str() {
                        Some("max") => values.fold(0.0_f32, f32::max),
                        Some("sum") => values.sum(),
                        _ => 100.0,
                    };
                    let fraction = if max > 0.0 {
                        (value / max).clamp(0.0, 1.0)
                    } else {
                        0.0
                    };
                    let height = number(&column["chartWidth"], 5.0).clamp(1.0, cell.height());
                    let bar = Rect::from_center_size(
                        cell.center(),
                        vec2((cell.width() - 16.0).max(1.0), height),
                    );
                    let radius = number(&column["chartRadius"], 0.0).min(height / 2.0);
                    painter.rect_filled(
                        bar,
                        radius,
                        color(column["chartBackground"].as_str().unwrap_or("transparent")),
                    );
                    painter.rect_filled(
                        Rect::from_min_size(bar.min, vec2(bar.width() * fraction, bar.height())),
                        radius,
                        color(column["chartColor"].as_str().unwrap_or("#1890ff")),
                    );
                    if column["chartText"] == true {
                        table_label(&painter, cell, content, align, size, tint);
                    }
                } else {
                    table_label(
                        &painter,
                        cell,
                        &table_value(content, column),
                        align,
                        size,
                        tint,
                    );
                }
                table_line(
                    &painter,
                    cell.right_top(),
                    cell.right_bottom(),
                    &style["verticalLine"],
                );
                x += widths[column_index];
            }
            table_line(
                &painter,
                row_rect.left_bottom(),
                row_rect.right_bottom(),
                &style["horizontalLine"],
            );
        }
        true
    }

    pub(super) fn paint_kit_background(&self, painter: &Painter, node: &BoardNode) {
        let background = &node.data["__kitBackground"];
        if let Some(gradient) = KitGradient::read(&background["gradient"]) {
            gradient.rect(painter, node.rect(), node.widget.radius);
        } else {
            painter.rect_filled(
                node.rect(),
                node.widget.radius,
                color(&node.widget.background),
            );
        }
        self.kit_texture(
            painter,
            node.rect(),
            &background["image"],
            &background["fit"],
            &background["ninePatch"],
        );
    }

    pub(super) fn paint_kit_button(
        &self,
        painter: &Painter,
        node: &BoardNode,
        hovered: bool,
        now: f64,
    ) -> bool {
        let button = &node.data["__kitButton"];
        if !button.is_object() {
            return false;
        }
        let checked = self
            .controls
            .get(&node.id)
            .and_then(|state| state.value.as_bool())
            .unwrap_or(button["checked"] == true);
        let state = if self.pressed.as_ref() == Some(&node.id) && button["click"] == true {
            "click"
        } else if hovered && button["hover"] == true {
            "hover"
        } else if checked && button["select"] == true {
            "select"
        } else {
            "default"
        };
        let style = &button["styles"][state];
        let rect = node.rect();
        fill(painter, rect, style);
        self.kit_style_texture(painter, rect, style);
        if let Some(ripple) = self
            .controls
            .get(&node.id)
            .and_then(|state| state.ripple.as_ref())
        {
            let progress = ((now - ripple.start) / ripple.duration) as f32;
            if (0.0..1.0).contains(&progress) {
                let radius = [
                    rect.left_top(),
                    rect.right_top(),
                    rect.left_bottom(),
                    rect.right_bottom(),
                ]
                .into_iter()
                .map(|corner| corner.distance(ripple.center))
                .fold(0.0_f32, f32::max)
                    * (1.0 - (1.0 - progress).powi(2));
                let alpha = (64.0 * (1.0 - progress)).round() as u8;
                painter
                    .with_clip_rect(painter.clip_rect().intersect(rect))
                    .circle_filled(ripple.center, radius, Color32::from_white_alpha(alpha));
            }
        }
        text(painter, rect, style, &node.widget.text);
        true
    }

    pub(super) fn paint_kit_menu(
        &self,
        painter: &Painter,
        node: &BoardNode,
        pointer: Option<Pos2>,
    ) -> bool {
        let menu = &node.data["__kitMenu"];
        if !menu.is_object() {
            return false;
        }
        let items = node.options("items");
        let offset = self
            .controls
            .get(&node.id)
            .map_or(0, |state| state.menu_offset)
            .min(menu_max_offset(node, items.len()));
        let active = self
            .controls
            .get(&node.id)
            .and_then(|state| state.value.as_str());
        let default = menu["active"]
            .as_u64()
            .and_then(|index| usize::try_from(index).ok());
        let clipped = if menu["scroll"] == true || menu["overflow"] == "hidden" {
            painter.with_clip_rect(painter.clip_rect().intersect(node.rect()))
        } else {
            painter.clone()
        };
        for (index, item) in items.iter().enumerate() {
            if menu["scroll"] == true
                && (index < offset || index >= offset + menu_visible_count(node))
            {
                continue;
            }
            let (rect, angle) = menu_cell(node, index, items.len(), offset);
            let style_index = menu["styleIndexes"]
                .get(index)
                .and_then(Value::as_u64)
                .and_then(|value| usize::try_from(value).ok())
                .unwrap_or(index);
            let styles = menu["styles"]
                .get(style_index)
                .or_else(|| menu["styles"].get(0))
                .unwrap_or(&Value::Null);
            let selected = active.map_or(Some(index) == default, |current| current == item);
            let style = if selected && styles["selectedEnabled"] != false {
                &styles["selected"]
            } else if styles["hoverEnabled"] == true
                && pointer.is_some_and(|at| menu_contains(rect, angle, at))
            {
                &styles["hover"]
            } else {
                &styles["default"]
            };
            let paint_item = |target: &Painter| {
                fill(target, rect, style);
                self.kit_style_texture(target, rect, style);
                text(target, rect, style, item);
            };
            if angle.abs() < 0.000_01 {
                paint_item(&clipped);
            } else {
                let ctx = painter.ctx();
                let layer = egui::LayerId::new(
                    egui::Order::Middle,
                    egui::Id::new((&node.id, index, "menu-item")),
                );
                let temporary = Painter::new(ctx.clone(), layer, Rect::EVERYTHING);
                paint_item(&temporary);
                let list = ctx.graphics_mut(|layers| std::mem::take(layers.entry(layer)));
                let shapes = list.all_entries().cloned().collect();
                for primitive in ctx.tessellate(shapes, ctx.pixels_per_point()) {
                    if let egui::epaint::Primitive::Mesh(mesh) = primitive.primitive {
                        let mut mesh = super::raster::clip_mesh(&mesh, primitive.clip_rect);
                        mesh.rotate(egui::emath::Rot2::from_angle(angle), rect.center());
                        clipped.add(Shape::mesh(mesh));
                    }
                }
            }
        }
        if let Some((track, thumb)) = menu_scrollbar(node, items.len(), offset) {
            let background = color(
                menu["scrollbarBackground"]
                    .as_str()
                    .unwrap_or("transparent"),
            );
            let foreground = color(menu["scrollbarColor"].as_str().unwrap_or("#a5a5a5"));
            clipped.rect_filled(track, track.width().min(track.height()) / 2.0, background);
            clipped.rect_filled(thumb, thumb.width().min(thumb.height()) / 2.0, foreground);
        }
        true
    }
}

pub(super) fn menu_visible_count(node: &BoardNode) -> usize {
    (number(&node.data["__kitMenu"]["visibleCount"], 3.0) as usize).clamp(1, 30)
}

pub(super) fn menu_max_offset(node: &BoardNode, count: usize) -> usize {
    if node.data["__kitMenu"]["scroll"] == true {
        count.saturating_sub(menu_visible_count(node))
    } else {
        0
    }
}

pub(super) fn menu_scrollbar(
    node: &BoardNode,
    count: usize,
    offset: usize,
) -> Option<(Rect, Rect)> {
    let menu = &node.data["__kitMenu"];
    let max_offset = menu_max_offset(node, count);
    let size = number(&menu["scrollbarSize"], 6.0).max(0.0);
    if menu["scrollbar"] != true || max_offset == 0 || size <= 0.0 {
        return None;
    }
    let vertical = menu["vertical"] == true;
    let length = if vertical { node.height } else { node.width };
    let size = size.min(if vertical { node.width } else { node.height });
    let thumb_length =
        (length * menu_visible_count(node) as f32 / count as f32).clamp(size.min(length), length);
    let start = (length - thumb_length) * offset.min(max_offset) as f32 / max_offset as f32;
    let track = if vertical {
        Rect::from_min_size(pos2(node.width - size, 0.0), vec2(size, length))
    } else {
        Rect::from_min_size(pos2(0.0, node.height - size), vec2(length, size))
    };
    let thumb = if vertical {
        Rect::from_min_size(track.min + vec2(0.0, start), vec2(size, thumb_length))
    } else {
        Rect::from_min_size(track.min + vec2(start, 0.0), vec2(thumb_length, size))
    };
    Some((track, thumb))
}

fn menu_cell(node: &BoardNode, index: usize, count: usize, scroll_offset: usize) -> (Rect, f32) {
    let menu = &node.data["__kitMenu"];
    let scrolling = menu["scroll"] == true;
    let vertical = menu["vertical"] == true;
    let columns = if scrolling {
        if vertical {
            1
        } else {
            menu_visible_count(node)
        }
    } else {
        (number(&menu["columns"], count as f32) as usize).clamp(1, 30)
    };
    let rows = if scrolling {
        if vertical {
            menu_visible_count(node)
        } else {
            1
        }
    } else {
        (number(&menu["rows"], 1.0) as usize)
            .clamp(1, 30)
            .max(count.div_ceil(columns))
    };
    let gap = number(&menu["gap"], 0.0).max(0.0);
    let width = ((node.width - (columns - 1) as f32 * gap) / columns as f32).max(1.0);
    let height = ((node.height - (rows - 1) as f32 * gap) / rows as f32).max(1.0);
    let slot = index.saturating_sub(scroll_offset);
    let cell = Rect::from_min_size(
        if scrolling && vertical {
            pos2(0.0, slot as f32 * (height + gap))
        } else {
            pos2(
                (slot % columns) as f32 * (width + gap),
                (slot / columns) as f32 * (height + gap),
            )
        },
        vec2(width, height),
    );
    let layout = &menu["itemLayouts"][index];
    let offset = vec2(number(&layout["x"], 0.0), number(&layout["y"], 0.0));
    let size = vec2(
        number(&menu["itemSize"][0], width).max(1.0),
        number(&menu["itemSize"][1], height).max(1.0),
    );
    (
        Rect::from_center_size(cell.center() + offset, size),
        number(&layout["rotation"], 0.0).to_radians(),
    )
}

fn menu_contains(rect: Rect, angle: f32, point: Pos2) -> bool {
    let local = rect.center() + egui::emath::Rot2::from_angle(-angle) * (point - rect.center());
    rect.contains(local)
}

pub(super) fn kit_menu_item(
    node: &BoardNode,
    point: Pos2,
    offset: usize,
) -> Option<(usize, String)> {
    let items = node.options("items");
    let count = items.len();
    let menu = &node.data["__kitMenu"];
    if (menu["scroll"] == true || menu["overflow"] != "visible") && !node.rect().contains(point) {
        return None;
    }
    let offset = offset.min(menu_max_offset(node, count));
    if menu_scrollbar(node, count, offset).is_some_and(|(track, _)| track.contains(point)) {
        return None;
    }
    items.into_iter().enumerate().find(|(index, _)| {
        if menu["scroll"] == true
            && (*index < offset || *index >= offset + menu_visible_count(node))
        {
            return false;
        }
        let (rect, angle) = menu_cell(node, *index, count, offset);
        menu_contains(rect, angle, point)
    })
}

pub(super) fn kit_close_rect(node: &BoardNode) -> Option<Rect> {
    let close = &node.data["__kitClose"];
    if !close.is_object() {
        return None;
    }
    let size = number(&close["size"], 20.0).clamp(1.0, 120.0);
    Some(Rect::from_min_size(
        pos2(
            node.width - size - number(&close["x"], 0.0),
            number(&close["y"], 0.0),
        ),
        vec2(size, size),
    ))
}

fn paint_progress_rect(
    painter: &Painter,
    rect: Rect,
    bounds: Rect,
    radius: f32,
    gradient: Option<&KitGradient>,
    tint: Color32,
) {
    if let Some(gradient) = gradient {
        let mut path = Vec::new();
        rounded_rectangle(&mut path, rect, CornerRadiusF32::same(radius));
        gradient.paint(painter, &path, bounds);
    } else {
        painter.rect_filled(rect, radius, tint);
    }
}

#[derive(Clone, Copy)]
struct ProgressSegments {
    count: usize,
    gap: f32,
}

struct ProgressRectStyle<'a> {
    radius: f32,
    gradient: Option<&'a KitGradient>,
    tint: Color32,
}

fn paint_progress_rect_segments(
    painter: &Painter,
    rect: Rect,
    bounds: Rect,
    vertical: bool,
    portion: f32,
    segments: ProgressSegments,
    style: ProgressRectStyle<'_>,
) {
    let length = if vertical {
        rect.height()
    } else {
        rect.width()
    };
    let step = length / segments.count as f32;
    let gap = segments.gap.clamp(0.0, step * 0.9);
    for index in 0..segments.count {
        let from = index as f32 * step + gap * 0.5;
        let to = ((index + 1) as f32 * step - gap * 0.5).min(length * portion);
        if to <= from {
            continue;
        }
        let segment = if vertical {
            Rect::from_min_max(
                pos2(rect.left(), rect.bottom() - to),
                pos2(rect.right(), rect.bottom() - from),
            )
        } else {
            Rect::from_min_max(
                pos2(rect.left() + from, rect.top()),
                pos2(rect.left() + to, rect.bottom()),
            )
        };
        paint_progress_rect(
            painter,
            segment,
            bounds,
            style.radius,
            style.gradient,
            style.tint,
        );
    }
}

struct ProgressRing {
    center: Pos2,
    bounds: Rect,
    radius: f32,
    width: f32,
    start: f32,
    end: f32,
}

fn paint_progress_ring_segments(
    painter: &Painter,
    ring: &ProgressRing,
    portion: f32,
    segments: ProgressSegments,
    gradient: Option<&KitGradient>,
    tint: Color32,
) {
    let sweep = ring.end - ring.start;
    let step = sweep.abs() / segments.count as f32;
    let gap = (segments.gap / ring.radius).clamp(0.0, step * 0.9);
    let mut mesh = Mesh::default();
    for index in 0..segments.count {
        let from = index as f32 * step + gap * 0.5;
        let to = ((index + 1) as f32 * step - gap * 0.5).min(sweep.abs() * portion);
        if to <= from {
            continue;
        }
        let subdivisions = ((to - from) * 28.0).ceil().max(1.0) as usize;
        let base = mesh.vertices.len() as u32;
        for point in 0..=subdivisions {
            let angle = ring.start
                + sweep.signum() * egui::lerp(from..=to, point as f32 / subdivisions as f32);
            for side in [-0.5, 0.5] {
                let pos = ring.center
                    + vec2(angle.cos(), angle.sin()) * (ring.radius + ring.width * side).max(0.0);
                mesh.vertices.push(Vertex {
                    pos,
                    uv: WHITE_UV,
                    color: gradient.map_or(tint, |gradient| gradient.color_at(pos, ring.bounds)),
                });
            }
            if point < subdivisions {
                let index = base + point as u32 * 2;
                mesh.indices.extend_from_slice(&[
                    index,
                    index + 1,
                    index + 3,
                    index,
                    index + 3,
                    index + 2,
                ]);
            }
        }
    }
    if !mesh.is_empty() {
        painter.add(Shape::mesh(mesh));
    }
}

pub(super) fn paint_kit_progress(painter: &Painter, node: &BoardNode) -> bool {
    let progress = &node.data["__kitProgress"];
    if !progress.is_object() {
        return false;
    }
    let rect = node.rect();
    let percent = node.number("percent", 0.0).clamp(0.0, 100.0);
    let fraction = percent / 100.0;
    let tint = color(progress["color"].as_str().unwrap_or("#6cbcff"));
    let background = color(progress["background"].as_str().unwrap_or("#333333"));
    let shape = progress["shape"].as_str().unwrap_or("rect");
    let segmented = progress["fillShape"] == "burst";
    let segments = ProgressSegments {
        count: number(&progress["burstCount"], 20.0)
            .round()
            .clamp(1.0, 500.0) as usize,
        gap: number(&progress["burstGap"], 10.0).max(0.0),
    };
    let background_gradient = KitGradient::read(&progress["backgroundGradient"]);
    let fill_gradient = KitGradient::read(&progress["gradient"]);
    match shape {
        "ring" | "circle" | "round" => {
            let width = number(&progress["ring"], 8.0).clamp(1.0, 60.0);
            let radius = ((rect.width().min(rect.height()) - width) * 0.5).max(1.0);
            let start = number(&progress["angle"], -90.0).to_radians();
            let end = number(&progress["endAngle"], 270.0).to_radians();
            let ring = ProgressRing {
                center: rect.center(),
                bounds: rect,
                radius,
                width,
                start,
                end,
            };
            let path = |portion: f32| {
                (0..=80)
                    .map(|index| {
                        let angle = start + (end - start) * portion * index as f32 / 80.0;
                        rect.center() + vec2(angle.cos(), angle.sin()) * radius
                    })
                    .collect()
            };
            if segmented && progress["burstBackground"] == true || background_gradient.is_some() {
                let pieces = if segmented && progress["burstBackground"] == true {
                    segments
                } else {
                    ProgressSegments { count: 1, gap: 0.0 }
                };
                paint_progress_ring_segments(
                    painter,
                    &ring,
                    1.0,
                    pieces,
                    background_gradient.as_ref(),
                    background,
                );
            } else {
                painter.add(egui::Shape::line(path(1.0), Stroke::new(width, background)));
            }
            if fraction > 0.0 {
                if segmented || fill_gradient.is_some() {
                    let pieces = if segmented {
                        segments
                    } else {
                        ProgressSegments { count: 1, gap: 0.0 }
                    };
                    paint_progress_ring_segments(
                        painter,
                        &ring,
                        fraction,
                        pieces,
                        fill_gradient.as_ref(),
                        tint,
                    );
                    if !segmented && progress["ringType"] == "round" {
                        for angle in [start, start + (end - start) * fraction] {
                            let center = rect.center() + vec2(angle.cos(), angle.sin()) * radius;
                            let tint = fill_gradient
                                .as_ref()
                                .map_or(tint, |gradient| gradient.color_at(center, rect));
                            painter.circle_filled(center, width * 0.5, tint);
                        }
                    }
                } else {
                    painter.add(egui::Shape::line(path(fraction), Stroke::new(width, tint)));
                }
            }
        }
        _ => {
            let radius = number(&progress["radius"], 4.0);
            if segmented && progress["burstBackground"] == true {
                paint_progress_rect_segments(
                    painter,
                    rect,
                    rect,
                    shape == "column",
                    1.0,
                    segments,
                    ProgressRectStyle {
                        radius,
                        gradient: background_gradient.as_ref(),
                        tint: background,
                    },
                );
            } else {
                paint_progress_rect(
                    painter,
                    rect,
                    rect,
                    radius,
                    background_gradient.as_ref(),
                    background,
                );
            }
            if fraction > 0.0 {
                let fill = if shape == "column" {
                    Rect::from_min_max(
                        pos2(rect.left(), rect.bottom() - rect.height() * fraction),
                        rect.max,
                    )
                } else {
                    Rect::from_min_size(rect.min, vec2(rect.width() * fraction, rect.height()))
                };
                if segmented {
                    paint_progress_rect_segments(
                        painter,
                        rect,
                        fill,
                        shape == "column",
                        fraction,
                        segments,
                        ProgressRectStyle {
                            radius,
                            gradient: fill_gradient.as_ref(),
                            tint,
                        },
                    );
                } else {
                    paint_progress_rect(painter, fill, fill, radius, fill_gradient.as_ref(), tint);
                }
            }
        }
    }
    if progress["label"] == true {
        let tint = color(progress["labelColor"].as_str().unwrap_or("#ffffff"));
        let size = number(&progress["labelSize"], 16.0).clamp(1.0, 120.0);
        let (position, alignment) = match (shape, progress["labelPosition"].as_str()) {
            (_, Some("top")) => (pos2(rect.center().x, rect.top()), Align2::CENTER_TOP),
            ("column", Some("outside")) => (
                pos2(rect.center().x, rect.bottom() - rect.height() * fraction),
                Align2::CENTER_BOTTOM,
            ),
            ("rect", Some("outside")) => (
                pos2(rect.left() + rect.width() * fraction, rect.center().y),
                Align2::LEFT_CENTER,
            ),
            _ => (rect.center(), Align2::CENTER_CENTER),
        };
        let offset = vec2(
            number(&progress["labelOffset"][0], 0.0),
            number(&progress["labelOffset"][1], 0.0),
        );
        painter.text(
            position + offset,
            alignment,
            progress["labelText"]
                .as_str()
                .map_or_else(|| format!("{percent:.0}%"), str::to_owned),
            FontId::proportional(size),
            tint,
        );
    }
    true
}

struct ClockParts {
    year: i64,
    month: u32,
    day: u32,
    hour: u32,
    minute: u32,
    second: u32,
    weekday: usize,
}

fn clock_parts(clock: &Clock, zone: &str) -> Option<ClockParts> {
    // The editor exposes fixed-offset Etc/GMT zones, whose signs follow POSIX
    // convention: Etc/GMT-8 is UTC+8.
    let suffix = zone.strip_prefix("Etc/GMT")?;
    let hours = if suffix.is_empty() {
        0
    } else {
        suffix.parse::<i64>().ok()?
    };
    if !(-12..=12).contains(&hours) || !clock.now.is_finite() || clock.now.abs() > 8.64e15 {
        return None;
    }
    let seconds = (clock.now / 1000.0).floor() as i64 - hours * 3600;
    let days = seconds.div_euclid(86_400);
    let day_seconds = seconds.rem_euclid(86_400);
    // Convert days since the Unix epoch to a proleptic Gregorian date.
    let shifted = days + 719_468;
    let era = shifted.div_euclid(146_097);
    let day_of_era = shifted - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_index + 2) / 5 + 1;
    let month = month_index + if month_index < 10 { 3 } else { -9 };
    Some(ClockParts {
        year: year + i64::from(month <= 2),
        month: month as u32,
        day: day as u32,
        hour: (day_seconds / 3600) as u32,
        minute: (day_seconds % 3600 / 60) as u32,
        second: (day_seconds % 60) as u32,
        weekday: (days + 4).rem_euclid(7) as usize,
    })
}

pub(super) fn kit_clock_text(clock: &Clock, options: &Value) -> String {
    let mut parts = clock.time.split(':');
    let local = ClockParts {
        year: i64::from(clock.year),
        month: clock.month,
        day: clock.day,
        hour: parts
            .next()
            .and_then(|value| value.parse().ok())
            .unwrap_or(0),
        minute: parts
            .next()
            .and_then(|value| value.parse().ok())
            .unwrap_or(0),
        second: parts
            .next()
            .and_then(|value| value.parse().ok())
            .unwrap_or(0),
        weekday: (clock.first_weekday + clock.day.saturating_sub(1)) as usize % 7,
    };
    let zoned = options["timeZone"]
        .as_str()
        .and_then(|zone| clock_parts(clock, zone));
    let date = zoned.as_ref().unwrap_or(&local);
    let selected = options["timeFormat"].as_str().unwrap_or("HH:mm:ss");
    let mut remaining = if selected == "customise" {
        options["timeCustom"].as_str().unwrap_or("")
    } else {
        selected
    };
    let hour12 = (date.hour + 11) % 12 + 1;
    let values = [
        ("YYYY", format!("{:04}", date.year)),
        ("YY", format!("{:02}", date.year.rem_euclid(100))),
        ("MM", format!("{:02}", date.month)),
        ("M", date.month.to_string()),
        ("DD", format!("{:02}", date.day)),
        ("D", date.day.to_string()),
        ("HH", format!("{:02}", date.hour)),
        ("H", date.hour.to_string()),
        ("hh", format!("{hour12:02}")),
        ("h", hour12.to_string()),
        ("mm", format!("{:02}", date.minute)),
        ("m", date.minute.to_string()),
        ("ss", format!("{:02}", date.second)),
        ("s", date.second.to_string()),
    ];
    let mut result = String::new();
    while !remaining.is_empty() {
        if let Some(literal) = remaining.strip_prefix('[')
            && let Some(end) = literal.find(']')
        {
            result.push_str(&literal[..end]);
            remaining = &literal[end + 1..];
            continue;
        }
        if let Some((token, value)) = values
            .iter()
            .find(|(token, _)| remaining.starts_with(token))
        {
            result.push_str(value);
            remaining = &remaining[token.len()..];
        } else if let Some(character) = remaining.chars().next() {
            result.push(character);
            remaining = &remaining[character.len_utf8()..];
        }
    }
    if options["weekday"] == true {
        if !result.is_empty() {
            result.push(' ');
        }
        result.push_str(
            [
                "星期日",
                "星期一",
                "星期二",
                "星期三",
                "星期四",
                "星期五",
                "星期六",
            ][date.weekday],
        );
    }
    result
}

#[cfg(test)]
mod clock_tests {
    use super::kit_clock_text;
    use crate::board::Clock;
    use serde_json::json;

    #[test]
    fn fixed_time_zones_cross_day_month_and_year_boundaries() {
        let clock = Clock {
            now: 1_709_249_400_000.0,
            ..Clock::default()
        };
        let options =
            json!({"timeFormat":"YYYY-MM-DD HH:mm:ss", "timeZone":"Etc/GMT-8", "weekday":true});
        assert_eq!(
            kit_clock_text(&clock, &options),
            "2024-03-01 07:30:00 星期五"
        );
        let options =
            json!({"timeFormat":"YYYY-MM-DD HH:mm:ss", "timeZone":"Etc/GMT+5", "weekday":true});
        assert_eq!(
            kit_clock_text(&clock, &options),
            "2024-02-29 18:30:00 星期四"
        );
        let clock = Clock {
            now: 0.0,
            ..Clock::default()
        };
        let options =
            json!({"timeFormat":"YYYY-MM-DD HH:mm:ss", "timeZone":"Etc/GMT+12", "weekday":true});
        assert_eq!(
            kit_clock_text(&clock, &options),
            "1969-12-31 12:00:00 星期三"
        );
    }

    #[test]
    fn custom_format_is_used_only_when_selected_and_may_contain_literals() {
        let clock = Clock {
            now: 1_709_249_400_000.0,
            ..Clock::default()
        };
        let fixed = json!({"timeFormat":"HH:mm:ss", "timeCustom":"[固定]", "timeZone":"Etc/GMT-8"});
        assert_eq!(kit_clock_text(&clock, &fixed), "07:30:00");
        let custom =
            json!({"timeFormat":"customise", "timeCustom":"[时间] h:mm", "timeZone":"Etc/GMT+5"});
        assert_eq!(kit_clock_text(&clock, &custom), "时间 6:30");
        let weekday = json!({"timeFormat":"", "timeZone":"Etc/GMT-8", "weekday":true});
        assert_eq!(kit_clock_text(&clock, &weekday), "星期五");
    }
}
