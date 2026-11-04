// Wave-10 review fix (audit #4): the canvas compositions are painted once into an atlas and dealt out per wall.
import { describe, expect, it } from 'vitest';
import { ATLAS, ATLAS_PX, CANVAS_KINDS, KIND_ASPECT, PaintingHang, VARIANTS_PER_KIND, atlasUv, canvasParams, kindTiles, paintingVariants, variantClass } from '../src/interior/painting.ts';
import { ageCanvas, paintComposition, paintingAtlas } from '../src/interior/paintingArt.ts';

describe('painting atlas: compositions', () => {
  const v = paintingVariants();
  it('fills the atlas exactly, genre blocks in tile order, deterministic', () => {
    expect(v.length).toBe(ATLAS.cols * ATLAS.rows);
    for (const k of CANVAS_KINDS) {
      const [first, n] = kindTiles(k);
      expect(n).toBe(VARIANTS_PER_KIND[k]);
      for (let i = first; i < first + n; i++) expect(v[i].kind).toBe(k);
    }
    expect(paintingVariants()).toEqual(v);
  });
  it('portraits vary sitter, head, coat, turn and never repeat a class', () => {
    const p = v.filter((s) => s.kind === 'portrait');
    expect(new Set(p.map(variantClass)).size).toBe(p.length);
    expect(new Set(p.map((s) => (s.kind === 'portrait' ? s.sitter : '')))).toEqual(new Set(['man', 'woman']));
    expect(new Set(p.map((s) => (s.kind === 'portrait' ? s.head : ''))).size).toBe(4);
    expect(new Set(p.map((s) => (s.kind === 'portrait' ? s.coat : ''))).size).toBeGreaterThanOrEqual(8);
    expect(new Set(p.map((s) => (s.kind === 'portrait' ? s.turn : 0))).size).toBe(2);
  });
  it('history pieces and still lifes differ in setting / subject', () => {
    expect(new Set(v.filter((s) => s.kind === 'history').map(variantClass)).size).toBeGreaterThanOrEqual(9);
    expect(new Set(v.filter((s) => s.kind === 'stilllife').map(variantClass)).size).toBeGreaterThanOrEqual(9);
  });
});

describe('painting atlas: the hang', () => {
  it('never repeats a composition on one wall before the genre is used up', () => {
    const h = new PaintingHang();
    const [first, n] = kindTiles('portrait');
    const got = Array.from({ length: n }, (_, i) => h.pick('room|w1', 'portrait', 1000 + i * 7).tile);
    expect(new Set(got).size).toBe(n);
    for (const t of got) expect(t >= first && t < first + n).toBe(true);
    // the next one starts over; another wall is independent
    expect(h.pick('room|w1', 'portrait', 5).tile).toBeGreaterThanOrEqual(first);
    expect(h.pick('room|w2', 'portrait', 1000).tile).toBe(got[0]);
  });
  it('is deterministic for the same call sequence', () => {
    const run = () => {
      const h = new PaintingHang();
      return [3, 9, 3, 3, 17].map((s) => h.pick('w', 'landscape', s));
    };
    expect(run()).toEqual(run());
  });
});

describe('painting atlas: canvas attribute and UV', () => {
  it('canvasParams encodes tile + 1, the signed tile aspect and the canvas size', () => {
    expect(canvasParams('portrait', 21, false, 0.8, 1)).toEqual([22, KIND_ASPECT.portrait, 0.8, 1]);
    expect(canvasParams('landscape', 3, true, 1.2, 0.9)[1]).toBe(-KIND_ASPECT.landscape);
  });
  it('maps canvas corners inside the tile (gutter kept), cover fit and mirror', () => {
    const T = ATLAS.tile / ATLAS_PX;
    const G = ATLAS.gutter / ATLAS_PX;
    const p = canvasParams('landscape', 9, false, KIND_ASPECT.landscape, 1); // same aspect: whole tile interior
    const [u0, v0] = atlasUv(p, 0, 0);
    const [u1, v1] = atlasUv(p, 1, 1);
    const cx = 9 % ATLAS.cols;
    const cy = Math.floor(9 / ATLAS.cols);
    expect(u0).toBeCloseTo(cx * T + G, 9);
    expect(u1).toBeCloseTo((cx + 1) * T - G, 9);
    expect(v1).toBeCloseTo(1 - (cy * T + G), 9); // top of the canvas = top of the tile row (flipY)
    expect(v0).toBeCloseTo(1 - ((cy + 1) * T - G), 9);
    // a taller canvas crops the sides, a mirrored one swaps them
    const tall = canvasParams('landscape', 9, false, 0.68, 1);
    expect(atlasUv(tall, 0, 0.5)[0]).toBeGreaterThan(u0 + 0.2 * (u1 - u0));
    const m = canvasParams('landscape', 9, true, KIND_ASPECT.landscape, 1);
    expect(atlasUv(m, 0, 0.5)[0]).toBeCloseTo(u1, 9);
  });
});

describe('painting atlas: painter', () => {
  it('runs every composition against a 2-D context without text or images', () => {
    const calls = new Set<string>();
    const grad = { addColorStop: () => {} };
    const ctx = new Proxy(
      {},
      {
        get: (_t, k) => {
          if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => grad;
          return (..._a: unknown[]) => {
            calls.add(String(k));
          };
        },
        set: () => true,
      },
    ) as unknown as CanvasRenderingContext2D;
    for (const s of paintingVariants()) paintComposition(ctx, s, 512);
    ageCanvas(ctx, 0, 0, 248, 248, 1);
    expect(calls.has('fillText')).toBe(false);
    expect(calls.has('drawImage')).toBe(false);
    expect(calls.has('fill')).toBe(true);
  });
  it('has no atlas in Node (the vertex-colour canvases stay)', () => {
    expect(paintingAtlas()).toBeNull();
  });
});
