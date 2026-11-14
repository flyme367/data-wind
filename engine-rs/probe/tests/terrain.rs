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
#[path = "../../data-wind-engine/src/terrain_gpu.rs"]
mod terrain_gpu;

use glam::{Quat, Vec2, Vec3};
use terrain::{TerrainConfig, TerrainSurface, clipmap_mesh, clipmap_position};

#[test]
fn rings_cover_the_domain_once_and_all_indices_are_in_bounds() {
    let (vertices, center, rings) = clipmap_mesh();
    assert_eq!(vertices.len(), 65 * 65);
    assert_eq!(center.len(), 64 * 64 * 6);
    assert_eq!(rings.len(), 64 * 64 * 6 * 3 / 4);
    let area = |indices: &[u32]| -> f32 {
        indices
            .chunks_exact(3)
            .map(|t| {
                let a = Vec2::from(vertices[t[0] as usize]);
                let b = Vec2::from(vertices[t[1] as usize]);
                let c = Vec2::from(vertices[t[2] as usize]);
                (b - a).perp_dot(c - a).abs() / 2.0
            })
            .sum()
    };
    assert_eq!(area(&center), 64.0 * 64.0);
    assert_eq!(area(&rings), 64.0 * 64.0 - 32.0 * 32.0);
}

#[test]
fn every_fine_edge_vertex_matches_a_coarse_inner_vertex_across_camera_snaps() {
    for anchor in [
        Vec2::new(-59.001, 47.999),
        Vec2::new(-0.001, 0.001),
        Vec2::ZERO,
        Vec2::new(31.999, -32.001),
        Vec2::new(32.001, -31.999),
    ] {
        for level in 0..7 {
            let spacing = 0.25 * 2.0_f32.powi(level as i32);
            for axis in 0..2 {
                for side in [-1.0_f32, 1.0] {
                    let edge = |distance: f32, tangent: f32| {
                        if axis == 0 {
                            Vec2::new(distance * side, tangent)
                        } else {
                            Vec2::new(tangent, distance * side)
                        }
                    };
                    let coarse: Vec<_> = (-16..=16)
                        .map(|i| {
                            clipmap_position(edge(16.0, i as f32), anchor, spacing * 2.0, level + 1)
                        })
                        .collect();
                    for i in -32..=32 {
                        let fine = clipmap_position(edge(32.0, i as f32), anchor, spacing, level);
                        assert!(
                            coarse.iter().any(|point| point.distance(fine) < 0.0001),
                            "seam at level {level}, anchor {anchor:?}, vertex {i}: {fine:?}"
                        );
                    }
                }
            }
        }
    }
}

#[test]
fn heightmaps_use_bilinear_sampling_and_picking_respects_transforms() {
    let config = TerrainConfig {
        resolution: 33,
        heights: (0..33)
            .flat_map(|_| (0..33).map(|x| (x * 65535 / 32) as u16))
            .collect(),
        ..TerrainConfig::default()
    };
    let surface = TerrainSurface::new(config);
    assert!((surface.sample(Vec2::splat(0.5)) - 0.5).abs() < 0.0001);
    assert_eq!(surface.sample(Vec2::new(-1.0, 0.0)), 0.0);
    assert_eq!(surface.sample(Vec2::new(2.0, 0.0)), 1.0);
    let rotation = Quat::from_rotation_y(0.8);
    let center = Vec3::new(12.0, 5.0, -4.0);
    let half = Vec3::new(10.0, 4.0, 7.0);
    let hit = surface
        .picking
        .as_ref()
        .expect("height field query")
        .ray_distance(center + Vec3::Y * 20.0, -Vec3::Y, center, half, rotation)
        .expect("hit terrain center");
    assert!((hit - 20.0).abs() < 0.01);
}

#[test]
fn all_presets_have_bounded_heights_and_scene_edits_reuse_height_fields() {
    for preset in ["flat", "hills", "mountains", "dunes", "snow"] {
        let surface = TerrainSurface::new(TerrainConfig {
            preset: preset.into(),
            ..Default::default()
        });
        assert_eq!(surface.heights.len(), 257 * 257);
        assert!(
            surface
                .heights
                .iter()
                .all(|h| h.is_finite() && (0.0..=1.0).contains(h))
        );
    }
    let mut instance = common::FlatInstanceIn {
        id: "ground".into(),
        kind: "terrain".into(),
        pos: [0.0; 3],
        size: [256.0, 24.0, 256.0],
        rot_y: 0.0,
        rotation: None,
        color: [0.5; 3],
        locked: None,
        to: None,
        model_id: None,
        water: None,
        terrain: Some(TerrainConfig::default()),
    };
    let first = scene::ScenePools::from_flat(&[instance.clone()]);
    assert_eq!(
        first.instances[0].color[3], 0.0,
        "terrain must not render a proxy box"
    );
    instance.pos[0] = 10.0;
    let second = scene::ScenePools::from_flat_cached(&[instance], &first.terrains);
    assert!(std::sync::Arc::ptr_eq(
        &first.terrains[0].surface,
        &second.terrains[0].surface
    ));
    assert_eq!(second.pick_boxes[0].center.x, 10.0);
}

#[test]
#[ignore = "Requires a native GPU; run explicitly with --ignored"]
fn gpu_clipmaps_render_a_heightfield_and_read_back_real_pixels() {
    use wgpu::util::DeviceExt;
    pollster::block_on(async {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions::default())
            .await
            .expect("GPU adapter for terrain verification");
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor::default())
            .await
            .expect("terrain GPU device");
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("terrain.test.frame"),
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
                wgpu::BindGroupLayoutEntry {
                    binding: 7,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Depth,
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 8,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Comparison),
                    count: None,
                },
            ],
        });
        let camera = camera::Camera::new(Vec3::new(0.0, 20.0, 0.0), 0.7, 0.65, 310.0);
        let aspect = 768.0 / 512.0;
        let params = common::FrameParams {
            vp: camera.vp(aspect).to_cols_array_2d(),
            view: camera.view().to_cols_array_2d(),
            proj: camera.proj(aspect).to_cols_array_2d(),
            cam_pos: camera.eye().extend(1.0).to_array(),
            misc: [0.0, 0.0, 1000.0, 2000.0],
            misc2: [0.0, 0.0, 1.0, 0.0],
            background: [0.10, 0.12, 0.16, 1.0],
            ground: [0.1; 4],
            light: [0.45, 0.85, 0.35, 1.0],
            light_color: [1.0; 4],
            light_vp: glam::Mat4::IDENTITY.to_cols_array_2d(),
            shadow: [0.0; 4],
        };
        let frame = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("terrain.test.frame"),
            contents: bytemuck::bytes_of(&params),
            usage: wgpu::BufferUsages::UNIFORM,
        });
        let pools = scene::ScenePools::from_flat(&[common::FlatInstanceIn {
            id: "test-terrain".into(),
            kind: "terrain".into(),
            pos: [0.0, 32.0, 0.0],
            size: [256.0, 64.0, 256.0],
            rot_y: 0.0,
            rotation: None,
            color: [0.24, 0.38, 0.19],
            locked: None,
            to: None,
            model_id: None,
            water: None,
            terrain: Some(TerrainConfig {
                preset: "mountains".into(),
                snow_line: 0.6,
                ..Default::default()
            }),
        }]);
        let instances = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("terrain.test.instances"),
            contents: bytemuck::cast_slice(&pools.instances),
            usage: wgpu::BufferUsages::STORAGE,
        });
        let texture = |label, format, usage| {
            device.create_texture(&wgpu::TextureDescriptor {
                label: Some(label),
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
            "terrain.test.target",
            wgpu::TextureFormat::Rgba8UnormSrgb,
            wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        );
        let depth = texture(
            "terrain.test.depth",
            wgpu::TextureFormat::Depth24Plus,
            wgpu::TextureUsages::RENDER_ATTACHMENT,
        );
        let shadow = texture(
            "terrain.test.shadow",
            wgpu::TextureFormat::Depth32Float,
            wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::RENDER_ATTACHMENT,
        );
        let shadow_view = shadow.create_view(&Default::default());
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            compare: Some(wgpu::CompareFunction::Less),
            ..Default::default()
        });
        let bind = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("terrain.test.bind"),
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
                wgpu::BindGroupEntry {
                    binding: 7,
                    resource: wgpu::BindingResource::TextureView(&shadow_view),
                },
                wgpu::BindGroupEntry {
                    binding: 8,
                    resource: wgpu::BindingResource::Sampler(&sampler),
                },
            ],
        });
        let mut terrain = terrain_gpu::TerrainRenderer::new(&device, &layout);
        terrain.sync(&device, &queue, pools.terrains);
        let mut encoder = device.create_command_encoder(&Default::default());
        let target_view = target.create_view(&Default::default());
        let depth_view = depth.create_view(&Default::default());
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("terrain.test"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &target_view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color {
                            r: 0.1,
                            g: 0.12,
                            b: 0.16,
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
            pass.set_bind_group(0, &bind, &[]);
            terrain.render(&mut pass);
        }
        let readback = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("terrain.test.readback"),
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
        readback
            .slice(..)
            .map_async(wgpu::MapMode::Read, move |result| {
                sender.send(result).expect("readback receiver");
            });
        device
            .poll(wgpu::PollType::Wait {
                submission_index: None,
                timeout: Some(std::time::Duration::from_secs(20)),
            })
            .expect("GPU complete");
        receiver
            .recv()
            .expect("readback callback")
            .expect("mapped pixels");
        let pixels = readback
            .slice(..)
            .get_mapped_range()
            .expect("pixel view")
            .to_vec();
        readback.unmap();
        let background = &pixels[..4];
        assert!(
            pixels.chunks_exact(4).filter(|p| *p != background).count() > 768 * 512 / 10,
            "terrain must cover a visible portion of the image"
        );
        assert!(pixels.chunks_exact(4).all(|pixel| pixel[3] == 255));
        if let Ok(directory) = std::env::var("DW_TERRAIN_CAPTURE_DIR") {
            std::fs::create_dir_all(&directory).expect("capture directory");
            std::fs::write(
                std::path::Path::new(&directory).join("terrain-gpu.rgba"),
                pixels,
            )
            .expect("capture pixels");
        }
    });
}

#[path = "../../data-wind-cpu/src/water.rs"]
#[allow(dead_code)]
mod water;
