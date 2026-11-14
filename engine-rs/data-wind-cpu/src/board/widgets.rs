use egui::{Align2, Color32, FontId, Painter, Pos2, Rect, Shape, Stroke, StrokeKind, pos2, vec2};
use serde_json::Value;

use super::charts::{ChartLayout, zoom};
use super::{
    ACCENT, BoardNode, BoardScene, Clock, MUTED, PALETTE, TEXT, WidgetStyle, color, handles, string,
};

pub(super) fn label(p: &Painter, at: Pos2, size: f32, text: impl ToString, tint: Color32) {
    p.text(
        at,
        Align2::LEFT_TOP,
        text.to_string(),
        FontId::proportional(size.max(1.0)),
        tint,
    );
}

pub(super) fn centered(p: &Painter, rect: Rect, size: f32, text: impl ToString, tint: Color32) {
    p.text(
        rect.center(),
        Align2::CENTER_CENTER,
        text.to_string(),
        FontId::proportional(size.max(1.0)),
        tint,
    );
}

pub(super) fn line(p: &Painter, from: Pos2, to: Pos2, width: f32, tint: Color32) {
    p.line_segment([from, to], Stroke::new(width, tint));
}

pub(super) fn duration(seconds: f64) -> String {
    let seconds = seconds.max(0.0).floor() as u64;
    format!(
        "{:02}:{:02}:{:02}",
        seconds / 3600,
        seconds / 60 % 60,
        seconds % 60
    )
}

pub(super) fn selection(p: &Painter, node: &BoardNode) {
    p.rect_stroke(
        node.rect().expand(2.0),
        0.0,
        Stroke::new(2.0, ACCENT),
        StrokeKind::Outside,
    );
    if !node.locked {
        for (_, center) in handles(node.rect()) {
            p.rect_filled(
                Rect::from_center_size(center, egui::Vec2::splat(7.0)),
                0.0,
                Color32::WHITE,
            );
            p.rect_stroke(
                Rect::from_center_size(center, egui::Vec2::splat(7.0)),
                0.0,
                Stroke::new(1.0, ACCENT),
                StrokeKind::Outside,
            );
        }
    }
}

impl BoardScene {
    pub(super) fn paint_widget(
        &self,
        painter: &Painter,
        node: &BoardNode,
        clock: &Clock,
        chart_pointer: Option<Pos2>,
        chart_layout: &mut Option<ChartLayout>,
    ) {
        if node.data["__kitResource"] == true {
            return;
        }
        if self.paint_kit_button(painter, node, chart_pointer.is_some(), clock.now) {
            return;
        }
        let w = &node.widget;
        let r = node.rect();
        if w.shadow_color != "transparent" {
            let shadow = egui::epaint::Shadow {
                offset: [
                    w.shadow_offset_x.clamp(-127.0, 127.0) as i8,
                    w.shadow_offset_y.clamp(-127.0, 127.0) as i8,
                ],
                blur: w.shadow_blur.clamp(0.0, 200.0) as u8,
                spread: 0,
                color: color(&w.shadow_color),
            };
            painter.add(shadow.as_shape(r, w.radius));
        }
        self.paint_kit_background(painter, node);
        if w.border_style != "none" && w.border_width > 0.0 {
            let stroke = Stroke::new(w.border_width, color(&w.border_color));
            if w.border_style == "dashed" || w.border_style == "dotted" {
                let points = [
                    r.left_top(),
                    r.right_top(),
                    r.right_bottom(),
                    r.left_bottom(),
                    r.left_top(),
                ];
                let length = if w.border_style == "dotted" {
                    w.border_width.max(1.0)
                } else {
                    7.0
                };
                painter.extend(Shape::dashed_line(&points, stroke, length, 4.0));
            } else {
                painter.rect_stroke(r, w.radius, stroke, StrokeKind::Inside);
            }
        }
        let p = painter.with_clip_rect(r.shrink(w.border_width.max(0.0) * 0.5));
        let body = r.shrink2(vec2(
            14.0_f32.min(r.width() / 8.0),
            12.0_f32.min(r.height() / 8.0),
        ));
        if self.document.preview && self.focus.as_ref() == Some(&node.id) {
            p.rect_stroke(
                r.shrink(1.0),
                w.radius,
                Stroke::new(1.0, ACCENT),
                StrokeKind::Inside,
            );
        }
        let tint = color(&node.color);
        let size = w.font_size.max(10.0);
        // 山海鲸「是否加载」：关闭时只画外壳与提示，不渲染组件内容
        if node.data.get("loaded").and_then(Value::as_bool) == Some(false) {
            centered(
                &p,
                Rect::from_min_size(body.min, vec2(body.width(), 16.0)),
                13.0,
                "组件未加载",
                MUTED,
            );
            return;
        }
        let menu_painter = if node.data["__kitMenu"]["overflow"] == "visible" {
            painter
        } else {
            &p
        };
        if self.paint_kit_menu(menu_painter, node, chart_pointer) {
            return;
        }
        if super::kit::paint_kit_progress(&p, node) {
            return;
        }
        if self.paint_kit_table(&p, node, chart_pointer) {
            return;
        }
        if let Some(close) = super::kit::kit_close_rect(node) {
            let tint = color(node.data["__kitClose"]["color"].as_str().unwrap_or("#ccc"));
            centered(&p, close, close.height(), "×", tint);
        }
        match w.kind.as_str() {
            "bar"
            | "line"
            | "pie"
            | "barGradient"
            | "barGrouped"
            | "barStacked"
            | "barPercent"
            | "barHorizontal"
            | "barHorizontalStacked"
            | "lineSmooth"
            | "lineMulti"
            | "area"
            | "areaGradient"
            | "areaStacked"
            | "dualAxis"
            | "radar"
            | "radarFilled"
            | "pieBasic"
            | "pieRose"
            | "scatter"
            | "bubble"
            | "gauge"
            | "waterball"
            | "funnel"
            | "heatmap"
            | "bar3dGrouped"
            | "bar3dStacked"
            | "pie3d"
            | "donut3d"
            | "rose3d"
            | "roseRing3d" => {
                let top = if w.text.is_empty() {
                    body.min
                } else {
                    label(&p, body.min, 17.0, &w.text, TEXT);
                    body.min + vec2(0.0, 26.0)
                };
                let chart_rect = if node.data["__kitChart"] == true {
                    r
                } else {
                    Rect::from_min_max(top, body.max)
                };
                let mut layout = ChartLayout::new(node, p.clip_rect(), self.document.preview);
                let legend_images = if node.data["chart"]["legendType"] == "scroll" {
                    [
                        self.images
                            .get(&format!("{}{}", super::LEGEND_LEFT_IMAGE_PREFIX, node.id)),
                        self.images.get(&format!(
                            "{}{}",
                            super::LEGEND_RIGHT_IMAGE_PREFIX,
                            node.id
                        )),
                    ]
                } else {
                    [None, None]
                };
                let zoomed = zoom::prepare(
                    node,
                    chart_rect,
                    self.chart_zoom_ranges.get(&node.id).copied(),
                );
                if let Some((filtered, plot_rect, geometry, offset)) = &zoomed {
                    layout.set_zoom(*geometry, *offset);
                    self.paint_chart(&p, filtered, *plot_rect, clock, &mut layout);
                    zoom::paint(&p, node, *geometry);
                    layout.paint_legends(
                        &p,
                        node,
                        *plot_rect,
                        self.chart_legend_pages.get(&node.id).copied().unwrap_or(0),
                        legend_images,
                    );
                } else {
                    self.paint_chart(&p, node, chart_rect, clock, &mut layout);
                    layout.paint_legends(
                        &p,
                        node,
                        chart_rect,
                        self.chart_legend_pages.get(&node.id).copied().unwrap_or(0),
                        legend_images,
                    );
                }
                if let Some(point) = chart_pointer {
                    layout.paint_hover(
                        &p,
                        node,
                        point,
                        self.chart_hidden.get(&node.id),
                        self.images
                            .get(&format!("{}{}", super::TOOLTIP_IMAGE_PREFIX, node.id)),
                    );
                }
                if !layout.is_empty() {
                    *chart_layout = Some(layout);
                }
            }
            "mapRegion" | "mapPoint" | "mapFlyline" | "mapHeat" | "mapTrack" | "mapBar" => {
                label(&p, body.min, 17.0, &w.text, TEXT);
                self.paint_map(
                    &p,
                    node,
                    Rect::from_min_max(body.min + vec2(0.0, 26.0), body.max),
                    clock,
                );
            }
            // 山海鲸「轮廓地图 / 瓦片地图」：区域子集 + 内置主题（maps.rs paint_region）
            "mapOutline" | "mapTile" => {
                label(&p, body.min, 17.0, &w.text, TEXT);
                self.paint_region(
                    &p,
                    node,
                    Rect::from_min_max(body.min + vec2(0.0, 26.0), body.max),
                    clock,
                );
            }
            "table" | "tableBasic" | "tableIndex" => {
                label(&p, body.min, 17.0, &w.text, TEXT);
                table(
                    &p,
                    node,
                    Rect::from_min_max(body.min + vec2(0.0, 27.0), body.max),
                );
            }
            "report" => report(&p, body),
            "metric" | "timer" | "dataChange" => {
                if w.kind == "metric" && node.data["__kitText"].is_object() {
                    let value = animated_metric_value(node, clock.now);
                    styled_metric(&p, r, node, &value);
                    return;
                }
                let show = w.kind != "dataChange" || node.data["showValue"] != false;
                if show {
                    label(&p, body.min, 16.0, &w.text, MUTED);
                    let value = if w.kind == "timer" {
                        let start = node.data["startAt"].as_f64().unwrap_or(0.0);
                        duration(if start > 0.0 {
                            (clock.now - start) / 1000.0
                        } else {
                            0.0
                        })
                    } else {
                        format!("{} {}", w.value, w.unit)
                    };
                    label(&p, body.min + vec2(0.0, 28.0), size, value, tint);
                }
                if w.kind == "dataChange" {
                    let change = string(&node.data["change"]);
                    let down = change.starts_with('-');
                    let flat = !change.starts_with(['+', '-'])
                        && change.trim_end_matches('%').parse::<f32>().unwrap_or(0.0) == 0.0;
                    let arrow = if flat {
                        "—"
                    } else if down {
                        "↓"
                    } else {
                        "↑"
                    };
                    label(
                        &p,
                        if show {
                            pos2(body.min.x, body.max.y - 20.0)
                        } else {
                            body.min
                        },
                        if show { 16.0 } else { size },
                        format!("{arrow}{}", change.trim_start_matches(['+', '-'])),
                        if down {
                            Color32::from_rgb(244, 114, 114)
                        } else {
                            PALETTE[1]
                        },
                    );
                }
            }
            "text" | "textMultiline" | "clock" => {
                let options = &node.data["__kitText"];
                let formatted;
                let text = if w.kind == "clock" && options.is_object() {
                    formatted = super::kit::kit_clock_text(clock, options);
                    &formatted
                } else if w.kind == "clock" {
                    &clock.time
                } else {
                    &w.text
                };
                styled_text(
                    &p,
                    if options.is_object() { r } else { body },
                    node,
                    text,
                    false,
                    clock.now,
                );
            }
            "flipCounter" => {
                label(&p, body.min, 13.0, &w.text, MUTED);
                let digit_size =
                    size.min((body.width() / w.value.chars().count().max(1) as f32) * 1.1);
                let digit_width = digit_size * 0.82;
                for (index, ch) in w.value.chars().enumerate() {
                    let digit = Rect::from_min_size(
                        body.min + vec2(index as f32 * (digit_width + 4.0), 25.0),
                        vec2(digit_width, digit_size * 1.28),
                    );
                    if ch.is_ascii_digit() {
                        p.add(Shape::gradient_rect(
                            digit,
                            egui::Direction::TopDown,
                            [color("#1d3a5c"), color("#14263c")],
                        ));
                        line(
                            &p,
                            digit.left_center(),
                            digit.right_center(),
                            1.0,
                            color("#0a1522cc"),
                        );
                    }
                    centered(&p, digit, digit_size, ch, tint);
                }
            }
            "wordCloud" => {
                label(&p, body.min, 17.0, &w.text, TEXT);
                let rows = super::charts::rows(node);
                let max = rows.iter().map(|v| v.values[0]).fold(1.0_f32, f32::max);
                let (mut x, mut y, mut row_height) = (body.min.x, body.min.y + 32.0, 0.0_f32);
                for (i, row) in rows.iter().enumerate() {
                    let font = FontId::proportional(14.0 + row.values[0] / max * 28.0);
                    let galley =
                        p.layout_no_wrap(row.name.clone(), font, PALETTE[i % PALETTE.len()]);
                    if x + galley.size().x > body.max.x && x > body.min.x {
                        x = body.min.x;
                        y += row_height + 7.0;
                        row_height = 0.0;
                    }
                    row_height = row_height.max(galley.size().y);
                    let next = galley.size().x + 14.0;
                    p.galley(pos2(x, y), galley, tint);
                    x += next;
                }
            }
            "image" | "carousel" | "video" | "audio" | "monitor" | "carouselVideo" | "pdf" => {
                self.paint_media(&p, node, w, r, body);
                // 切换按钮 / 翻页按钮用未裁剪画笔：轮播图「外部」按钮允许画到组件矩形外（与山海鲸一致）
                self.paint_media_buttons(painter, node, w, r);
            }
            "shape" => {
                let bounds = if node.data["__kitGraphical"] == true {
                    r
                } else {
                    body
                };
                let radius = bounds.width().min(bounds.height()) / 2.0;
                match node.data["shape"].as_str().unwrap_or("circle") {
                    "rect" => {
                        p.rect_filled(bounds, w.radius, tint);
                    }
                    "triangle" => {
                        p.add(Shape::convex_polygon(
                            vec![
                                bounds.center_top(),
                                bounds.right_bottom(),
                                bounds.left_bottom(),
                            ],
                            tint,
                            Stroke::NONE,
                        ));
                    }
                    "lozenge" => {
                        p.add(Shape::convex_polygon(
                            vec![
                                bounds.center_top(),
                                bounds.right_center(),
                                bounds.center_bottom(),
                                bounds.left_center(),
                            ],
                            tint,
                            Stroke::NONE,
                        ));
                    }
                    "trapezoid" => {
                        let inset = bounds.width() * 0.2;
                        p.add(Shape::convex_polygon(
                            vec![
                                bounds.left_top() + vec2(inset, 0.0),
                                bounds.right_top() - vec2(inset, 0.0),
                                bounds.right_bottom(),
                                bounds.left_bottom(),
                            ],
                            tint,
                            Stroke::NONE,
                        ));
                    }
                    "parallelogram" => {
                        let inset = bounds.width() * 0.2;
                        p.add(Shape::convex_polygon(
                            vec![
                                bounds.left_top() + vec2(inset, 0.0),
                                bounds.right_top(),
                                bounds.right_bottom() - vec2(inset, 0.0),
                                bounds.left_bottom(),
                            ],
                            tint,
                            Stroke::NONE,
                        ));
                    }
                    "ring" => {
                        p.circle_stroke(
                            bounds.center(),
                            radius * 0.8,
                            Stroke::new(radius * 0.35, tint),
                        );
                    }
                    "circle" if node.data["__kitGraphical"] == true => {
                        p.add(Shape::ellipse_filled(
                            bounds.center(),
                            bounds.size() / 2.0,
                            tint,
                        ));
                    }
                    _ => {
                        p.circle_filled(bounds.center(), radius, tint);
                    }
                }
            }
            "weather" => {
                if self.paint_kit_weather(&p, node) {
                    return;
                }
                let center = body.left_center() + vec2(24.0, -2.0);
                p.circle_filled(center, 14.0, color("#f5c452"));
                for i in 0..8 {
                    let direction =
                        egui::emath::Rot2::from_angle(i as f32 * std::f32::consts::TAU / 8.0)
                            * vec2(1.0, 0.0);
                    line(
                        &p,
                        center + direction * 19.0,
                        center + direction * 25.0,
                        2.0,
                        color("#f5c452"),
                    );
                }
                label(
                    &p,
                    pos2(body.min.x + 62.0, body.center().y - 25.0),
                    14.0,
                    &w.text,
                    MUTED,
                );
                label(
                    &p,
                    pos2(body.min.x + 62.0, body.center().y),
                    30.0,
                    format!("{}{}", w.value, w.unit),
                    TEXT,
                );
            }
            "calendar" => {
                label(
                    &p,
                    body.min,
                    14.0,
                    format!("{} · {}年{}月", w.text, clock.year, clock.month),
                    TEXT,
                );
                let cell = vec2(body.width() / 7.0, ((body.height() - 27.0) / 7.0).max(1.0));
                for (index, ch) in "日一二三四五六".chars().enumerate() {
                    centered(
                        &p,
                        Rect::from_min_size(body.min + vec2(index as f32 * cell.x, 27.0), cell),
                        11.0,
                        ch,
                        MUTED,
                    );
                }
                for i in 0..42 {
                    let day = i + 1 - clock.first_weekday as i32;
                    if day < 1 || day > clock.days as i32 {
                        continue;
                    }
                    let rect = Rect::from_min_size(
                        body.min
                            + vec2((i % 7) as f32 * cell.x, 27.0 + (i / 7 + 1) as f32 * cell.y),
                        cell,
                    );
                    if day == clock.day as i32 {
                        p.rect_filled(rect.shrink(1.0), 4.0, ACCENT);
                    }
                    centered(&p, rect, 12.0, day, TEXT);
                }
            }
            "timeline" => {
                let options = node.options("items");
                let active = node.number("active", 0.0) as usize;
                let y = body.min.y + 20.0;
                line(
                    &p,
                    pos2(body.min.x + 12.0, y),
                    pos2(body.max.x - 12.0, y),
                    2.0,
                    color("#284a6d"),
                );
                for (i, option) in options.iter().enumerate() {
                    let x = body.min.x
                        + 12.0
                        + (body.width() - 24.0) * i as f32 / (options.len().max(2) - 1) as f32;
                    p.circle_filled(
                        pos2(x, y),
                        6.0,
                        if i == active {
                            PALETTE[1]
                        } else if i < active {
                            ACCENT
                        } else {
                            color("#16273b")
                        },
                    );
                    p.text(
                        pos2(x, y + 14.0),
                        Align2::CENTER_TOP,
                        option,
                        FontId::proportional(11.0),
                        MUTED,
                    );
                }
            }
            "topology" => {
                // 山海鲸「拓扑图」：data.nodes [{id,name,x,y}] + data.edges [{from,to}]，坐标为组件内像素偏移
                let Some(items) = node.data["nodes"].as_array() else {
                    return;
                };
                let nodes: Vec<(String, String, Pos2)> = items
                    .iter()
                    .take(40)
                    .map(|item| {
                        let id = item.get("id").map_or_else(|| string(item), string);
                        let name = item.get("name").map_or_else(|| string(item), string);
                        let x = item.get("x").and_then(Value::as_f64).unwrap_or(0.0) as f32;
                        let y = item.get("y").and_then(Value::as_f64).unwrap_or(0.0) as f32;
                        (id, name, pos2(body.min.x + x, body.min.y + y))
                    })
                    .collect();
                if let Some(edges) = node.data["edges"].as_array() {
                    for edge in edges.iter().take(60) {
                        let from = string(&edge["from"]);
                        let to = string(&edge["to"]);
                        let (Some(a), Some(b)) = (
                            nodes
                                .iter()
                                .find(|(id, _, _)| *id == from)
                                .map(|(_, _, at)| *at),
                            nodes
                                .iter()
                                .find(|(id, _, _)| *id == to)
                                .map(|(_, _, at)| *at),
                        ) else {
                            continue;
                        };
                        line(&p, a, b, 2.0, color("#3d6a9e"));
                    }
                }
                for (_, name, center) in &nodes {
                    p.circle_filled(*center, 21.0, color("#16335073"));
                    p.circle_filled(*center, 15.0, color("#1b3a5c"));
                    p.circle_stroke(*center, 15.0, Stroke::new(2.0, color("#5b9bd5")));
                    centered(
                        &p,
                        Rect::from_min_size(
                            pos2(center.x - 70.0, center.y + 20.0),
                            vec2(140.0, 16.0),
                        ),
                        12.0,
                        name,
                        TEXT,
                    );
                }
            }
            _ => self.paint_control(&p, node, body),
        }
    }

    /// 山海鲸媒体组件：JS 侧解码像素经 set_image 传纹理，Rust 负责贴图与外壳。
    /// 填充方式对照官方文档：图片=拉伸填充|居中（默认拉伸填充），轮播图=拉伸|居中|平铺；其余等比居中。
    fn paint_media(&self, p: &Painter, node: &BoardNode, w: &WidgetStyle, r: Rect, body: Rect) {
        let kind = w.kind.as_str();
        let fit = match (kind, node.data["objectFit"].as_str()) {
            ("image", Some("center")) => MediaFit::Contain,
            ("image", Some("tile")) => MediaFit::Tile,
            ("image", _) => MediaFit::Stretch,
            ("carousel", Some("center")) => MediaFit::Contain,
            ("carousel", Some("tile")) => MediaFit::Tile,
            ("carousel", _) => MediaFit::Stretch,
            ("video", Some("stretch")) => MediaFit::Stretch,
            _ => MediaFit::Contain,
        };
        let city = (node.data["__kitCityGeometry"] == true)
            .then(|| format!("{}{}", super::CITY_IMAGE_PREFIX, node.id));
        let texture = city
            .as_ref()
            .and_then(|id| self.images.get(id))
            .or_else(|| self.images.get(&node.id));
        if let Some(texture) = texture {
            draw_media_texture(p, texture, r, fit);
        } else {
            let has_source = match kind {
                "image" => !w.image.is_empty(),
                "carousel" | "carouselVideo" => node.data["urls"]
                    .as_array()
                    .is_some_and(|urls| !urls.is_empty()),
                _ => !node.data["src"].as_str().unwrap_or("").is_empty(),
            };
            if kind == "pdf" && has_source {
                // 山海鲸「加载时颜色」：PDF 解码期间组件显示的颜色
                p.rect_filled(
                    r,
                    0.0,
                    color(node.data["loadingColor"].as_str().unwrap_or("#14283d")),
                );
            } else if kind != "audio" && node.data["__kitQuietMedia"] != true {
                let placeholder = match kind {
                    "monitor" => "请设置监控地址",
                    "pdf" => "请设置文件地址",
                    _ => "请设置媒体地址",
                };
                centered(
                    p,
                    body,
                    15.0,
                    self.statuses
                        .get(&node.id)
                        .map(String::as_str)
                        .unwrap_or(if has_source {
                            "正在加载媒体…"
                        } else {
                            placeholder
                        }),
                    MUTED,
                );
            }
        }
        // 山海鲸「播放设置-隐藏控制条」/ 监控「显示控制条」
        let show_bar = match kind {
            "video" | "audio" | "carouselVideo" => {
                !node.data["hideControls"].as_bool().unwrap_or(false)
            }
            "monitor" => node.data["showControls"].as_bool().unwrap_or(true),
            _ => false,
        };
        if show_bar {
            let controls = Rect::from_min_max(pos2(r.min.x, (r.max.y - 34.0).max(r.min.y)), r.max);
            p.rect_filled(controls, 0.0, color("#0a1522dd"));
            let playing = self.controls.get(&node.id).is_some_and(|s| s.value == true);
            label(
                p,
                controls.min + vec2(10.0, 8.0),
                15.0,
                if playing { "Ⅱ" } else { "▶" },
                TEXT,
            );
            label(p, controls.min + vec2(38.0, 8.0), 13.0, &w.text, TEXT);
        }
    }

    /// 轮播图「切换按钮」与基础PDF「翻页按钮」。
    fn paint_media_buttons(&self, p: &Painter, node: &BoardNode, w: &WidgetStyle, r: Rect) {
        let kind = w.kind.as_str();
        if kind == "carousel" {
            // 山海鲸「切换按钮」：位置 内部|外部、按钮尺寸、按钮颜色、按钮圆角、切换箭头
            let arrows = node.data["arrows"].as_str().unwrap_or("always");
            if arrows == "never"
                || (arrows == "hover" && node.data["__dwHovered"].as_bool() != Some(true))
            {
                return;
            }
            let size = node.number("buttonSize", 30.0).clamp(16.0, 120.0);
            let outside = node.data["buttonPosition"].as_str() == Some("outside");
            let (prev, next) = carousel_button_rects(r, size, outside);
            let fill = color(node.data["buttonColor"].as_str().unwrap_or("#0a1522aa"));
            let radius = node.number("buttonRadius", 0.0).clamp(0.0, size * 0.5);
            for (rect, glyph) in [(prev, "‹"), (next, "›")] {
                p.rect_filled(rect, radius, fill);
                centered(p, rect, size * 0.62, glyph, media_glyph_color(fill));
            }
        } else if kind == "pdf" {
            // 山海鲸「基础PDF」：按钮大小 + 按钮字体（字号、颜色）；页码经 set_value 回传后显示
            let size = node.number("buttonSize", 28.0).clamp(16.0, 120.0);
            let font_size = node.number("buttonFontSize", 13.0).clamp(8.0, 48.0);
            let font_color = color(node.data["buttonFontColor"].as_str().unwrap_or("#ffffff"));
            let (prev, next) = pdf_button_rects(r, size);
            for (rect, glyph) in [(prev, "◀"), (next, "▶")] {
                p.rect_filled(rect, 4.0, color("#0a1522aa"));
                centered(p, rect, size * 0.5, glyph, font_color);
            }
            let state = self.controls.get(&node.id);
            let page = state
                .and_then(|s| s.value.get("page"))
                .and_then(Value::as_f64)
                .unwrap_or(1.0);
            let pages = state
                .and_then(|s| s.value.get("pages"))
                .and_then(Value::as_f64)
                .unwrap_or(1.0);
            if pages > 1.0 {
                let indicator = Rect::from_center_size(
                    pos2(r.center().x, (r.max.y - 14.0).max(r.min.y)),
                    vec2(140.0, 20.0),
                );
                centered(
                    p,
                    indicator,
                    font_size,
                    format!("{} / {}", page.max(1.0) as u32, pages as u32),
                    font_color,
                );
            }
        }
    }
}

fn text_format(w: &WidgetStyle, options: &Value, tint: Color32) -> egui::TextFormat {
    let size = w.font_size.max(1.0);
    egui::TextFormat {
        font_id: if w.font_family.to_ascii_lowercase().contains("mono")
            || w.font_family.contains("Courier")
        {
            FontId::monospace(size)
        } else {
            FontId::proportional(size)
        },
        color: tint,
        italics: w.italic,
        underline: if w.underline {
            Stroke::new(1.0, tint)
        } else {
            Stroke::NONE
        },
        strikethrough: if options["strike"] == true {
            Stroke::new(1.0, tint)
        } else {
            Stroke::NONE
        },
        extra_letter_spacing: w.letter_spacing,
        line_height: if w.line_height > 0.0 {
            Some(w.line_height * size)
        } else {
            None
        },
        ..Default::default()
    }
}

fn text_animation_progress(options: &Value, now: f64) -> Option<(f32, bool)> {
    let start = options["startAt"].as_f64()?;
    let delay = options["delay"].as_f64().unwrap_or(0.0).max(0.0);
    let duration = options["duration"].as_f64().unwrap_or(1000.0).max(1.0);
    let interval = options["interval"].as_f64().unwrap_or(0.0).max(0.0);
    let elapsed = (now - start - delay).max(0.0);
    let phase = if options["loop"] == true {
        elapsed % (duration + interval)
    } else {
        elapsed
    };
    let blink = options["mode"] == "blink";
    if phase >= duration {
        return Some((if blink { 0.0 } else { 1.0 }, blink));
    }
    let t = (phase / duration) as f32;
    let eased = match options["easing"].as_str().unwrap_or("none") {
        "Power1.easeIn" | "SlowMo.easeIn" => t * t,
        "Power1.easeOut" | "SlowMo.easeOut" => 1.0 - (1.0 - t) * (1.0 - t),
        "Power1.easeInOut" | "SlowMo.easeInOut" if t < 0.5 => 2.0 * t * t,
        "Power1.easeInOut" | "SlowMo.easeInOut" => 1.0 - (-2.0 * t + 2.0).powi(2) / 2.0,
        "Back.easeIn" => 2.70158 * t * t * t - 1.70158 * t * t,
        "Back.easeOut" => 1.0 + 2.70158 * (t - 1.0).powi(3) + 1.70158 * (t - 1.0).powi(2),
        "Back.easeInOut" if t < 0.5 => {
            let s = 1.70158 * 1.525;
            (2.0 * t).powi(2) * ((s + 1.0) * 2.0 * t - s) / 2.0
        }
        "Back.easeInOut" => {
            let s = 1.70158 * 1.525;
            ((2.0 * t - 2.0).powi(2) * ((s + 1.0) * (t * 2.0 - 2.0) + s) + 2.0) / 2.0
        }
        _ => t,
    };
    Some((eased, blink))
}

fn styled_text(p: &Painter, r: Rect, node: &BoardNode, text: &str, center: bool, now: f64) {
    let w = &node.widget;
    let options = &node.data["__kitText"];
    let animation = text_animation_progress(&node.data["__kitTextAnimation"], now);
    let opacity = animation.map_or(1.0, |(progress, blink)| {
        if blink {
            1.0 - progress.clamp(0.0, 1.0)
        } else {
            1.0
        }
    });
    let tint = color(&node.color).gamma_multiply(opacity);
    let format = text_format(w, options, tint);
    let align = if center || w.align == "center" {
        egui::Align::Center
    } else if w.align == "right" {
        egui::Align::Max
    } else {
        egui::Align::Min
    };
    let text = if options["arrangement"] == "vertical" {
        text.chars()
            .map(|ch| ch.to_string())
            .collect::<Vec<_>>()
            .join("\n")
    } else {
        text.to_owned()
    };
    let padding = &options["padding"];
    let inset = |index| super::number(&padding[index], 0.0);
    let min = r.min + vec2(inset(3), inset(0));
    let max = pos2(
        (r.max.x - inset(1)).max(min.x),
        (r.max.y - inset(2)).max(min.y),
    );
    let content = Rect::from_min_max(min, max);
    let mut job = egui::text::LayoutJob::default();
    job.append(&text, super::number(&options["indent"], 0.0), format);
    if options["overflow"] == "ellipsis" {
        job.wrap.max_width = content.width().max(1.0);
        job.wrap.max_rows = 1;
    } else if w.kind == "textMultiline" || !options.is_object() {
        job.wrap.max_width = content.width().max(1.0);
    }
    job.halign = align;
    let galley = p.layout_job(job);
    let mut at = pos2(
        match align {
            egui::Align::Center => content.center().x,
            egui::Align::Max => content.max.x,
            egui::Align::Min => content.min.x,
        },
        match options["vertical"].as_str() {
            Some("top") => content.min.y,
            Some("bottom") => content.max.y - galley.size().y,
            _ => content.center().y - galley.size().y * 0.5,
        },
    ) + vec2(
        super::number(&options["offset"][0], 0.0),
        super::number(&options["offset"][1], 0.0),
    );
    if let Some((progress, false)) = animation {
        if w.kind == "textMultiline" || options["arrangement"] == "vertical" {
            let overflow = (galley.size().y - content.height()).max(0.0);
            if overflow > 0.0 {
                at.y =
                    content.min.y + super::number(&options["offset"][1], 0.0) - overflow * progress;
            }
        } else {
            let overflow = (galley.size().x - content.width()).max(0.0);
            at.x -= overflow * progress;
        }
    }
    let painter = if animation.is_some() {
        p.with_clip_rect(p.clip_rect().intersect(content))
    } else {
        p.clone()
    };
    for (name, blur_key, x_key, y_key) in [
        ("shadow", "shadowBlur", "shadowX", "shadowY"),
        ("glow", "glowBlur", "glowX", "glowY"),
    ] {
        let blur = super::number(&options[blur_key], -1.0).clamp(-1.0, 40.0);
        let tint = color(options[name].as_str().unwrap_or("transparent")).gamma_multiply(opacity);
        if blur < 0.0 || tint.a() == 0 {
            continue;
        }
        let offset = vec2(
            super::number(&options[x_key], 0.0),
            super::number(&options[y_key], 0.0),
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
                        tint.gamma_multiply(alpha),
                    );
                }
            }
        }
        painter.galley_with_override_text_color(at + offset, galley.clone(), tint);
    }
    if w.font_weight >= 600 {
        painter.galley(at + vec2(0.4, 0.0), galley.clone(), tint);
    }
    painter.galley(at, galley, tint);
}

fn animated_metric_value(node: &BoardNode, now: f64) -> String {
    let options = &node.data["__kitMetricAnimation"];
    let (Some(start), Some(target)) = (options["startAt"].as_f64(), options["target"].as_f64())
    else {
        return node.widget.value.clone();
    };
    let from = options["from"].as_f64().unwrap_or(0.0);
    let delay = options["delay"].as_f64().unwrap_or(0.0).max(0.0);
    let duration = options["duration"].as_f64().unwrap_or(1000.0).max(1.0);
    let interval = options["interval"].as_f64().unwrap_or(0.0).max(0.0);
    let elapsed = (now - start - delay).max(0.0);
    let looping = options["loop"] == true && options["mode"] == "count";
    let phase = if looping {
        elapsed % (duration + interval)
    } else {
        elapsed
    };
    if phase >= duration {
        return node.widget.value.clone();
    }
    let value = from + (target - from) * (phase / duration);
    let decimals = options["decimals"].as_u64().unwrap_or(2).min(12) as usize;
    let mut formatted = format!("{value:.decimals$}");
    if options["completeZero"] != true && formatted.contains('.') {
        while formatted.ends_with('0') {
            formatted.pop();
        }
        if formatted.ends_with('.') {
            formatted.pop();
        }
    }
    let (integer, fraction) = formatted.split_once('.').unwrap_or((&formatted, ""));
    let (sign, integer) = integer
        .strip_prefix('-')
        .map_or(("", integer), |part| ("-", part));
    let digits = options["digits"].as_u64().unwrap_or(1).clamp(1, 21) as usize;
    let padded = format!("{:0>width$}", integer, width = digits);
    let mut result = String::with_capacity(padded.len() + fraction.len() + 8);
    result.push_str(sign);
    for (index, character) in padded.chars().enumerate() {
        if options["grouping"] == true && index > 0 && (padded.len() - index) % 3 == 0 {
            result.push(',');
        }
        result.push(character);
    }
    if !fraction.is_empty() {
        result.push('.');
        result.push_str(fraction);
    }
    result
}

fn styled_metric(p: &Painter, r: Rect, node: &BoardNode, text: &str) {
    let w = &node.widget;
    if w.unit.is_empty() {
        styled_text(p, r, node, text, false, 0.0);
        return;
    }
    let options = &node.data["__kitText"];
    let font = &options["unitFont"];
    let mut unit = node.clone();
    unit.widget.font_size = super::number(&font["size"], w.font_size).max(1.0);
    unit.widget.font_family = font["family"].as_str().unwrap_or(&w.font_family).to_owned();
    unit.widget.font_weight = super::number(
        &font["weight"],
        if font["bold"] == true { 700.0 } else { 400.0 },
    )
    .clamp(100.0, 900.0) as u16;
    unit.widget.italic = font["italic"] == true;
    unit.widget.underline = font["underline"] == true;
    unit.widget.letter_spacing = 0.0;
    unit.widget.line_height = 0.0;
    unit.widget.align = "left".into();
    unit.color = options["unitColor"]
        .as_str()
        .unwrap_or(&node.color)
        .to_owned();
    unit.data["__kitText"] = serde_json::json!({
        "vertical": options["vertical"],
        "offset": [0.0, super::number(&options["unitY"], 0.0)],
        "strike": font["line-through"] == true || font["deleteline"] == true,
        "glow": options["unitGlow"], "glowBlur": options["unitGlowBlur"],
        "glowX": options["unitGlowX"], "glowY": options["unitGlowY"],
    });
    let measure = |text: &str, node: &BoardNode| {
        let format = text_format(&node.widget, &node.data["__kitText"], color(&node.color));
        p.layout_job(egui::text::LayoutJob::single_section(
            text.to_owned(),
            format,
        ))
        .size()
        .x
    };
    let value_width = measure(text, node);
    let unit_width = measure(&w.unit, &unit);
    let gap = super::number(&options["unitX"], 0.0);
    let total = (value_width + gap + unit_width).max(0.0);
    let x = match w.align.as_str() {
        "right" => r.max.x - total,
        "center" => r.center().x - total * 0.5,
        _ => r.min.x,
    } + super::number(&options["offset"][0], 0.0);
    let mut value = node.clone();
    value.widget.align = "left".into();
    value.data["__kitText"]["offset"] = serde_json::json!([0.0, 0.0]);
    let bounds =
        |x, width: f32| Rect::from_min_size(pos2(x, r.min.y), vec2(width.max(1.0), r.height()));
    styled_text(p, bounds(x, value_width), &value, text, false, 0.0);
    styled_text(
        p,
        bounds(x + value_width + gap, unit_width),
        &unit,
        &w.unit,
        false,
        0.0,
    );
}

pub(super) fn table_grid(node: &BoardNode) -> (Vec<String>, Vec<Vec<String>>) {
    let raw = node.data["rows"].as_array().map_or(&[][..], Vec::as_slice);
    let sample = raw.iter().find_map(Value::as_object);
    let supplied = node.data["columns"]
        .as_array()
        .map(|a| a.iter().map(string).collect::<Vec<_>>())
        .unwrap_or_default();
    let columns =
        if sample.is_some_and(|s| !s.is_empty() && !supplied.iter().any(|c| s.contains_key(c))) {
            sample
                .map(|s| s.keys().cloned().collect())
                .unwrap_or_default()
        } else {
            supplied
        };
    let columns: Vec<String> = columns.into_iter().take(12).collect();
    let rows = raw
        .iter()
        .take(50)
        .map(|row| {
            if let Some(a) = row.as_array() {
                a.iter().map(string).collect()
            } else if row.is_object() {
                columns.iter().map(|key| string(&row[key])).collect()
            } else {
                vec![string(row)]
            }
        })
        .collect();
    (columns, rows)
}

fn table(p: &Painter, node: &BoardNode, r: Rect) {
    let (mut columns, mut rows) = table_grid(node);
    if node.widget.kind == "table" && (columns.is_empty() || columns == ["name", "value"]) {
        columns = vec!["名称".into(), "数值".into()];
    }
    if node.widget.kind == "tableIndex" {
        columns.insert(0, "序号".into());
        for (i, row) in rows.iter_mut().enumerate() {
            row.insert(0, (i + 1).to_string());
        }
    }
    let width = r.width() / columns.len().max(1) as f32;
    let row_height = 30.0;
    p.rect_filled(
        Rect::from_min_size(r.min, vec2(r.width(), row_height)),
        0.0,
        if node.widget.kind == "table" {
            color("#32608a40")
        } else {
            color("#2c6bb2")
        },
    );
    for (row_index, row) in std::iter::once(&columns).chain(rows.iter()).enumerate() {
        let y = r.min.y + row_index as f32 * row_height;
        if y >= r.max.y {
            break;
        }
        if row_index > 0 && row_index % 2 == 0 {
            p.rect_filled(
                Rect::from_min_size(pos2(r.min.x, y), vec2(r.width(), row_height)),
                0.0,
                color("#32608a26"),
            );
        }
        for (column, value) in row.iter().take(columns.len()).enumerate() {
            let cell = Rect::from_min_size(
                pos2(r.min.x + column as f32 * width, y),
                vec2(width, row_height),
            );
            label(
                &p.with_clip_rect(cell.intersect(r)),
                cell.min + vec2(8.0, 7.0),
                13.0,
                value,
                if row_index == 0 { Color32::WHITE } else { TEXT },
            );
        }
        line(
            p,
            pos2(r.min.x, y + row_height),
            pos2(r.max.x, y + row_height),
            1.0,
            color("#6cbcff20"),
        );
    }
}

fn report(p: &Painter, r: Rect) {
    p.rect_filled(r, 0.0, color("#fdfdfb"));
    let cell = vec2(r.width() / 13.0, r.height() / 11.0);
    for row in 0..11 {
        for col in 0..13 {
            let rect =
                Rect::from_min_size(r.min + vec2(col as f32 * cell.x, row as f32 * cell.y), cell);
            if row == 0 || col == 0 {
                p.rect_filled(rect, 0.0, color("#e6f4e0"));
                let text = if row == 0 && col > 0 {
                    char::from(b'A' + col as u8 - 1).to_string()
                } else if row > 0 {
                    row.to_string()
                } else {
                    String::new()
                };
                centered(p, rect, 11.0, text, color("#4a7c46"));
            }
            p.rect_stroke(
                rect,
                0.0,
                Stroke::new(0.5, color("#d9ddd3")),
                StrokeKind::Inside,
            );
        }
    }
}

/// 山海鲸媒体「填充方式」：拉伸填充 / 居中等比 / 平铺（平铺仅轮播图提供）。
#[derive(Clone, Copy, PartialEq)]
enum MediaFit {
    Stretch,
    Contain,
    Tile,
}

fn draw_media_texture(p: &Painter, texture: &egui::TextureHandle, rect: Rect, fit: MediaFit) {
    let size = texture.size_vec2();
    let uv = Rect::from_min_max(Pos2::ZERO, pos2(1.0, 1.0));
    match fit {
        MediaFit::Stretch => {
            p.image(texture.id(), rect, uv, Color32::WHITE);
        }
        MediaFit::Contain => {
            let scale = (rect.width() / size.x).min(rect.height() / size.y);
            let target = Rect::from_center_size(rect.center(), size * scale);
            p.image(texture.id(), target, uv, Color32::WHITE);
        }
        MediaFit::Tile => {
            // 平铺：按纹理原始尺寸铺满组件矩形，越界部分裁掉（UV 对应截断区域）
            let mut mesh = egui::Mesh::with_texture(texture.id());
            let columns = (rect.width() / size.x).ceil().max(1.0) as usize;
            let rows = (rect.height() / size.y).ceil().max(1.0) as usize;
            for row in 0..rows {
                for column in 0..columns {
                    let origin = rect.min + vec2(column as f32 * size.x, row as f32 * size.y);
                    let tile = Rect::from_min_size(origin, size).intersect(rect);
                    if !tile.is_positive() {
                        continue;
                    }
                    let clipped = Rect::from_min_max(
                        pos2(
                            (tile.min.x - origin.x) / size.x.max(1.0),
                            (tile.min.y - origin.y) / size.y.max(1.0),
                        ),
                        pos2(
                            (tile.max.x - origin.x) / size.x.max(1.0),
                            (tile.max.y - origin.y) / size.y.max(1.0),
                        ),
                    );
                    mesh.add_rect_with_uv(tile, clipped, Color32::WHITE);
                }
            }
            if !mesh.is_empty() {
                p.add(Shape::Mesh(std::sync::Arc::new(mesh)));
            }
        }
    }
}

/// 轮播图「切换按钮」矩形：内部=叠在组件左右边缘，外部=组件矩形外侧（与山海鲸一致，允许压到相邻组件）。
pub(super) fn carousel_button_rects(r: Rect, size: f32, outside: bool) -> (Rect, Rect) {
    let size = size.clamp(16.0, 120.0);
    let (prev_cx, next_cx) = if outside {
        (r.min.x - size * 0.7, r.max.x + size * 0.7)
    } else {
        (r.min.x + size * 0.55, r.max.x - size * 0.55)
    };
    let cy = r.center().y;
    (
        Rect::from_center_size(pos2(prev_cx, cy), vec2(size, size)),
        Rect::from_center_size(pos2(next_cx, cy), vec2(size, size)),
    )
}

/// 基础PDF「翻页按钮」矩形：左右边缘垂直居中。
pub(super) fn pdf_button_rects(r: Rect, size: f32) -> (Rect, Rect) {
    let size = size.clamp(16.0, 120.0);
    let cy = r.center().y;
    (
        Rect::from_center_size(pos2(r.min.x + size * 0.55, cy), vec2(size, size)),
        Rect::from_center_size(pos2(r.max.x - size * 0.55, cy), vec2(size, size)),
    )
}

/// 按钮底色亮（或近不透明的浅色）时用深色箭头，其余用白色箭头。
fn media_glyph_color(fill: Color32) -> Color32 {
    let luminance = (fill.r() as u32 * 299 + fill.g() as u32 * 587 + fill.b() as u32 * 114) / 1000;
    if fill.a() < 128 || luminance < 160 {
        Color32::WHITE
    } else {
        Color32::from_rgb(15, 30, 48)
    }
}

/// 预览命中区域：轮播图「外部」按钮允许超出组件矩形点击（基础PDF / 内部按钮都在矩形内，无需扩边）。
pub(super) fn media_hit_rect(node: &BoardNode) -> Rect {
    let outside = node.widget.kind == "carousel"
        && node.data["buttonPosition"].as_str() == Some("outside")
        && node.data["arrows"].as_str().unwrap_or("always") != "never";
    let margin = if outside {
        node.number("buttonSize", 30.0).clamp(16.0, 120.0) * 1.2
    } else {
        0.0
    };
    node.rect().expand(margin)
}
