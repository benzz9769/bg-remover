/**
 * Pure (DOM-free) mask logic. A mask is a single-channel alpha map, 0..255,
 * same size as the working image. 255 = keep (foreground), 0 = remove.
 */
export interface Mask {
  width: number;
  height: number;
  data: Uint8Array;
}

export type EditMode = 'add' | 'remove';

export interface Point {
  x: number;
  y: number;
}

/** A click-to-select edit: SAM produced `mask` for the clicked object. */
export interface ObjectEdit {
  kind: 'object';
  mode: EditMode;
  point: Point;
  /** The mask actually applied (chosen candidate, dilated for "remove"). */
  mask: Mask;
  score?: number;
  /** SAM's alternative masks (small -> large); kept only for the latest edit. */
  candidates?: { mask: Mask; score: number }[];
  choice?: number;
}

/** A free-hand brush stroke (stored as geometry, rasterised on demand). */
export interface BrushEdit {
  kind: 'brush';
  mode: EditMode;
  radius: number;
  points: Point[];
}

/** "Start over from nothing" / "select everything" markers. */
export interface FillEdit {
  kind: 'fill';
  value: 0 | 255;
}

export type Edit = ObjectEdit | BrushEdit | FillEdit;

export function createMask(width: number, height: number, fill = 0): Mask {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`Invalid mask size ${width}x${height}`);
  }
  const data = new Uint8Array(width * height);
  if (fill) data.fill(fill);
  return { width, height, data };
}

export function cloneMask(m: Mask): Mask {
  return { width: m.width, height: m.height, data: new Uint8Array(m.data) };
}

function assertSameSize(a: Mask, b: Mask): void {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`Mask size mismatch: ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  }
}

/** In-place union: target = max(target, src). */
export function unionInto(target: Mask, src: Mask): void {
  assertSameSize(target, src);
  const t = target.data;
  const s = src.data;
  for (let i = 0; i < t.length; i++) if (s[i] > t[i]) t[i] = s[i];
}

/** In-place subtraction: target = target * (1 - src/255). */
export function subtractInto(target: Mask, src: Mask): void {
  assertSameSize(target, src);
  const t = target.data;
  const s = src.data;
  for (let i = 0; i < t.length; i++) {
    if (s[i] === 0) continue;
    t[i] = s[i] === 255 ? 0 : Math.round((t[i] * (255 - s[i])) / 255);
  }
}

/**
 * Rasterise a brush stroke into a new mask by stamping discs along each
 * segment. Edges get a 1px linear falloff for light anti-aliasing.
 */
export function rasterizeStroke(width: number, height: number, stroke: BrushEdit): Mask {
  const out = createMask(width, height);
  const r = Math.max(0.5, stroke.radius);
  const pts = stroke.points;
  if (pts.length === 0) return out;
  const stamp = (cx: number, cy: number) => {
    const x0 = Math.max(0, Math.floor(cx - r - 1));
    const x1 = Math.min(width - 1, Math.ceil(cx + r + 1));
    const y0 = Math.max(0, Math.floor(cy - r - 1));
    const y1 = Math.min(height - 1, Math.ceil(cy + r + 1));
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - cy;
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx;
        const d = Math.sqrt(dx * dx + dy * dy);
        let a: number;
        if (d <= r - 0.5) a = 255;
        else if (d >= r + 0.5) continue;
        else a = Math.round((r + 0.5 - d) * 255);
        const i = y * width + x;
        if (a > out.data[i]) out.data[i] = a;
      }
    }
  };
  stamp(pts[0].x, pts[0].y);
  const spacing = Math.max(0.5, r / 3);
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1];
    const b = pts[k];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.ceil(len / spacing));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      stamp(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
    }
  }
  return out;
}

/** Apply a single edit in place. */
export function applyEdit(target: Mask, edit: Edit): void {
  if (edit.kind === 'fill') {
    target.data.fill(edit.value);
    return;
  }
  const src = edit.kind === 'object' ? edit.mask : rasterizeStroke(target.width, target.height, edit);
  if (edit.mode === 'add') unionInto(target, src);
  else {
    subtractInto(target, src);
    if (edit.kind === 'object') cleanupSlivers(target, src);
  }
}

/**
 * Final mask = auto mask (or empty when there is none) with each edit
 * applied in order. Never mutates its inputs.
 */
export function composeMask(
  width: number,
  height: number,
  auto: Mask | null,
  edits: readonly Edit[],
): Mask {
  const out = auto ? cloneMask(auto) : createMask(width, height);
  if (auto) assertSameSize(out, { width, height, data: out.data });
  for (const e of edits) applyEdit(out, e);
  return out;
}

/** Fraction (0..1) of total alpha that is kept. */
export function coverage(m: Mask): number {
  let sum = 0;
  for (let i = 0; i < m.data.length; i++) sum += m.data[i];
  return sum / (m.data.length * 255);
}

/** Binary mask from boolean/0-1 data (e.g. SAM output). */
export function maskFromBinary(width: number, height: number, bin: ArrayLike<number | boolean>): Mask {
  if (bin.length < width * height) throw new Error('binary data too short');
  const m = createMask(width, height);
  for (let i = 0; i < width * height; i++) m.data[i] = bin[i] ? 255 : 0;
  return m;
}

/** Fraction of pixels where masks differ by more than `tol`. */
export function diffFraction(a: Mask, b: Mask, tol = 32): number {
  assertSameSize(a, b);
  let n = 0;
  for (let i = 0; i < a.data.length; i++) if (Math.abs(a.data[i] - b.data[i]) > tol) n++;
  return n / a.data.length;
}

/**
 * Morphological dilation with a square (2r+1) window, separable max filter.
 * Used to grow a "remove" selection slightly so the soft edge of the auto
 * matte does not leave a thin outline behind.
 */
export function dilate(m: Mask, r: number): Mask {
  r = Math.floor(r);
  if (r <= 0) return cloneMask(m);
  const { width: w, height: h } = m;
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let v = 0;
      const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
      for (let k = x0; k <= x1; k++) if (m.data[row + k] > v) v = m.data[row + k];
      tmp[row + x] = v;
    }
  }
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let k = y0; k <= y1; k++) if (tmp[k * w + x] > v) v = tmp[k * w + x];
      out[y * w + x] = v;
    }
  }
  return { width: w, height: h, data: out };
}

/** Count of pixels > 127. */
export function area(m: Mask): number {
  let n = 0;
  for (let i = 0; i < m.data.length; i++) if (m.data[i] > 127) n++;
  return n;
}

/** Pixels to grow a "remove" selection by: about one SAM low-res cell. */
export function removeGrowRadius(width: number, height: number): number {
  return Math.max(2, Math.round(Math.max(width, height) / 256));
}

/** The mask an object edit applies, given SAM's raw candidate. */
export function objectEditMask(candidate: Mask, mode: EditMode): Mask {
  return mode === 'remove' ? dilate(candidate, removeGrowRadius(candidate.width, candidate.height)) : candidate;
}

/**
 * Default SAM candidate (indices sorted small -> large area). Prefer the
 * highest predicted IoU, but if a larger candidate scores almost as well
 * (within `slack`) take the larger one: users usually click to mean the
 * whole object, not a part of it.
 */
export function defaultCandidate(scores: readonly number[], slack = 0.04): number {
  if (scores.length === 0) return -1;
  let best = 0;
  for (let i = 1; i < scores.length; i++) if (scores[i] > scores[best]) best = i;
  let pick = best;
  for (let i = best + 1; i < scores.length; i++) if (scores[i] >= scores[best] - slack) pick = i;
  return pick;
}

/**
 * Levels/contrast stretch: values <= lo become 0, >= hi become 255, linear in
 * between. Model mattes rarely reach exact 0/255 (e.g. sigmoid*255 truncated
 * tops out at 254), which would leave the subject very slightly see-through.
 */
export function levels(m: Mask, lo = 4, hi = 250): Mask {
  const out = new Uint8Array(m.data.length);
  const k = 255 / Math.max(1, hi - lo);
  for (let i = 0; i < out.length; i++) {
    const v = m.data[i];
    out[i] = v <= lo ? 0 : v >= hi ? 255 : Math.round((v - lo) * k);
  }
  return { width: m.width, height: m.height, data: out };
}

/**
 * After removing an object, thin leftovers of its soft outline can survive
 * (SAM's mask is predicted at 256x256 and upsampled). This deletes connected
 * kept regions (alpha > `minAlpha`, 4-connected; faint halos count too) that lie entirely inside a band
 * around the removed mask and are small (< maxFrac of the removed area).
 * Real neighbouring objects are larger or extend beyond the band, so they stay.
 */
export function cleanupSlivers(
  target: Mask,
  removed: Mask,
  band = removeGrowRadius(removed.width, removed.height) * 4,
  maxFrac = 0.02,
  minAlpha = 8,
): number {
  assertSameSize(target, removed);
  const { width: w, height: h } = target;
  const zone = dilate(removed, band).data;
  const removedArea = area(removed);
  const maxArea = removedArea * maxFrac;
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let cleared = 0;
  const comp: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || target.data[start] <= minAlpha || !zone[start]) continue;
    let sp = 0;
    stack[sp++] = start;
    seen[start] = 1;
    comp.length = 0;
    let inside = true;
    while (sp > 0) {
      const i = stack[--sp];
      comp.push(i);
      if (!zone[i]) inside = false;
      const x = i % w;
      const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w];
      for (const j of nb) {
        if (j < 0 || j >= w * h || seen[j] || target.data[j] <= minAlpha) continue;
        seen[j] = 1;
        stack[sp++] = j;
      }
    }
    if (inside && comp.length <= maxArea) {
      for (const i of comp) target.data[i] = 0;
      cleared += comp.length;
    }
  }
  return cleared;
}
