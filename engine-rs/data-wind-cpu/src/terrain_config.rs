//! Binary terrain parameters, independent of rendering and mesh dependencies.

use crate::protocol::wire;

#[derive(Clone, Debug, PartialEq)]
pub struct TerrainConfig {
    pub preset: String,
    pub seed: u32,
    pub levels: u32,
    pub detail_scale: f32,
    pub rock_color: [f32; 3],
    pub snow_color: [f32; 3],
    pub snow_line: f32,
    pub collision: bool,
    pub resolution: u32,
    pub heights: Vec<u16>,
}

impl Default for TerrainConfig {
    fn default() -> Self {
        Self {
            preset: "hills".into(),
            seed: 42,
            levels: 6,
            detail_scale: 16.0,
            rock_color: [0.50, 0.47, 0.43],
            snow_color: [0.92, 0.94, 0.95],
            snow_line: 1.1,
            collision: false,
            resolution: 0,
            heights: Vec::new(),
        }
    }
}

impl TerrainConfig {
    pub fn from_wire(value: wire::TerrainParams<'_>) -> Self {
        let color = |value: Option<&wire::Vec3>, fallback| {
            value.map_or(fallback, |v| [v.x(), v.y(), v.z()])
        };
        let default = Self::default();
        let resolution = value.resolution();
        let heights = value.heights().filter(|heights| {
            [33, 65, 129, 257].contains(&resolution)
                && heights.len() == (resolution * resolution) as usize
        });
        Self {
            preset: value.preset().unwrap_or("hills").to_owned(),
            seed: value.seed().min(1_000_000),
            levels: value.levels().clamp(3, 8),
            detail_scale: finite(value.detail_scale(), 16.0).clamp(1.0, 128.0),
            rock_color: color(value.rock_color(), default.rock_color),
            snow_color: color(value.snow_color(), default.snow_color),
            snow_line: finite(value.snow_line(), 1.1).clamp(0.0, 1.1),
            collision: value.collision(),
            resolution: if heights.is_some() { resolution } else { 0 },
            heights: heights.map(|v| v.iter().collect()).unwrap_or_default(),
        }
    }
}

fn finite(value: f32, fallback: f32) -> f32 {
    if value.is_finite() { value } else { fallback }
}
