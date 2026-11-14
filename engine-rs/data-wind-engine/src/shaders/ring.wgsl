// 登录页轨道环：三条彩色环绕轨道（线）+ 头部亮珠与渐隐尾迹（公告板）

struct FrameParams {
    vp: mat4x4<f32>, view: mat4x4<f32>, proj: mat4x4<f32>,
    cam_pos: vec4<f32>, misc: vec4<f32>, misc2: vec4<f32>,
    background: vec4<f32>, ground: vec4<f32>,
    light: vec4<f32>, light_color: vec4<f32>,
    light_vp: mat4x4<f32>, shadow: vec4<f32>,
};

struct Ring {
    center: vec4<f32>,
    color_radius: vec4<f32>,
};

@group(0) @binding(0) var<uniform> frame: FrameParams;
@group(0) @binding(5) var<storage, read> rings: array<Ring>;

const SEGMENTS: u32 = 128u;
const BEADS_PER_RING: u32 = 14u;

fn rot_y(a: f32) -> mat3x3<f32> {
    let c = cos(a);
    let s = sin(a);
    return mat3x3<f32>(vec3<f32>(c, 0.0, -s), vec3<f32>(0.0, 1.0, 0.0), vec3<f32>(s, 0.0, c));
}

fn tilt_rot(i: u32) -> mat3x3<f32> {
    var a = 0.0;
    var b = 0.0;
    if (i == 0u) { a = 0.55; b = 0.0; }
    if (i == 1u) { a = -0.35; b = 0.5; }
    if (i == 2u) { a = 0.15; b = -0.85; }
    let ca = cos(a);
    let sa = sin(a);
    let cb = cos(b);
    let sb = sin(b);
    let rx = mat3x3<f32>(vec3<f32>(1.0, 0.0, 0.0), vec3<f32>(0.0, ca, sa), vec3<f32>(0.0, -sa, ca));
    let rz = mat3x3<f32>(vec3<f32>(cb, sb, 0.0), vec3<f32>(-sb, cb, 0.0), vec3<f32>(0.0, 0.0, 1.0));
    return rz * rx;
}

fn orbit_point(ring: Ring, idx: u32, angle: f32) -> vec3<f32> {
    let local = vec3<f32>(cos(angle), 0.0, sin(angle)) * ring.color_radius.w;
    let spin = rot_y(frame.misc.x * ring.center.w + f32(idx) * 2.09);
    return ring.center.xyz + spin * (tilt_rot(idx) * local);
}

struct VsOut {
    @builtin(position) clip: vec4<f32>,
    @location(0) color: vec4<f32>,
    @location(1) uv: vec2<f32>,
};

@vertex
fn vs_line(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VsOut {
    let seg = vi / 2u;
    let end = f32(vi % 2u);
    let angle = ((f32(seg) + end) / f32(SEGMENTS)) * 6.28318;
    let ring = rings[ii];
    let p = orbit_point(ring, ii, angle);
    var out: VsOut;
    out.clip = frame.vp * vec4<f32>(p, 1.0);
    out.color = vec4<f32>(ring.color_radius.rgb, 0.6);
    out.uv = vec2<f32>(0.0);
    return out;
}

@vertex
fn vs_bead(@builtin(vertex_index) vi: u32) -> VsOut {
    let bi = vi / 6u;
    let ci = vi % 6u;
    let ring_idx = bi / BEADS_PER_RING;
    let bead = bi % BEADS_PER_RING;
    let ring = rings[ring_idx];
    let angle = -f32(bead) * 0.075;
    let p = orbit_point(ring, ring_idx, angle);
    let k = 1.0 - f32(bead) / f32(BEADS_PER_RING);
    let size = ring.color_radius.w * 0.05 * k;
    var corners = array<vec2<f32>, 6>(
        vec2<f32>(-0.5, -0.5), vec2<f32>(0.5, -0.5), vec2<f32>(-0.5, 0.5),
        vec2<f32>(-0.5, 0.5), vec2<f32>(0.5, -0.5), vec2<f32>(0.5, 0.5),
    );
    let view_pos = (frame.view * vec4<f32>(p, 1.0)).xyz + vec3<f32>(corners[ci] * size, 0.0);
    var out: VsOut;
    out.clip = frame.proj * vec4<f32>(view_pos, 1.0);
    out.color = vec4<f32>(ring.color_radius.rgb, k * 0.95);
    out.uv = corners[ci] * 2.0;
    return out;
}

@fragment
fn fs(in: VsOut) -> @location(0) vec4<f32> {
    let r = length(in.uv);
    if (r > 0.01) {
        let disc = smoothstep(1.0, 0.5, r);
        return vec4<f32>(in.color.rgb, in.color.a * disc);
    }
    return in.color;
}
