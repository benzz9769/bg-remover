import './style.css';
import { applyI18n, getLang, setLang, t, type Key } from './i18n';
import {
  applyEdit,
  composeMask,
  defaultCandidate,
  levels,
  objectEditMask,
  type ObjectEdit,
  coverage,
  createMask,
  cloneMask,
  type Edit,
  type Mask,
  type Point,
  type BrushEdit,
} from './lib/mask';
import { EditHistory } from './lib/history';
import { applyAlpha, contentBounds, cropRGBA, exportFileName, fitWithin } from './lib/export';
import type { AutoModelId, FromWorker, ToWorker } from './ml/protocol';

const MAX_SIDE = 4096;
type Tool = 'add' | 'remove' | 'brush-add' | 'brush-remove';
type View = 'result' | 'overlay' | 'original';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const dropzone = $('dropzone');
const editor = $('editor');
const fileInput = $<HTMLInputElement>('fileInput');
const viewCanvas = $<HTMLCanvasElement>('view');
const overlay = $<HTMLCanvasElement>('overlay');
const stage = $('stage');
const statusText = $('statusText');
const keptText = $('keptText');
const spinner = $('spinner');
const progress = $('progress');
const progressBar = $('progressBar');
const engineBadge = $('engineBadge');
const brushSize = $<HTMLInputElement>('brushSize');
const brushSizeOut = $<HTMLOutputElement>('brushSizeOut');
const modelSelect = $<HTMLSelectElement>('modelSelect');

// ---------------------------------------------------------------- state
const state = {
  tool: 'add' as Tool,
  view: 'result' as View,
  fileName: 'image',
  width: 0,
  height: 0,
  rgba: null as Uint8ClampedArray | null,
  autoMask: null as Mask | null,
  base: null as Mask | null, // auto mask + edits baked out of history
  mask: null as Mask | null, // current composed mask
  history: new EditHistory<Edit>(40),
  imageId: 0,
  samReady: false,
  busy: false,
  device: '' as string,
  stage: 'init',
  statusKey: 'stInit' as Key,
  timings: {} as Record<string, number>,
  downloads: {} as Record<string, number>,
  errors: [] as string[],
  pendingPoint: null as null | { id: number; mode: 'add' | 'remove'; point: Point },
  lastScores: [] as number[],
  threads: 0,
  warnings: [] as string[],
};

// ---------------------------------------------------------------- worker
const params = new URLSearchParams(location.search);
let worker: Worker;
let restartedOnWasm = false;
function startWorker(device: 'auto' | 'wasm' | 'webgpu') {
  worker = new Worker(new URL('./ml/worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = onWorkerMessage;
  send({ type: 'init', device, samDevice: params.get('samDevice') === 'webgpu' ? 'webgpu' : 'wasm' });
}
const send = (m: ToWorker, transfer: Transferable[] = []) => worker.postMessage(m, transfer);
if (params.get('model') && [...modelSelect.options].some((o) => o.value === params.get('model'))) {
  modelSelect.value = params.get('model')!;
}

let reqSeq = 0;

function onWorkerMessage(ev: MessageEvent<FromWorker>) {
  const m = ev.data;
  switch (m.type) {
    case 'ready': {
      state.device = m.device;
      state.threads = m.threads;
      engineBadge.textContent = `${t('engine')}: ${m.device === 'webgpu' ? 'WebGPU' : 'WASM'}`;
      engineBadge.title = `crossOriginIsolated=${m.crossOriginIsolated}`;
      if (!state.rgba) setStage('idle', 'stIdle');
      break;
    }
    case 'progress': {
      if (m.total > 0) {
        state.downloads[m.file] = m.total;
        progress.hidden = false;
        progressBar.style.width = `${Math.round((m.loaded / m.total) * 100)}%`;
      }
      if (m.status === 'done') progress.hidden = true;
      break;
    }
    case 'status': {
      if (m.message) state.warnings.push(m.message);
      if (m.stage === 'sam-fallback-wasm') break;
      if (m.stage === 'fallback-wasm') {
        state.device = 'wasm';
        engineBadge.textContent = `${t('engine')}: WASM`;
        flash('stFallback');
        break;
      }
      if (m.id !== undefined && m.id !== state.imageId) break;
      const map: Record<string, Key> = {
        'load-auto': 'stLoadAuto',
        'run-auto': 'stRunAuto',
        'load-sam': 'stLoadSam',
        'run-sam': 'stRunSam',
      };
      setStage(m.stage, map[m.stage] ?? 'stInit', true);
      break;
    }
    case 'autoMask': {
      if (m.id !== state.imageId) break;
      state.timings.autoLoadMs = Math.round(m.loadMs);
      state.timings.autoRunMs = Math.round(m.ms);
      state.autoMask = levels({ width: m.width, height: m.height, data: m.mask });
      state.base = cloneMask(state.autoMask);
      state.history.clear();
      recompose();
      break;
    }
    case 'samReady': {
      if (m.id !== state.imageId) break;
      state.timings.samLoadMs = Math.round(m.loadMs);
      state.timings.samEmbedMs = Math.round(m.ms);
      state.samReady = true;
      setStage('ready', 'stReady');
      break;
    }
    case 'pointMask': {
      const p = state.pendingPoint;
      state.pendingPoint = null;
      state.busy = false;
      if (!p || p.id !== m.id || !state.mask) break;
      state.timings.lastPointMs = Math.round(m.ms);
      const candidates = m.masks.map((data, i) => ({ mask: { width: m.width, height: m.height, data }, score: m.scores[i] }));
      const choice = defaultCandidate(m.scores);
      state.lastScores = m.scores;
      pushEdit({
        kind: 'object',
        mode: p.mode,
        point: p.point,
        mask: objectEditMask(candidates[choice].mask, p.mode),
        score: candidates[choice].score,
        candidates,
        choice,
      });
      setStage('ready', 'stReady');
      break;
    }
    case 'error': {
      state.busy = false;
      if (state.device === 'webgpu' && !restartedOnWasm && m.stage !== 'point') {
        // A broken WebGPU context can poison the whole worker; start a fresh
        // worker on WASM and redo the current image.
        restartedOnWasm = true;
        state.warnings.push(`restarting on WASM after: ${m.stage}: ${m.message}`);
        worker.terminate();
        state.device = 'wasm';
        startWorker('wasm');
        flash('stFallback');
        if (state.rgba) runAuto();
        break;
      }
      state.errors.push(`${m.stage}: ${m.message}`);
      console.error(m.stage, m.message);
      setStage('error', 'stError', false, `${t('stError')}: ${m.message}`);
      break;
    }
  }
}

// ---------------------------------------------------------------- status
function setStage(stageName: string, key: Key, busy = false, text?: string) {
  state.stage = stageName;
  state.statusKey = key;
  document.body.dataset.stage = stageName;
  statusText.textContent = text ?? t(key);
  statusText.classList.toggle('status-error', stageName === 'error');
  spinner.hidden = !busy;
  updateButtons();
}
function flash(key: Key) {
  statusText.textContent = t(key);
}

// ---------------------------------------------------------------- image loading
async function loadFile(file: Blob, name = 'image') {
  if (!file.type.startsWith('image/')) {
    flash('stNotImage');
    return;
  }
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    flash('stNotImage');
    return;
  }
  const { width, height } = fitWithin(bmp.width, bmp.height, MAX_SIDE);
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0, width, height);
  bmp.close();
  const rgba = ctx.getImageData(0, 0, width, height).data;

  state.fileName = name;
  state.width = width;
  state.height = height;
  state.rgba = rgba;
  state.autoMask = null;
  state.base = null;
  state.mask = null;
  state.samReady = false;
  state.history.clear();
  state.imageId++;

  viewCanvas.width = overlay.width = width;
  viewCanvas.height = overlay.height = height;
  dropzone.hidden = true;
  editor.hidden = false;
  state.view = 'original';
  render();
  state.view = 'result';
  syncViewButtons();
  runAuto();
}

function runAuto() {
  if (!state.rgba) return;
  state.autoMask = null;
  state.samReady = false;
  const copy = new Uint8ClampedArray(state.rgba);
  send(
    {
      type: 'setImage',
      id: state.imageId,
      image: { width: state.width, height: state.height, rgba: copy },
      autoModel: modelSelect.value as AutoModelId,
    },
    [copy.buffer],
  );
  setStage('load-auto', 'stLoadAuto', true);
}

// ---------------------------------------------------------------- mask editing
function lastObjectEdit(): ObjectEdit | null {
  const edits = state.history.edits;
  const last = edits[edits.length - 1];
  return last && last.kind === 'object' && last.candidates ? last : null;
}
function pushEdit(e: Edit) {
  if (!state.mask || !state.base) return;
  // Only the newest object edit keeps its alternative masks (memory).
  const prev = lastObjectEdit();
  if (prev) delete prev.candidates;
  const dropped = state.history.push(e);
  if (dropped) applyEdit(state.base, dropped);
  applyEdit(state.mask, e); // incremental
  render();
  drawMarkers();
  updateButtons();
}
function recompose() {
  if (!state.base) return;
  state.mask = composeMask(state.width, state.height, state.base, state.history.edits);
  render();
  drawMarkers();
  updateButtons();
}

// ---------------------------------------------------------------- rendering
function render() {
  if (!state.rgba) return;
  const ctx = viewCanvas.getContext('2d')!;
  const { width: w, height: h } = state;
  let px: Uint8ClampedArray;
  if (state.view === 'original' || !state.mask) {
    px = state.rgba;
  } else if (state.view === 'result') {
    px = applyAlpha(state.rgba, state.mask);
  } else {
    // overlay: kept area as-is, removed area darkened + red tint
    const src = state.rgba;
    const m = state.mask.data;
    px = new Uint8ClampedArray(src.length);
    for (let i = 0, p = 0; i < m.length; i++, p += 4) {
      const a = m[i] / 255;
      const k = 1 - a;
      px[p] = src[p] * a + (src[p] * 0.35 + 255 * 0.4) * k;
      px[p + 1] = src[p + 1] * a + src[p + 1] * 0.35 * k;
      px[p + 2] = src[p + 2] * a + src[p + 2] * 0.35 * k;
      px[p + 3] = 255;
    }
  }
  ctx.putImageData(new ImageData(new Uint8ClampedArray(px), w, h), 0, 0);
  if (state.mask) {
    keptText.textContent = `· ${t('kept')} ${(coverage(state.mask) * 100).toFixed(1)}%`;
  } else keptText.textContent = '';
}

function drawMarkers(preview?: BrushEdit) {
  const ctx = overlay.getContext('2d')!;
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  const scale = overlay.width / Math.max(1, overlay.getBoundingClientRect().width);
  const r = 9 * scale;
  for (const e of state.history.edits) {
    if (e.kind !== 'object') continue;
    const { x, y } = e.point;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = e.mode === 'add' ? '#16a34a' : '#dc2626';
    ctx.fill();
    ctx.lineWidth = 2.5 * scale;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - r * 0.5, y);
    ctx.lineTo(x + r * 0.5, y);
    if (e.mode === 'add') {
      ctx.moveTo(x, y - r * 0.5);
      ctx.lineTo(x, y + r * 0.5);
    }
    ctx.stroke();
  }
  if (preview && preview.points.length) {
    ctx.save();
    ctx.globalAlpha = 0.45;
    ctx.strokeStyle = preview.mode === 'add' ? '#16a34a' : '#dc2626';
    ctx.lineWidth = preview.radius * 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(preview.points[0].x, preview.points[0].y);
    for (const p of preview.points) ctx.lineTo(p.x, p.y);
    if (preview.points.length === 1) ctx.lineTo(preview.points[0].x + 0.01, preview.points[0].y);
    ctx.stroke();
    ctx.restore();
  }
}

// ---------------------------------------------------------------- pointer input
function toImage(ev: PointerEvent | MouseEvent): Point {
  const r = overlay.getBoundingClientRect();
  return {
    x: Math.min(state.width - 1, Math.max(0, ((ev.clientX - r.left) / r.width) * state.width)),
    y: Math.min(state.height - 1, Math.max(0, ((ev.clientY - r.top) / r.height) * state.height)),
  };
}

let stroke: BrushEdit | null = null;

overlay.addEventListener('contextmenu', (e) => e.preventDefault());
overlay.addEventListener('pointerdown', (ev) => {
  if (!state.mask) return;
  const p = toImage(ev);
  const isBrush = state.tool.startsWith('brush');
  if (isBrush && ev.button === 0) {
    overlay.setPointerCapture(ev.pointerId);
    const scale = state.width / overlay.getBoundingClientRect().width;
    stroke = {
      kind: 'brush',
      mode: state.tool === 'brush-add' ? 'add' : 'remove',
      radius: (Number(brushSize.value) / 2) * scale,
      points: [p],
    };
    drawMarkers(stroke);
    return;
  }
  // click-to-select
  let mode: 'add' | 'remove' = state.tool === 'remove' ? 'remove' : 'add';
  if (ev.button === 2) mode = 'remove';
  else if (ev.shiftKey) mode = 'add';
  else if (isBrush) return;
  segmentAt(p, mode);
});
overlay.addEventListener('pointermove', (ev) => {
  if (!stroke) return;
  stroke.points.push(toImage(ev));
  drawMarkers(stroke);
});
const endStroke = () => {
  if (!stroke) return;
  const s = stroke;
  stroke = null;
  pushEdit(s);
};
overlay.addEventListener('pointerup', endStroke);
overlay.addEventListener('pointercancel', endStroke);

function segmentAt(p: Point, mode: 'add' | 'remove') {
  if (!state.samReady) {
    flash('stSamNotReady');
    return;
  }
  if (state.busy) return;
  state.busy = true;
  const id = ++reqSeq;
  state.pendingPoint = { id, mode, point: p };
  setStage('segmenting', 'stSegmenting', true);
  send({ type: 'segmentPoint', id, points: [{ x: Math.round(p.x), y: Math.round(p.y), label: 1 }] });
}

// ---------------------------------------------------------------- export
async function exportBlob(): Promise<{ blob: Blob; name: string; width: number; height: number }> {
  if (!state.rgba || !state.mask) throw new Error('no image');
  let px = applyAlpha(state.rgba, state.mask);
  let w = state.width;
  let h = state.height;
  if (($('cropChk') as HTMLInputElement).checked) {
    const b = contentBounds(state.mask, 8, 2);
    if (b) {
      px = cropRGBA(px, w, b);
      w = b.width;
      h = b.height;
    }
  }
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(px), w, h), 0, 0);
  const blob: Blob = await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'));
  return { blob, name: exportFileName(state.fileName), width: w, height: h };
}

$('downloadBtn').addEventListener('click', async () => {
  if (state.mask && coverage(state.mask) === 0) flash('stEmpty');
  const { blob, name } = await exportBlob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  flash('stDownloaded');
});

// ---------------------------------------------------------------- controls
function chooseCandidate(k: number) {
  const e = lastObjectEdit();
  if (!e || !e.candidates || !e.candidates[k]) return;
  e.choice = k;
  e.mask = objectEditMask(e.candidates[k].mask, e.mode);
  e.score = e.candidates[k].score;
  recompose();
}
document.querySelectorAll<HTMLButtonElement>('[data-cand]').forEach((b) =>
  b.addEventListener('click', () => chooseCandidate(Number(b.dataset.cand))),
);

function updateButtons() {
  const hasMask = !!state.mask;
  const lastObj = lastObjectEdit();
  document.querySelectorAll<HTMLButtonElement>('[data-cand]').forEach((b) => {
    b.disabled = !lastObj;
    b.classList.toggle('active', !!lastObj && lastObj.choice === Number(b.dataset.cand));
  });
  ($('undoBtn') as HTMLButtonElement).disabled = !state.history.canUndo;
  ($('redoBtn') as HTMLButtonElement).disabled = !state.history.canRedo;
  for (const id of ['resetBtn', 'clearBtn', 'allBtn', 'downloadBtn']) ($(id) as HTMLButtonElement).disabled = !hasMask;
  ($('resetBtn') as HTMLButtonElement).disabled = !state.autoMask;
  document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((b) => {
    b.classList.toggle('active', b.dataset.tool === state.tool);
    if (b.dataset.tool === 'add' || b.dataset.tool === 'remove') b.disabled = !state.samReady;
  });
}
function syncViewButtons() {
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === state.view));
}

document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((b) =>
  b.addEventListener('click', () => {
    state.tool = b.dataset.tool as Tool;
    overlay.style.cursor = state.tool.startsWith('brush') ? 'cell' : 'crosshair';
    updateButtons();
  }),
);
document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) =>
  b.addEventListener('click', () => {
    state.view = b.dataset.view as View;
    syncViewButtons();
    render();
  }),
);
$<HTMLSelectElement>('bgSelect').addEventListener('change', (e) => {
  stage.className = `stage bg-${(e.target as HTMLSelectElement).value}`;
});
brushSize.addEventListener('input', () => (brushSizeOut.textContent = brushSize.value));

function undo() {
  if (state.history.undo() !== undefined) recompose();
}
function redo() {
  const e = state.history.redo();
  if (e && state.mask) {
    applyEdit(state.mask, e);
    render();
    drawMarkers();
    updateButtons();
  }
}
$('undoBtn').addEventListener('click', undo);
$('redoBtn').addEventListener('click', redo);
$('resetBtn').addEventListener('click', () => {
  if (!state.autoMask) return;
  state.base = cloneMask(state.autoMask);
  state.history.clear();
  recompose();
});
$('clearBtn').addEventListener('click', () => pushEdit({ kind: 'fill', value: 0 }));
$('allBtn').addEventListener('click', () => pushEdit({ kind: 'fill', value: 255 }));
$('newBtn').addEventListener('click', () => fileInput.click());
$('rerunBtn').addEventListener('click', () => runAuto());

window.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    e.shiftKey ? redo() : undo();
  } else if (mod && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    redo();
  }
});

// file open / drag-drop / paste
$('chooseBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  fileInput.click();
});
dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') fileInput.click();
});
fileInput.addEventListener('change', () => {
  const f = fileInput.files?.[0];
  if (f) loadFile(f, f.name);
  fileInput.value = '';
});
window.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('drag');
});
window.addEventListener('dragleave', () => dropzone.classList.remove('drag'));
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('drag');
  const f = e.dataTransfer?.files?.[0];
  if (f) loadFile(f, f.name);
});
window.addEventListener('paste', (e) => {
  const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
  const f = item?.getAsFile();
  if (f) loadFile(f, f.name && f.name !== 'image.png' ? f.name : 'pasted');
});

// language
function syncLang() {
  document.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach((b) => b.classList.toggle('active', b.dataset.lang === getLang()));
  statusText.textContent = t(state.statusKey);
  if (state.device) engineBadge.textContent = `${t('engine')}: ${state.device === 'webgpu' ? 'WebGPU' : 'WASM'}`;
  render();
}
document.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach((b) =>
  b.addEventListener('click', () => {
    setLang(b.dataset.lang as 'th' | 'en');
    syncLang();
  }),
);

startWorker((params.get('device') as 'wasm' | 'webgpu' | null) ?? 'auto');
applyI18n();
syncLang();
setStage('init', 'stInit', true);
updateButtons();

// Hooks for automated end-to-end tests (read-only state + export helper).
(window as any).__bg = {
  state: () => ({
    stage: state.stage,
    device: state.device,
    wasmThreads: state.threads,
    width: state.width,
    height: state.height,
    samReady: state.samReady,
    edits: state.history.edits.length,
    lastScores: state.lastScores,
    lastChoice: lastObjectEdit()?.choice ?? null,
    coverage: state.mask ? coverage(state.mask) : null,
    timings: state.timings,
    downloads: state.downloads,
    errors: state.errors,
    warnings: state.warnings,
    crossOriginIsolated: (self as any).crossOriginIsolated,
  }),
  maskSnapshot: () => (state.mask ? Array.from(state.mask.data) : null),
  emptyMask: () => createMask(1, 1),
};
