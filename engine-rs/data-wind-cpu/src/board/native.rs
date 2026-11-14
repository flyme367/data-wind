//! egui 没有但看板需要的控件，以一等 `Widget` 补齐：拿到与原生控件一致的
//! Response / 无障碍语义；点击状态仍由自研 `pointer()` 协议驱动（不喂 egui 事件）。

use egui::{
    Color32, Label, Response, RichText, Sense, Ui, Widget, WidgetInfo, WidgetText, pos2, vec2,
};

use super::{ACCENT, color, put_row};

/// 开关：egui 0.37 无原生 Switch（ToggleValue 已移除），这里补一等控件。
/// 胶囊视觉对齐看板深色主题，`Response` 携带 `Role::Switch` 选中语义——
/// 将来若给看板喂 RawInput 事件，hover / 按压反馈与无障碍能力自动生效。
pub(super) struct Switch {
    pub checked: bool,
    pub text: WidgetText,
}

impl Switch {
    pub fn new(checked: bool, text: impl Into<WidgetText>) -> Self {
        Self {
            checked,
            text: text.into(),
        }
    }
}

impl Widget for Switch {
    fn ui(self, ui: &mut Ui) -> Response {
        let Self { checked, text } = self;
        let mut response = ui
            .scope_builder(
                egui::UiBuilder::new().layout(egui::Layout::left_to_right(egui::Align::Center)),
                |ui| {
                    let (track, click) = ui.allocate_exact_size(vec2(36.0, 18.0), Sense::click());
                    let painter = ui.painter();
                    painter.rect_filled(
                        track,
                        9.0,
                        if checked { ACCENT } else { color("#42516b") },
                    );
                    painter.circle_filled(
                        pos2(
                            if checked {
                                track.max.x - 9.0
                            } else {
                                track.min.x + 9.0
                            },
                            track.center().y,
                        ),
                        7.0,
                        Color32::WHITE,
                    );
                    ui.add_space(ui.spacing().icon_spacing);
                    if !text.is_empty() {
                        ui.add(Label::new(text.clone()));
                    }
                    click
                },
            )
            .inner;
        // egui 0.36 的 WidgetInfo 收 WidgetType（0.37 才换 accesskit::Role）；暂用 Checkbox。
        response.widget_info(|| {
            WidgetInfo::selected(
                egui::WidgetType::Checkbox,
                ui.is_enabled(),
                checked,
                text.text(),
            )
        });
        response
    }
}

/// 树行：固定 27px 行高，与 `pointer()` 的命中步长（(point.y - 8) / 27）一致；
/// 标签左对齐、行内垂直居中。
pub(super) fn tree_row(ui: &mut Ui, text: RichText) {
    let (rect, _) = ui.allocate_exact_size(vec2(ui.available_width(), 27.0), Sense::hover());
    put_row(ui, rect, |ui| ui.add(Label::new(text)));
}
