//! Owned, size-prefixed `FlatBuffers` responses for the JS/Wasm boundary,
//! plus the frontend -> engine `CommandRequest` decode helpers.

use crate::common::EngineEvent;
use flatbuffers::{FlatBufferBuilder, WIPOffset};

// Upstream flatc accessors are isolated from handwritten safe encoding code.
// The generator adds SAFETY contracts; readers use the generated verified root API.
#[allow(dead_code, unused_imports, unsafe_code, clippy::all, clippy::pedantic)]
#[path = "generated/command_response_generated.rs"]
mod generated;
pub use generated::data_wind_protocol as wire;

pub const PROTOCOL_VERSION: u16 = 1;

pub struct ResponseEncoder {
    builder: FlatBufferBuilder<'static>,
}

impl Default for ResponseEncoder {
    fn default() -> Self {
        Self {
            builder: FlatBufferBuilder::with_capacity(1024),
        }
    }
}

impl ResponseEncoder {
    /// Drain in order. No events return zero bytes, avoiding an empty packet every frame.
    /// The owned result survives builder reuse and Wasm memory growth on the JS side.
    pub fn encode(&mut self, events: &mut Vec<EngineEvent>) -> Vec<u8> {
        if events.is_empty() {
            return Vec::new();
        }
        self.builder.reset();
        let offsets: Vec<_> = events
            .iter()
            .map(|event| encode_event(&mut self.builder, event))
            .collect();
        let wire_events = self.builder.create_vector(&offsets);
        let response = wire::CommandResponse::create(
            &mut self.builder,
            &wire::CommandResponseArgs {
                protocol_version: PROTOCOL_VERSION,
                events: Some(wire_events),
            },
        );
        wire::finish_size_prefixed_command_response_buffer(&mut self.builder, response);
        let bytes = self.builder.finished_data().to_vec();
        events.clear();
        bytes
    }
}

fn encode_event<'buf>(
    builder: &mut FlatBufferBuilder<'buf>,
    event: &EngineEvent,
) -> WIPOffset<wire::Event<'buf>> {
    let (payload_type, payload) = match event {
        EngineEvent::Pick { id } => {
            let id = id.as_ref().map(|id| builder.create_string(id));
            let payload = wire::PickEvent::create(builder, &wire::PickEventArgs { id });
            (wire::EventPayload::PickEvent, payload.as_union_value())
        }
        EngineEvent::Transform { id, position } => {
            let id = builder.create_string(id);
            let position = wire::Vec3::new(position[0], position[1], position[2]);
            let payload = wire::TransformEvent::create(
                builder,
                &wire::TransformEventArgs {
                    id: Some(id),
                    position: Some(&position),
                },
            );
            (wire::EventPayload::TransformEvent, payload.as_union_value())
        }
        EngineEvent::Stats {
            backend,
            fps,
            instances,
            visible,
            particles,
            tris,
        } => {
            let backend = builder.create_string(backend);
            let payload = wire::StatsEvent::create(
                builder,
                &wire::StatsEventArgs {
                    backend: Some(backend),
                    fps: *fps,
                    instances: *instances,
                    visible: *visible,
                    particles: *particles,
                    triangles: *tris,
                },
            );
            (wire::EventPayload::StatsEvent, payload.as_union_value())
        }
        EngineEvent::Hud {
            grid,
            flylines,
            stats,
        } => {
            let payload = wire::HudEvent::create(
                builder,
                &wire::HudEventArgs {
                    grid: *grid,
                    flylines: *flylines,
                    stats: *stats,
                },
            );
            (wire::EventPayload::HudEvent, payload.as_union_value())
        }
        EngineEvent::Error { message } => {
            let message = builder.create_string(message);
            let payload = wire::ErrorEvent::create(
                builder,
                &wire::ErrorEventArgs {
                    message: Some(message),
                },
            );
            (wire::EventPayload::ErrorEvent, payload.as_union_value())
        }
        EngineEvent::Probe { rgba } => {
            let rgba = wire::Rgba::new(rgba[0], rgba[1], rgba[2], rgba[3]);
            let payload =
                wire::ProbeEvent::create(builder, &wire::ProbeEventArgs { rgba: Some(&rgba) });
            (wire::EventPayload::ProbeEvent, payload.as_union_value())
        }
        EngineEvent::BoardEvent {
            id,
            kind,
            action,
            value,
        } => {
            let id = builder.create_string(id);
            let kind = builder.create_string(kind);
            let value = json_value_to_wire(builder, value);
            let payload = wire::BoardEvent::create(
                builder,
                &wire::BoardEventArgs {
                    id: Some(id),
                    kind: Some(kind),
                    action: *action,
                    value: Some(value),
                },
            );
            (wire::EventPayload::BoardEvent, payload.as_union_value())
        }
    };
    wire::Event::create(
        builder,
        &wire::EventArgs {
            payload_type,
            payload: Some(payload),
        },
    )
}

/// Decode and verify a frontend `CommandRequest` buffer; version 1 only.
pub fn decode_request(bytes: &[u8]) -> Result<wire::CommandRequest<'_>, String> {
    let request = flatbuffers::root::<wire::CommandRequest>(bytes)
        .map_err(|error| format!("命令解析失败: {error}"))?;
    if request.protocol_version() != PROTOCOL_VERSION {
        return Err(format!("命令协议版本不符: {}", request.protocol_version()));
    }
    Ok(request)
}

/// Rebuild the schema-less `serde_json::Value` from a verified generic wire value.
/// Verified union tags always carry their payload, so the fallbacks never fire.
pub fn json_value_from_wire(value: &wire::JsonValue<'_>) -> serde_json::Value {
    match value.payload_type() {
        wire::JsonPayload::JsonBool => serde_json::Value::Bool(
            value
                .payload_as_json_bool()
                .is_some_and(|payload| payload.value()),
        ),
        wire::JsonPayload::JsonNumber => {
            let payload = value.payload_as_json_number();
            let number = payload.map_or(0.0, |p| p.value());
            if payload.is_some_and(|p| p.integer()) && number.fract() == 0.0 {
                serde_json::Value::from(number as i64)
            } else {
                serde_json::Value::from(number)
            }
        }
        wire::JsonPayload::JsonString => serde_json::Value::String(
            value
                .payload_as_json_string()
                .map_or_else(String::new, |p| p.value().to_owned()),
        ),
        wire::JsonPayload::JsonArray => serde_json::Value::Array(
            value
                .payload_as_json_array()
                .and_then(|p| p.items())
                .map(|items| {
                    items
                        .iter()
                        .map(|item| json_value_from_wire(&item))
                        .collect()
                })
                .unwrap_or_default(),
        ),
        wire::JsonPayload::JsonObject => serde_json::Value::Object(
            value
                .payload_as_json_object()
                .and_then(|p| p.entries())
                .map(|entries| {
                    entries
                        .iter()
                        .filter_map(|entry| {
                            Some((
                                entry.key().to_owned(),
                                json_value_from_wire(&entry.value()?),
                            ))
                        })
                        .collect()
                })
                .unwrap_or_default(),
        ),
        _ => serde_json::Value::Null,
    }
}

/// Encode a `serde_json::Value` into the generic wire representation. Objects
/// keep insertion order; numbers outside f64 stay as-is (JSON semantics).
pub fn json_value_to_wire<'buf>(
    builder: &mut FlatBufferBuilder<'buf>,
    value: &serde_json::Value,
) -> WIPOffset<wire::JsonValue<'buf>> {
    let payload: WIPOffset<flatbuffers::UnionWIPOffset> = match value {
        serde_json::Value::Null => {
            wire::JsonNull::create(builder, &wire::JsonNullArgs {}).as_union_value()
        }
        serde_json::Value::Bool(inner) => {
            wire::JsonBool::create(builder, &wire::JsonBoolArgs { value: *inner }).as_union_value()
        }
        serde_json::Value::Number(inner) => wire::JsonNumber::create(
            builder,
            &wire::JsonNumberArgs {
                value: inner.as_f64().unwrap_or_default(),
                integer: inner.is_i64() || inner.is_u64(),
            },
        )
        .as_union_value(),
        serde_json::Value::String(inner) => {
            let inner = builder.create_string(inner);
            wire::JsonString::create(builder, &wire::JsonStringArgs { value: Some(inner) })
                .as_union_value()
        }
        serde_json::Value::Array(inner) => {
            let items: Vec<_> = inner
                .iter()
                .map(|item| json_value_to_wire(builder, item))
                .collect();
            let items = builder.create_vector(&items);
            wire::JsonArray::create(builder, &wire::JsonArrayArgs { items: Some(items) })
                .as_union_value()
        }
        serde_json::Value::Object(inner) => {
            let entries: Vec<_> = inner
                .iter()
                .map(|(key, item)| {
                    let key = builder.create_string(key);
                    let item = json_value_to_wire(builder, item);
                    wire::JsonEntry::create(
                        builder,
                        &wire::JsonEntryArgs {
                            key: Some(key),
                            value: Some(item),
                        },
                    )
                })
                .collect();
            let entries = builder.create_vector(&entries);
            wire::JsonObject::create(
                builder,
                &wire::JsonObjectArgs {
                    entries: Some(entries),
                },
            )
            .as_union_value()
        }
    };
    let payload_type = match value {
        serde_json::Value::Null => wire::JsonPayload::JsonNull,
        serde_json::Value::Bool(_) => wire::JsonPayload::JsonBool,
        serde_json::Value::Number(_) => wire::JsonPayload::JsonNumber,
        serde_json::Value::String(_) => wire::JsonPayload::JsonString,
        serde_json::Value::Array(_) => wire::JsonPayload::JsonArray,
        serde_json::Value::Object(_) => wire::JsonPayload::JsonObject,
    };
    wire::JsonValue::create(
        builder,
        &wire::JsonValueArgs {
            payload_type,
            payload: Some(payload),
        },
    )
}
