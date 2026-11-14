//! 飞线粒子模拟器。
//!
//! 粒子沿二次贝塞尔曲线（起点 → 控制点 → 终点）循环运动，`dt` 驱动；
//! 位置与颜色写入 `out` storage buffer，渲染管线在顶点阶段直接读取，
//! 不经过 CPU。

use bytemuck::{Pod, Zeroable};
use wgpu::util::DeviceExt;

/// WGSL `struct Arc`：3×vec3 + vec4 + u32 + vec3<u32>（vec3 按 16 字节对齐）。
#[repr(C)]
#[derive(Copy, Clone, Pod, Zeroable, Debug)]
pub struct Arc {
    pub a: [f32; 4],
    pub b: [f32; 4],
    pub c: [f32; 4],
    pub color: [f32; 4],
    pub _count: u32,
    pub _pad: [u32; 3],
}

#[repr(C)]
#[derive(Copy, Clone, Pod, Zeroable, Debug)]
struct Particle {
    arc: u32,
    t: f32,
    speed: f32,
    _pad: f32,
}

/// 供渲染管线读取的粒子输出（与 WGSL `struct Out` 对应）。
#[repr(C)]
#[derive(Copy, Clone, Pod, Zeroable, Debug)]
pub struct ParticleOut {
    pub pos_t: [f32; 4],
    pub color_size: [f32; 4],
}

#[repr(C)]
#[derive(Copy, Clone, Pod, Zeroable)]
struct Params {
    dt: f32,
    count: u32,
    _p0: f32,
    _p1: f32,
}

/// 飞线粒子模拟。
pub struct FlylineSim {
    arcs_buf: wgpu::Buffer,
    particles_buf: wgpu::Buffer,
    out_buf: wgpu::Buffer,
    params_buf: wgpu::Buffer,
    bind_group: wgpu::BindGroup,
    pipeline: wgpu::ComputePipeline,
    particle_count: u32,
    active_arcs: u32,
}

impl FlylineSim {
    pub const MAX_ARCS: u32 = 64;
    pub const PARTICLES_PER_ARC: u32 = 24;
    pub const MAX_PARTICLES: u32 = Self::MAX_ARCS * Self::PARTICLES_PER_ARC;

    pub fn new(device: &wgpu::Device) -> Self {
        let arcs_buf = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("oxgpu.flyline.arcs"),
            size: (Self::MAX_ARCS as u64) * std::mem::size_of::<Arc>() as u64,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let mut particles = Vec::with_capacity(Self::MAX_PARTICLES as usize);
        for i in 0..Self::MAX_PARTICLES {
            let arc = i / Self::PARTICLES_PER_ARC;
            let j = i % Self::PARTICLES_PER_ARC;
            particles.push(Particle {
                arc,
                // 错峰分布，避免同弧粒子扎堆
                t: j as f32 / Self::PARTICLES_PER_ARC as f32,
                speed: 0.10 + 0.12 * ((i % 7) as f32 / 6.0),
                _pad: 0.0,
            });
        }
        let particles_buf = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("oxgpu.flyline.particles"),
            contents: bytemuck::cast_slice(&particles),
            usage: wgpu::BufferUsages::STORAGE,
        });
        let particle_count = particles.len() as u32;

        let out_buf = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("oxgpu.flyline.out"),
            size: (Self::MAX_PARTICLES as u64) * std::mem::size_of::<ParticleOut>() as u64,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let params_buf = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("oxgpu.flyline.params"),
            size: std::mem::size_of::<Params>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("oxgpu.flyline.shader"),
            source: wgpu::ShaderSource::Wgsl(crate::FLYLINE.into()),
        });

        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("oxgpu.flyline.bgl"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Storage { read_only: true },
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Storage { read_only: false },
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Storage { read_only: false },
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 3,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
            ],
        });

        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("oxgpu.flyline.bg"),
            layout: &layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: arcs_buf.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: particles_buf.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: out_buf.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 3,
                    resource: params_buf.as_entire_binding(),
                },
            ],
        });

        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("oxgpu.flyline.pl"),
            bind_group_layouts: &[Some(&layout)],
            immediate_size: 0,
        });

        let pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("oxgpu.flyline.pipeline"),
            layout: Some(&pipeline_layout),
            module: &module,
            entry_point: Some("main"),
            compilation_options: Default::default(),
            cache: None,
        });

        Self {
            arcs_buf,
            particles_buf,
            out_buf,
            params_buf,
            bind_group,
            pipeline,
            particle_count,
            active_arcs: 0,
        }
    }

    /// 上传弧线数据（超出 [`Self::MAX_ARCS`] 的部分被忽略）。
    pub fn upload_arcs(&mut self, queue: &wgpu::Queue, arcs: &[Arc]) {
        let n = arcs.len().min(Self::MAX_ARCS as usize);
        if n > 0 {
            queue.write_buffer(&self.arcs_buf, 0, bytemuck::cast_slice(&arcs[..n]));
        }
        self.active_arcs = n as u32;
    }

    /// 每帧推进一次粒子模拟。
    pub fn dispatch(&self, queue: &wgpu::Queue, encoder: &mut wgpu::CommandEncoder, dt: f32) {
        let params = Params {
            dt,
            count: self.particle_count,
            _p0: 0.0,
            _p1: 0.0,
        };
        queue.write_buffer(&self.params_buf, 0, bytemuck::bytes_of(&params));
        let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
            label: Some("oxgpu.flyline.pass"),
            timestamp_writes: None,
        });
        pass.set_pipeline(&self.pipeline);
        pass.set_bind_group(0, &self.bind_group, &[]);
        pass.dispatch_workgroups(self.particle_count.div_ceil(64), 1, 1);
    }

    pub fn out_buffer(&self) -> &wgpu::Buffer {
        &self.out_buf
    }

    pub fn arcs_buffer(&self) -> &wgpu::Buffer {
        &self.arcs_buf
    }

    pub fn active_arcs(&self) -> u32 {
        self.active_arcs
    }
}
