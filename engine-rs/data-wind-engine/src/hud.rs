//! egui 视口内覆盖层：工具条、性能统计、坐标轴指示器。
//!
//! 注意：egui 默认字体不含 CJK 字形，覆盖层文案使用英文短标签
//! （中文界面由外层 Semi Design React 面板承担）。

use crate::common::HudState;

/// 每帧构建 UI（在 `Engine::frame` 内调用，self 已被解构为字段）。
pub fn build_ui(
    ctx: &egui::Context,
    hud: HudState,
    camera_view: &glam::Mat4,
    stats: StatsSnapshot,
    frame_times: &std::collections::VecDeque<f32>,
    events: &mut Vec<crate::common::EngineEvent>,
    actions: &mut HudActions,
) {
    // Canvas-only controls, rendered by egui into the WebGPU surface.
    egui::Window::new("dw_tools")
        .anchor(egui::Align2::RIGHT_TOP, [-10.0, 10.0])
        .title_bar(false)
        .resizable(false)
        .collapsible(false)
        .frame(
            egui::Frame::new()
                .fill(egui::Color32::from_rgba_unmultiplied(24, 27, 35, 210))
                .corner_radius(2.0)
                .inner_margin(3),
        )
        .show(ctx, |ui| {
            ui.spacing_mut().item_spacing.x = 2.0;
            ui.horizontal(|ui| {
                if canvas_button(ui, hud.grid, 0, "Toggle grid") {
                    actions.grid = Some(!hud.grid);
                }
                if canvas_button(ui, hud.flylines, 1, "Toggle flylines") {
                    actions.flylines = Some(!hud.flylines);
                }
                if canvas_button(ui, false, 2, "Reset camera") {
                    actions.reset_view = true;
                }
            });
        });

    // 性能统计（左下）
    if hud.stats {
        egui::Window::new("dw_stats")
            .anchor(egui::Align2::LEFT_BOTTOM, [12.0, -12.0])
            .title_bar(false)
            .resizable(false)
            .collapsible(false)
            .frame(
                egui::Frame::new()
                    .fill(egui::Color32::from_rgba_unmultiplied(24, 27, 35, 205))
                    .corner_radius(8.0)
                    .inner_margin(egui::Margin::symmetric(10, 8)),
            )
            .show(ctx, |ui| {
                egui::Grid::new("stats_grid")
                    .num_columns(2)
                    .spacing([14.0, 2.0])
                    .show(ui, |ui| {
                        let row = |ui: &mut egui::Ui, k: &str, v: &str| {
                            ui.label(egui::RichText::new(k).size(11.0).weak());
                            ui.label(egui::RichText::new(v).size(11.0).strong());
                            ui.end_row();
                        };
                        row(ui, "Backend", stats.backend);
                        row(ui, "FPS", &format!("{:.0}", stats.fps));
                        row(
                            ui,
                            "Instances",
                            &format!("{}/{}", stats.visible, stats.instances),
                        );
                        row(ui, "Particles", &stats.particles.to_string());
                        row(ui, "Triangles", &stats.tris.to_string());
                    });
                // egui_plot 帧耗时曲线（无交互 sparkline，固定 0~50 ms 量程）
                ui.add_space(4.0);
                ui.label(egui::RichText::new("frame ms").size(10.0).weak());
                let samples: egui_plot::PlotPoints = frame_times
                    .iter()
                    .enumerate()
                    .map(|(i, ms)| [i as f64, *ms as f64])
                    .collect();
                egui_plot::Plot::new("dw_frame_plot")
                    .width(196.0)
                    .height(52.0)
                    .show_axes(false)
                    .allow_drag(false)
                    .allow_zoom(false)
                    .allow_scroll(false)
                    .allow_boxed_zoom(false)
                    .allow_double_click_reset(false)
                    .default_x_bounds(0.0, 120.0)
                    .default_y_bounds(0.0, 50.0)
                    .show(ui, |plot_ui| {
                        plot_ui.line(
                            egui_plot::Line::new("frame_ms", samples)
                                .color(egui::Color32::from_rgb(104, 169, 243))
                                .width(1.5),
                        );
                    });
            });
    }

    // 坐标轴指示器（右下）
    egui::Area::new(egui::Id::new("dw_gizmo"))
        .anchor(egui::Align2::RIGHT_BOTTOM, [-52.0, -52.0])
        .movable(false)
        .show(ctx, |ui| {
            let (rect, _) = ui.allocate_exact_size(egui::vec2(64.0, 64.0), egui::Sense::hover());
            let center = rect.center();
            let painter = ui.painter_at(rect);
            painter.circle_filled(
                center,
                26.0,
                egui::Color32::from_rgba_unmultiplied(24, 27, 35, 150),
            );
            let m = camera_view.to_cols_array_2d();
            // 视图矩阵旋转部分作用于世界轴 → 屏幕方向
            let axis_screen = |ax: f32, ay: f32, az: f32| -> egui::Vec2 {
                let sx = m[0][0] * ax + m[1][0] * ay + m[2][0] * az;
                let sy = m[0][1] * ax + m[1][1] * ay + m[2][1] * az;
                egui::vec2(sx, -sy) * 20.0
            };
            let axes: [(&str, [f32; 3], egui::Vec2, egui::Color32); 3] = [
                (
                    "X",
                    [1.0, 0.0, 0.0],
                    axis_screen(1.0, 0.0, 0.0),
                    egui::Color32::from_rgb(240, 90, 84),
                ),
                (
                    "Y",
                    [0.0, 1.0, 0.0],
                    axis_screen(0.0, 1.0, 0.0),
                    egui::Color32::from_rgb(98, 200, 80),
                ),
                (
                    "Z",
                    [0.0, 0.0, 1.0],
                    axis_screen(0.0, 0.0, 1.0),
                    egui::Color32::from_rgb(80, 140, 250),
                ),
            ];
            // 按深度排序：先画远的
            let mut order: Vec<usize> = (0..3).collect();
            let depth = |i: usize| -> f32 {
                let (_, a, _, _) = axes[i];
                m[0][2] * a[0] + m[1][2] * a[1] + m[2][2] * a[2]
            };
            order.sort_by(|a, b| depth(*b).total_cmp(&depth(*a)));
            for i in order {
                let (label, _, dir, color) = axes[i];
                let tip = center + dir;
                painter.line_segment([center, tip], egui::Stroke::new(2.0, color));
                painter.circle_filled(
                    tip,
                    7.5,
                    egui::Color32::from_rgba_unmultiplied(24, 27, 35, 220),
                );
                painter.text(
                    tip,
                    egui::Align2::CENTER_CENTER,
                    label,
                    egui::FontId::proportional(10.0),
                    color,
                );
            }
        });

    let _ = events;
}

/// egui 交互产生的动作，由 Engine 消化。
#[derive(Default)]
pub struct HudActions {
    pub grid: Option<bool>,
    pub flylines: Option<bool>,
    pub stats: Option<bool>,
    pub reset_view: bool,
}

/// 统计快照（避免在 UI 闭包中借用 Engine）。
#[derive(Copy, Clone)]
pub struct StatsSnapshot {
    pub backend: &'static str,
    pub fps: f32,
    pub instances: u32,
    pub visible: u32,
    pub particles: u32,
    pub tris: u32,
}

fn canvas_button(ui: &mut egui::Ui, active: bool, kind: u8, tooltip: &str) -> bool {
    let (rect, response) = ui.allocate_exact_size(egui::vec2(27.0, 26.0), egui::Sense::click());
    let painter = ui.painter_at(rect);
    if active || response.hovered() {
        painter.rect_filled(rect, 1.0, egui::Color32::from_rgb(47, 119, 204));
    }
    let center = rect.center();
    let stroke = egui::Stroke::new(1.2, egui::Color32::from_rgb(205, 210, 218));
    match kind {
        0 => {
            painter.circle_stroke(center, 7.5, stroke);
            painter.line_segment(
                [center - egui::vec2(7.5, 0.0), center + egui::vec2(7.5, 0.0)],
                stroke,
            );
            painter.line_segment(
                [center - egui::vec2(0.0, 7.5), center + egui::vec2(0.0, 7.5)],
                stroke,
            );
        }
        1 => {
            painter.circle_filled(center, 7.5, stroke.color);
        }
        _ => {
            let points = (0u8..24)
                .map(|index| {
                    let angle = f32::from(index) * std::f32::consts::TAU / 28.0;
                    center + egui::vec2(angle.cos(), angle.sin()) * 7.0
                })
                .collect();
            painter.add(egui::Shape::line(points, stroke));
            painter.line_segment(
                [
                    center + egui::vec2(7.0, -5.0),
                    center + egui::vec2(7.0, 0.0),
                ],
                stroke,
            );
            painter.line_segment(
                [center + egui::vec2(2.0, 0.0), center + egui::vec2(7.0, 0.0)],
                stroke,
            );
        }
    }
    response.on_hover_text(tooltip).clicked()
}
