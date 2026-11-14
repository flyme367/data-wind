//! Bevy scene-pass water: shared static mesh, opaque-scene refraction, GPU shallow water.
use crate::{
    scene::WaterDraw,
    water::{SIM_RESOLUTION, grid_mesh, river_points, source_field},
};
use bytemuck::{Pod, Zeroable};
use wgpu::util::DeviceExt;

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct WaterUniforms {
    info: [u32; 4],
    waves: [f32; 4],
    optics: [f32; 4],
    refraction: [f32; 4],
    scattering: [f32; 4],
    shape: [f32; 4],
    simulation: [f32; 4],
    points: [[f32; 4]; 32],
    sources: [[f32; 4]; 8],
}
impl WaterUniforms {
    fn new(draw: &WaterDraw) -> Self {
        let c = &draw.config;
        let mut points = [[0.0; 4]; 32];
        let path = river_points(c, draw.size);
        points[..path.len()].copy_from_slice(&path);
        let mut sources = [[0.0; 4]; 8];
        sources[..c.sources.len()].copy_from_slice(&c.sources);
        Self {
            info: [
                draw.index,
                c.kind(),
                c.points.len() as u32,
                c.sources.len() as u32,
            ],
            waves: [
                c.wave_height,
                c.wave_length,
                c.wave_speed,
                c.direction.to_radians(),
            ],
            optics: [c.opacity, c.transparency_depth, c.roughness, c.foam],
            refraction: [
                c.refraction_color[0],
                c.refraction_color[1],
                c.refraction_color[2],
                1.0,
            ],
            scattering: [
                c.scattering_color[0],
                c.scattering_color[1],
                c.scattering_color[2],
                1.0,
            ],
            shape: [
                c.river_width,
                c.initial_depth,
                if c.running { 1.0 } else { 0.0 },
                0.0,
            ],
            simulation: [draw.size[0] / 63.0, draw.size[2] / 63.0, 0.0, 0.0],
            points,
            sources,
        }
    }
}
struct GpuSimulation {
    cells: [wgpu::Buffer; 2],
    rates: wgpu::Buffer,
    groups: [wgpu::BindGroup; 2],
}
struct GpuWater {
    source: WaterDraw,
    uniform: wgpu::Buffer,
    simulation: Option<GpuSimulation>,
    bind_group: wgpu::BindGroup,
}
pub(crate) struct WaterRenderer {
    layout: wgpu::BindGroupLayout,
    sim_layout: wgpu::BindGroupLayout,
    snapshot_layout: wgpu::BindGroupLayout,
    depth_layout: wgpu::BindGroupLayout,
    pipeline: wgpu::RenderPipeline,
    flow: wgpu::ComputePipeline,
    integrate: wgpu::ComputePipeline,
    copy_depth: wgpu::ComputePipeline,
    step: wgpu::Buffer,
    dummy: wgpu::Buffer,
    vertices: wgpu::Buffer,
    indices: wgpu::Buffer,
    index_count: u32,
    draws: Vec<GpuWater>,
    color: Option<wgpu::Texture>,
    snapshot: Option<wgpu::BindGroup>,
    depth_snapshot: Option<wgpu::BindGroup>,
    size: (u32, u32),
}
fn buffer_entry(
    binding: u32,
    visibility: wgpu::ShaderStages,
    ty: wgpu::BufferBindingType,
) -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry {
        binding,
        visibility,
        ty: wgpu::BindingType::Buffer {
            ty,
            has_dynamic_offset: false,
            min_binding_size: None,
        },
        count: None,
    }
}
fn texture_entry(
    binding: u32,
    visibility: wgpu::ShaderStages,
    sample_type: wgpu::TextureSampleType,
) -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry {
        binding,
        visibility,
        ty: wgpu::BindingType::Texture {
            sample_type,
            view_dimension: wgpu::TextureViewDimension::D2,
            multisampled: false,
        },
        count: None,
    }
}
fn compute(
    device: &wgpu::Device,
    layout: &wgpu::BindGroupLayout,
    source: &'static str,
    entry: &str,
) -> wgpu::ComputePipeline {
    let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some(entry),
        source: wgpu::ShaderSource::Wgsl(source.into()),
    });
    let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
        label: Some(entry),
        bind_group_layouts: &[Some(layout)],
        immediate_size: 0,
    });
    device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
        label: Some(entry),
        layout: Some(&layout),
        module: &shader,
        entry_point: Some(entry),
        compilation_options: Default::default(),
        cache: None,
    })
}
impl WaterRenderer {
    pub fn new(device: &wgpu::Device, frame_layout: &wgpu::BindGroupLayout) -> Self {
        let storage = wgpu::BufferBindingType::Storage { read_only: true };
        let uniform = wgpu::BufferBindingType::Uniform;
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("water.material.layout"),
            entries: &[
                buffer_entry(0, wgpu::ShaderStages::VERTEX_FRAGMENT, uniform),
                buffer_entry(1, wgpu::ShaderStages::VERTEX_FRAGMENT, storage),
            ],
        });
        let sim_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("water.sim.layout"),
            entries: &[
                buffer_entry(0, wgpu::ShaderStages::COMPUTE, uniform),
                buffer_entry(1, wgpu::ShaderStages::COMPUTE, storage),
                buffer_entry(
                    2,
                    wgpu::ShaderStages::COMPUTE,
                    wgpu::BufferBindingType::Storage { read_only: false },
                ),
                buffer_entry(
                    3,
                    wgpu::ShaderStages::COMPUTE,
                    wgpu::BufferBindingType::Storage { read_only: false },
                ),
                buffer_entry(4, wgpu::ShaderStages::COMPUTE, storage),
                buffer_entry(5, wgpu::ShaderStages::COMPUTE, uniform),
            ],
        });
        let snapshot_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("water.scene.layout"),
            entries: &[
                texture_entry(
                    0,
                    wgpu::ShaderStages::FRAGMENT,
                    wgpu::TextureSampleType::Float { filterable: true },
                ),
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
                texture_entry(
                    2,
                    wgpu::ShaderStages::FRAGMENT,
                    wgpu::TextureSampleType::Float { filterable: false },
                ),
            ],
        });
        let depth_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("water.depth.layout"),
            entries: &[
                texture_entry(
                    0,
                    wgpu::ShaderStages::COMPUTE,
                    wgpu::TextureSampleType::Depth,
                ),
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::StorageTexture {
                        access: wgpu::StorageTextureAccess::WriteOnly,
                        format: wgpu::TextureFormat::R32Float,
                        view_dimension: wgpu::TextureViewDimension::D2,
                    },
                    count: None,
                },
            ],
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("water.pipeline.layout"),
            bind_group_layouts: &[Some(frame_layout), Some(&layout), Some(&snapshot_layout)],
            immediate_size: 0,
        });
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("water"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shaders/water.wgsl").into()),
        });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("water.surface"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs"),
                compilation_options: Default::default(),
                buffers: &[Some(wgpu::VertexBufferLayout {
                    array_stride: 8,
                    step_mode: wgpu::VertexStepMode::Vertex,
                    attributes: &wgpu::vertex_attr_array![0 => Float32x2],
                })],
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format: wgpu::TextureFormat::Rgba8UnormSrgb,
                    blend: Some(wgpu::BlendState::ALPHA_BLENDING),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            primitive: wgpu::PrimitiveState {
                cull_mode: None,
                ..Default::default()
            },
            depth_stencil: Some(wgpu::DepthStencilState {
                format: wgpu::TextureFormat::Depth24Plus,
                depth_write_enabled: Some(false),
                depth_compare: Some(wgpu::CompareFunction::LessEqual),
                stencil: Default::default(),
                bias: Default::default(),
            }),
            multisample: Default::default(),
            multiview_mask: None,
            cache: None,
        });
        let flow = compute(
            device,
            &sim_layout,
            include_str!("shaders/water_sim.wgsl"),
            "flow",
        );
        let integrate = compute(
            device,
            &sim_layout,
            include_str!("shaders/water_sim.wgsl"),
            "integrate",
        );
        let copy_depth = compute(
            device,
            &depth_layout,
            include_str!("shaders/water_depth.wgsl"),
            "copy_depth",
        );
        let (vertices, indices) = grid_mesh(64);
        let buffer = |label, bytes: &[u8], usage| {
            device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some(label),
                contents: bytes,
                usage,
            })
        };
        Self {
            layout,
            sim_layout,
            snapshot_layout,
            depth_layout,
            pipeline,
            flow,
            integrate,
            copy_depth,
            step: buffer(
                "water.dt",
                &[0; 16],
                wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            ),
            dummy: buffer("water.dummy", &[0; 16], wgpu::BufferUsages::STORAGE),
            vertices: buffer(
                "water.grid",
                bytemuck::cast_slice(&vertices),
                wgpu::BufferUsages::VERTEX,
            ),
            indices: buffer(
                "water.indices",
                bytemuck::cast_slice(&indices),
                wgpu::BufferUsages::INDEX,
            ),
            index_count: indices.len() as u32,
            draws: Vec::new(),
            color: None,
            snapshot: None,
            depth_snapshot: None,
            size: (0, 0),
        }
    }
    pub fn sync(&mut self, device: &wgpu::Device, queue: &wgpu::Queue, sources: Vec<WaterDraw>) {
        let mut previous = std::mem::take(&mut self.draws);
        for source in sources {
            let reuse = previous.iter().position(|d| d.source.id == source.id);
            if let Some(i) = reuse {
                let old = &previous[i].source;
                if old.index == source.index
                    && old.config == source.config
                    && old.size == source.size
                    && old.center == source.center
                    && std::sync::Arc::ptr_eq(&old.bed, &source.bed)
                {
                    self.draws.push(previous.swap_remove(i));
                    continue;
                }
            }
            let sources_changed = reuse.is_none_or(|i| {
                previous[i].source.config.sources != source.config.sources
                    || previous[i].source.size != source.size
            });
            let uniform = reuse.map_or_else(
                || {
                    device.create_buffer(&wgpu::BufferDescriptor {
                        label: Some("water.uniform"),
                        size: std::mem::size_of::<WaterUniforms>() as u64,
                        usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
                        mapped_at_creation: false,
                    })
                },
                |i| previous[i].uniform.clone(),
            );
            queue.write_buffer(
                &uniform,
                0,
                bytemuck::bytes_of(&WaterUniforms::new(&source)),
            );
            let mut simulation = reuse.and_then(|i| {
                let mut old = previous.swap_remove(i);
                if std::sync::Arc::ptr_eq(&old.source.bed, &source.bed)
                    && old.source.config.reset_version == source.config.reset_version
                    && old.source.config.preset == source.config.preset
                {
                    old.simulation.take()
                } else {
                    None
                }
            });
            if source.config.preset == "shallow" {
                let initialized = simulation.is_none();
                if initialized {
                    simulation = Some(self.new_simulation(device, &source, &uniform));
                }
                if sources_changed
                    && !initialized
                    && let Some(sim) = &simulation
                {
                    queue.write_buffer(
                        &sim.rates,
                        0,
                        bytemuck::cast_slice(&source_field(
                            &source.config,
                            source.size,
                            SIM_RESOLUTION,
                        )),
                    );
                }
            } else {
                simulation = None;
            }
            let state = simulation.as_ref().map_or(&self.dummy, |s| &s.cells[0]);
            let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("water.material"),
                layout: &self.layout,
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: uniform.as_entire_binding(),
                    },
                    wgpu::BindGroupEntry {
                        binding: 1,
                        resource: state.as_entire_binding(),
                    },
                ],
            });
            self.draws.push(GpuWater {
                source,
                uniform,
                simulation,
                bind_group,
            });
        }
    }
    fn new_simulation(
        &self,
        device: &wgpu::Device,
        source: &WaterDraw,
        uniform: &wgpu::Buffer,
    ) -> GpuSimulation {
        let data: Vec<[f32; 4]> = source
            .bed
            .iter()
            .map(|&b| [(-b).max(0.0), b, 0.0, 0.0])
            .collect();
        let create = |label, bytes: &[u8]| {
            device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some(label),
                contents: bytes,
                usage: wgpu::BufferUsages::STORAGE
                    | wgpu::BufferUsages::COPY_DST
                    | wgpu::BufferUsages::COPY_SRC,
            })
        };
        let cells = [
            create("water.cells.a", bytemuck::cast_slice(&data)),
            create("water.cells.b", bytemuck::cast_slice(&data)),
        ];
        let flux = create(
            "water.flux",
            bytemuck::cast_slice(&vec![[0.0_f32; 4]; data.len()]),
        );
        let rates = create(
            "water.rates",
            bytemuck::cast_slice(&source_field(&source.config, source.size, SIM_RESOLUTION)),
        );
        let groups = [0, 1].map(|i| {
            device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("water.sim"),
                layout: &self.sim_layout,
                entries: &[uniform, &cells[i], &cells[1 - i], &flux, &rates, &self.step]
                    .iter()
                    .enumerate()
                    .map(|(binding, buffer)| wgpu::BindGroupEntry {
                        binding: binding as u32,
                        resource: buffer.as_entire_binding(),
                    })
                    .collect::<Vec<_>>(),
            })
        });
        GpuSimulation {
            cells,
            rates,
            groups,
        }
    }
    pub fn step(&self, queue: &wgpu::Queue, encoder: &mut wgpu::CommandEncoder, dt: f32) {
        if !self
            .draws
            .iter()
            .any(|d| d.simulation.is_some() && d.source.config.running)
        {
            return;
        }
        queue.write_buffer(
            &self.step,
            0,
            bytemuck::cast_slice(&[dt.clamp(0.0, 0.1), 0.0, 0.0, 0.0]),
        );
        for draw in &self.draws {
            if !draw.source.config.running {
                continue;
            }
            let Some(sim) = &draw.simulation else {
                continue;
            };
            for i in 0..4 {
                // Separate dispatch passes make neighbour flux writes visible before integration.
                for pipeline in [&self.flow, &self.integrate] {
                    let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                        label: Some("water.step"),
                        timestamp_writes: None,
                    });
                    pass.set_pipeline(pipeline);
                    pass.set_bind_group(0, &sim.groups[i % 2], &[]);
                    pass.dispatch_workgroups(8, 8, 1);
                }
            }
        }
    }
    pub fn resize(
        &mut self,
        device: &wgpu::Device,
        depth: &wgpu::TextureView,
        width: u32,
        height: u32,
    ) {
        self.size = (width, height);
        let texture = |label, format, usage| {
            device.create_texture(&wgpu::TextureDescriptor {
                label: Some(label),
                size: wgpu::Extent3d {
                    width,
                    height,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format,
                usage,
                view_formats: &[],
            })
        };
        let color = texture(
            "water.opaque.color",
            wgpu::TextureFormat::Rgba8UnormSrgb,
            wgpu::TextureUsages::COPY_DST | wgpu::TextureUsages::TEXTURE_BINDING,
        );
        let depth_copy = texture(
            "water.opaque.depth",
            wgpu::TextureFormat::R32Float,
            wgpu::TextureUsages::STORAGE_BINDING | wgpu::TextureUsages::TEXTURE_BINDING,
        );
        let color_view = color.create_view(&Default::default());
        let depth_view = depth_copy.create_view(&Default::default());
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("water.refraction"),
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });
        self.snapshot = Some(device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("water.scene"),
            layout: &self.snapshot_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(&color_view),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::Sampler(&sampler),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: wgpu::BindingResource::TextureView(&depth_view),
                },
            ],
        }));
        self.depth_snapshot = Some(device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("water.depth"),
            layout: &self.depth_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(depth),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(&depth_view),
                },
            ],
        }));
        self.color = Some(color);
    }
    pub fn has_draws(&self) -> bool {
        self.draws.iter().any(|d| d.source.config.opacity > 0.0)
    }
    pub fn snapshot(&self, encoder: &mut wgpu::CommandEncoder, scene: &wgpu::Texture) {
        if self.draws.is_empty() {
            return;
        }
        let (Some(color), Some(bind)) = (&self.color, &self.depth_snapshot) else {
            return;
        };
        encoder.copy_texture_to_texture(scene.as_image_copy(), color.as_image_copy(), scene.size());
        let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
            label: Some("water.depth.copy"),
            timestamp_writes: None,
        });
        pass.set_pipeline(&self.copy_depth);
        pass.set_bind_group(0, bind, &[]);
        pass.dispatch_workgroups(self.size.0.div_ceil(8), self.size.1.div_ceil(8), 1);
    }
    #[cfg(test)]
    pub fn simulation_buffer(&self, id: &str) -> Option<&wgpu::Buffer> {
        self.draws
            .iter()
            .find(|d| d.source.id == id)?
            .simulation
            .as_ref()
            .map(|s| &s.cells[0])
    }
    pub fn render(&self, pass: &mut wgpu::RenderPass<'_>, eye: [f32; 3]) {
        let Some(snapshot) = &self.snapshot else {
            return;
        };
        if self.draws.is_empty() {
            return;
        }
        pass.set_pipeline(&self.pipeline);
        pass.set_bind_group(2, snapshot, &[]);
        pass.set_vertex_buffer(0, self.vertices.slice(..));
        pass.set_index_buffer(self.indices.slice(..), wgpu::IndexFormat::Uint32);
        let mut order = [0_usize; 16];
        let count = self.draws.len();
        for (i, v) in order[..count].iter_mut().enumerate() {
            *v = i;
        }
        let distance = |i: usize| {
            (glam::Vec3::from(self.draws[i].source.center) - glam::Vec3::from(eye)).length_squared()
        };
        order[..count].sort_by(|&a, &b| distance(b).total_cmp(&distance(a)));
        for &i in &order[..count] {
            if self.draws[i].source.config.opacity <= 0.0 {
                continue;
            }
            pass.set_bind_group(1, &self.draws[i].bind_group, &[]);
            pass.draw_indexed(0..self.index_count, 0, 0..1);
        }
    }
}
