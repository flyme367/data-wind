//! Water wire data, shared by the Bevy renderer and the portable renderer.
use crate::protocol::wire;

#[derive(Clone, Debug, PartialEq)]
pub struct WaterConfig {
    pub preset: String,
    pub wave_height: f32,
    pub wave_length: f32,
    pub wave_speed: f32,
    pub direction: f32,
    pub opacity: f32,
    pub refraction_color: [f32; 3],
    pub scattering_color: [f32; 3],
    pub transparency_depth: f32,
    pub roughness: f32,
    pub foam: f32,
    pub river_width: f32,
    pub points: Vec<[f32; 2]>,
    pub running: bool,
    pub initial_depth: f32,
    pub sources: Vec<[f32; 4]>,
    pub reset_version: u32,
}
impl Default for WaterConfig {
    fn default() -> Self {
        Self {
            preset: "lake".into(),
            wave_height: 0.12,
            wave_length: 8.0,
            wave_speed: 1.0,
            direction: 30.0,
            opacity: 0.8,
            refraction_color: [0.64, 0.87, 0.90],
            scattering_color: [0.09, 0.36, 0.44],
            transparency_depth: 5.0,
            roughness: 0.15,
            foam: 0.25,
            river_width: 0.16,
            points: vec![[-0.15, -0.45], [0.15, -0.2], [-0.12, 0.15], [0.1, 0.45]],
            running: true,
            initial_depth: 0.15,
            sources: vec![[-0.25, -0.25, 1.0, 0.06]],
            reset_version: 0,
        }
    }
}
impl WaterConfig {
    pub fn from_wire(w: wire::WaterParams<'_>) -> Self {
        let defaults = Self::default();
        let finite = |v: f32, min, max, fallback| {
            if v.is_finite() {
                v.clamp(min, max)
            } else {
                fallback
            }
        };
        let color = |v: Option<&wire::Vec3>, fallback| {
            v.map_or(fallback, |v| {
                [
                    finite(v.x(), 0.0, 1.0, 0.5),
                    finite(v.y(), 0.0, 1.0, 0.5),
                    finite(v.z(), 0.0, 1.0, 0.5),
                ]
            })
        };
        let points: Vec<_> = w.points().map_or_else(Vec::new, |p| {
            p.iter()
                .take(32)
                .map(|p| [finite(p.x(), -0.5, 0.5, 0.0), finite(p.z(), -0.5, 0.5, 0.0)])
                .collect()
        });
        Self {
            preset: w
                .preset()
                .filter(|p| ["ocean", "lake", "pool", "river", "shallow"].contains(p))
                .unwrap_or("lake")
                .into(),
            wave_height: finite(w.wave_height(), 0.0, 5.0, 0.12),
            wave_length: finite(w.wave_length(), 1.0, 200.0, 8.0),
            wave_speed: finite(w.wave_speed(), 0.0, 10.0, 1.0),
            direction: finite(w.direction(), -180.0, 180.0, 30.0),
            opacity: finite(w.opacity(), 0.0, 1.0, 0.8),
            refraction_color: color(w.refraction_color(), defaults.refraction_color),
            scattering_color: color(w.scattering_color(), defaults.scattering_color),
            transparency_depth: finite(w.transparency_depth(), 0.1, 100.0, 5.0),
            roughness: finite(w.roughness(), 0.02, 1.0, 0.15),
            foam: finite(w.foam(), 0.0, 1.0, 0.25),
            river_width: finite(w.river_width(), 0.01, 0.8, 0.16),
            points: if points.len() >= 2 {
                points
            } else {
                defaults.points
            },
            running: w.running(),
            initial_depth: finite(w.initial_depth(), 0.0, 5.0, 0.15),
            sources: w.sources().map_or_else(Vec::new, |s| {
                s.iter()
                    .take(8)
                    .map(|s| {
                        [
                            finite(s.x(), -0.5, 0.5, 0.0),
                            finite(s.z(), -0.5, 0.5, 0.0),
                            finite(s.rate(), -20.0, 20.0, 0.0),
                            finite(s.radius(), 0.02, 0.25, 0.06),
                        ]
                    })
                    .collect()
            }),
            reset_version: w.reset_version().min(1_000_000),
        }
    }
    pub fn kind(&self) -> u32 {
        match self.preset.as_str() {
            "ocean" => 0,
            "pool" => 2,
            "river" => 3,
            "shallow" => 4,
            _ => 1,
        }
    }
}
