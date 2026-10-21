import type { Mask } from './mask';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Combine an RGBA image with an alpha mask. Output alpha = image alpha * mask.
 * Fully transparent pixels get RGB zeroed so no hidden background colour
 * leaks into the PNG (smaller files, no colour fringes in some editors).
 */
export function applyAlpha(rgba: Uint8ClampedArray, mask: Mask): Uint8ClampedArray {
  if (rgba.length !== mask.width * mask.height * 4) {
    throw new Error('RGBA buffer does not match mask size');
  }
  const out = new Uint8ClampedArray(rgba.length);
  const m = mask.data;
  for (let i = 0, p = 0; i < m.length; i++, p += 4) {
    const a = Math.round((rgba[p + 3] * m[i]) / 255);
    if (a === 0) continue; // stays 0,0,0,0
    out[p] = rgba[p];
    out[p + 1] = rgba[p + 1];
    out[p + 2] = rgba[p + 2];
    out[p + 3] = a;
  }
  return out;
}

/** Bounding box of pixels with alpha > threshold, or null if empty. */
export function contentBounds(mask: Mask, threshold = 8, padding = 0): Rect | null {
  const { width: w, height: h, data } = mask;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (data[row + x] > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  minX = Math.max(0, minX - padding);
  minY = Math.max(0, minY - padding);
  maxX = Math.min(w - 1, maxX + padding);
  maxY = Math.min(h - 1, maxY + padding);
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** Copy a rectangle out of an RGBA buffer of the given width. */
export function cropRGBA(rgba: Uint8ClampedArray, width: number, r: Rect): Uint8ClampedArray {
  const out = new Uint8ClampedArray(r.width * r.height * 4);
  for (let y = 0; y < r.height; y++) {
    const src = ((r.y + y) * width + r.x) * 4;
    out.set(rgba.subarray(src, src + r.width * 4), y * r.width * 4);
  }
  return out;
}

/** e.g. "photo.jpg" -> "photo-nobg.png" */
export function exportFileName(original: string | undefined): string {
  const base = (original ?? 'image').replace(/\.[^./\\]+$/, '').trim() || 'image';
  return `${base}-nobg.png`;
}

/** Fit (w,h) inside maxSide keeping aspect ratio; never upscales. */
export function fitWithin(w: number, h: number, maxSide: number): { width: number; height: number; scale: number } {
  const s = Math.min(1, maxSide / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)), scale: s };
}
