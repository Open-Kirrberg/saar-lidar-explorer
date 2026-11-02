import { describe, expect, it } from 'vitest';
import { HASH_KEYS, PRESET_OVERRIDE_KEYS, createStore, formatHash, hashDisplayPatch, hashPatch, parseHash, presetOverrides, safeDecode, shareUrl } from '../src/state';
import type { HashState } from '../src/state';

const full: HashState = {
  E: 382165.3,
  N: 5466074.5,
  h: 412.7,
  heading: 123.4,
  pitch: -25,
  layer: 'vat',
  overlay: 'slrm',
  overlayOpacity: 0.65,
  forest: 'transparent',
};

describe('URL hash format', () => {
  it('round-trips pose, layer, overlay, opacity and forest', () => {
    const h = formatHash(full);
    expect(h).toBe('#382165.3,5466074.5,412.7,123.4,-25,vat,slrm,0.65,transparent');
    expect(parseHash(h)).toEqual(full);
  });

  it('round-trips "no overlay" as an empty field', () => {
    const s = { ...full, overlay: '', forest: 'off' as const };
    const h = formatHash(s);
    expect(h).toBe('#382165.3,5466074.5,412.7,123.4,-25,vat,,0.65,off');
    expect(parseHash(h)).toEqual(s);
  });

  it('encodes keys with special characters', () => {
    const s = { ...full, layer: 'a,b%c', overlay: 'live-lrm' };
    expect(parseHash(formatHash(s))).toEqual(s);
  });

  it('round-trips the defaults of a fresh store', () => {
    const st = createStore({ E: 380000, N: 5465000, h: 300 }).get();
    const p = parseHash(formatHash(st))!;
    expect(p).toMatchObject({ layer: st.layer, overlay: '', overlayOpacity: 0.5, forest: 'off' });
  });

  it('still parses old 5- and 6-field hashes (no overlay/forest fields)', () => {
    expect(parseHash('#382165.3,5466074.5,412.7,123.4,-25')).toEqual({ E: 382165.3, N: 5466074.5, h: 412.7, heading: 123.4, pitch: -25 });
    const p = parseHash('#382165.3,5466074.5,412.7,123.4,-25,live-slope')!;
    expect(p.layer).toBe('live-slope');
    expect(p).not.toHaveProperty('overlay');
    expect(p).not.toHaveProperty('overlayOpacity');
    expect(p).not.toHaveProperty('forest');
    // An old hash leaves overlay/forest in the store untouched.
    expect(hashDisplayPatch(p)).toEqual({ layer: 'live-slope' });
  });

  it('normalises heading/pitch and clamps opacity', () => {
    const p = parseHash('#1,2,3,-90,-120,vat,slrm,7,full')!;
    expect(p.heading).toBe(270);
    expect(p.pitch).toBe(-89);
    expect(p.overlayOpacity).toBe(1);
  });

  it('ignores unknown forest modes and non-numeric opacity', () => {
    const p = parseHash('#1,2,3,4,5,vat,slrm,abc,jungle')!;
    expect(p.overlay).toBe('slrm');
    expect(p).not.toHaveProperty('overlayOpacity');
    expect(p).not.toHaveProperty('forest');
  });

  it('rejects hashes with missing or empty pose numbers', () => {
    expect(parseHash('')).toBeNull();
    expect(parseHash('#1,2,3')).toBeNull();
    expect(parseHash('#,,,,')).toBeNull();
    expect(parseHash('#1,2,x,4,5')).toBeNull();
  });
});

describe('URL hash robustness (R0.4)', () => {
  it('safeDecode returns null on malformed escapes', () => {
    expect(safeDecode('%E0%A4%A')).toBeNull();
    expect(safeDecode('%')).toBeNull();
    expect(safeDecode('live%2Dlrm')).toBe('live-lrm');
  });

  it('does not throw on a malformed % in layer or overlay; keeps the pose', () => {
    expect(() => parseHash('#1,2,3,4,5,%E0%A4%A')).not.toThrow();
    const p = parseHash('#1,2,3,4,5,%E0%A4%A,%,0.4,full')!;
    expect(p).toMatchObject({ E: 1, N: 2, h: 3, heading: 4, pitch: 5, overlayOpacity: 0.4, forest: 'full' });
    expect(p).not.toHaveProperty('layer');
    expect(p).not.toHaveProperty('overlay');
  });

  it('drops layers the validator rejects; unknown overlays become "off"', () => {
    const valid = new Set(['vat', 'slrm', 'live-hillshade']);
    const isValidLayer = (k: string) => valid.has(k);
    const p = parseHash('#1,2,3,4,5,nope,alsonope,0.3,full')!;
    expect(hashDisplayPatch(p, { isValidLayer })).toEqual({ overlay: '', overlayOpacity: 0.3, forest: 'full' });
    const q = parseHash('#1,2,3,4,5,vat,slrm,0.3,off')!;
    expect(hashPatch(q, { isValidLayer })).toEqual({
      E: 1,
      N: 2,
      h: 3,
      heading: 4,
      pitch: 5,
      layer: 'vat',
      overlay: 'slrm',
      overlayOpacity: 0.3,
      forest: 'off',
    });
    // An empty overlay is always valid (= off).
    expect(hashDisplayPatch(parseHash('#1,2,3,4,5,vat,,0.3,off')!, { isValidLayer }).overlay).toBe('');
  });
});

describe('URL hash view fields (final polish: exaggeration + sun)', () => {
  const view = { ...full, exaggeration: 2.5, sunAzimuth: 315, sunElevation: 20, sunDirections: 4 };

  it('appends exaggeration and sun as fields 10–13 and round-trips them', () => {
    const h = formatHash(view);
    expect(h).toBe('#382165.3,5466074.5,412.7,123.4,-25,vat,slrm,0.65,transparent,2.5,315,20,4');
    expect(parseHash(h)).toEqual({ ...view, preset: '' }); // 13 fields = "no preset"
    expect(hashDisplayPatch(parseHash(h)!)).toMatchObject({ exaggeration: 2.5, sunAzimuth: 315, sunElevation: 20, sunDirections: 4 });
  });

  it('a fresh store always writes all 13 fields', () => {
    const st = createStore({ E: 380000, N: 5465000, h: 300 }).get();
    expect(formatHash(st).split(',')).toHaveLength(13);
    expect(parseHash(formatHash(st))).toMatchObject({ exaggeration: 1, sunAzimuth: 315, sunElevation: 35, sunDirections: 1 });
    for (const k of ['exaggeration', 'sunAzimuth', 'sunElevation', 'sunDirections'] as const) expect(HASH_KEYS).toContain(k);
  });

  it('9-field hashes (v0.12 bookmarks) leave exaggeration and sun alone', () => {
    const p = parseHash('#1,2,3,4,5,vat,slrm,0.3,off')!;
    expect(p).not.toHaveProperty('exaggeration');
    expect(p).not.toHaveProperty('sunAzimuth');
    expect(hashDisplayPatch(p)).not.toHaveProperty('exaggeration');
  });

  it('clamps and normalises the view fields; drops invalid ones individually', () => {
    const p = parseHash('#1,2,3,4,5,vat,,0.5,off,12,-45,0,99')!;
    expect(p).toMatchObject({ exaggeration: 5, sunAzimuth: 315, sunElevation: 1, sunDirections: 16 });
    const q = parseHash('#1,2,3,4,5,vat,,0.5,off,abc,,x,2.6')!;
    expect(q).not.toHaveProperty('exaggeration');
    expect(q).not.toHaveProperty('sunAzimuth');
    expect(q).not.toHaveProperty('sunElevation');
    expect(q.sunDirections).toBe(3);
    expect(parseHash('#1,2,3,4,5,vat,,0.5,off,0')).not.toHaveProperty('exaggeration'); // 0 is not a scale
  });

  it('shareUrl keeps path and query, rebuilds the hash from state only', () => {
    const loc = { origin: 'http://127.0.0.1:5247', pathname: '/', search: '?aoi=karlsberg' };
    const url = shareUrl(loc, view);
    expect(url).toBe('http://127.0.0.1:5247/?aoi=karlsberg#382165.3,5466074.5,412.7,123.4,-25,vat,slrm,0.65,transparent,2.5,315,20,4');
    // Nothing but the 13 hash fields: no marker/candidate payload can sneak in.
    expect(new URL(url).hash.slice(1).split(',')).toHaveLength(13);
  });
});

describe('URL hash field 14: blend preset ("Ansicht teilen" carries blend/stretch/colormap/LRM radius)', () => {
  const view = { ...full, exaggeration: 2.5, sunAzimuth: 315, sunElevation: 25, sunDirections: 1 };

  it('appends the active preset id as field 14 and round-trips it', () => {
    const h = formatHash({ ...view, preset: 'schummer-lrm' });
    expect(h).toBe('#382165.3,5466074.5,412.7,123.4,-25,vat,slrm,0.65,transparent,2.5,315,25,1,schummer-lrm');
    expect(parseHash(h)).toEqual({ ...view, preset: 'schummer-lrm' });
    expect(hashDisplayPatch(parseHash(h)!)).toMatchObject({ preset: 'schummer-lrm' });
    expect(HASH_KEYS).toContain('preset');
  });

  it('no preset → no field 14; a fresh store has none', () => {
    expect(formatHash({ ...view, preset: '' }).split(',')).toHaveLength(13);
    expect(createStore().get().preset).toBe('');
  });

  it('older links stay parseable: 9 fields say nothing about the preset, 13 fields mean none', () => {
    expect(parseHash('#1,2,3,4,5,vat,slrm,0.3,off')).not.toHaveProperty('preset');
    expect(hashDisplayPatch(parseHash('#1,2,3,4,5,vat,slrm,0.3,off')!)).not.toHaveProperty('preset');
    expect(parseHash('#1,2,3,4,5,vat,slrm,0.3,off,2,315,35,1')!.preset).toBe('');
  });

  it('rejects malformed ids (they never reach the panel)', () => {
    expect(parseHash('#1,2,3,4,5,vat,,0.5,off,1,315,35,1,%3Cx%3E')!.preset).toBe('');
    expect(parseHash('#1,2,3,4,5,vat,,0.5,off,1,315,35,1,a b')!.preset).toBe('');
    expect(formatHash({ ...view, preset: '<x>' }).split(',')).toHaveLength(13);
  });

  it('presetOverrides keeps the link\'s own display fields to re-apply on top of the preset', () => {
    const st = createStore({ layer: 'live-hillshade', overlay: 'live-lrm', overlayOpacity: 0.3, sunAzimuth: 200, preset: 'schummer-lrm' }).get();
    const o = presetOverrides(st);
    expect(Object.keys(o).sort()).toEqual([...PRESET_OVERRIDE_KEYS].sort());
    expect(o).toMatchObject({ layer: 'live-hillshade', overlay: 'live-lrm', overlayOpacity: 0.3, sunAzimuth: 200 });
    expect(o).not.toHaveProperty('preset');
  });
});
