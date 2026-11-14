// 标记点：八面体钻石（实体）+ 垂直光柱（线），共享 Marker storage

struct FrameParams {
    vp: mat4x4<f32>, view: mat4x4<f32>, proj: mat4x4<f32>,
    cam_pos: vec4<f32>, misc: vec4<f32>, misc2: vec4<f32>,
    background: vec4<f32>, ground: vec4<f32>,
    light: vec4<f32>, light_color: vec4<f32>,
    light_vp: mat4x4<f32>, shadow: vec4<f32>,
};

struct Marker {
    pos_phase: vec4<f32>,
    color: vec4<f32>,
};

@group(0) @binding(0) var<uniform> frame: FrameParams;
@group(0) @binding(3) var<storage, read> markers: array<Marker>;

struct VsOut {
    @builtin(position) clip: vec4<f32>,
    @location(0) normal: vec3<f32>,
    @location(1) color: vec3<f32>,
};

@vertex
fn vs_solid(
    @location(0) v_pos: vec3<f32>,
    @location(1) v_normal: vec3<f32>,
    @builtin(instance_index) ii: u32,
) -> VsOut {
    let m = markers[ii];
    let bob = sin(frame.misc.x * 2.0 + m.pos_phase.w) * 0.12;
    let world = m.pos_phase.xyz + vec3<f32>(0.0, bob, 0.0) + v_pos * 0.6;
    var out: VsOut;
    out.clip = frame.vp * vec4<f32>(world, 1.0);
    out.normal = v_normal;
    out.color = m.color.rgb;
    return out;
}

@vertex
fn vs_beam(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VsOut {
    let m = markers[ii];
    let ground = vec3<f32>(m.pos_phase.x, 0.05, m.pos_phase.z);
    let p = select(m.pos_phase.xyz, ground, vi == 0u);
    var out: VsOut;
    out.clip = frame.vp * vec4<f32>(p, 1.0);
    out.normal = vec3<f32>(0.0);
    out.color = m.color.rgb;
    return out;
}

@fragment
fn fs(in: VsOut) -> @location(0) vec4<f32> {
    if (dot(in.normal, in.normal) < 0.001) {
        return vec4<f32>(in.color, 0.4);
    }
    let l = normalize(vec3<f32>(0.45, 0.85, 0.35));
    let nd = max(dot(normalize(in.normal), l), 0.0);
    let col = in.color * (0.45 + 0.55 * nd) + in.color * 0.5;
    return vec4<f32>(col, 1.0);
}
