// 飞线粒子：oxgpu compute 结果（storage buffer）经视空间公告板展开渲染

struct FrameParams {
    vp: mat4x4<f32>, view: mat4x4<f32>, proj: mat4x4<f32>,
    cam_pos: vec4<f32>, misc: vec4<f32>, misc2: vec4<f32>,
    background: vec4<f32>, ground: vec4<f32>,
    light: vec4<f32>, light_color: vec4<f32>,
    light_vp: mat4x4<f32>, shadow: vec4<f32>,
};

struct ParticleOut {
    pos_t: vec4<f32>,
    color_size: vec4<f32>,
};

@group(0) @binding(0) var<uniform> frame: FrameParams;
@group(0) @binding(6) var<storage, read> outs: array<ParticleOut>;

struct VsOut {
    @builtin(position) clip: vec4<f32>,
    @location(0) color: vec3<f32>,
    @location(1) uv: vec2<f32>,
    @location(2) t: f32,
};

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
    let pi = vi / 6u;
    let ci = vi % 6u;
    var corners = array<vec2<f32>, 6>(
        vec2<f32>(-0.5, -0.5), vec2<f32>(0.5, -0.5), vec2<f32>(-0.5, 0.5),
        vec2<f32>(-0.5, 0.5), vec2<f32>(0.5, -0.5), vec2<f32>(0.5, 0.5),
    );
    let o = corners[ci];
    let data = outs[pi];
    let p = data.pos_t.xyz;
    let t = data.pos_t.w;
    let size = data.color_size.w * (0.8 + 0.9 * t);
    let view_pos = (frame.view * vec4<f32>(p, 1.0)).xyz + vec3<f32>(o * size, 0.0);
    var out: VsOut;
    out.clip = frame.proj * vec4<f32>(view_pos, 1.0);
    out.color = data.color_size.rgb;
    out.uv = o * 2.0;
    out.t = t;
    return out;
}

@fragment
fn fs(in: VsOut) -> @location(0) vec4<f32> {
    let r = length(in.uv);
    let disc = 1.0 - smoothstep(0.55, 1.0, r);
    let fade = 0.15 + 0.85 * sin(3.14159265 * in.t);
    let col = mix(in.color, vec3<f32>(1.0, 1.0, 1.0), (1.0 - r) * 0.35);
    return vec4<f32>(col, disc * fade);
}
