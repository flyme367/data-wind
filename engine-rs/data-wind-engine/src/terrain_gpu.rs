//! Fixed geometry clipmaps: one center draw + one instanced ring draw per terrain.
//! All camera snapping, edge morphing, bounds clipping and height sampling run in WGSL.

use crate::{scene::TerrainDraw, terrain::clipmap_mesh};
use bytemuck::{Pod, Zeroable};
use wgpu::util::DeviceExt;

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct TerrainUniforms {
    info: [u32; 4],
    material: [f32; 4],
    rock: [f32; 4],
    snow: [f32; 4],
}

struct GpuTerrain {
    source: TerrainDraw,
    bind_group: wgpu::BindGroup,
}

pub(crate) struct TerrainRenderer {
    layout: wgpu::BindGroupLayout,
    pipeline: wgpu::RenderPipeline,
    vertices: wgpu::Buffer,
    center: wgpu::Buffer,
    rings: wgpu::Buffer,
    center_count: u32,
    ring_count: u32,
    draws: Vec<GpuTerrain>,
}

impl TerrainRenderer {
    pub fn new(device: &wgpu::Device, frame_layout: &wgpu::BindGroupLayout) -> Self {
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("terrain.layout"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::VERTEX,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: false },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
            ],
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("terrain.pipeline.layout"),
            bind_group_layouts: &[Some(frame_layout), Some(&layout)],
            immediate_size: 0,
        });
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("terrain.clipmap"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shaders/terrain.wgsl").into()),
        });
        let vertex_layout = wgpu::VertexBufferLayout {
            array_stride: 8,
            step_mode: wgpu::VertexStepMode::Vertex,
            attributes: &wgpu::vertex_attr_array![0 => Float32x2],
        };
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("terrain.clipmap"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs"),
                compilation_options: Default::default(),
                buffers: &[Some(vertex_layout)],
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format: wgpu::TextureFormat::Rgba8UnormSrgb,
                    blend: None,
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            primitive: wgpu::PrimitiveState {
                cull_mode: None,
                ..Default::default()
            },
            depth_stencil: Some(wgpu::DepthStencilState {
                format: wgpu::TextureFormat::Depth24Plus,
                depth_write_enabled: Some(true),
                depth_compare: Some(wgpu::CompareFunction::Less),
                stencil: Default::default(),
                bias: Default::default(),
            }),
            multisample: Default::default(),
            multiview_mask: None,
            cache: None,
        });
        let (vertices, center, rings) = clipmap_mesh();
        let buffer = |label, bytes: &[u8], usage| {
            device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some(label),
                contents: bytes,
                usage,
            })
        };
        Self {
            layout,
            pipeline,
            vertices: buffer(
                "terrain.vertices",
                bytemuck::cast_slice(&vertices),
                wgpu::BufferUsages::VERTEX,
            ),
            center: buffer(
                "terrain.center",
                bytemuck::cast_slice(&center),
                wgpu::BufferUsages::INDEX,
            ),
            rings: buffer(
                "terrain.rings",
                bytemuck::cast_slice(&rings),
                wgpu::BufferUsages::INDEX,
            ),
            center_count: center.len() as u32,
            ring_count: rings.len() as u32,
            draws: Vec::new(),
        }
    }

    /// Called only on scene edits. Camera motion never uploads a mesh or a height texture.
    pub fn sync(&mut self, device: &wgpu::Device, queue: &wgpu::Queue, sources: Vec<TerrainDraw>) {
        let mut previous = std::mem::take(&mut self.draws);
        self.draws = sources
            .into_iter()
            .map(|source| {
                if let Some(index) = previous.iter().position(|draw| {
                    draw.source.id == source.id
                        && draw.source.index == source.index
                        && draw.source.surface.config == source.surface.config
                }) {
                    return previous.swap_remove(index);
                }
                let surface = &source.surface;
                let config = &surface.config;
                let texture = device.create_texture(&wgpu::TextureDescriptor {
                    label: Some("terrain.heightmap"),
                    size: wgpu::Extent3d {
                        width: surface.resolution,
                        height: surface.resolution,
                        depth_or_array_layers: 1,
                    },
                    mip_level_count: 1,
                    sample_count: 1,
                    dimension: wgpu::TextureDimension::D2,
                    format: wgpu::TextureFormat::R32Float,
                    usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
                    view_formats: &[],
                });
                queue.write_texture(
                    texture.as_image_copy(),
                    bytemuck::cast_slice(&surface.heights),
                    wgpu::TexelCopyBufferLayout {
                        offset: 0,
                        bytes_per_row: Some(surface.resolution * 4),
                        rows_per_image: Some(surface.resolution),
                    },
                    texture.size(),
                );
                let uniforms = TerrainUniforms {
                    info: [source.index, config.levels, surface.resolution, 0],
                    material: [config.detail_scale, config.snow_line, 0.0, 0.0],
                    rock: [
                        config.rock_color[0],
                        config.rock_color[1],
                        config.rock_color[2],
                        1.0,
                    ],
                    snow: [
                        config.snow_color[0],
                        config.snow_color[1],
                        config.snow_color[2],
                        1.0,
                    ],
                };
                let buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                    label: Some("terrain.material"),
                    contents: bytemuck::bytes_of(&uniforms),
                    usage: wgpu::BufferUsages::UNIFORM,
                });
                let view = texture.create_view(&Default::default());
                let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
                    label: Some("terrain.bind"),
                    layout: &self.layout,
                    entries: &[
                        wgpu::BindGroupEntry {
                            binding: 0,
                            resource: buffer.as_entire_binding(),
                        },
                        wgpu::BindGroupEntry {
                            binding: 1,
                            resource: wgpu::BindingResource::TextureView(&view),
                        },
                    ],
                });
                GpuTerrain { source, bind_group }
            })
            .collect();
    }

    pub fn render(&self, pass: &mut wgpu::RenderPass<'_>) {
        if self.draws.is_empty() {
            return;
        }
        pass.set_pipeline(&self.pipeline);
        pass.set_vertex_buffer(0, self.vertices.slice(..));
        for draw in &self.draws {
            pass.set_bind_group(1, &draw.bind_group, &[]);
            pass.set_index_buffer(self.center.slice(..), wgpu::IndexFormat::Uint32);
            pass.draw_indexed(0..self.center_count, 0, 0..1);
            pass.set_index_buffer(self.rings.slice(..), wgpu::IndexFormat::Uint32);
            pass.draw_indexed(0..self.ring_count, 0, 1..draw.source.surface.config.levels);
        }
    }
}
