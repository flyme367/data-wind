struct FrameParams {
    vp: mat4x4<f32>, view: mat4x4<f32>, proj: mat4x4<f32>,
    cam_pos: vec4<f32>, misc: vec4<f32>, misc2: vec4<f32>,
    background: vec4<f32>, ground: vec4<f32>,
    light: vec4<f32>, light_color: vec4<f32>,
    light_vp: mat4x4<f32>, shadow: vec4<f32>,
};
struct GInstance { center_rot: vec4<f32>, half_sel: vec4<f32>, color: vec4<f32>, rotation: vec4<f32> };
@group(0) @binding(0) var<uniform> frame: FrameParams;
@group(0) @binding(1) var<storage, read> instances: array<GInstance>;
@group(0) @binding(7) var shadow_tex: texture_depth_2d;
@group(0) @binding(8) var shadow_sampler: sampler_comparison;
struct Output {
    @builtin(position) clip: vec4<f32>,
    @location(0) world: vec3<f32>, @location(1) normal: vec3<f32>,
    @location(2) color: vec3<f32>, @location(3) selection: f32,
    @location(4) light_pos: vec3<f32>,
};
@vertex fn vs(
    @location(0) position: vec3<f32>, @location(1) normal: vec3<f32>,
    @location(2) color: vec3<f32>, @location(3) index: u32,
) -> Output {
    let instance = instances[index];
    let angle = instance.center_rot.w;
    let c = cos(angle); let s = sin(angle);
    let rotation = mat3x3<f32>(vec3<f32>(c,0.0,-s),vec3<f32>(0.0,1.0,0.0),vec3<f32>(s,0.0,c));
    let size = max(abs(instance.half_sel.xyz * 2.0), vec3<f32>(0.001));
    let world = instance.center_rot.xyz + rotate_quat(instance.rotation, position * size);
    var output: Output;
    output.clip = frame.vp * vec4<f32>(world,1.0);
    output.world = world;
    output.normal = normalize(rotate_quat(instance.rotation, normal / size));
    output.color = color * instance.color.rgb;
    output.selection = instance.half_sel.w;
    let light_pos = frame.light_vp * vec4<f32>(world,1.0);
    output.light_pos = light_pos.xyz / light_pos.w;
    return output;
}
@fragment fn fs(input: Output) -> @location(0) vec4<f32> {
    let light = normalize(frame.light.xyz);
    let diffuse = max(dot(normalize(input.normal),light),0.0);
    // 阴影：光源空间深度对比（comparison sampler 硬件 PCF）
    var shadow = 1.0;
    if (frame.shadow.x > 0.5) {
        let uv = input.light_pos.xy * vec2<f32>(0.5,-0.5) + vec2<f32>(0.5,0.5);
        let ref_depth = input.light_pos.z - frame.shadow.y;
        if (all(uv > vec2<f32>(0.004)) && all(uv < vec2<f32>(0.996)) && ref_depth > 0.0) {
            // 3×3 软化核（半径 frame.shadow.z，单位 texel）
            let texel = frame.shadow.z / 2048.0;
            var sum = 0.0;
            for (var dy = -1; dy <= 1; dy++) {
                for (var dx = -1; dx <= 1; dx++) {
                    sum += textureSampleCompareLevel(shadow_tex, shadow_sampler,
                        uv + vec2<f32>(f32(dx), f32(dy)) * texel, ref_depth);
                }
            }
            shadow = sum / 9.0;
        }
    }
    var color = input.color * frame.light_color.rgb * (0.18 + frame.misc2.z * 0.37 + diffuse * shadow * frame.misc2.z * frame.light.w * 0.6);
    if (input.selection < -0.5 || (frame.misc2.x > 0.5 && abs(input.selection-frame.misc2.x)<0.5)) {
        color = mix(color,vec3<f32>(0.25,0.65,1.0),0.15);
    }
    let fog = smoothstep(frame.misc.z,frame.misc.w,distance(input.world,frame.cam_pos.xyz));
    return vec4<f32>(mix(color,frame.background.rgb,fog),1.0);
}

fn rotate_quat(q: vec4<f32>, v: vec3<f32>) -> vec3<f32> { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
