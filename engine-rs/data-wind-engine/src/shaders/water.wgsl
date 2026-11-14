struct FrameParams {
    vp: mat4x4<f32>, view: mat4x4<f32>, proj: mat4x4<f32>, cam_pos: vec4<f32>,
    misc: vec4<f32>, misc2: vec4<f32>, background: vec4<f32>, ground: vec4<f32>,
    light: vec4<f32>, light_color: vec4<f32>, light_vp: mat4x4<f32>, shadow: vec4<f32>,
};
struct GInstance { center_rot: vec4<f32>, half_sel: vec4<f32>, color: vec4<f32>, rotation: vec4<f32> };
struct WaterUniforms {
    info: vec4<u32>, waves: vec4<f32>, optics: vec4<f32>, refraction: vec4<f32>,
    scattering: vec4<f32>, shape: vec4<f32>, simulation: vec4<f32>,
    points: array<vec4<f32>, 32>, sources: array<vec4<f32>, 8>,
};
@group(0) @binding(0) var<uniform> frame: FrameParams;
@group(0) @binding(1) var<storage, read> instances: array<GInstance>;
@group(1) @binding(0) var<uniform> water: WaterUniforms;
@group(1) @binding(1) var<storage, read> cells: array<vec4<f32>>;
@group(2) @binding(0) var scene_color: texture_2d<f32>;
@group(2) @binding(1) var color_sampler: sampler;
@group(2) @binding(2) var scene_depth: texture_2d<f32>;
fn rotate(q: vec4<f32>, v: vec3<f32>) -> vec3<f32> { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
fn srgb(v: vec3<f32>) -> vec3<f32> {
    return select(v / 12.92, pow((v + 0.055) / 1.055, vec3(2.4)), v > vec3(0.04045));
}
fn wave(p: vec2<f32>, time: f32) -> f32 {
    let direction = vec2(cos(water.waves.w), sin(water.waves.w));
    let phase = dot(p, direction) * 6.2831853 / water.waves.y - time * water.waves.z * 1.6;
    return water.waves.x * (0.6 * sin(phase) + 0.28 * sin(phase * 1.73 + 1.8)
        + 0.12 * sin(phase * 3.1 - time * water.waves.z * 0.7));
}
fn wave_gradient(p: vec2<f32>, time: f32) -> vec2<f32> {
    let direction = vec2(cos(water.waves.w), sin(water.waves.w));
    let frequency = 6.2831853 / water.waves.y;
    let phase = dot(p, direction) * frequency - time * water.waves.z * 1.6;
    let slope = water.waves.x * frequency * (0.6 * cos(phase)
        + 0.4844 * cos(phase * 1.73 + 1.8)
        + 0.372 * cos(phase * 3.1 - time * water.waves.z * 0.7));
    return direction * slope;
}
fn cell_at(uv: vec2<f32>) -> vec4<f32> {
    let p = clamp(uv, vec2(0.0), vec2(1.0)) * 63.0;
    let a = vec2<u32>(p); let b = min(a + 1u, vec2<u32>(63u));
    return mix(mix(cells[a.y * 64u + a.x], cells[a.y * 64u + b.x], fract(p.x)),
        mix(cells[b.y * 64u + a.x], cells[b.y * 64u + b.x], fract(p.x)), fract(p.y));
}
struct Out {
    @builtin(position) clip: vec4<f32>, @location(0) world: vec3<f32>,
    @location(1) uv: vec2<f32>, @location(2) wet: f32, @location(3) flow: vec2<f32>,
};
@vertex fn vs(@location(0) uv: vec2<f32>) -> Out {
    let inst = instances[water.info.x];
    var xz = (uv - 0.5) * inst.half_sel.xz * 2.0;
    if water.info.y == 3u {
        var i = 1u;
        for (var j = 1u; j < water.info.z; j++) { i = j; if uv.y <= water.points[j].z { break; } }
        let a = water.points[i - 1u]; let b = water.points[i];
        let t = clamp((uv.y - a.z) / max(b.z - a.z, 0.0001), 0.0, 1.0);
        let segment = (b.xy - a.xy) * inst.half_sel.xz * 2.0;
        let tangent = segment / max(length(segment), 0.0001);
        xz = mix(a.xy, b.xy, t) * inst.half_sel.xz * 2.0
            + vec2(tangent.y, -tangent.x) * (uv.x - 0.5) * water.shape.x * min(inst.half_sel.x, inst.half_sel.z) * 2.0;
    }
    xz = clamp(xz, -inst.half_sel.xz, inst.half_sel.xz);
    var height = 0.0; var wet = 1.0; var velocity = vec2(0.0);
    if water.info.y == 4u { let cell = cell_at(uv); height = cell.x + cell.y; wet = cell.x; velocity = cell.zw; }
    let t = frame.misc.x;
    let displacement = wave(xz, t) * inst.half_sel.y * min(wet, 1.0);
    let local = vec3(xz.x, height + displacement, xz.y);
    let world = rotate(inst.rotation, local) + inst.center_rot.xyz;
    var out: Out; out.clip = frame.vp * vec4(world, 1.0); out.world = world;
    out.uv = uv; out.wet = wet; out.flow = velocity; return out;
}
fn linear_depth(depth: f32) -> f32 { return abs(frame.proj[3][2] / min(depth + frame.proj[2][2], -0.000001)); }
@fragment fn fs(in: Out) -> @location(0) vec4<f32> {
    if water.info.y == 1u && length(in.uv - 0.5) > 0.5 { discard; }
    if water.info.y == 4u && in.wet < 0.002 { discard; }
    if water.optics.x < 0.0001 { discard; }
    let inst = instances[water.info.x];
    let up = rotate(inst.rotation, vec3(0.0, 1.0, 0.0));
    let scale = max(length(dpdx(in.world)), length(dpdy(in.world)));
    let local = rotate(vec4(-inst.rotation.xyz, inst.rotation.w), in.world - inst.center_rot.xyz);
    let phase_time = frame.misc.x;
    let gradient = wave_gradient(local.xz, phase_time) * inst.half_sel.y
        * (1.0 - smoothstep(0.25, 1.0, scale / water.waves.y));
    var normal = rotate(inst.rotation, normalize(vec3(-gradient.x, 1.0, -gradient.y)));
    if water.info.y == 4u {
        normal = normalize(cross(dpdy(in.world), dpdx(in.world)));
        normal *= select(-1.0, 1.0, dot(normal, up) >= 0.0);
    }
    // Fine ripples use a derivative-limited amplitude so distant water remains stable.
    let ripple = (1.0 - smoothstep(0.1, 2.0, scale)) * min(water.waves.x, 0.15);
    let time = frame.misc.x * water.waves.z;
    let flow_uv = in.uv * vec2(36.0, 72.0) - vec2(0.0, time * 2.0);
    normal = normalize(normal + rotate(inst.rotation, vec3(
        cos(in.world.x * 2.2 + in.world.z * 1.1 - time * 1.3), 0.0,
        sin(in.world.z * 2.7 - time + in.world.x * 0.6))) * ripple);
    let dims = vec2<f32>(textureDimensions(scene_color));
    let uv = in.clip.xy / dims;
    let pixel = vec2<i32>(clamp(in.clip.xy, vec2(0.0), dims - 1.0));
    let background_z = textureLoad(scene_depth, pixel, 0).r;
    let depth = max(0.0, linear_depth(background_z) - linear_depth(in.clip.z));
    let view_normal = (frame.view * vec4(normal, 0.0)).xyz;
    let offset = vec2(view_normal.x, -view_normal.y) * min(depth, 2.0) * 0.012;
    var refracted_uv = clamp(uv + offset, vec2(0.001), vec2(0.999));
    let refracted_z = textureLoad(scene_depth, vec2<i32>(refracted_uv * (dims - 1.0)), 0).r;
    if refracted_z < in.clip.z { refracted_uv = uv; }
    let behind = textureSampleLevel(scene_color, color_sampler, refracted_uv, 0.0).rgb;
    let attenuation = exp(-depth / water.optics.y * vec3(2.1, 1.2, 0.65));
    let tint = srgb(inst.color.rgb);
    let scattering = mix(srgb(water.scattering.rgb), tint, 0.4);
    let transmission = behind * mix(vec3(1.0), srgb(water.refraction.rgb), 0.45);
    var color = transmission * attenuation + scattering * (1.0 - attenuation);
    let eye = normalize(frame.cam_pos.xyz - in.world);
    let fresnel = 0.02 + 0.98 * pow(1.0 - clamp(abs(dot(normal, eye)), 0.0, 1.0), 5.0);
    let reflected = reflect(-eye, normal);
    let sky = mix(srgb(frame.background.rgb) * 0.7, vec3(0.42, 0.65, 0.83), clamp(reflected.y * 0.5 + 0.5, 0.0, 1.0));
    let light = normalize(frame.light.xyz);
    let halfway = normalize(eye + light);
    let specular = pow(max(0.0, dot(normal, halfway)), mix(220.0, 8.0, water.optics.z))
        * (1.0 - water.optics.z * 0.8);
    color = mix(color, sky, fresnel * (1.0 - water.optics.z * 0.4))
        + specular * frame.light_color.rgb * frame.light_color.w * frame.misc2.z;
    let shore = (1.0 - smoothstep(0.0, 0.55, depth)) * smoothstep(0.0, 0.035, depth);
    let crest = smoothstep(0.1, 0.5, 1.0 - abs(dot(normal, up)));
    let streak = 0.5 + 0.5 * sin(flow_uv.y + sin(flow_uv.x) * 2.0);
    let foam = clamp(water.optics.w * (shore * (0.5 + streak * 0.5) + crest
        + select(0.0, streak * 0.15, water.info.y == 3u)
        + min(length(in.flow) * 0.02, 0.2)), 0.0, 0.8);
    color = mix(color, vec3(0.85, 0.94, 0.97), foam);
    let fog = smoothstep(frame.misc.z, frame.misc.w, distance(in.world, frame.cam_pos.xyz));
    color = mix(color, srgb(frame.background.rgb), fog);
    if abs(frame.misc2.x - inst.half_sel.w) < 0.1 || inst.half_sel.w < 0.0 {
        color = mix(color, vec3(0.12, 0.48, 0.9), 0.12);
    }
    return vec4(color, water.optics.x);
}
