import { describe, expect, it } from 'vitest';
import { applyAlpha, contentBounds, cropRGBA, exportFileName, fitWithin } from '../src/lib/export';
import { EditHistory } from '../src/lib/history';
import type { Mask } from '../src/lib/mask';

describe('applyAlpha', () => {
  it('multiplies image alpha by mask and zeroes fully transparent pixels', () => {
    const rgba = Uint8ClampedArray.from([10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 128]);
    const mask: Mask = { width: 3, height: 1, data: Uint8Array.from([255, 0, 255]) };
    expect(Array.from(applyAlpha(rgba, mask))).toEqual([10, 20, 30, 255, 0, 0, 0, 0, 70, 80, 90, 128]);
  });
  it('keeps soft edges', () => {
    const out = applyAlpha(Uint8ClampedArray.from([1, 2, 3, 255]), { width: 1, height: 1, data: Uint8Array.from([128]) });
    expect(Array.from(out)).toEqual([1, 2, 3, 128]);
  });
  it('rejects mismatched sizes', () => {
    expect(() => applyAlpha(new Uint8ClampedArray(8), { width: 1, height: 1, data: new Uint8Array(1) })).toThrow();
  });
});

describe('contentBounds / cropRGBA', () => {
  const mask: Mask = { width: 5, height: 4, data: new Uint8Array(20) };
  mask.data[1 * 5 + 2] = 255;
  mask.data[2 * 5 + 3] = 255;
  it('finds the tight bounding box', () => {
    expect(contentBounds(mask)).toEqual({ x: 2, y: 1, width: 2, height: 2 });
  });
  it('applies padding clamped to the image', () => {
    expect(contentBounds(mask, 8, 5)).toEqual({ x: 0, y: 0, width: 5, height: 4 });
  });
  it('returns null for an empty mask', () => {
    expect(contentBounds({ width: 2, height: 2, data: new Uint8Array(4) })).toBeNull();
  });
  it('crops RGBA rows correctly', () => {
    const rgba = new Uint8ClampedArray(5 * 4 * 4);
    for (let i = 0; i < 20; i++) rgba[i * 4] = i; // R = pixel index
    const out = cropRGBA(rgba, 5, { x: 2, y: 1, width: 2, height: 2 });
    expect([out[0], out[4], out[8], out[12]]).toEqual([7, 8, 12, 13]);
  });
});

describe('misc', () => {
  it('exportFileName', () => {
    expect(exportFileName('cat photo.JPG')).toBe('cat photo-nobg.png');
    expect(exportFileName(undefined)).toBe('image-nobg.png');
    expect(exportFileName('.png')).toBe('image-nobg.png');
    expect(exportFileName('a.b.webp')).toBe('a.b-nobg.png');
  });
  it('fitWithin never upscales and keeps aspect ratio', () => {
    expect(fitWithin(800, 600, 4096)).toEqual({ width: 800, height: 600, scale: 1 });
    expect(fitWithin(8192, 4096, 4096)).toEqual({ width: 4096, height: 2048, scale: 0.5 });
  });
});

describe('EditHistory', () => {
  it('undo/redo and redo cleared on push', () => {
    const h = new EditHistory<number>();
    h.push(1);
    h.push(2);
    expect(h.undo()).toBe(2);
    expect(h.edits).toEqual([1]);
    expect(h.redo()).toBe(2);
    h.undo();
    h.push(3);
    expect(h.canRedo).toBe(false);
    expect(h.edits).toEqual([1, 3]);
  });
  it('returns the dropped edit when over limit so callers can bake it', () => {
    const h = new EditHistory<number>(2);
    expect(h.push(1)).toBeUndefined();
    h.push(2);
    expect(h.push(3)).toBe(1);
    expect(h.edits).toEqual([2, 3]);
  });
});
