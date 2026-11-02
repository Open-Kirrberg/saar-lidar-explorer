import { describe, expect, it } from 'vitest';
import { createStore } from '../src/state';
import {
  DEFAULT_SETTINGS,
  PREF_KEYS,
  SETTINGS_KEY,
  isResettableKey,
  loadSettings,
  parseSettings,
  poseOnlyHash,
  resetSettings,
  saveSettings,
  settingsFromState,
  settingsStatePatch,
} from '../src/ui/settings';
import type { KeyValueStore } from '../src/ui/settings';

class MemKv implements KeyValueStore {
  m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  get length() {
    return this.m.size;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
}

describe('settings parse / migrate / validate', () => {
  it('falls back to defaults for garbage, arrays and future versions', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('x')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings([1, 2])).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings({ v: 2, quality: 'niedrig' })).toEqual(DEFAULT_SETTINGS);
  });

  it('accepts unversioned objects as v1 and clamps ranges', () => {
    const s = parseSettings({
      quality: 'mittel',
      exaggeration: 9,
      sunAzimuth: -45,
      sunElevation: 0,
      sunDirections: 40,
      overlayOpacity: 3,
      forest: 'jungle',
      baseSpeed: 500,
      minClearance: 0,
      hudHelp: false,
      onboardingSeen: true,
      layer: '',
    });
    expect(s).toEqual({
      v: 1,
      quality: 'mittel',
      exaggeration: 5,
      sunAzimuth: 315,
      sunElevation: 1,
      sunDirections: 16,
      overlayOpacity: 1,
      baseSpeed: 60,
      minClearance: 0.5,
      hudHelp: false,
      onboardingSeen: true,
    });
  });

  it('drops wrong types field by field', () => {
    const s = parseSettings({ v: 1, quality: 'ultra', exaggeration: '2', hudHelp: 'yes', overlay: 5, forest: 'full' });
    expect(s).toEqual({ ...DEFAULT_SETTINGS, forest: 'full' });
  });

  it('load/save round-trip; corrupt JSON and missing storage give defaults', () => {
    const kv = new MemKv();
    expect(loadSettings(kv)).toEqual(DEFAULT_SETTINGS);
    const s = { ...DEFAULT_SETTINGS, quality: 'niedrig' as const, exaggeration: 2.5 };
    expect(saveSettings(kv, s)).toBe(true);
    expect(loadSettings(kv)).toEqual(s);
    kv.setItem(SETTINGS_KEY, '{nope');
    expect(loadSettings(kv)).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(saveSettings(null, s)).toBe(false);
    const throwing: KeyValueStore = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {},
    };
    expect(loadSettings(throwing)).toEqual(DEFAULT_SETTINGS);
    expect(saveSettings(throwing, s)).toBe(false);
  });
});

describe('settings ↔ store', () => {
  it('state patch validates layers; unknown overlay becomes off', () => {
    const valid = new Set(['vat', 'slrm']);
    const s = parseSettings({ layer: 'gone', overlay: 'also-gone', exaggeration: 2, sunAzimuth: 90 });
    expect(settingsStatePatch(s, (k) => valid.has(k))).toEqual({ overlay: '', exaggeration: 2, sunAzimuth: 90 });
    expect(settingsStatePatch(parseSettings({ layer: 'vat', overlay: '' }), (k) => valid.has(k))).toEqual({ layer: 'vat', overlay: '' });
    expect(settingsStatePatch(DEFAULT_SETTINGS)).toEqual({});
  });

  it('copies the mirrored store fields and round-trips through parse', () => {
    const st = createStore({ layer: 'vat', exaggeration: 3, sunElevation: 12, forest: 'transparent' }).get();
    const s = settingsFromState(DEFAULT_SETTINGS, st);
    expect(s).toMatchObject({ layer: 'vat', exaggeration: 3, sunElevation: 12, forest: 'transparent', overlay: '', quality: 'hoch' });
    expect(parseSettings(JSON.parse(JSON.stringify(s)))).toEqual(s);
    // No pose in the settings (that's the hash's job).
    expect(s).not.toHaveProperty('E');
  });
});

describe('settings reset', () => {
  it('removes preference keys but never markers, candidate reviews or measurements', () => {
    const kv = new MemKv();
    for (const k of PREF_KEYS) kv.setItem(k, '{}');
    const privateKeys = ['sle.markers.v1', 'sle.candidates.v1.karlsberg', 'sle.measure.v1.overall', 'other.app'];
    for (const k of privateKeys) kv.setItem(k, '[1]');
    kv.setItem('sle.candidates.prefs.v1.karlsberg', '{}'); // per-AOI variant of a pref key
    kv.setItem('sle.uiX', '{}'); // only exact keys or `<key>.<suffix>` match
    const removed = resetSettings(kv);
    expect(removed.sort()).toEqual([...PREF_KEYS, 'sle.candidates.prefs.v1.karlsberg'].sort());
    expect([...kv.m.keys()].sort()).toEqual([...privateKeys, 'sle.uiX'].sort());
    expect(resetSettings(kv)).toEqual([]);
    expect(resetSettings(null)).toEqual([]);
    // Storage without enumeration still clears the fixed keys.
    const plain = { m: new Map<string, string>([['sle.ui.v1', '{}']]), getItem(k: string) { return this.m.get(k) ?? null; }, setItem() {}, removeItem(k: string) { this.m.delete(k); } };
    expect(resetSettings(plain)).toEqual(['sle.ui.v1']);
  });

  it('no private key is listed as a preference', () => {
    for (const k of ['sle.markers.v1', 'sle.candidates.v1', 'sle.candidates.v1.x', 'sle.measure.v1.x']) expect(isResettableKey(k)).toBe(false);
    expect(isResettableKey('sle.candidates.prefs.v1.overall')).toBe(true);
    expect(isResettableKey('sle.candidates.prefs.v1')).toBe(true);
    expect(isResettableKey('sle.ui.v1')).toBe(true);
  });

  it('poseOnlyHash keeps the camera fields only', () => {
    expect(poseOnlyHash('#1,2,3,4,5,vat,slrm,0.5,full,3,90,20,4')).toBe('#1,2,3,4,5');
    expect(poseOnlyHash('#1,2,3,4,5')).toBe('#1,2,3,4,5');
    expect(poseOnlyHash('')).toBe('');
    expect(poseOnlyHash('#1,2')).toBe('');
  });
});
