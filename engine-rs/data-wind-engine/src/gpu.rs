//! 渲染世界：GPU 资源（DwGpu）+ extract 交接 + Core3d 场景 pass。
//! 场景先渲到离屏 RGBA8UnormSrgb 纹理（读回预览用），再 blit 到窗口目标，egui 由 bevy_egui 叠加。

use crate::app::EngineStateHandle;
use crate::common::{Fence, FrameParams, GInstance, Marker, Mode, Ring};
use crate::cull_cache::{CullDispatchCache, CullSignature};
use crate::mesh;
use crate::state::{DwFramePlan, DwUploads, MAX_BOXES, MAX_FENCES, MAX_MARKERS, MAX_RINGS};
use bevy::core_pipeline::oit::{
    OrderIndependentTransparencySettings,
    resolve::{OitResolvePipeline, prepare_oit_resolve_bind_group},
};
use bevy::ecs::schedule::{ScheduleCleanupPolicy, common_conditions::run_once};
use bevy::ecs::system::NonSendMarker;
use bevy::prelude::*;
use bevy::render::{
    ExtractSchedule, MainWorld, Render, RenderApp, RenderSystems,
    camera::ExtractedCamera,
    renderer::{RenderAdapterInfo, RenderDevice, RenderQueue},
    view::ViewTarget,
};
use std::sync::{Arc, Mutex};
use wgpu::util::DeviceExt;

/// 渲染世界 GPU 资源（在 RenderStartup 中创建）。
#[derive(Resource)]
pub(crate) struct DwGpu {
    device: wgpu::Device,
    queue: wgpu::Queue,

    frame_params_buf: wgpu::Buffer,
    instances_buf: wgpu::Buffer,
    model_indices_buf: wgpu::Buffer,
    model_batches: Option<Arc<crate::model_batches::ModelBatches>>,
    markers_buf: wgpu::Buffer,
    fences_buf: wgpu::Buffer,
    rings_buf: wgpu::Buffer,
    vb_ground: wgpu::Buffer,
    vb_grid: wgpu::Buffer,
    vb_box: wgpu::Buffer,
    vb_marker: wgpu::Buffer,
    grid_vert_count: u32,

    flylines: oxgpu::FlylineSim,
    culler: oxgpu::FrustumCuller,
    cull_cache: CullDispatchCache,

    scene_tex: wgpu::Texture,
    scene_view: wgpu::TextureView,
    depth_view: wgpu::TextureView,
    scene_size: (u32, u32),
    preview_buf: Option<wgpu::Buffer>,
    preview_stride: u32,
    /// 窗口交换链格式（首帧从 ViewTarget 读出，读回 sRGB 解码判定用）。
    surface_format: Option<wgpu::TextureFormat>,
    preview_state: Option<Arc<Mutex<crate::preview::PreviewState>>>,
    blit_bgl: wgpu::BindGroupLayout,
    blit_bind: wgpu::BindGroup,
    pl_blit: Option<(wgpu::RenderPipeline, wgpu::TextureFormat)>,

    bg_editor: wgpu::BindGroup,
    bg_login: wgpu::BindGroup,
    bg_shadow: wgpu::BindGroup,
    shadow_view: wgpu::TextureView,
    shadow_sampler: wgpu::Sampler,
    pipelines: Pipelines,
    pl_model: wgpu::RenderPipeline,
    pl_shadow: wgpu::RenderPipeline,
    terrain: crate::terrain_gpu::TerrainRenderer,
    water: crate::water_gpu::WaterRenderer,

    meshes: std::collections::HashMap<String, GpuMesh>,
}

/// 已上传到 GPU 的模型网格（顶点缓冲）。
pub(crate) struct GpuMesh {
    pub vertices: wgpu::Buffer,
    pub vertex_count: u32,
}

impl GpuMesh {
    pub fn upload(device: &wgpu::Device, cpu: &mesh::CpuMesh) -> Result<Self, String> {
        let vertices = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("reference-model.vertices"),
            contents: &cpu.data,
            usage: wgpu::BufferUsages::VERTEX,
        });
        Ok(Self {
            vertices,
            vertex_count: cpu.vertex_count,
        })
    }
}

/// extract 交接：主世界 → 渲染世界的每帧数据。
#[derive(Default, Resource)]
pub(crate) struct DwExtract {
    pub plan: Option<DwFramePlan>,
    pub uploads: DwUploads,
    pub capture_size: Option<(u32, u32)>,
    pub no_surface: bool,
    pub preview_state: Option<Arc<Mutex<crate::preview::PreviewState>>>,
}

pub(crate) struct DwGpuPlugin;

impl Plugin for DwGpuPlugin {
    fn build(&self, app: &mut App) {
        let Some(render_app) = app.get_sub_app_mut(RenderApp) else {
            return;
        };
        render_app
            .init_resource::<DwExtract>()
            .add_systems(bevy::render::RenderStartup, dw_gpu_startup)
            .add_systems(
                ExtractSchedule,
                (
                    dw_extract_system,
                    gate_oit_resolve_preparation.run_if(run_once),
                ),
            )
            .add_systems(
                Render,
                dw_upload_system.in_set(RenderSystems::PrepareResources),
            )
            .add_systems(
                bevy::core_pipeline::Core3d,
                dw_scene_pass.before(bevy::core_pipeline::Core3dSystems::PostProcess),
            );
    }
}

fn gate_oit_resolve_preparation(world: &mut World) {
    if !world.contains_resource::<OitResolvePipeline>() {
        return;
    }
    // The first extract runs after RenderStartup, when the render schedule can initialize.
    world.schedule_scope(Render, |world, schedule| {
        match schedule.remove_systems_in_set(
            prepare_oit_resolve_bind_group,
            world,
            ScheduleCleanupPolicy::RemoveSystemsOnly,
        ) {
            Ok(0) => {}
            Ok(_) => {
                schedule.add_systems(
                    prepare_oit_resolve_bind_group
                        .in_set(RenderSystems::PrepareBindGroups)
                        .run_if(needs_oit_resolve_preparation),
                );
            }
            Err(error) => bevy::log::warn!("Could not gate OIT bind group preparation: {error}"),
        }
    });
}

fn needs_oit_resolve_preparation(
    cameras: Query<
        (),
        (
            With<ExtractedCamera>,
            With<OrderIndependentTransparencySettings>,
        ),
    >,
    mut was_active: Local<bool>,
) -> bool {
    let active = !cameras.is_empty();
    // After the last OIT camera disappears, rebind the released one-element buffers once.
    let prepare = active || *was_active;
    *was_active = active;
    prepare
}

fn dw_gpu_startup(mut commands: Commands, device: Res<RenderDevice>, queue: Res<RenderQueue>) {
    let device_raw = device.wgpu_device().clone();
    let queue_raw: wgpu::Queue = queue.clone().into_inner();

    // ---- GPU 池与网格 ----
    let frame_params_buf = device_raw.create_buffer(&wgpu::BufferDescriptor {
        label: Some("frame_params"),
        size: std::mem::size_of::<FrameParams>() as u64,
        usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    });
    let instances_buf = device_raw.create_buffer(&wgpu::BufferDescriptor {
        label: Some("instances"),
        size: (MAX_BOXES as u64) * std::mem::size_of::<GInstance>() as u64,
        usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    });
    let model_indices_buf = device_raw.create_buffer(&wgpu::BufferDescriptor {
        label: Some("model instance indices"),
        size: u64::from(MAX_BOXES) * std::mem::size_of::<u32>() as u64,
        usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    });
    let markers_buf = device_raw.create_buffer(&wgpu::BufferDescriptor {
        label: Some("markers"),
        size: (MAX_MARKERS as u64) * std::mem::size_of::<Marker>() as u64,
        usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    });
    let fences_buf = device_raw.create_buffer(&wgpu::BufferDescriptor {
        label: Some("fences"),
        size: (MAX_FENCES as u64) * std::mem::size_of::<Fence>() as u64,
        usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    });
    let rings_buf = device_raw.create_buffer(&wgpu::BufferDescriptor {
        label: Some("rings"),
        size: (MAX_RINGS as u64) * std::mem::size_of::<Ring>() as u64,
        usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    });

    let vb_ground = device_raw.create_buffer_init(&wgpu::util::BufferInitDescriptor {
        label: Some("ground"),
        contents: bytemuck::cast_slice(&crate::common::ground_mesh(180.0)),
        usage: wgpu::BufferUsages::VERTEX,
    });
    let grid = crate::common::grid_mesh(
        crate::common::EDITOR_GRID_EXTENT,
        crate::common::EDITOR_GRID_STEP,
    );
    let grid_vert_count = grid.len() as u32;
    let vb_grid = device_raw.create_buffer_init(&wgpu::util::BufferInitDescriptor {
        label: Some("grid"),
        contents: bytemuck::cast_slice(&grid),
        usage: wgpu::BufferUsages::VERTEX,
    });
    let vb_box = device_raw.create_buffer_init(&wgpu::util::BufferInitDescriptor {
        label: Some("box_mesh"),
        contents: bytemuck::cast_slice(&crate::common::box_mesh()),
        usage: wgpu::BufferUsages::VERTEX,
    });
    let vb_marker = device_raw.create_buffer_init(&wgpu::util::BufferInitDescriptor {
        label: Some("marker_mesh"),
        contents: bytemuck::cast_slice(&crate::common::octa_mesh()),
        usage: wgpu::BufferUsages::VERTEX,
    });

    let flylines = oxgpu::FlylineSim::new(&device_raw);
    let culler = oxgpu::FrustumCuller::new(&device_raw, &queue_raw);

    // 离屏场景纹理（RGBA8UnormSrgb，与表面格式解耦）
    let scene_tex = device_raw.create_texture(&wgpu::TextureDescriptor {
        label: Some("scene-target"),
        size: wgpu::Extent3d {
            width: 1,
            height: 1,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8UnormSrgb,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT
            | wgpu::TextureUsages::COPY_SRC
            | wgpu::TextureUsages::TEXTURE_BINDING,
        view_formats: &[],
    });
    let scene_view = scene_tex.create_view(&wgpu::TextureViewDescriptor::default());
    let depth_view = create_depth_texture(&device_raw, 1, 1);
    let (blit_bgl, blit_bind) = blit_layout(&device_raw, &scene_view);

    // ---- 共享绑定组布局 ----
    // 阴影深度纹理（方向光正交投影，固定 2048²）+ 硬件 PCF 比较采样器
    let shadow_tex = device_raw.create_texture(&wgpu::TextureDescriptor {
        label: Some("shadow-map"),
        size: wgpu::Extent3d {
            width: 2048,
            height: 2048,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Depth24Plus,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
        view_formats: &[],
    });
    let shadow_view = shadow_tex.create_view(&wgpu::TextureViewDescriptor::default());
    let shadow_sampler = device_raw.create_sampler(&wgpu::SamplerDescriptor {
        label: Some("shadow.sampler"),
        compare: Some(wgpu::CompareFunction::Less),
        ..Default::default()
    });
    let bgl = device_raw.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
        label: Some("scene.bgl"),
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
            storage_entry(1),
            storage_entry(2),
            storage_entry(3),
            storage_entry(4),
            storage_entry(5),
            storage_entry(6),
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

    let make_bg = |arcs_or_rings: &wgpu::Buffer| {
        device_raw.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("scene.bg"),
            layout: &bgl,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: frame_params_buf.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: instances_buf.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: culler.visible_buffer().as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 3,
                    resource: markers_buf.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 4,
                    resource: fences_buf.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 5,
                    resource: arcs_or_rings.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 6,
                    resource: flylines.out_buffer().as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 7,
                    resource: wgpu::BindingResource::TextureView(&shadow_view),
                },
                wgpu::BindGroupEntry {
                    binding: 8,
                    resource: wgpu::BindingResource::Sampler(&shadow_sampler),
                },
            ],
        })
    };
    let bg_editor = make_bg(flylines.arcs_buffer());
    let bg_login = make_bg(&rings_buf);

    // 阴影深度 pass 的轻量绑定组：不含阴影纹理（它是该 pass 的深度附件，避免读写冲突）
    let bgl_shadow = device_raw.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
        label: Some("shadow.bgl"),
        entries: &[
            wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::VERTEX,
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
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Storage { read_only: true },
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
                count: None,
            },
        ],
    });
    let bg_shadow = device_raw.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("shadow.bg"),
        layout: &bgl_shadow,
        entries: &[
            wgpu::BindGroupEntry {
                binding: 0,
                resource: frame_params_buf.as_entire_binding(),
            },
            wgpu::BindGroupEntry {
                binding: 1,
                resource: instances_buf.as_entire_binding(),
            },
        ],
    });

    let pipelines = Pipelines::create(&device_raw, &bgl, wgpu::TextureFormat::Rgba8UnormSrgb);
    let pl_model = model_pipeline(&device_raw, &bgl);

    let terrain = crate::terrain_gpu::TerrainRenderer::new(&device_raw, &bgl);
    let mut water = crate::water_gpu::WaterRenderer::new(&device_raw, &bgl);
    water.resize(&device_raw, &depth_view, 1, 1);
    let pl_shadow = shadow_pipeline(&device_raw, &bgl_shadow);
    commands.insert_resource(DwGpu {
        device: device_raw,
        queue: queue_raw,
        frame_params_buf,
        instances_buf,
        model_indices_buf,
        model_batches: None,
        markers_buf,
        fences_buf,
        rings_buf,
        vb_ground,
        vb_grid,
        vb_box,
        vb_marker,
        grid_vert_count,
        flylines,
        culler,
        cull_cache: CullDispatchCache::default(),
        scene_tex,
        scene_view,
        depth_view,
        scene_size: (1, 1),
        preview_buf: None,
        preview_stride: 0,
        surface_format: None,
        preview_state: None,
        blit_bgl,
        blit_bind,
        pl_blit: None,
        bg_editor,
        bg_login,
        bg_shadow,
        shadow_view,
        shadow_sampler,
        pipelines,
        pl_model,
        pl_shadow,
        terrain,
        water,
        meshes: std::collections::HashMap::new(),
    });
}

/// extract：主世界 → 渲染世界（计划与上传队列），渲染世界 → 主世界（后端名）。
fn dw_extract_system(
    main_world: Res<MainWorld>,
    _main_thread: NonSendMarker,
    mut extract: ResMut<DwExtract>,
    adapter: Res<RenderAdapterInfo>,
) {
    if let Some(state) = main_world.get_non_send::<EngineStateHandle>() {
        let mut state = state.borrow_mut();
        let backend = match adapter.backend {
            wgpu::Backend::BrowserWebGpu => "GPU".to_string(),
            other => format!("{other:?}"),
        };
        if state.backend_name != backend {
            state.backend_name = backend;
        }
        extract.plan = state.plan.take();
        extract.uploads = std::mem::take(&mut state.uploads);
        extract.capture_size = state.capture_size;
        extract.no_surface = state.no_surface;
        extract.preview_state = Some(state.preview_state.clone());
    }
}

/// Upload resources independently of camera extraction, including the first frame.
fn dw_upload_system(mut gpu: ResMut<DwGpu>, mut extract: ResMut<DwExtract>) {
    let gpu: &mut DwGpu = &mut gpu;
    let uploads = std::mem::take(&mut extract.uploads);
    if let Some(waters) = uploads.waters {
        gpu.water.sync(&gpu.device, &gpu.queue, waters);
    }
    if let Some(terrains) = uploads.terrains {
        gpu.terrain.sync(&gpu.device, &gpu.queue, terrains);
    }
    for (id, cpu) in &uploads.meshes {
        if let Ok(mesh) = GpuMesh::upload(&gpu.device, cpu) {
            gpu.meshes.insert(id.clone(), mesh);
        }
    }
    if let Some(instances) = &uploads.instances {
        gpu.queue
            .write_buffer(&gpu.instances_buf, 0, bytemuck::cast_slice(instances));
    }
    for (index, instance) in &uploads.instance_updates {
        gpu.queue.write_buffer(
            &gpu.instances_buf,
            (*index * std::mem::size_of::<GInstance>()) as u64,
            bytemuck::bytes_of(instance),
        );
    }
    if let Some(markers) = &uploads.markers {
        gpu.queue
            .write_buffer(&gpu.markers_buf, 0, bytemuck::cast_slice(markers));
    }
    if let Some(fences) = &uploads.fences {
        gpu.queue
            .write_buffer(&gpu.fences_buf, 0, bytemuck::cast_slice(fences));
    }
    if let Some(rings) = &uploads.rings {
        gpu.queue
            .write_buffer(&gpu.rings_buf, 0, bytemuck::cast_slice(rings));
    }
    if let Some(arcs) = &uploads.arcs {
        gpu.flylines.upload_arcs(&gpu.queue, arcs);
    }
    if let Some(spheres) = &uploads.cull_spheres {
        gpu.culler.upload(&gpu.queue, spheres);
    }
    for sphere in &uploads.sphere_updates {
        gpu.culler.update_sphere(&gpu.queue, sphere);
    }
}

/// 场景 pass（Core3d，PostProcess 之前）：compute + 离屏场景 + blit + 读回预览。
fn dw_scene_pass(
    mut ctx: bevy::render::renderer::RenderContext,
    mut gpu: ResMut<DwGpu>,
    extract: Res<DwExtract>,
    targets: Query<(&ViewTarget, &ExtractedCamera)>,
    current_view: Res<bevy::render::renderer::CurrentView>,
) {
    let Some(plan) = extract.plan.as_ref() else {
        return;
    };
    if gpu.preview_state.is_none() {
        gpu.preview_state = extract.preview_state.clone();
    }
    let Ok((target, camera)) = targets.get(current_view.0) else {
        return;
    };
    let target_format = target.main_texture_format();
    gpu.surface_format = Some(target_format);
    let encoder = ctx.command_encoder();
    let gpu: &mut DwGpu = &mut gpu;

    if gpu
        .model_batches
        .as_ref()
        .is_none_or(|previous| !Arc::ptr_eq(previous, &plan.model_batches))
    {
        if !plan.model_batches.indices.is_empty() {
            gpu.queue.write_buffer(
                &gpu.model_indices_buf,
                0,
                bytemuck::cast_slice(&plan.model_batches.indices),
            );
        }
        gpu.model_batches = Some(plan.model_batches.clone());
    }

    // ---- 离屏目标尺寸（截图覆盖 > 窗口物理尺寸） ----
    let target_size = camera
        .physical_target_size
        .unwrap_or(bevy::math::UVec2::ONE);
    let (w, h) = extract
        .capture_size
        .unwrap_or((target_size.x, target_size.y));
    if w > 0 && h > 0 && gpu.scene_size != (w, h) {
        rebuild_scene_target(gpu, w, h);
    }

    gpu.queue
        .write_buffer(&gpu.frame_params_buf, 0, bytemuck::bytes_of(&plan.params));

    gpu.water.step(&gpu.queue, encoder, plan.dt);

    // ---- compute：飞线粒子（编辑器）+ 视锥剔除 ----
    if plan.need_flyline {
        gpu.flylines.dispatch(&gpu.queue, encoder, plan.dt);
    }
    let cull_signature = CullSignature {
        visibility_revision: plan.visibility_revision,
        planes: plan.planes,
        box_count: plan.box_count,
    };
    if plan.need_cull && gpu.cull_cache.should_dispatch(cull_signature) {
        gpu.culler.reset_indirect(&gpu.queue);
        gpu.culler.upload_params(
            &gpu.queue,
            &oxgpu::CullParams {
                planes: plan.planes,
                count: plan.box_count,
                _pad: [0; 3],
            },
        );
        gpu.culler.dispatch(encoder, plan.box_count);
    }

    // ---- 阴影深度 pass：方向光视角渲染模型实例 ----
    if plan.params.shadow[0] > 0.5 {
        let mut spass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("shadow-depth"),
            color_attachments: &[],
            depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                view: &gpu.shadow_view,
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
        spass.set_bind_group(0, &gpu.bg_shadow, &[]);
        spass.set_pipeline(&gpu.pl_shadow);
        spass.set_vertex_buffer(1, gpu.model_indices_buf.slice(..));
        for batch in &plan.model_batches.batches {
            let Some(mesh) = gpu.meshes.get(&batch.mesh_id) else {
                continue;
            };
            spass.set_vertex_buffer(0, mesh.vertices.slice(..));
            spass.draw(0..mesh.vertex_count, batch.instances.clone());
        }
    }

    // ---- 场景 pass（离屏） ----
    let water_active = plan.mode == Mode::Editor && gpu.water.has_draws();
    let bg = match plan.mode {
        Mode::Editor => &gpu.bg_editor,
        Mode::Login => &gpu.bg_login,
    };
    {
        let mut rpass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("scene"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: &gpu.scene_view,
                depth_slice: None,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                view: &gpu.depth_view,
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
        rpass.set_bind_group(0, bg, &[]);

        rpass.set_pipeline(&gpu.pipelines.sky);
        rpass.draw(0..3, 0..1);

        rpass.set_pipeline(&gpu.pipelines.ground);
        rpass.set_vertex_buffer(0, gpu.vb_ground.slice(..));
        rpass.draw(0..6, 0..1);
        if plan.mode == Mode::Editor {
            gpu.terrain.render(&mut rpass);
        }

        if plan.mode == Mode::Editor && plan.grid {
            rpass.set_pipeline(&gpu.pipelines.grid);
            rpass.set_vertex_buffer(0, gpu.vb_grid.slice(..));
            rpass.draw(0..gpu.grid_vert_count, 0..1);
        }

        if plan.box_count > 0 {
            rpass.set_pipeline(&gpu.pipelines.box_);
            rpass.set_vertex_buffer(0, gpu.vb_box.slice(..));
            rpass.draw_indirect(gpu.culler.indirect_buffer(), 0);
        }

        if !plan.model_batches.batches.is_empty() {
            rpass.set_pipeline(&gpu.pl_model);
            rpass.set_vertex_buffer(1, gpu.model_indices_buf.slice(..));
            for batch in &plan.model_batches.batches {
                let Some(mesh) = gpu.meshes.get(&batch.mesh_id) else {
                    continue;
                };
                rpass.set_vertex_buffer(0, mesh.vertices.slice(..));
                rpass.draw(0..mesh.vertex_count, batch.instances.clone());
            }
        }
        if !water_active {
            render_overlays(gpu, &mut rpass, plan);
        }
    }
    if water_active {
        gpu.water.snapshot(encoder, &gpu.scene_tex);
        let mut rpass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("water-and-overlays"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: &gpu.scene_view,
                depth_slice: None,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Load,
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                view: &gpu.depth_view,
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
        rpass.set_bind_group(0, bg, &[]);
        if plan.mode == Mode::Editor {
            gpu.water.render(
                &mut rpass,
                plan.params.cam_pos[..3].try_into().unwrap_or([0.0; 3]),
            );
        }
        render_overlays(gpu, &mut rpass, plan);
    }

    // ---- blit：离屏场景 → 窗口目标（诊断 no_surface 跳过） ----
    if !extract.no_surface {
        let attachment = target.get_unsampled_color_attachment().view.clone();
        // blit 管线按目标格式懒建（webgpu 交换链多为 bgra8unorm）
        if gpu
            .pl_blit
            .as_ref()
            .is_none_or(|(_, f)| *f != target_format)
        {
            let pl = blit_pipeline(&gpu.device, &gpu.blit_bgl, target_format);
            gpu.pl_blit = Some((pl, target_format));
        }
        {
            let mut blit_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("blit"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &attachment,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });
            if let Some((pl, _)) = &gpu.pl_blit {
                blit_pass.set_pipeline(pl);
                blit_pass.set_bind_group(0, &gpu.blit_bind, &[]);
                blit_pass.draw(0..3, 0..1);
            }
        }
    }

    // ---- 读回预览（rAF 被节流的环境；no_surface 诊断模式同样需要） ----
    issue_preview_copy(gpu, encoder);
}

fn render_overlays(gpu: &DwGpu, rpass: &mut wgpu::RenderPass<'_>, plan: &DwFramePlan) {
    if plan.marker_count > 0 {
        rpass.set_pipeline(&gpu.pipelines.marker);
        rpass.set_vertex_buffer(0, gpu.vb_marker.slice(..));
        rpass.draw(0..24, 0..plan.marker_count);
        rpass.set_pipeline(&gpu.pipelines.beam);
        rpass.draw(0..2, 0..plan.marker_count);
    }

    if plan.fence_count > 0 {
        rpass.set_pipeline(&gpu.pipelines.fence_fill);
        rpass.draw(0..6, 0..plan.fence_count);
        rpass.set_pipeline(&gpu.pipelines.fence_edge);
        rpass.draw(0..8, 0..plan.fence_count);
    }

    if plan.need_flyline {
        let arcs = gpu.flylines.active_arcs();
        rpass.set_pipeline(&gpu.pipelines.arc);
        rpass.draw(0..128, 0..arcs);
        rpass.set_pipeline(&gpu.pipelines.particle);
        rpass.draw(0..arcs * oxgpu::FlylineSim::PARTICLES_PER_ARC * 6, 0..1);
    }

    if plan.mode == Mode::Login && plan.ring_count > 0 {
        rpass.set_pipeline(&gpu.pipelines.ring_line);
        rpass.draw(0..256, 0..plan.ring_count);
        rpass.set_pipeline(&gpu.pipelines.ring_bead);
        rpass.draw(0..plan.ring_count * 14 * 6, 0..1);
    }
}

fn issue_preview_copy(gpu: &mut DwGpu, encoder: &mut wgpu::CommandEncoder) {
    let (w, h) = gpu.scene_size;
    if w == 0 || h == 0 {
        return;
    }
    let stride = gpu.preview_stride;
    let Some(buf) = gpu.preview_buf.clone() else {
        return;
    };
    let Some(preview_state) = gpu.preview_state.clone() else {
        return;
    };
    let generation = match preview_state.lock() {
        Ok(mut preview) => match preview.begin() {
            Some(generation) => generation,
            None => return,
        },
        Err(_) => return,
    };
    encoder.copy_texture_to_buffer(
        wgpu::TexelCopyTextureInfo {
            texture: &gpu.scene_tex,
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        },
        wgpu::TexelCopyBufferInfo {
            buffer: &buf,
            layout: wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(stride),
                rows_per_image: None,
            },
        },
        wgpu::Extent3d {
            width: w,
            height: h,
            depth_or_array_layers: 1,
        },
    );
    let bufc = buf.clone();
    // 离屏目标是 sRGB：非 sRGB 表面直接存线性值，读回需按同样解释。
    let linear_surface = gpu.surface_format.map_or(false, |format| !format.is_srgb());
    let state = Arc::downgrade(&preview_state);
    encoder.map_buffer_on_submit(&buf, wgpu::MapMode::Read, .., move |result| {
        let frame = match result {
            Ok(()) => {
                let frame = match bufc.get_mapped_range(..) {
                    Ok(view) => crate::preview::unpack_rows(&view, w, h, stride, linear_surface)
                        .ok_or_else(|| "截图缓冲区尺寸无效".to_owned()),
                    Err(error) => Err(format!("无法读取截图缓冲区：{error}")),
                };
                bufc.unmap();
                frame
            }
            Err(error) => Err(format!("GPU 截图读取失败：{error}")),
        };
        if let Some(state) = state.upgrade() {
            if let Ok(mut preview) = state.lock() {
                preview.finish(generation, frame);
            }
        }
    });
}

fn rebuild_scene_target(gpu: &mut DwGpu, w: u32, h: u32) {
    if let Some(preview_state) = &gpu.preview_state
        && let Ok(mut preview) = preview_state.lock()
    {
        preview.invalidate();
    }
    gpu.scene_size = (w, h);
    gpu.depth_view = create_depth_texture(&gpu.device, w, h);
    gpu.water.resize(&gpu.device, &gpu.depth_view, w, h);
    gpu.scene_tex = gpu.device.create_texture(&wgpu::TextureDescriptor {
        label: Some("scene-target"),
        size: wgpu::Extent3d {
            width: w,
            height: h,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8UnormSrgb,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT
            | wgpu::TextureUsages::COPY_SRC
            | wgpu::TextureUsages::TEXTURE_BINDING,
        view_formats: &[],
    });
    gpu.scene_view = gpu
        .scene_tex
        .create_view(&wgpu::TextureViewDescriptor::default());
    let (_, blit_bind) = blit_layout(&gpu.device, &gpu.scene_view);
    gpu.blit_bind = blit_bind;
    gpu.pl_blit = None; // 目标不变但绑定变了，管线可复用——保守重建
    let stride = (w * 4).div_ceil(256) * 256;
    gpu.preview_stride = stride;
    gpu.preview_buf = Some(gpu.device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("preview-read"),
        size: u64::from(stride) * u64::from(h),
        usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    }));
}

fn create_depth_texture(device: &wgpu::Device, w: u32, h: u32) -> wgpu::TextureView {
    device
        .create_texture(&wgpu::TextureDescriptor {
            label: Some("depth"),
            size: wgpu::Extent3d {
                width: w,
                height: h,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Depth24Plus,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        })
        .create_view(&wgpu::TextureViewDescriptor::default())
}

fn storage_entry(binding: u32) -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry {
        binding,
        visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
        ty: wgpu::BindingType::Buffer {
            ty: wgpu::BufferBindingType::Storage { read_only: true },
            has_dynamic_offset: false,
            min_binding_size: None,
        },
        count: None,
    }
}

/// blit 资源：布局 + 绑定（BindGroup 会持有采样器/纹理的强引用）。
fn blit_layout(
    device: &wgpu::Device,
    scene_view: &wgpu::TextureView,
) -> (wgpu::BindGroupLayout, wgpu::BindGroup) {
    let blit_bgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
        label: Some("blit.bgl"),
        entries: &[
            wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Texture {
                    sample_type: wgpu::TextureSampleType::Float { filterable: true },
                    view_dimension: wgpu::TextureViewDimension::D2,
                    multisampled: false,
                },
                count: None,
            },
            wgpu::BindGroupLayoutEntry {
                binding: 1,
                visibility: wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                count: None,
            },
        ],
    });
    let sampler = device.create_sampler(&wgpu::SamplerDescriptor::default());
    let blit_bind = device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("blit.bg"),
        layout: &blit_bgl,
        entries: &[
            wgpu::BindGroupEntry {
                binding: 0,
                resource: wgpu::BindingResource::TextureView(scene_view),
            },
            wgpu::BindGroupEntry {
                binding: 1,
                resource: wgpu::BindingResource::Sampler(&sampler),
            },
        ],
    });
    (blit_bgl, blit_bind)
}

fn blit_pipeline(
    device: &wgpu::Device,
    bgl: &wgpu::BindGroupLayout,
    format: wgpu::TextureFormat,
) -> wgpu::RenderPipeline {
    let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some("blit"),
        source: wgpu::ShaderSource::Wgsl(include_str!("shaders/blit.wgsl").into()),
    });
    let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
        label: Some("blit.pl"),
        bind_group_layouts: &[Some(bgl)],
        immediate_size: 0,
    });
    device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some("blit"),
        layout: Some(&layout),
        vertex: wgpu::VertexState {
            module: &module,
            entry_point: Some("vs"),
            compilation_options: Default::default(),
            buffers: &[],
        },
        fragment: Some(wgpu::FragmentState {
            module: &module,
            entry_point: Some("fs"),
            compilation_options: Default::default(),
            targets: &[Some(wgpu::ColorTargetState {
                format,
                blend: Some(wgpu::BlendState::REPLACE),
                write_mask: wgpu::ColorWrites::ALL,
            })],
        }),
        primitive: Default::default(),
        depth_stencil: None,
        multisample: Default::default(),
        multiview_mask: None,
        cache: None,
    })
}

pub(crate) struct Pipelines {
    pub sky: wgpu::RenderPipeline,
    pub ground: wgpu::RenderPipeline,
    pub grid: wgpu::RenderPipeline,
    pub box_: wgpu::RenderPipeline,
    pub marker: wgpu::RenderPipeline,
    pub beam: wgpu::RenderPipeline,
    pub fence_fill: wgpu::RenderPipeline,
    pub fence_edge: wgpu::RenderPipeline,
    pub arc: wgpu::RenderPipeline,
    pub particle: wgpu::RenderPipeline,
    pub ring_line: wgpu::RenderPipeline,
    pub ring_bead: wgpu::RenderPipeline,
}

const MESH_LAYOUT: wgpu::VertexBufferLayout = wgpu::VertexBufferLayout {
    array_stride: 24,
    step_mode: wgpu::VertexStepMode::Vertex,
    attributes: &[
        wgpu::VertexAttribute {
            format: wgpu::VertexFormat::Float32x3,
            offset: 0,
            shader_location: 0,
        },
        wgpu::VertexAttribute {
            format: wgpu::VertexFormat::Float32x3,
            offset: 12,
            shader_location: 1,
        },
    ],
};

const POS_LAYOUT: wgpu::VertexBufferLayout = wgpu::VertexBufferLayout {
    array_stride: 12,
    step_mode: wgpu::VertexStepMode::Vertex,
    attributes: &[wgpu::VertexAttribute {
        format: wgpu::VertexFormat::Float32x3,
        offset: 0,
        shader_location: 0,
    }],
};

fn make_pipeline(
    device: &wgpu::Device,
    bgl: &wgpu::BindGroupLayout,
    format: wgpu::TextureFormat,
    module: &wgpu::ShaderModule,
    vs: &str,
    fs: &str,
    topology: wgpu::PrimitiveTopology,
    layouts: &[wgpu::VertexBufferLayout],
    blend: bool,
    depth: bool,
) -> wgpu::RenderPipeline {
    let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
        label: None,
        bind_group_layouts: &[Some(bgl)],
        immediate_size: 0,
    });
    let blend_state = if blend {
        wgpu::BlendState::ALPHA_BLENDING
    } else {
        wgpu::BlendState::REPLACE
    };
    device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some(vs),
        layout: Some(&layout),
        vertex: wgpu::VertexState {
            module,
            entry_point: Some(vs),
            compilation_options: Default::default(),
            buffers: &layouts.iter().map(|l| Some(l.clone())).collect::<Vec<_>>(),
        },
        fragment: Some(wgpu::FragmentState {
            module,
            entry_point: Some(fs),
            compilation_options: Default::default(),
            targets: &[Some(wgpu::ColorTargetState {
                format,
                blend: Some(blend_state),
                write_mask: wgpu::ColorWrites::ALL,
            })],
        }),
        primitive: wgpu::PrimitiveState {
            topology,
            strip_index_format: None,
            front_face: wgpu::FrontFace::Ccw,
            cull_mode: None,
            polygon_mode: wgpu::PolygonMode::Fill,
            unclipped_depth: false,
            conservative: false,
        },
        depth_stencil: Some(wgpu::DepthStencilState {
            format: wgpu::TextureFormat::Depth24Plus,
            depth_write_enabled: Some(depth),
            depth_compare: Some(wgpu::CompareFunction::Less),
            stencil: Default::default(),
            bias: Default::default(),
        }),
        multisample: Default::default(),
        multiview_mask: None,
        cache: None,
    })
}

/// 阴影深度管线：光源视角渲染模型实例，仅写深度（无片元输出）。
/// 绑定组用轻量布局（uniform + 实例 storage），不含阴影纹理本身，避免同 pass 读写冲突。
pub(crate) fn shadow_pipeline(
    device: &wgpu::Device,
    layout: &wgpu::BindGroupLayout,
) -> wgpu::RenderPipeline {
    let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some("shadow-depth"),
        source: wgpu::ShaderSource::Wgsl(include_str!("shaders/shadow.wgsl").into()),
    });
    let vertices = wgpu::VertexBufferLayout {
        array_stride: 36,
        step_mode: wgpu::VertexStepMode::Vertex,
        attributes: &wgpu::vertex_attr_array![0 => Float32x3],
    };
    let instances = wgpu::VertexBufferLayout {
        array_stride: std::mem::size_of::<u32>() as u64,
        step_mode: wgpu::VertexStepMode::Instance,
        attributes: &wgpu::vertex_attr_array![3 => Uint32],
    };
    let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
        label: Some("shadow.pl"),
        bind_group_layouts: &[Some(layout)],
        immediate_size: 0,
    });
    device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some("shadow"),
        layout: Some(&layout),
        vertex: wgpu::VertexState {
            module: &shader,
            entry_point: Some("vs"),
            compilation_options: Default::default(),
            buffers: &[Some(vertices), Some(instances)],
        },
        fragment: None,
        primitive: wgpu::PrimitiveState {
            topology: wgpu::PrimitiveTopology::TriangleList,
            strip_index_format: None,
            front_face: wgpu::FrontFace::Ccw,
            cull_mode: None,
            polygon_mode: wgpu::PolygonMode::Fill,
            unclipped_depth: false,
            conservative: false,
        },
        depth_stencil: Some(wgpu::DepthStencilState {
            format: wgpu::TextureFormat::Depth24Plus,
            depth_write_enabled: Some(true),
            depth_compare: Some(wgpu::CompareFunction::Less),
            stencil: Default::default(),
            bias: wgpu::DepthBiasState {
                constant: 2,
                slope_scale: 2.0,
                clamp: 0.0,
            },
        }),
        multisample: Default::default(),
        multiview_mask: None,
        cache: None,
    })
}

pub(crate) fn model_pipeline(
    device: &wgpu::Device,
    layout: &wgpu::BindGroupLayout,
) -> wgpu::RenderPipeline {
    let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some("reference-model"),
        source: wgpu::ShaderSource::Wgsl(include_str!("shaders/model.wgsl").into()),
    });
    let vertices = wgpu::VertexBufferLayout {
        array_stride: 36,
        step_mode: wgpu::VertexStepMode::Vertex,
        attributes: &wgpu::vertex_attr_array![0 => Float32x3, 1 => Float32x3, 2 => Float32x3],
    };
    let instances = wgpu::VertexBufferLayout {
        array_stride: std::mem::size_of::<u32>() as u64,
        step_mode: wgpu::VertexStepMode::Instance,
        attributes: &wgpu::vertex_attr_array![3 => Uint32],
    };
    make_pipeline(
        device,
        layout,
        wgpu::TextureFormat::Rgba8UnormSrgb,
        &shader,
        "vs",
        "fs",
        wgpu::PrimitiveTopology::TriangleList,
        &[vertices, instances],
        false,
        true,
    )
}

impl Pipelines {
    pub fn create(
        device: &wgpu::Device,
        bgl: &wgpu::BindGroupLayout,
        format: wgpu::TextureFormat,
    ) -> Self {
        let sky_mod = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("sky"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shaders/sky.wgsl").into()),
        });
        let ground_mod = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("ground"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shaders/ground.wgsl").into()),
        });
        let grid_mod = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("grid"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shaders/grid.wgsl").into()),
        });
        let box_mod = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("box"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shaders/box.wgsl").into()),
        });
        let marker_mod = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("marker"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shaders/marker.wgsl").into()),
        });
        let fence_mod = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("fence"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shaders/fence.wgsl").into()),
        });
        let arc_mod = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("arc"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shaders/arc.wgsl").into()),
        });
        let particle_mod = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("particle"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shaders/particle.wgsl").into()),
        });
        let ring_mod = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("ring"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shaders/ring.wgsl").into()),
        });

        let mk = |module: &wgpu::ShaderModule, vs, fs, topo, layouts, blend, depth| {
            make_pipeline(
                device, bgl, format, module, vs, fs, topo, layouts, blend, depth,
            )
        };

        // 天空：深度 Always + 不写（最远，不受深度影响）
        let sky = {
            let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("sky.pl"),
                bind_group_layouts: &[Some(bgl)],
                immediate_size: 0,
            });
            device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some("sky"),
                layout: Some(&layout),
                vertex: wgpu::VertexState {
                    module: &sky_mod,
                    entry_point: Some("vs"),
                    compilation_options: Default::default(),
                    buffers: &[],
                },
                fragment: Some(wgpu::FragmentState {
                    module: &sky_mod,
                    entry_point: Some("fs"),
                    compilation_options: Default::default(),
                    targets: &[Some(wgpu::ColorTargetState {
                        format,
                        blend: Some(wgpu::BlendState::REPLACE),
                        write_mask: wgpu::ColorWrites::ALL,
                    })],
                }),
                primitive: Default::default(),
                depth_stencil: Some(wgpu::DepthStencilState {
                    format: wgpu::TextureFormat::Depth24Plus,
                    depth_write_enabled: Some(false),
                    depth_compare: Some(wgpu::CompareFunction::Always),
                    stencil: Default::default(),
                    bias: Default::default(),
                }),
                multisample: Default::default(),
                multiview_mask: None,
                cache: None,
            })
        };

        let ground = mk(
            &ground_mod,
            "vs",
            "fs",
            wgpu::PrimitiveTopology::TriangleList,
            &[POS_LAYOUT],
            false,
            true,
        );
        let grid = mk(
            &grid_mod,
            "vs",
            "fs",
            wgpu::PrimitiveTopology::LineList,
            &[POS_LAYOUT],
            true,
            false,
        );
        let box_ = mk(
            &box_mod,
            "vs_mesh",
            "fs",
            wgpu::PrimitiveTopology::TriangleList,
            &[MESH_LAYOUT],
            false,
            true,
        );
        let marker = mk(
            &marker_mod,
            "vs_solid",
            "fs",
            wgpu::PrimitiveTopology::TriangleList,
            &[MESH_LAYOUT],
            false,
            true,
        );
        let beam = mk(
            &marker_mod,
            "vs_beam",
            "fs",
            wgpu::PrimitiveTopology::LineList,
            &[],
            true,
            false,
        );
        let fence_fill = mk(
            &fence_mod,
            "vs_fill",
            "fs",
            wgpu::PrimitiveTopology::TriangleList,
            &[],
            true,
            false,
        );
        let fence_edge = mk(
            &fence_mod,
            "vs_edge",
            "fs",
            wgpu::PrimitiveTopology::LineList,
            &[],
            true,
            false,
        );
        let arc = mk(
            &arc_mod,
            "vs",
            "fs",
            wgpu::PrimitiveTopology::LineList,
            &[],
            true,
            false,
        );
        let particle = mk(
            &particle_mod,
            "vs",
            "fs",
            wgpu::PrimitiveTopology::TriangleList,
            &[],
            true,
            false,
        );
        let ring_line = mk(
            &ring_mod,
            "vs_line",
            "fs",
            wgpu::PrimitiveTopology::LineList,
            &[],
            true,
            false,
        );
        let ring_bead = mk(
            &ring_mod,
            "vs_bead",
            "fs",
            wgpu::PrimitiveTopology::TriangleList,
            &[],
            true,
            false,
        );

        Self {
            sky,
            ground,
            grid,
            box_,
            marker,
            beam,
            fence_fill,
            fence_edge,
            arc,
            particle,
            ring_line,
            ring_bead,
        }
    }
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod tests {
    use super::*;
    use bevy::camera::RenderTarget;
    use bevy::core_pipeline::{Core3d, CorePipelinePlugin, oit::resolve::OitResolveBindGroup};
    use bevy::render::{RenderPlugin, camera::CameraRenderGraph, view::Msaa};
    use bevy::window::{ExitCondition, WindowPlugin};

    #[test]
    #[ignore = "requires a native GPU adapter"]
    fn oit_bind_group_preparation_tracks_camera_lifecycle() {
        fn frame(app: &mut App) {
            app.update();
            app.world()
                .resource::<RenderDevice>()
                .wgpu_device()
                .poll(wgpu::PollType::Wait {
                    submission_index: None,
                    timeout: Some(std::time::Duration::from_secs(10)),
                })
                .expect("GPU frame completes");
        }

        let mut app = App::new();
        app.add_plugins(MinimalPlugins)
            .add_plugins(bevy::a11y::AccessibilityPlugin::default())
            .add_plugins(bevy::asset::AssetPlugin::default())
            .add_plugins(bevy::image::ImagePlugin::default())
            .add_plugins(bevy::mesh::MeshPlugin::default())
            .add_plugins(bevy::camera::CameraPlugin::default())
            .add_plugins(bevy::input::InputPlugin::default())
            .add_plugins(bevy::transform::TransformPlugin::default())
            .add_plugins(WindowPlugin {
                primary_window: None,
                exit_condition: ExitCondition::DontExit,
                ..default()
            })
            .add_plugins(RenderPlugin {
                synchronous_pipeline_compilation: true,
                ..default()
            })
            .add_plugins(CorePipelinePlugin)
            .insert_resource(bevy_egui::EguiGlobalSettings {
                auto_create_primary_context: false,
                ..default()
            })
            .add_plugins(bevy_egui::EguiPlugin::default())
            .add_plugins(crate::app::DwEnginePlugin);
        let image = Image::new_target_texture(64, 64, wgpu::TextureFormat::Rgba8UnormSrgb, None);
        let target = app.world_mut().resource_mut::<Assets<Image>>().add(image);
        let camera = app
            .world_mut()
            .spawn((
                Camera {
                    clear_color: bevy::camera::ClearColorConfig::None,
                    ..default()
                },
                bevy::camera::Projection::Perspective(default()),
                CameraRenderGraph::new(Core3d),
                RenderTarget::Image(target.into()),
                Transform::default(),
                Visibility::default(),
                Msaa::Off,
                bevy_egui::EguiContext::default(),
                bevy_egui::PrimaryEguiContext,
                crate::app::DwViewport(1),
            ))
            .id();
        app.finish();
        app.cleanup();
        for _ in 0..3 {
            frame(&mut app);
        }
        assert!(crate::app::read_state(|state| state.time).is_some());
        let render = app.get_sub_app(RenderApp).expect("render app");
        assert!(render.world().contains_resource::<OitResolvePipeline>());
        assert!(!render.world().contains_resource::<OitResolveBindGroup>());

        app.world_mut()
            .entity_mut(camera)
            .insert(OrderIndependentTransparencySettings::default());
        for _ in 0..2 {
            frame(&mut app);
        }
        let active = app
            .get_sub_app(RenderApp)
            .expect("render app")
            .world()
            .resource::<OitResolveBindGroup>()
            .id();
        app.world_mut()
            .entity_mut(camera)
            .remove::<OrderIndependentTransparencySettings>();
        frame(&mut app);
        let released = app
            .get_sub_app(RenderApp)
            .expect("render app")
            .world()
            .resource::<OitResolveBindGroup>()
            .id();
        assert_ne!(
            active, released,
            "replace bindings to the released OIT buffers"
        );
        for _ in 0..2 {
            frame(&mut app);
            let current = app
                .get_sub_app(RenderApp)
                .expect("render app")
                .world()
                .resource::<OitResolveBindGroup>()
                .id();
            assert_eq!(
                current, released,
                "idle frames reuse the released-buffer bindings"
            );
        }
        app.world_mut().clear_all();
        assert!(crate::app::read_state(|_| panic!("closed state is inaccessible")).is_none());
        assert!(crate::app::with_state(|_| panic!("closed state rejects writes")).is_none());
        crate::app::with_world(|_| panic!("closed World rejects structural changes"));
    }
}
