use egui::{
    Button, Checkbox, Color32, FontId, FontSelection, Label, Painter, Pos2, ProgressBar, Rect,
    RichText, Slider, Stroke, StrokeKind, TextEdit, pos2, vec2,
};
use serde_json::{Value, json};
use std::collections::HashSet;

use crate::protocol::wire;

use super::charts::ChartHit;
use super::native::{Switch, tree_row};
use super::widgets::{carousel_button_rects, centered, duration, label, line, pdf_button_rects};
use super::{
    ACCENT, BoardEvent, BoardNode, BoardScene, ButtonRipple, MUTED, TEXT, color, number, put_row,
    string,
};

fn dialog_buttons(rect: Rect) -> [(Rect, &'static str); 3] {
    [
        (
            Rect::from_min_size(pos2(rect.max.x - 38.0, 5.0), vec2(30.0, 30.0)),
            "close",
        ),
        (
            Rect::from_min_size(
                pos2(rect.max.x - 160.0, rect.max.y - 42.0),
                vec2(67.0, 29.0),
            ),
            "cancel",
        ),
        (
            Rect::from_min_size(pos2(rect.max.x - 83.0, rect.max.y - 42.0), vec2(67.0, 29.0)),
            "confirm",
        ),
    ]
}

pub(super) fn dropdown_row_height(node: &BoardNode) -> f32 {
    number(&node.data["__kitDropdown"]["rowHeight"], 29.0).max(1.0)
}

pub(super) fn dropdown_padding(node: &BoardNode) -> (f32, f32, f32) {
    let padding = &node.data["__kitDropdown"]["dropPadding"];
    (
        number(&padding[0], 0.0).max(0.0),
        number(&padding[1], 0.0).max(0.0),
        number(&padding[2], 0.0).max(0.0),
    )
}

fn dropdown_visible_count(node: &BoardNode, count: usize) -> usize {
    let count = count.max(1);
    if node.data["__kitDropdown"].is_object() {
        count.min(number(&node.data["__kitDropdown"]["maxOptions"], 5.0).clamp(1.0, 500.0) as usize)
    } else {
        count
    }
}

#[derive(Clone)]
pub(super) struct DropdownItem {
    pub label: String,
    pub value: String,
    pub path: String,
    pub depth: usize,
    pub branch: bool,
    pub expanded: bool,
}

fn append_dropdown_tree(
    nodes: &[Value],
    expanded: &HashSet<String>,
    query: &str,
    prefix: &str,
    depth: usize,
    items: &mut Vec<DropdownItem>,
) {
    if depth > 20 || items.len() >= 5000 {
        return;
    }
    for (index, node) in nodes.iter().enumerate() {
        if items.len() >= 5000 {
            break;
        }
        let label = string(&node["label"]);
        let value = string(&node["value"]);
        let path = format!("{prefix}{index}.");
        let children = node["children"].as_array().map_or(&[][..], Vec::as_slice);
        let branch = !children.is_empty();
        let open = expanded.contains(&path);
        if query.is_empty()
            || label.to_lowercase().contains(query)
            || value.to_lowercase().contains(query)
        {
            items.push(DropdownItem {
                label,
                value,
                path: path.clone(),
                depth,
                branch,
                expanded: open,
            });
        }
        if open || !query.is_empty() {
            append_dropdown_tree(children, expanded, query, &path, depth + 1, items);
        }
    }
}

pub(super) fn dropdown_tree_label(nodes: &[Value], value: &str) -> Option<String> {
    for node in nodes {
        if string(&node["value"]) == value {
            return Some(string(&node["label"]));
        }
        if let Some(children) = node["children"].as_array()
            && let Some(label) = dropdown_tree_label(children, value)
        {
            return Some(label);
        }
    }
    None
}

impl BoardScene {
    fn close_control_popups(&mut self, except: Option<&str>) {
        for node in &self.document.nodes {
            if Some(node.id.as_str()) != except
                && node.data["__kitDropdown"]["closeOnlyOnSelect"] != true
                && let Some(state) = self.controls.get_mut(&node.id)
            {
                state.open = false;
                state.search.clear();
            }
        }
    }

    pub(super) fn dropdown_items(&self, node: &BoardNode) -> Vec<DropdownItem> {
        let state = self.controls.get(&node.id);
        let query = state.map_or(String::new(), |state| state.search.to_lowercase());
        if let Some(tree) = node.data["__kitDropdown"]["tree"].as_array() {
            let empty = HashSet::new();
            let expanded = state.map_or(&empty, |state| &state.tree_expanded);
            let mut items = Vec::new();
            let placeholder = node.data["__kitDropdown"]["placeholder"]
                .as_str()
                .unwrap_or("");
            if !placeholder.is_empty()
                && (query.is_empty() || placeholder.to_lowercase().contains(&query))
            {
                items.push(DropdownItem {
                    label: placeholder.to_owned(),
                    value: placeholder.to_owned(),
                    path: String::new(),
                    depth: 0,
                    branch: false,
                    expanded: false,
                });
            }
            append_dropdown_tree(tree, expanded, &query, "", 0, &mut items);
            return items;
        }
        node.options("options")
            .into_iter()
            .filter(|value| query.is_empty() || value.to_lowercase().contains(&query))
            .map(|value| DropdownItem {
                label: value.clone(),
                value,
                path: String::new(),
                depth: 0,
                branch: false,
                expanded: false,
            })
            .collect()
    }

    pub(super) fn dropdown_options(&self, node: &BoardNode) -> Vec<String> {
        self.dropdown_items(node)
            .into_iter()
            .map(|item| item.value)
            .collect()
    }

    fn start_button_ripple(&mut self, node: &BoardNode, point: Pos2, mode: &str, now: f64) {
        let button = &node.data["__kitButton"];
        if button[mode] != true || button[format!("{mode}Animation")] != true {
            return;
        }
        let Some(center) = self.local_hit_point(node, point, self.chart_clock) else {
            return;
        };
        let duration = (number(&button[format!("{mode}Duration")], 0.35) as f64 * 1000.0)
            .clamp(16.0, 60_000.0);
        self.controls.entry(node.id.clone()).or_default().ripple = Some(ButtonRipple {
            start: now,
            duration,
            center,
        });
    }

    pub fn pointer(&mut self, action: &str, point: Pos2) {
        let (action, now) =
            action
                .split_once('@')
                .map_or((action, self.chart_clock), |(name, time)| {
                    (
                        name,
                        time.parse::<f64>()
                            .ok()
                            .filter(|time| time.is_finite())
                            .unwrap_or(self.chart_clock),
                    )
                });
        if !self.document.preview {
            return;
        }
        if action == "cancel" || action == "leave" {
            self.pressed = None;
            self.chart_pointer = None;
            self.chart_zoom_drag = None;
            self.menu_scroll_drag = None;
            return;
        }
        if action == "move" {
            if let Some(drag) = self.menu_scroll_drag.clone() {
                if let Some(node) = self.document.nodes.iter().find(|node| node.id == drag.id)
                    && let Some(local) = self.local_hit_point(node, point, self.chart_clock)
                {
                    let position = if drag.vertical { local.y } else { local.x };
                    let change = if drag.travel > 0.0 {
                        (position - drag.origin) / drag.travel * drag.max_offset as f32
                    } else {
                        0.0
                    };
                    let next = (drag.offset as f32 + change)
                        .round()
                        .clamp(0.0, drag.max_offset as f32) as usize;
                    self.controls.entry(drag.id).or_default().menu_offset = next;
                }
                return;
            }
            if let Some(drag) = &self.chart_zoom_drag {
                if let Some(node) = self.document.nodes.iter().find(|node| node.id == drag.id)
                    && let Some(local) = self.local_hit_point(node, point, self.chart_clock)
                {
                    self.chart_zoom_ranges.insert(
                        drag.id.clone(),
                        drag.geometry.drag(drag.part, local.x - drag.origin.x),
                    );
                }
                return;
            }
        }
        if action == "up" && self.menu_scroll_drag.take().is_some() {
            self.pressed = None;
            return;
        }
        if action == "up" && self.chart_zoom_drag.take().is_some() {
            self.pressed = None;
            return;
        }
        let previous = if action == "move" {
            self.chart_pointer
                .and_then(|point| self.hit_test(point))
                .map(|hit| hit.id)
        } else {
            None
        };
        let hit = self.hit_test(point);
        if action == "context" {
            if let Some(node) = hit
                .as_ref()
                .and_then(|hit| self.document.nodes.iter().find(|node| node.id == hit.id))
                .cloned()
                && node.data["__kitMenu"]["allowUnselected"] == true
                && let Some(local) = self.local_hit_point(&node, point, self.chart_clock)
            {
                let offset = self
                    .controls
                    .get(&node.id)
                    .map_or(0, |state| state.menu_offset);
                let selected = self
                    .controls
                    .get(&node.id)
                    .and_then(|state| state.value.as_str())
                    .map(|value| !value.is_empty())
                    .unwrap_or_else(|| node.data["__kitMenu"]["active"].as_u64().is_some());
                if selected && super::kit::kit_menu_item(&node, local, offset).is_some() {
                    self.set_value(&node.id, json!(""));
                }
            }
            return;
        }
        if action == "move" && previous.as_deref() != hit.as_ref().map(|hit| hit.id.as_str()) {
            if let Some(node) = hit
                .as_ref()
                .and_then(|hit| self.document.nodes.iter().find(|node| node.id == hit.id))
                .cloned()
            {
                self.start_button_ripple(&node, point, "hover", now);
            }
        }
        if matches!(action, "wheel-up" | "wheel-down") {
            if let Some(node) = hit
                .as_ref()
                .and_then(|hit| self.document.nodes.iter().find(|node| node.id == hit.id))
                && node.data["__kitMenu"]["scroll"] == true
                && node.data["__kitMenu"]["wheel"] == true
            {
                let count = node.options("items").len();
                let max = super::kit::menu_max_offset(node, count);
                let step = if node.data["__kitMenu"]["scrollMode"] == "page" {
                    super::kit::menu_visible_count(node)
                } else {
                    1
                };
                let state = self.controls.entry(node.id.clone()).or_default();
                state.menu_offset = if action == "wheel-down" {
                    state.menu_offset.saturating_add(step).min(max)
                } else {
                    state.menu_offset.saturating_sub(step).min(max)
                };
                return;
            }
            if let Some(node) = hit
                .as_ref()
                .and_then(|hit| self.document.nodes.iter().find(|node| node.id == hit.id))
                && node.data["__kitDropdown"].is_object()
                && self.controls.get(&node.id).is_some_and(|state| state.open)
                && self
                    .local_hit_point(node, point, self.chart_clock)
                    .is_some_and(|p| self.popup_rect(node).contains(p))
            {
                let count = self.dropdown_options(node).len();
                let max = count.saturating_sub(dropdown_visible_count(node, count));
                if let Some(state) = self.controls.get_mut(&node.id) {
                    state.popup_offset = if action == "wheel-down" {
                        (state.popup_offset + 1).min(max)
                    } else {
                        state.popup_offset.saturating_sub(1)
                    };
                }
            }
            return;
        }
        if matches!(action, "move" | "down" | "up") {
            self.chart_pointer = hit.as_ref().map(|_| point);
        }
        if action == "down" {
            self.close_control_popups(hit.as_ref().map(|hit| hit.id.as_str()));
            self.pressed = hit.as_ref().map(|hit| hit.id.clone());
            if self.focus.as_ref() != self.pressed.as_ref() {
                self.focus = None;
            }
            if let Some(hit) = hit {
                if let Some(node) = self.document.nodes.iter().find(|n| n.id == hit.id).cloned() {
                    self.start_button_ripple(&node, point, "click", now);
                    if let Some(local) = self.local_hit_point(&node, point, self.chart_clock) {
                        let count = node.options("items").len();
                        let max = super::kit::menu_max_offset(&node, count);
                        let offset = self
                            .controls
                            .get(&node.id)
                            .map_or(0, |state| state.menu_offset)
                            .min(max);
                        if let Some((track, thumb)) =
                            super::kit::menu_scrollbar(&node, count, offset)
                            && track.contains(local)
                        {
                            let vertical = node.data["__kitMenu"]["vertical"] == true;
                            let position = if vertical { local.y } else { local.x };
                            let (start, length, thumb_length) = if vertical {
                                (track.min.y, track.height(), thumb.height())
                            } else {
                                (track.min.x, track.width(), thumb.width())
                            };
                            let travel = (length - thumb_length).max(0.0);
                            let next = if thumb.contains(local) || travel == 0.0 {
                                offset
                            } else {
                                (((position - start - thumb_length / 2.0) / travel).clamp(0.0, 1.0)
                                    * max as f32)
                                    .round() as usize
                            };
                            self.controls
                                .entry(node.id.clone())
                                .or_default()
                                .menu_offset = next;
                            self.menu_scroll_drag = Some(super::MenuScrollDrag {
                                id: node.id.clone(),
                                origin: position,
                                offset: next,
                                max_offset: max,
                                travel,
                                vertical,
                            });
                            self.pressed = None;
                            return;
                        }
                    }
                    if let Some(local) = self.local_hit_point(&node, point, self.chart_clock)
                        && let Some((geometry, part)) = self
                            .chart_layouts
                            .get(&node.id)
                            .and_then(|layout| layout.zoom_hit(local))
                    {
                        self.chart_zoom_drag = Some(super::charts::zoom::ZoomDrag {
                            id: node.id.clone(),
                            origin: local,
                            geometry,
                            part,
                        });
                        return;
                    }
                    if matches!(node.widget.kind.as_str(), "slider" | "timeProgress")
                        && let Some(point) = self.local_hit_point(&node, point, self.chart_clock)
                    {
                        self.slide(&node, point);
                    }
                }
            }
            return;
        }
        if action == "move" {
            if let Some(node) = self
                .document
                .nodes
                .iter()
                .find(|n| Some(&n.id) == self.pressed.as_ref())
                .cloned()
            {
                if matches!(node.widget.kind.as_str(), "slider" | "timeProgress")
                    && let Some(point) = self.local_hit_point(&node, point, self.chart_clock)
                {
                    self.slide(&node, point);
                }
            }
            return;
        }
        if action != "up" {
            return;
        }
        let pressed = self.pressed.take();
        let Some(hit) = hit else {
            self.close_control_popups(None);
            return;
        };
        if pressed.as_ref() != Some(&hit.id) {
            return;
        }
        let Some(node) = self.document.nodes.iter().find(|n| n.id == hit.id).cloned() else {
            return;
        };
        let Some(point) = self.local_hit_point(&node, point, self.chart_clock) else {
            return;
        };
        let kind = node.widget.kind.as_str();
        let chart = self
            .chart_layouts
            .get(&node.id)
            .and_then(|layout| layout.hit(point, self.chart_hidden.get(&node.id)));
        if let Some(chart) = chart {
            match chart {
                ChartHit::Legend(index) => {
                    let hidden = self.chart_hidden.entry(node.id.clone()).or_default();
                    if !hidden.remove(&index) {
                        hidden.insert(index);
                    }
                }
                ChartHit::LegendPage(page) => {
                    self.chart_legend_pages.insert(node.id.clone(), page);
                }
                ChartHit::Item(mark) => {
                    self.events.push(BoardEvent {
                        id: node.id.clone(),
                        kind: kind.into(),
                        action: wire::BoardAction::Change,
                        value: mark.datum.payload(&node),
                    });
                }
            }
        } else if node.data["__kitTable"].is_object() {
            if let Some(index) = super::kit::kit_table_row(&node, point) {
                let row = node.data["rows"][index].clone();
                let columns = &node.data["__kitTable"]["fields"];
                let values = row.as_array();
                let mut record = serde_json::Map::new();
                if let (Some(fields), Some(values)) = (columns.as_array(), values) {
                    for (field, value) in fields.iter().zip(values) {
                        if let Some(field) = field.as_str() {
                            record.insert(field.to_owned(), value.clone());
                        }
                    }
                }
                let name = values
                    .and_then(|values| values.first())
                    .map_or_else(String::new, string);
                let original = &node.data["__kitTableRawRows"][index];
                let selected_row = if original.is_object() {
                    original.clone()
                } else if record.is_empty() {
                    row
                } else {
                    Value::Object(record)
                };
                let payload = json!({"__kitTableRow": true, "index": index, "name": name,
                    "row": selected_row});
                self.controls.entry(node.id.clone()).or_default().value = payload.clone();
                self.events.push(BoardEvent {
                    id: node.id.clone(),
                    kind: kind.into(),
                    action: wire::BoardAction::Change,
                    value: payload,
                });
            }
        } else if node.data["__kitMenu"].is_object() {
            let offset = self
                .controls
                .get(&node.id)
                .map_or(0, |state| state.menu_offset);
            if let Some((index, item)) = super::kit::kit_menu_item(&node, point, offset) {
                if let Some(parent) = node.data["__kitPanelTab"].as_str() {
                    self.events.push(BoardEvent {
                        id: parent.to_owned(),
                        kind: kind.into(),
                        action: wire::BoardAction::Change,
                        value: json!({"__kitTabIndex": index, "name": item}),
                    });
                } else {
                    let selected = self
                        .controls
                        .get(&node.id)
                        .and_then(|state| state.value.as_str())
                        .map(str::to_owned)
                        .or_else(|| {
                            node.data["__kitMenu"]["active"]
                                .as_u64()
                                .and_then(|value| usize::try_from(value).ok())
                                .and_then(|active| node.options("items").get(active).cloned())
                        });
                    if selected.as_deref() == Some(item.as_str()) {
                        if node.data["__kitMenu"]["allowRepeat"] == true {
                            self.events.push(BoardEvent {
                                id: node.id.clone(),
                                kind: kind.into(),
                                action: wire::BoardAction::Change,
                                value: json!({"__kitMenuRepeat": true, "value": item}),
                            });
                        }
                    } else {
                        self.set_value(&node.id, json!(item));
                    }
                }
            }
        } else if super::kit::kit_close_rect(&node).is_some_and(|rect| rect.contains(point)) {
            self.events.push(BoardEvent {
                id: node.id.clone(),
                kind: kind.into(),
                action: wire::BoardAction::Change,
                value: json!({"__dwDialogAction": "close"}),
            });
        } else if node.data["__kitButton"]["select"] == true {
            let checked = self
                .controls
                .get(&node.id)
                .and_then(|state| state.value.as_bool())
                .unwrap_or(node.data["__kitButton"]["checked"] == true);
            self.set_value(&node.id, json!(!checked));
        } else if kind == "dialog" {
            if let Some((_, action)) = dialog_buttons(node.rect())
                .into_iter()
                .find(|(rect, _)| rect.contains(point))
            {
                self.events.push(BoardEvent {
                    id: node.id.clone(),
                    kind: kind.into(),
                    action: wire::BoardAction::Change,
                    value: json!({"__dwDialogAction": action}),
                });
            }
        } else if matches!(kind, "dropdown" | "timePicker") {
            let popup = self.popup_rect(&node);
            let items = self.dropdown_items(&node);
            let visible = dropdown_visible_count(&node, items.len());
            let state = self.controls.entry(node.id.clone()).or_default();
            if state.open && popup.contains(point) {
                let (top, horizontal, _) = dropdown_padding(&node);
                let offset = state.popup_offset.min(items.len().saturating_sub(visible));
                let index = offset
                    + ((point.y - popup.min.y - top) / dropdown_row_height(&node))
                        .floor()
                        .max(0.0) as usize;
                if let Some(item) = items.get(index) {
                    let is_tree = node.data["__kitDropdown"]["tree"].is_array();
                    let arrow_end = popup.min.x
                        + horizontal
                        + number(&node.data["__kitDropdown"]["leftPadding"], 10.0).max(0.0)
                        + (item.depth + 1) as f32 * 16.0;
                    if is_tree && item.branch && point.x <= arrow_end {
                        if !state.tree_expanded.remove(&item.path) {
                            state.tree_expanded.insert(item.path.clone());
                        }
                        return;
                    }
                    let multiple = node.data["__kitDropdown"]["multiple"] == true;
                    let value = if multiple {
                        let mut values = state.value.as_array().cloned().unwrap_or_default();
                        if let Some(index) = values
                            .iter()
                            .position(|value| value.as_str() == Some(&item.value))
                        {
                            values.remove(index);
                        } else {
                            values.push(json!(item.value));
                        }
                        json!(values)
                    } else {
                        json!(item.value)
                    };
                    let previous_events = self.events.len();
                    self.set_value(&node.id, value.clone());
                    if is_tree
                        && self.events.len() > previous_events
                        && let Some(event) = self.events.last_mut()
                    {
                        event.value = json!({ "__kitDropdownTree": true, "name": item.label,
                            "value": item.value, "values": if multiple { value } else { Value::Null },
                            "depth": item.depth, "isParent": item.branch });
                    }
                }
                if node.data["__kitDropdown"]["multiple"] != true
                    && (node.data["__kitDropdown"]["closeOnlyOnSelect"] != true
                        || items.get(index).is_some())
                    && let Some(state) = self.controls.get_mut(&node.id)
                {
                    state.open = false;
                    state.search.clear();
                }
            } else {
                if state.open && node.data["__kitDropdown"]["closeOnlyOnSelect"] == true {
                    return;
                }
                let open = !state.open;
                self.close_control_popups(Some(&node.id));
                let state = self.controls.entry(node.id.clone()).or_default();
                state.open = open;
                if !open {
                    state.search.clear();
                }
                if open && node.data["__kitDropdown"]["search"] == true {
                    self.events.push(BoardEvent {
                        id: node.id.clone(),
                        kind: kind.into(),
                        action: wire::BoardAction::Focus,
                        value: json!({"__kitDropdownSearch": true}),
                    });
                }
            }
        } else if kind == "tabs" {
            let options = node.options("items");
            let index = (point.x / node.width * options.len().max(1) as f32)
                .floor()
                .max(0.0) as usize;
            if point.y < 40.0 && index < options.len() {
                self.controls.entry(node.id.clone()).or_default().active = index;
                self.set_value(&node.id, json!(options[index]));
            }
        } else if kind == "checkbox" || kind == "switch" {
            let checked = self
                .controls
                .get(&node.id)
                .and_then(|s| s.value.as_bool())
                .unwrap_or(node.data["checked"] == true);
            self.set_value(&node.id, json!(!checked));
        } else if kind == "input" || kind == "search" {
            self.focus = Some(node.id.clone());
            let value = self
                .controls
                .get(&node.id)
                .map(|s| s.value.clone())
                .unwrap_or(Value::Null);
            self.events.push(BoardEvent {
                id: node.id,
                kind: kind.into(),
                action: wire::BoardAction::Focus,
                value,
            });
        } else if matches!(
            kind,
            "upload" | "colorPicker" | "iframe" | "video" | "audio" | "monitor" | "carouselVideo"
        ) {
            let action = match kind {
                "iframe" => wire::BoardAction::Open,
                "video" | "audio" | "monitor" | "carouselVideo" => wire::BoardAction::Media,
                "upload" => wire::BoardAction::Upload,
                _ => wire::BoardAction::ColorPicker,
            };
            self.events.push(BoardEvent {
                id: node.id.clone(),
                kind: kind.into(),
                action,
                value: Value::Null,
            });
        } else if kind == "carousel" || kind == "pdf" {
            // 山海鲸轮播图「切换按钮」/ 基础PDF「翻页按钮 + 点击切换下一页」：value -1=上一页 1=下一页
            let page = if kind == "carousel" {
                let arrows = node.data["arrows"].as_str().unwrap_or("always");
                if arrows == "never"
                    || (arrows == "hover" && node.data["__dwHovered"].as_bool() != Some(true))
                {
                    0.0
                } else {
                    let size = node.number("buttonSize", 30.0).clamp(16.0, 120.0);
                    let outside = node.data["buttonPosition"].as_str() == Some("outside");
                    let (prev, next) = carousel_button_rects(node.rect(), size, outside);
                    if prev.contains(point) {
                        -1.0
                    } else if next.contains(point) {
                        1.0
                    } else {
                        0.0
                    }
                }
            } else {
                let size = node.number("buttonSize", 28.0).clamp(16.0, 120.0);
                let (prev, next) = pdf_button_rects(node.rect(), size);
                if prev.contains(point) {
                    -1.0
                } else if next.contains(point) {
                    1.0
                } else if node.data["clickNext"].as_bool().unwrap_or(false) {
                    1.0
                } else {
                    0.0
                }
            };
            if page != 0.0 {
                self.events.push(BoardEvent {
                    id: node.id.clone(),
                    kind: kind.into(),
                    action: wire::BoardAction::Page,
                    value: json!(page),
                });
            }
        } else if kind == "tree" {
            let entries = tree_rows(&node, self.controls.get(&node.id));
            let index = ((point.y - 8.0) / 27.0).floor().max(0.0) as usize;
            if let Some((root, is_root, text)) = entries.get(index) {
                if *is_root {
                    let state = self.controls.entry(node.id.clone()).or_default();
                    if !state.collapsed.remove(root) {
                        state.collapsed.insert(*root);
                    }
                } else {
                    self.set_value(&node.id, json!(text));
                }
            }
        } else if kind == "twin2d" {
            if let Some(zones) = node.data["zones"].as_array() {
                let area = node.rect().shrink(12.0);
                let at = pos2(
                    (point.x - area.min.x) / area.width() * 600.0,
                    (point.y - area.min.y) / area.height() * 360.0,
                );
                for zone in zones.iter().take(50).rev() {
                    if zone_rect(zone).contains(at) {
                        self.set_value(&node.id, zone["label"].clone());
                        break;
                    }
                }
            }
        }
    }

    fn slide(&mut self, node: &BoardNode, point: Pos2) {
        let min = node.number("min", 0.0);
        let max = node
            .number(
                "max",
                if node.widget.kind == "timeProgress" {
                    86400.0
                } else {
                    100.0
                },
            )
            .max(min + 1.0);
        let step = node
            .number(
                "step",
                if node.widget.kind == "timeProgress" {
                    60.0
                } else {
                    1.0
                },
            )
            .max(0.001);
        let track = slider_track(node.rect().shrink(14.0));
        let fraction = ((point.x - track.min.x) / track.width().max(1.0)).clamp(0.0, 1.0);
        let value = (min + ((max - min) * fraction / step).round() * step).clamp(min, max);
        self.set_value(&node.id, json!(value));
    }

    pub fn set_value(&mut self, id: &str, value: Value) {
        let Some(node) = self.document.nodes.iter().find(|n| n.id == id) else {
            return;
        };
        let state = self.controls.entry(id.into()).or_default();
        if node.data["__kitDropdown"]["search"] == true
            && let Some(query) = value["__kitDropdownSearch"].as_str()
        {
            state.search = query.chars().take(512).collect();
            state.popup_offset = 0;
            if value["__kitDropdownClose"] == true {
                state.open = false;
                state.search.clear();
            }
            return;
        }
        if state.value == value {
            return;
        }
        state.value = value.clone();
        self.events.push(BoardEvent {
            id: id.into(),
            kind: node.widget.kind.clone(),
            action: wire::BoardAction::Change,
            value,
        });
    }

    pub(super) fn popup_rect(&self, node: &BoardNode) -> Rect {
        if node.data["__kitDropdown"].is_object() {
            let (top, _, bottom) = dropdown_padding(node);
            let header =
                number(&node.data["__kitDropdown"]["headerHeight"], 30.0).clamp(0.0, node.height);
            return Rect::from_min_size(
                pos2(0.0, header),
                vec2(
                    node.width,
                    dropdown_visible_count(node, self.dropdown_options(node).len()) as f32
                        * dropdown_row_height(node)
                        + top
                        + bottom,
                ),
            );
        }
        Rect::from_min_size(
            pos2(0.0, node.height + 4.0),
            vec2(node.width, node.options("options").len() as f32 * 29.0),
        )
    }

    pub(super) fn paint_popup(&self, p: &Painter, node: &BoardNode) {
        if !matches!(node.widget.kind.as_str(), "dropdown" | "timePicker") {
            return;
        }
        if self.paint_kit_dropdown_popup(p, node) {
            return;
        }
        let rect = self.popup_rect(node);
        p.rect_filled(rect, 5.0, color("#16273bf7"));
        p.rect_stroke(
            rect,
            5.0,
            Stroke::new(1.0, color("#284a6d")),
            StrokeKind::Inside,
        );
        for (i, option) in node.options("options").iter().enumerate() {
            let row = Rect::from_min_size(
                rect.min + vec2(0.0, i as f32 * 29.0),
                vec2(rect.width(), 29.0),
            );
            if self
                .controls
                .get(&node.id)
                .is_some_and(|s| s.value.as_str() == Some(option))
            {
                p.rect_filled(row, 0.0, color("#2563eb4d"));
            }
            label(p, row.min + vec2(12.0, 7.0), 13.0, option, TEXT);
        }
    }

    pub(super) fn paint_control(&self, p: &Painter, node: &BoardNode, body: Rect) {
        let r = node.rect();
        let w = &node.widget;
        let state = self.controls.get(&node.id);
        let value = state.map_or(Value::Null, |s| s.value.clone());
        let display = if value.is_null() {
            w.text.clone()
        } else {
            string(&value)
        };
        match w.kind.as_str() {
            "dropdown" | "timePicker" => {
                if self.paint_kit_dropdown(p, node) {
                    return;
                }
                // 原生 ComboBox 只画收起态：没有指针事件时弹层永远不会打开，
                // 选项弹层仍由 paint_popup / pointer() 自研路径负责。
                let mut ui = self.paint_ui(p, node, r, "combo");
                ui.style_mut().spacing.button_padding = vec2(14.0, 0.0);
                ui.style_mut().spacing.interact_size = vec2(body.width(), r.height());
                egui::ComboBox::from_id_salt("selected")
                    .width(body.width())
                    .selected_text(RichText::new(display).size(14.0).color(TEXT))
                    .show_ui(&mut ui, |_| {});
            }
            "tabs" | "groupPanel" => {
                let items = node.options("items");
                let active = state
                    .map_or(0, |s| s.active)
                    .min(items.len().saturating_sub(1));
                let header = Rect::from_min_size(r.min, vec2(r.width(), 38.0));
                p.rect_filled(header, 0.0, color("#ffffff0a"));
                line(
                    p,
                    header.left_bottom(),
                    header.right_bottom(),
                    1.0,
                    color("#284a6d"),
                );
                let mut ui = self.paint_ui(p, node, r, "panel");
                if w.kind == "tabs" {
                    let width = r.width() / items.len().max(1) as f32;
                    for (i, item) in items.iter().enumerate() {
                        let tab =
                            Rect::from_min_size(pos2(i as f32 * width, 0.0), vec2(width, 38.0));
                        ui.put(
                            tab,
                            Button::selectable(
                                i == active,
                                RichText::new(item).size(14.0).color(if i == active {
                                    Color32::WHITE
                                } else {
                                    MUTED
                                }),
                            ),
                        );
                        if i == active {
                            line(p, tab.left_bottom(), tab.right_bottom(), 2.0, ACCENT);
                        }
                    }
                    label(
                        p,
                        pos2(16.0, 52.0),
                        14.0,
                        items.get(active).cloned().unwrap_or_default(),
                        TEXT,
                    );
                    for (i, fraction) in [0.82, 0.64, 0.73].iter().enumerate() {
                        p.rect_filled(
                            Rect::from_min_size(
                                pos2(16.0, 83.0 + i as f32 * 22.0),
                                vec2((r.width() - 32.0) * fraction, 12.0),
                            ),
                            3.0,
                            color("#ffffff10"),
                        );
                    }
                } else {
                    label(p, pos2(14.0, 10.0), 15.0, &w.text, TEXT);
                    for (i, item) in items.iter().enumerate() {
                        let rect = Rect::from_min_size(
                            pos2(14.0, 48.0 + i as f32 * 36.0),
                            vec2(r.width() - 28.0, 29.0),
                        );
                        put_row(&mut ui, rect, |ui| {
                            ui.add(Button::selectable(
                                false,
                                RichText::new(item).size(13.0).color(TEXT),
                            ));
                        });
                    }
                }
            }
            "list" | "menuVertical" | "menuHorizontal" => {
                let items = node.options("items");
                let horizontal = w.kind == "menuHorizontal";
                let mut ui = self.paint_ui(p, node, r, "menu");
                for (i, item) in items.iter().enumerate() {
                    let cell = if horizontal {
                        vec2(r.width() / items.len().max(1) as f32, r.height())
                    } else {
                        vec2(r.width(), 34.0)
                    };
                    let rect = Rect::from_min_size(
                        if horizontal {
                            pos2(i as f32 * cell.x, 0.0)
                        } else {
                            pos2(0.0, i as f32 * cell.y)
                        },
                        cell,
                    );
                    let active = item == &w.text || (i == 0 && !items.contains(&w.text));
                    put_row(&mut ui, rect, |ui| {
                        ui.add(Button::selectable(
                            active && w.kind != "list",
                            RichText::new(item).size(13.0).color(TEXT),
                        ));
                    });
                }
            }
            "dialog" => {
                p.rect_filled(
                    Rect::from_min_size(r.min, vec2(r.width(), 40.0)),
                    0.0,
                    color("#ffffff0d"),
                );
                let mut ui = self.paint_ui(p, node, r, "dialog");
                // 标题栏对齐 egui Window 的做法：标题 Label + 关闭 Button（都是原生件）
                put_row(
                    &mut ui,
                    Rect::from_min_max(pos2(14.0, 0.0), pos2(r.max.x - 40.0, 40.0)),
                    |ui| ui.add(Label::new(RichText::new(&w.text).size(15.0).color(TEXT))),
                );
                let buttons = dialog_buttons(r);
                ui.put(
                    buttons[0].0,
                    Button::new(RichText::new("×").size(16.0).color(MUTED))
                        .fill(Color32::TRANSPARENT),
                );
                put_row(
                    &mut ui,
                    Rect::from_min_max(pos2(14.0, 40.0), pos2(r.max.x - 14.0, r.max.y - 48.0)),
                    |ui| ui.add(Label::new(RichText::new(&w.value).size(14.0).color(TEXT))),
                );
                for (i, (text, fill)) in [("取消", color("#284a6d")), ("确定", color("#2563eb"))]
                    .into_iter()
                    .enumerate()
                {
                    ui.put(
                        buttons[i + 1].0,
                        Button::new(RichText::new(text).size(13.0).color(TEXT))
                            .fill(fill)
                            .corner_radius(egui::CornerRadius::from(4.0)),
                    );
                }
            }
            "input" | "search" => {
                let focused = self.focus.as_ref() == Some(&node.id);
                let mut text = if value.is_null() {
                    String::new()
                } else {
                    string(&value)
                };
                let field = if w.kind == "search" {
                    let center = pos2(17.0, r.center().y - 2.0);
                    p.circle_stroke(center, 5.0, Stroke::new(1.5, MUTED));
                    line(
                        p,
                        pos2(21.0, r.center().y + 2.0),
                        pos2(25.0, r.center().y + 6.0),
                        1.5,
                        MUTED,
                    );
                    Rect::from_min_max(pos2(body.min.x + 20.0, body.min.y), body.max)
                } else {
                    Rect::from_min_max(pos2(body.min.x, body.min.y), body.max)
                };
                // 原生 TextEdit 只承担展示与占位：键盘输入走 DOM textarea（IME），事件不进 egui。
                let mut ui = self.paint_ui(p, node, r, "edit");
                put_row(&mut ui, field, |ui| {
                    ui.add(
                        TextEdit::singleline(&mut text)
                            .hint_text(RichText::new(&w.text).size(14.0).color(MUTED))
                            .font(FontSelection::FontId(FontId::proportional(14.0)))
                            .text_color(if value.is_null() || value == "" {
                                MUTED
                            } else {
                                TEXT
                            })
                            .desired_width(field.width())
                            .frame(egui::Frame::NONE),
                    );
                });
                if focused {
                    p.rect_stroke(
                        r.shrink(1.0),
                        w.radius,
                        Stroke::new(1.0, ACCENT),
                        StrokeKind::Inside,
                    );
                }
            }
            "progress" => {
                let percent = node.number("percent", 0.0).clamp(0.0, 100.0);
                label(p, body.min, 14.0, &w.text, TEXT);
                label(
                    p,
                    pos2(body.max.x - 46.0, body.min.y),
                    16.0,
                    format!("{percent}%"),
                    TEXT,
                );
                let track = Rect::from_min_size(
                    pos2(body.min.x, body.center().y + 5.0),
                    vec2(body.width(), 10.0),
                );
                let mut ui = self.paint_ui(p, node, track, "progress");
                ui.add(
                    ProgressBar::new(percent as f32 / 100.0)
                        .fill(ACCENT)
                        .desired_height(10.0)
                        .corner_radius(egui::CornerRadius::from(5.0)),
                );
            }
            "checkbox" => {
                let mut checked = value.as_bool().unwrap_or(node.data["checked"] == true);
                let mut ui = self.paint_ui(p, node, r, "checkbox");
                // 未选中框底色：原生 Checkbox 的 inactive 填充默认透明，给个深色底保证可见。
                ui.style_mut().visuals.widgets.inactive.bg_fill = color("#16273b");
                ui.put(
                    body,
                    Checkbox::new(&mut checked, RichText::new(&w.text).size(14.0).color(TEXT)),
                );
            }
            "switch" => {
                let checked = value.as_bool().unwrap_or(node.data["checked"] == true);
                let mut ui = self.paint_ui(p, node, r, "switch");
                ui.put(
                    body,
                    Switch::new(checked, RichText::new(&w.text).size(14.0).color(TEXT)),
                );
            }
            "slider" | "timeProgress" => {
                let min = node.number("min", 0.0);
                let max = node
                    .number("max", if w.kind == "slider" { 100.0 } else { 86400.0 })
                    .max(min + 1.0);
                let default = if w.kind == "slider" { 50.0 } else { 43200.0 };
                let mut value =
                    f64::from(number(&value, node.number("value", default)).clamp(min, max));
                let track = slider_track(body);
                let rail = Rect::from_min_max(
                    pos2(track.min.x, body.center().y - 11.0),
                    pos2(track.max.x, body.center().y + 11.0),
                );
                let mut ui = self.paint_ui(p, node, rail, "slider");
                // 原生 Slider 轨宽取 spacing.slider_width（默认 100px），撑满滑轨区；
                // 轨道 / 手柄填充用 inactive.bg_fill，尾段填充由 slider_trailing_fill 打开。
                ui.style_mut().spacing.slider_width = rail.width();
                ui.style_mut().visuals.slider_trailing_fill = true;
                ui.style_mut().visuals.widgets.inactive.bg_fill = color("#42516b");
                let mut slider =
                    Slider::new(&mut value, f64::from(min)..=f64::from(max)).show_value(false);
                if w.kind == "timeProgress" {
                    slider = slider.custom_formatter(|v, _| duration(v)[..5].to_owned());
                }
                ui.add(slider);
                label(
                    p,
                    pos2(track.max.x + 12.0, body.center().y - 8.0),
                    13.0,
                    if w.kind == "timeProgress" {
                        duration(f64::from(value as f32))[..5].to_owned()
                    } else {
                        format!("{:.1}", value as f32)
                            .trim_end_matches('0')
                            .trim_end_matches('.')
                            .to_owned()
                    },
                    TEXT,
                );
            }
            "colorPicker" => {
                let tint = value.as_str().unwrap_or("#4b9eff").to_owned();
                egui::widgets::color_picker::show_color_at(
                    p,
                    color(&tint),
                    Rect::from_min_size(body.min, vec2(35.0, body.height())),
                );
                label(
                    p,
                    pos2(body.min.x + 48.0, body.center().y - 8.0),
                    14.0,
                    tint,
                    TEXT,
                );
            }
            "upload" => {
                let status = if let Some(status) = self.statuses.get(&node.id) {
                    status.clone()
                } else if let Some(files) = value.as_array() {
                    files.iter().map(string).collect::<Vec<_>>().join("、")
                } else if value.is_null() {
                    "未选择文件".into()
                } else {
                    display.clone()
                };
                let mut ui = self.paint_ui(p, node, r, "upload");
                ui.put(
                    body,
                    Label::new(
                        RichText::new(format!("↑ {}   {}", w.text, status))
                            .size(14.0)
                            .color(TEXT),
                    ),
                );
            }
            "timeRange" => {
                let options = node.options("options");
                let mut ui = self.paint_ui(p, node, r, "timerange");
                ui.put(
                    body,
                    Label::new(
                        RichText::new(format!(
                            "{}  ~  {}",
                            options.first().map_or("08:00", String::as_str),
                            options.get(1).map_or("20:00", String::as_str)
                        ))
                        .size(14.0)
                        .color(TEXT),
                    ),
                );
            }
            "iframe" => {
                label(p, pos2(12.0, 9.0), 12.0, string(&node.data["url"]), MUTED);
                let text = if node.data["url"].as_str().unwrap_or("").is_empty() {
                    "请设置网页地址"
                } else {
                    "在浏览器中打开网页 ↗"
                };
                let mut ui = self.paint_ui(p, node, r, "iframe");
                ui.put(body, Label::new(RichText::new(text).size(14.0).color(TEXT)));
            }
            "tree" => {
                let Some(items) = node.data["items"].as_array() else {
                    return;
                };
                let collapsed = state.map(|s| s.collapsed.clone()).unwrap_or_default();
                let mut ui = self.paint_ui(p, node, r, "tree");
                ui.add_space(8.0);
                for (index, item) in items.iter().take(30).enumerate() {
                    let text = item.get("label").map_or_else(|| string(item), string);
                    let children = if collapsed.contains(&index) {
                        Vec::new()
                    } else {
                        item["children"]
                            .as_array()
                            .map(|rows| rows.iter().take(30).map(string).collect::<Vec<_>>())
                            .unwrap_or_default()
                    };
                    if children.is_empty() && item["children"].as_array().is_none() {
                        // 叶子根节点：普通行，无折叠三角
                        tree_row(
                            &mut ui,
                            RichText::new(&text).size(14.0).color(if value == text {
                                ACCENT
                            } else {
                                TEXT
                            }),
                        );
                        continue;
                    }
                    // CollapsingState = 原生折叠头状态机：三角箭头 / 缩进 / 开合动画都是原生的；
                    // 开合状态仍由自研 collapsed 集合驱动（每帧 set_open），header 点击响应照旧丢弃。
                    let id = ui.id().with(("tree-root", index));
                    let mut branch = egui::containers::collapsing_header::CollapsingState::
                        load_with_default_open(ui.ctx(), id, true);
                    branch.set_open(!collapsed.contains(&index));
                    branch.store(ui.ctx());
                    let header = branch.show_header(&mut ui, |ui| {
                        tree_row(ui, RichText::new(&text).size(14.0).color(TEXT));
                    });
                    if !children.is_empty() {
                        header.body(|ui| {
                            for child in &children {
                                tree_row(
                                    ui,
                                    RichText::new(child).size(14.0).color(if value == *child {
                                        ACCENT
                                    } else {
                                        TEXT
                                    }),
                                );
                            }
                        });
                    }
                }
            }
            "button" => {
                let size = w.font_size.max(10.0);
                let mut rich = RichText::new(&w.text).size(size).color(color(&node.color));
                if w.font_family.to_ascii_lowercase().contains("mono")
                    || w.font_family.contains("Courier")
                {
                    rich = rich.font(FontId::monospace(size));
                }
                if w.font_weight >= 600 {
                    rich = rich.strong();
                }
                let mut ui = self.paint_ui(p, node, r, "button");
                ui.put(
                    r,
                    Button::new(rich)
                        .fill(color(&w.background))
                        .corner_radius(egui::CornerRadius::from(w.radius.clamp(0.0, 60.0)))
                        .min_size(vec2(r.width(), r.height())),
                );
            }
            "twin2d" => {
                p.rect_filled(body, 0.0, color("#101f30"));
                p.rect_stroke(
                    body.shrink(5.0),
                    0.0,
                    Stroke::new(1.0, MUTED),
                    StrokeKind::Inside,
                );
                if let Some(zones) = node.data["zones"].as_array() {
                    for zone in zones.iter().take(50) {
                        let zone_rect = zone_rect(zone);
                        let scale = vec2(body.width() / 600.0, body.height() / 360.0);
                        let rect = Rect::from_min_max(
                            body.min + zone_rect.min.to_vec2() * scale,
                            body.min + zone_rect.max.to_vec2() * scale,
                        );
                        let tint = color(zone["color"].as_str().unwrap_or("#4b9eff"));
                        p.rect_filled(rect, 3.0, tint.gamma_multiply(0.45));
                        p.rect_stroke(rect, 3.0, Stroke::new(1.0, tint), StrokeKind::Inside);
                        centered(p, rect, 13.0, string(&zone["label"]), TEXT);
                    }
                }
            }
            _ => {} // sync rejects unknown kinds; all supported kinds are handled explicitly.
        }
    }
}

fn slider_track(body: Rect) -> Rect {
    Rect::from_min_size(
        pos2(body.min.x, body.center().y - 3.0),
        vec2((body.width() - 75.0).max(1.0), 6.0),
    )
}

fn tree_rows(node: &BoardNode, state: Option<&super::ControlState>) -> Vec<(usize, bool, String)> {
    let mut rows = Vec::new();
    if let Some(items) = node.data["items"].as_array() {
        for (index, item) in items.iter().take(30).enumerate() {
            rows.push((
                index,
                true,
                item.get("label").map_or_else(|| string(item), string),
            ));
            if !state.is_some_and(|s| s.collapsed.contains(&index)) {
                if let Some(children) = item["children"].as_array() {
                    rows.extend(children.iter().take(30).map(|child| {
                        (
                            index,
                            false,
                            child.get("label").map_or_else(|| string(child), string),
                        )
                    }));
                }
            }
        }
    }
    rows
}

fn zone_rect(zone: &Value) -> Rect {
    let x = number(&zone["x"], 30.0).clamp(0.0, 580.0);
    let y = number(&zone["y"], 30.0).clamp(0.0, 340.0);
    Rect::from_min_size(
        pos2(x, y),
        vec2(
            number(&zone["width"], 100.0).clamp(10.0, 600.0 - x),
            number(&zone["height"], 80.0).clamp(10.0, 360.0 - y),
        ),
    )
}
