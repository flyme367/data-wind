/* tslint:disable */
/* eslint-disable */

export class BoardCanvas {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    activate(id: string): void;
    clear_image(id: string): void;
    static create(_canvas: HTMLCanvasElement, _gpu: boolean): Promise<BoardCanvas>;
    focus_node(id?: string | null): void;
    /**
     * Readable embedded attribution, also distributed as assets/OFL.txt in the source tree.
     */
    static font_license(): string;
    /**
     * CommandRequest(BoardClock)。GPU draws return an empty buffer. CPU draws return an 8-byte size header followed by RGBA.
     */
    frame(width: number, height: number, clock: Uint8Array): Uint8Array;
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
     */
    snapshot(width: number, height: number, clock: Uint8Array): Uint8Array;
    /**
     * 组件类型目录，StringList 缓冲。
     */
    static supported_kinds(): Uint8Array;
    /**
     * CommandRequest(BoardSync)。
     */
    sync_scene(bytes: Uint8Array): void;
    /**
     * 排空交互事件，size-prefixed CommandResponse(DWCR) 缓冲；无事件返回零字节。
     */
    take_events(): Uint8Array;
}

export class SoftwareCanvas {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * CommandRequest(SoftwareFrame)。
     */
    frame(width: number, height: number, bytes: Uint8Array, snapshot: boolean): Uint8Array;
    constructor();
    pick(x: number, y: number): string | undefined;
    register_mesh(id: string, bytes: Uint8Array): void;
    register_model_asset(id: string, bytes: Uint8Array): void;
    set_model_materials(id: string, settings: string): void;
    set_model_texture(id: number, width: number, height: number, rgba: Uint8Array): void;
}

/**
 * Number of workers available to CPU rendering (one in the portable Wasm build).
 */
export function cpu_threads(): number;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_boardcanvas_free: (a: number, b: number) => void;
    readonly __wbg_softwarecanvas_free: (a: number, b: number) => void;
    readonly boardcanvas_activate: (a: number, b: number, c: number) => void;
    readonly boardcanvas_clear_image: (a: number, b: number, c: number) => void;
    readonly boardcanvas_create: (a: any, b: number) => any;
    readonly boardcanvas_focus_node: (a: number, b: number, c: number) => void;
    readonly boardcanvas_font_license: () => [number, number];
    readonly boardcanvas_frame: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly boardcanvas_hit_test: (a: number, b: number, c: number) => [number, number, number, number];
    readonly boardcanvas_is_gpu: (a: number) => number;
    readonly boardcanvas_pointer: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly boardcanvas_set_geojson: (a: number, b: number, c: number) => [number, number];
    readonly boardcanvas_set_image: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number];
    readonly boardcanvas_set_status: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly boardcanvas_set_value: (a: number, b: number, c: number) => [number, number];
    readonly boardcanvas_snapshot: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly boardcanvas_supported_kinds: () => [number, number];
    readonly boardcanvas_sync_scene: (a: number, b: number, c: number) => [number, number];
    readonly boardcanvas_take_events: (a: number) => [number, number, number, number];
    readonly cpu_threads: () => number;
    readonly softwarecanvas_frame: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly softwarecanvas_new: () => number;
    readonly softwarecanvas_pick: (a: number, b: number, c: number) => [number, number];
    readonly softwarecanvas_register_mesh: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly softwarecanvas_register_model_asset: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly softwarecanvas_set_model_materials: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly softwarecanvas_set_model_texture: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly wasm_bindgen_97e3ec4eedd7d697___convert__closures_____invoke___js_sys_aeca768adab08f58___Function_fn_wasm_bindgen_97e3ec4eedd7d697___JsValue_____wasm_bindgen_97e3ec4eedd7d697___sys__Undefined___js_sys_aeca768adab08f58___Function_fn_wasm_bindgen_97e3ec4eedd7d697___JsValue_____wasm_bindgen_97e3ec4eedd7d697___sys__Undefined_______true_: (a: number, b: number, c: any, d: any) => void;
    readonly wasm_bindgen_97e3ec4eedd7d697___convert__closures_____invoke___wasm_bindgen_97e3ec4eedd7d697___JsValue__core_37ee0ce0c4cd57d5___result__Result_____wasm_bindgen_97e3ec4eedd7d697___JsError___true_: (a: number, b: number, c: any) => [number, number];
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
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
