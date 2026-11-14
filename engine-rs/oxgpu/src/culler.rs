//! 视锥剔除器。
//!
//! 包围球与视锥六平面求交，命中实例的索引原子写入 `visible` storage buffer，
//! 同时把可见数累计进 draw indirect 参数缓冲。渲染管线用 `draw_indirect`
//! 直接消费结果，全程无 CPU 回读。

use bytemuck::{Pod, Zeroable};

/// 包围球（xyz + radius + 全局实例索引，对齐 WGSL，32 字节）。
#[repr(C)]
#[derive(Copy, Clone, Pod, Zeroable, Debug)]
pub struct BoundingSphere {
    pub center: [f32; 4],
    pub index: u32,
    pub _pad: [u32; 3],
}

#[repr(C)]
#[derive(Copy, Clone, Pod, Zeroable, Debug)]
pub struct CullParams {
    pub planes: [[f32; 4]; 6],
    pub count: u32,
    pub _pad: [u32; 3],
}

#[repr(C)]
#[derive(Copy, Clone, Pod, Zeroable, Debug)]
struct CpuIndirect {
    vertex_count: u32,
    instance_count: u32,
    first_vertex: u32,
    first_instance: u32,
}

/// 视锥剔除。
pub struct FrustumCuller {
    spheres_buf: wgpu::Buffer,
    params_buf: wgpu::Buffer,
    visible_buf: wgpu::Buffer,
    indirect_buf: wgpu::Buffer,
    bind_group: wgpu::BindGroup,
    pipeline: wgpu::ComputePipeline,
    capacity: u32,
    /// CPU 侧镜像的可见数（供统计，不参与渲染）
    last_visible: u32,
}

impl FrustumCuller {
    pub const MAX_INSTANCES: u32 = 1024;
    const WORKGROUP_SIZE: u32 = 64;

    pub fn new(device: &wgpu::Device, queue: &wgpu::Queue) -> Self {
        let spheres_buf = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("oxgpu.cull.spheres"),
            size: (Self::MAX_INSTANCES as u64) * std::mem::size_of::<BoundingSphere>() as u64,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let params_buf = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("oxgpu.cull.params"),
            size: std::mem::size_of::<CullParams>() as u64,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let visible_buf = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("oxgpu.cull.visible"),
            size: (Self::MAX_INSTANCES as u64) * 4,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        // draw indirect：uint4 { vertexCount, instanceCount, firstVertex, firstInstance }
        let indirect_buf = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("oxgpu.cull.indirect"),
            size: 16,
            usage: wgpu::BufferUsages::STORAGE
                | wgpu::BufferUsages::COPY_DST
                | wgpu::BufferUsages::INDIRECT,
            mapped_at_creation: false,
        });

        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("oxgpu.cull.shader"),
            source: wgpu::ShaderSource::Wgsl(crate::CULL.into()),
        });

        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("oxgpu.cull.bgl"),
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
                        ty: wgpu::BufferBindingType::Storage { read_only: true },
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
                        ty: wgpu::BufferBindingType::Storage { read_only: false },
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
            ],
        });

        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("oxgpu.cull.bg"),
            layout: &layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: spheres_buf.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: params_buf.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: visible_buf.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 3,
                    resource: indirect_buf.as_entire_binding(),
                },
            ],
        });

        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("oxgpu.cull.pl"),
            bind_group_layouts: &[Some(&layout)],
            immediate_size: 0,
        });

        let pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("oxgpu.cull.pipeline"),
            layout: Some(&pipeline_layout),
            module: &module,
            entry_point: Some("main"),
            compilation_options: Default::default(),
            cache: None,
        });

        // vertex_count 固定为 36（单位立方体 12 三角形），instance_count 每帧由 GPU 原子累计
        let header = CpuIndirect {
            vertex_count: 36,
            instance_count: 0,
            first_vertex: 0,
            first_instance: 0,
        };
        queue.write_buffer(&indirect_buf, 0, bytemuck::bytes_of(&header));

        Self {
            spheres_buf,
            params_buf,
            visible_buf,
            indirect_buf,
            bind_group,
            pipeline,
            capacity: Self::MAX_INSTANCES,
            last_visible: 0,
        }
    }

    /// 上传实例包围球。
    pub fn upload(&mut self, queue: &wgpu::Queue, spheres: &[BoundingSphere]) {
        let n = spheres.len().min(self.capacity as usize);
        if n > 0 {
            queue.write_buffer(&self.spheres_buf, 0, bytemuck::cast_slice(&spheres[..n]));
        }
    }

    /// Update one moved instance without uploading the rest of the scene.
    pub fn update_sphere(&self, queue: &wgpu::Queue, sphere: &BoundingSphere) {
        if sphere.index < self.capacity {
            queue.write_buffer(
                &self.spheres_buf,
                u64::from(sphere.index) * std::mem::size_of::<BoundingSphere>() as u64,
                bytemuck::bytes_of(sphere),
            );
        }
    }

    /// 上传视锥平面与实例数量。
    pub fn upload_params(&self, queue: &wgpu::Queue, params: &CullParams) {
        queue.write_buffer(&self.params_buf, 0, bytemuck::bytes_of(params));
    }

    /// 清零 indirect 的 instance_count（每次 dispatch 前调用）。
    pub fn reset_indirect(&self, queue: &wgpu::Queue) {
        queue.write_buffer(&self.indirect_buf, 4, bytemuck::bytes_of(&0u32));
    }

    /// 按活跃实例数启动所需的工作组。
    pub fn dispatch(&mut self, encoder: &mut wgpu::CommandEncoder, count: u32) {
        let workgroups = cull_workgroup_count(count);
        if workgroups == 0 {
            return;
        }
        let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
            label: Some("oxgpu.cull.pass"),
            timestamp_writes: None,
        });
        pass.set_pipeline(&self.pipeline);
        pass.set_bind_group(0, &self.bind_group, &[]);
        pass.dispatch_workgroups(workgroups, 1, 1);
        // GPU 侧的真实计数不回读；统计由渲染端 CPU 镜像维护
    }

    pub fn set_last_visible(&mut self, visible: u32) {
        self.last_visible = visible;
    }

    pub fn last_visible(&self) -> u32 {
        self.last_visible
    }

    pub fn indirect_buffer(&self) -> &wgpu::Buffer {
        &self.indirect_buf
    }

    pub fn visible_buffer(&self) -> &wgpu::Buffer {
        &self.visible_buf
    }
}

fn cull_workgroup_count(count: u32) -> u32 {
    count
        .min(FrustumCuller::MAX_INSTANCES)
        .div_ceil(FrustumCuller::WORKGROUP_SIZE)
}

#[cfg(test)]
mod tests {
    use super::cull_workgroup_count;

    #[test]
    fn dispatch_size_tracks_active_instances_and_buffer_capacity() {
        assert_eq!(cull_workgroup_count(0), 0);
        assert_eq!(cull_workgroup_count(1), 1);
        assert_eq!(cull_workgroup_count(64), 1);
        assert_eq!(cull_workgroup_count(65), 2);
        assert_eq!(cull_workgroup_count(1024), 16);
        assert_eq!(cull_workgroup_count(4096), 16);
    }
}
