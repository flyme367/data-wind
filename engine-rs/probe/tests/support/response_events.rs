use crate::common::EngineEvent;

pub fn sample_events() -> Vec<EngineEvent> {
    vec![
        EngineEvent::Pick {
            id: Some("模型-α🙂".into()),
        },
        EngineEvent::Pick { id: None },
        EngineEvent::Transform {
            id: "model-2".into(),
            position: [1.25, -2.5, 300_000.0 + 0.125],
        },
        EngineEvent::Stats {
            backend: "GPU".into(),
            fps: 59.5,
            instances: 1024,
            visible: 512,
            particles: 8192,
            tris: u32::MAX,
        },
        EngineEvent::Hud {
            grid: false,
            flylines: true,
            stats: false,
        },
        EngineEvent::Error {
            message: "网格加载失败：资源不存在🙂".into(),
        },
        EngineEvent::Probe {
            rgba: [0, 51, 204, 255],
        },
    ]
}

/// Board (egui canvas) events drained through the same DWCR queue.
pub fn sample_board_events() -> Vec<EngineEvent> {
    use crate::protocol::wire::BoardAction;
    use serde_json::json;
    vec![
        EngineEvent::BoardEvent {
            id: "btn-1".into(),
            kind: "button".into(),
            action: BoardAction::Change,
            value: json!("文本-β🙂"),
        },
        EngineEvent::BoardEvent {
            id: "input-1".into(),
            kind: "input".into(),
            action: BoardAction::Focus,
            value: json!("正在输入…"),
        },
        EngineEvent::BoardEvent {
            id: "iframe-1".into(),
            kind: "iframe".into(),
            action: BoardAction::Open,
            value: serde_json::Value::Null,
        },
        EngineEvent::BoardEvent {
            id: "video-1".into(),
            kind: "video".into(),
            action: BoardAction::Media,
            value: json!(true),
        },
        EngineEvent::BoardEvent {
            id: "upload-1".into(),
            kind: "upload".into(),
            action: BoardAction::Upload,
            value: json!(["a.csv", "数据-b.json"]),
        },
        EngineEvent::BoardEvent {
            id: "picker-1".into(),
            kind: "colorPicker".into(),
            action: BoardAction::ColorPicker,
            value: json!("#33cc88"),
        },
        EngineEvent::BoardEvent {
            id: "slider-1".into(),
            kind: "slider".into(),
            action: BoardAction::Change,
            value: json!({
                "min": 0,
                "max": 86_399.5,
                "labels": ["低", "高"],
                "nested": {"deep": [1, 2.5, null]},
            }),
        },
    ]
}
