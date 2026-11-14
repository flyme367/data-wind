// Static geometry clipmaps. Adjacent rings share the finer snapped inner origin;
// edge vertices collapse onto the parent lattice before sampling the height field.
struct FrameParams {
    vp: mat4x4<f32>, view: mat4x4<f32>, proj: mat4x4<f32>,
    cam_pos: vec4<f32>, misc: vec4<f32>, misc2: vec4<f32>,
    background: vec4<f32>, ground: vec4<f32>,
    light: vec4<f32>, light_color: vec4<f32>,
    light_vp: mat4x4<f32>, shadow: vec4<f32>,
};
struct GInstance {
    center_rot: vec4<f32>, half_sel: vec4<f32>,
    color: vec4<f32>, rotation: vec4<f32>,
};
struct TerrainUniforms {
    info: vec4<u32>, material: vec4<f32>, rock: vec4<f32>, snow: vec4<f32>,
};
@group(0) @binding(0) var<uniform> frame: FrameParams;
@group(0) @binding(1) var<storage, read> instances: array<GInstance>;
@group(0) @binding(7) var shadow_tex: texture_depth_2d;
@group(0) @binding(8) var shadow_sampler: sampler_comparison;
@group(1) @binding(0) var<uniform> terrain: TerrainUniforms;
@group(1) @binding(1) var heightmap: texture_2d<f32>;

fn rotate(q: vec4<f32>, v: vec3<f32>) -> vec3<f32> {
    return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
}

fn height_at(uv: vec2<f32>) -> f32 {
    let last = i32(terrain.info.z) - 1;
    let p = clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0)) * f32(last);
    let a = vec2<i32>(floor(p));
    let b = min(a + vec2<i32>(1), vec2<i32>(last));
    let f = fract(p);
    return mix(mix(textureLoad(heightmap, a, 0).r,
                   textureLoad(heightmap, vec2<i32>(b.x, a.y), 0).r, f.x),
               mix(textureLoad(heightmap, vec2<i32>(a.x, b.y), 0).r,
                   textureLoad(heightmap, b, 0).r, f.x), f.y);
}

// Whole-terrain frustum rejection is evaluated on GPU before any texture fetch.
fn outside_view(center: vec3<f32>, radius: f32) -> bool {
    let m = transpose(frame.vp);
    let planes = array<vec4<f32>, 6>(m[3] + m[0], m[3] - m[0],
        m[3] + m[1], m[3] - m[1], m[2], m[3] - m[2]);
    for (var i = 0u; i < 6u; i++) {
        let plane = planes[i];
        if (dot(plane, vec4<f32>(center, 1.0)) < -radius * length(plane.xyz)) { return true; }
    }
    return false;
}

struct Output {
    @builtin(position) clip: vec4<f32>,
    @location(0) world: vec3<f32>,
    @location(1) local: vec3<f32>,
};

@vertex fn vs(@location(0) vertex: vec2<f32>, @builtin(instance_index) level: u32) -> Output {
    let inst = instances[terrain.info.x];
    let size = max(abs(inst.half_sel.xyz * 2.0), vec3<f32>(0.001));
    var out: Output;
    out.clip = vec4<f32>(2.0, 2.0, 2.0, 1.0);
    out.world = vec3<f32>(0.0);
    out.local = vec3<f32>(0.0);
    if (outside_view(inst.center_rot.xyz, length(size) * 0.5)) { return out; }
    let inverse = vec4<f32>(-inst.rotation.xyz, inst.rotation.w);
    let camera = rotate(inverse, frame.cam_pos.xyz - inst.center_rot.xyz).xz;
    let anchor = clamp(camera, -size.xz * 0.5, size.xz * 0.5);
    let base = max(size.x, size.z) / (32.0 * exp2(f32(terrain.info.y - 1u)));
    let spacing = base * exp2(f32(level));
    let center = floor(anchor / (spacing * 2.0)) * (spacing * 2.0);
    var xz = center + vertex * spacing;
    if (level > 0u) {
        let previous = floor(anchor / spacing) * spacing;
        let radial = max(abs(vertex.x), abs(vertex.y));
        xz += (previous - center) * clamp((24.0 - radial) / 8.0, 0.0, 1.0);
    }
    let distance_to_anchor = max(abs(xz.x - anchor.x), abs(xz.y - anchor.y));
    let morph = smoothstep(24.0 * spacing, 30.0 * spacing, distance_to_anchor);
    let parent = floor(xz / (spacing * 2.0) + vec2<f32>(0.5)) * (spacing * 2.0);
    xz = mix(xz, parent, morph);
    xz = clamp(xz, -size.xz * 0.5, size.xz * 0.5);
    let uv = xz / size.xz + vec2<f32>(0.5);
    let h = height_at(uv);
    let local = vec3<f32>(xz.x, (h - 0.5) * size.y, xz.y);
    let world = inst.center_rot.xyz + rotate(inst.rotation, local);
    out.clip = frame.vp * vec4<f32>(world, 1.0);
    out.world = world;
    out.local = vec3<f32>(uv.x, h, uv.y);
    return out;
}

@fragment fn fs(input: Output) -> @location(0) vec4<f32> {
    let inst = instances[terrain.info.x];
    var normal = normalize(cross(dpdy(input.world), dpdx(input.world)));
    let up = rotate(inst.rotation, vec3<f32>(0.0, 1.0, 0.0));
    normal = select(-normal, normal, dot(normal, up) >= 0.0);
    let slope = 1.0 - max(dot(normal, up), 0.0);
    let rock = smoothstep(0.18, 0.55, slope);
    let snow = smoothstep(terrain.material.y, terrain.material.y + 0.08, input.local.y)
        * (1.0 - smoothstep(0.35, 0.65, slope));
    var color = mix(inst.color.rgb, terrain.rock.rgb, rock);
    color = mix(color, terrain.snow.rgb, snow);
    // Band-limit procedural surface detail using derivatives, avoiding distant shimmer.
    let uv = input.local.xz * terrain.material.x;
    let footprint = max(length(dpdx(uv)), length(dpdy(uv)));
    let detail = sin(uv.x * 6.283) * sin(uv.y * 6.283);
    color *= 0.94 + 0.06 * detail * (1.0 - smoothstep(0.15, 0.6, footprint));
    let diffuse = max(dot(normal, normalize(frame.light.xyz)), 0.0);
    var shadow = 1.0;
    if (frame.shadow.x > 0.5) {
        let projected = frame.light_vp * vec4<f32>(input.world, 1.0);
        let light_pos = projected.xyz / projected.w;
        let shadow_uv = light_pos.xy * vec2<f32>(0.5, -0.5) + vec2<f32>(0.5);
        let depth = light_pos.z - frame.shadow.y;
        if (all(shadow_uv > vec2<f32>(0.001)) && all(shadow_uv < vec2<f32>(0.999)) && depth > 0.0) {
            shadow = textureSampleCompareLevel(shadow_tex, shadow_sampler, shadow_uv, depth);
        }
    }
    color *= frame.light_color.rgb * (0.18 + frame.misc2.z * 0.37
        + diffuse * shadow * frame.misc2.z * frame.light.w * 0.6);
    if (inst.half_sel.w < -0.5 || abs(inst.half_sel.w - frame.misc2.x) < 0.5) {
        color = mix(color, vec3<f32>(0.25, 0.65, 1.0), 0.15);
    }
    let fog = smoothstep(frame.misc.z, frame.misc.w, distance(input.world, frame.cam_pos.xyz));
    return vec4<f32>(mix(color, frame.background.rgb, fog), 1.0);
}
