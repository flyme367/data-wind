#[path = "../../data-wind-cpu/src/common.rs"]
#[allow(dead_code)]
mod common;
#[path = "../../data-wind-cpu/src/protocol.rs"]
#[allow(dead_code)]
mod protocol;
#[path = "../../data-wind-cpu/src/board/mod.rs"]
#[allow(dead_code)]
mod board;

use board::{BoardFrame, BoardScene, Clock, Rasterizer};

fn copy_frame(frame: &BoardFrame) -> BoardFrame {
    BoardFrame {
        primitives: frame.primitives.clone(),
        textures: frame.textures.clone(),
    }
}

#[test]
fn parallel_bands_preserve_every_pixel_including_blending_clipping_and_texture_updates() {
    let single = rayon::ThreadPoolBuilder::new()
        .num_threads(1)
        .build()
        .expect("single worker");
    let parallel = rayon::ThreadPoolBuilder::new()
        .num_threads(4)
        .build()
        .expect("four workers");
    let mut scene = BoardScene::default();
    let node = |id: &str, x: f32, y: f32, width: f32, height: f32, rotation: f32,
                kind: &str, background: &str, opacity: f32, border_style: &str,
                border_width: f32| board::BoardNode {
        id: id.into(),
        x,
        y,
        width,
        height,
        rotation,
        widget: board::WidgetStyle {
            kind: kind.into(),
            background: background.into(),
            opacity,
            border_style: border_style.into(),
            border_width,
            ..board::WidgetStyle::default()
        },
        ..board::BoardNode::default()
    };
    scene
        .sync(board::BoardDocument {
            width: 769.0,
            height: 323.0,
            preview: true,
            nodes: vec![
                node("back", -20.0, -10.0, 810.0, 340.0, 0.0, "shape", "#154b8d80", 0.7, "none", 0.0),
                node("front", 45.0, 22.0, 620.0, 262.0, 17.0, "shape", "#e3754580", 0.65, "solid", 3.0),
                node("image", 125.0, 63.0, 420.0, 195.0, -13.0, "image", "", 0.75, "", 0.0),
            ],
            ..board::BoardDocument::default()
        })
        .expect("valid layered scene");
    let clock = Clock {
        time: "12:34:56".into(),
        year: 2026,
        month: 11,
        day: 2,
        first_weekday: 0,
        days: 30,
        now: 0.0,
    };
    let mut reference = Rasterizer::default();
    let mut threaded = Rasterizer::default();
    // The last band has only three rows; the second frame also exercises texture delta updates.
    for color in [[25, 210, 90, 128], [180, 30, 220, 192]] {
        scene
            .set_image("image", 2, 2, &color.repeat(4))
            .expect("RGBA texture");
        let mut frame = scene.frame(&clock, 769, 323, false);
        let expected = single.install(|| reference.render(&mut copy_frame(&frame), 769, 323));
        let actual = parallel.install(|| threaded.render(&mut copy_frame(&frame), 769, 323));
        frame.textures.clear();
        assert!(actual.chunks_exact(4).any(|pixel| pixel[3] > 0));
        assert_eq!(actual, expected, "bands must preserve all RGBA bytes");
    }
}

#[test]
fn empty_frames_do_not_dispatch_zero_sized_bands() {
    let mut raster = Rasterizer::default();
    for (width, height) in [(0, 64), (64, 0), (0, 0)] {
        let mut frame = BoardFrame {
            primitives: Vec::new(),
            textures: egui::TexturesDelta::default(),
        };
        assert!(raster.render(&mut frame, width, height).is_empty());
        assert!(frame.textures.is_empty());
    }
}
