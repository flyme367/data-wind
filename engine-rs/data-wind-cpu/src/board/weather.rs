use std::sync::Arc;

use egui::text::LayoutJob;
use egui::{Color32, FontId, Galley, Painter, Rect, Stroke, TextFormat, Vec2, vec2};
use serde_json::Value;

use super::{BoardNode, BoardScene, color, number};

fn offset(value: &Value) -> Vec2 {
    vec2(number(&value[0], 0.0), number(&value[1], 0.0))
}

fn font(style: &Value) -> Option<TextFormat> {
    let size = number(&style["size"], 30.0).clamp(0.0, 512.0);
    if size == 0.0 {
        return None;
    }
    let tint = color(style["color"].as_str().unwrap_or("#ffffff"));
    let family = style["family"].as_str().unwrap_or("").to_ascii_lowercase();
    Some(TextFormat {
        font_id: if family.contains("mono") || family.contains("courier") {
            FontId::monospace(size)
        } else {
            FontId::proportional(size)
        },
        color: tint,
        italics: style["italic"] == true,
        underline: if style["underline"] == true {
            Stroke::new(1.0, tint)
        } else {
            Stroke::NONE
        },
        strikethrough: if style["strike"] == true {
            Stroke::new(1.0, tint)
        } else {
            Stroke::NONE
        },
        ..Default::default()
    })
}

struct WeatherLabel {
    galley: Arc<Galley>,
    offset: Vec2,
    bold: bool,
}

impl WeatherLabel {
    fn new(painter: &Painter, value: &Value) -> Option<Self> {
        let text = value["value"].as_str()?;
        let mut job = LayoutJob::default();
        if let Some(format) = font(&value["font"]) {
            job.append(text, 0.0, format);
        }
        if let Some(unit) = value["unit"].as_str()
            && let Some(format) = font(&value["unitFont"])
        {
            job.append(unit, 0.0, format);
        }
        if job.text.is_empty() {
            return None;
        }
        Some(Self {
            galley: painter.layout_job(job),
            offset: offset(&value["offset"]),
            bold: value["font"]["bold"] == true,
        })
    }
}

fn paint_labels(painter: &Painter, weather: &Value, bounds: Rect) {
    let mut labels: Vec<_> = ["name", "temperature", "wind"]
        .iter()
        .filter_map(|&part| WeatherLabel::new(painter, &weather[part]))
        .collect();
    if weather["reverse"] == true {
        labels.reverse();
    }
    let column = weather["column"] == true;
    let length = |size: Vec2| if column { size.y } else { size.x };
    let total = labels
        .iter()
        .map(|label| length(label.galley.size()))
        .sum::<f32>();
    let space = (length(bounds.size()) - total).max(0.0);
    let gap = if labels.len() > 1 {
        space / (labels.len() - 1) as f32
    } else {
        0.0
    };
    let mut next = if labels.len() == 1 || column {
        space / 2.0
    } else {
        0.0
    };
    for label in labels {
        let size = label.galley.size();
        let cross_space = (bounds.width() - size.x).max(0.0);
        let cross = match weather["align"].as_str() {
            Some("flex-start") => 0.0,
            Some("flex-end") => cross_space,
            _ => cross_space / 2.0,
        };
        let at = bounds.min
            + label.offset
            + if column {
                vec2(cross, next)
            } else {
                vec2(next, (bounds.height() - size.y).max(0.0) / 2.0)
            };
        if label.bold {
            painter.galley(at + vec2(0.4, 0.0), label.galley.clone(), Color32::WHITE);
        }
        painter.galley(at, label.galley, Color32::WHITE);
        next += length(size) + if column { 0.0 } else { gap };
    }
}

fn paint_weather_symbol(painter: &Painter, icon: Rect, condition: &str) {
    let size = icon.width();
    let at = |x, y| icon.min + vec2(x, y) * size;
    let sun = color("#f5c452");
    let cloud = color("#c5d6e8");
    let drops = color("#49bbfc");
    if condition == "晴" || condition == "多云" {
        let center = if condition == "晴" {
            icon.center()
        } else {
            at(0.35, 0.36)
        };
        painter.circle_filled(center, size * 0.17, sun);
        for i in 0..8 {
            let angle = i as f32 * std::f32::consts::TAU / 8.0;
            let ray = vec2(angle.cos(), angle.sin()) * size;
            painter.line_segment(
                [center + ray * 0.23, center + ray * 0.31],
                Stroke::new(size * 0.04, sun),
            );
        }
        if condition == "晴" {
            return;
        }
    }
    if matches!(
        condition,
        "雾" | "霾" | "扬沙" | "浮尘" | "沙尘暴" | "微风" | "大风" | "风暴" | "热带风暴"
    ) {
        for (i, y) in [0.32, 0.50, 0.68].into_iter().enumerate() {
            let start = if i == 1 { 0.15 } else { 0.26 };
            painter.line_segment(
                [at(start, y), at(1.0 - start, y)],
                Stroke::new(size * 0.05, cloud),
            );
        }
        return;
    }
    if condition.is_empty() {
        return;
    }
    for (x, y, radius) in [(0.34, 0.47, 0.15), (0.52, 0.37, 0.19), (0.69, 0.48, 0.15)] {
        painter.circle_filled(at(x, y), size * radius, cloud);
    }
    painter.rect_filled(
        Rect::from_min_max(at(0.34, 0.48), at(0.69, 0.63)),
        0.0,
        cloud,
    );
    if condition.contains('雪') || condition == "冰雹" {
        for x in [0.36, 0.52, 0.68] {
            painter.circle_filled(at(x, 0.77), size * 0.037, cloud);
        }
    } else if condition.contains('雨') {
        for x in [0.36, 0.52, 0.68] {
            painter.line_segment(
                [at(x, 0.70), at(x - 0.05, 0.84)],
                Stroke::new(size * 0.05, drops),
            );
        }
    }
}

impl BoardScene {
    pub(super) fn paint_kit_weather(&self, painter: &Painter, node: &BoardNode) -> bool {
        let weather = &node.data["__kitWeather"];
        if !weather.is_object() {
            return false;
        }
        let mut text_bounds = node.rect();
        let icon = &weather["icon"];
        let size = number(&icon["size"], 0.0).clamp(0.0, 2048.0);
        if size > 0.0 {
            let stacked = icon["position"] == "column";
            let center = if stacked {
                text_bounds.center_top() + vec2(0.0, size / 2.0)
            } else {
                text_bounds.left_center() + vec2(size / 2.0, 0.0)
            };
            let image_bounds =
                Rect::from_center_size(center + offset(&icon["offset"]), vec2(size, size));
            painter.rect_filled(
                image_bounds,
                0.0,
                color(icon["fill"].as_str().unwrap_or("transparent")),
            );
            let image = &icon["image"];
            if image
                .as_str()
                .is_some_and(|id| self.images.contains_key(id))
            {
                self.kit_texture(painter, image_bounds, image, &Value::Null, &Value::Null);
            } else {
                paint_weather_symbol(
                    painter,
                    image_bounds,
                    icon["condition"].as_str().unwrap_or(""),
                );
            }
            if stacked {
                text_bounds.min.y = (text_bounds.min.y + size).min(text_bounds.max.y);
            } else {
                text_bounds.min.x = (text_bounds.min.x + size).min(text_bounds.max.x);
            }
        }
        paint_labels(painter, weather, text_bounds);
        true
    }
}
