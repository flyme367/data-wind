#[path = "../../data-wind-engine/src/preview.rs"]
mod preview;

use preview::{PreviewFrame, PreviewState, unpack_rows};

#[test]
fn readback_removes_row_padding_and_produces_opaque_pixels() {
    let bytes = [
        1, 2, 3, 0, 4, 5, 6, 0, 9, 9, 9, 9, 7, 8, 9, 0, 10, 11, 12, 0, 9, 9, 9, 9,
    ];
    let frame = unpack_rows(&bytes, 2, 2, 12, false).expect("valid padded rows");
    assert_eq!(frame.width, 2);
    assert_eq!(frame.height, 2);
    assert_eq!(
        frame.pixels,
        [1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255, 10, 11, 12, 255]
    );
    assert!(unpack_rows(&bytes[..20], 2, 2, 12, false).is_none());
    assert!(unpack_rows(&bytes, 0, 2, 0, false).is_none());
    assert!(unpack_rows(&bytes, 4, 2, 12, false).is_none());
}

#[test]
fn readback_matches_the_visible_non_srgb_surface() {
    let frame = unpack_rows(&[89, 92, 104, 0], 1, 1, 4, true).expect("one pixel");
    assert_eq!(frame.pixels, [25, 27, 35, 255]);
    let srgb_surface = unpack_rows(&[89, 92, 104, 0], 1, 1, 4, false).expect("one pixel");
    assert_eq!(srgb_surface.pixels, [89, 92, 104, 255]);
}

#[test]
fn cancelled_and_resized_captures_never_deliver_a_stale_frame() {
    let mut state = PreviewState::default();
    assert!(state.begin().is_none());
    state.set_enabled(true);
    let old = state.begin().expect("first copy");
    assert!(state.begin().is_none(), "only one buffer may be mapped");
    state.set_enabled(false);
    state.set_enabled(true);
    assert!(state.begin().is_none(), "wait for the old buffer to unmap");
    let frame = || PreviewFrame {
        width: 1,
        height: 1,
        pixels: vec![1, 2, 3, 255],
    };
    state.finish(old, Ok(frame()));
    assert!(
        state.take().is_none(),
        "cancelled request must not leak into a new one"
    );
    let resized = state.begin().expect("copy after cancellation");
    state.invalidate();
    state.finish(resized, Ok(frame()));
    assert!(state.take().is_none(), "resized frame must be discarded");
    let current = state.begin().expect("copy after resize");
    state.finish(current, Ok(frame()));
    assert!(
        state.begin().is_none(),
        "retain the ready frame until consumed"
    );
    assert_eq!(state.take(), Some(frame()));
}

#[test]
fn readback_errors_are_reported_and_allow_retry() {
    let mut state = PreviewState::default();
    state.set_enabled(true);
    let generation = state.begin().expect("copy");
    state.finish(generation, Err("failed".to_owned()));
    assert!(state.begin().is_none());
    assert_eq!(state.take_error().as_deref(), Some("failed"));
    assert!(state.begin().is_some());
}
