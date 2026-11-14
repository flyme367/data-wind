#[path = "../../data-wind-cpu/src/camera.rs"]
#[allow(dead_code)]
mod camera;
#[path = "../../data-wind-cpu/src/common.rs"]
#[allow(dead_code)]
mod common;
#[path = "../../data-wind-cpu/src/mesh.rs"]
#[allow(dead_code)]
mod mesh;
#[path = "../../data-wind-cpu/src/picking.rs"]
#[allow(dead_code)]
mod picking;
#[path = "../../data-wind-cpu/src/protocol.rs"]
#[allow(dead_code)]
mod protocol;
#[path = "../../data-wind-engine/src/scene.rs"]
#[allow(dead_code)]
mod scene;
#[path = "../../data-wind-cpu/src/terrain.rs"]
#[allow(dead_code)]
mod terrain;
#[path = "../../data-wind-cpu/src/water.rs"]
#[allow(dead_code)]
mod water;
#[path = "../../data-wind-engine/src/water_gpu.rs"]
#[allow(dead_code)]
mod water_gpu;

use common::{FlatInstanceIn, WaterConfig};
use glam::{Quat, Vec2, Vec3};
use water::{ShallowWater, source_field};
fn body(preset: &str) -> FlatInstanceIn {
    FlatInstanceIn {
        id: "water".into(),
        kind: "water".into(),
        pos: [0.0, 0.3, 0.0],
        size: [32.0, 2.0, 32.0],
        rot_y: 0.0,
        rotation: None,
        color: [0.1, 0.5, 0.65],
        locked: None,
        to: None,
        model_id: None,
        terrain: None,
        water: Some(WaterConfig {
            preset: preset.into(),
            ..Default::default()
        }),
    }
}
#[test]
fn reflecting_basin_conserves_volume_and_remains_nonnegative_on_uneven_bed() {
    let config = WaterConfig {
        sources: Vec::new(),
        ..Default::default()
    };
    let bed: Vec<_> = (0..32 * 32)
        .map(|i| if i % 32 < 12 { -0.8 } else { -0.1 })
        .collect();
    let mut sim = ShallowWater::new(&config, [16.0, 2.0, 32.0], bed, 32);
    sim.cells[10][0] += 0.5;
    let initial: f32 = sim.cells.iter().map(|c| c[0]).sum();
    for _ in 0..500 {
        sim.step(0.01);
    }
    let final_volume: f32 = sim.cells.iter().map(|c| c[0]).sum();
    assert!((final_volume - initial).abs() / initial < 0.00001);
    assert!(sim.cells.iter().flatten().all(|v| v.is_finite()));
    assert!(sim.cells.iter().all(|c| c[0] >= 0.0));
}
#[test]
fn source_volume_is_normalized_even_at_the_domain_corner_and_sinks_cannot_go_negative() {
    let config = WaterConfig {
        initial_depth: 0.0,
        sources: vec![[-0.5, -0.5, 2.0, 0.06]],
        ..Default::default()
    };
    let rates = source_field(&config, [16.0, 2.0, 32.0], 32);
    assert!((rates.iter().sum::<f32>() - 2.0).abs() < 0.00001);
    let mut sim = ShallowWater::new(&config, [16.0, 2.0, 32.0], vec![0.0; 1024], 32);
    for _ in 0..100 {
        sim.step(0.01);
    }
    let volume: f32 = sim.cells.iter().map(|c| c[0]).sum::<f32>() * sim.spacing.x * sim.spacing.y;
    assert!((volume - 2.0).abs() < 0.001);
    sim.rates.iter_mut().for_each(|v| *v = -20.0);
    for _ in 0..20 {
        sim.step(0.01);
    }
    assert!(sim.cells.iter().all(|c| c[0] >= 0.0 && c[0].is_finite()));
}
#[test]
fn water_picking_matches_lake_and_river_shapes_and_bed_cache_survives_material_edits() {
    let flat = body("lake");
    let pools = scene::ScenePools::from_flat(&[flat.clone()]);
    let pick = pools.waters[0].picking.as_ref().expect("lake mesh");
    assert!(
        pick.ray_distance(
            Vec3::new(0.0, 10.0, 0.0),
            -Vec3::Y,
            Vec3::from(flat.pos),
            Vec3::from(flat.size) * 0.5,
            Quat::IDENTITY
        )
        .is_some()
    );
    assert!(
        pick.ray_distance(
            Vec3::new(15.0, 10.0, 15.0),
            -Vec3::Y,
            Vec3::from(flat.pos),
            Vec3::from(flat.size) * 0.5,
            Quat::IDENTITY
        )
        .is_none()
    );
    let mut edit = flat.clone();
    edit.water.as_mut().expect("config").foam = 0.8;
    let next = scene::ScenePools::from_flat_with_water(&[edit], &pools.terrains, &pools.waters);
    assert!(std::sync::Arc::ptr_eq(
        &next.waters[0].bed,
        &pools.waters[0].bed
    ));
    let mut river = WaterConfig {
        preset: "river".into(),
        ..Default::default()
    };
    river.points = vec![[-0.2, -0.4], [0.2, 0.4]];
    let center = water::surface_xz(&river, [20.0, 2.0, 40.0], Vec2::splat(0.5));
    assert!(center.length() < 0.001);
}
#[test]
fn dry_terrain_barriers_block_initial_water_and_bed_changes_invalidate_simulation() {
    let mut terrain = body("lake");
    terrain.kind = "terrain".into();
    terrain.id = "bed".into();
    terrain.water = None;
    terrain.pos = [0.0, 0.5, 0.0];
    terrain.size = [32.0, 1.0, 32.0];
    terrain.terrain = Some(common::TerrainConfig {
        preset: "flat".into(),
        resolution: 33,
        heights: (0..33 * 33)
            .map(|i| if i % 33 < 16 { 0 } else { 65535 })
            .collect(),
        ..Default::default()
    });
    let flat = body("shallow");
    let pools = scene::ScenePools::from_flat(&[terrain.clone(), flat.clone()]);
    assert!(pools.waters[0].bed.iter().any(|b| *b > 0.6));
    assert!(pools.waters[0].bed.iter().any(|b| *b < 0.0));
    terrain.pos[1] += 1.0;
    let changed =
        scene::ScenePools::from_flat_with_water(&[terrain, flat], &pools.terrains, &pools.waters);
    assert!(!std::sync::Arc::ptr_eq(
        &pools.waters[0].bed,
        &changed.waters[0].bed
    ));
}

#[test]
#[ignore = "requires a hardware WebGPU adapter"]
fn gpu_water_renders_all_five_modes_and_advances_shallow_simulation() {
    pollster::block_on(async {
        use wgpu::util::DeviceExt;
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
        let adapter = instance
            .request_adapter(&Default::default())
            .await
            .expect("GPU adapter");
        let (device, queue) = adapter
            .request_device(&Default::default())
            .await
            .expect("device");
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("water.test.frame"),
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
                    visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Storage { read_only: true },
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
            ],
        });
        let camera = camera::Camera::new(Vec3::ZERO, 0.65, 0.65, 52.0);
        let params = common::FrameParams {
            vp: camera.vp(1.5).to_cols_array_2d(),
            view: camera.view().to_cols_array_2d(),
            proj: camera.proj(1.5).to_cols_array_2d(),
            cam_pos: camera.eye().extend(1.0).to_array(),
            misc: [1.0, 0.0, 1000.0, 2000.0],
            misc2: [0.0, 0.0, 1.0, 0.0],
            background: [0.1, 0.15, 0.22, 1.0],
            ground: [0.1; 4],
            light: [0.45, 0.85, 0.35, 1.0],
            light_color: [1.0; 4],
            light_vp: glam::Mat4::IDENTITY.to_cols_array_2d(),
            shadow: [0.0; 4],
        };
        let frame = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: None,
            contents: bytemuck::bytes_of(&params),
            usage: wgpu::BufferUsages::UNIFORM,
        });
        let texture = |format, usage| {
            device.create_texture(&wgpu::TextureDescriptor {
                label: None,
                size: wgpu::Extent3d {
                    width: 768,
                    height: 512,
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
        let target = texture(
            wgpu::TextureFormat::Rgba8UnormSrgb,
            wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        );
        let depth = texture(
            wgpu::TextureFormat::Depth24Plus,
            wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
        );
        let target_view = target.create_view(&Default::default());
        let depth_view = depth.create_view(&Default::default());
        let floor = opaque_floor(&device, &layout);
        let baseline = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("water.opaque.read"),
            size: 768 * 512 * 4,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        let mut renderer = water_gpu::WaterRenderer::new(&device, &layout);
        renderer.resize(&device, &depth_view, 768, 512);
        let mut captures = Vec::new();
        for preset in ["ocean", "lake", "pool", "river", "shallow"] {
            let pools = scene::ScenePools::from_flat(&[body(preset)]);
            let instances = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: None,
                contents: bytemuck::cast_slice(&pools.instances),
                usage: wgpu::BufferUsages::STORAGE,
            });
            let bind = device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: None,
                layout: &layout,
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: frame.as_entire_binding(),
                    },
                    wgpu::BindGroupEntry {
                        binding: 1,
                        resource: instances.as_entire_binding(),
                    },
                ],
            });
            let sources = pools.waters.clone();
            renderer.sync(&device, &queue, pools.waters);
            for step in 0..2 {
                let mut encoder = device.create_command_encoder(&Default::default());
                if step > 0 {
                    for _ in 0..20 {
                        renderer.step(&queue, &mut encoder, 0.033);
                    }
                }
                {
                    let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                        label: Some("opaque clear"),
                        color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                            view: &target_view,
                            depth_slice: None,
                            resolve_target: None,
                            ops: wgpu::Operations {
                                load: wgpu::LoadOp::Clear(wgpu::Color {
                                    r: 0.04,
                                    g: 0.06,
                                    b: 0.09,
                                    a: 1.0,
                                }),
                                store: wgpu::StoreOp::Store,
                            },
                        })],
                        depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                            view: &depth_view,
                            depth_ops: Some(wgpu::Operations {
                                load: wgpu::LoadOp::Clear(1.0),
                                store: wgpu::StoreOp::Store,
                            }),
                            stencil_ops: None,
                        }),
                        timestamp_writes: None,
                        occlusion_query_set: None,
                        multiview_mask: None,
                    });
                    pass.set_pipeline(&floor);
                    pass.set_bind_group(0, &bind, &[]);
                    pass.draw(0..6, 0..2);
                }
                encoder.copy_texture_to_buffer(
                    target.as_image_copy(),
                    wgpu::TexelCopyBufferInfo {
                        buffer: &baseline,
                        layout: wgpu::TexelCopyBufferLayout {
                            offset: 0,
                            bytes_per_row: Some(768 * 4),
                            rows_per_image: Some(512),
                        },
                    },
                    target.size(),
                );
                renderer.snapshot(&mut encoder, &target);
                {
                    let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                        label: Some("water"),
                        color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                            view: &target_view,
                            depth_slice: None,
                            resolve_target: None,
                            ops: wgpu::Operations {
                                load: wgpu::LoadOp::Load,
                                store: wgpu::StoreOp::Store,
                            },
                        })],
                        depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                            view: &depth_view,
                            depth_ops: Some(wgpu::Operations {
                                load: wgpu::LoadOp::Load,
                                store: wgpu::StoreOp::Store,
                            }),
                            stencil_ops: None,
                        }),
                        timestamp_writes: None,
                        occlusion_query_set: None,
                        multiview_mask: None,
                    });
                    pass.set_bind_group(0, &bind, &[]);
                    renderer.render(&mut pass, camera.eye().to_array());
                }
                let readback = device.create_buffer(&wgpu::BufferDescriptor {
                    label: None,
                    size: 768 * 512 * 4,
                    usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
                    mapped_at_creation: false,
                });
                encoder.copy_texture_to_buffer(
                    target.as_image_copy(),
                    wgpu::TexelCopyBufferInfo {
                        buffer: &readback,
                        layout: wgpu::TexelCopyBufferLayout {
                            offset: 0,
                            bytes_per_row: Some(768 * 4),
                            rows_per_image: Some(512),
                        },
                    },
                    target.size(),
                );
                queue.submit([encoder.finish()]);
                let (sender, receiver) = std::sync::mpsc::channel();
                readback.slice(..).map_async(wgpu::MapMode::Read, move |r| {
                    sender.send(r).expect("readback channel");
                });
                device
                    .poll(wgpu::PollType::Wait {
                        submission_index: None,
                        timeout: Some(std::time::Duration::from_secs(20)),
                    })
                    .expect("GPU finished");
                receiver.recv().expect("callback").expect("mapped");
                let pixels = readback
                    .slice(..)
                    .get_mapped_range()
                    .expect("pixels")
                    .to_vec();
                readback.unmap();
                let opaque = map_bytes(&device, &baseline);
                assert!(
                    pixels
                        .chunks_exact(4)
                        .zip(opaque.chunks_exact(4))
                        .filter(|(a, b)| a != b)
                        .count()
                        > 1500,
                    "{preset} must change opaque-scene pixels"
                );
                assert!(
                    pixels
                        .chunks_exact(4)
                        .zip(opaque.chunks_exact(4))
                        .filter(|(_, b)| b[0] > 190 && b[1] < 140 && b[2] < 100)
                        .all(|(a, b)| a == b),
                    "foreground objects must remain in front of {preset}"
                );
                if preset == "shallow" {
                    captures.push(pixels.clone());
                }
                if step == 1
                    && let Ok(directory) = std::env::var("DW_WATER_CAPTURE_DIR")
                {
                    std::fs::create_dir_all(&directory).expect("capture directory");
                    std::fs::write(
                        std::path::Path::new(&directory).join(format!("water-{preset}.rgba")),
                        pixels,
                    )
                    .expect("save pixels");
                }
            }
            if preset == "shallow" {
                let state = read_cells(
                    &device,
                    &queue,
                    renderer.simulation_buffer("water").expect("state"),
                );
                let source = &sources[0];
                let mut reference =
                    ShallowWater::new(&source.config, source.size, source.bed.as_ref().clone(), 64);
                for _ in 0..80 {
                    reference.step(0.033 * 0.25);
                }
                let difference = state
                    .iter()
                    .zip(&reference.cells)
                    .flat_map(|(a, b)| a.iter().zip(b).map(|(a, b)| (a - b).abs()))
                    .fold(0.0_f32, f32::max);
                assert!(
                    difference < 0.0005,
                    "GPU and reference solver differ: {difference}"
                );
                let mut paused = sources.clone();
                paused[0].config.running = false;
                renderer.sync(&device, &queue, paused.clone());
                let mut encoder = device.create_command_encoder(&Default::default());
                renderer.step(&queue, &mut encoder, 0.1);
                queue.submit([encoder.finish()]);
                assert_eq!(
                    read_cells(
                        &device,
                        &queue,
                        renderer.simulation_buffer("water").expect("state")
                    ),
                    state,
                    "pause preserves the simulation"
                );
                paused[0].config.reset_version += 1;
                renderer.sync(&device, &queue, paused);
                let reset = read_cells(
                    &device,
                    &queue,
                    renderer.simulation_buffer("water").expect("state"),
                );
                assert!(
                    reset
                        .iter()
                        .all(|c| (c[0] - 0.15).abs() < 0.00001 && c[2] == 0.0 && c[3] == 0.0)
                );
            }
        }
        assert_ne!(
            captures[0], captures[1],
            "GPU injection and flux must move the water surface"
        );
    });
}

fn read_cells(device: &wgpu::Device, queue: &wgpu::Queue, source: &wgpu::Buffer) -> Vec<[f32; 4]> {
    let buffer = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("water.state.read"),
        size: source.size(),
        usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    });
    let mut encoder = device.create_command_encoder(&Default::default());
    encoder.copy_buffer_to_buffer(source, 0, &buffer, 0, source.size());
    queue.submit([encoder.finish()]);
    let (sender, receiver) = std::sync::mpsc::channel();
    buffer.slice(..).map_async(wgpu::MapMode::Read, move |r| {
        sender.send(r).expect("state channel");
    });
    device
        .poll(wgpu::PollType::Wait {
            submission_index: None,
            timeout: Some(std::time::Duration::from_secs(20)),
        })
        .expect("GPU complete");
    receiver
        .recv()
        .expect("state callback")
        .expect("mapped state");
    let state = buffer
        .slice(..)
        .get_mapped_range()
        .expect("read state")
        .chunks_exact(16)
        .map(|c| {
            std::array::from_fn(|i| {
                f32::from_le_bytes(c[i * 4..i * 4 + 4].try_into().expect("float bytes"))
            })
        })
        .collect();
    buffer.unmap();
    state
}

fn map_bytes(device: &wgpu::Device, buffer: &wgpu::Buffer) -> Vec<u8> {
    let (sender, receiver) = std::sync::mpsc::channel();
    buffer.slice(..).map_async(wgpu::MapMode::Read, move |r| {
        sender.send(r).expect("pixel channel");
    });
    device
        .poll(wgpu::PollType::Wait {
            submission_index: None,
            timeout: Some(std::time::Duration::from_secs(20)),
        })
        .expect("GPU complete");
    receiver
        .recv()
        .expect("pixel callback")
        .expect("mapped pixels");
    let bytes = buffer
        .slice(..)
        .get_mapped_range()
        .expect("pixel bytes")
        .to_vec();
    buffer.unmap();
    bytes
}
fn opaque_floor(device: &wgpu::Device, layout: &wgpu::BindGroupLayout) -> wgpu::RenderPipeline {
    let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some("water.test.opaque"),
        source: wgpu::ShaderSource::Wgsl(include_str!("fixtures/water_opaque.wgsl").into()),
    });
    let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
        label: None,
        bind_group_layouts: &[Some(layout)],
        immediate_size: 0,
    });
    device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some("water.test.opaque"),
        layout: Some(&layout),
        vertex: wgpu::VertexState {
            module: &shader,
            entry_point: Some("vs"),
            compilation_options: Default::default(),
            buffers: &[],
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
    })
}
