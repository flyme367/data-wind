use egui::{
    Align2, Color32, FontId, Painter, Pos2, Rect, Stroke, TextFormat, pos2, text::LayoutJob, vec2,
};

use super::{BoardNode, line, number, option_bool, option_color, option_number};

#[derive(Clone, Copy)]
pub(super) struct Scale {
    pub min: f32,
    pub max: f32,
    pub custom: bool,
}

impl Scale {
    pub fn automatic(values: impl IntoIterator<Item = f32>) -> Self {
        let (min, max) = values
            .into_iter()
            .filter(|value| value.is_finite())
            .fold((0.0_f32, 0.0_f32), |(min, max), value| {
                (min.min(value), max.max(value))
            });
        if min < max {
            Self {
                min,
                max,
                custom: false,
            }
        } else {
            Self::from_limit(1.0)
        }
    }

    pub fn from_limit(max: f32) -> Self {
        Self {
            min: 0.0,
            max,
            custom: false,
        }
    }

    pub fn configured(self, node: &BoardNode, mode: &str, min: &str, max: &str) -> Self {
        if node.data["chart"][mode] != "custom" {
            return self;
        }
        let min = number(&node.data["chart"][min], 0.0);
        let max = number(&node.data["chart"][max], 100.0);
        if min < max {
            Self {
                min,
                max,
                custom: true,
            }
        } else {
            self
        }
    }

    pub fn fraction(self, value: f32) -> f32 {
        let fraction =
            (f64::from(value) - f64::from(self.min)) / (f64::from(self.max) - f64::from(self.min));
        fraction.clamp(-100_000.0, 100_000.0) as f32
    }

    pub fn at(self, fraction: f32) -> f32 {
        (f64::from(self.min) + (f64::from(self.max) - f64::from(self.min)) * f64::from(fraction))
            as f32
    }

    pub fn y(self, plot: Rect, value: f32) -> f32 {
        plot.bottom() - self.fraction(value) * plot.height()
    }

    pub fn contains(self, value: f32) -> bool {
        (self.min..=self.max).contains(&value)
    }
}

fn tick_fractions(scale: Scale, mode: &str, interval: f32) -> Vec<f32> {
    let automatic = || vec![0.0, 1.0 / 3.0, 2.0 / 3.0, 1.0];
    if !scale.custom || !interval.is_finite() || interval <= 0.0 {
        return automatic();
    }
    if mode == "number" {
        let count = interval.round().clamp(1.0, 100.0) as usize;
        return (0..=count)
            .map(|index| index as f32 / count as f32)
            .collect();
    }
    if mode != "value" {
        return automatic();
    }
    let range = f64::from(scale.max) - f64::from(scale.min);
    let steps = range / f64::from(interval);
    let stride = (steps / 100.0).ceil().max(1.0);
    let count = (steps / stride + 1e-6).floor().min(100.0) as usize;
    (0..=count)
        .map(|index| (index as f64 * stride / steps).min(1.0) as f32)
        .collect()
}

pub(super) fn ticks(scale: Scale, node: &BoardNode, mode: &str, interval: &str) -> Vec<f32> {
    let mode = node.data["chart"][mode].as_str().unwrap_or("auto");
    tick_fractions(
        scale,
        mode,
        number(
            &node.data["chart"][interval],
            if mode == "number" { 3.0 } else { 50.0 },
        ),
    )
}

fn formatted_value(
    value: f32,
    decimals: usize,
    pad: bool,
    scale: &str,
    percent: bool,
    already_percent: bool,
) -> String {
    let (divisor, unit) = match scale {
        "3" => (1_000.0, "K"),
        "4" => (10_000.0, "万"),
        "5" => (100_000.0, "十万"),
        "6" => (1_000_000.0, "百万"),
        "7" => (10_000_000.0, "千万"),
        "8" => (100_000_000.0, "亿"),
        _ => (1.0, ""),
    };
    let scaled = (if percent && !already_percent {
        value * 100.0
    } else {
        value
    }) / divisor;
    let formatted = format!("{scaled:.decimals$}");
    let text = if decimals > 0 && !pad {
        formatted.trim_end_matches('0').trim_end_matches('.')
    } else {
        &formatted
    };
    format!("{text}{unit}{}", if percent { "%" } else { "" })
}

pub(super) fn value(node: &BoardNode, x: bool, value: f32, percent: bool) -> String {
    let suffix = if x { "X" } else { "Y" };
    let chart = &node.data["chart"];
    let scale_key = format!("axisValueScale{suffix}");
    let format_key = format!("axisValueFormat{suffix}");
    formatted_value(
        value,
        option_number(node, &format!("axisDecimals{suffix}"), 0.0, 0.0, 6.0) as usize,
        option_bool(node, &format!("axisPadZeros{suffix}"), false),
        chart[&scale_key].as_str().unwrap_or("0"),
        percent || chart[&format_key].as_str() == Some("percent"),
        percent,
    )
}

pub(super) fn category_fraction(node: &BoardNode, index: usize, count: usize) -> f32 {
    if matches!(
        node.widget.kind.as_str(),
        "line" | "lineSmooth" | "lineMulti" | "area" | "areaGradient" | "areaStacked"
    ) && !option_bool(node, "boundaryGap", true)
        && count > 1
    {
        index as f32 / (count - 1) as f32
    } else {
        (index as f32 + 0.5) / count.max(1) as f32
    }
}

pub(super) fn label(
    painter: &Painter,
    node: &BoardNode,
    rotation_key: &str,
    position: Pos2,
    align: Align2,
    text: impl Into<String>,
    style: (FontId, Color32),
) {
    let (mut font, tint) = style;
    let mut text = text.into();
    let angle = option_number(node, rotation_key, 0.0, -90.0, 90.0).to_radians();
    let suffix = match rotation_key {
        "axisLabelRotateX" => "X",
        "axisLabelRotateY" => "Y",
        "rightAxisRotate" => "Right",
        _ => "",
    };
    let key = |name: &str| format!("axis{name}{suffix}");
    let chart = &node.data["chart"];
    let family = chart[key("FontFamily")].as_str().unwrap_or("sans-serif");
    let mono = family.to_ascii_lowercase().contains("mono") || family.contains("Courier");
    if mono {
        font = FontId::monospace(font.size);
    }
    let bold = option_bool(node, &key("Bold"), false);
    let italic = option_bool(node, &key("Italic"), false);
    let underline = option_bool(node, &key("Underline"), false);
    let strike = option_bool(node, &key("Strike"), false);
    let overflow = option_bool(node, &key("LabelOverflow"), false);
    if overflow {
        let width = option_number(node, &key("LabelMaxWidth"), 100.0, 1.0, 1000.0);
        if painter
            .layout_no_wrap(text.clone(), font.clone(), tint)
            .size()
            .x
            > width
        {
            let characters: Vec<char> = text.chars().collect();
            let mut low = 0;
            let mut high = characters.len();
            while low < high {
                let middle = (low + high + 1) / 2;
                let candidate = format!("{}…", characters[..middle].iter().collect::<String>());
                if painter
                    .layout_no_wrap(candidate, font.clone(), tint)
                    .size()
                    .x
                    <= width
                {
                    low = middle;
                } else {
                    high = middle - 1;
                }
            }
            text = format!("{}…", characters[..low].iter().collect::<String>());
        }
    }
    let shadow = chart[key("LabelShadowColor")]
        .as_str()
        .map(super::color)
        .unwrap_or(Color32::TRANSPARENT);
    let blur = option_number(node, &key("LabelShadowBlur"), 0.0, 0.0, 100.0);
    let offsets = &chart[key("LabelShadowOffset")];
    let offset = vec2(number(&offsets[0], 0.0), number(&offsets[1], 0.0));
    let has_shadow = shadow.a() > 0 && (blur > 0.0 || offset != egui::Vec2::ZERO);
    if !bold && !italic && !underline && !strike && !has_shadow && angle == 0.0 {
        painter.text(position, align, text, font, tint);
    } else if !bold && !italic && !underline && !strike && !has_shadow {
        let galley = painter.layout_no_wrap(text, font, tint);
        let at = align.anchor_size(position, galley.size()).min;
        painter.add(
            egui::epaint::TextShape::new(at, galley, tint).with_angle_and_anchor(angle, align),
        );
    } else {
        let layout = |color: Color32| {
            let decoration = |enabled| {
                if enabled {
                    Stroke::new(1.0, color)
                } else {
                    Stroke::NONE
                }
            };
            let mut job = LayoutJob::default();
            job.append(
                &text,
                0.0,
                TextFormat {
                    font_id: font.clone(),
                    color,
                    italics: italic,
                    underline: decoration(underline),
                    strikethrough: decoration(strike),
                    ..Default::default()
                },
            );
            painter.layout_job(job)
        };
        let galley = layout(tint);
        let at = align.anchor_size(position, galley.size()).min;
        if has_shadow {
            let shadow = shadow.gamma_multiply(if blur > 0.0 { 0.13 } else { 0.6 });
            let glow = layout(shadow);
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
                    painter.add(
                        egui::epaint::TextShape::new(
                            at + offset + vec2(x * radius, y * radius),
                            glow.clone(),
                            shadow,
                        )
                        .with_angle_and_anchor(angle, align),
                    );
                }
            }
            painter.add(
                egui::epaint::TextShape::new(at + offset, glow, shadow)
                    .with_angle_and_anchor(angle, align),
            );
        }
        if bold {
            painter.add(
                egui::epaint::TextShape::new(at + vec2(0.4, 0.0), galley.clone(), tint)
                    .with_angle_and_anchor(angle, align),
            );
        }
        painter.add(
            egui::epaint::TextShape::new(at, galley, tint).with_angle_and_anchor(angle, align),
        );
    }
}

pub(super) fn stroke(
    painter: &Painter,
    start: Pos2,
    end: Pos2,
    width: f32,
    color: Color32,
    style: &str,
    pattern: (f32, f32),
) {
    if width <= 0.0 {
        return;
    }
    if !matches!(style, "dashed" | "dotted" | "dottedLine") {
        line(painter, start, end, width, color);
        return;
    }
    let length = start.distance(end);
    if length <= f32::EPSILON {
        return;
    }
    let direction = (end - start) / length;
    let segment = pattern.0.clamp(0.5, 100.0);
    let gap = pattern.1.clamp(0.5, 100.0);
    let mut offset = 0.0;
    while offset < length {
        line(
            painter,
            start + direction * offset,
            start + direction * (offset + segment).min(length),
            width,
            color,
        );
        offset += segment + gap;
    }
}

pub(super) fn grid(painter: &Painter, node: &BoardNode, start: Pos2, end: Pos2, x: bool) {
    let suffix = if x { "X" } else { "Y" };
    let chart = &node.data["chart"];
    let style = chart[format!("gridStyle{suffix}")]
        .as_str()
        .unwrap_or("solid");
    let dash = option_number(node, &format!("gridDash{suffix}"), 4.0, 0.5, 100.0);
    stroke(
        painter,
        start,
        end,
        option_number(node, &format!("gridWidth{suffix}"), 1.0, 0.0, 20.0),
        option_color(node, &format!("gridColor{suffix}"), "#a4c4e31e"),
        style,
        (dash, dash),
    );
}

pub(super) fn paint_right(painter: &Painter, node: &BoardNode, plot: Rect, scale: Scale) {
    if !option_bool(node, "showRightAxis", true) {
        return;
    }
    let chart = &node.data["chart"];
    let ticks = ticks(scale, node, "rightAxisIntervalMode", "rightAxisInterval");
    if option_bool(node, "showRightGrid", false) {
        let dash = option_number(node, "rightGridDash", 4.0, 0.5, 100.0);
        for &fraction in &ticks {
            let y = plot.bottom() - plot.height() * fraction;
            stroke(
                painter,
                pos2(plot.left(), y),
                pos2(plot.right(), y),
                option_number(node, "rightGridWidth", 1.0, 0.0, 20.0),
                option_color(node, "rightGridColor", "#a4c4e31e"),
                chart["rightGridStyle"].as_str().unwrap_or("solid"),
                (dash, dash),
            );
        }
    }
    if option_bool(node, "showRightAxisName", false)
        && let Some(name) = chart["rightAxisName"]
            .as_str()
            .filter(|text| !text.is_empty())
    {
        let gap = option_number(node, "rightAxisNameGap", 15.0, -100.0, 200.0);
        let offset = option_number(node, "rightAxisNameOffset", 0.0, -100.0, 200.0);
        painter.text(
            plot.right_top() + vec2(offset, -gap),
            Align2::CENTER_BOTTOM,
            name,
            FontId::proportional(option_number(
                node,
                "rightAxisNameFontSize",
                12.0,
                6.0,
                48.0,
            )),
            option_color(node, "rightAxisNameColor", "#90acc1"),
        );
    }
    if option_bool(node, "showRightAxisLine", true) {
        stroke(
            painter,
            plot.right_bottom(),
            plot.right_top(),
            option_number(node, "rightAxisLineWidth", 1.0, 0.0, 20.0),
            option_color(node, "rightAxisLineColor", "#cccccc"),
            chart["rightAxisLineStyle"].as_str().unwrap_or("solid"),
            (4.0, 3.0),
        );
    }
    let show_ticks = option_bool(node, "showRightAxisTicks", true);
    let tick_length = option_number(node, "rightAxisTickLength", 5.0, 0.0, 50.0);
    let tick_width = option_number(node, "rightAxisTickWidth", 2.0, 0.0, 20.0);
    let tick_color = option_color(node, "rightAxisTickColor", "#cccccc");
    let show_labels = option_bool(node, "showRightAxisLabel", true);
    for &fraction in &ticks {
        let point = pos2(plot.right(), plot.bottom() - plot.height() * fraction);
        if show_ticks && tick_length > 0.0 && tick_width > 0.0 {
            line(
                painter,
                point,
                point + vec2(tick_length, 0.0),
                tick_width,
                tick_color,
            );
        }
        if show_labels {
            let text = formatted_value(
                scale.at(fraction),
                option_number(node, "rightAxisDecimals", 0.0, 0.0, 6.0) as usize,
                option_bool(node, "rightAxisPadZeros", false),
                chart["rightAxisValueScale"].as_str().unwrap_or("0"),
                chart["rightAxisValueFormat"] == "percent",
                false,
            );
            label(
                painter,
                node,
                "rightAxisRotate",
                point
                    + vec2(
                        option_number(node, "rightLabelOffset", 10.0, 0.0, 100.0),
                        0.0,
                    ),
                Align2::LEFT_CENTER,
                text,
                (
                    FontId::proportional(option_number(node, "rightAxisFontSize", 10.0, 6.0, 36.0)),
                    option_color(node, "rightAxisColor", "#90acc1"),
                ),
            );
        }
    }
}

pub(super) fn paint(
    painter: &Painter,
    node: &BoardNode,
    plot: Rect,
    horizontal: bool,
    n: usize,
    numeric_ticks: &[f32],
) {
    for x in [true, false] {
        let suffix = if x { "X" } else { "Y" };
        if !option_bool(node, if x { "showXAxis" } else { "showYAxis" }, true) {
            continue;
        }
        let (start, end) = if x {
            (plot.left_bottom(), plot.right_bottom())
        } else {
            (plot.left_bottom(), plot.left_top())
        };
        if option_bool(node, &format!("showAxisName{suffix}"), false) {
            let key = format!("axisName{suffix}");
            if let Some(name) = node.data["chart"][&key]
                .as_str()
                .filter(|text| !text.is_empty())
            {
                let gap = option_number(
                    node,
                    &format!("axisNameGap{suffix}"),
                    if x { 0.0 } else { 15.0 },
                    -100.0,
                    200.0,
                );
                let (position, align) = if x {
                    (plot.right_bottom() + vec2(gap, 0.0), Align2::LEFT_CENTER)
                } else {
                    (plot.left_top() - vec2(0.0, gap), Align2::CENTER_BOTTOM)
                };
                painter.text(
                    position,
                    align,
                    name,
                    FontId::proportional(option_number(
                        node,
                        &format!("axisNameFontSize{suffix}"),
                        12.0,
                        6.0,
                        48.0,
                    )),
                    option_color(node, &format!("axisNameColor{suffix}"), "#90acc1"),
                );
            }
        }
        if option_bool(node, &format!("showAxisLine{suffix}"), false) {
            let style_key = format!("axisLineStyle{suffix}");
            let style = node.data["chart"][&style_key].as_str().unwrap_or("solid");
            let dash = &node.data["chart"][format!("axisLineDash{suffix}")];
            let pattern = if style == "dottedLine" {
                (number(&dash[0], 2.0), number(&dash[1], 5.0))
            } else {
                (4.0, 3.0)
            };
            stroke(
                painter,
                start,
                end,
                option_number(node, &format!("axisLineWidth{suffix}"), 1.0, 0.0, 20.0),
                option_color(node, &format!("axisLineColor{suffix}"), "#cccccc"),
                style,
                pattern,
            );
        }
        if !option_bool(node, &format!("showAxisTicks{suffix}"), false) {
            continue;
        }
        let category = x != horizontal;
        let count = if category { n } else { numeric_ticks.len() };
        let length = option_number(node, &format!("axisTickLength{suffix}"), 5.0, 0.0, 50.0);
        let width = option_number(node, &format!("axisTickWidth{suffix}"), 2.0, 0.0, 20.0);
        let tint = option_color(node, &format!("axisTickColor{suffix}"), "#cccccc");
        for i in 0..count {
            let fraction = if category {
                category_fraction(node, i, count)
            } else {
                if x {
                    numeric_ticks[i]
                } else {
                    1.0 - numeric_ticks[i]
                }
            };
            let point = if x {
                pos2(plot.min.x + plot.width() * fraction, plot.max.y)
            } else {
                pos2(plot.min.x, plot.min.y + plot.height() * fraction)
            };
            let offset = if x {
                vec2(0.0, length)
            } else {
                vec2(-length, 0.0)
            };
            if width > 0.0 && length > 0.0 {
                line(painter, point, point + offset, width, tint);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{Scale, formatted_value, tick_fractions};

    #[test]
    fn custom_ticks_respect_value_or_count_and_bound_work() {
        let custom = Scale {
            min: -20.0,
            max: 80.0,
            custom: true,
        };
        assert_eq!(
            tick_fractions(custom, "value", 25.0),
            vec![0.0, 0.25, 0.5, 0.75, 1.0]
        );
        assert_eq!(tick_fractions(custom, "value", 40.0), vec![0.0, 0.4, 0.8]);
        assert_eq!(tick_fractions(custom, "number", 2.0), vec![0.0, 0.5, 1.0]);
        assert_eq!(tick_fractions(custom, "value", 0.0).len(), 4);
        assert_eq!(
            tick_fractions(
                Scale {
                    custom: false,
                    ..custom
                },
                "value",
                25.0
            )
            .len(),
            4
        );
        assert!(tick_fractions(custom, "value", 0.0001).len() <= 101);
    }

    #[test]
    fn numeric_axis_formatting_applies_scale_padding_and_percent() {
        assert_eq!(
            formatted_value(123_400.0, 2, false, "4", false, false),
            "12.34万"
        );
        assert_eq!(
            formatted_value(12_000.0, 2, true, "4", true, true),
            "1.20万%"
        );
        assert_eq!(
            formatted_value(12_000.0, 2, false, "4", false, false),
            "1.2万"
        );
        assert_eq!(formatted_value(54.4, 0, false, "0", false, false), "54");
        assert_eq!(formatted_value(0.124, 1, false, "0", true, false), "12.4%");
    }
}
