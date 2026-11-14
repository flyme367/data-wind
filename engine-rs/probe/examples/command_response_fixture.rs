//! Regenerate the Rust-produced binary fixtures consumed by the TypeScript protocol tests.

#[allow(dead_code)]
#[path = "../../data-wind-cpu/src/common.rs"]
mod common;
#[path = "../../data-wind-cpu/src/protocol.rs"]
mod protocol;
#[path = "../tests/support/response_events.rs"]
mod response_events;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let fixtures = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../frontend/src/tests/fixtures");
    let mut encoder = protocol::ResponseEncoder::default();
    let response = encoder.encode(&mut response_events::sample_events());
    std::fs::write(fixtures.join("command_response_v1.bin"), &response)?;
    let board = encoder.encode(&mut response_events::sample_board_events());
    std::fs::write(fixtures.join("board_events_v1.bin"), &board)?;
    println!(
        "Wrote {} response bytes and {} board bytes to {}",
        response.len(),
        board.len(),
        fixtures.display()
    );
    Ok(())
}
