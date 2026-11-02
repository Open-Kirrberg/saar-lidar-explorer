import { describe, expect, it } from 'vitest';
import type { ImageLayerSource, LayerSource, XyzSource } from '../src/data/manifest';
import { DOP_WMS, isImageXyz, xyzOverlay } from '../src/map/overlays';
import { chunkGpuBytes, imageGpuBytes } from '../src/terrain/budget';
import { APRON_NEIGHBOURS, buildLayerApron } from '../src/terrain/layerApron';
import { apronImageUv, opposite, SIDE_BIT, SIDE_OFFSET, SIDES } from '../src/terrain/imageSides';
import { BlendMode, IMAGE_PRESETS, imageModes, mixTexts, mixToOpacity, opacityToMix, PRESETS, shortImageLabel, ShaderSource } from '../src/terrain/relief';
import { bldgMask, houseAt, houseRoofAt } from '../scripts/fixture-imagery';
import type { House } from '../scripts/fixture-buildings';

/** n×n chunk whose texel value encodes its global cell (c, r) of a 3×3-chunk mosaic. */
function chunk(i: number, j: number, n: number): Uint8Array {
  const a = new Uint8Array(n * n);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) a[r * n + c] = ((j * n + r) * 3 * n + (i * n + c)) % 251;
  return a;
}
const mosaicAt = (c: number, r: number, n: number) => ((r * 3 * n + c) % 251);

describe('layer apron (seam fix)', () => {
  const n = 4;
  it('copies all 8 neighbours so the apron continues the mosaic', () => {
    const own = chunk(1, 1, n);
    const { data, mask } = buildLayerApron(own, n, (di, dj) => chunk(1 + di, 1 + dj, n));
    expect(mask).toBe(0xff);
    const S = n + 2;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) expect(data[y * S + x]).toBe(mosaicAt(n - 1 + x, n - 1 + y, n));
    }
  });

  it('clamps to the own edge where a neighbour is missing', () => {
    const own = chunk(1, 1, n);
    const only = new Set(['1,0']); // east only
    const { data, mask } = buildLayerApron(own, n, (di, dj) => (only.has(`${di},${dj}`) ? chunk(1 + di, 1 + dj, n) : undefined));
    expect(mask).toBe(1 << APRON_NEIGHBOURS.findIndex(([a, b]) => a === 1 && b === 0));
    const S = n + 2;
    for (let r = 0; r < n; r++) {
      expect(data[(r + 1) * S]).toBe(own[r * n]); // west: clamp
      expect(data[(r + 1) * S + S - 1]).toBe(mosaicAt(2 * n, n + r, n)); // east: neighbour
    }
    for (let c = 0; c < n; c++) {
      expect(data[c + 1]).toBe(own[c]); // north: clamp
      expect(data[(S - 1) * S + c + 1]).toBe(own[(n - 1) * n + c]); // south: clamp
    }
    // NE corner without the diagonal: the adjacent north apron texel (= clamp of the own corner).
    expect(data[S - 1]).toBe(data[S - 2]);
  });

  it('interior equals the chunk and the size is (n+2)²', () => {
    const own = chunk(0, 0, n);
    const { data } = buildLayerApron(own, n, () => undefined);
    expect(data.length).toBe((n + 2) ** 2);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) expect(data[(r + 1) * (n + 2) + c + 1]).toBe(own[r * n + c]);
    expect(() => buildLayerApron(new Uint8Array(3), n, () => undefined)).toThrow();
  });

  it('shader UV maps height pixel p to apron texel p (centre) and images to the chunk edges', () => {
    const N = 500;
    const uvLayer = (p: number) => (p + 0.5) / (N + 2);
    const uvImg = (p: number) => (p - 0.5) / N;
    // Cell 0 centre is height pixel 1 → apron texel 1 centre; mesh edge p = 0.5 is between texels 0 and 1.
    expect(uvLayer(1) * (N + 2)).toBeCloseTo(1.5);
    expect(uvLayer(0.5) * (N + 2)).toBeCloseTo(1.0);
    expect(uvImg(0.5)).toBeCloseTo(0);
    expect(uvImg(N + 0.5)).toBeCloseTo(1);
    // 1000 px image: cell 0 centre (p = 1) is the border between image px 0 and 1.
    expect(uvImg(1) * 1000).toBeCloseTo(1);
  });
});

describe('image apron (seam fix for rgb layers)', () => {
  it('maps chunk u to apron texture coordinates', () => {
    const P = 1000;
    expect(apronImageUv(0, P) * (P + 2)).toBeCloseTo(1); // chunk edge = border between apron and px 0
    expect(apronImageUv(1, P) * (P + 2)).toBeCloseTo(P + 1);
    expect(apronImageUv(0.5 / P, P) * (P + 2)).toBeCloseTo(1.5); // centre of image px 0
  });
  it('has consistent sides', () => {
    for (const s of SIDES) {
      expect(opposite(opposite(s))).toBe(s);
      const [a, b] = SIDE_OFFSET[s];
      const [c, d] = SIDE_OFFSET[opposite(s)];
      expect([a + c, b + d]).toEqual([0, 0]);
    }
    expect(SIDES.reduce((m, s) => m | SIDE_BIT[s], 0)).toBe(15);
    expect(SIDE_OFFSET.s).toEqual([0, 1]); // +j = south = image row order
  });
});

describe('image modes, presets and the image ↔ relief slider', () => {
  const img = (label: string): ImageLayerSource => ({ path: 'x/{i}_{j}.webp', encoding: 'rgb', format: 'webp', pixelsPerChunk: 1000, kind: 'image', label_de: label });

  it('lists ortho first, then hist_* by key, without shortcuts', () => {
    const m = imageModes({ hist_1935: img('TK25 1935–40'), hist_1840: img('Karte 1836–41'), ortho: img('Luftbild (DOP20)') });
    expect(m.map((e) => e.key)).toEqual(['ortho', 'hist_1840', 'hist_1935']);
    expect(m.map((e) => e.label)).toEqual(['Luftbild', 'Karte 1840', 'Karte 1935']);
    expect(m.every((e) => e.shortcut === '')).toBe(true);
    expect(imageModes(undefined)).toEqual([]);
    expect(shortImageLabel('foo', 'Foo-Bild')).toBe('Foo-Bild');
  });

  it('image presets use the image keys of the contract and come after the relief presets', () => {
    expect(IMAGE_PRESETS.map((p) => p.label)).toEqual(['Luftbild × Relief', 'Karte 1840 ↔ Relief']);
    expect(IMAGE_PRESETS[0].base).toBe('ortho');
    expect(IMAGE_PRESETS[1].overlay?.key).toBe('hist_1840');
    const ids = new Set([...PRESETS, ...IMAGE_PRESETS].map((p) => p.id));
    expect(ids.size).toBe(PRESETS.length + IMAGE_PRESETS.length);
  });

  it('maps the slider to the overlay opacity (0 = image only, 1 = relief only)', () => {
    expect(mixToOpacity(0, 'overlay')).toBe(1); // map fully opaque
    expect(mixToOpacity(1, 'overlay')).toBe(0);
    expect(mixToOpacity(0.25, 'base')).toBe(0.25); // relief overlay at 25 % over the photo
    expect(mixToOpacity(2, 'base')).toBe(1);
    expect(mixToOpacity(0.5, null)).toBeNull();
    for (const t of [0, 0.3, 1]) {
      expect(opacityToMix(mixToOpacity(t, 'overlay')!, 'overlay')).toBeCloseTo(t);
      expect(opacityToMix(mixToOpacity(t, 'base')!, 'base')).toBeCloseTo(t);
    }
  });

  it('labels the slider as relief strength when the image is the base under a Multiply/Screen relief', () => {
    expect(mixTexts('Luftbild', 'base', BlendMode.Multiply)).toEqual({ label: 'Relief-Stärke', lo: 'Luftbild', hi: 'Luftbild × Relief' });
    expect(mixTexts('Luftbild', 'base', BlendMode.Screen).hi).toBe('Luftbild + Relief');
    expect(mixTexts('Luftbild', 'base', BlendMode.Normal)).toEqual({ label: 'Luftbild ↔ Relief', lo: 'Luftbild', hi: 'Relief' });
    expect(mixTexts('Karte 1840', 'overlay', BlendMode.Normal).hi).toBe('Relief');
    const lb = IMAGE_PRESETS.find((p) => p.id === 'luftbild-relief')!;
    expect(lb.overlay?.blend).toBe(BlendMode.Multiply);
    expect(lb.mixLabel).toBe(mixTexts('Luftbild', 'base', lb.overlay!.blend).label); // no 'Relief' end promise
  });

  it('has distinct shader source ids for images', () => {
    expect(ShaderSource.ImageA).toBe(5);
    expect(ShaderSource.ImageB).toBe(6);
  });
});

describe('GPU budget with images', () => {
  it('counts RGBA8 + mipmaps', () => {
    expect(imageGpuBytes(1000)).toBe(Math.ceil((4_000_000 * 4) / 3));
    expect(imageGpuBytes(500, false)).toBe(1_000_000);
    expect(chunkGpuBytes({ heightSide: 502, layerSide: 502, layers: 1, canopy: false, lowpass: false, extraBytes: 100 })).toBe(1008016 + 252004 + 100);
  });
});

describe('minimap overlays', () => {
  const xyz = (o: Partial<XyzSource> = {}): XyzSource => ({ url: 'xyz/k/{z}/{x}/{y}.png', minZoom: 12, maxZoom: 17, ...o });
  const layers: Record<string, LayerSource> = { vat: { path: 'v', encoding: 'u8', min: 0, max: 1, label_de: 'VAT (Kombination)' } };

  it('keeps relief names and labels historic maps from xyz / image layer / key', () => {
    expect(xyzOverlay('vat', xyz(), layers, {})).toEqual({ key: 'vat', name: 'Relief: VAT (Kombination)', image: false });
    expect(xyzOverlay('hist_1840', xyz({ kind: 'image', label_de: 'Karte 1836–41', attribution: 'A' }), layers, {})).toEqual({
      key: 'hist_1840', name: 'Karte 1836–41', image: true, attribution: 'A',
    });
    const il = { hist_1935: { path: 'p', encoding: 'rgb', format: 'jpg', pixelsPerChunk: 500, kind: 'image', label_de: 'TK25 1935–40', attribution: 'B' } } as Record<string, ImageLayerSource>;
    expect(xyzOverlay('hist_1935', xyz(), layers, il)).toMatchObject({ name: 'TK25 1935–40', image: true, attribution: 'B' });
    expect(xyzOverlay('hist_1960', xyz(), layers, undefined).name).toBe('hist_1960');
    expect(isImageXyz('slrm', {})).toBe(false);
  });

  it('DOP WMS uses the documented layer and a bounded Saarland extent', () => {
    expect(DOP_WMS.layer).toBe('sl_dop20_rgb');
    expect(DOP_WMS.label).toBe('Luftbild (DOP20)');
    expect(DOP_WMS.bounds[0][0]).toBeLessThan(49.28);
    expect(DOP_WMS.bounds[1][1]).toBeGreaterThan(7.405);
  });
});

describe('fixture building mask (contract: centre in footprint, dilated 1 m)', () => {
  const house: House = { u: 5, v: 5, len: 4, wid: 2, rotDeg: 0, eave: 3, ridge: 5 };
  it('marks centres inside and dilates by one cell', () => {
    const m = bldgMask(10, 10, [house]);
    // Footprint u ∈ [3, 7], v ∈ [4, 6] → cell centres c+0.5 ∈ {3.5..6.5}, v centres {4.5, 5.5} = rows 4, 5.
    const on = (c: number, r: number) => m[r * 10 + c];
    expect(on(3, 4)).toBe(1);
    expect(on(6, 5)).toBe(1);
    expect(on(2, 4)).toBe(1); // dilation
    expect(on(7, 6)).toBe(1); // dilation (diagonal)
    expect(on(1, 4)).toBe(0);
    expect(on(5, 2)).toBe(0);
    expect(houseAt(5, 5, [house])).not.toBeNull();
    expect(houseRoofAt(5, 6.5, [house])).toBeNaN();
  });
});
