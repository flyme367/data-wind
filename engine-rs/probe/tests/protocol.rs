#[allow(dead_code)]
#[path = "../../data-wind-cpu/src/common.rs"]
mod common;
#[path = "../../data-wind-cpu/src/mesh.rs"]
#[allow(dead_code)]
mod mesh;
#[path = "../../data-wind-cpu/src/picking.rs"]
#[allow(dead_code)]
mod picking;
#[path = "../../data-wind-cpu/src/protocol.rs"]
mod protocol;
#[path = "support/response_events.rs"]
mod response_events;
#[path = "../../data-wind-engine/src/scene.rs"]
mod scene;
#[path = "../../data-wind-cpu/src/terrain.rs"]
#[allow(dead_code)]
mod terrain;

use protocol::{PROTOCOL_VERSION, ResponseEncoder, wire};

#[test]
fn rust_response_matches_the_cross_language_fixture_and_all_event_fields() {
    let mut encoder = ResponseEncoder::default();
    let mut events = response_events::sample_events();
    let capacity = events.capacity();
    let bytes = encoder.encode(&mut events);
    assert!(events.is_empty());
    assert_eq!(events.capacity(), capacity);
    assert_eq!(
        bytes,
        include_bytes!("../../../frontend/src/tests/fixtures/command_response_v1.bin")
    );
    assert!(wire::command_response_size_prefixed_buffer_has_identifier(
        &bytes
    ));
    assert_eq!(
        u32::from_le_bytes(bytes[..4].try_into().expect("size prefix")) as usize,
        bytes.len() - 4
    );
    let response = wire::size_prefixed_root_as_command_response(&bytes).expect("verified response");
    assert_eq!(response.protocol_version(), PROTOCOL_VERSION);
    let events = response.events();
    assert_eq!(events.len(), 7);
    assert_eq!(
        events.get(0).payload_as_pick_event().expect("pick").id(),
        Some("模型-α🙂")
    );
    assert_eq!(
        events
            .get(1)
            .payload_as_pick_event()
            .expect("clear pick")
            .id(),
        None
    );
    let transform = events
        .get(2)
        .payload_as_transform_event()
        .expect("transform");
    assert_eq!(transform.id(), "model-2");
    let position = transform.position();
    assert_eq!(
        [position.x(), position.y(), position.z()],
        [1.25, -2.5, 300_000.125]
    );
    let stats = events.get(3).payload_as_stats_event().expect("stats");
    assert_eq!(stats.backend(), "GPU");
    assert_eq!(stats.fps(), 59.5);
    assert_eq!(
        (stats.instances(), stats.visible(), stats.particles()),
        (1024, 512, 8192)
    );
    assert_eq!(stats.triangles(), u32::MAX);
    let hud = events.get(4).payload_as_hud_event().expect("hud");
    assert!(!hud.grid());
    assert!(hud.flylines());
    assert!(!hud.stats());
    assert_eq!(
        events
            .get(5)
            .payload_as_error_event()
            .expect("error")
            .message(),
        "网格加载失败：资源不存在🙂"
    );
    let rgba = events
        .get(6)
        .payload_as_probe_event()
        .expect("probe")
        .rgba();
    assert_eq!([rgba.r(), rgba.g(), rgba.b(), rgba.a()], [0, 51, 204, 255]);
}

#[test]
fn empty_frames_emit_no_packet_and_reusing_the_builder_cannot_mutate_an_old_packet() {
    let mut encoder = ResponseEncoder::default();
    assert!(encoder.encode(&mut Vec::new()).is_empty());
    let first = encoder.encode(&mut response_events::sample_events());
    let first_view = wire::size_prefixed_root_as_command_response(&first).expect("first response");
    let long_message = "大场景错误🙂".repeat(4096);
    let second = encoder.encode(&mut vec![common::EngineEvent::Error {
        message: long_message.clone(),
    }]);
    assert!(second.len() > first.len());
    assert!(encoder.encode(&mut Vec::new()).is_empty());
    assert_eq!(first_view.events().len(), 7);
    assert_eq!(
        first_view
            .events()
            .get(0)
            .payload_as_pick_event()
            .expect("first pick")
            .id(),
        Some("模型-α🙂")
    );
    let second_view =
        wire::size_prefixed_root_as_command_response(&second).expect("second response");
    assert_eq!(
        second_view
            .events()
            .get(0)
            .payload_as_error_event()
            .expect("second error")
            .message(),
        long_message
    );
}

#[test]
fn verified_rust_reader_rejects_truncated_headers_and_invalid_root_offsets() {
    let mut encoder = ResponseEncoder::default();
    let mut bytes = encoder.encode(&mut response_events::sample_events());
    for end in 0..12 {
        assert!(wire::size_prefixed_root_as_command_response(&bytes[..end]).is_err());
    }
    bytes[4..8].copy_from_slice(&u32::MAX.to_le_bytes());
    assert!(wire::size_prefixed_root_as_command_response(&bytes).is_err());
}

#[test]
fn rust_board_events_match_the_cross_language_fixture_and_all_fields() {
    let mut encoder = ResponseEncoder::default();
    let bytes = encoder.encode(&mut response_events::sample_board_events());
    assert_eq!(
        bytes,
        include_bytes!("../../../frontend/src/tests/fixtures/board_events_v1.bin")
    );
    let response = wire::size_prefixed_root_as_command_response(&bytes).expect("verified board");
    let events = response.events();
    assert_eq!(events.len(), 7);
    let expected = [
        (wire::BoardAction::Change, "btn-1", "button"),
        (wire::BoardAction::Focus, "input-1", "input"),
        (wire::BoardAction::Open, "iframe-1", "iframe"),
        (wire::BoardAction::Media, "video-1", "video"),
        (wire::BoardAction::Upload, "upload-1", "upload"),
        (wire::BoardAction::ColorPicker, "picker-1", "colorPicker"),
        (wire::BoardAction::Change, "slider-1", "slider"),
    ];
    for (index, (action, id, kind)) in expected.iter().enumerate() {
        let event = events.get(index).payload_as_board_event().expect("board");
        assert_eq!(event.action(), *action);
        assert_eq!(event.id(), *id);
        assert_eq!(event.kind(), *kind);
    }
    let value = events
        .get(0)
        .payload_as_board_event()
        .expect("text")
        .value();
    assert_eq!(
        protocol::json_value_from_wire(value.as_ref().expect("text value")),
        serde_json::json!("文本-β🙂")
    );
    let value = events
        .get(3)
        .payload_as_board_event()
        .expect("media")
        .value();
    assert_eq!(
        protocol::json_value_from_wire(value.as_ref().expect("bool value")),
        serde_json::json!(true)
    );
    let value = events
        .get(6)
        .payload_as_board_event()
        .expect("slider")
        .value();
    assert_eq!(
        protocol::json_value_from_wire(value.as_ref().expect("object value")),
        serde_json::json!({
            "min": 0,
            "max": 86_399.5,
            "labels": ["低", "高"],
            "nested": {"deep": [1, 2.5, null]},
        })
    );
}

#[test]
fn verified_request_reader_decodes_frontend_command_envelopes() {
    let mut builder = flatbuffers::FlatBufferBuilder::with_capacity(256);
    let hud = wire::SetHud::create(
        &mut builder,
        &wire::SetHudArgs {
            grid: false,
            flylines: true,
            stats: false,
        },
    );
    let request = wire::CommandRequest::create(
        &mut builder,
        &wire::CommandRequestArgs {
            protocol_version: PROTOCOL_VERSION,
            payload_type: wire::CommandPayload::SetHud,
            payload: Some(hud.as_union_value()),
        },
    );
    builder.finish(request, None);
    let bytes = builder.finished_data().to_vec();
    let decoded = protocol::decode_request(&bytes).expect("verified request");
    assert_eq!(decoded.protocol_version(), PROTOCOL_VERSION);
    let hud = decoded.payload_as_set_hud().expect("set hud payload");
    assert!(!hud.grid());
    assert!(hud.flylines());
    assert!(!hud.stats());
    assert!(decoded.payload_as_scene_update().is_none());

    let mut builder = flatbuffers::FlatBufferBuilder::with_capacity(256);
    let pos = wire::Vec3::new(1.5, 2.0, -3.25);
    let size = wire::Vec3::new(4.0, 5.0, 6.0);
    let color = wire::Vec3::new(0.2, 0.4, 0.8);
    let rotation = builder.create_vector(&[0.1f32, 0.2, 0.3]);
    let id = builder.create_string("box-α🙂");
    let model_id = builder.create_string("model-1");
    let kind = builder.create_string("mesh");
    let instance = wire::Instance::create(
        &mut builder,
        &wire::InstanceArgs {
            id: Some(id),
            kind: Some(kind),
            pos: Some(&pos),
            size: Some(&size),
            rot_y: 0.5,
            rotation: Some(rotation),
            color: Some(&color),
            locked: Some(true),
            to: None,
            model_id: Some(model_id),
            terrain: None,
            water: None,
        },
    );
    let instances = builder.create_vector(&[instance]);
    let update = wire::SceneUpdate::create(
        &mut builder,
        &wire::SceneUpdateArgs {
            instances: Some(instances),
        },
    );
    let request = wire::CommandRequest::create(
        &mut builder,
        &wire::CommandRequestArgs {
            protocol_version: PROTOCOL_VERSION,
            payload_type: wire::CommandPayload::SceneUpdate,
            payload: Some(update.as_union_value()),
        },
    );
    builder.finish(request, None);
    let bytes = builder.finished_data().to_vec();
    let decoded = protocol::decode_request(&bytes).expect("verified scene update");
    let payload = decoded.payload_as_scene_update().expect("scene payload");
    let instances = payload.instances();
    assert_eq!(instances.len(), 1);
    let flat = scene::FlatInstanceIn::from_wire(instances.get(0));
    assert_eq!(flat.id, "box-α🙂");
    assert_eq!(flat.kind, "mesh");
    assert_eq!(flat.pos, [1.5, 2.0, -3.25]);
    assert_eq!(flat.rotation, Some([0.1, 0.2, 0.3]));
    assert_eq!(flat.locked, Some(true));
    assert_eq!(flat.to, None);
    assert_eq!(flat.model_id.as_deref(), Some("model-1"));

    let mut builder = flatbuffers::FlatBufferBuilder::with_capacity(256);
    let value = protocol::json_value_to_wire(
        &mut builder,
        &serde_json::json!({"max": 86_399.5, "labels": ["低", "高"], "flag": true}),
    );
    let id = builder.create_string("slider-1");
    let set_value = wire::SetValue::create(
        &mut builder,
        &wire::SetValueArgs {
            id: Some(id),
            value: Some(value),
        },
    );
    let request = wire::CommandRequest::create(
        &mut builder,
        &wire::CommandRequestArgs {
            protocol_version: PROTOCOL_VERSION,
            payload_type: wire::CommandPayload::SetValue,
            payload: Some(set_value.as_union_value()),
        },
    );
    builder.finish(request, None);
    let bytes = builder.finished_data().to_vec();
    let decoded = protocol::decode_request(&bytes).expect("verified set value");
    let payload = decoded.payload_as_set_value().expect("set value payload");
    assert_eq!(payload.id(), "slider-1");
    assert_eq!(
        protocol::json_value_from_wire(&payload.value().expect("value")),
        serde_json::json!({"max": 86_399.5, "labels": ["低", "高"], "flag": true})
    );
}

#[test]
fn request_reader_rejects_truncated_buffers_and_wrong_versions() {
    let mut builder = flatbuffers::FlatBufferBuilder::with_capacity(128);
    let mode = wire::SetMode::create(
        &mut builder,
        &wire::SetModeArgs {
            mode: wire::Mode::Login,
        },
    );
    let request = wire::CommandRequest::create(
        &mut builder,
        &wire::CommandRequestArgs {
            protocol_version: PROTOCOL_VERSION,
            payload_type: wire::CommandPayload::SetMode,
            payload: Some(mode.as_union_value()),
        },
    );
    builder.finish(request, None);
    let bytes = builder.finished_data().to_vec();
    assert!(protocol::decode_request(&bytes).is_ok());
    for end in 0..bytes.len().min(16) {
        assert!(protocol::decode_request(&bytes[..end]).is_err());
    }
    let mut builder = flatbuffers::FlatBufferBuilder::with_capacity(128);
    let mode = wire::SetMode::create(
        &mut builder,
        &wire::SetModeArgs {
            mode: wire::Mode::Login,
        },
    );
    let request = wire::CommandRequest::create(
        &mut builder,
        &wire::CommandRequestArgs {
            protocol_version: 7,
            payload_type: wire::CommandPayload::SetMode,
            payload: Some(mode.as_union_value()),
        },
    );
    builder.finish(request, None);
    assert!(protocol::decode_request(builder.finished_data()).is_err());
}

#[path = "../../data-wind-cpu/src/water.rs"]
#[allow(dead_code)]
mod water;
