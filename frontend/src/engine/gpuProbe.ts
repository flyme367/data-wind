/** 探测 WebGPU 是否真正可用（劣化的 GPU 进程会静默丢弃 draw，需读回验证） */
async function timeout<T>(promise: Promise<T>, stage: string, milliseconds = 5000): Promise<T> {
  let timer = 0;
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      timer = window.setTimeout(() => reject(new Error(`WebGPU ${stage} timed out`)), milliseconds);
    })]);
  } finally { window.clearTimeout(timer); }
}

let probing: Promise<boolean> | null = null;
export function probeWebGPU(): Promise<boolean> {
  probing ??= runProbe().finally(() => { probing = null; });
  return probing;
}

async function runProbe(): Promise<boolean> {
  // 调试/验证开关：强制走 CPU 兼容渲染路径（渲染 Worker 验证、WebGPU 误判排查）
  try { if (localStorage.getItem("dw_disable_webgpu") === "1") return false; } catch { /* 隐私模式等 */ }
  let device: GPUDevice | undefined;
  let texture: GPUTexture | undefined;
  let buffer: GPUBuffer | undefined;
  try {
    if (!navigator.gpu) return false;
    // 冷启动时 requestAdapter 要等 GPU 进程拉起，本机实测可挂数秒（Chrome/Intel Mac）；
    // 5s 超时会误判成不可用、整站回退 CPU 软渲，故 adapter 放宽到 15s、device 10s。
    const adapter = await timeout(navigator.gpu.requestAdapter(), "adapter request", 15_000);
    if (!adapter) return false;
    device = await timeout(adapter.requestDevice(), "device request", 10_000);
    const tex = texture = device.createTexture({
      size: { width: 64, height: 64 },
      format: "bgra8unorm",
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    const readBuf = buffer = device.createBuffer({
      size: 256,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const module = device.createShaderModule({
      code: `
        @vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
          var p = array<vec2<f32>, 3>(vec2(0.0, -0.8), vec2(0.8, 0.8), vec2(-0.8, 0.8));
          return vec4<f32>(p[i], 0.0, 1.0);
        }
        @fragment fn fs() -> @location(0) vec4<f32> { return vec4<f32>(1.0, 0.2, 0.2, 1.0); }
      `,
    });
    const pipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: { module, entryPoint: "vs" },
      fragment: {
        module,
        entryPoint: "fs",
        targets: [{ format: "bgra8unorm" }],
      },
    });
    const enc = device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [
        {
          view: tex.createView(),
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 1, a: 1 },
        },
      ],
    });
    pass.setPipeline(pipeline);
    pass.draw(3);
    pass.end();
    enc.copyTextureToBuffer(
      { texture: tex, origin: { x: 32, y: 32 } },
      { buffer: readBuf, bytesPerRow: 256 },
      { width: 1, height: 1 },
    );
    device.queue.submit([enc.finish()]);
    await timeout(readBuf.mapAsync(GPUMapMode.READ), "pixel readback");
    const d = new Uint8Array(readBuf.getMappedRange(0, 4));
    // 三角形覆盖中心：红色通道高、蓝色低 = draw 真正执行
    // bgra8unorm 的红色位于第 3 字节；蓝色清屏不能被当成成功绘制。
    const ok = d[2] > 180 && d[0] < 150;
    if (!ok) console.warn("[WebGPU] 绘制读回异常，启用兼容预览", Array.from(d));
    readBuf.unmap();
    return ok;
  } catch (error) {
    console.warn("[WebGPU] 探测失败，启用兼容预览", error);
    return false;
  } finally {
    buffer?.destroy();
    texture?.destroy();
    device?.destroy();
  }
}
