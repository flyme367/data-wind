// 盒体实例渲染：实例数据与可见索引均来自 storage buffer（间接绘制）。
// 顶点阶段读取 visible[instance_index] → instances[idx]，实现 GPU 视锥剔除。

struct FrameParams {
    vp: mat4x4<f32>, view: mat4x4<f32>, proj: mat4x4<f32>,
    cam_pos: vec4<f32>, misc: vec4<f32>, misc2: vec4<f32>,
    background: vec4<f32>, ground: vec4<f32>,
    light: vec4<f32>, light_color: vec4<f32>,
    light_vp: mat4x4<f32>, shadow: vec4<f32>,
};

struct GInstance {
    center_rot: vec4<f32>,
    half_sel: vec4<f32>,
    color: vec4<f32>,
    rotation: vec4<f32>,
};

@group(0) @binding(0) var<uniform> frame: FrameParams;
@group(0) @binding(1) var<storage, read> instances: array<GInstance>;
@group(0) @binding(2) var<storage, read> visible: array<u32>;

struct VsOut {
    @builtin(position) clip: vec4<f32>,
    @location(0) world: vec3<f32>,
    @location(1) normal: vec3<f32>,
    @location(2) color: vec3<f32>,
    @location(3) sel: f32,
};

@vertex
fn vs_mesh(
    @location(0) v_pos: vec3<f32>,
    @location(1) v_normal: vec3<f32>,
    @builtin(instance_index) ii: u32,
) -> VsOut {
    let idx = visible[ii];
    let inst = instances[idx];
    let c = inst.center_rot.xyz;
    let rot = inst.center_rot.w;
    let half3 = inst.half_sel.xyz;
    let cr = cos(rot);
    let sr = sin(rot);
    let rotm = mat3x3<f32>(vec3<f32>(cr, 0.0, -sr), vec3<f32>(0.0, 1.0, 0.0), vec3<f32>(sr, 0.0, cr));
    let world = c + rotate_quat(inst.rotation, v_pos * half3 * 2.0);
    var out: VsOut;
    out.clip = frame.vp * vec4<f32>(world, 1.0);
    if (inst.color.w < 0.5) { out.clip = vec4<f32>(2.0,2.0,2.0,1.0); }
    out.world = world;
    out.normal = rotate_quat(inst.rotation, v_normal);
    out.color = inst.color.rgb;
    out.sel = inst.half_sel.w;
    return out;
}

fn fog_color() -> vec3<f32> {
    if (frame.misc.y < 0.5) {
        return frame.background.rgb;
    }
    return vec3<f32>(0.945, 0.948, 0.962);
}

@fragment
fn fs(in: VsOut) -> @location(0) vec4<f32> {
    let l = normalize(frame.light.xyz);
    let nd = max(dot(normalize(in.normal), l), 0.0);
    var col = in.color * frame.light_color.rgb * (0.18 + frame.misc2.z * 0.24 + frame.misc2.z * frame.light.w * 0.72 * nd);
    if (in.sel < -0.5 || (frame.misc2.x > 0.5 && abs(in.sel - frame.misc2.x) < 0.5)) {
        let pulse = 0.5 + 0.5 * sin(frame.misc.x * 4.0);
        col = mix(col, vec3<f32>(1.0, 1.0, 1.0), 0.22 + 0.18 * pulse);
    }
    let d = distance(in.world, frame.cam_pos.xyz);
    let f = smoothstep(frame.misc.z, frame.misc.w, d);
    return vec4<f32>(mix(col, fog_color(), f), 1.0);
}

fn rotate_quat(q: vec4<f32>, v: vec3<f32>) -> vec3<f32> { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
