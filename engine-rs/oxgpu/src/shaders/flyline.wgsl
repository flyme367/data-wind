// 飞线粒子模拟：二次贝塞尔曲线上的粒子推进
// 输入 arcs（只读 storage），推进 particles（读写 storage），
// 结果写 out（读写 storage），渲染管线顶点阶段直接读取。

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

struct Particle {
    arc: u32,
    t: f32,
    speed: f32,
    _pad: f32,
};

struct Out {
    pos_t: vec4<f32>,
    color_size: vec4<f32>,
};

struct Params {
    dt: f32,
    count: u32,
    _p0: f32,
    _p1: f32,
};

@group(0) @binding(0) var<storage, read> arcs: array<Arc>;
@group(0) @binding(1) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(2) var<storage, read_write> out: array<Out>;
@group(0) @binding(3) var<uniform> params: Params;

fn bezier(a: vec3<f32>, b: vec3<f32>, c: vec3<f32>, t: f32) -> vec3<f32> {
    let u = 1.0 - t;
    return u * u * a + 2.0 * u * t * b + t * t * c;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= params.count) {
        return;
    }
    var p = particles[i];
    let arc = arcs[p.arc];
    p.t = fract(p.t + p.speed * params.dt);
    let q = bezier(arc.a, arc.b, arc.c, p.t);
    out[i].pos_t = vec4<f32>(q, p.t);
    out[i].color_size = vec4<f32>(arc.color.rgb, 0.6);
    particles[i] = p;
}
