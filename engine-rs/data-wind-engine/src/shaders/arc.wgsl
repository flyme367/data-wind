// 飞线弧线：二次贝塞尔折线（storage buffer 中的 Arc 数据）

struct FrameParams {
    vp: mat4x4<f32>, view: mat4x4<f32>, proj: mat4x4<f32>,
    cam_pos: vec4<f32>, misc: vec4<f32>, misc2: vec4<f32>,
    background: vec4<f32>, ground: vec4<f32>,
    light: vec4<f32>, light_color: vec4<f32>,
    light_vp: mat4x4<f32>, shadow: vec4<f32>,
};

struct Arc {
    a: vec3<f32>,
    b: vec3<f32>,
    c: vec3<f32>,
    color: vec4<f32>,
    count: u32,
    _pad0: u32,
    _pad1: u32,
    _pad2: u32,
};

@group(0) @binding(0) var<uniform> frame: FrameParams;
@group(0) @binding(5) var<storage, read> arcs: array<Arc>;

const SEGMENTS: u32 = 64u;

struct VsOut {
    @builtin(position) clip: vec4<f32>,
    @location(0) color: vec4<f32>,
};

fn bezier(a: vec3<f32>, b: vec3<f32>, c: vec3<f32>, t: f32) -> vec3<f32> {
    let u = 1.0 - t;
    return u * u * a + 2.0 * u * t * b + t * t * c;
}

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VsOut {
    let seg = vi / 2u;
    let end = f32(vi % 2u);
    let t = (f32(seg) + end) / f32(SEGMENTS);
    let arc = arcs[ii];
    let p = bezier(arc.a, arc.b, arc.c, t);
    var out: VsOut;
    out.clip = frame.vp * vec4<f32>(p, 1.0);
    out.color = vec4<f32>(arc.color.rgb, 0.75);
    return out;
}

@fragment
fn fs(in: VsOut) -> @location(0) vec4<f32> {
    return in.color;
}
