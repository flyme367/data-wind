//! Software rendering of the same egui meshes used by wgpu, for export and GPU-less browsers.

use std::collections::HashMap;

use egui::epaint::{Mesh, Primitive, Vertex};
use egui::{Color32, Pos2, Rect, TextureId, pos2};
#[cfg(any(not(target_arch = "wasm32"), feature = "parallel"))]
use rayon::prelude::*;

use super::BoardFrame;

// Small canvases avoid dispatch overhead. Bands own disjoint rows, while preserving painter order.
#[cfg(any(not(target_arch = "wasm32"), feature = "parallel"))]
const PARALLEL_PIXELS: usize = 256 * 256;
#[cfg(any(not(target_arch = "wasm32"), feature = "parallel"))]
const BAND_ROWS: usize = 64;

#[derive(Default)]
pub struct Rasterizer {
    textures: HashMap<TextureId, egui::ColorImage>,
}

impl Rasterizer {
    pub fn update(&mut self, delta: &egui::TexturesDelta) {
        for (id, changes) in &delta.set {
            for change in changes {
                let egui::ImageData::Color(image) = &change.image;
                if let Some([x, y]) = change.pos {
                    if let Some(texture) = self.textures.get_mut(id) {
                        for row in 0..image.size[1] {
                            let start = (y + row) * texture.size[0] + x;
                            if let Some(target) =
                                texture.pixels.get_mut(start..start + image.size[0])
                            {
                                target.copy_from_slice(
                                    &image.pixels[row * image.size[0]..(row + 1) * image.size[0]],
                                );
                            }
                        }
                    }
                } else {
                    self.textures.insert(*id, image.as_ref().clone());
                }
            }
        }
    }

    pub fn free(&mut self, delta: &egui::TexturesDelta) {
        for id in &delta.free {
            self.textures.remove(id);
        }
    }

    /// Returns tightly packed, unpremultiplied sRGBA, suitable for browser ImageData and PNG.
    pub fn render(&mut self, frame: &mut BoardFrame, width: u32, height: u32) -> Vec<u8> {
        self.update(&frame.textures);
        let mut pixels = vec![0_u8; width as usize * height as usize * 4];
        if pixels.is_empty() {
            self.free(&frame.textures);
            frame.textures.clear();
            return pixels;
        }
        #[cfg(any(not(target_arch = "wasm32"), feature = "parallel"))]
        if pixels.len() / 4 >= PARALLEL_PIXELS && rayon::current_num_threads() > 1 {
            pixels
                .par_chunks_mut(width as usize * 4 * BAND_ROWS)
                .enumerate()
                .for_each(|(band, pixels)| {
                    self.render_band(frame, width, band * BAND_ROWS, pixels);
                });
        } else {
            self.render_band(frame, width, 0, &mut pixels);
        }
        #[cfg(all(target_arch = "wasm32", not(feature = "parallel")))]
        self.render_band(frame, width, 0, &mut pixels);
        self.free(&frame.textures);
        frame.textures.clear();
        pixels
    }

    fn render_band(&self, frame: &BoardFrame, width: u32, first_row: usize, pixels: &mut [u8]) {
        let last_row = first_row + pixels.len() / (width as usize * 4);
        let band_clip = Rect::from_min_max(
            pos2(0.0, first_row as f32),
            pos2(width as f32, last_row as f32),
        );
        for primitive in &frame.primitives {
            let Primitive::Mesh(mesh) = &primitive.primitive else {
                continue;
            };
            let Some(texture) = self.textures.get(&mesh.texture_id) else {
                continue;
            };
            let clip = primitive.clip_rect.intersect(band_clip);
            if !clip.is_positive() {
                continue;
            }
            for indices in mesh.indices.chunks_exact(3) {
                let vertices = [
                    mesh.vertices[indices[0] as usize],
                    mesh.vertices[indices[1] as usize],
                    mesh.vertices[indices[2] as usize],
                ];
                triangle(pixels, width, first_row, vertices, texture, clip);
            }
        }
        for pixel in pixels.chunks_exact_mut(4) {
            let alpha = u32::from(pixel[3]);
            if alpha != 0 && alpha != 255 {
                for component in &mut pixel[..3] {
                    *component = ((u32::from(*component) * 255 + alpha / 2) / alpha).min(255) as u8;
                }
            }
        }
    }
}

fn edge(a: Pos2, b: Pos2, p: Pos2) -> f32 {
    (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
}

// Half-open edges ensure adjacent triangles blend exactly once, including translucent images.
fn top_left(a: Pos2, b: Pos2) -> bool {
    b.y < a.y || (b.y == a.y && b.x > a.x)
}

fn triangle(
    pixels: &mut [u8],
    width: u32,
    first_row: usize,
    mut v: [Vertex; 3],
    texture: &egui::ColorImage,
    clip: Rect,
) {
    let mut area = edge(v[0].pos, v[1].pos, v[2].pos);
    if area.abs() < 0.0001 {
        return;
    }
    if area < 0.0 {
        v.swap(1, 2);
        area = -area;
    }
    let bounds = Rect::from_points(&v.map(|vertex| vertex.pos)).intersect(clip);
    let min_x = bounds.min.x.floor().max(0.0) as u32;
    let min_y = bounds.min.y.floor().max(0.0) as u32;
    let max_x = bounds.max.x.ceil().clamp(0.0, width as f32) as u32;
    let max_y = bounds.max.y.ceil().max(0.0) as u32;
    let include = [
        top_left(v[1].pos, v[2].pos),
        top_left(v[2].pos, v[0].pos),
        top_left(v[0].pos, v[1].pos),
    ];
    for y in min_y..max_y {
        for x in min_x..max_x {
            let p = pos2(x as f32 + 0.5, y as f32 + 0.5);
            let weights = [
                edge(v[1].pos, v[2].pos, p),
                edge(v[2].pos, v[0].pos, p),
                edge(v[0].pos, v[1].pos, p),
            ];
            if weights
                .iter()
                .enumerate()
                .any(|(i, &w)| w < 0.0 || (w == 0.0 && !include[i]))
            {
                continue;
            }
            let weights = weights.map(|w| w / area);
            let uv = v[0].uv.to_vec2() * weights[0]
                + v[1].uv.to_vec2() * weights[1]
                + v[2].uv.to_vec2() * weights[2];
            let sampled = sample(texture, uv.x, uv.y);
            let mut source = [0.0; 4];
            for (channel, component) in source.iter_mut().enumerate() {
                let vertex_color = (0..3)
                    .map(|i| f32::from(v[i].color[channel]) * weights[i])
                    .sum::<f32>();
                *component = vertex_color * sampled[channel] / 255.0;
            }
            let start = ((y as usize - first_row) * width as usize + x as usize) * 4;
            let inverse_alpha = 1.0 - source[3] / 255.0;
            for channel in 0..4 {
                pixels[start + channel] = (source[channel]
                    + f32::from(pixels[start + channel]) * inverse_alpha)
                    .round()
                    .clamp(0.0, 255.0) as u8;
            }
        }
    }
}

fn sample(image: &egui::ColorImage, u: f32, v: f32) -> [f32; 4] {
    let x = (u * image.size[0] as f32 - 0.5).clamp(0.0, (image.size[0] - 1) as f32);
    let y = (v * image.size[1] as f32 - 0.5).clamp(0.0, (image.size[1] - 1) as f32);
    let x0 = x.floor() as usize;
    let y0 = y.floor() as usize;
    let x1 = (x0 + 1).min(image.size[0] - 1);
    let y1 = (y0 + 1).min(image.size[1] - 1);
    let (fx, fy) = (x - x0 as f32, y - y0 as f32);
    std::array::from_fn(|c| {
        let top = f32::from(image.pixels[y0 * image.size[0] + x0][c]) * (1.0 - fx)
            + f32::from(image.pixels[y0 * image.size[0] + x1][c]) * fx;
        let bottom = f32::from(image.pixels[y1 * image.size[0] + x0][c]) * (1.0 - fx)
            + f32::from(image.pixels[y1 * image.size[0] + x1][c]) * fx;
        top * (1.0 - fy) + bottom * fy
    })
}

/// Clip triangles before rotating them, preserving text UVs and interpolated colors.
pub fn clip_mesh(source: &Mesh, clip: Rect) -> Mesh {
    if source.vertices.iter().all(|v| clip.contains(v.pos)) {
        return source.clone();
    }
    let mut output = Mesh::with_texture(source.texture_id);
    for indices in source.indices.chunks_exact(3) {
        let mut polygon: Vec<Vertex> = indices
            .iter()
            .map(|&i| source.vertices[i as usize])
            .collect();
        for (axis, limit, greater) in [
            (0, clip.min.x, true),
            (0, clip.max.x, false),
            (1, clip.min.y, true),
            (1, clip.max.y, false),
        ] {
            if polygon.is_empty() {
                break;
            }
            let inside = |v: Vertex| {
                if greater {
                    v.pos[axis] >= limit
                } else {
                    v.pos[axis] <= limit
                }
            };
            let mut next = Vec::new();
            let mut previous = polygon[polygon.len() - 1];
            for current in polygon {
                if inside(current) != inside(previous) {
                    let t = (limit - previous.pos[axis]) / (current.pos[axis] - previous.pos[axis]);
                    let channels = std::array::from_fn::<_, 4, _>(|i| {
                        (f32::from(previous.color[i]) * (1.0 - t) + f32::from(current.color[i]) * t)
                            .round() as u8
                    });
                    next.push(Vertex {
                        pos: previous.pos.lerp(current.pos, t),
                        uv: previous.uv.lerp(current.uv, t),
                        color: Color32::from_rgba_premultiplied(
                            channels[0],
                            channels[1],
                            channels[2],
                            channels[3],
                        ),
                    });
                }
                if inside(current) {
                    next.push(current);
                }
                previous = current;
            }
            polygon = next;
        }
        if polygon.len() >= 3 {
            let base = output.vertices.len() as u32;
            for i in 1..polygon.len() - 1 {
                output
                    .indices
                    .extend_from_slice(&[base, base + i as u32, base + i as u32 + 1]);
            }
            output.vertices.extend(polygon);
        }
    }
    output
}
