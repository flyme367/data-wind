// 视锥剔除：包围球 vs 六平面
// 命中的实例索引原子写入 visible，同时 atomicAdd 累计 instance_count，
// 该计数器位于 draw indirect 参数缓冲内，渲染管线直接以 draw_indirect 消费。

struct BoundingSphere {
    center: vec3<f32>,
    radius: f32,
    index: u32,
    _pad0: u32,
    _pad1: u32,
    _pad2: u32,
};

struct Params {
    planes: array<vec4<f32>, 6>,
    count: u32,
    _p0: u32,
    _p1: u32,
    _p2: u32,
};

struct IndirectArgs {
    vertex_count: u32,
    instance_count: atomic<u32>,
    first_vertex: u32,
    first_instance: u32,
};

@group(0) @binding(0) var<storage, read> spheres: array<BoundingSphere>;
@group(0) @binding(1) var<storage, read> params: Params;
@group(0) @binding(2) var<storage, read_write> visible: array<u32>;
@group(0) @binding(3) var<storage, read_write> indirect: IndirectArgs;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= params.count) {
        return;
    }
    let s = spheres[i];
    var is_visible = true;
    for (var k = 0u; k < 6u; k = k + 1u) {
        let plane = params.planes[k];
        if (dot(plane.xyz, s.center) + plane.w < -s.radius) {
            is_visible = false;
        }
    }
    if (is_visible) {
        let slot = atomicAdd(&indirect.instance_count, 1u);
        visible[slot] = s.index;
    }
}
