#[path = "../../data-wind-cpu/src/board/mod.rs"]
#[allow(dead_code)]
mod board;
#[path = "../../data-wind-cpu/src/common.rs"]
#[allow(dead_code)]
mod common;
#[path = "../../data-wind-cpu/src/protocol.rs"]
#[allow(dead_code)]
mod protocol;

use board::{BoardNode, BoardScene, Clock, Rasterizer, WidgetStyle};
use serde_json::{Value, json};

fn node(kind: &str) -> BoardNode {
    BoardNode {
        id: "component".into(),
        name: "测试组件".into(),
        x: 10.0,
        y: 10.0,
        width: 360.0,
        height: 220.0,
        rotation: 0.0,
        color: "#6cbcff".into(),
        locked: false,
        widget: WidgetStyle {
            kind: kind.into(),
            text: "中文设备遥测".into(),
            value: "1286".into(),
            unit: "项".into(),
            font_size: 24.0,
            background: "#14283de6".into(),
            border_color: "#284a6d".into(),
            opacity: 1.0,
            radius: 6.0,
            align: "left".into(),
            border_style: "solid".into(),
            border_width: 1.0,
            shadow_color: "transparent".into(),
            ..WidgetStyle::default()
        },
        data: json!({
            "rows": [{"name":"温度", "value":36, "value2":24, "value3":8, "lon":116.4, "lat":39.9},
                {"name":"压力", "value":80, "value2":42, "value3":16, "lon":121.5, "lat":31.2},
                {"name":"流量", "value":60, "value2":30, "value3":10, "lon":103.8, "lat":1.35}],
            "options": ["设备 A", "设备 B"], "items": ["采集", "分析", "告警"],
            "percent":68, "change":"+12%", "shape":"triangle", "checked":false,
            "zones":[{"x":30,"y":30,"width":180,"height":120,"label":"车间","color":"#4b9eff"}]
        }),
    }
}

fn sync(scene: &mut BoardScene, nodes: Vec<BoardNode>, preview: bool, selected: Vec<&str>) {
    scene
        .sync(board::BoardDocument {
            width: 400.0,
            height: 300.0,
            preview,
            selected: selected.into_iter().map(str::to_owned).collect(),
            nodes,
        })
        .expect("valid document");
}

#[test]
fn dialog_buttons_emit_the_clicked_action_in_local_coordinates() {
    let mut scene = BoardScene::default();
    let mut dialog = node("dialog");
    dialog.rotation = 35.0;
    sync(&mut scene, vec![dialog.clone()], true, vec![]);
    let actions = [
        (egui::pos2(337.0, 20.0), "close"),
        (egui::pos2(233.0, 192.0), "cancel"),
        (egui::pos2(310.0, 192.0), "confirm"),
    ];
    for (local, action) in actions {
        let point = dialog.world(local);
        scene.pointer("down", point);
        scene.pointer("up", point);
        let events = scene.take_events();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].action, protocol::wire::BoardAction::Change);
        assert_eq!(events[0].value["__dwDialogAction"], action);
    }
    let body = dialog.world(egui::pos2(100.0, 100.0));
    scene.pointer("down", body);
    scene.pointer("up", body);
    assert!(scene.take_events().is_empty());
}

fn clock() -> Clock {
    Clock {
        time: "12:34:56".into(),
        year: 2026,
        month: 11,
        day: 1,
        first_weekday: 0,
        days: 30,
        now: 1_793_500_000_000.0,
    }
}

/// Run explicitly in release mode to compare bevy_egui's current static-frame path with a cache.
#[test]
#[ignore = "manual performance measurement"]
fn benchmark_static_board_render_output() {
    use std::hint::black_box;
    use std::time::Instant;

    let mut scene = BoardScene::default();
    scene
        .set_font(include_bytes!("../../data-wind-cpu/assets/NotoSansSC-Regular.otf").to_vec())
        .expect("bundled CJK font");
    scene
        .set_geojson(
            serde_json::from_str(include_str!(
                "../../../frontend/public/gis/ne_110m_admin_0_countries.geojson"
            ))
            .expect("real map boundaries"),
        )
        .expect("valid geography");
    let mut nodes = Vec::new();
    for i in 0..20 {
        let mut item = node(if i % 2 == 0 { "text" } else { "bar" });
        item.id = format!("item-{i}");
        nodes.push(item);
    }
    let mut map = node("mapRegion");
    map.id = "map".into();
    nodes.push(map);
    sync(&mut scene, nodes, false, vec![]);
    let output = scene.run_pass_into(&clock(), egui::vec2(1600.0, 900.0), false);
    let context = scene.context.clone();
    let cached = context.tessellate(output.shapes.clone(), output.pixels_per_point);
    let mesh_vertices: usize = cached
        .iter()
        .map(|primitive| match &primitive.primitive {
            egui::epaint::Primitive::Mesh(mesh) => mesh.vertices.len(),
            egui::epaint::Primitive::Callback(_) => 0,
        })
        .sum();
    const ITERATIONS: usize = 50;
    let start = Instant::now();
    for _ in 0..ITERATIONS {
        black_box(context.tessellate(black_box(output.shapes.clone()), output.pixels_per_point));
    }
    let tessellation = start.elapsed();
    let start = Instant::now();
    for _ in 0..ITERATIONS {
        let copy: Vec<egui::ClippedPrimitive> = black_box(&cached).clone();
        black_box(copy);
    }
    let cache = start.elapsed();
    eprintln!(
        "static board: {} shapes, {} batches, {mesh_vertices} vertices; \
         {ITERATIONS} frames: tessellate={tessellation:?}, clone={cache:?}",
        output.shapes.len(),
        cached.len()
    );
}

/// Measures repeated syncs with stable component data and a large component catalog.
#[test]
#[ignore = "manual performance measurement"]
fn benchmark_board_sync() {
    use std::time::Instant;

    let mut nodes = Vec::new();
    for i in 0..1000 {
        let mut item = node(if i % 2 == 0 { "text" } else { "bar" });
        item.id = format!("item-{i}");
        nodes.push(item);
    }
    let document = board::BoardDocument {
        width: 400.0,
        height: 300.0,
        preview: false,
        selected: vec![],
        nodes,
    };
    let mut scene = BoardScene::default();
    scene
        .sync(document.clone())
        .expect("valid initial document");
    let documents: Vec<_> = (0..30).map(|_| document.clone()).collect();
    let start = Instant::now();
    for document in documents {
        scene.sync(document).expect("valid document");
    }
    eprintln!("board sync: 1000 nodes, 30 updates: {:?}", start.elapsed());
}

#[test]
fn new_map_kinds_render_loaded_geography() {
    for kind in ["mapRegion", "mapOutline", "mapTile"] {
        let render = |loaded: bool| {
            let mut scene = BoardScene::default();
            scene
                .set_font(
                    include_bytes!("../../data-wind-cpu/assets/NotoSansSC-Regular.otf").to_vec(),
                )
                .expect("bundled CJK font");
            if loaded {
                scene
                    .set_geojson(json!({"features": [{
                        "properties": {"NAME": "test", "DATASET": "world"},
                        "geometry": {"type": "Polygon", "coordinates": [
                            [[-40, -20], [40, -20], [40, 20], [-40, 20], [-40, -20]]
                        ]}
                    }]}))
                    .expect("valid geography");
            }
            let mut map = node(kind);
            map.data = json!({"region": "world", "theme": "black-gold"});
            sync(&mut scene, vec![map], false, vec![]);
            let mut frame = scene.frame(&clock(), 400, 300, false);
            Rasterizer::default().render(&mut frame, 400, 300)
        };
        assert!(
            render(false) != render(true),
            "{kind} must render loaded geography"
        );
    }
}

#[test]
fn every_catalog_kind_generates_finite_rust_geometry_and_pixels() {
    let mut scene = BoardScene::default();
    scene
        .set_font(include_bytes!("../../data-wind-cpu/assets/NotoSansSC-Regular.otf").to_vec())
        .expect("bundled CJK font");
    scene
        .set_geojson(
            serde_json::from_str(include_str!(
                "../../../frontend/public/gis/ne_110m_admin_0_countries.geojson"
            ))
            .expect("real map boundaries"),
        )
        .expect("real map boundaries");
    let mut raster = Rasterizer::default();
    for kind in board::WIDGET_KINDS {
        sync(&mut scene, vec![node(kind)], false, vec![]);
        let mut frame = scene.frame(&clock(), 400, 300, false);
        assert!(!frame.primitives.is_empty(), "{kind} generates geometry");
        for primitive in &frame.primitives {
            if let egui::epaint::Primitive::Mesh(mesh) = &primitive.primitive {
                assert!(
                    mesh.vertices
                        .iter()
                        .all(|v| v.pos.is_finite() && v.uv.is_finite()),
                    "{kind}: {:?}",
                    mesh.vertices
                        .iter()
                        .filter(|v| !v.pos.is_finite() || !v.uv.is_finite())
                        .take(3)
                        .collect::<Vec<_>>()
                );
            }
        }
        let pixels = raster.render(&mut frame, 400, 300);
        assert_eq!(pixels.len(), 400 * 300 * 4);
        assert!(
            pixels.chunks_exact(4).any(|p| p[3] > 100),
            "{kind} is visible"
        );
    }
}

#[test]
fn fractional_cartesian_data_keeps_the_same_proportions_as_integer_data() {
    fn render(kind: &str, variant: &str, factor: f64) -> Vec<u8> {
        let mut scene = BoardScene::default();
        let mut chart = node(kind);
        chart.data["chart"] = json!({"variant": variant, "seriesCount": 2,
            "showXAxis": false, "showYAxis": false, "showGrid": false, "showLegend": false});
        chart.data["rows"] = json!([
            {"name": "A", "value": 0.2 * factor, "value2": 0.3 * factor},
            {"name": "B", "value": 0.4 * factor, "value2": 0.1 * factor}
        ]);
        sync(&mut scene, vec![chart], false, vec![]);
        let mut frame = scene.frame(&clock(), 400, 300, false);
        Rasterizer::default().render(&mut frame, 400, 300)
    }
    for (kind, variant) in [
        ("barGrouped", ""),
        ("barPercent", ""),
        ("barHorizontalStacked", "horizontalPercent"),
    ] {
        assert_eq!(
            render(kind, variant, 1.0),
            render(kind, variant, 10.0),
            "{kind}"
        );
    }
}

#[test]
fn cartesian_label_options_affect_the_rendered_text() {
    fn render(kind: &str, options: Value, rows: Value) -> Vec<u8> {
        let mut scene = BoardScene::default();
        scene
            .set_font(include_bytes!("../../data-wind-cpu/assets/NotoSansSC-Regular.otf").to_vec())
            .expect("bundled font");
        let mut chart = node(kind);
        chart.data["chart"] = options;
        chart.data["rows"] = rows;
        sync(&mut scene, vec![chart], false, vec![]);
        let mut frame = scene.frame(&clock(), 400, 300, false);
        Rasterizer::default().render(&mut frame, 400, 300)
    }
    let rows = json!([
        {"name": "甲", "value": 0.36, "value2": 0.24, "value3": 0.12},
        {"name": "乙", "value": 0.80, "value2": 0.42, "value3": 0.28}
    ]);
    for kind in ["barGrouped", "barHorizontalStacked", "dualAxis", "line"] {
        let base = render(
            kind,
            json!({"showLabels": true, "seriesCount": 2}),
            rows.clone(),
        );
        for options in [
            json!({"showLabels": true, "seriesCount": 2, "labelFormat": "percent"}),
            json!({"showLabels": true, "seriesCount": 2, "labelOffsetX": 20, "labelOffsetY": 8}),
            json!({"showLabels": true, "seriesCount": 2, "labelColorMode": "follow"}),
            json!({"showLabels": true, "seriesCount": 2, "labelFollowDataColor": true}),
            json!({"showLabels": true, "seriesCount": 2, "labelTilt": 45}),
        ] {
            assert_ne!(base, render(kind, options, rows.clone()), "{kind}");
        }
        assert_ne!(
            render(
                kind,
                json!({"showLabels": true, "seriesCount": 2, "unit": "万"}),
                rows.clone()
            ),
            render(
                kind,
                json!({"showLabels": true, "seriesCount": 2, "unit": "万",
                "labelUnitSize": 25, "labelUnitColor": "#ff0000"}),
                rows.clone()
            ),
            "{kind} unit styling"
        );
        if kind != "line" {
            for options in [
                json!({"showLabels": true, "seriesCount": 2, "labelPosition": "inside"}),
                json!({"showLabels": true, "seriesCount": 2, "labelPosition": "top-align"}),
                json!({"showLabels": true, "seriesCount": 2, "labelShowCategory": true}),
                json!({"showLabels": true, "seriesCount": 2, "labelSpacing": -10}),
            ] {
                assert_ne!(base, render(kind, options, rows.clone()), "{kind}");
            }
        }
    }
    let zeros = json!([{"name": "零值", "value": 0, "value2": 0}]);
    for kind in ["barGrouped", "barHorizontalStacked", "line"] {
        let hidden = json!({"showLabels": true, "hideZeroLabels": true, "showLegend": false,
            "showXAxis": false, "showYAxis": false, "showGrid": false, "seriesCount": 2});
        let off = json!({"showLabels": false, "showLegend": false,
            "showXAxis": false, "showYAxis": false, "showGrid": false, "seriesCount": 2});
        assert_eq!(
            render(kind, hidden, zeros.clone()),
            render(kind, off, zeros.clone())
        );
    }
    let no_labels = json!({"seriesCount": 3, "showLegend": false, "showLabels": false});
    let line_only = json!({"seriesCount": 3, "showLegend": false, "showLabels": false,
        "showLineLabels": true});
    let line_top = json!({"seriesCount": 3, "showLegend": false, "showLabels": false,
        "showLineLabels": true, "lineLabelPosition": "top", "lineLabelFormat": "percent",
        "lineLabelColor": "#ff0000", "lineLabelTilt": 30});
    assert_ne!(
        render("dualAxis", no_labels, rows.clone()),
        render("dualAxis", line_only.clone(), rows.clone())
    );
    assert_ne!(
        render("dualAxis", line_only, rows.clone()),
        render("dualAxis", line_top, rows.clone())
    );
    assert_ne!(
        render(
            "dualAxis",
            json!({"seriesCount": 3, "showLabels": true,
            "showLineLabels": false}),
            rows.clone()
        ),
        render(
            "dualAxis",
            json!({"seriesCount": 3, "showLabels": true,
            "showLineLabels": true}),
            rows.clone()
        )
    );
    assert_eq!(
        render(
            "dualAxis",
            json!({"seriesCount": 3, "showLabels": true}),
            rows.clone()
        ),
        render(
            "dualAxis",
            json!({"seriesCount": 3, "showLabels": true, "showLineLabels": true}),
            rows
        )
    );
}

#[test]
fn chart_options_change_rendered_pixels_for_each_chart_family() {
    fn render(kind: &str, settings: Value) -> Vec<u8> {
        let mut scene = BoardScene::default();
        scene
            .set_font(include_bytes!("../../data-wind-cpu/assets/NotoSansSC-Regular.otf").to_vec())
            .expect("bundled font");
        let mut chart = node(kind);
        chart.data["chart"] = settings;
        sync(&mut scene, vec![chart], false, vec![]);
        let mut frame = scene.frame(&clock(), 400, 300, false);
        Rasterizer::default().render(&mut frame, 400, 300)
    }

    let cases = [
        (
            "barGrouped",
            json!({"barWidth": 4, "showGrid": false, "colors": ["#ff0000"]}),
        ),
        ("barHorizontal", json!({"barWidth": 4, "showXAxis": false})),
        (
            "lineSmooth",
            json!({"smooth": false, "lineWidth": 8, "showPoints": false}),
        ),
        ("area", json!({"fillOpacity": 80, "showLabels": true})),
        (
            "pie",
            json!({"innerRadius": 20, "startAngle": 0, "endAngle": 180, "showLegend": false}),
        ),
        ("gauge", json!({"gaugeMax": 200, "gaugeWidth": 60})),
        ("radar", json!({"radarLevels": 8})),
        (
            "heatmap",
            json!({"heatColumns": 2, "cellGap": 8, "showLabels": false}),
        ),
        ("funnel", json!({"funnelGap": 16, "showLabels": false})),
        ("bar3dStacked", json!({"barWidth": 5, "showLegend": false})),
        ("pie3d", json!({"showLegend": false, "colors": ["#ff0000"]})),
    ];
    for (kind, options) in cases {
        assert_ne!(
            render(kind, json!({})),
            render(kind, options),
            "{kind} options must affect pixels"
        );
    }

    for kind in ["barGrouped", "barHorizontal", "line"] {
        let base = render(kind, json!({"showGrid": false}));
        assert_ne!(
            base,
            render(
                kind,
                json!({"showGrid": false, "showGridX": true,
            "gridColorX": "#ff0000"})
            ),
            "{kind} X grid must affect pixels"
        );
        assert_ne!(
            base,
            render(
                kind,
                json!({"showGrid": false, "showGridY": true,
            "gridColorY": "#00ff00"})
            ),
            "{kind} Y grid must affect pixels"
        );
        assert_ne!(
            base,
            render(
                kind,
                json!({"showGrid": false, "referenceLines": [
                    {"value": 20, "name": "目标", "color": "#ff0000", "width": 3, "style": "dashed"}
                ]})
            ),
            "{kind} reference line must affect pixels"
        );
        let dashed = json!({"showGrid": false, "referenceLines": [
            {"value": 20, "name": "目标", "color": "#ff0000", "width": 2,
             "style": "dashed", "dash": 4, "textColor": "#00ff00", "textOffset": [0, 0]}
        ]});
        let mut longer = dashed.clone();
        longer["referenceLines"][0]["dash"] = json!(12);
        assert_ne!(
            render(kind, dashed.clone()),
            render(kind, longer),
            "{kind} dash length"
        );
        let mut moved = dashed.clone();
        moved["referenceLines"][0]["textOffset"] = json!([25, -12]);
        moved["referenceLines"][0]["textColor"] = json!("#0000ff");
        assert_ne!(
            render(kind, dashed),
            render(kind, moved),
            "{kind} text style and offset"
        );
        assert_eq!(
            base,
            render(
                kind,
                json!({"showGrid": false, "referenceLines": [
                    {"value": 1000000, "color": "#ff0000"}
                ]})
            ),
            "out-of-range reference lines must be clipped"
        );
        for axis in ["X", "Y"] {
            let label = format!("showAxisLabel{axis}");
            let line_key = format!("showAxisLine{axis}");
            let line = line_key.as_str();
            let ticks_key = format!("showAxisTicks{axis}");
            let ticks = ticks_key.as_str();
            let line_style = format!("axisLineStyle{axis}");
            let line_style = line_style.as_str();
            let line_dash = format!("axisLineDash{axis}");
            let tick_length = format!("axisTickLength{axis}");
            let grid_key = format!("showGrid{axis}");
            let grid = grid_key.as_str();
            let grid_style = format!("gridStyle{axis}");
            assert_ne!(base, render(kind, json!({"showGrid": false, label: false})));
            assert_ne!(base, render(kind, json!({"showGrid": false, line: true})));
            assert_ne!(base, render(kind, json!({"showGrid": false, ticks: true})));
            assert_ne!(
                render(kind, json!({"showGrid": false, line: true})),
                render(
                    kind,
                    json!({"showGrid": false, line: true, line_style: "dashed"})
                )
            );
            assert_ne!(
                render(
                    kind,
                    json!({"showGrid": false, line: true, line_style: "dottedLine"})
                ),
                render(
                    kind,
                    json!({"showGrid": false, line: true,
                        line_style: "dottedLine", line_dash: [8, 2]})
                )
            );
            assert_ne!(
                render(kind, json!({"showGrid": false, ticks: true})),
                render(
                    kind,
                    json!({"showGrid": false, ticks: true, tick_length: 16})
                )
            );
            assert_ne!(
                render(kind, json!({"showGrid": false, grid: true})),
                render(
                    kind,
                    json!({"showGrid": false, grid: true, grid_style: "dotted"})
                )
            );
            let enabled_key = format!("show{axis}Axis");
            let enabled = enabled_key.as_str();
            assert_eq!(
                render(kind, json!({"showGrid": false, enabled: false})),
                render(
                    kind,
                    json!({"showGrid": false, enabled: false, line: true, ticks: true})
                )
            );
        }
        let numeric = if kind == "barHorizontal" { "X" } else { "Y" };
        let format_key = format!("axisValueFormat{numeric}");
        let digits_key = format!("axisDecimals{numeric}");
        let pad_key = format!("axisPadZeros{numeric}");
        assert_ne!(
            base,
            render(kind, json!({"showGrid": false, format_key: "percent"}))
        );
        assert_ne!(
            base,
            render(
                kind,
                json!({"showGrid": false, digits_key: 2, pad_key: true})
            )
        );
        assert_ne!(
            base,
            render(
                kind,
                json!({"showGrid": false, "showAxisNameY": true, "axisNameY": "单位",
                    "axisNameGapY": -10, "axisNameColorY": "#ff0000"})
            )
        );
    }

    let pie = render("pieBasic", json!({"showLabels": true, "decimals": 2}));
    for option in [
        json!({"showLabels": true, "decimals": 2, "pieSize": 55}),
        json!({"showLabels": true, "decimals": 2, "pieBorderWidth": 4, "pieBorderColor": "#ff0000"}),
        json!({"showLabels": true, "decimals": 2, "labelFormat": "percent"}),
        json!({"showLabels": true, "decimals": 2, "labelPadZeros": false}),
        json!({"showLabels": true, "decimals": 2, "colors": ["#ff0000", "#00ff00"], "paletteCycle": true}),
    ] {
        assert_ne!(
            pie,
            render("pieBasic", option),
            "pie option must change pixels"
        );
    }
    let line = render("line", json!({}));
    for option in [
        json!({"lineStyle": "dashed"}),
        json!({"pointShape": "triangle", "pointRadius": 8}),
        json!({"pointShape": "squareEmpty", "pointRadius": 8}),
        json!({"xAxisFontSize": 22, "xAxisColor": "#ff0000"}),
        json!({"yAxisFontSize": 22, "yAxisColor": "#00ff00"}),
        json!({"kitPadding": [60, 30, 30, 50]}),
        json!({"legendPosition": "left-center"}),
        json!({"legendPosition": "bottom-left"}),
        json!({"legendMarker": "square", "legendMarkerSize": 18, "legendColor": "#ff0000"}),
    ] {
        assert_ne!(
            line,
            render("line", option),
            "line option must change pixels"
        );
    }
    assert_ne!(
        render(
            "barGrouped",
            json!({"legendPosition":"top-left", "legendGap":2})
        ),
        render(
            "barGrouped",
            json!({"legendPosition":"top-left", "legendGap":40})
        ),
        "legend spacing must reflow the items"
    );
    assert_ne!(
        render("pieBasic", json!({"colors":["#ff0000", "#00ff00"]})),
        render(
            "pieBasic",
            json!({"colors":["#ff0000", "#00ff00"], "paletteCycle":true})
        ),
        "short category palettes must cycle when enabled"
    );
    for kind in ["barGrouped", "barHorizontal", "dualAxis"] {
        let base = render(kind, json!({}));
        let rule = json!({"field":"value", "operator":"gte", "value":"60", "series":"1", "color":"#ff0000"});
        assert_ne!(
            base,
            render(kind, json!({"colorConditions":[rule]})),
            "{kind} matching rows must use the condition color"
        );
        assert_eq!(
            base,
            render(
                kind,
                json!({"colorConditions":[
                    {"field":"missing", "operator":"ne", "value":"0", "series":"all", "color":"#ff0000"}
                ]})
            ),
            "missing fields must not match inequality"
        );
        assert_ne!(
            base,
            render(
                kind,
                json!({"colorConditions":[
                    {"field":"name", "operator":"eq", "value":"压力", "series":"all", "color":"#00ff00"}
                ]})
            ),
            "{kind} string comparison must use the raw row"
        );
        let first = json!({"field":"value", "operator":"gte", "value":"0", "series":"all", "color":"#ff0000"});
        let second = json!({"field":"value", "operator":"gte", "value":"0", "series":"all", "color":"#00ff00"});
        assert_eq!(
            render(kind, json!({"colorConditions":[first.clone()]})),
            render(kind, json!({"colorConditions":[first, second]})),
            "the first matching rule must win"
        );
    }
}

#[test]
fn custom_tick_interval_changes_both_axes_and_is_ignored_for_automatic_ranges() {
    fn render(kind: &str, settings: Value) -> Vec<u8> {
        let mut scene = BoardScene::default();
        let mut chart = node(kind);
        chart.data["chart"] = settings;
        sync(&mut scene, vec![chart], false, vec![]);
        let mut frame = scene.frame(&clock(), 400, 300, false);
        Rasterizer::default().render(&mut frame, 400, 300)
    }
    for (kind, suffix) in [("line", "Y"), ("barHorizontal", "X")] {
        let mut settings = json!({"showGrid": true});
        settings[format!("axisRangeMode{suffix}")] = json!("custom");
        settings[format!("axisMin{suffix}")] = json!(-20);
        settings[format!("axisMax{suffix}")] = json!(100);
        settings[format!("axisIntervalMode{suffix}")] = json!("value");
        settings[format!("axisInterval{suffix}")] = json!(20);
        let mut other = settings.clone();
        other[format!("axisInterval{suffix}")] = json!(40);
        assert_ne!(render(kind, settings.clone()), render(kind, other.clone()));
        settings[format!("axisRangeMode{suffix}")] = json!("adaptive");
        other[format!("axisRangeMode{suffix}")] = json!("adaptive");
        assert_eq!(render(kind, settings), render(kind, other));
    }
    let mut right = json!({"seriesCount": 2, "rightAxisStart": 2, "showRightAxis": true,
        "showRightGrid": true, "rightAxisRangeMode": "custom", "rightAxisMin": 0,
        "rightAxisMax": 100, "rightAxisIntervalMode": "number", "rightAxisInterval": 2});
    let before = render("lineMulti", right.clone());
    right["rightAxisInterval"] = json!(5);
    assert_ne!(before, render("lineMulti", right));
}

#[test]
fn axis_label_font_overflow_and_glow_affect_rotated_labels() {
    fn render(options: Value) -> Vec<u8> {
        let mut scene = BoardScene::default();
        let mut chart = node("line");
        chart.data["chart"] = options;
        chart.data["rows"] = json!([
            {"name":"Long category Alpha", "value":10},
            {"name":"Long category Bravo", "value":20}
        ]);
        sync(&mut scene, vec![chart], false, vec![]);
        let mut frame = scene.frame(&clock(), 400, 300, false);
        Rasterizer::default().render(&mut frame, 400, 300)
    }
    let base = json!({"axisLabelRotateX": -45});
    for (key, value) in [
        ("axisFontFamilyX", json!("monospace")),
        ("axisBoldX", json!(true)),
        ("axisItalicX", json!(true)),
        ("axisUnderlineX", json!(true)),
        ("axisStrikeX", json!(true)),
    ] {
        let mut styled = base.clone();
        styled[key] = value;
        assert_ne!(
            render(base.clone()),
            render(styled),
            "{key} must affect pixels"
        );
    }
    let mut truncated = base.clone();
    truncated["axisLabelOverflowX"] = json!(true);
    truncated["axisLabelMaxWidthX"] = json!(35);
    assert_ne!(render(base.clone()), render(truncated));
    let mut glow = base.clone();
    glow["axisLabelShadowColorX"] = json!("#ff0000");
    glow["axisLabelShadowBlurX"] = json!(6);
    glow["axisLabelShadowOffsetX"] = json!([3, -2]);
    assert_ne!(render(base), render(glow));
}

#[test]
fn fractional_pie_values_use_their_total() {
    fn render(values: [f32; 2]) -> Vec<u8> {
        let mut scene = BoardScene::default();
        let mut chart = node("pieBasic");
        chart.data = json!({"chart":{"showLegend":false}, "rows":[
            {"name":"A", "value":values[0]}, {"name":"B", "value":values[1]}
        ]});
        sync(&mut scene, vec![chart], false, vec![]);
        Rasterizer::default().render(&mut scene.frame(&clock(), 400, 300, false), 400, 300)
    }
    assert_eq!(render([0.2, 0.3]), render([20.0, 30.0]));
}

#[test]
fn imported_kit_legend_position_aliases_match_their_explicit_positions() {
    fn render(position: &str) -> Vec<u8> {
        let mut scene = BoardScene::default();
        let mut chart = node("pieBasic");
        chart.widget.text.clear();
        chart.data["__kitChart"] = json!(true);
        chart.data["chart"] = json!({"legendPosition": position});
        sync(&mut scene, vec![chart], false, vec![]);
        Rasterizer::default().render(&mut scene.frame(&clock(), 400, 300, false), 400, 300)
    }
    assert_eq!(render("left"), render("left-center"));
    assert_eq!(render("right"), render("right-center"));
    assert_eq!(render("top"), render("top-center"));
    assert_eq!(render("bottom"), render("bottom-center"));
}

#[test]
fn specialized_charts_render_real_data_and_animation() {
    fn render(kind: &str, rows: Value, settings: Value, now: f64) -> Vec<u8> {
        let mut scene = BoardScene::default();
        scene
            .set_font(include_bytes!("../../data-wind-cpu/assets/NotoSansSC-Regular.otf").to_vec())
            .expect("bundled font");
        let mut chart = node(kind);
        chart.data = json!({ "rows": rows, "chart": settings });
        sync(&mut scene, vec![chart], false, vec![]);
        let mut time = clock();
        time.now = now;
        let mut frame = scene.frame(&time, 400, 300, false);
        for primitive in &frame.primitives {
            if let egui::epaint::Primitive::Mesh(mesh) = &primitive.primitive {
                assert!(mesh.vertices.iter().all(|v| v.pos.is_finite()));
            }
        }
        Rasterizer::default().render(&mut frame, 400, 300)
    }
    let cases = [
        (
            "bar",
            json!([{ "source":"A", "target":"B", "value":40 }, { "source":"B", "target":"C", "value":30 }]),
            json!({"variant":"sankey"}),
            json!({"variant":"sankey", "linkOpacity":90, "nodeWidth":25}),
        ),
        (
            "bar",
            json!([{ "name":"A", "min":10, "q1":25, "median":40, "q3":60, "max":80 }, { "name":"B", "min":5, "q1":20, "median":30, "q3":50, "max":70 }]),
            json!({"variant":"boxplot"}),
            json!({"variant":"boxplot", "barWidth":5}),
        ),
        (
            "pie",
            json!([{ "name":"A", "value":30 }, { "name":"B", "value":60 }]),
            json!({"variant":"jade"}),
            json!({"variant":"jade", "innerRadius":70, "showLegend":false}),
        ),
        (
            "pieBasic",
            json!([{ "name":"A", "value":60, "children":[{"value":30},{"value":30}] }, { "name":"B", "value":40, "children":[{"value":40}] }]),
            json!({"variant":"sunburst"}),
            json!({"variant":"sunburst", "segmentGap":10}),
        ),
        (
            "bar",
            json!([{ "name":"A", "value":100 }, { "name":"B", "value":-40 }]),
            json!({"variant":"waterfall"}),
            json!({"variant":"waterfall", "barWidth":6}),
        ),
        (
            "heatmap",
            json!([{ "name":"A", "value":40 }, { "name":"B", "value":60 }]),
            json!({"variant":"waffle", "heatColumns":10}),
            json!({"variant":"waffle", "heatColumns":5}),
        ),
    ];
    for (kind, rows, base, changed) in cases {
        assert_ne!(
            render(kind, rows.clone(), base, 0.0),
            render(kind, rows, changed, 0.0),
            "{kind} variant"
        );
    }
    let timed = json!([
        {"name":"A","value":10,"period":"一月"}, {"name":"B","value":20,"period":"一月"},
        {"name":"A","value":30,"period":"二月"}, {"name":"B","value":15,"period":"二月"}
    ]);
    let settings = json!({"variant":"dynamicBar", "startAt":0, "duration":2});
    assert_ne!(
        render("barHorizontal", timed.clone(), settings.clone(), 0.0),
        render("barHorizontal", timed, settings, 1000.0)
    );
    let path = json!([{"x":0.1,"y":0.1}, {"x":0.9,"y":0.1}, {"x":0.9,"y":0.9}]);
    let settings = json!({"variant":"pathAnimation", "startAt":0, "duration":2});
    assert_ne!(
        render("line", path.clone(), settings.clone(), 0.0),
        render("line", path, settings, 500.0)
    );
}

#[test]
fn rotated_picking_layer_order_and_selection_handles_match_painting() {
    let mut scene = BoardScene::default();
    let mut first = node("shape");
    first.width = 100.0;
    first.height = 40.0;
    first.rotation = 90.0;
    sync(&mut scene, vec![first.clone()], false, vec![]);
    assert!(scene.hit_test(egui::pos2(60.0, 75.0)).is_some());
    assert!(scene.hit_test(egui::pos2(15.0, 30.0)).is_none());
    let mut top = first.clone();
    top.id = "top".into();
    sync(&mut scene, vec![first, top], false, vec!["top"]);
    assert_eq!(
        scene.hit_test(egui::pos2(60.0, 30.0)).expect("top hit").id,
        "top"
    );
    assert_eq!(
        scene
            .hit_test(egui::pos2(80.0, -20.0))
            .expect("rotated corner")
            .handle,
        Some("nw")
    );
}

#[test]
fn runtime_control_values_survive_layout_updates_and_reset_when_bound_data_changes() {
    let mut scene = BoardScene::default();
    let mut input = node("input");
    sync(&mut scene, vec![input.clone()], true, vec![]);
    scene.set_value("component", json!("泵站 A"));
    input.x = 20.0;
    sync(&mut scene, vec![input.clone()], true, vec![]);
    // Re-entering the field reports its retained live value, which is also used by snapshot().
    scene.take_events();
    scene.pointer("down", egui::pos2(40.0, 40.0));
    scene.pointer("up", egui::pos2(40.0, 40.0));
    assert_eq!(scene.take_events()[0].value, json!("泵站 A"));
    input.data["__dwHovered"] = json!(true);
    sync(&mut scene, vec![input.clone()], true, vec![]);
    scene.pointer("down", egui::pos2(40.0, 40.0));
    scene.pointer("up", egui::pos2(40.0, 40.0));
    assert_eq!(scene.take_events()[0].value, json!("泵站 A"));
    input
        .data
        .as_object_mut()
        .expect("object data")
        .remove("__dwHovered");
    sync(&mut scene, vec![input.clone()], true, vec![]);
    scene.pointer("down", egui::pos2(40.0, 40.0));
    scene.pointer("up", egui::pos2(40.0, 40.0));
    assert_eq!(scene.take_events()[0].value, json!("泵站 A"));
    input.data["value"] = json!("API 更新");
    sync(&mut scene, vec![input], true, vec![]);
    scene.pointer("down", egui::pos2(40.0, 40.0));
    scene.pointer("up", egui::pos2(40.0, 40.0));
    assert_eq!(scene.take_events()[0].value, json!("API 更新"));
}

#[test]
fn dropdown_popup_is_picked_outside_component_and_emits_selected_value() {
    let mut scene = BoardScene::default();
    let mut dropdown = node("dropdown");
    dropdown.height = 40.0;
    sync(&mut scene, vec![dropdown], true, vec![]);
    scene.pointer("down", egui::pos2(50.0, 30.0));
    scene.pointer("up", egui::pos2(50.0, 30.0));
    assert!(scene.hit_test(egui::pos2(50.0, 96.0)).is_some());
    scene.pointer("down", egui::pos2(50.0, 96.0));
    scene.pointer("up", egui::pos2(50.0, 96.0));
    assert_eq!(scene.take_events()[0].value, json!("设备 B"));
}

#[test]
fn grouped_horizontal_chart_reports_the_actual_item_and_toggles_legend() {
    let mut chart = node("barHorizontal");
    chart.rotation = 25.0;
    chart.data["chart"] = json!({"variant":"horizontalGrouped", "seriesCount":2});
    let item = chart.world(egui::pos2(70.0, 82.0));
    let legend = chart.world(egui::pos2(286.0, 43.0));
    let mut scene = BoardScene::default();
    sync(&mut scene, vec![chart], true, vec![]);
    let mut raster = Rasterizer::default();
    let before = raster.render(&mut scene.frame(&clock(), 400, 300, false), 400, 300);
    scene.pointer("move", item);
    let hover = raster.render(&mut scene.frame(&clock(), 400, 300, false), 400, 300);
    assert_ne!(before, hover, "hover must paint the item tooltip");
    scene.pointer("down", item);
    scene.pointer("up", item);
    let event = scene.take_events().pop().expect("chart element event");
    assert_eq!(event.value["name"], "温度");
    assert_eq!(event.value["value"], 24);
    assert_eq!(event.value["series"], 2);
    assert_eq!(event.value["row"]["value2"], 24);
    scene.pointer("down", legend);
    scene.pointer("up", legend);
    assert!(scene.take_events().is_empty(), "legend is not a data item");
    scene.pointer("down", item);
    scene.pointer("up", item);
    assert!(
        scene.take_events().is_empty(),
        "hidden series must not be clickable"
    );
    scene.pointer("down", legend);
    scene.pointer("up", legend);
    scene.pointer("down", item);
    scene.pointer("up", item);
    assert_eq!(scene.take_events()[0].value["value"], 24);
    scene.pointer("leave", item);
    let after = raster.render(&mut scene.frame(&clock(), 400, 300, false), 400, 300);
    assert_eq!(
        before, after,
        "leaving and restoring legend clears transient state"
    );
}

#[test]
fn pie_item_click_respects_the_actual_sector() {
    let mut chart = node("pie");
    chart.data["chart"] = json!({"showLegend":false});
    let item = chart.world(egui::pos2(210.0, 71.0));
    let center = chart.world(egui::pos2(180.0, 123.0));
    let mut scene = BoardScene::default();
    sync(&mut scene, vec![chart], true, vec![]);
    scene.frame(&clock(), 400, 300, false).textures.clear();
    scene.pointer("down", center);
    scene.pointer("up", center);
    assert!(
        scene.take_events().is_empty(),
        "the donut hole is not a slice"
    );
    scene.pointer("down", item);
    scene.pointer("up", item);
    let event = scene.take_events().pop().expect("pie element event");
    assert_eq!(event.value["name"], "温度");
    assert_eq!(event.value["value"], 36);
}

#[test]
fn chart_tooltip_and_legend_interaction_can_be_disabled_independently() {
    let mut chart = node("barHorizontal");
    chart.data["chart"] = json!({"variant":"horizontalGrouped", "seriesCount":2,
        "showTooltip":false, "legendInteractive":false});
    let item = chart.world(egui::pos2(70.0, 82.0));
    let legend = chart.world(egui::pos2(286.0, 43.0));
    let mut scene = BoardScene::default();
    sync(&mut scene, vec![chart], true, vec![]);
    let mut raster = Rasterizer::default();
    let before = raster.render(&mut scene.frame(&clock(), 400, 300, false), 400, 300);
    scene.pointer("move", item);
    let after = raster.render(&mut scene.frame(&clock(), 400, 300, false), 400, 300);
    assert_eq!(
        before, after,
        "disabled tooltip must not change chart pixels"
    );
    scene.pointer("down", legend);
    scene.pointer("up", legend);
    scene.pointer("down", item);
    scene.pointer("up", item);
    assert_eq!(
        scene.take_events()[0].value["value"],
        24,
        "disabled legend must leave the series visible"
    );
}

#[test]
fn chart_data_zoom_filters_rows_and_keeps_original_click_indices() {
    let mut chart = node("bar");
    chart.widget.text.clear();
    chart.data["rows"] = json!([
        {"name":"A", "value":10}, {"name":"B", "value":20},
        {"name":"C", "value":30}, {"name":"D", "value":40},
        {"name":"E", "value":50}
    ]);
    chart.data["chart"] = json!({"showDataZoom":true, "zoomStart":40, "zoomEnd":80,
        "showLegend":false});
    let mut scene = BoardScene::default();
    sync(&mut scene, vec![chart.clone()], true, vec![]);
    scene.frame(&clock(), 400, 300, false).textures.clear();
    let first_bar = chart.world(egui::pos2(120.0, 110.0));
    let item = click_chart(&mut scene, first_bar).expect("visible bar");
    assert_eq!(item["name"], "C");
    assert_eq!(item["index"], 2);
    assert_eq!(item["row"]["value"], 30);

    let range_center = chart.world(egui::pos2(221.0, 190.0));
    let moved = chart.world(egui::pos2(279.0, 190.0));
    assert!(scene.hit_test(range_center).expect("zoom hit").control);
    scene.pointer("down", range_center);
    scene.pointer("move", moved);
    scene.pointer("up", moved);
    assert!(
        scene.take_events().is_empty(),
        "dragging the navigator is not an item click"
    );
    scene.frame(&clock(), 400, 300, false).textures.clear();
    let item = click_chart(&mut scene, first_bar).expect("bar after moving window");
    assert_eq!(item["name"], "D");
    assert_eq!(item["index"], 3);

    sync(&mut scene, vec![chart.clone()], true, vec![]);
    scene.frame(&clock(), 400, 300, false).textures.clear();
    assert_eq!(
        click_chart(&mut scene, first_bar).expect("bar after sync")["name"],
        "D"
    );
    chart.data["chart"]["zoomStart"] = json!(0);
    chart.data["chart"]["zoomEnd"] = json!(40);
    sync(&mut scene, vec![chart.clone()], true, vec![]);
    scene.frame(&clock(), 400, 300, false).textures.clear();
    assert_eq!(
        click_chart(&mut scene, first_bar).expect("bar after configuration change")["name"],
        "A"
    );
}

#[test]
fn data_zoom_handles_keep_range_items_and_rotation_correct() {
    let mut chart = node("barHorizontal");
    chart.rotation = 20.0;
    chart.widget.text.clear();
    chart.data["rows"] = json!([
        {"name":"A", "value":10, "value2":20}, {"name":"B", "value":20, "value2":30},
        {"name":"C", "value":30, "value2":40}, {"name":"D", "value":40, "value2":50},
        {"name":"E", "value":50, "value2":60}
    ]);
    chart.data["chart"] = json!({"variant":"horizontalRange", "showDataZoom":true,
        "zoomStart":40, "zoomEnd":80, "showLegend":false});
    let mut scene = BoardScene::default();
    sync(&mut scene, vec![chart.clone()], true, vec![]);
    scene.frame(&clock(), 400, 300, false).textures.clear();
    let first_bar = chart.world(egui::pos2(250.0, 60.0));
    let item = click_chart(&mut scene, first_bar).expect("first visible interval");
    assert_eq!(item["index"], 2);
    assert_eq!(item["value"], json!([30.0, 40.0]));

    let left = chart.world(egui::pos2(163.2, 190.0));
    let left_moved = chart.world(egui::pos2(105.6, 190.0));
    scene.pointer("down", left);
    scene.pointer("move", left_moved);
    scene.pointer("up", left_moved);
    scene.frame(&clock(), 400, 300, false).textures.clear();
    // Three rows now fit. The first one is B, and range payload still refers to its source row.
    let item = click_chart(&mut scene, chart.world(egui::pos2(190.0, 50.0)))
        .expect("first interval after dragging the start handle");
    assert_eq!(item["index"], 1);
    assert_eq!(item["name"], "B");
}

#[test]
fn relocated_legend_remains_clickable_and_tooltip_style_changes_pixels() {
    let mut chart = node("barHorizontal");
    chart.data["chart"] = json!({"variant":"horizontalGrouped", "seriesCount":2,
        "legendPosition":"left-top", "legendMarker":"square", "legendMarkerSize":12});
    let legend = chart.world(egui::pos2(20.0, 44.0));
    let item = chart.world(egui::pos2(70.0, 82.0));
    let mut scene = BoardScene::default();
    sync(&mut scene, vec![chart.clone()], true, vec![]);
    let mut raster = Rasterizer::default();
    let before = raster.render(&mut scene.frame(&clock(), 400, 300, false), 400, 300);
    scene.pointer("down", legend);
    scene.pointer("up", legend);
    assert!(scene.take_events().is_empty());
    let hidden = raster.render(&mut scene.frame(&clock(), 400, 300, false), 400, 300);
    assert_ne!(
        before, hidden,
        "the relocated legend must toggle its series"
    );
    scene.pointer("down", legend);
    scene.pointer("up", legend);
    scene.pointer("move", item);
    let hover = raster.render(&mut scene.frame(&clock(), 400, 300, false), 400, 300);
    chart.data["chart"]["tooltipBackground"] = json!("#ff0000");
    chart.data["chart"]["tooltipPosition"] = json!("center");
    chart.data["chart"]["tooltipShowIcon"] = json!(true);
    chart.data["chart"]["tooltipPaddingX"] = json!(20);
    sync(&mut scene, vec![chart], true, vec![]);
    scene.pointer("move", item);
    let styled = raster.render(&mut scene.frame(&clock(), 400, 300, false), 400, 300);
    assert_ne!(
        hover, styled,
        "tooltip style must affect the actual preview"
    );
}

#[test]
fn legend_text_styles_and_width_change_pixels_and_preserve_interaction() {
    let mut chart = node("barHorizontal");
    chart.data["chart"] = json!({"variant":"horizontalGrouped", "seriesCount":2,
        "legendPosition":"left-top", "legendMarker":"square", "legendMarkerSize":12});
    let legend = chart.world(egui::pos2(20.0, 44.0));
    let mut scene = BoardScene::default();
    let mut raster = Rasterizer::default();
    sync(&mut scene, vec![chart.clone()], true, vec![]);
    let before = raster.render(&mut scene.frame(&clock(), 400, 300, false), 400, 300);
    chart.data["chart"]["legendFontFamily"] = json!("monospace");
    chart.data["chart"]["legendBold"] = json!(true);
    chart.data["chart"]["legendItalic"] = json!(true);
    chart.data["chart"]["legendUnderline"] = json!(true);
    chart.data["chart"]["legendStrike"] = json!(true);
    chart.data["chart"]["legendTextSpacing"] = json!(3);
    chart.data["chart"]["legendTextMode"] = json!("custom");
    chart.data["chart"]["legendTextWidth"] = json!(30);
    chart.data["chart"]["legendShadowColor"] = json!("#ff0000");
    chart.data["chart"]["legendShadowBlur"] = json!(6);
    chart.data["chart"]["legendShadowOffset"] = json!([2, 1]);
    sync(&mut scene, vec![chart], true, vec![]);
    let styled = raster.render(&mut scene.frame(&clock(), 400, 300, false), 400, 300);
    assert_ne!(
        before, styled,
        "legend font, spacing and glow must affect pixels"
    );
    scene.pointer("down", legend);
    scene.pointer("up", legend);
    let hidden = raster.render(&mut scene.frame(&clock(), 400, 300, false), 400, 300);
    assert_ne!(styled, hidden, "the styled legend must remain clickable");
}

#[test]
fn paged_legend_uses_the_configured_button_font() {
    let mut chart = node("pieBasic");
    chart.widget.text.clear();
    chart.data["rows"] = json!(
        (0..12)
            .map(|i| json!({"name":format!("Long category {i}"), "value":i + 1}))
            .collect::<Vec<_>>()
    );
    chart.data["chart"] = json!({"legendType":"scroll", "legendPosition":"top-left",
        "colors":["#007aff"], "paletteCycle":true, "legendPageTextColor":"#ff0000",
        "legendPageTextSize":18, "legendPageBold":true, "legendPageItalic":true,
        "legendPageUnderline":true, "legendPageStrike":true});
    let mut scene = BoardScene::default();
    sync(&mut scene, vec![chart.clone()], false, vec![]);
    let mut raster = Rasterizer::default();
    let styled = raster.render(&mut scene.frame(&clock(), 400, 300, false), 400, 300);
    assert!(
        styled
            .chunks_exact(4)
            .any(|pixel| pixel[0] > 230 && pixel[1] < 20 && pixel[2] < 20),
        "the page indicator must use the configured text color"
    );
    chart.data["chart"]["legendPageTextColor"] = json!("#00ff00");
    sync(&mut scene, vec![chart], false, vec![]);
    let recolored = raster.render(&mut scene.frame(&clock(), 400, 300, false), 400, 300);
    assert_ne!(
        styled, recolored,
        "the page indicator style must change rendered pixels"
    );
}

#[test]
fn tooltip_crosshairs_and_background_image_affect_the_hovered_chart() {
    let mut chart = node("lineSmooth");
    chart.data["chart"] = json!({"showPoints":false, "tooltipShowTitle":false,
        "tooltipFormat":"percent", "tooltipDecimals":1, "tooltipShowUnitName":true,
        "tooltipUnit":"units", "tooltipNameColor":"#00ff00", "tooltipTextColor":"#ffffff"});
    chart.data["rows"] = json!([
        {"name":"一月", "value":40}, {"name":"二月", "value":40}, {"name":"三月", "value":40}
    ]);
    let point = chart.world(egui::pos2(120.0, 56.0));
    let mut scene = BoardScene::default();
    sync(&mut scene, vec![chart.clone()], true, vec![]);
    let mut raster = Rasterizer::default();
    raster.render(&mut scene.frame(&clock(), 400, 300, false), 400, 300);
    scene.pointer("move", point);
    let plain = raster.render(&mut scene.frame(&clock(), 400, 300, false), 400, 300);
    chart.data["chart"]["tooltipShowVerticalPointer"] = json!(true);
    chart.data["chart"]["tooltipShowHorizontalPointer"] = json!(true);
    chart.data["chart"]["tooltipPointerStyle"] = json!("solid");
    chart.data["chart"]["tooltipPointerColor"] = json!("#ff00ff");
    chart.data["chart"]["tooltipPointerLabel"] = json!(true);
    sync(&mut scene, vec![chart], true, vec![]);
    scene.pointer("move", point);
    let crossed = raster.render(&mut scene.frame(&clock(), 400, 300, false), 400, 300);
    assert_ne!(plain, crossed, "crosshairs must change the hovered chart");
    scene
        .set_image("\u{1f}tooltip:component", 1, 1, &[255, 0, 0, 255])
        .unwrap();
    let image = raster.render(&mut scene.frame(&clock(), 400, 300, false), 400, 300);
    assert_ne!(
        crossed, image,
        "the tooltip background texture must be rendered"
    );
    scene.clear_image("\u{1f}tooltip:component");
    let cleared = raster.render(&mut scene.frame(&clock(), 400, 300, false), 400, 300);
    assert_eq!(
        cleared, crossed,
        "clearing the background restores the previous hover"
    );
}

#[test]
fn axis_tooltip_aggregates_visible_series_from_plot_space() {
    let mut chart = node("lineMulti");
    chart.widget.text.clear();
    chart.data["rows"] = json!([
        {"name":"A", "value":40, "value2":20},
        {"name":"B", "value":40, "value2":20},
        {"name":"C", "value":40, "value2":20}
    ]);
    chart.data["chart"] = json!({"seriesCount":2, "showLegend":false, "showPoints":false,
        "showXAxis":false, "showYAxis":false, "showGrid":false, "tooltipAxisTrigger":true,
        "tooltipBackground":"#ff0000", "tooltipShowTitle":false, "tooltipPosition":"center"});
    let point = chart.world(egui::pos2(120.0, 170.0));
    let mut scene = BoardScene::default();
    let mut raster = Rasterizer::default();
    sync(&mut scene, vec![chart.clone()], true, vec![]);
    raster.render(&mut scene.frame(&clock(), 400, 300, false), 400, 300);
    scene.pointer("move", point);
    let both = raster.render(&mut scene.frame(&clock(), 400, 300, false), 400, 300);
    let red_pixels = |pixels: &[u8]| {
        pixels
            .chunks_exact(4)
            .filter(|pixel| pixel[0] > 245 && pixel[1] < 10 && pixel[2] < 10)
            .count()
    };
    let both_red = red_pixels(&both);
    assert!(
        both_red > 100,
        "hovering empty plot space must show an axis tooltip"
    );
    for row in chart.data["rows"].as_array_mut().unwrap() {
        row.as_object_mut().unwrap().remove("value2");
    }
    sync(&mut scene, vec![chart.clone()], true, vec![]);
    scene.pointer("move", point);
    let single = raster.render(&mut scene.frame(&clock(), 400, 300, false), 400, 300);
    assert!(
        both_red > red_pixels(&single) * 3 / 2,
        "both series must have a separate tooltip row"
    );
    chart.data["chart"]["tooltipAxisTrigger"] = json!(false);
    sync(&mut scene, vec![chart], true, vec![]);
    scene.pointer("move", point);
    let disabled = raster.render(&mut scene.frame(&clock(), 400, 300, false), 400, 300);
    assert_eq!(
        red_pixels(&disabled),
        0,
        "without axis trigger empty plot space has no tooltip"
    );
}

#[test]
fn zero_removal_connects_or_breaks_lines_without_changing_data_indices() {
    let mut chart = node("lineSmooth");
    chart.data["rows"] = json!([
        {"name":"A", "value":40}, {"name":"B", "value":0}, {"name":"C", "value":40}
    ]);
    chart.data["chart"] = json!({"showPoints":false, "zeroRemoval":true,
        "zeroRemovalMode":"skip", "tooltipAxisTrigger":false});
    let point = chart.world(egui::pos2(120.0, 56.0));
    let mut scene = BoardScene::default();
    sync(&mut scene, vec![chart.clone()], true, vec![]);
    scene.frame(&clock(), 400, 300, false).textures.clear();
    let hit = click_chart(&mut scene, point).expect("skipped zero connects the non-zero points");
    assert!(hit["index"] == 0 || hit["index"] == 2);
    assert_eq!(hit["value"], 40);
    chart.data["chart"]["zeroRemovalMode"] = json!("segment");
    sync(&mut scene, vec![chart], true, vec![]);
    scene.frame(&clock(), 400, 300, false).textures.clear();
    assert!(
        click_chart(&mut scene, point).is_none(),
        "segment mode breaks at zero"
    );
}

#[test]
fn line_series_can_use_independent_shapes_and_image_textures() {
    let mut chart = node("lineMulti");
    chart.data["rows"] = json!([
        {"name":"A", "value":40, "value2":20}, {"name":"B", "value":30, "value2":30},
        {"name":"C", "value":20, "value2":40}
    ]);
    chart.data["chart"] = json!({"seriesCount":2, "seriesStyleEnabled":true,
        "seriesStyles":[{"pointShape":"image", "pointRadius":8, "lineStyle":"dashed"},
            {"pointShape":"diamond", "pointRadius":9, "lineWidth":4,
             "pointShadowColor":"#ff0000", "pointShadowBlur":6}],
        "showLegend":false});
    let mut scene = BoardScene::default();
    sync(&mut scene, vec![chart.clone()], false, vec![]);
    let mut raster = Rasterizer::default();
    let before = raster.render(&mut scene.frame(&clock(), 400, 300, false), 400, 300);
    scene
        .set_image("\u{1f}point:0:component", 1, 1, &[0, 255, 0, 255])
        .unwrap();
    let with_image = raster.render(&mut scene.frame(&clock(), 400, 300, false), 400, 300);
    assert_ne!(
        before, with_image,
        "the first series must use its own point image"
    );
    assert!(
        with_image
            .chunks_exact(4)
            .any(|pixel| pixel[0] < 10 && pixel[1] > 245 && pixel[2] < 10)
    );
    chart.data["chart"]["seriesStyleEnabled"] = json!(false);
    sync(&mut scene, vec![chart], false, vec![]);
    let uniform = raster.render(&mut scene.frame(&clock(), 400, 300, false), 400, 300);
    assert_ne!(
        with_image, uniform,
        "disabling per-series settings must restore the uniform style"
    );
}

#[test]
fn line_flow_moves_with_time_and_stops_when_paused() {
    let mut chart = node("lineMulti");
    chart.data["rows"] = json!([
        {"name":"A", "value":40, "value2":20}, {"name":"B", "value":30, "value2":30},
        {"name":"C", "value":20, "value2":40}
    ]);
    chart.data["chart"] = json!({"seriesCount":2, "showPoints":false, "showLegend":false,
        "flowEnabled":true, "flowStyles":[{"enabled":true, "shape":"diamond", "color":"#ff0000",
        "size":12, "trailLength":30, "duration":10}, {"enabled":false}]});
    let mut scene = BoardScene::default();
    sync(&mut scene, vec![chart.clone()], false, vec![]);
    let mut raster = Rasterizer::default();
    let mut first_time = clock();
    first_time.now = 2_500.0;
    let mut second_time = first_time.clone();
    second_time.now = 7_500.0;
    let first = raster.render(&mut scene.frame(&first_time, 400, 300, false), 400, 300);
    let second = raster.render(&mut scene.frame(&second_time, 400, 300, false), 400, 300);
    assert_ne!(
        first, second,
        "the flow marker must travel along the series"
    );
    chart.data["chart"]["playAnimation"] = json!(false);
    sync(&mut scene, vec![chart], false, vec![]);
    let paused_first = raster.render(&mut scene.frame(&first_time, 400, 300, false), 400, 300);
    let paused_second = raster.render(&mut scene.frame(&second_time, 400, 300, false), 400, 300);
    assert_eq!(
        paused_first, paused_second,
        "a paused flow must remain still"
    );
}

#[test]
fn line_custom_count_limits_visible_categories_without_losing_data() {
    let mut chart = node("lineMulti");
    chart.data["rows"] = json!([
        {"name":"A", "value":40, "value2":20, "value3":10},
        {"name":"B", "value":30, "value2":25, "value3":15},
        {"name":"C", "value":20, "value2":30, "value3":20}
    ]);
    chart.data["chart"] = json!({"seriesCount":3, "showLegend":false, "showGrid":false,
        "showXAxis":false, "showYAxis":false, "colors":["#ff0000", "#00ff00", "#0000ff"],
        "lineWidth":4, "categoryVisibilityMode":"custom", "visibleCategoryCount":2});
    let render = |chart: &BoardNode| {
        let mut scene = BoardScene::default();
        sync(&mut scene, vec![chart.clone()], false, vec![]);
        Rasterizer::default().render(&mut scene.frame(&clock(), 400, 300, false), 400, 300)
    };
    for count in 0..=3 {
        chart.data["chart"]["visibleCategoryCount"] = json!(count);
        let mut expected = chart.clone();
        expected.data["chart"]["categoryVisibilityMode"] = json!("all");
        expected.data["rows"]
            .as_array_mut()
            .unwrap()
            .truncate(count);
        assert_eq!(
            render(&chart),
            render(&expected),
            "the first {count} categories must be shown"
        );
    }
    assert_eq!(
        chart.data["rows"][0]["value3"], 10,
        "limiting the visible categories must preserve source data"
    );
}

fn click_chart(scene: &mut BoardScene, point: egui::Pos2) -> Option<Value> {
    scene.pointer("down", point);
    scene.pointer("up", point);
    scene.take_events().pop().map(|event| event.value)
}

#[test]
fn chart_line_and_range_area_are_clickable_between_data_points() {
    let mut chart = node("lineSmooth");
    chart.data["chart"] = json!({"showPoints": false});
    chart.data["rows"] = json!([
        {"name":"一月", "value":40, "value2":80},
        {"name":"二月", "value":40, "value2":80},
        {"name":"三月", "value":40, "value2":80}
    ]);
    let line = chart.world(egui::pos2(120.0, 56.0));
    let area = chart.world(egui::pos2(120.0, 88.0));
    let outside = chart.world(egui::pos2(120.0, 165.0));
    let mut scene = BoardScene::default();
    sync(&mut scene, vec![chart.clone()], true, vec![]);
    scene.frame(&clock(), 400, 300, false).textures.clear();
    assert_eq!(
        click_chart(&mut scene, line).expect("smoothed line")["name"],
        "一月"
    );
    assert!(click_chart(&mut scene, area).is_none());

    chart.widget.kind = "area".into();
    chart.data["chart"] = json!({"variant":"rangeArea", "showPoints": false});
    sync(&mut scene, vec![chart], true, vec![]);
    scene.frame(&clock(), 400, 300, false).textures.clear();
    let item = click_chart(&mut scene, area).expect("area between the two bounds");
    assert_eq!(item["name"], "一月");
    assert_eq!(item["value"], json!([40.0, 80.0]));
    assert!(click_chart(&mut scene, outside).is_none());
}

#[test]
fn line_boundary_gap_places_endpoints_and_preserves_item_identity() {
    for kind in ["line", "area"] {
        let mut chart = node(kind);
        chart.widget.text.clear();
        chart.data["chart"] = json!({"seriesCount":1, "showLegend":false, "showGrid":false,
            "showXAxis":false, "showYAxis":false, "showPoints":true, "pointRadius":8});
        chart.data["rows"] = json!([
            {"name":"一月", "value":50}, {"name":"二月", "value":100},
            {"name":"三月", "value":50}
        ]);
        let mut scene = BoardScene::default();
        sync(&mut scene, vec![chart.clone()], true, vec![]);
        scene.frame(&clock(), 400, 300, false).textures.clear();
        let edge = chart.world(egui::pos2(48.0, 105.5));
        let inset = chart.world(egui::pos2(96.0, 105.5));
        assert!(click_chart(&mut scene, edge).is_none());
        assert_eq!(
            click_chart(&mut scene, inset).expect("inset point")["index"],
            0
        );

        chart.data["chart"]["boundaryGap"] = json!(false);
        sync(&mut scene, vec![chart.clone()], true, vec![]);
        scene.frame(&clock(), 400, 300, false).textures.clear();
        assert_eq!(
            click_chart(&mut scene, edge).expect("first endpoint")["index"],
            0
        );
        let last = chart.world(egui::pos2(336.0, 105.5));
        assert_eq!(
            click_chart(&mut scene, last).expect("last endpoint")["index"],
            2
        );

        chart.data["rows"] = json!([{"name":"单点", "value":50}]);
        sync(&mut scene, vec![chart.clone()], true, vec![]);
        scene.frame(&clock(), 400, 300, false).textures.clear();
        let center = chart.world(egui::pos2(192.0, 30.0));
        assert_eq!(
            click_chart(&mut scene, center).expect("single point")["name"],
            "单点"
        );
    }
}

#[test]
fn signed_grouped_columns_follow_zero_baseline_and_custom_range() {
    let mut chart = node("barGrouped");
    chart.widget.text.clear();
    chart.data["rows"] = json!([
        {"name":"一月", "value":-30, "value2":30},
        {"name":"二月", "value":-10, "value2":20}
    ]);
    chart.data["chart"] = json!({"seriesCount":2, "variant":"tBar", "showLegend":false,
        "showGrid":false, "showXAxis":false, "showYAxis":false, "showLabels":true});
    let mut scene = BoardScene::default();
    sync(&mut scene, vec![chart.clone()], true, vec![]);
    scene.frame(&clock(), 400, 300, false).textures.clear();
    let negative =
        click_chart(&mut scene, chart.world(egui::pos2(95.0, 140.0))).expect("negative column");
    assert_eq!(
        (negative["value"].clone(), negative["series"].clone()),
        (json!(-30), json!(1))
    );
    let positive =
        click_chart(&mut scene, chart.world(egui::pos2(140.0, 70.0))).expect("positive column");
    assert_eq!(
        (positive["value"].clone(), positive["series"].clone()),
        (json!(30), json!(2))
    );
    assert!(click_chart(&mut scene, chart.world(egui::pos2(95.0, 70.0))).is_none());

    chart.data["chart"]["axisRangeModeY"] = json!("custom");
    chart.data["chart"]["axisMinY"] = json!(-60);
    chart.data["chart"]["axisMaxY"] = json!(60);
    sync(&mut scene, vec![chart.clone()], true, vec![]);
    scene.frame(&clock(), 400, 300, false).textures.clear();
    assert_eq!(
        click_chart(&mut scene, chart.world(egui::pos2(95.0, 130.0)))
            .expect("custom negative column")["value"],
        -30
    );
    assert!(click_chart(&mut scene, chart.world(egui::pos2(95.0, 155.0))).is_none());

    chart.data["chart"]["axisMinY"] = json!(10);
    chart.data["chart"]["axisMaxY"] = json!(20);
    sync(&mut scene, vec![chart.clone()], true, vec![]);
    scene.frame(&clock(), 400, 300, false).textures.clear();
    assert!(click_chart(&mut scene, chart.world(egui::pos2(95.0, 190.0))).is_none());
}

#[test]
fn signed_grouped_bars_follow_zero_baseline_and_custom_range() {
    let mut chart = node("barHorizontal");
    chart.widget.text.clear();
    chart.data["rows"] = json!([{"name":"一月", "value":-30, "value2":30}]);
    chart.data["chart"] = json!({"seriesCount":2, "variant":"horizontalGrouped", "endCap":true,
        "showLegend":false, "showGrid":false, "showXAxis":false, "showYAxis":false,
        "showLabels":true});
    let mut scene = BoardScene::default();
    sync(&mut scene, vec![chart.clone()], true, vec![]);
    scene.frame(&clock(), 400, 300, false).textures.clear();
    let negative = click_chart(&mut scene, chart.world(egui::pos2(100.0, 82.0)))
        .expect("negative horizontal bar");
    assert_eq!(
        (negative["value"].clone(), negative["series"].clone()),
        (json!(-30), json!(1))
    );
    let positive = click_chart(&mut scene, chart.world(egui::pos2(280.0, 128.0)))
        .expect("positive horizontal bar");
    assert_eq!(
        (positive["value"].clone(), positive["series"].clone()),
        (json!(30), json!(2))
    );
    assert!(click_chart(&mut scene, chart.world(egui::pos2(280.0, 82.0))).is_none());

    chart.data["chart"]["axisRangeModeX"] = json!("custom");
    chart.data["chart"]["axisMinX"] = json!(-60);
    chart.data["chart"]["axisMaxX"] = json!(60);
    sync(&mut scene, vec![chart.clone()], true, vec![]);
    scene.frame(&clock(), 400, 300, false).textures.clear();
    assert_eq!(
        click_chart(&mut scene, chart.world(egui::pos2(130.0, 82.0))).expect("custom negative bar")
            ["value"],
        -30
    );
    assert!(click_chart(&mut scene, chart.world(egui::pos2(95.0, 82.0))).is_none());
    assert_eq!(
        click_chart(&mut scene, chart.world(egui::pos2(260.0, 128.0)))
            .expect("custom positive bar")["value"],
        30
    );
}

#[test]
fn signed_line_scale_handles_custom_bounds_and_clips_outside_hits() {
    let mut chart = node("line");
    chart.widget.text.clear();
    chart.data["rows"] = json!([
        {"name":"负值", "value":-20}, {"name":"零", "value":0},
        {"name":"正值", "value":40}
    ]);
    chart.data["chart"] = json!({"seriesCount":1, "showLegend":false, "showGrid":false,
        "showXAxis":false, "showYAxis":false, "showPoints":true, "pointRadius":6});
    let mut scene = BoardScene::default();
    sync(&mut scene, vec![chart.clone()], true, vec![]);
    scene.frame(&clock(), 400, 300, false).textures.clear();
    let negative = chart.world(egui::pos2(96.0, 181.0));
    let item = click_chart(&mut scene, negative).expect("negative point");
    assert_eq!(item["value"], -20);
    assert_eq!(item["index"], 0);
    assert_eq!(item["row"]["value"], -20);

    chart.data["chart"]["axisRangeModeY"] = json!("custom");
    chart.data["chart"]["axisMinY"] = json!(-40);
    chart.data["chart"]["axisMaxY"] = json!(80);
    sync(&mut scene, vec![chart.clone()], true, vec![]);
    scene.frame(&clock(), 400, 300, false).textures.clear();
    let custom_negative = chart.world(egui::pos2(96.0, 155.83));
    assert_eq!(
        click_chart(&mut scene, custom_negative).expect("custom point")["value"],
        -20
    );
    assert!(click_chart(&mut scene, negative).is_none());

    chart.data["chart"]["axisMinY"] = json!(0);
    chart.data["chart"]["axisMaxY"] = json!(100);
    sync(&mut scene, vec![chart.clone()], true, vec![]);
    scene.frame(&clock(), 400, 300, false).textures.clear();
    let outside_plot = chart.world(egui::pos2(96.0, 211.2));
    assert!(click_chart(&mut scene, outside_plot).is_none());
    let zero =
        click_chart(&mut scene, chart.world(egui::pos2(192.0, 181.0))).expect("visible zero");
    assert_eq!(zero["value"], 0);

    chart.data["chart"]["axisMinY"] = json!(10);
    chart.data["chart"]["axisMaxY"] = json!(0);
    sync(&mut scene, vec![chart], true, vec![]);
    scene.frame(&clock(), 400, 300, false).textures.clear();
    assert_eq!(
        click_chart(&mut scene, negative).expect("invalid range falls back")["value"],
        -20
    );
}

#[test]
fn signed_area_fills_both_sides_of_zero() {
    let mut chart = node("area");
    chart.widget.text.clear();
    chart.data["rows"] = json!([{"name":"负值", "value":-50}, {"name":"正值", "value":50}]);
    chart.data["chart"] = json!({"seriesCount":1, "showLegend":false, "showGrid":false,
        "showXAxis":false, "showYAxis":false, "showPoints":false, "fillOpacity":100});
    let mut scene = BoardScene::default();
    let mut raster = Rasterizer::default();
    sync(&mut scene, vec![chart.clone()], true, vec![]);
    let filled = raster.render(&mut scene.frame(&clock(), 400, 300, false), 400, 300);
    chart.data["chart"]["fillOpacity"] = json!(0);
    sync(&mut scene, vec![chart], true, vec![]);
    let empty = raster.render(&mut scene.frame(&clock(), 400, 300, false), 400, 300);
    let pixel = |pixels: &[u8], x: usize, y: usize| -> [u8; 4] {
        pixels[(y * 400 + x) * 4..(y * 400 + x) * 4 + 4]
            .try_into()
            .expect("pixel")
    };
    assert_ne!(pixel(&filled, 155, 140), pixel(&empty, 155, 140));
    assert_ne!(pixel(&filled, 249, 90), pixel(&empty, 249, 90));
    assert_eq!(pixel(&filled, 155, 90), pixel(&empty, 155, 90));
    assert_eq!(pixel(&filled, 249, 140), pixel(&empty, 249, 140));
}

#[test]
fn custom_scale_clips_hover_highlight_to_the_plot() {
    let mut chart = node("line");
    chart.widget.text.clear();
    chart.data["rows"] = json!([{"name":"负值", "value":-20}, {"name":"正值", "value":80}]);
    chart.data["chart"] = json!({"seriesCount":1, "showLegend":false, "showGrid":false,
        "showXAxis":false, "showYAxis":false, "showPoints":false, "tooltipPosition":"center",
        "axisRangeModeY":"custom", "axisMinY":0, "axisMaxY":100});
    let mut scene = BoardScene::default();
    let mut raster = Rasterizer::default();
    sync(&mut scene, vec![chart.clone()], true, vec![]);
    let before = raster.render(&mut scene.frame(&clock(), 400, 300, false), 400, 300);
    scene.pointer("move", chart.world(egui::pos2(160.0, 169.25)));
    let hover = raster.render(&mut scene.frame(&clock(), 400, 300, false), 400, 300);
    assert_ne!(before, hover, "the visible segment should show a tooltip");
    for y in 193..220 {
        let start = (y * 400 + 130) * 4;
        let end = (y * 400 + 158) * 4;
        assert_eq!(
            before[start..end],
            hover[start..end],
            "highlight outside plot at row {y}"
        );
    }
}

#[test]
fn signed_line_zoom_overview_renders_negative_values() {
    let mut chart = node("line");
    chart.widget.text.clear();
    chart.data["chart"] = json!({"seriesCount":1, "showLegend":false, "showGrid":false,
        "showXAxis":false, "showYAxis":false, "showDataZoom":true, "zoomDataLineWidth":2});
    chart.data["rows"] = json!([{"name":"一月", "value":-20}, {"name":"二月", "value":40}]);
    let mut scene = BoardScene::default();
    let mut raster = Rasterizer::default();
    sync(&mut scene, vec![chart.clone()], true, vec![]);
    let signed = raster.render(&mut scene.frame(&clock(), 400, 300, false), 400, 300);
    chart.data["rows"][0]["value"] = json!(0);
    sync(&mut scene, vec![chart], true, vec![]);
    let zero = raster.render(&mut scene.frame(&clock(), 400, 300, false), 400, 300);
    assert!((192..208).any(|y| {
        let start = (y * 400 + 58) * 4;
        let end = (y * 400 + 346) * 4;
        signed[start..end] != zero[start..end]
    }));
}

#[test]
fn signed_right_axis_uses_its_own_custom_bounds() {
    let mut chart = node("lineMulti");
    chart.widget.text.clear();
    chart.data["rows"] = json!([
        {"name":"一月", "value":-20, "value2":-2},
        {"name":"二月", "value":40, "value2":4}
    ]);
    chart.data["chart"] = json!({"seriesCount":2, "showLegend":false, "showGrid":false,
        "showXAxis":false, "showYAxis":false, "showPoints":true, "pointRadius":6,
        "kitPadding":[34,18,50,27], "rightAxisStart":2, "showRightAxis":true,
        "axisRangeModeY":"custom", "axisMinY":-40, "axisMaxY":80,
        "rightAxisRangeMode":"custom", "rightAxisMin":-10, "rightAxisMax":10});
    let mut scene = BoardScene::default();
    sync(&mut scene, vec![chart.clone()], true, vec![]);
    scene.frame(&clock(), 400, 300, false).textures.clear();
    let left = click_chart(&mut scene, chart.world(egui::pos2(110.0, 155.83))).expect("left point");
    assert_eq!(
        (left["value"].clone(), left["series"].clone()),
        (json!(-20), json!(1))
    );
    let right =
        click_chart(&mut scene, chart.world(egui::pos2(110.0, 120.6))).expect("right point");
    assert_eq!(
        (right["value"].clone(), right["series"].clone()),
        (json!(-2), json!(2))
    );
}

#[test]
fn right_axis_line_uses_its_own_scale_and_keeps_data_item_identity() {
    let mut chart = node("lineMulti");
    chart.widget.text.clear();
    chart.data["rows"] = json!([
        {"name":"一月", "value":100, "value2":0.5},
        {"name":"二月", "value":100, "value2":1.0}
    ]);
    chart.data["chart"] = json!({"seriesCount":2, "showLegend":false, "showXAxis":false,
        "showYAxis":false, "showGrid":false, "rightAxisStart":2, "showRightAxis":false,
        "showPoints":true, "pointRadius":8, "kitPadding":[34,18,50,27]});
    let mut scene = BoardScene::default();
    scene
        .set_font(include_bytes!("../../data-wind-cpu/assets/NotoSansSC-Regular.otf").to_vec())
        .expect("bundled font");
    let mut raster = Rasterizer::default();
    sync(&mut scene, vec![chart.clone()], true, vec![]);
    let mut frame = scene.frame(&clock(), 400, 300, false);
    let without_axis = raster.render(&mut frame, 400, 300);
    let first_right = chart.world(egui::pos2(110.0, 105.5));
    let item = click_chart(&mut scene, first_right).expect("right-axis point");
    assert_eq!(item["name"], "一月");
    assert_eq!(item["series"], 2);
    assert_eq!(item["index"], 0);
    assert_eq!(item["value"], 0.5);

    chart.data["chart"]["showRightAxis"] = json!(true);
    scene.pointer("leave", first_right);
    sync(&mut scene, vec![chart.clone()], true, vec![]);
    let mut frame = scene.frame(&clock(), 400, 300, false);
    let with_axis = raster.render(&mut frame, 400, 300);
    assert!(without_axis != with_axis, "the right axis must be visible");
    assert_eq!(
        click_chart(&mut scene, first_right).expect("right-axis point")["series"],
        2
    );

    chart.data["chart"]["rightAxisValueFormat"] = json!("percent");
    chart.data["chart"]["rightAxisColor"] = json!("#ff0000");
    scene.pointer("leave", first_right);
    sync(&mut scene, vec![chart.clone()], true, vec![]);
    let mut frame = scene.frame(&clock(), 400, 300, false);
    let styled = raster.render(&mut frame, 400, 300);
    assert!(with_axis != styled, "axis format must affect text");

    chart.data["chart"]["rightAxisRotate"] = json!(45);
    sync(&mut scene, vec![chart.clone()], true, vec![]);
    let mut frame = scene.frame(&clock(), 400, 300, false);
    let rotated = raster.render(&mut frame, 400, 300);
    assert!(styled != rotated, "right axis tick text must rotate");

    chart.data["chart"]["showRightAxisName"] = json!(true);
    chart.data["chart"]["rightAxisName"] = json!("单位");
    chart.data["chart"]["rightAxisNameGap"] = json!(-10);
    sync(&mut scene, vec![chart.clone()], true, vec![]);
    let mut frame = scene.frame(&clock(), 400, 300, false);
    let with_name = raster.render(&mut frame, 400, 300);
    assert!(rotated != with_name, "right axis name must render");

    chart.data["chart"]["showRightGrid"] = json!(true);
    chart.data["chart"]["rightGridColor"] = json!("#00ff00");
    chart.data["chart"]["rightGridStyle"] = json!("dotted");
    sync(&mut scene, vec![chart.clone()], true, vec![]);
    let mut frame = scene.frame(&clock(), 400, 300, false);
    assert!(
        with_name != raster.render(&mut frame, 400, 300),
        "right grid must render"
    );

    chart.data["chart"]["rightAxisStart"] = json!(0);
    sync(&mut scene, vec![chart], true, vec![]);
    scene.frame(&clock(), 400, 300, false).textures.clear();
    assert!(click_chart(&mut scene, first_right).is_none());
}

#[test]
fn right_axis_uses_visible_zoom_rows_and_reports_source_indices() {
    let mut chart = node("lineMulti");
    chart.widget.text.clear();
    chart.data["rows"] = json!([
        {"name":"一月", "value":100, "value2":0.5},
        {"name":"二月", "value":100, "value2":1.0},
        {"name":"三月", "value":100, "value2":1.5},
        {"name":"四月", "value":100, "value2":2.0}
    ]);
    chart.data["chart"] = json!({"seriesCount":2, "showLegend":false, "showXAxis":false,
        "showYAxis":false, "showGrid":false, "rightAxisStart":2, "showRightAxis":false,
        "showPoints":true, "pointRadius":8, "kitPadding":[34,18,50,27],
        "showDataZoom":true, "zoomStart":25, "zoomEnd":75});
    let mut scene = BoardScene::default();
    sync(&mut scene, vec![chart.clone()], true, vec![]);
    scene.frame(&clock(), 400, 300, false).textures.clear();
    let right_point = chart.world(egui::pos2(110.0, 70.3));
    let item = click_chart(&mut scene, right_point).expect("zoomed right-axis point");
    assert_eq!(item["name"], "二月");
    assert_eq!(item["index"], 1);
    assert_eq!(item["series"], 2);
    assert_eq!(item["value"], 1.0);
    assert_eq!(item["row"]["value2"], 1.0);

    chart.data["rows"] = json!([
        {"name":"一月", "value":100, "value2":-2},
        {"name":"二月", "value":100, "value2":-1},
        {"name":"三月", "value":100, "value2":1},
        {"name":"四月", "value":100, "value2":2}
    ]);
    scene.pointer("leave", right_point);
    sync(&mut scene, vec![chart.clone()], true, vec![]);
    scene.frame(&clock(), 400, 300, false).textures.clear();
    let negative = chart.world(egui::pos2(110.0, 151.0));
    let item = click_chart(&mut scene, negative).expect("zoomed negative point");
    assert_eq!(item["name"], "二月");
    assert_eq!(item["index"], 1);
    assert_eq!(item["series"], 2);
    assert_eq!(item["value"], -1);
}

#[test]
fn dual_axis_right_axis_matches_the_line_series_in_both_orders() {
    for variant in ["dualGrouped", "dualReverse"] {
        let mut chart = node("dualAxis");
        chart.widget.text.clear();
        chart.data["rows"] = if variant == "dualReverse" {
            json!([
                {"name":"一月", "value":0.5, "value2":100, "value3":50},
                {"name":"二月", "value":1.0, "value2":100, "value3":50}
            ])
        } else {
            json!([
                {"name":"一月", "value":100, "value2":50, "value3":0.5},
                {"name":"二月", "value":100, "value2":50, "value3":1.0}
            ])
        };
        chart.data["chart"] = json!({"variant":variant, "seriesCount":3, "showLegend":false,
            "showXAxis":false, "showYAxis":false, "showGrid":false, "showPoints":true,
            "pointRadius":8, "kitPadding":[34,18,50,27], "showRightAxis":false});
        let mut scene = BoardScene::default();
        scene
            .set_font(include_bytes!("../../data-wind-cpu/assets/NotoSansSC-Regular.otf").to_vec())
            .expect("bundled font");
        let mut raster = Rasterizer::default();
        sync(&mut scene, vec![chart.clone()], true, vec![]);
        let mut frame = scene.frame(&clock(), 400, 300, false);
        let before = raster.render(&mut frame, 400, 300);
        let point = chart.world(egui::pos2(110.0, 105.5));
        let item = click_chart(&mut scene, point).expect("dual-axis line point");
        assert_eq!(item["value"], 0.5, "{variant}");
        assert_eq!(item["series"], if variant == "dualReverse" { 1 } else { 3 });

        scene.pointer("leave", point);
        chart.data["chart"]["showRightAxis"] = json!(true);
        sync(&mut scene, vec![chart], true, vec![]);
        let mut frame = scene.frame(&clock(), 400, 300, false);
        assert!(
            before != raster.render(&mut frame, 400, 300),
            "right axis for {variant}"
        );
        assert_eq!(
            click_chart(&mut scene, point).expect("line after axis change")["value"],
            0.5
        );
    }
}

#[test]
fn dual_axis_tooltip_uses_right_format_in_both_series_orders() {
    for variant in ["dualGrouped", "dualReverse"] {
        let mut chart = node("dualAxis");
        chart.widget.text.clear();
        chart.data["rows"] = if variant == "dualReverse" {
            json!([{"name":"A", "value":0.5, "value2":100, "value3":50},
                {"name":"B", "value":1.0, "value2":100, "value3":50}])
        } else {
            json!([{"name":"A", "value":100, "value2":50, "value3":0.5},
                {"name":"B", "value":100, "value2":50, "value3":1.0}])
        };
        chart.data["chart"] = json!({"variant":variant, "seriesCount":3, "showLegend":false,
            "showXAxis":false, "showYAxis":false, "showGrid":false, "showPoints":true,
            "pointRadius":8, "kitPadding":[34,18,50,27], "showRightAxis":false,
            "tooltipFormat":"normal", "tooltipRightFormat":"normal", "tooltipAxisTrigger":false});
        let point = chart.world(egui::pos2(110.0, 105.5));
        let mut scene = BoardScene::default();
        let mut raster = Rasterizer::default();
        sync(&mut scene, vec![chart.clone()], true, vec![]);
        raster.render(&mut scene.frame(&clock(), 400, 300, false), 400, 300);
        scene.pointer("move", point);
        let normal = raster.render(&mut scene.frame(&clock(), 400, 300, false), 400, 300);
        chart.data["chart"]["tooltipFormat"] = json!("percent");
        chart.data["chart"]["tooltipDecimals"] = json!(3);
        sync(&mut scene, vec![chart.clone()], true, vec![]);
        scene.pointer("move", point);
        let left_changed = raster.render(&mut scene.frame(&clock(), 400, 300, false), 400, 300);
        assert_eq!(
            normal, left_changed,
            "left format must not change the {variant} right series"
        );
        chart.data["chart"]["tooltipRightFormat"] = json!("percent");
        sync(&mut scene, vec![chart], true, vec![]);
        scene.pointer("move", point);
        let right_changed = raster.render(&mut scene.frame(&clock(), 400, 300, false), 400, 300);
        assert_ne!(
            normal, right_changed,
            "right format must change the {variant} right series"
        );
    }
}

#[test]
fn projected_3d_column_top_face_follows_its_legend() {
    let mut chart = node("bar3dGrouped");
    chart.data["chart"] = json!({"seriesCount":2});
    let top = chart.world(egui::pos2(82.0, 121.0));
    let legend = chart.world(egui::pos2(222.0, 43.0));
    let mut scene = BoardScene::default();
    sync(&mut scene, vec![chart], true, vec![]);
    scene.frame(&clock(), 400, 300, false).textures.clear();
    let item = click_chart(&mut scene, top).expect("3D column top face");
    assert_eq!(item["name"], "温度");
    assert_eq!(item["series"], 1);
    assert!(click_chart(&mut scene, legend).is_none());
    scene.frame(&clock(), 400, 300, false).textures.clear();
    assert!(click_chart(&mut scene, top).is_none());
    assert!(click_chart(&mut scene, legend).is_none());
    scene.frame(&clock(), 400, 300, false).textures.clear();
    assert_eq!(
        click_chart(&mut scene, top).expect("restored column")["value"],
        36
    );
}

#[test]
fn sankey_ribbon_and_sunburst_child_report_their_data() {
    let mut chart = node("bar");
    chart.data["chart"] = json!({"variant":"sankey"});
    chart.data["rows"] = json!([{"节点1":"入口", "节点2":"页面", "数值":24}]);
    let ribbon = chart.world(egui::pos2(150.0, 100.0));
    let source = chart.world(egui::pos2(64.0, 100.0));
    let mut scene = BoardScene::default();
    sync(&mut scene, vec![chart.clone()], true, vec![]);
    scene.frame(&clock(), 400, 300, false).textures.clear();
    let item = click_chart(&mut scene, ribbon).expect("ribbon mesh");
    assert_eq!(item["name"], "入口 → 页面");
    assert_eq!(item["row"]["数值"], 24);
    assert_eq!(
        click_chart(&mut scene, source).expect("flow node")["name"],
        "入口"
    );

    chart.widget.kind = "pieBasic".into();
    chart.data["chart"] = json!({"variant":"sunburst"});
    chart.data["rows"] = json!([
        {"name":"产品", "value":60, "children":[{"name":"产品一", "value":20}, {"name":"产品二", "value":40}]},
        {"name":"管理", "value":40}
    ]);
    let child = chart.world(egui::pos2(210.0, 71.0));
    sync(&mut scene, vec![chart], true, vec![]);
    scene.frame(&clock(), 400, 300, false).textures.clear();
    let item = click_chart(&mut scene, child).expect("outer sector");
    assert_eq!(item["name"], "产品一");
    assert_eq!(item["childIndex"], 0);
    assert_eq!(item["row"]["value"], 20);
}

#[test]
fn chart_picking_follows_animated_data_and_entrance_position() {
    let mut chart = node("barHorizontal");
    chart.data["chart"] =
        json!({"variant":"dynamicBar", "maxItems":1, "duration":1, "startAt":1000});
    chart.data["rows"] = json!([
        {"period":"一月", "name":"咖啡", "value":100}, {"period":"一月", "name":"茶", "value":30},
        {"period":"二月", "name":"咖啡", "value":30}, {"period":"二月", "name":"茶", "value":90}
    ]);
    let bar = chart.world(egui::pos2(100.0, 123.0));
    let mut scene = BoardScene::default();
    let mut time = clock();
    sync(&mut scene, vec![chart], true, vec![]);
    time.now = 1000.0;
    scene.frame(&time, 400, 300, false).textures.clear();
    assert_eq!(
        click_chart(&mut scene, bar).expect("January leader")["name"],
        "咖啡"
    );
    time.now = 2000.0;
    scene.frame(&time, 400, 300, false).textures.clear();
    assert_eq!(
        click_chart(&mut scene, bar).expect("February leader")["index"],
        3
    );

    let mut chart = node("barHorizontal");
    chart.rotation = 25.0;
    chart.data["chart"] = json!({"variant":"horizontalGrouped", "seriesCount":2});
    chart.data["__dwEntrance"] = json!([{"animation":"slideRight", "easing":"linear",
        "startAt":1000, "delay":200, "duration":1000}]);
    let original = chart.world(egui::pos2(70.0, 82.0));
    let animated = chart.world(egui::pos2(124.0, 82.0));
    sync(&mut scene, vec![chart], true, vec![]);
    time.now = 1100.0;
    scene.frame(&time, 400, 300, false).textures.clear();
    assert!(
        scene.hit_test(animated).is_none(),
        "chart is invisible during delay"
    );
    time.now = 1700.0;
    scene.frame(&time, 400, 300, false).textures.clear();
    assert!(click_chart(&mut scene, original).is_none());
    assert_eq!(
        click_chart(&mut scene, animated).expect("shifted bar")["value"],
        24
    );
}

#[test]
fn entrance_animation_applies_delay_and_opacity_to_the_whole_component() {
    let mut shape = node("shape");
    shape.width = 100.0;
    shape.height = 100.0;
    shape.widget.background = "#ff0000".into();
    shape.widget.border_style = "none".into();
    shape.widget.radius = 0.0;
    shape.widget.text.clear();
    shape.color = "transparent".into();
    shape.data["__dwEntrance"] = json!([{"animation":"fade", "easing":"linear",
        "startAt":1000, "delay":200, "duration":1000}]);
    let mut scene = BoardScene::default();
    sync(&mut scene, vec![shape], true, vec![]);
    let mut raster = Rasterizer::default();
    let mut time = clock();
    let mut alpha = |now| {
        time.now = now;
        let pixels = raster.render(&mut scene.frame(&time, 400, 300, false), 400, 300);
        pixels[(60 * 400 + 60) * 4 + 3]
    };
    assert_eq!(alpha(1100.0), 0);
    assert!((125..=130).contains(&alpha(1700.0)));
    assert_eq!(alpha(2300.0), 255);
}

#[test]
fn rasterized_alpha_has_no_double_blended_triangle_seams() {
    let mut scene = BoardScene::default();
    let mut shape = node("shape");
    shape.width = 100.0;
    shape.height = 100.0;
    shape.widget.background = "#ff000080".into();
    shape.widget.border_style = "none".into();
    shape.widget.radius = 0.0;
    shape.widget.opacity = 0.5;
    shape.color = "transparent".into();
    sync(&mut scene, vec![shape], false, vec![]);
    let pixels =
        Rasterizer::default().render(&mut scene.frame(&clock(), 400, 300, false), 400, 300);
    let diagonal = &pixels[(60 * 400 + 60) * 4..(60 * 400 + 60) * 4 + 4];
    let adjacent = &pixels[(60 * 400 + 61) * 4..(60 * 400 + 61) * 4 + 4];
    assert_eq!(diagonal, adjacent);
    assert!(
        (63..=65).contains(&diagonal[3]),
        "opacity is applied once: {diagonal:?}"
    );
}

#[test]
fn decoded_media_uses_rust_texture_rasterization() {
    let mut scene = BoardScene::default();
    let mut image = node("image");
    image.widget.background = "transparent".into();
    sync(&mut scene, vec![image], false, vec![]);
    scene
        .set_image("component", 1, 1, &[25, 210, 90, 255])
        .expect("valid decoded image");
    let pixels =
        Rasterizer::default().render(&mut scene.frame(&clock(), 400, 300, false), 400, 300);
    let center = &pixels[(120 * 400 + 190) * 4..(120 * 400 + 190) * 4 + 4];
    assert_eq!(center, &[25, 210, 90, 255]);
    assert!(scene.set_image("component", 2, 2, &[0; 3]).is_err());
}

#[test]
fn ranking_labels_render_in_both_directions_and_accept_images() {
    let render = |kind: &str, display: &str, image: bool| {
        let mut scene = BoardScene::default();
        let mut chart = node(kind);
        chart.widget.text.clear();
        chart.widget.background = "transparent".into();
        chart.widget.border_style = "none".into();
        chart.data = json!({
            "__kitChart": true,
            "rows": [{"name":"A","value":20}, {"name":"B","value":8}, {"name":"C","value":30}],
            "chart": {"showRanking": true, "showLegend": false, "showGrid": false,
                "rankingColor": "#00000000", "rankingDisplay": display,
                "rankingBackground": if image { "image" } else { "shape" },
                "rankingBackgroundColor": "#ff0000", "rankingBackgroundWidth": 22,
                "rankingBackgroundHeight": 14}
        });
        sync(&mut scene, vec![chart], false, vec![]);
        if image {
            scene
                .set_image("component", 1, 1, &[0, 255, 0, 255])
                .expect("ranking image");
        }
        Rasterizer::default().render(&mut scene.frame(&clock(), 400, 300, false), 400, 300)
    };
    let red_pixels = |pixels: &[u8]| {
        pixels
            .chunks_exact(4)
            .filter(|pixel| pixel[0] > 240 && pixel[1] < 10 && pixel[2] < 10)
            .count()
    };
    for kind in ["barGrouped", "barHorizontal", "line", "dualAxis"] {
        let all = red_pixels(&render(kind, "all", false));
        let max = red_pixels(&render(kind, "max", false));
        assert!(
            all > max && max > 0,
            "{kind} must paint the selected ranking backgrounds"
        );
    }
    let image = render("barGrouped", "all", true);
    assert!(
        image
            .chunks_exact(4)
            .any(|pixel| pixel[0] < 10 && pixel[1] > 240 && pixel[2] < 10),
        "ranking background must sample the decoded image texture"
    );
}

#[test]
fn scaled_frames_tessellate_in_document_space_and_stay_visible() {
    let mut scene = BoardScene::default();
    sync(&mut scene, vec![node("text")], false, vec![]);
    let mut raster = Rasterizer::default();
    // ppp 恒为 1：细分与文本排版都发生在文档坐标系，文档→画布缩放只在顶点变换里做一次。
    for (width, height) in [(200u32, 150u32), (800u32, 450u32), (400u32, 300u32)] {
        let mut frame = scene.frame(&clock(), width, height, false);
        assert_eq!(scene.context.pixels_per_point(), 1.0);
        assert_eq!(
            raster.render(&mut frame, width, height).len(),
            (width * height * 4) as usize
        );
    }
}

#[test]
fn unknown_widgets_and_invalid_documents_fail_without_replacing_the_live_scene() {
    let mut scene = BoardScene::default();
    sync(&mut scene, vec![node("text")], false, vec![]);
    assert!(
        scene
            .sync(board::BoardDocument {
                width: 400.0,
                height: 300.0,
                nodes: vec![node("missing")],
                ..board::BoardDocument::default()
            })
            .is_err()
    );
    assert!(
        scene
            .sync(board::BoardDocument {
                width: 0.0,
                height: 300.0,
                ..board::BoardDocument::default()
            })
            .is_err()
    );
    assert_eq!(scene.document.nodes[0].widget.kind, "text");
}

#[test]
fn media_fill_modes_stretch_or_center_decoded_textures() {
    let mut scene = BoardScene::default();
    // 拉伸填充：1×1 纹理撑满组件矩形
    let mut stretched = node("image");
    stretched.widget.background = "transparent".into();
    stretched.data["objectFit"] = json!("stretch");
    sync(&mut scene, vec![stretched], false, vec![]);
    scene
        .set_image("component", 1, 1, &[25, 210, 90, 255])
        .expect("decoded texture");
    let pixels =
        Rasterizer::default().render(&mut scene.frame(&clock(), 400, 300, false), 400, 300);
    let corner = &pixels[(12 * 400 + 12) * 4..(12 * 400 + 12) * 4 + 4];
    assert_eq!(corner, &[25, 210, 90, 255], "stretch fills the whole rect");
    // 居中：组件角落不再被纹理覆盖（等比 contain 留白）
    let mut centered = node("image");
    centered.widget.background = "transparent".into();
    centered.data["objectFit"] = json!("center");
    sync(&mut scene, vec![centered], false, vec![]);
    let pixels =
        Rasterizer::default().render(&mut scene.frame(&clock(), 400, 300, false), 400, 300);
    let corner = &pixels[(12 * 400 + 12) * 4..(12 * 400 + 12) * 4 + 4];
    assert_eq!(corner[3], 0, "center keeps letterbox margins transparent");
}

#[test]
fn media_control_bars_follow_their_visibility_settings() {
    let mut scene = BoardScene::default();
    scene
        .set_font(include_bytes!("../../data-wind-cpu/assets/NotoSansSC-Regular.otf").to_vec())
        .expect("bundled CJK font");
    // 监控默认显示控制条（底部 34px 深色条）
    let mut monitor = node("monitor");
    monitor.data["src"] = json!("rtsp://cam.local/stream");
    sync(&mut scene, vec![monitor.clone()], true, vec![]);
    let pixels =
        Rasterizer::default().render(&mut scene.frame(&clock(), 400, 300, false), 400, 300);
    let bar = &pixels[(210 * 400 + 40) * 4..(210 * 400 + 40) * 4 + 4];
    assert!(bar[2] > bar[0], "monitor control bar is dark blue: {bar:?}");
    // 关闭「显示控制条」后同一位置无控制条（透明画布）
    monitor.data["showControls"] = json!(false);
    sync(&mut scene, vec![monitor], true, vec![]);
    let pixels =
        Rasterizer::default().render(&mut scene.frame(&clock(), 400, 300, false), 400, 300);
    let bar = &pixels[(210 * 400 + 40) * 4..(210 * 400 + 40) * 4 + 4];
    assert_eq!(bar[3], 0, "hidden control bar leaves the canvas clear");
    // 视频「隐藏控制条」
    let mut video = node("video");
    video.data["src"] = json!("/media/demo.mp4");
    video.data["hideControls"] = json!(true);
    sync(&mut scene, vec![video], true, vec![]);
    let pixels =
        Rasterizer::default().render(&mut scene.frame(&clock(), 400, 300, false), 400, 300);
    let bar = &pixels[(210 * 400 + 40) * 4..(210 * 400 + 40) * 4 + 4];
    assert_eq!(bar[3], 0, "video control bar respects 隐藏控制条");
}

#[test]
fn pdf_placeholder_uses_loading_color_and_buttons_emit_page_events() {
    let mut scene = BoardScene::default();
    scene
        .set_font(include_bytes!("../../data-wind-cpu/assets/NotoSansSC-Regular.otf").to_vec())
        .expect("bundled CJK font");
    // 已设置地址但未解码完成：按「加载时颜色」铺底
    let mut pdf = node("pdf");
    pdf.data["src"] = json!("/media/manual.pdf");
    pdf.data["loadingColor"] = json!("#203040");
    pdf.data["clickNext"] = json!(true);
    pdf.widget.background = "transparent".into();
    pdf.widget.border_style = "none".into();
    sync(&mut scene, vec![pdf], true, vec![]);
    let pixels =
        Rasterizer::default().render(&mut scene.frame(&clock(), 400, 300, false), 400, 300);
    let body = &pixels[(60 * 400 + 60) * 4..(60 * 400 + 60) * 4 + 4];
    assert_eq!(
        &body[..3],
        &[32, 48, 64],
        "pdf shows loading color: {body:?}"
    );
    // 「点击切换下一页」：组件整体点击 → Page +1
    scene.pointer("down", egui::pos2(190.0, 120.0));
    scene.pointer("up", egui::pos2(190.0, 120.0));
    let events = scene.take_events();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].action, protocol::wire::BoardAction::Page);
    assert_eq!(events[0].value.as_f64(), Some(1.0));
    // 翻页按钮：左 = 上一页，右 = 下一页
    scene.pointer("down", egui::pos2(25.0, 120.0));
    scene.pointer("up", egui::pos2(25.0, 120.0));
    let events = scene.take_events();
    assert_eq!(events.len(), 1);
    assert_eq!(
        events[0].value.as_f64(),
        Some(-1.0),
        "left button = prev page"
    );
    scene.pointer("down", egui::pos2(355.0, 120.0));
    scene.pointer("up", egui::pos2(355.0, 120.0));
    assert_eq!(scene.take_events()[0].value.as_f64(), Some(1.0));
}

#[test]
fn carousel_switch_buttons_emit_page_events_and_respect_arrow_visibility() {
    let mut scene = BoardScene::default();
    scene
        .set_font(include_bytes!("../../data-wind-cpu/assets/NotoSansSC-Regular.otf").to_vec())
        .expect("bundled CJK font");
    let mut carousel = node("carousel");
    carousel.data["urls"] = json!(["/media/a.webp", "/media/b.webp"]);
    carousel.data["buttonColor"] = json!("#0a1522aa");
    sync(&mut scene, vec![carousel], true, vec![]);
    // 内部按钮：左右边缘
    scene.pointer("down", egui::pos2(26.0, 120.0));
    scene.pointer("up", egui::pos2(26.0, 120.0));
    let events = scene.take_events();
    assert_eq!(events[0].action, protocol::wire::BoardAction::Page);
    assert_eq!(events[0].value.as_f64(), Some(-1.0), "prev button");
    scene.pointer("down", egui::pos2(354.0, 120.0));
    scene.pointer("up", egui::pos2(354.0, 120.0));
    assert_eq!(scene.take_events()[0].value.as_f64(), Some(1.0));
    // 点击图片主体（按钮之外）不产生事件
    scene.pointer("down", egui::pos2(190.0, 120.0));
    scene.pointer("up", egui::pos2(190.0, 120.0));
    assert!(
        scene.take_events().is_empty(),
        "body click is not a page turn"
    );
    // 「切换箭头=不显示」：按钮区域不再响应
    let mut hidden = node("carousel");
    hidden.data["urls"] = json!(["/media/a.webp"]);
    hidden.data["arrows"] = json!("never");
    sync(&mut scene, vec![hidden], true, vec![]);
    scene.pointer("down", egui::pos2(26.0, 120.0));
    scene.pointer("up", egui::pos2(26.0, 120.0));
    assert!(
        scene.take_events().is_empty(),
        "arrows=never disables buttons"
    );
    // 「外部」按钮在组件矩形外仍可点击
    let mut outside = node("carousel");
    outside.data["urls"] = json!(["/media/a.webp"]);
    outside.data["buttonPosition"] = json!("outside");
    sync(&mut scene, vec![outside], true, vec![]);
    scene.pointer("down", egui::pos2(2.0, 120.0));
    scene.pointer("up", egui::pos2(2.0, 120.0));
    assert_eq!(
        scene.take_events()[0].value.as_f64(),
        Some(-1.0),
        "outside prev button"
    );
}

#[test]
fn map_tile_imagery_texture_serves_as_the_base_layer() {
    let mut scene = BoardScene::default();
    scene
        .set_font(include_bytes!("../../data-wind-cpu/assets/NotoSansSC-Regular.otf").to_vec())
        .expect("bundled CJK font");
    let mut tile = node("mapTile");
    tile.data["region"] = json!("china");
    tile.data["theme"] = json!("black-gold");
    tile.data["tile"] =
        json!({ "imagery": "satellite", "centerLon": 105.0, "centerLat": 36.0, "zoom": 1.0 });
    tile.data["rows"] = json!([]);
    tile.widget.background = "transparent".into();
    tile.widget.border_style = "none".into();
    sync(&mut scene, vec![tile], true, vec![]);
    scene
        .set_image(
            "component",
            2,
            2,
            &[
                90, 40, 200, 255, 90, 40, 200, 255, 90, 40, 200, 255, 90, 40, 200, 255,
            ],
        )
        .expect("imagery texture");
    let pixels =
        Rasterizer::default().render(&mut scene.frame(&clock(), 400, 300, false), 400, 300);
    // 影像纹理铺满视野矩形（同帧 texture delta 由同一 Rasterizer 消费）
    for (x, y) in [(190usize, 120usize), (110, 80), (270, 160)] {
        let px = &pixels[(y * 400 + x) * 4..(y * 400 + x) * 4 + 4];
        assert_eq!(px, &[90, 40, 200, 255], "imagery covers ({x},{y})");
    }
}

#[test]
fn map_tile_imagery_highlight_overlays_the_base_layer() {
    let mut scene = BoardScene::default();
    scene
        .set_font(include_bytes!("../../data-wind-cpu/assets/NotoSansSC-Regular.otf").to_vec())
        .expect("bundled CJK font");
    // 与 boardCanvas loadGeojson 同一打标：DATASET/NAME/NAME_ZH（区域子集过滤依赖它）
    let mut value: Value = serde_json::from_str(include_str!(
        "../../../frontend/public/gis/china-provinces.geojson"
    ))
    .expect("china provinces");
    for feature in value["features"].as_array_mut().expect("features") {
        let name = feature["properties"]["name"]
            .as_str()
            .unwrap_or_default()
            .to_string();
        feature["properties"]["NAME"] = json!(name);
        feature["properties"]["NAME_ZH"] = json!(name);
        feature["properties"]["DATASET"] = json!("china");
    }
    scene.set_geojson(value).expect("china provinces");
    let mut tile = node("mapTile");
    tile.data["region"] = json!("china");
    tile.data["theme"] = json!("black-gold");
    tile.data["tile"] =
        json!({ "imagery": "satellite", "centerLon": 105.0, "centerLat": 36.0, "zoom": 1.0 });
    tile.data["rows"] = json!([{ "name": "北京市", "value": 96 }]);
    tile.widget.background = "transparent".into();
    tile.widget.border_style = "none".into();
    sync(&mut scene, vec![tile], true, vec![]);
    scene
        .set_image(
            "component",
            2,
            2,
            &[
                90, 40, 200, 255, 90, 40, 200, 255, 90, 40, 200, 255, 90, 40, 200, 255,
            ],
        )
        .expect("imagery texture");
    let pixels =
        Rasterizer::default().render(&mut scene.frame(&clock(), 400, 300, false), 400, 300);
    // 影像之上叠加半透明主题高亮（北京市）：不再是纯影像色，也非不透明高亮色
    // 北京市 (116.4E, 39.9N) 在 china 墨卡托视野 ≈ 画布 (255,103) 附近：扫描高亮/标注覆盖
    let mut tinted = 0;
    for y in 90..118 {
        for x in 238..272 {
            let px = &pixels[(y * 400 + x) * 4..(y * 400 + x) * 4 + 4];
            if px != &[90, 40, 200, 255] {
                tinted += 1;
            }
        }
    }
    println!("tinted pixels near beijing = {tinted}");
    assert!(tinted >= 8, "highlight or label tints imagery near beijing");
}
