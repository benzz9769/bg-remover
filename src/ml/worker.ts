/// <reference lib="webworker" />
import {
  env,
  pipeline,
  SamModel,
  AutoProcessor,
  RawImage,
  type Tensor,
} from '@huggingface/transformers';
import { AUTO_MODELS, SAM_MODEL, type AutoModelId, type Device, type FromWorker, type ToWorker } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

// Self-hosted ONNX Runtime WASM files (copied to public/ort/ at build time) so
// no third-party CDN is needed for the runtime. Models still come from the HF
// Hub. BASE_URL is the Vite base ("/bg-remover/" on GitHub Pages); join it as
// a directory URL so the files are "<origin>/bg-remover/ort/...", not under
// the worker chunk in assets/.
const siteRoot = new URL(import.meta.env.BASE_URL, self.location.origin);
const ortFile = (name: string) => new URL(`ort/${name}`, siteRoot).href;
const onnxEnv = env.backends.onnx as any;
onnxEnv.wasm.wasmPaths = {
  mjs: ortFile('ort-wasm-simd-threaded.asyncify.mjs'),
  wasm: ortFile('ort-wasm-simd-threaded.asyncify.wasm'),
};
env.allowLocalModels = false;
env.useBrowserCache = true;

const post = (m: FromWorker, transfer: Transferable[] = []) => self.postMessage(m, transfer);

let device: Device = 'wasm';
let gpuHasF16 = false;
// SlimSAM defaults to WASM: small, fast enough on CPU, and verified (WebGPU SAM
// failed in our SwiftShader test). Opt in with ?samDevice=webgpu.
let samPreferred: Device = 'wasm';
let autoSeg: any = null;
let autoSegId: AutoModelId | null = null;
let sam: any = null;
let samProc: any = null;
let samInputs: any = null;
let samEmbeddings: any = null;
let currentImage: RawImage | null = null;

async function detectDevice(pref?: Device | 'auto'): Promise<Device> {
  if (pref === 'wasm') return 'wasm';
  try {
    const gpu = (self.navigator as any).gpu;
    if (gpu) {
      const adapter = await gpu.requestAdapter();
      if (adapter) {
        gpuHasF16 = adapter.features?.has?.('shader-f16') === true;
        return 'webgpu';
      }
    }
  } catch {
    /* fall through */
  }
  return 'wasm';
}

function progressCb(stage: 'auto' | 'sam') {
  return (p: any) => {
    if (p.status === 'progress' || p.status === 'done' || p.status === 'initiate') {
      post({ type: 'progress', stage, file: p.file ?? '', loaded: p.loaded ?? 0, total: p.total ?? 0, status: p.status });
    }
  };
}

let autoDevice: Device = 'wasm';
let samDevice: Device = 'wasm';
const errMsg = (e: unknown) => String((e as any)?.message ?? e);

async function loadAuto(id: AutoModelId, d: Device) {
  if (autoSeg && autoSegId === id && autoDevice === d) return 0;
  const t0 = performance.now();
  if (autoSeg) await Promise.resolve(autoSeg.dispose?.()).catch(() => {});
  autoSeg = null;
  const { repo, revision } = AUTO_MODELS[id];
  autoSeg = await pipeline('image-segmentation', repo, {
    device: d,
    revision,
    // fp16 halves the download on GPUs that support shader-f16; otherwise
    // (and on WASM/CPU) use fp32.
    dtype: d === 'webgpu' && gpuHasF16 && id !== 'modnet' ? 'fp16' : 'fp32',
    progress_callback: progressCb('auto'),
  } as any);
  autoSegId = id;
  autoDevice = d;
  return performance.now() - t0;
}

async function loadSam(d: Device) {
  if (sam && samDevice === d) return 0;
  const t0 = performance.now();
  if (sam) await Promise.resolve(sam.dispose?.()).catch(() => {});
  sam = null;
  sam = await SamModel.from_pretrained(SAM_MODEL.repo, {
    device: d,
    revision: SAM_MODEL.revision,
    dtype: 'fp32',
    progress_callback: progressCb('sam'),
  } as any);
  samDevice = d;
  samProc ??= await AutoProcessor.from_pretrained(SAM_MODEL.repo, { revision: SAM_MODEL.revision } as any);
  return performance.now() - t0;
}

/**
 * Run `fn` on the preferred device; if that is WebGPU and anything fails
 * (load or inference: missing features, device lost, OOM...), retry on WASM.
 */
async function withFallback<T>(what: 'auto' | 'sam', fn: (d: Device) => Promise<T>): Promise<T> {
  const preferred: Device = what === 'auto' ? (autoSeg ? autoDevice : device) : sam ? samDevice : samPreferred;
  try {
    return await fn(preferred);
  } catch (e) {
    if (preferred !== 'webgpu') throw e;
    post({
      type: 'status',
      stage: what === 'auto' ? 'fallback-wasm' : 'sam-fallback-wasm',
      message: `${what} on WebGPU failed, retrying on WASM: ${errMsg(e)}`,
    });
    return await fn('wasm');
  }
}

async function onSetImage(id: number, img: { width: number; height: number; rgba: Uint8ClampedArray }, autoModel: AutoModelId) {
  currentImage = new RawImage(img.rgba, img.width, img.height, 4).rgb();
  samInputs = null;
  samEmbeddings = null;
  const image = currentImage;

  // 1) automatic background removal
  try {
    let loadMs = 0;
    let ms = 0;
    const out = await withFallback('auto', async (d) => {
      post({ type: 'status', id, stage: 'load-auto' });
      loadMs = await loadAuto(autoModel, d);
      post({ type: 'status', id, stage: 'run-auto' });
      const t0 = performance.now();
      const r = await autoSeg(image);
      ms = performance.now() - t0;
      return r;
    });
    const maskImg: RawImage = out[0].mask;
    let data = maskImg.data as Uint8ClampedArray;
    if (maskImg.width !== img.width || maskImg.height !== img.height || maskImg.channels !== 1) {
      const fixed = await maskImg.grayscale().resize(img.width, img.height);
      data = fixed.data as Uint8ClampedArray;
    }
    const mask = new Uint8Array(data);
    post({ type: 'autoMask', id, width: img.width, height: img.height, mask, ms, loadMs }, [mask.buffer]);
  } catch (e) {
    post({ type: 'error', id, stage: 'auto', message: errMsg(e) });
  }

  // 2) prepare click-to-select (SAM image embeddings, computed once per image)
  try {
    let loadMs = 0;
    const t0 = { v: 0 };
    await withFallback('sam', async (d) => {
      post({ type: 'status', id, stage: 'load-sam' });
      loadMs = await loadSam(d);
      post({ type: 'status', id, stage: 'run-sam' });
      t0.v = performance.now();
      samInputs = await samProc(image);
      samEmbeddings = await sam.get_image_embeddings(samInputs);
    });
    post({ type: 'samReady', id, ms: performance.now() - t0.v, loadMs });
  } catch (e) {
    post({ type: 'error', id, stage: 'sam', message: errMsg(e) });
  }
}

async function onSegmentPoint(id: number, points: { x: number; y: number; label: 0 | 1 }[]) {
  if (!samInputs || !samEmbeddings || !currentImage) {
    post({ type: 'error', id, stage: 'point', message: 'SAM not ready' });
    return;
  }
  try {
    const t0 = performance.now();
    // Points are in original-image pixels; the processor rescales them.
    const input_points = [[points.map((p) => [p.x, p.y])]];
    const input_labels = [[points.map((p) => p.label)]];
    const ip = samProc.image_processor;
    const pts = ip.reshape_input_points(input_points, samInputs.original_sizes, samInputs.reshaped_input_sizes);
    const labels = ip.add_input_labels(input_labels, pts);
    let outputs: any;
    try {
      outputs = await sam({ ...samEmbeddings, input_points: pts, input_labels: labels });
    } catch (e) {
      if (samDevice !== 'webgpu') throw e;
      // WebGPU failed mid-session (e.g. device lost): rebuild SAM on WASM once.
      post({ type: 'status', stage: 'sam-fallback-wasm', message: `SAM decode on WebGPU failed, retrying on WASM: ${errMsg(e)}` });
      await loadSam('wasm');
      samEmbeddings = await sam.get_image_embeddings(samInputs);
      outputs = await sam({ ...samEmbeddings, input_points: pts, input_labels: labels });
    }
    const masks: Tensor[] = await samProc.post_process_masks(
      outputs.pred_masks,
      samInputs.original_sizes,
      samInputs.reshaped_input_sizes,
    );
    const scores = Array.from(outputs.iou_scores.data as Float32Array);
    const t = masks[0]; // dims [1, 3, H, W], bool
    const [, n, H, W] = t.dims as number[];
    const cands: { mask: Uint8Array; score: number; area: number }[] = [];
    for (let k = 0; k < n; k++) {
      const plane = (t.data as Uint8Array).subarray(k * H * W, (k + 1) * H * W);
      const mask = new Uint8Array(H * W);
      let area = 0;
      for (let i = 0; i < mask.length; i++) if (plane[i]) { mask[i] = 255; area++; }
      cands.push({ mask, score: scores[k], area });
    }
    cands.sort((a, b) => a.area - b.area);
    post(
      { type: 'pointMask', id, width: W, height: H, masks: cands.map((c) => c.mask), scores: cands.map((c) => c.score), ms: performance.now() - t0 },
      cands.map((c) => c.mask.buffer),
    );
  } catch (e: any) {
    post({ type: 'error', id, stage: 'point', message: String(e?.message ?? e) });
  }
}

// Serialise all work: transformers.js cannot create sessions concurrently.
let chain: Promise<void> = Promise.resolve();
self.onmessage = (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data;
  chain = chain.then(async () => {
    if (msg.type === 'init') {
      device = await detectDevice(msg.device);
      samPreferred = msg.samDevice === 'webgpu' && device === 'webgpu' ? 'webgpu' : 'wasm';
      post({
        type: 'ready',
        device,
        crossOriginIsolated: (self as any).crossOriginIsolated === true,
        threads: onnxEnv.wasm.numThreads ?? 0,
      });
    } else if (msg.type === 'setImage') {
      await onSetImage(msg.id, msg.image, msg.autoModel);
    } else if (msg.type === 'segmentPoint') {
      await onSegmentPoint(msg.id, msg.points);
    }
  });
};
