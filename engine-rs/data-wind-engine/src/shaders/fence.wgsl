// 电子围栏：半透明填充 + 发光边缘线

struct FrameParams {
    vp: mat4x4<f32>, view: mat4x4<f32>, proj: mat4x4<f32>,
    cam_pos: vec4<f32>, misc: vec4<f32>, misc2: vec4<f32>,
    background: vec4<f32>, ground: vec4<f32>,
    light: vec4<f32>, light_color: vec4<f32>,
    light_vp: mat4x4<f32>, shadow: vec4<f32>,
};

struct Fence {
    center: vec4<f32>,
    half: vec4<f32>,
    color: vec4<f32>,
};

@group(0) @binding(0) var<uniform> frame: FrameParams;
@group(0) @binding(4) var<storage, read> fences: array<Fence>;

fn corner(ci: u32) -> vec2<f32> {
    var table = array<vec2<f32>, 4>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>(1.0, -1.0),
        vec2<f32>(1.0, 1.0),
        vec2<f32>(-1.0, 1.0),
    );
    return table[ci];
}

struct VsOut {
    @builtin(position) clip: vec4<f32>,
    @location(0) color: vec4<f32>,
};

@vertex
fn vs_fill(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VsOut {
    let f = fences[ii];
    let q = vi % 6u;
    let ci = select(q, q - 2u, q >= 3u);
    let c2 = corner(ci);
    let p = vec3<f32>(f.center.x + c2.x * f.half.x, 0.06, f.center.z + c2.y * f.half.y);
    let alpha = 0.10 + 0.05 * sin(frame.misc.x * 2.0 + f.center.w);
    var out: VsOut;
    out.clip = frame.vp * vec4<f32>(p, 1.0);
    out.color = vec4<f32>(f.color.rgb, alpha);
    return out;
}

@vertex
fn vs_edge(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VsOut {
    let f = fences[ii];
    let e = vi / 2u;
    let e2 = vi % 2u;
    let ci = (e + e2) % 4u;
    let c2 = corner(ci);
    let p = vec3<f32>(f.center.x + c2.x * f.half.x, 0.08, f.center.z + c2.y * f.half.y);
    var out: VsOut;
    out.clip = frame.vp * vec4<f32>(p, 1.0);
    out.color = vec4<f32>(f.color.rgb, 0.85);
    return out;
}

@fragment
fn fs(in: VsOut) -> @location(0) vec4<f32> {
    return in.color;
}
