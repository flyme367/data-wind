/* tslint:disable */
/* eslint-disable */

/**
 * 引擎侧看板 wasm facade：GPU 可用时 JS 装载本模块（CPU 回退用 data-wind-cpu 的同名类）。
 */
export class BoardCanvas {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    activate(id: string): void;
    clear_image(id: string): void;
    static create(canvas: HTMLCanvasElement, _gpu: boolean): Promise<BoardCanvas>;
    focus_node(id?: string | null): void;
    /**
     * bevy 自驱渲染；本调用只更新 JS 供给的看板时钟，返回空缓冲（GPU 约定）。
     */
    frame(_width: number, _height: number, clock: Uint8Array): Uint8Array;
    /**
     * 命中测试结果，HitResult 缓冲；空缓冲表示无命中。
     */
    hit_test(x: number, y: number): Uint8Array;
    is_gpu(): boolean;
    pointer(action: string, x: number, y: number): void;
    /**
     * CommandRequest(GeoJsonDocument)。
     */
    set_geojson(bytes: Uint8Array): void;
    set_image(id: string, width: number, height: number, rgba: Uint8Array): void;
    set_status(id: string, message: string): void;
    /**
     * CommandRequest(SetValue)。
     */
    set_value(bytes: Uint8Array): void;
    /**
     * Capture retains live control values and media textures, and excludes editor selection handles.
     * CPU 栅格化（PNG 导出）：不依赖 bevy 上下文。
     */
    snapshot(width: number, height: number, clock: Uint8Array): Uint8Array;
    /**
     * CommandRequest(BoardSync)。
     */
    sync_scene(bytes: Uint8Array): void;
    /**
     * 排空交互事件，size-prefixed CommandResponse(DWCR) 缓冲；无事件返回零字节。
     */
    take_events(): Uint8Array;
}

export class Engine {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    camera_state(): Float32Array;
    /**
     * Set a saved orbit view without recreating the GPU resources.
     */
    camera_view(x: number, y: number, z: number, yaw: number, pitch: number, dist: number): void;
    static create(canvas: HTMLCanvasElement): Promise<Engine>;
    /**
     * bevy 自驱渲染；保留空实现以兼容 JS 调用点。
     */
    frame(_time_ms: number): void;
    pointer_down(x: number, y: number, button: number, editable: boolean): void;
    pointer_move(x: number, y: number): void;
    pointer_up(x: number, y: number, button: number): void;
    /**
     * Project a screen coordinate onto a horizontal plane in world space.
     */
    position_on_plane(x: number, y: number, height: number): Float32Array;
    /**
     * Register a prepared model once; instances reference its stable catalog identifier.
     */
    register_mesh(id: string, bytes: Uint8Array): void;
    reset_camera(): void;
    resize(width: number, height: number, dpr: number): void;
    /**
     * World to CSS pixels for the editing handles.
     */
    screen_position(x: number, y: number, z: number): Float32Array;
    /**
     * Change only the offscreen scene target, leaving the visible surface alone.
     * Passing (0, 0) restores the ordinary surface-sized target.
     */
    set_capture_size(width: number, height: number): void;
    /**
     * CommandRequest(SetEnvironment)；daylight/fogDistance 以 0 表示缺省。
     */
    set_environment(bytes: Uint8Array): void;
    /**
     * CommandRequest(SetHud)：布尔字段总是显式写入，整体替换状态。
     */
    set_hud(bytes: Uint8Array): void;
    set_lighting(x: number, y: number, z: number, r: number, g: number, b: number, intensity: number): void;
    /**
     * CommandRequest(SetMode)
     */
    set_mode(bytes: Uint8Array): void;
    /**
     * 开启/关闭读回预览（rAF 被节流的环境使用）
     */
    set_preview(on: boolean): void;
    set_selection(id?: string | null): void;
    /**
     * CommandRequest(SetSelections)。
     */
    set_selections(bytes: Uint8Array): void;
    set_spin(spin: boolean): void;
    /**
     * 同步场景（CommandRequest(SceneUpdate)）。
     */
    sync_scene(bytes: Uint8Array): void;
    /**
     * 取回最近一帧预览像素（RGBA8，紧凑行，alpha 强制 255）；无新帧返回空
     */
    take_preview(): Uint8Array;
    take_preview_error(): string | undefined;
    /**
     * 返回宽、高的小端 u32 与紧凑 RGBA 像素，避免窗口改变尺寸后误读旧帧。
     */
    take_preview_frame(): Uint8Array;
    /**
     * Drain an owned, size-prefixed CommandResponse (DWCR v1); no events return zero bytes.
     */
    take_response(): Uint8Array;
    wheel(dy: number): void;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_boardcanvas_free: (a: number, b: number) => void;
    readonly __wbg_engine_free: (a: number, b: number) => void;
    readonly boardcanvas_activate: (a: number, b: number, c: number) => void;
    readonly boardcanvas_clear_image: (a: number, b: number, c: number) => void;
    readonly boardcanvas_create: (a: any, b: number) => any;
    readonly boardcanvas_focus_node: (a: number, b: number, c: number) => void;
    readonly boardcanvas_frame: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly boardcanvas_hit_test: (a: number, b: number, c: number) => [number, number, number, number];
    readonly boardcanvas_is_gpu: (a: number) => number;
    readonly boardcanvas_pointer: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly boardcanvas_set_geojson: (a: number, b: number, c: number) => [number, number];
    readonly boardcanvas_set_image: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number];
    readonly boardcanvas_set_status: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly boardcanvas_set_value: (a: number, b: number, c: number) => [number, number];
    readonly boardcanvas_snapshot: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly boardcanvas_sync_scene: (a: number, b: number, c: number) => [number, number];
    readonly boardcanvas_take_events: (a: number) => [number, number, number, number];
    readonly engine_camera_state: (a: number) => [number, number];
    readonly engine_camera_view: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly engine_create: (a: any) => any;
    readonly engine_frame: (a: number, b: number) => void;
    readonly engine_pointer_down: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly engine_pointer_move: (a: number, b: number, c: number) => void;
    readonly engine_pointer_up: (a: number, b: number, c: number, d: number) => void;
    readonly engine_position_on_plane: (a: number, b: number, c: number, d: number) => [number, number];
    readonly engine_register_mesh: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly engine_reset_camera: (a: number) => void;
    readonly engine_resize: (a: number, b: number, c: number, d: number) => void;
    readonly engine_screen_position: (a: number, b: number, c: number, d: number) => [number, number];
    readonly engine_set_capture_size: (a: number, b: number, c: number) => [number, number];
    readonly engine_set_environment: (a: number, b: number, c: number) => void;
    readonly engine_set_hud: (a: number, b: number, c: number) => void;
    readonly engine_set_lighting: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly engine_set_mode: (a: number, b: number, c: number) => void;
    readonly engine_set_preview: (a: number, b: number) => void;
    readonly engine_set_selection: (a: number, b: number, c: number) => void;
    readonly engine_set_selections: (a: number, b: number, c: number) => void;
    readonly engine_set_spin: (a: number, b: number) => void;
    readonly engine_sync_scene: (a: number, b: number, c: number) => void;
    readonly engine_take_preview: (a: number) => [number, number];
    readonly engine_take_preview_error: (a: number) => [number, number];
    readonly engine_take_preview_frame: (a: number) => [number, number];
    readonly engine_take_response: (a: number) => [number, number];
    readonly engine_wheel: (a: number, b: number) => void;
    readonly wasm_bindgen_6f9eda2aba22c759___convert__closures_____invoke___js_sys_4629e871625f3a0d___Array__web_sys_48c4c47005bf834f___features__gen_ResizeObserver__ResizeObserver______true_: (a: number, b: number, c: any, d: any) => void;
    readonly wasm_bindgen_6f9eda2aba22c759___convert__closures_____invoke___js_sys_4629e871625f3a0d___Function_fn_wasm_bindgen_6f9eda2aba22c759___JsValue_____wasm_bindgen_6f9eda2aba22c759___sys__Undefined___js_sys_4629e871625f3a0d___Function_fn_wasm_bindgen_6f9eda2aba22c759___JsValue_____wasm_bindgen_6f9eda2aba22c759___sys__Undefined_______true_: (a: number, b: number, c: any, d: any) => void;
    readonly wasm_bindgen_6f9eda2aba22c759___convert__closures_____invoke___wasm_bindgen_6f9eda2aba22c759___JsValue__core_37ee0ce0c4cd57d5___result__Result_____wasm_bindgen_6f9eda2aba22c759___JsError___true_: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_6f9eda2aba22c759___convert__closures_____invoke___wasm_bindgen_6f9eda2aba22c759___sys__JsNullable_wgpu_f39877233a8bfa16___backend__webgpu__webgpu_sys__gen_GpuError__GpuError___core_37ee0ce0c4cd57d5___result__Result_____wasm_bindgen_6f9eda2aba22c759___JsError___true_: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_6f9eda2aba22c759___convert__closures_____invoke___wasm_bindgen_6f9eda2aba22c759___sys__JsNullable_wgpu_f39877233a8bfa16___backend__webgpu__webgpu_sys__gen_GpuError__GpuError___core_37ee0ce0c4cd57d5___result__Result_____wasm_bindgen_6f9eda2aba22c759___JsError___true__61: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_6f9eda2aba22c759___convert__closures_____invoke___wasm_bindgen_6f9eda2aba22c759___sys__JsNullable_wgpu_f39877233a8bfa16___backend__webgpu__webgpu_sys__gen_GpuError__GpuError___core_37ee0ce0c4cd57d5___result__Result_____wasm_bindgen_6f9eda2aba22c759___JsError___true__62: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_6f9eda2aba22c759___convert__closures_____invoke___wasm_bindgen_6f9eda2aba22c759___JsValue______true_: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen_6f9eda2aba22c759___convert__closures_____invoke___wasm_bindgen_6f9eda2aba22c759___JsValue______true__1_: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen_6f9eda2aba22c759___convert__closures_____invoke___wasm_bindgen_6f9eda2aba22c759___JsValue______true__47: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen_6f9eda2aba22c759___convert__closures_____invoke___wasm_bindgen_6f9eda2aba22c759___JsValue______true__50: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen_6f9eda2aba22c759___convert__closures_____invoke___wasm_bindgen_6f9eda2aba22c759___JsValue______true__51: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen_6f9eda2aba22c759___convert__closures_____invoke___wasm_bindgen_6f9eda2aba22c759___JsValue______true__56: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen_6f9eda2aba22c759___convert__closures_____invoke___wasm_bindgen_6f9eda2aba22c759___JsValue______true__57: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen_6f9eda2aba22c759___convert__closures_____invoke___wasm_bindgen_6f9eda2aba22c759___JsValue______true__58: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen_6f9eda2aba22c759___convert__closures_____invoke___wasm_bindgen_6f9eda2aba22c759___JsValue______true__60: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen_6f9eda2aba22c759___convert__closures_____invoke___web_sys_48c4c47005bf834f___features__gen_InputEvent__InputEvent______true_: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen_6f9eda2aba22c759___convert__closures_____invoke___web_sys_48c4c47005bf834f___features__gen_InputEvent__InputEvent______true__49: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen_6f9eda2aba22c759___convert__closures_____invoke___web_sys_48c4c47005bf834f___features__gen_InputEvent__InputEvent______true__55: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen_6f9eda2aba22c759___convert__closures_____invoke___web_sys_48c4c47005bf834f___features__gen_InputEvent__InputEvent______true__59: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen_6f9eda2aba22c759___convert__closures_____invoke___wgpu_f39877233a8bfa16___backend__webgpu__webgpu_sys__gen_GpuDeviceLostInfo__GpuDeviceLostInfo______true_: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen_6f9eda2aba22c759___convert__closures_____invoke___wgpu_f39877233a8bfa16___backend__webgpu__webgpu_sys__gen_GpuDeviceLostInfo__GpuDeviceLostInfo______true__54: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen_6f9eda2aba22c759___convert__closures_____invoke_______true_: (a: number, b: number) => void;
    readonly wasm_bindgen_6f9eda2aba22c759___convert__closures_____invoke_______true__1_: (a: number, b: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_destroy_closure: (a: number, b: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
