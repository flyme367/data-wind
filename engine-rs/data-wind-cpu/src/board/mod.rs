//! Shared Rust renderer for every board component, including picking and runtime control values.
//!
//! The browser supplies scene data, decoded media and input. Geometry, text layout, painting and
//! rasterization are owned here; editor, published viewer and PNG export use this same scene.

mod charts;
mod controls;
mod kit;
mod maps;
mod native;
mod raster;
mod weather;
mod widgets;

use std::collections::{HashMap, HashSet};

use egui::{Color32, CornerRadius, Painter, Pos2, Rect, Stroke, Ui, UiBuilder, Vec2, vec2};
use serde_json::Value;

pub use raster::Rasterizer;

use crate::protocol::wire;

/// Kept explicit so tests can compare the Rust renderer with the editor's entire widget catalog.
pub const WIDGET_KINDS: &[&str] = &[
    "text",
    "metric",
    "bar",
    "line",
    "pie",
    "image",
    "button",
    "clock",
    "table",
    "dropdown",
    "groupPanel",
    "list",
    "dialog",
    "tabs",
    "menuVertical",
    "menuHorizontal",
    "search",
    "progress",
    "iframe",
    "weather",
    "barGradient",
    "barGrouped",
    "barStacked",
    "barPercent",
    "barHorizontal",
    "barHorizontalStacked",
    "lineSmooth",
    "lineMulti",
    "area",
    "areaGradient",
    "areaStacked",
    "dualAxis",
    "radar",
    "radarFilled",
    "pieBasic",
    "pieRose",
    "scatter",
    "bubble",
    "gauge",
    "waterball",
    "funnel",
    "heatmap",
    "bar3dGrouped",
    "bar3dStacked",
    "pie3d",
    "donut3d",
    "rose3d",
    "roseRing3d",
    "calendar",
    "timer",
    "timeline",
    "timePicker",
    "timeRange",
    "shape",
    "flipCounter",
    "dataChange",
    "tableBasic",
    "tableIndex",
    "report",
    "textMultiline",
    "wordCloud",
    "carousel",
    "video",
    "audio",
    "monitor",
    "carouselVideo",
    "pdf",
    "mapRegion",
    "mapPoint",
    "mapFlyline",
    "mapHeat",
    "mapTrack",
    "mapBar",
    "mapOutline",
    "mapTile",
    "twin2d",
    "checkbox",
    "input",
    "switch",
    "slider",
    "timeProgress",
    "colorPicker",
    "upload",
    "tree",
    "topology",
];

#[derive(Clone, Default)]
pub struct WidgetStyle {
    pub kind: String,
    pub text: String,
    pub value: String,
    pub unit: String,
    pub font_size: f32,
    pub background: String,
    pub border_color: String,
    pub opacity: f32,
    pub radius: f32,
    pub image: String,
    pub align: String,
    pub font_family: String,
    pub font_weight: u16,
    pub italic: bool,
    pub underline: bool,
    pub line_height: f32,
    pub letter_spacing: f32,
    pub border_style: String,
    pub border_width: f32,
    pub shadow_color: String,
    pub shadow_blur: f32,
    pub shadow_offset_x: f32,
    pub shadow_offset_y: f32,
}

impl WidgetStyle {
    fn from_wire(item: wire::WidgetStyle<'_>) -> Self {
        let string = |value: Option<&str>| value.unwrap_or_default().to_owned();
        Self {
            kind: string(item.kind()),
            text: string(item.text()),
            value: string(item.value()),
            unit: string(item.unit()),
            font_size: item.font_size(),
            background: string(item.background()),
            border_color: string(item.border_color()),
            opacity: item.opacity(),
            radius: item.radius(),
            image: string(item.image()),
            align: string(item.align()),
            font_family: string(item.font_family()),
            font_weight: item.font_weight(),
            italic: item.italic(),
            underline: item.underline(),
            line_height: item.line_height(),
            letter_spacing: item.letter_spacing(),
            border_style: string(item.border_style()),
            border_width: item.border_width(),
            shadow_color: string(item.shadow_color()),
            shadow_blur: item.shadow_blur(),
            shadow_offset_x: item.shadow_offset_x(),
            shadow_offset_y: item.shadow_offset_y(),
        }
    }
}

#[derive(Clone, Default)]
pub struct BoardNode {
    pub id: String,
    pub name: String,
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    pub rotation: f32,
    pub color: String,
    pub locked: bool,
    pub widget: WidgetStyle,
    pub data: Value,
}

impl BoardNode {
    pub fn rect(&self) -> Rect {
        Rect::from_min_size(Pos2::ZERO, vec2(self.width.max(1.0), self.height.max(1.0)))
    }

    pub fn local(&self, point: Pos2) -> Pos2 {
        let center = self.rect().center();
        let delta = point - vec2(self.x, self.y) - center.to_vec2();
        center + egui::emath::Rot2::from_angle(-self.rotation.to_radians()) * delta.to_vec2()
    }

    pub fn world(&self, point: Pos2) -> Pos2 {
        let center = self.rect().center();
        center
            + egui::emath::Rot2::from_angle(self.rotation.to_radians()) * (point - center)
            + vec2(self.x, self.y)
    }

    pub fn options(&self, key: &str) -> Vec<String> {
        let limit = if key == "options" && self.data["__kitDropdown"].is_object() {
            5000
        } else {
            30
        };
        self.data[key].as_array().map_or_else(
            || vec![self.widget.text.clone()],
            |items| {
                items
                    .iter()
                    .take(limit)
                    .map(string)
                    .filter(|v| !v.is_empty())
                    .collect()
            },
        )
    }

    pub fn number(&self, key: &str, default: f32) -> f32 {
        number(&self.data[key], default)
    }

    pub fn is_control(&self) -> bool {
        self.data["__kitMenu"].is_object()
            || self.data["__kitClose"].is_object()
            || self.data["__kitTable"].is_object()
            || matches!(
                self.widget.kind.as_str(),
                "dropdown"
                    | "timePicker"
                    | "tabs"
                    | "checkbox"
                    | "input"
                    | "search"
                    | "switch"
                    | "slider"
                    | "timeProgress"
                    | "colorPicker"
                    | "upload"
                    | "tree"
                    | "twin2d"
                    | "video"
                    | "audio"
                    | "monitor"
                    | "carouselVideo"
                    | "pdf"
                    | "carousel"
                    | "iframe"
            )
    }
}

#[derive(Clone, Default)]
pub struct BoardDocument {
    pub width: f32,
    pub height: f32,
    pub preview: bool,
    pub selected: Vec<String>,
    pub nodes: Vec<BoardNode>,
}

impl BoardDocument {
    /// Decode a verified CommandRequest(BoardSync).
    pub fn from_wire(payload: wire::BoardSync<'_>) -> Self {
        Self {
            width: payload.width(),
            height: payload.height(),
            preview: payload.preview(),
            selected: payload
                .selected()
                .map(|ids| ids.iter().map(str::to_owned).collect())
                .unwrap_or_default(),
            nodes: payload
                .nodes()
                .map(|nodes| nodes.iter().map(BoardNode::from_wire).collect())
                .unwrap_or_default(),
        }
    }
}

impl BoardNode {
    fn from_wire(item: wire::BoardNodeWire<'_>) -> Self {
        Self {
            id: item.id().to_owned(),
            name: item.name().unwrap_or_default().to_owned(),
            x: item.x(),
            y: item.y(),
            width: item.width(),
            height: item.height(),
            rotation: item.rotation(),
            color: item.color().unwrap_or_default().to_owned(),
            locked: item.locked(),
            widget: item
                .widget()
                .map(WidgetStyle::from_wire)
                .unwrap_or_default(),
            data: item
                .data()
                .as_ref()
                .map(crate::protocol::json_value_from_wire)
                .unwrap_or(Value::Null),
        }
    }
}

#[derive(Clone, Default)]
pub struct Clock {
    pub time: String,
    pub year: u32,
    pub month: u32,
    pub day: u32,
    pub first_weekday: u32,
    pub days: u32,
    pub now: f64,
}

impl Clock {
    /// Decode a verified CommandRequest(BoardClock)。
    pub(crate) fn from_wire(payload: wire::BoardClock<'_>) -> Self {
        Self {
            time: payload.time().unwrap_or_default().to_owned(),
            year: payload.year(),
            month: payload.month(),
            day: payload.day(),
            first_weekday: payload.first_weekday(),
            days: payload.days(),
            now: payload.now(),
        }
    }
}

#[derive(Clone, Default)]
pub(super) struct ControlState {
    pub source: Value,
    pub value: Value,
    pub active: usize,
    pub open: bool,
    pub popup_offset: usize,
    pub menu_offset: usize,
    pub search: String,
    pub collapsed: HashSet<usize>,
    pub tree_expanded: HashSet<String>,
    pub ripple: Option<ButtonRipple>,
}

#[derive(Clone)]
pub(super) struct ButtonRipple {
    pub start: f64,
    pub duration: f64,
    pub center: Pos2,
}

#[derive(Clone)]
struct MenuScrollDrag {
    id: String,
    origin: f32,
    offset: usize,
    max_offset: usize,
    travel: f32,
    vertical: bool,
}

#[derive(Clone, Debug)]
pub struct BoardEvent {
    pub id: String,
    pub kind: String,
    pub action: wire::BoardAction,
    pub value: Value,
}

#[derive(Clone, Debug)]
pub struct Hit {
    pub id: String,
    pub handle: Option<&'static str>,
    pub control: bool,
}

pub struct BoardFrame {
    pub primitives: Vec<egui::ClippedPrimitive>,
    pub textures: egui::TexturesDelta,
}

pub struct BoardScene {
    pub document: BoardDocument,
    pub context: egui::Context,
    pub(super) controls: HashMap<String, ControlState>,
    pub(super) events: Vec<BoardEvent>,
    pub(super) images: HashMap<String, egui::TextureHandle>,
    pub(super) statuses: HashMap<String, String>,
    countries: Vec<maps::Country>,
    pub(super) focus: Option<String>,
    pub(super) pressed: Option<String>,
    chart_pointer: Option<Pos2>,
    chart_layouts: HashMap<String, charts::ChartLayout>,
    chart_clock: f64,
    chart_hidden: HashMap<String, HashSet<usize>>,
    chart_legend_pages: HashMap<String, usize>,
    chart_zoom_ranges: HashMap<String, charts::zoom::ZoomRange>,
    chart_zoom_drag: Option<charts::zoom::ZoomDrag>,
    menu_scroll_drag: Option<MenuScrollDrag>,
}

const LEGEND_LEFT_IMAGE_PREFIX: &str = "\u{1f}legend-left:";
const LEGEND_RIGHT_IMAGE_PREFIX: &str = "\u{1f}legend-right:";
const TOOLTIP_IMAGE_PREFIX: &str = "\u{1f}tooltip:";
const POINT_IMAGE_PREFIX: &str = "\u{1f}point:";
const CITY_IMAGE_PREFIX: &str = "\u{1f}city:";

impl Default for BoardScene {
    fn default() -> Self {
        Self {
            document: BoardDocument::default(),
            context: egui::Context::default(),
            controls: HashMap::new(),
            events: Vec::new(),
            images: HashMap::new(),
            statuses: HashMap::new(),
            countries: Vec::new(),
            focus: None,
            pressed: None,
            chart_pointer: None,
            chart_layouts: HashMap::new(),
            chart_clock: 0.0,
            chart_hidden: HashMap::new(),
            chart_legend_pages: HashMap::new(),
            chart_zoom_ranges: HashMap::new(),
            chart_zoom_drag: None,
            menu_scroll_drag: None,
        }
    }
}

impl BoardScene {
    pub fn sync(&mut self, document: BoardDocument) -> Result<(), String> {
        if !document.width.is_finite()
            || !document.height.is_finite()
            || document.width <= 0.0
            || document.height <= 0.0
        {
            return Err("看板尺寸无效".into());
        }
        for node in &document.nodes {
            if !WIDGET_KINDS.contains(&node.widget.kind.as_str()) {
                return Err(format!("Rust 渲染器不支持组件：{}", node.widget.kind));
            }
            if [node.x, node.y, node.width, node.height, node.rotation]
                .iter()
                .any(|v| !v.is_finite())
            {
                return Err(format!("组件「{}」的位置或尺寸无效", node.name));
            }
            let state = self.controls.entry(node.id.clone()).or_default();
            if !control_source_matches(&state.source, node)
                || self.document.preview != document.preview
            {
                // Hover only changes button visibility and must not reset persistent controls.
                let mut source_data = node.data.clone();
                if let Some(object) = source_data.as_object_mut() {
                    object.remove("__dwHovered");
                    object.remove("__dwEntrance");
                    object.remove("__kitListClip");
                }
                *state = ControlState {
                    source: serde_json::json!([node.widget.kind, node.widget.text, source_data]),
                    value: node.data.get("value").cloned().unwrap_or(Value::Null),
                    ..ControlState::default()
                };
            }
        }
        let active_ids: HashSet<&str> =
            document.nodes.iter().map(|node| node.id.as_str()).collect();
        self.controls
            .retain(|id, _| active_ids.contains(id.as_str()));
        self.images.retain(|id, _| {
            let owner = id
                .strip_prefix(LEGEND_LEFT_IMAGE_PREFIX)
                .or_else(|| id.strip_prefix(LEGEND_RIGHT_IMAGE_PREFIX))
                .or_else(|| id.strip_prefix(TOOLTIP_IMAGE_PREFIX))
                .or_else(|| id.strip_prefix(CITY_IMAGE_PREFIX))
                .or_else(|| {
                    id.strip_prefix(POINT_IMAGE_PREFIX)
                        .and_then(|value| value.split_once(':').map(|(_, owner)| owner))
                })
                .unwrap_or(id);
            active_ids.contains(owner)
        });
        self.statuses
            .retain(|id, _| active_ids.contains(id.as_str()));
        self.chart_hidden
            .retain(|id, _| active_ids.contains(id.as_str()));
        self.chart_legend_pages
            .retain(|id, _| active_ids.contains(id.as_str()));
        self.chart_zoom_ranges.retain(|id, _| {
            let before = self.document.nodes.iter().find(|node| &node.id == id);
            let after = document.nodes.iter().find(|node| &node.id == id);
            matches!((before, after), (Some(old), Some(new))
                if old.widget.kind == new.widget.kind
                    && old.data["chart"]["showDataZoom"] == new.data["chart"]["showDataZoom"]
                    && charts::zoom::configured_range(old) == charts::zoom::configured_range(new))
        });
        self.chart_layouts.clear();
        if !document.preview || self.document.preview != document.preview {
            self.chart_pointer = None;
            self.chart_hidden.clear();
            self.chart_legend_pages.clear();
            self.chart_zoom_ranges.clear();
            self.chart_zoom_drag = None;
            self.menu_scroll_drag = None;
        }
        self.document = document;
        Ok(())
    }

    pub fn set_font(&self, bytes: Vec<u8>) -> Result<(), String> {
        if bytes.len() < 12 {
            return Err("看板字体文件不完整".into());
        }
        let mut fonts = egui::FontDefinitions::default();
        fonts
            .font_data
            .insert("board-cjk".into(), egui::FontData::from_owned(bytes).into());
        for family in [egui::FontFamily::Proportional, egui::FontFamily::Monospace] {
            fonts
                .families
                .entry(family)
                .or_default()
                .push("board-cjk".into());
        }
        self.context.set_fonts(fonts);
        Ok(())
    }

    pub fn set_image(
        &mut self,
        id: &str,
        width: usize,
        height: usize,
        rgba: &[u8],
    ) -> Result<(), String> {
        if width == 0
            || height == 0
            || width.checked_mul(height).and_then(|n| n.checked_mul(4)) != Some(rgba.len())
            || rgba.len() > 64 * 1024 * 1024
        {
            return Err("媒体像素尺寸无效".into());
        }
        let image = egui::ColorImage::from_rgba_unmultiplied([width, height], rgba);
        if let Some(texture) = self.images.get_mut(id) {
            texture.set(image, egui::TextureOptions::LINEAR);
        } else {
            self.images.insert(
                id.into(),
                self.context
                    .load_texture(id, image, egui::TextureOptions::LINEAR),
            );
        }
        Ok(())
    }

    pub fn clear_image(&mut self, id: &str) {
        self.images.remove(id);
        self.statuses.remove(id);
    }

    pub fn set_status(&mut self, id: &str, message: &str) {
        if message.is_empty() {
            self.statuses.remove(id);
        } else {
            self.statuses.insert(id.to_owned(), message.to_owned());
        }
    }

    pub fn focus_node(&mut self, id: Option<&str>) {
        self.focus = id
            .filter(|id| self.document.nodes.iter().any(|node| &node.id == id))
            .map(str::to_owned);
    }

    pub fn activate(&mut self, id: &str) {
        if let Some(node) = self.document.nodes.iter().find(|node| node.id == id) {
            let center = node.world(node.rect().center());
            self.pointer("down", center);
            self.pointer("up", center);
        }
    }

    pub fn frame(&mut self, clock: &Clock, width: u32, height: u32, selection: bool) -> BoardFrame {
        let ctx = self.context.clone();
        let scale = vec2(
            width as f32 / self.document.width,
            height as f32 / self.document.height,
        );
        let input = egui::RawInput {
            screen_rect: Some(Rect::from_min_size(
                Pos2::ZERO,
                vec2(self.document.width, self.document.height),
            )),
            time: Some(clock.now / 1000.0),
            ..Default::default()
        };
        // 注意：保持 ppp=1 在文档坐标系细分（与 software.rs 的 tessellate(...,1.0) 约定一致），
        // 文档→画布的 scale 在顶点变换时统一乘上，勿在此设 pixels_per_point（会二次缩放）。
        ctx.begin_pass(input);
        let mut chart_layouts = HashMap::new();
        let batches = self.capture_batches(&ctx, clock, selection, &mut chart_layouts);
        let output = ctx.end_pass();
        let primitives =
            Self::finalize_batches(&ctx, batches, scale, output.pixels_per_point, clock);
        self.chart_layouts = chart_layouts;
        self.chart_clock = clock.now;
        BoardFrame {
            primitives,
            textures: output.textures_delta,
        }
    }

    /// bevy_egui 路径（`EguiContextSettings::run_manually`）：在引擎侧上下文上手动驱动一次
    /// 完整 pass，产出**画布像素坐标**的 FullOutput（ppp=1，shapes 已含世界变换×缩放+透明度），
    /// 由调用方写回 `EguiFullOutput` 交给 bevy_egui 渲染。与 [`Self::frame`] 共用绘制与变换数学。
    pub fn run_pass_into(
        &mut self,
        clock: &Clock,
        canvas: egui::Vec2,
        selection: bool,
    ) -> egui::FullOutput {
        let ctx = self.context.clone();
        let scale = vec2(
            canvas.x / self.document.width,
            canvas.y / self.document.height,
        );
        let input = egui::RawInput {
            screen_rect: Some(Rect::from_min_size(Pos2::ZERO, canvas)),
            time: Some(clock.now / 1000.0),
            ..Default::default()
        };
        ctx.begin_pass(input);
        let mut chart_layouts = HashMap::new();
        let batches = self.capture_batches(&ctx, clock, selection, &mut chart_layouts);
        let output = ctx.end_pass();
        let primitives = Self::finalize_batches(&ctx, batches, scale, 1.0, clock);
        self.chart_layouts = chart_layouts;
        self.chart_clock = clock.now;
        let shapes = primitives
            .into_iter()
            .map(|primitive| {
                let shape = match primitive.primitive {
                    egui::epaint::Primitive::Mesh(mesh) => {
                        egui::Shape::Mesh(std::sync::Arc::new(mesh))
                    }
                    egui::epaint::Primitive::Callback(cb) => egui::Shape::Callback(cb),
                };
                egui::epaint::ClippedShape {
                    clip_rect: Rect::EVERYTHING,
                    shape,
                }
            })
            .collect();
        egui::FullOutput {
            platform_output: output.platform_output,
            textures_delta: output.textures_delta,
            shapes,
            pixels_per_point: 1.0,
            ..output
        }
    }

    /// 逐节点文档坐标绘制并按层捕获 shapes（必须在 egui pass 内调用）。
    fn capture_batches(
        &self,
        ctx: &egui::Context,
        clock: &Clock,
        selection: bool,
        chart_layouts: &mut HashMap<String, charts::ChartLayout>,
    ) -> Vec<(&BoardNode, Vec<egui::epaint::ClippedShape>)> {
        let mut batches = Vec::new();
        let chart_hover = self.chart_pointer.and_then(|point| {
            self.hit_test_at(point, clock.now)
                .map(|hit| (hit.id, point))
        });
        for node in &self.document.nodes {
            let layer = egui::LayerId::new(egui::Order::Middle, egui::Id::new(&node.id));
            let painter = egui::Painter::new(ctx.clone(), layer, node.rect().expand(600.0));
            let hover = chart_hover
                .as_ref()
                .filter(|(id, _)| id == &node.id)
                .and_then(|(_, point)| self.local_hit_point(node, *point, clock.now));
            let mut layout = None;
            self.paint_widget(&painter, node, clock, hover, &mut layout);
            if let Some(layout) = layout {
                chart_layouts.insert(node.id.clone(), layout);
            }
            if selection && !self.document.preview && self.document.selected.contains(&node.id) {
                widgets::selection(&painter, node);
            }
            let list = ctx.graphics_mut(|layers| std::mem::take(layers.entry(layer)));
            batches.push((node, list.all_entries().cloned().collect::<Vec<_>>()));
        }
        // Popups paint after every component, regardless of the owning component's layer order.
        if self.document.preview {
            for node in &self.document.nodes {
                if self.controls.get(&node.id).is_some_and(|s| s.open) {
                    let layer = egui::LayerId::new(
                        egui::Order::Foreground,
                        egui::Id::new(("popup", &node.id)),
                    );
                    let painter = egui::Painter::new(ctx.clone(), layer, Rect::EVERYTHING);
                    self.paint_popup(&painter, node);
                    let list = ctx.graphics_mut(|layers| std::mem::take(layers.entry(layer)));
                    batches.push((node, list.all_entries().cloned().collect()));
                }
            }
        }
        batches
    }

    /// tessellate（ppp=1 文档坐标系）→ 节点世界变换 × 文档→画布缩放 → 透明度。
    fn finalize_batches(
        ctx: &egui::Context,
        batches: Vec<(&BoardNode, Vec<egui::epaint::ClippedShape>)>,
        scale: egui::Vec2,
        pixels_per_point: f32,
        clock: &Clock,
    ) -> Vec<egui::ClippedPrimitive> {
        let screen = Rect::EVERYTHING;
        let mut primitives = Vec::new();
        for (node, shapes) in batches {
            let (opacity, animation_scale, offset) = entrance_transform(node, clock.now);
            let list_clip = kit_list_clip(node).map(|clip| {
                Rect::from_min_max(
                    (clip.min.to_vec2() * scale).to_pos2(),
                    (clip.max.to_vec2() * scale).to_pos2(),
                )
            });
            for primitive in ctx.tessellate(shapes, pixels_per_point) {
                if let egui::epaint::Primitive::Mesh(mesh) = primitive.primitive {
                    let mut mesh = raster::clip_mesh(&mesh, primitive.clip_rect);
                    for vertex in &mut mesh.vertices {
                        let center = node.rect().center();
                        let local = center + (vertex.pos - center) * animation_scale + offset;
                        vertex.pos = (node.world(local).to_vec2() * scale).to_pos2();
                        vertex.color = vertex
                            .color
                            .gamma_multiply(node.widget.opacity.clamp(0.0, 1.0) * opacity);
                    }
                    if let Some(clip) = list_clip {
                        mesh = raster::clip_mesh(&mesh, clip);
                    }
                    primitives.push(egui::ClippedPrimitive {
                        clip_rect: screen,
                        primitive: egui::epaint::Primitive::Mesh(mesh),
                    });
                }
            }
        }
        primitives
    }

    pub fn hit_test(&self, point: Pos2) -> Option<Hit> {
        self.hit_test_at(point, self.chart_clock)
    }

    fn local_hit_point(&self, node: &BoardNode, point: Pos2, now: f64) -> Option<Pos2> {
        let point = node.local(point);
        if !self.document.preview {
            return Some(point);
        }
        let (opacity, scale, offset) = entrance_transform(node, now);
        let center = node.rect().center();
        (opacity > 0.0).then(|| center + (point - center - offset) / scale)
    }

    fn hit_test_at(&self, point: Pos2, now: f64) -> Option<Hit> {
        if self.document.preview {
            for node in self.document.nodes.iter().rev() {
                if self.controls.get(&node.id).is_some_and(|s| s.open)
                    && self
                        .local_hit_point(node, point, now)
                        .is_some_and(|local| self.popup_rect(node).contains(local))
                {
                    return Some(Hit {
                        id: node.id.clone(),
                        handle: None,
                        control: true,
                    });
                }
            }
        }
        for node in self.document.nodes.iter().rev() {
            if node.data["__kitDecoration"] == true
                || (!self.document.preview && node.data["__kitPanelTab"].is_string())
            {
                continue;
            }
            if self.document.preview
                && kit_list_clip(node).is_some_and(|clip| !clip.contains(point))
            {
                continue;
            }
            let Some(local) = self.local_hit_point(node, point, now) else {
                continue;
            };
            if !self.document.preview && !node.locked && self.document.selected.contains(&node.id) {
                for (handle, center) in handles(node.rect()) {
                    if Rect::from_center_size(center, Vec2::splat(14.0)).contains(local) {
                        return Some(Hit {
                            id: node.id.clone(),
                            handle: Some(handle),
                            control: false,
                        });
                    }
                }
            }
            if node.rect().contains(local)
                || (self.document.preview
                    && matches!(node.widget.kind.as_str(), "carousel" | "pdf")
                    && widgets::media_hit_rect(node).contains(local))
                || (self.document.preview
                    && node.data["__kitMenu"].is_object()
                    && kit::kit_menu_item(
                        node,
                        local,
                        self.controls
                            .get(&node.id)
                            .map_or(0, |state| state.menu_offset),
                    )
                    .is_some())
            {
                // 山海鲸「鼠标穿透」：预览/发布时开启穿透的组件不拦截点击（编辑态仍可选中）
                if self.document.preview
                    && node.data.get("passThrough").and_then(Value::as_bool) == Some(true)
                {
                    continue;
                }
                return Some(Hit {
                    id: node.id.clone(),
                    handle: None,
                    control: node.is_control()
                        || (self.document.preview
                            && self
                                .chart_layouts
                                .get(&node.id)
                                .is_some_and(|layout| layout.zoom_hit(local).is_some())),
                });
            }
        }
        None
    }

    pub fn take_events(&mut self) -> Vec<BoardEvent> {
        std::mem::take(&mut self.events)
    }
}

fn kit_list_clip(node: &BoardNode) -> Option<Rect> {
    let clip = node.data.get("__kitListClip")?;
    let x = clip.get("x")?.as_f64()? as f32;
    let y = clip.get("y")?.as_f64()? as f32;
    let width = clip.get("width")?.as_f64()? as f32;
    let height = clip.get("height")?.as_f64()? as f32;
    if ![x, y, width, height].iter().all(|value| value.is_finite()) || width <= 0.0 || height <= 0.0
    {
        return None;
    }
    Some(Rect::from_min_size(Pos2::new(x, y), vec2(width, height)))
}

fn control_source_matches(source: &Value, node: &BoardNode) -> bool {
    let Some([Value::String(kind), Value::String(text), previous]) =
        source.as_array().map(Vec::as_slice)
    else {
        return false;
    };
    if kind != &node.widget.kind || text != &node.widget.text {
        return false;
    }
    match (previous.as_object(), node.data.as_object()) {
        (Some(previous), Some(current)) => {
            let visible_len = current.len()
                - usize::from(current.contains_key("__dwHovered"))
                - usize::from(current.contains_key("__dwEntrance"))
                - usize::from(current.contains_key("__kitListClip"));
            previous.len() == visible_len
                && previous
                    .iter()
                    .all(|(key, value)| current.get(key) == Some(value))
        }
        _ => previous == &node.data,
    }
}

fn entrance_transform(node: &BoardNode, now: f64) -> (f32, f32, Vec2) {
    let mut opacity = 1.0_f32;
    let mut scale = 1.0_f32;
    let mut offset = Vec2::ZERO;
    let Some(animations) = node.data["__dwEntrance"].as_array() else {
        return (opacity, scale, offset);
    };
    for animation in animations.iter().take(8) {
        let start = animation["startAt"].as_f64().unwrap_or(now);
        let delay = animation["delay"]
            .as_f64()
            .unwrap_or(0.0)
            .clamp(0.0, 120_000.0);
        let duration = animation["duration"]
            .as_f64()
            .unwrap_or(1000.0)
            .clamp(0.0, 120_000.0);
        let elapsed = now - start - delay;
        let t = if elapsed < 0.0 {
            0.0
        } else if duration <= 0.0 {
            1.0
        } else {
            (elapsed / duration).clamp(0.0, 1.0) as f32
        };
        let eased = match animation["easing"].as_str().unwrap_or("exponentialIn") {
            "linear" => t,
            "exponentialOut" => {
                if t >= 1.0 {
                    1.0
                } else {
                    1.0 - 2.0_f32.powf(-10.0 * t)
                }
            }
            "easeInOut" => t * t * (3.0 - 2.0 * t),
            _ => {
                if t <= 0.0 {
                    0.0
                } else {
                    2.0_f32.powf(10.0 * t - 10.0)
                }
            }
        };
        opacity *= eased;
        let remaining = 1.0 - eased;
        match animation["animation"].as_str().unwrap_or("fade") {
            "slideLeft" => offset.x -= node.width * 0.3 * remaining,
            "slideRight" => offset.x += node.width * 0.3 * remaining,
            "slideUp" => offset.y -= node.height * 0.3 * remaining,
            "slideDown" => offset.y += node.height * 0.3 * remaining,
            "zoom" => scale *= 0.7 + 0.3 * eased,
            _ => {}
        }
    }
    (opacity, scale, offset)
}

/// egui 原生控件的看板主题：深色 visuals 对齐手绘色板，圆角跟随组件配置。
/// 未选中按钮/行默认透明填充，由各控件分支按需给出填充色。
pub(super) fn board_style(radius: f32) -> egui::Style {
    let mut style = egui::Style::default();
    style.visuals = egui::Visuals::dark();
    for state in [
        &mut style.visuals.widgets.inactive,
        &mut style.visuals.widgets.hovered,
        &mut style.visuals.widgets.active,
        &mut style.visuals.widgets.open,
    ] {
        state.corner_radius = CornerRadius::from(radius.clamp(0.0, 60.0));
        // 默认主题的按钮 frame 填充取 weak_bg_fill，不置透明会出现 egui 默认灰底。
        state.weak_bg_fill = Color32::TRANSPARENT;
    }
    style.visuals.widgets.inactive.fg_stroke = Stroke::new(1.0, TEXT);
    style.visuals.widgets.inactive.bg_fill = Color32::TRANSPARENT;
    style.visuals.widgets.hovered.bg_fill = ACCENT.gamma_multiply(0.55);
    style.visuals.widgets.active.bg_fill = ACCENT;
    style.visuals.selection.bg_fill = ACCENT.gamma_multiply(0.4);
    style.visuals.selection.stroke = Stroke::new(1.0, Color32::WHITE);
    style.visuals.extreme_bg_color = color("#0a1522");
    style.visuals.faint_bg_color = color("#ffffff08");
    style.visuals.window_fill = color("#16273bf7");
    style.visuals.panel_fill = color("#14283de6");
    style.spacing.item_spacing = Vec2::ZERO;
    // 看板按需渲染（有脏标记才出帧），动画管理器会冻结在中间帧（如树的折叠三角）；
    // 关掉动画让状态立即到位。
    style.animation_time = 0.0;
    style.spacing.button_padding = vec2(12.0, 6.0);
    style.spacing.icon_spacing = 8.0;
    style.spacing.icon_width = 18.0;
    style.spacing.icon_width_inner = 12.0;
    style
}

impl BoardScene {
    /// 在组件自己的 layer 里跑 egui 原生控件：`frame()` 按同一 layer 捕获 shapes，
    /// 原生控件的绘制因此进入 BoardFrame（弹层类 Area 除外，仍走自研路径）。
    /// 交互不经过 egui——Response 一律丢弃，点击 / 拖拽仍由 `pointer()` 自研协议驱动。
    pub(super) fn paint_ui(
        &self,
        p: &Painter,
        node: &BoardNode,
        rect: Rect,
        scope: impl std::hash::Hash + std::fmt::Debug,
    ) -> egui::Ui {
        egui::Ui::new(
            self.context.clone(),
            egui::Id::new((scope, &node.id)),
            egui::UiBuilder::new()
                .layer_id(p.layer_id())
                .max_rect(rect)
                .style(board_style(node.widget.radius)),
        )
    }
}

/// 在 rect 内左对齐、垂直居中放置内容：`Ui::put` 是水平居中 + 主轴 justify，
/// 行式控件（列表 / 菜单 / 树 / 输入行）需要左对齐。
pub(super) fn put_row<R>(ui: &mut Ui, rect: Rect, add: impl FnOnce(&mut Ui) -> R) -> R {
    ui.scope_builder(
        UiBuilder::new()
            .max_rect(rect)
            .layout(egui::Layout::left_to_right(egui::Align::Center)),
        add,
    )
    .inner
}

pub(super) fn handles(r: Rect) -> [(&'static str, Pos2); 8] {
    [
        ("nw", r.left_top()),
        ("n", r.center_top()),
        ("ne", r.right_top()),
        ("e", r.right_center()),
        ("se", r.right_bottom()),
        ("s", r.center_bottom()),
        ("sw", r.left_bottom()),
        ("w", r.left_center()),
    ]
}

pub(super) fn number(value: &Value, fallback: f32) -> f32 {
    let result = value
        .as_f64()
        .map(|v| v as f32)
        .or_else(|| value.as_str().and_then(|v| v.parse().ok()))
        .unwrap_or(fallback);
    if result.is_finite() { result } else { fallback }
}

pub(super) fn string(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(s) => s.clone(),
        v => v.to_string(),
    }
}

pub(super) fn color(value: &str) -> Color32 {
    if value == "transparent" {
        return Color32::TRANSPARENT;
    }
    let Some(hex) = value.strip_prefix('#') else {
        return Color32::from_rgb(108, 188, 255);
    };
    let full = if hex.len() == 3 {
        hex.chars().flat_map(|c| [c, c]).collect()
    } else {
        hex.to_owned()
    };
    let byte = |i| {
        full.get(i..i + 2)
            .and_then(|v| u8::from_str_radix(v, 16).ok())
            .unwrap_or(0)
    };
    Color32::from_rgba_unmultiplied(
        byte(0),
        byte(2),
        byte(4),
        if full.len() == 8 { byte(6) } else { 255 },
    )
}

pub(super) const MUTED: Color32 = Color32::from_rgb(144, 172, 193);
pub(super) const TEXT: Color32 = Color32::from_rgb(205, 227, 247);
pub(super) const ACCENT: Color32 = Color32::from_rgb(75, 158, 255);
pub(super) const PALETTE: [Color32; 7] = [
    ACCENT,
    Color32::from_rgb(61, 219, 181),
    Color32::from_rgb(232, 176, 75),
    Color32::from_rgb(167, 139, 250),
    Color32::from_rgb(244, 114, 182),
    Color32::from_rgb(103, 224, 255),
    Color32::from_rgb(251, 146, 60),
];
