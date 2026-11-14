@group(0) @binding(0) var scene_depth: texture_depth_2d;
@group(0) @binding(1) var depth_copy: texture_storage_2d<r32float, write>;
@compute @workgroup_size(8, 8)
fn copy_depth(@builtin(global_invocation_id) gid: vec3<u32>) {
    if any(gid.xy >= textureDimensions(depth_copy)) { return; }
    textureStore(depth_copy, vec2<i32>(gid.xy), vec4(textureLoad(scene_depth, vec2<i32>(gid.xy), 0)));
}
