//! Perspective-correct material rendering for the imported meshes in kit scenes.

use data_wind_assets::{AlphaMode, ModelAsset, Primitive, Texture, WrapMode};
use egui::{Pos2, Rect, pos2};
use glam::{Mat3, Mat4, Vec2, Vec3, Vec4};
use serde::Deserialize;
use std::collections::HashMap;

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub(super) struct Settings {
    color: Option<[f32; 3]>,
    strength: Option<f32>,
    alpha: Option<f32>,
    alpha_mode: Option<String>,
    use_texture_alpha: bool,
    emissive: Option<[f32; 3]>,
    emissive_strength: Option<f32>,
    emissive_enabled: Option<bool>,
    albedo_map: Option<MapSettings>,
    opacity_map: Option<MapSettings>,
    emissive_map: Option<MapSettings>,
    opacity_from_rgb: bool,
    normal_map: Option<MapSettings>,
    metallic_map: Option<MapSettings>,
    object_space_normal: bool,
    roughness: Option<f32>,
    metallic: Option<f32>,
    f0: Option<f32>,
    disable_lighting: bool,
    unlit: bool,
    back_face_culling: Option<bool>,
}

const ALBEDO: usize = 0;
const OPACITY: usize = 1;
const EMISSIVE: usize = 2;
const NORMAL: usize = 3;
const METALLIC: usize = 4;
const MAP_COUNT: usize = 5;

pub(super) type Overrides = HashMap<String, Settings>;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MapSettings {
    id: u32,
    uv_set: u8,
    scale: [f32; 2],
    offset: [f32; 2],
    level: f32,
}

#[derive(Default)]
pub(super) struct Textures {
    entries: HashMap<u32, Texture>,
    bytes: usize,
}

impl Textures {
    pub(super) fn insert(
        &mut self,
        id: u32,
        width: u32,
        height: u32,
        rgba: &[u8],
    ) -> Result<(), String> {
        if width == 0
            || height == 0
            || width > 2048
            || height > 2048
            || rgba.len() != width as usize * height as usize * 4
        {
            return Err("场景贴图像素数据无效".into());
        }
        let previous = self
            .entries
            .get(&id)
            .map_or(0, |texture| texture.rgba.len());
        let bytes = self.bytes - previous + rgba.len();
        if bytes > data_wind_assets::MAX_TEXTURE_BYTES {
            return Err("场景独立贴图超过 64 MiB".into());
        }
        self.entries.insert(
            id,
            Texture {
                name: String::new(),
                width,
                height,
                rgba: rgba.to_vec(),
            },
        );
        self.bytes = bytes;
        Ok(())
    }
}

#[derive(Clone, Copy)]
struct Map<'a> {
    texture: &'a Texture,
    wrap: [WrapMode; 2],
    level: f32,
}

struct Layer<'a> {
    map: Map<'a>,
    coords: &'a [[f32; 2]],
    scale: Vec2,
    offset: Vec2,
}

impl<'a> Layer<'a> {
    fn replacement(
        mesh: &'a Primitive,
        textures: &'a Textures,
        settings: Option<&MapSettings>,
    ) -> Option<Self> {
        let settings = settings?;
        let texture = textures.entries.get(&settings.id)?;
        let coords = mesh
            .source_texcoords
            .iter()
            .find(|(index, _)| *index == settings.uv_set)
            .map(|(_, coords)| coords.as_slice())
            .or_else(|| {
                (settings.uv_set == 0 && mesh.source_texcoords.is_empty())
                    .then_some(mesh.texcoords.as_slice())
            })?;
        if coords.is_empty() {
            return None;
        }
        Some(Self {
            map: Map {
                texture,
                wrap: [WrapMode::Repeat; 2],
                level: settings.level,
            },
            coords,
            scale: Vec2::from_array(settings.scale),
            offset: Vec2::from_array(settings.offset),
        })
    }

    fn embedded(texture: &'a Texture, coords: &'a [[f32; 2]], wrap: [WrapMode; 2]) -> Self {
        Self {
            map: Map {
                texture,
                wrap,
                level: 1.0,
            },
            coords,
            scale: Vec2::ONE,
            offset: Vec2::ZERO,
        }
    }

    fn uv(&self, vertex: usize) -> Vec2 {
        Vec2::from_array(self.coords.get(vertex).copied().unwrap_or_default()) * self.scale
            + self.offset
    }
}

#[derive(Clone, Copy)]
struct Vertex {
    clip: Vec4,
    world: Vec3,
    normal: Vec3,
    color: Vec4,
    uv: [Vec2; MAP_COUNT],
}

impl Vertex {
    fn lerp(self, end: Self, fraction: f32) -> Self {
        Self {
            clip: self.clip.lerp(end.clip, fraction),
            world: self.world.lerp(end.world, fraction),
            normal: self.normal.lerp(end.normal, fraction),
            color: self.color.lerp(end.color, fraction),
            uv: std::array::from_fn(|i| self.uv[i].lerp(end.uv[i], fraction)),
        }
    }
}

struct Triangle<'a> {
    vertices: [Vertex; 3],
    points: [Pos2; 3],
    surface: Surface<'a>,
    owner: u32,
    selected: bool,
    tangent_frame: Option<[Vec3; 2]>,
}

#[derive(Clone, Copy)]
struct Surface<'a> {
    mesh: &'a Primitive,
    alpha_mode: AlphaMode,
    use_texture_alpha: bool,
    alpha: f32,
    mask_blend: bool,
    emissive: Vec3,
    maps: [Option<Map<'a>>; MAP_COUNT],
    opacity_from_rgb: bool,
    object_normal_basis: Option<Mat3>,
    roughness: f32,
    metallic: f32,
    f0: f32,
    disable_lighting: bool,
    unlit: bool,
}

pub(super) struct Frame<'a> {
    screen: Rect,
    opaque: Vec<Triangle<'a>>,
    blend: Vec<Triangle<'a>>,
    ids: Vec<String>,
}

#[derive(Default)]
pub(super) struct Hits {
    width: usize,
    owners: Vec<u32>,
    ids: Vec<String>,
}

impl Hits {
    pub(super) fn pick(&self, point: Pos2) -> Option<&str> {
        if !point.x.is_finite() || !point.y.is_finite() || point.x < 0.0 || point.y < 0.0 {
            return None;
        }
        let (x, y) = (point.x as usize, point.y as usize);
        if x >= self.width {
            return None;
        }
        let index = y.checked_mul(self.width)?.checked_add(x)?;
        let owner = self.owners.get(index)?.checked_sub(1)?;
        self.ids.get(owner as usize).map(String::as_str)
    }
}

impl<'a> Frame<'a> {
    pub(super) fn new(screen: Rect) -> Self {
        Self {
            screen,
            opaque: Vec::new(),
            blend: Vec::new(),
            ids: Vec::new(),
        }
    }

    pub(super) fn add_model(
        &mut self,
        id: &str,
        model: &'a ModelAsset,
        overrides: Option<&Overrides>,
        textures: &'a Textures,
        transform: Mat4,
        vp: Mat4,
        tint: Vec3,
        selected: bool,
    ) {
        let linear = Mat3::from_mat4(transform);
        let determinant = linear.determinant();
        if !determinant.is_finite() || determinant == 0.0 {
            return;
        }
        let normal = linear.inverse().transpose();
        let mvp = vp * transform;
        self.ids.push(id.into());
        let owner = self.ids.len() as u32;
        for surface in &model.primitives {
            let material = &surface.material;
            let settings =
                overrides.and_then(|items| items.get(&surface.name).or_else(|| items.get("")));
            let texture = surface.texture_index.and_then(|i| model.textures.get(i));
            let emission = material
                .emissive_texture_index
                .and_then(|i| model.textures.get(i));
            let albedo_map = Layer::replacement(
                surface,
                textures,
                settings.and_then(|s| s.albedo_map.as_ref()),
            );
            let opacity_map = Layer::replacement(
                surface,
                textures,
                settings.and_then(|s| s.opacity_map.as_ref()),
            );
            let emissive_map = Layer::replacement(
                surface,
                textures,
                settings.and_then(|s| s.emissive_map.as_ref()),
            );
            let resolve_layer =
                |replacement, embedded: Option<&'a data_wind_assets::MaterialMap>| {
                    Layer::replacement(surface, textures, replacement).or_else(|| {
                        let map = embedded?;
                        let mut layer = Layer::embedded(
                            model.textures.get(map.texture_index)?,
                            &map.texcoords,
                            map.wrap,
                        );
                        layer.map.level = map.strength;
                        Some(layer)
                    })
                };
            let has_opacity_map = opacity_map.is_some();
            let replacement_emission = emissive_map.is_some();
            let layers = [
                albedo_map.or_else(|| {
                    texture.map(|t| Layer::embedded(t, &surface.texcoords, material.wrap))
                }),
                opacity_map,
                emissive_map.or_else(|| {
                    emission.map(|t| {
                        Layer::embedded(t, &material.emissive_texcoords, material.emissive_wrap)
                    })
                }),
                resolve_layer(
                    settings.and_then(|s| s.normal_map.as_ref()),
                    material.normal_map.as_ref(),
                ),
                resolve_layer(
                    settings.and_then(|s| s.metallic_map.as_ref()),
                    material.metallic_map.as_ref(),
                ),
            ];
            let embedded_color = Vec4::from_array(surface.base_color);
            let color = settings
                .and_then(|s| s.color)
                .map_or(embedded_color.truncate(), Vec3::from_array)
                * settings.and_then(|s| s.strength).unwrap_or(1.0)
                * tint;
            let color = color.extend(embedded_color.w);
            let mut emissive = settings.and_then(|s| s.emissive).unwrap_or_else(|| {
                if replacement_emission && material.emissive == [0.0; 3] {
                    [1.0; 3]
                } else {
                    material.emissive
                }
            });
            if settings.and_then(|s| s.emissive_enabled) == Some(false) {
                emissive = [0.0; 3];
            }
            let emissive = Vec3::from_array(emissive)
                * settings.and_then(|s| s.emissive_strength).unwrap_or(1.0);
            let alpha = settings.and_then(|s| s.alpha).unwrap_or(1.0);
            let use_texture_alpha = material.alpha_mode != AlphaMode::Opaque
                || settings.is_some_and(|s| s.use_texture_alpha);
            let mode = settings.and_then(|s| s.alpha_mode.as_deref());
            let alpha_mode = match mode {
                Some("0") => AlphaMode::Opaque,
                Some("1") => AlphaMode::Mask,
                Some("2" | "3") => AlphaMode::Blend,
                _ if alpha < 1.0
                    || has_opacity_map
                    || (use_texture_alpha && material.alpha_mode == AlphaMode::Opaque) =>
                {
                    AlphaMode::Blend
                }
                _ => material.alpha_mode,
            };
            let preview = Surface {
                mesh: surface,
                alpha_mode,
                use_texture_alpha,
                alpha,
                mask_blend: mode == Some("3"),
                emissive,
                maps: std::array::from_fn(|i| layers[i].as_ref().map(|layer| layer.map)),
                opacity_from_rgb: settings.is_some_and(|s| s.opacity_from_rgb),
                object_normal_basis: settings.filter(|s| s.object_space_normal).map(|_| {
                    normal
                        * material
                            .object_normal_basis
                            .map_or(Mat3::IDENTITY, |basis| Mat3::from_cols_array(&basis))
                }),
                roughness: settings
                    .and_then(|s| s.roughness)
                    .unwrap_or(material.roughness),
                metallic: settings
                    .and_then(|s| s.metallic)
                    .unwrap_or(material.metallic),
                f0: settings.and_then(|s| s.f0).unwrap_or(1.0),
                disable_lighting: settings.is_some_and(|s| s.disable_lighting),
                unlit: settings.is_some_and(|s| s.unlit),
            };
            let cull = settings
                .and_then(|s| s.back_face_culling)
                .unwrap_or(!material.double_sided);
            let vertices: Vec<_> = surface
                .positions
                .iter()
                .enumerate()
                .map(|(i, p)| Vertex {
                    clip: mvp * Vec3::from_array(*p).extend(1.0),
                    world: transform.transform_point3(Vec3::from_array(*p)),
                    normal: normal * Vec3::from_array(surface.normals[i]),
                    color: color
                        * Vec4::from_array(surface.colors.get(i).copied().unwrap_or([1.0; 4])),
                    uv: std::array::from_fn(|slot| {
                        layers[slot]
                            .as_ref()
                            .map_or(Vec2::ZERO, |layer| layer.uv(i))
                    }),
                })
                .collect();
            for indices in surface.indices.chunks_exact(3) {
                let positions = [indices[0], indices[1], indices[2]].map(|i| vertices[i as usize]);
                let Some(clipped) = clip_near(positions) else {
                    continue;
                };
                for i in 1..clipped.len - 1 {
                    let mut vertices = [
                        clipped.vertices[0],
                        clipped.vertices[i],
                        clipped.vertices[i + 1],
                    ];
                    let mut points = vertices.map(|v| {
                        let ndc = v.clip.truncate() / v.clip.w;
                        pos2(
                            (ndc.x + 1.0) * self.screen.width() * 0.5,
                            (1.0 - ndc.y) * self.screen.height() * 0.5,
                        )
                    });
                    let area = edge(points[0], points[1], points[2]);
                    if !area.is_finite()
                        || area.abs() < 0.0001
                        || !Rect::from_points(&points).intersects(self.screen)
                    {
                        continue;
                    }
                    if (area > 0.0) == (determinant > 0.0) {
                        if cull {
                            continue;
                        }
                        for vertex in &mut vertices {
                            vertex.normal = -vertex.normal;
                        }
                    }
                    if area < 0.0 {
                        points.swap(1, 2);
                        vertices.swap(1, 2);
                    }
                    let triangle = Triangle {
                        vertices,
                        points,
                        surface: preview,
                        owner,
                        selected,
                        tangent_frame: if preview.maps[NORMAL].is_some()
                            && preview.object_normal_basis.is_none()
                        {
                            tangent_frame(vertices)
                        } else {
                            None
                        },
                    };
                    if alpha_mode == AlphaMode::Blend {
                        self.blend.push(triangle);
                    } else {
                        self.opaque.push(triangle);
                    }
                }
            }
        }
    }

    pub(super) fn paint(
        mut self,
        pixels: &mut [u8],
        width: u32,
        light: Vec3,
        eye: Vec3,
        daylight: f32,
        capture: bool,
    ) -> Hits {
        if self.opaque.is_empty() && self.blend.is_empty() {
            return Hits::default();
        }
        let count = pixels.len() / 4;
        let mut depth = vec![0.0; count];
        let mut owners = if capture { Vec::new() } else { vec![0; count] };
        let mut hit_depth = if capture || self.blend.is_empty() {
            Vec::new()
        } else {
            vec![0.0; count]
        };
        // Opaque and masked fragments fill the depth buffer. Blend back to front against it.
        let distance =
            |triangle: &Triangle<'_>| triangle.vertices.iter().map(|v| v.clip.w).sum::<f32>();
        self.blend
            .sort_by(|a, b| distance(b).total_cmp(&distance(a)));
        let srgb_to_linear = linear_table();
        let mut target = Target {
            pixels,
            width: width as usize,
            depth: &mut depth,
            owners: &mut owners,
            hit_depth: &mut hit_depth,
            light,
            eye,
            daylight,
            srgb_to_linear: &srgb_to_linear,
        };
        for triangle in self.opaque.iter().chain(&self.blend) {
            target.triangle(triangle, self.screen);
        }
        Hits {
            width: width as usize,
            owners,
            ids: self.ids,
        }
    }
}

struct Clipped {
    vertices: [Vertex; 4],
    len: usize,
}

fn clip_near(triangle: [Vertex; 3]) -> Option<Clipped> {
    if triangle.iter().any(|v| !v.clip.is_finite()) {
        return None;
    }
    let mut result = Clipped {
        vertices: [triangle[0]; 4],
        len: 0,
    };
    let mut previous = triangle[2];
    for current in triangle {
        let inside = current.clip.z >= 0.0;
        if inside != (previous.clip.z >= 0.0) {
            let fraction = previous.clip.z / (previous.clip.z - current.clip.z);
            result.vertices[result.len] = previous.lerp(current, fraction);
            result.len += 1;
        }
        if inside {
            result.vertices[result.len] = current;
            result.len += 1;
        }
        previous = current;
    }
    (result.len >= 3).then_some(result)
}

fn edge(a: Pos2, b: Pos2, point: Pos2) -> f32 {
    (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x)
}

fn top_left(a: Pos2, b: Pos2) -> bool {
    b.y < a.y || (b.y == a.y && b.x > a.x)
}

fn tangent_frame(vertices: [Vertex; 3]) -> Option<[Vec3; 2]> {
    let [a, b, c] = vertices;
    let du = b.uv[NORMAL] - a.uv[NORMAL];
    let dv = c.uv[NORMAL] - a.uv[NORMAL];
    let det = du.perp_dot(dv);
    if !det.is_finite() || det.abs() < 1e-8 {
        return None;
    }
    let first = b.world - a.world;
    let second = c.world - a.world;
    Some([
        ((first * dv.y - second * du.y) / det).normalize_or_zero(),
        ((second * du.x - first * dv.x) / det).normalize_or_zero(),
    ])
}

fn mapped_normal(geometric: Vec3, sampled: Vec3, strength: f32, triangle: &Triangle<'_>) -> Vec3 {
    let sample = sampled * 2.0 - Vec3::ONE;
    if strength == 0.0 {
        return geometric;
    }
    if let Some(basis) = triangle.surface.object_normal_basis {
        let normal = (basis * sample).normalize_or(geometric);
        return geometric
            .lerp(normal, strength.clamp(0.0, 1.0))
            .normalize_or(geometric);
    }
    let Some([tangent, bitangent]) = triangle.tangent_frame else {
        return geometric;
    };
    let tangent = (tangent - geometric * tangent.dot(geometric)).normalize_or_zero();
    let orthogonal = geometric.cross(tangent);
    let bitangent = orthogonal * orthogonal.dot(bitangent).signum();
    (tangent * (sample.x * strength) + bitangent * (sample.y * strength) + geometric * sample.z)
        .normalize_or(geometric)
}

fn shade_material(
    base: Vec3,
    normal: Vec3,
    light: Vec3,
    view: Vec3,
    surface: Surface<'_>,
    roughness: f32,
    metallic: f32,
    daylight: f32,
) -> Vec3 {
    if surface.disable_lighting {
        return base;
    }
    let ambient = if surface.unlit {
        0.55
    } else {
        0.18 + daylight * 0.37
    };
    let nl = normal.dot(light).max(0.0);
    let nv = normal.dot(view).max(0.0);
    let diffuse =
        base * (ambient * (1.0 - 0.65 * metallic) + daylight * (1.0 - metallic) * 0.6 * nl);
    if nl == 0.0 || nv == 0.0 {
        return diffuse;
    }
    let half = (light + view).normalize_or_zero();
    let nh = normal.dot(half).max(0.0);
    let vh = view.dot(half).clamp(0.0, 1.0);
    let alpha2 = roughness.max(0.075).powi(4);
    let denominator = nh * nh * (alpha2 - 1.0) + 1.0;
    let distribution = alpha2 / (std::f32::consts::PI * denominator * denominator);
    let smith = |cosine: f32| (cosine * cosine * (1.0 - alpha2) + alpha2).sqrt();
    let visibility = 0.5 / (nl * smith(nv) + nv * smith(nl)).max(1e-5);
    let f0 = Vec3::splat(0.04 * surface.f0).lerp(base.clamp(Vec3::ZERO, Vec3::ONE), metallic);
    let fresnel = f0 + (Vec3::ONE - f0) * (1.0 - vh).powi(5);
    diffuse + fresnel * (distribution * visibility * nl * daylight)
}

struct Target<'a> {
    pixels: &'a mut [u8],
    depth: &'a mut [f32],
    hit_depth: &'a mut [f32],
    owners: &'a mut [u32],
    srgb_to_linear: &'a [f32; 256],
    width: usize,
    light: Vec3,
    eye: Vec3,
    daylight: f32,
}

impl Target<'_> {
    fn triangle(&mut self, triangle: &Triangle<'_>, screen: Rect) {
        let points = triangle.points;
        let v = triangle.vertices;
        let surface = triangle.surface;
        let material = &surface.mesh.material;
        let blend = surface.alpha_mode == AlphaMode::Blend;
        let area = edge(points[0], points[1], points[2]);
        let sides = [
            (points[1], points[2]),
            (points[2], points[0]),
            (points[0], points[1]),
        ];
        let include = sides.map(|(a, b)| top_left(a, b));
        let inverse = v.map(|v| v.clip.w.recip());
        let bounds = Rect::from_points(&points).intersect(screen);
        for y in bounds.min.y.floor() as usize..bounds.max.y.ceil() as usize {
            for x in bounds.min.x.floor() as usize..bounds.max.x.ceil() as usize {
                let point = pos2(x as f32 + 0.5, y as f32 + 0.5);
                let edges = sides.map(|(a, b)| edge(a, b, point));
                if edges
                    .iter()
                    .enumerate()
                    .any(|(i, w)| *w < 0.0 || (*w == 0.0 && !include[i]))
                {
                    continue;
                }
                let weighted = std::array::from_fn::<_, 3, _>(|i| edges[i] * inverse[i]);
                let sum = weighted.iter().sum::<f32>();
                let depth = sum / area;
                let pixel = y * self.width + x;
                if depth <= self.depth[pixel] {
                    continue;
                }
                let [a, b, c] = weighted.map(|w| w / sum);
                let mut base = v[0].color * a + v[1].color * b + v[2].color * c;
                let sample_map = |slot: usize, map: Map<'_>| {
                    let uv = v[0].uv[slot] * a + v[1].uv[slot] * b + v[2].uv[slot] * c;
                    let curve =
                        matches!(slot, ALBEDO | OPACITY | EMISSIVE).then_some(self.srgb_to_linear);
                    sample(map.texture, uv, map.wrap, curve)
                };
                if let Some(map) = surface.maps[ALBEDO] {
                    let sampled = sample_map(ALBEDO, map);
                    let alpha = if surface.use_texture_alpha {
                        sampled.w
                    } else {
                        1.0
                    };
                    base *= (sampled.truncate() * map.level).extend(alpha);
                }
                if let Some(map) = surface.maps[OPACITY] {
                    let sampled = sample_map(OPACITY, map);
                    let alpha = if surface.opacity_from_rgb {
                        sampled.truncate().dot(Vec3::new(0.2126, 0.7152, 0.0722))
                    } else {
                        sampled.w
                    };
                    base.w *= (alpha * map.level).clamp(0.0, 1.0);
                }
                base.w *= surface.alpha;
                let alpha = match surface.alpha_mode {
                    AlphaMode::Opaque => 1.0,
                    AlphaMode::Mask if base.w >= material.alpha_cutoff => 1.0,
                    AlphaMode::Mask => continue,
                    AlphaMode::Blend
                        if base.w > 0.0
                            && (!surface.mask_blend || base.w >= material.alpha_cutoff) =>
                    {
                        base.w.min(1.0)
                    }
                    AlphaMode::Blend => continue,
                };
                let mut normal =
                    (v[0].normal * a + v[1].normal * b + v[2].normal * c).normalize_or_zero();
                if let Some(map) = surface.maps[NORMAL] {
                    normal = mapped_normal(
                        normal,
                        sample_map(NORMAL, map).truncate(),
                        map.level,
                        triangle,
                    );
                }
                let mut roughness = surface.roughness;
                let mut metallic = surface.metallic;
                if let Some(map) = surface.maps[METALLIC] {
                    let factors = sample_map(METALLIC, map);
                    roughness *= (1.0 + (factors.y - 1.0) * map.level).clamp(0.0, 1.0);
                    metallic *= (1.0 + (factors.z - 1.0) * map.level).clamp(0.0, 1.0);
                }
                let position = v[0].world * a + v[1].world * b + v[2].world * c;
                let view = (self.eye - position).normalize_or_zero();
                let lit = shade_material(
                    base.truncate(),
                    normal,
                    self.light,
                    view,
                    surface,
                    roughness,
                    metallic,
                    self.daylight,
                );
                let mut emissive = surface.emissive;
                if let Some(map) = surface.maps[EMISSIVE] {
                    emissive *= sample_map(EMISSIVE, map).truncate() * map.level;
                }
                let mut rgb = lit + emissive;
                if triangle.selected {
                    rgb = rgb.lerp(Vec3::new(0.05, 0.38, 1.0), 0.15);
                }
                let output = &mut self.pixels[pixel * 4..pixel * 4 + 4];
                for (channel, dst) in output[..3].iter_mut().enumerate() {
                    let linear = rgb[channel].clamp(0.0, 1.0) * alpha
                        + self.srgb_to_linear[*dst as usize] * (1.0 - alpha);
                    *dst = (to_srgb(linear) * 255.0).round() as u8;
                }
                output[3] = 255;
                if !blend {
                    self.depth[pixel] = depth;
                }
                if let Some(owner) = self.owners.get_mut(pixel) {
                    if let Some(nearest) = self.hit_depth.get_mut(pixel) {
                        if depth <= *nearest {
                            continue;
                        }
                        *nearest = depth;
                    }
                    *owner = triangle.owner;
                }
            }
        }
    }
}

fn linear_table() -> [f32; 256] {
    std::array::from_fn(|i| {
        let value = i as f32 / 255.0;
        if value <= 0.04045 {
            value / 12.92
        } else {
            ((value + 0.055) / 1.055).powf(2.4)
        }
    })
}

fn to_srgb(linear: f32) -> f32 {
    if linear <= 0.003_130_8 {
        12.92 * linear
    } else {
        1.055 * linear.powf(1.0 / 2.4) - 0.055
    }
}

fn sample(texture: &Texture, uv: Vec2, modes: [WrapMode; 2], srgb: Option<&[f32; 256]>) -> Vec4 {
    let u = sample_axis(uv.x, texture.width, modes[0]);
    let v = sample_axis(uv.y, texture.height, modes[1]);
    let texel = |x: usize, y: usize| {
        let i = (y * texture.width as usize + x) * 4;
        let color = &texture.rgba[i..i + 4];
        let linear =
            |channel: u8| srgb.map_or(f32::from(channel) / 255.0, |table| table[channel as usize]);
        Vec4::new(
            linear(color[0]),
            linear(color[1]),
            linear(color[2]),
            f32::from(color[3]) / 255.0,
        )
    };
    texel(u.0, v.0)
        .lerp(texel(u.1, v.0), u.2)
        .lerp(texel(u.0, v.1).lerp(texel(u.1, v.1), u.2), v.2)
}

fn sample_axis(uv: f32, size: u32, mode: WrapMode) -> (usize, usize, f32) {
    let uv = match mode {
        WrapMode::Repeat => uv.rem_euclid(1.0),
        WrapMode::Clamp => uv.clamp(0.0, 1.0),
        WrapMode::Mirror => 1.0 - (1.0 - uv.rem_euclid(2.0)).abs(),
    };
    let size = size as i32;
    let center = uv * size as f32 - 0.5;
    let lower = center.floor() as i32;
    let bound = |value: i32| match mode {
        WrapMode::Repeat => value.rem_euclid(size),
        WrapMode::Clamp | WrapMode::Mirror => value.clamp(0, size - 1),
    } as usize;
    (bound(lower), bound(lower + 1), center - lower as f32)
}

#[cfg(test)]
mod tests {
    use super::*;
    use data_wind_assets::Material;

    fn quad(
        z: f32,
        material: Material,
        color: [f32; 4],
        texture_index: Option<usize>,
    ) -> Primitive {
        Primitive {
            name: String::new(),
            positions: vec![
                [-1.0, -1.0, z],
                [1.0, -1.0, z],
                [1.0, 1.0, z],
                [-1.0, 1.0, z],
            ],
            normals: vec![[0.0, 0.0, 1.0]; 4],
            texcoords: vec![[0.0, 1.0], [1.0, 1.0], [1.0, 0.0], [0.0, 0.0]],
            colors: Vec::new(),
            indices: vec![0, 1, 2, 0, 2, 3],
            base_color: color,
            texture_index,
            material,
            source_texcoords: Vec::new(),
        }
    }

    #[test]
    fn texture_cutout_and_blend_render_and_pick_the_visible_layer() {
        let mut front = ModelAsset {
            name: "mask".into(),
            primitives: vec![quad(
                0.2,
                Material {
                    alpha_mode: AlphaMode::Mask,
                    wrap: [WrapMode::Clamp; 2],
                    ..Material::default()
                },
                [1.0; 4],
                Some(0),
            )],
            textures: vec![Texture {
                name: String::new(),
                width: 2,
                height: 1,
                rgba: vec![0, 0, 0, 0, 0, 255, 0, 255],
            }],
        };
        let back = ModelAsset {
            name: "behind".into(),
            primitives: vec![quad(
                0.8,
                Material {
                    emissive: [0.0, 0.0, 1.0],
                    ..Material::default()
                },
                [0.0, 0.0, 0.0, 1.0],
                None,
            )],
            textures: Vec::new(),
        };
        // Orthographic depth is changed into unequal clip w values, like the live camera.
        let vp = Mat4::from_cols(Vec4::X, Vec4::Y, Vec4::new(0.0, 0.0, 1.0, 1.0), Vec4::W);
        let textures = Textures::default();
        let draw = |front: &ModelAsset, settings: Option<&Overrides>| {
            let mut frame = Frame::new(Rect::from_min_max(Pos2::ZERO, pos2(64.0, 64.0)));
            frame.add_model(
                "front",
                front,
                settings,
                &textures,
                Mat4::IDENTITY,
                vp,
                Vec3::ONE,
                false,
            );
            frame.add_model(
                "back",
                &back,
                None,
                &textures,
                Mat4::IDENTITY,
                vp,
                Vec3::ONE,
                false,
            );
            let mut pixels = vec![0; 64 * 64 * 4];
            let hits = frame.paint(&mut pixels, 64, Vec3::Z, Vec3::Z * 4.0, 0.5, false);
            (pixels, hits)
        };
        let (pixels, hits) = draw(&front, None);
        let left = (32 * 64 + 18) * 4;
        let right = (32 * 64 + 45) * 4;
        assert!(pixels[left] < 12 && pixels[left + 1] < 12 && pixels[left + 2] == 255);
        assert!(pixels[right + 1] > 190 && pixels[right + 2] < 12);
        assert_eq!(hits.pick(pos2(18.0, 32.0)), Some("back"));
        assert_eq!(hits.pick(pos2(45.0, 32.0)), Some("front"));

        front.primitives[0].material.alpha_mode = AlphaMode::Blend;
        front.primitives[0].base_color[3] = 0.5;
        let (pixels, hits) = draw(&front, None);
        assert!(pixels[right + 1] > 120 && pixels[right + 2] > 170);
        assert_eq!(hits.pick(pos2(18.0, 32.0)), Some("back"));
        assert_eq!(hits.pick(pos2(45.0, 32.0)), Some("front"));

        let settings = serde_json::from_str(r#"{"": {"alpha": 0, "emissive": [1, 0, 0]}}"#)
            .expect("saved material options");
        let (pixels, hits) = draw(&front, Some(&settings));
        assert!(pixels[right] < 12 && pixels[right + 1] < 12 && pixels[right + 2] == 255);
        assert_eq!(hits.pick(pos2(45.0, 32.0)), Some("back"));
    }
}
