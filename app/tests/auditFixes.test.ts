/** Regression tests for the v1.0.1 audit fixes (pure parts). */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dataRootUrl } from '../src/data/manifest';
import { mergeOverlayPrefs, syncOverlayPrefs } from '../src/map/overlays';
import { copyWith, withTimeout } from '../src/ui/clipboard';
import { trapIndex } from '../src/ui/modalKeys';

describe('minimap overlay prefs are merged across AOIs (overlays-5)', () => {
  const VAT = 'Relief: VAT (Kombination)';
  const defaults = [VAT, 'Untersuchungsgebiet', 'Bekannte Orte'];
  const overall = [VAT, 'Relief: SLRM', 'Historische Karte 1840', 'Untersuchungsgebiet', 'Bekannte Orte'];
  const fixture = ['Untersuchungsgebiet', 'Bekannte Orte'];

  it('a VAT switched off stays off after visiting an AOI without it', () => {
    // overall: user switched VAT off (knownOverlays includes it).
    let prefs = { overlays: ['Untersuchungsgebiet', 'Historische Karte 1840'], knownOverlays: overall };
    // fixture visit: nothing is new; known keeps the overall names.
    prefs = { ...prefs, ...mergeOverlayPrefs(prefs, fixture, defaults) };
    expect(prefs.knownOverlays).toEqual(expect.arrayContaining(overall));
    // toggling in the fixture keeps the saved on-state of overall-only overlays.
    prefs.overlays = syncOverlayPrefs(prefs.overlays, fixture, []);
    expect(prefs.overlays).toEqual(['Historische Karte 1840']);
    // back to overall: VAT is not switched on again.
    const back = mergeOverlayPrefs(prefs, overall, defaults);
    expect(back.overlays).not.toContain(VAT);
    expect(back.overlays).toContain('Historische Karte 1840');
  });

  it('a default overlay never seen before is switched on once', () => {
    const first = mergeOverlayPrefs({ overlays: ['Untersuchungsgebiet'], knownOverlays: fixture }, overall, defaults);
    expect(first.overlays).toContain(VAT);
    // Legacy prefs (no knownOverlays) knew everything this AOI defines except the listed names.
    const legacy = mergeOverlayPrefs({ overlays: [] }, [...fixture, 'Schwerpunktgebiete'], ['Schwerpunktgebiete'], ['Schwerpunktgebiete']);
    expect(legacy.overlays).toEqual(['Schwerpunktgebiete']);
  });
});

describe('share: clipboard with timeout (gap 1)', () => {
  it('withTimeout resolves the fallback when the promise never settles', async () => {
    vi.useFakeTimers();
    const p = withTimeout(new Promise<boolean>(() => {}), 1500, false);
    vi.advanceTimersByTime(1500);
    await expect(p).resolves.toBe(false);
    vi.useRealTimers();
  });

  it('falls back to execCommand when writeText hangs or throws', async () => {
    const exec = vi.fn(() => true);
    await expect(copyWith('u', { writeText: () => new Promise(() => {}), execCopy: exec, timeoutMs: 5 })).resolves.toBe(true);
    expect(exec).toHaveBeenCalledTimes(1);
    await expect(copyWith('u', { writeText: () => Promise.reject(new Error('denied')), execCopy: () => false })).resolves.toBe(false);
    const ok = vi.fn(() => true);
    await expect(copyWith('u', { writeText: () => Promise.resolve(), execCopy: ok })).resolves.toBe(true);
    expect(ok).not.toHaveBeenCalled();
    await expect(copyWith('u', { execCopy: () => { throw new Error('x'); } })).resolves.toBe(false);
  });
});

describe('modal focus trap (ui-5)', () => {
  it('cycles Tab / Shift+Tab within the dialog', () => {
    expect(trapIndex(2, 0, false)).toBe(1);
    expect(trapIndex(2, 1, false)).toBe(0);
    expect(trapIndex(2, 0, true)).toBe(1);
    expect(trapIndex(3, -1, false)).toBe(0);
    expect(trapIndex(3, -1, true)).toBe(2);
    expect(trapIndex(0, -1, false)).toBe(-1);
  });
});

describe('dataRootUrl (gap 4)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('resolves a relative base against the page URL (workers need absolute URLs)', () => {
    vi.stubEnv('BASE_URL', './');
    vi.stubEnv('VITE_DATA_URL', '');
    vi.stubGlobal('location', { href: 'http://localhost:5240/sub/index.html?aoi=overall#x' });
    expect(dataRootUrl()).toBe('http://localhost:5240/sub/data/');
  });

  it('keeps an absolute base root-relative to the origin', () => {
    vi.stubEnv('BASE_URL', '/');
    vi.stubEnv('VITE_DATA_URL', '');
    vi.stubGlobal('location', { href: 'http://localhost:5240/sub/index.html' });
    expect(dataRootUrl()).toBe('http://localhost:5240/data/');
  });

  it('VITE_DATA_URL wins (trailing slash added; relative ones resolved too)', () => {
    vi.stubGlobal('location', { href: 'http://localhost:5240/app/' });
    vi.stubEnv('VITE_DATA_URL', 'https://data.example.org/sle');
    expect(dataRootUrl()).toBe('https://data.example.org/sle/');
    vi.stubEnv('VITE_DATA_URL', '../shared/');
    expect(dataRootUrl()).toBe('http://localhost:5240/shared/');
  });

  it('without a location (worker/node) returns the unresolved root', () => {
    vi.stubEnv('BASE_URL', './');
    vi.stubEnv('VITE_DATA_URL', '');
    vi.stubGlobal('location', undefined);
    expect(dataRootUrl()).toBe('./data/');
  });
});
