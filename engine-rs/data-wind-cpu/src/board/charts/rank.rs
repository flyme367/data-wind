use egui::{Color32, FontId, Painter, Rect, Shape, Stroke, TextureHandle, pos2, vec2};

use super::{BoardNode, Row, axis, option_bool, option_color, option_number};

#[derive(Debug, PartialEq)]
struct RankedValue {
    value: f64,
    rank: usize,
    visible: bool,
}

fn ranked_values(rows: &[Row], series: usize, display: &str, count: usize) -> Vec<RankedValue> {
    let totals: Vec<f64> = rows
        .iter()
        .map(|row| {
            row.values
                .iter()
                .take(series)
                .map(|value| f64::from(*value))
                .sum()
        })
        .collect();
    let mut order: Vec<usize> = (0..totals.len()).collect();
    order.sort_by(|&a, &b| totals[b].total_cmp(&totals[a]).then_with(|| a.cmp(&b)));
    totals
        .iter()
        .enumerate()
        .map(|(index, &value)| {
            let rank = 1 + totals.iter().filter(|&&other| other > value).count();
            let visible = match display {
                "max" => order.first().is_some_and(|&first| value == totals[first]),
                "min" => order.last().is_some_and(|&last| value == totals[last]),
                "max-and-min" => {
                    order.first().is_some_and(|&first| value == totals[first])
                        || order.last().is_some_and(|&last| value == totals[last])
                }
                "custom" => order.iter().take(count).any(|&selected| selected == index),
                _ => true,
            };
            RankedValue {
                value,
                rank,
                visible,
            }
        })
        .collect()
}

pub(super) fn paint(
    p: &Painter,
    node: &BoardNode,
    plot: Rect,
    rows: &[Row],
    series: usize,
    horizontal: bool,
    image: Option<&TextureHandle>,
) {
    if !option_bool(node, "showRanking", false) || rows.is_empty() {
        return;
    }
    let chart = &node.data["chart"];
    let display = chart["rankingDisplay"].as_str().unwrap_or("all");
    let count = option_number(node, "rankingCount", 3.0, 0.0, 30.0) as usize;
    let width = option_number(node, "rankingBackgroundWidth", 50.0, 0.0, 1000.0);
    let height = option_number(node, "rankingBackgroundHeight", 30.0, 0.0, 1000.0);
    let distance = option_number(node, "rankingDistance", 0.0, -500.0, 500.0);
    let offset = option_number(node, "rankingOffset", 0.0, -500.0, 500.0);
    let background = chart["rankingBackground"].as_str().unwrap_or("shape");
    let shape = chart["rankingBackgroundShape"].as_str().unwrap_or("rect");
    let background_color = option_color(node, "rankingBackgroundColor", "#ffffff00");
    let text_color = option_color(node, "rankingColor", "#ffffff");
    let size = option_number(node, "rankingFontSize", 12.0, 6.0, 96.0);
    let family = chart["rankingFontFamily"].as_str().unwrap_or("sans-serif");
    let font = if family.to_ascii_lowercase().contains("mono") || family.contains("Courier") {
        FontId::monospace(size)
    } else {
        FontId::proportional(size)
    };
    let decoration = |key| {
        if option_bool(node, key, false) {
            Stroke::new(1.0, text_color)
        } else {
            Stroke::NONE
        }
    };
    let format = egui::TextFormat {
        font_id: font,
        color: text_color,
        italics: option_bool(node, "rankingItalic", false),
        underline: decoration("rankingUnderline"),
        strikethrough: decoration("rankingStrike"),
        ..Default::default()
    };
    let template = chart["rankingTemplate"].as_str().unwrap_or("NO.{}");
    let use_value = chart["rankingFormat"].as_str() == Some("value-template");
    for (index, ranked) in ranked_values(rows, series, display, count)
        .iter()
        .enumerate()
    {
        if !ranked.visible {
            continue;
        }
        let center = if horizontal {
            pos2(
                plot.right() + distance + offset,
                plot.top() + plot.height() * (index as f32 + 0.5) / rows.len() as f32,
            )
        } else {
            pos2(
                plot.left() + plot.width() * axis::category_fraction(node, index, rows.len()),
                plot.top() - distance + offset,
            )
        };
        let bounds = Rect::from_center_size(center, vec2(width, height));
        if background == "image" {
            if let Some(texture) = image {
                p.image(
                    texture.id(),
                    bounds,
                    Rect::from_min_max(pos2(0.0, 0.0), pos2(1.0, 1.0)),
                    Color32::WHITE,
                );
            }
        } else {
            p.rect_filled(bounds, 0.0, background_color);
            if shape == "down-arrow-rect" {
                let arrow = width.min(height).min(10.0) / 2.0;
                p.add(Shape::convex_polygon(
                    vec![
                        pos2(center.x - arrow, bounds.bottom()),
                        pos2(center.x + arrow, bounds.bottom()),
                        pos2(center.x, bounds.bottom() + arrow),
                    ],
                    background_color,
                    Stroke::NONE,
                ));
            }
        }
        // Rows use f32; converting each value to f64 for the sum must not expose
        // the intermediate f32 representation (for example, 10.1 -> 10.10000038).
        let replacement = if use_value {
            let compact = ranked.value as f32;
            if compact.is_finite() {
                compact.to_string()
            } else {
                ranked.value.to_string()
            }
        } else {
            ranked.rank.to_string()
        };
        let job = egui::text::LayoutJob::single_section(
            template.replace("{}", &replacement),
            format.clone(),
        );
        let galley = p.layout_job(job);
        let at = center - galley.size() / 2.0;
        if option_bool(node, "rankingBold", false) {
            p.galley(at + vec2(0.4, 0.0), galley.clone(), text_color);
        }
        p.galley(at, galley, text_color);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(values: &[f32]) -> Vec<Row> {
        values
            .iter()
            .map(|&value| Row {
                name: String::new(),
                values: [value, 0.0, 0.0],
            })
            .collect()
    }

    #[test]
    fn ranking_uses_descending_category_totals() {
        let rows = sample(&[1948.0, 1585.0, 1680.0, 1955.0, 1710.0]);
        let ranked = ranked_values(&rows, 1, "all", 3);
        assert_eq!(
            ranked.iter().map(|item| item.rank).collect::<Vec<_>>(),
            [2, 5, 4, 1, 3]
        );
        assert!(ranked.iter().all(|item| item.visible));
    }

    #[test]
    fn ranking_combines_only_the_requested_series() {
        let mut rows = sample(&[20.0, 9.0, 50.0]);
        rows[0].values[1] = 1.0;
        rows[1].values[1] = 30.0;
        let all = ranked_values(&rows, 2, "all", 3);
        assert_eq!(
            all.iter().map(|item| item.rank).collect::<Vec<_>>(),
            [3, 2, 1]
        );
        assert_eq!(
            all.iter().map(|item| item.value).collect::<Vec<_>>(),
            [21.0, 39.0, 50.0]
        );
        let first = ranked_values(&rows, 1, "all", 3);
        assert_eq!(
            first.iter().map(|item| item.rank).collect::<Vec<_>>(),
            [2, 3, 1]
        );
    }

    #[test]
    fn extremes_include_ties_and_custom_count_is_stable() {
        let rows = sample(&[8.0, 2.0, 8.0, -1.0]);
        let visible = |mode, count| {
            ranked_values(&rows, 1, mode, count)
                .iter()
                .map(|item| item.visible)
                .collect::<Vec<_>>()
        };
        assert_eq!(visible("max", 3), [true, false, true, false]);
        assert_eq!(visible("min", 3), [false, false, false, true]);
        assert_eq!(visible("max-and-min", 3), [true, false, true, true]);
        assert_eq!(visible("custom", 1), [true, false, false, false]);
        assert_eq!(visible("custom", 0), [false, false, false, false]);
    }
}
