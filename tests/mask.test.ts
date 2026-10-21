import { describe, expect, it } from 'vitest';
import {
  applyEdit,
  area,
  cleanupSlivers,
  defaultCandidate,
  dilate,
  levels,
  objectEditMask,
  removeGrowRadius,
  composeMask,
  coverage,
  createMask,
  diffFraction,
  maskFromBinary,
  rasterizeStroke,
  subtractInto,
  unionInto,
  type Edit,
  type Mask,
} from '../src/lib/mask';

const m = (w: number, h: number, vals: number[]): Mask => ({ width: w, height: h, data: Uint8Array.from(vals) });

describe('createMask', () => {
  it('creates filled masks and rejects bad sizes', () => {
    expect(Array.from(createMask(2, 1).data)).toEqual([0, 0]);
    expect(Array.from(createMask(2, 1, 255).data)).toEqual([255, 255]);
    expect(() => createMask(0, 5)).toThrow();
    expect(() => createMask(1.5, 5)).toThrow();
  });
});

describe('union / subtract', () => {
  it('union takes the per-pixel max', () => {
    const a = m(4, 1, [0, 100, 255, 30]);
    unionInto(a, m(4, 1, [50, 50, 0, 255]));
    expect(Array.from(a.data)).toEqual([50, 100, 255, 255]);
  });
  it('subtract removes fully where src=255 and partially for soft edges', () => {
    const a = m(4, 1, [255, 255, 200, 0]);
    subtractInto(a, m(4, 1, [255, 0, 128, 255]));
    expect(Array.from(a.data)).toEqual([0, 255, Math.round((200 * 127) / 255), 0]);
  });
  it('throws on size mismatch', () => {
    expect(() => unionInto(createMask(2, 2), createMask(3, 2))).toThrow(/mismatch/);
  });
});

describe('composeMask', () => {
  const auto = m(3, 1, [255, 0, 0]);
  it('returns a copy of the auto mask when there are no edits', () => {
    const out = composeMask(3, 1, auto, []);
    expect(Array.from(out.data)).toEqual([255, 0, 0]);
    expect(out.data).not.toBe(auto.data);
  });
  it('applies add/remove object edits in order without mutating inputs', () => {
    const edits: Edit[] = [
      { kind: 'object', mode: 'add', point: { x: 1, y: 0 }, mask: m(3, 1, [0, 255, 255]) },
      { kind: 'object', mode: 'remove', point: { x: 0, y: 0 }, mask: m(3, 1, [255, 0, 0]) },
    ];
    const out = composeMask(3, 1, auto, edits);
    expect(Array.from(out.data)).toEqual([0, 255, 255]);
    expect(Array.from(auto.data)).toEqual([255, 0, 0]);
  });
  it('order matters: remove then add re-adds', () => {
    const obj = m(3, 1, [255, 0, 0]);
    const out = composeMask(3, 1, auto, [
      { kind: 'object', mode: 'remove', point: { x: 0, y: 0 }, mask: obj },
      { kind: 'object', mode: 'add', point: { x: 0, y: 0 }, mask: obj },
    ]);
    expect(Array.from(out.data)).toEqual([255, 0, 0]);
  });
  it('fill edits clear or select everything', () => {
    expect(Array.from(composeMask(3, 1, auto, [{ kind: 'fill', value: 0 }]).data)).toEqual([0, 0, 0]);
    expect(Array.from(composeMask(3, 1, null, [{ kind: 'fill', value: 255 }]).data)).toEqual([255, 255, 255]);
  });
  it('starts empty when there is no auto mask', () => {
    expect(coverage(composeMask(5, 5, null, []))).toBe(0);
  });
});

describe('brush', () => {
  it('rasterises a single dab as a disc centred on the point', () => {
    const s = rasterizeStroke(21, 21, { kind: 'brush', mode: 'add', radius: 5, points: [{ x: 10.5, y: 10.5 }] });
    expect(s.data[10 * 21 + 10]).toBe(255); // centre
    expect(s.data[0]).toBe(0); // corner
    const area = Array.from(s.data).reduce((a, v) => a + v / 255, 0);
    expect(area).toBeGreaterThan(Math.PI * 25 * 0.9);
    expect(area).toBeLessThan(Math.PI * 25 * 1.1);
  });
  it('covers the whole segment between points', () => {
    const s = rasterizeStroke(100, 10, { kind: 'brush', mode: 'add', radius: 3, points: [{ x: 5, y: 5 }, { x: 95, y: 5 }] });
    for (let x = 5; x < 95; x++) expect(s.data[5 * 100 + x]).toBe(255);
  });
  it('clips safely at image borders', () => {
    const s = rasterizeStroke(10, 10, { kind: 'brush', mode: 'add', radius: 4, points: [{ x: -3, y: -3 }, { x: 0, y: 0 }] });
    expect(s.data[0]).toBe(255);
  });
  it('brush remove edit erases', () => {
    const t = createMask(10, 10, 255);
    applyEdit(t, { kind: 'brush', mode: 'remove', radius: 2, points: [{ x: 5, y: 5 }] });
    expect(t.data[5 * 10 + 5]).toBe(0);
    expect(t.data[0]).toBe(255);
  });
});

describe('helpers', () => {
  it('maskFromBinary maps truthy to 255', () => {
    expect(Array.from(maskFromBinary(3, 1, [0, 1, true]).data)).toEqual([0, 255, 255]);
  });
  it('coverage and diffFraction', () => {
    expect(coverage(m(2, 1, [255, 0]))).toBe(0.5);
    expect(diffFraction(m(2, 1, [255, 0]), m(2, 1, [250, 255]))).toBe(0.5);
  });
});

describe('dilate / remove growth', () => {
  it('grows a single pixel into a (2r+1) square', () => {
    const src = createMask(7, 7);
    src.data[3 * 7 + 3] = 255;
    const d = dilate(src, 1);
    expect(area(d)).toBe(9);
    expect(d.data[2 * 7 + 2]).toBe(255);
    expect(d.data[1 * 7 + 1]).toBe(0);
    expect(area(dilate(src, 0))).toBe(1);
  });
  it('remove edits are grown, add edits are not', () => {
    const src = createMask(512, 512);
    src.data[256 * 512 + 256] = 255;
    expect(removeGrowRadius(512, 512)).toBe(2);
    expect(area(objectEditMask(src, 'add'))).toBe(1);
    expect(area(objectEditMask(src, 'remove'))).toBe(25);
  });
});

describe('defaultCandidate', () => {
  it('picks the best score', () => {
    expect(defaultCandidate([0.5, 0.9, 0.6])).toBe(1);
  });
  it('prefers a larger candidate that scores almost as well', () => {
    expect(defaultCandidate([0.95, 0.80, 0.93])).toBe(2);
    expect(defaultCandidate([0.70, 0.95, 0.94])).toBe(2);
  });
  it('handles empty input', () => {
    expect(defaultCandidate([])).toBe(-1);
  });
});

describe('levels', () => {
  it('snaps near-0/near-255 to exact values and stretches the middle', () => {
    const out = levels(m(5, 1, [0, 4, 127, 250, 254]));
    expect(Array.from(out.data)).toEqual([0, 0, Math.round((127 - 4) * (255 / 246)), 255, 255]);
  });
});

describe('cleanupSlivers', () => {
  it('removes a thin leftover next to a removed object but keeps a real neighbour', () => {
    const W = 200, H = 100;
    const target = createMask(W, H);
    const removed = createMask(W, H);
    // removed object: square 20..60
    for (let y = 20; y < 60; y++) for (let x = 20; x < 60; x++) removed.data[y * W + x] = 255;
    // sliver hugging its right edge (x=60..61, y=30..40)
    for (let y = 30; y < 40; y++) for (let x = 60; x < 62; x++) target.data[y * W + x] = 255;
    // real neighbour touching the band but extending far beyond it (x=62..150)
    for (let y = 50; y < 90; y++) for (let x = 62; x < 150; x++) target.data[y * W + x] = 255;
    const cleared = cleanupSlivers(target, removed, 8);
    expect(cleared).toBe(20);
    expect(target.data[35 * W + 60]).toBe(0);
    expect(target.data[70 * W + 100]).toBe(255);
  });
  it('object remove edits apply the cleanup; brush removes do not', () => {
    const W = 50, H = 50;
    const base = createMask(W, H);
    const obj = createMask(W, H);
    for (let y = 10; y < 30; y++) for (let x = 10; x < 30; x++) { obj.data[y * W + x] = 255; base.data[y * W + x] = 255; }
    base.data[20 * W + 31] = 255; // 1px leftover just outside the object
    const out = composeMask(W, H, base, [{ kind: 'object', mode: 'remove', point: { x: 20, y: 20 }, mask: obj }]);
    expect(area(out)).toBe(0);
  });
});
