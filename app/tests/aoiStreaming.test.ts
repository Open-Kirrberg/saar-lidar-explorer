import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FOCUS_AREAS, KNOWN_AOIS, aoiParam, bboxRing, chooseAoi, inBbox } from '../src/map/aois';
import { needsRefine, pendingText, progressPending, terrainPending } from '../src/ui/streaming';

describe('known AOIs', () => {
  it('match pipeline/aois.toml bboxes', () => {
    const toml = readFileSync(resolve(import.meta.dirname, '../../pipeline/aois.toml'), 'utf8');
    for (const a of KNOWN_AOIS) {
      const sec = toml.split(`[${a.id}]`)[1];
      expect(sec, a.id).toBeDefined();
      const m = /bbox\s*=\s*\[([^\]]+)\]/.exec(sec!);
      expect(m![1].split(',').map((v) => Number(v.trim()))).toEqual(a.bbox);
    }
    expect(FOCUS_AREAS.map((a) => a.id)).toEqual(['karlsberg', 'homburg', 'kirrberg']);
  });

  it('overall covers every focus area', () => {
    const o = KNOWN_AOIS.find((a) => a.id === 'overall')!.bbox;
    for (const f of FOCUS_AREAS) {
      expect(inBbox(o, f.bbox[0], f.bbox[1])).toBe(true);
      expect(inBbox(o, f.bbox[2], f.bbox[3])).toBe(true);
    }
  });

  it('chooses overall when present, karlsberg otherwise, ?aoi= always wins', () => {
    expect(chooseAoi('', true)).toBe('overall');
    expect(chooseAoi('', false)).toBe('karlsberg');
    expect(chooseAoi('?aoi=fixture', true)).toBe('fixture');
    expect(chooseAoi('?aoi=../x', true)).toBe('overall'); // invalid → ignored
    expect(aoiParam('?foo=1&aoi=homburg')).toBe('homburg');
    expect(aoiParam('?aoi=')).toBeNull();
  });

  it('bboxRing densifies all four edges counter-clockwise from SW', () => {
    const r = bboxRing([0, 0, 8, 4], 4);
    expect(r).toHaveLength(16);
    expect(r[0]).toEqual([0, 0]);
    expect(r[4]).toEqual([8, 0]);
    expect(r[8]).toEqual([8, 4]);
    expect(r[12]).toEqual([0, 4]);
    expect(r[1]).toEqual([2, 0]);
  });
});

describe('streaming status', () => {
  it('reads pending from terrain stats defensively', () => {
    expect(terrainPending(null)).toBeNull();
    expect(terrainPending({ stats: { visible: 3 } })).toBeNull();
    expect(terrainPending({ stats: { pending: 7 } })).toBe(7);
    expect(terrainPending({ stats: { queued: 4, inFlight: 2 } })).toBe(6);
    expect(terrainPending({ stats: { wanted: 10, resident: 12 } })).toBe(0);
    expect(terrainPending({ streamStats: () => ({ pending: 5 }), stats: { pending: 1 } })).toBe(5);
    expect(terrainPending({ stats: { pending: NaN, loading: 3 } })).toBe(3);
  });

  it('counts outstanding chunks of the initial load', () => {
    expect(progressPending(null, false)).toBe(0);
    expect(progressPending({ loaded: 10, total: 48, failed: 2 }, false)).toBe(36);
    expect(progressPending({ loaded: 10, total: 48, failed: 2 }, true)).toBe(0);
  });

  it('formats the HUD text in German', () => {
    expect(pendingText(0)).toBe('');
    expect(pendingText(3)).toBe('Lade Details … 3');
    expect(pendingText(1234)).toBe('Lade Details … 1.234');
  });
});

describe('fly-to refinement', () => {
  it('refines unknown → known, and large changes only', () => {
    expect(needsRefine(NaN, 250, 60)).toBe(true);
    expect(needsRefine(NaN, NaN, 60)).toBe(false);
    expect(needsRefine(250, NaN, 60)).toBe(false);
    expect(needsRefine(250, 252, 60)).toBe(false); // < max(3, 9)
    expect(needsRefine(250, 260, 60)).toBe(true);
    expect(needsRefine(250, 254, 10)).toBe(true); // > max(3, 1.5)
  });
});
