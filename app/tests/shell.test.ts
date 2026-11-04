import { describe, expect, it, vi } from 'vitest';
import {
  APP_ROWS,
  SPLASH_GUARD_MS,
  SPLASH_MS,
  createCollapseTimer,
  rowFromEntry,
  sourceRows,
  splashLines,
  splitAttribution,
} from '../src/shell/attribution';
import type { Clock } from '../src/shell/attribution';
import { SPEED_STEPS, WALK_EYE, fmtSpeedMult, stepSpeed, walkY } from '../src/shell/flight';
import { TAPE_PX_PER_DEG, aglFill, compass, normDeg, tapeOffset } from '../src/shell/hud';
import { createFeatureRegistry } from '../src/shell/registry';
import type { FeatureDef, HostHandle } from '../src/shell/registry';
import { DEFAULT_TIER, TIER_KEY, loadTier, parseTier, saveTier, tierAllows, tierFromQuery } from '../src/shell/tiers';
import type { Tier } from '../src/shell/tiers';
import { PREF_KEYS } from '../src/ui/settings';
import { SHORTCUTS, visibleShortcuts } from '../src/ui/shortcuts';
import type { Shortcut } from '../src/ui/shortcuts';

const memKv = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    m,
  };
};

// ---- tiers ----------------------------------------------------------------------------------

describe('tiers', () => {
  it('orders standard < entdecker < labor', () => {
    expect(tierAllows('standard', 'standard')).toBe(true);
    expect(tierAllows('standard', 'entdecker')).toBe(false);
    expect(tierAllows('entdecker', 'standard')).toBe(true);
    expect(tierAllows('labor', 'entdecker')).toBe(true);
    expect(tierAllows('entdecker', 'labor')).toBe(false);
  });

  it('parses only known tiers', () => {
    expect(parseTier('labor')).toBe('labor');
    expect(parseTier('Labor')).toBeNull();
    expect(parseTier(3)).toBeNull();
    expect(parseTier(null)).toBeNull();
  });

  it('reads ?tier= without persisting it', () => {
    expect(tierFromQuery('?aoi=karlsberg&tier=entdecker')).toBe('entdecker');
    expect(tierFromQuery('?tier=root')).toBeNull();
    expect(tierFromQuery('')).toBeNull();
  });

  it('loads/saves the tier locally and defaults to Standard', () => {
    const kv = memKv();
    expect(loadTier(kv)).toBe(DEFAULT_TIER);
    expect(DEFAULT_TIER).toBe('standard');
    expect(saveTier(kv, 'labor')).toBe(true);
    expect(kv.m.get(TIER_KEY)).toBe('labor');
    expect(loadTier(kv)).toBe('labor');
    kv.m.set(TIER_KEY, 'garbage');
    expect(loadTier(kv)).toBe('standard');
    expect(loadTier(null)).toBe('standard');
    expect(saveTier(null, 'labor')).toBe(false);
    const throwing = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); }, removeItem: () => {} };
    expect(loadTier(throwing)).toBe('standard');
    expect(saveTier(throwing, 'labor')).toBe(false);
  });

  it('is cleared by "Einstellungen zurücksetzen"', () => {
    expect(PREF_KEYS).toContain(TIER_KEY);
    expect(PREF_KEYS).toContain('sle.shell.v1');
  });
});

// ---- registry -------------------------------------------------------------------------------

interface FakeHost {
  id: string;
  panel: boolean;
  released: boolean;
}

function setup(tier: Tier = 'standard') {
  const hosts = new Map<string, FakeHost>();
  const reloads: string[][] = [];
  const errors: string[] = [];
  const reg = createFeatureRegistry<FakeHost>({
    tier,
    makeHost(def, t): HostHandle<FakeHost> {
      const host: FakeHost = { id: def.id, panel: tierAllows(t, def.panelTier ?? def.tier), released: false };
      hosts.set(def.id, host);
      return {
        host,
        retier: (nt) => (host.panel = tierAllows(nt, def.panelTier ?? def.tier)),
        release: () => (host.released = true),
      };
    },
    onReloadNeeded: (ids) => reloads.push(ids),
    onError: (id) => errors.push(id),
  });
  return { reg, hosts, reloads, errors };
}

const feat = (id: string, tier: Tier, extra: Partial<FeatureDef<FakeHost>> = {}): FeatureDef<FakeHost> => ({
  id,
  tier,
  label: id,
  mount: () => () => {},
  ...extra,
});

describe('feature registry', () => {
  it('mounts only features the tier allows, after start()', () => {
    const { reg } = setup('standard');
    reg.register(feat('minimap', 'standard'));
    reg.register(feat('exaggeration', 'entdecker'));
    reg.register(feat('relief-lab', 'labor'));
    expect(reg.mounted()).toEqual([]);
    reg.start();
    expect(reg.mounted()).toEqual(['minimap']);
    reg.setTier('labor');
    expect(reg.mounted()).toEqual(['minimap', 'exaggeration', 'relief-lab']);
  });

  it('unmounts with teardown on downgrade and releases the host DOM', () => {
    const { reg, hosts, reloads } = setup('labor');
    const un = vi.fn();
    reg.register(feat('measure', 'labor', { mount: () => un }));
    reg.start();
    reg.setTier('standard');
    expect(un).toHaveBeenCalledOnce();
    expect(hosts.get('measure')!.released).toBe(true);
    expect(reg.isMounted('measure')).toBe(false);
    expect(reloads).toEqual([]);
  });

  it('asks for a reload when a feature without teardown is unmounted', () => {
    const { reg, reloads } = setup('labor');
    reg.register(feat('relief-lab', 'labor', { mount: () => undefined }));
    reg.register(feat('flight-tech', 'labor', { mount: () => undefined }));
    reg.register(feat('minimap', 'standard', { mount: () => undefined }));
    reg.start();
    reg.setTier('entdecker');
    expect(reloads).toEqual([['relief-lab', 'flight-tech']]);
    expect(reg.isMounted('minimap')).toBe(true);
  });

  it('attaches panel content from panelTier on (retier, no remount)', () => {
    const { reg, hosts } = setup('standard');
    const mount = vi.fn(() => () => {});
    reg.register(feat('osm-paths', 'standard', { panelTier: 'labor', mount }));
    reg.start();
    expect(hosts.get('osm-paths')!.panel).toBe(false);
    reg.setTier('labor');
    expect(hosts.get('osm-paths')!.panel).toBe(true);
    reg.setTier('standard');
    expect(hosts.get('osm-paths')!.panel).toBe(false);
    expect(mount).toHaveBeenCalledOnce();
  });

  it('skips unavailable features (re-evaluated on tier change)', () => {
    const { reg } = setup('standard');
    let has = false;
    reg.register(feat('buildings', 'standard', { available: () => has }));
    reg.register(feat('broken', 'standard', { available: () => { throw new Error('x'); } }));
    reg.start();
    expect(reg.isMounted('buildings')).toBe(false);
    has = true;
    reg.setTier('entdecker');
    expect(reg.isMounted('buildings')).toBe(true);
    expect(reg.isMounted('broken')).toBe(false);
  });

  it('mounts late registrations immediately (sibling features)', () => {
    const { reg } = setup('standard');
    reg.start();
    reg.register(feat('lens', 'standard'));
    reg.register(feat('lens-variants', 'entdecker'));
    expect(reg.mounted()).toEqual(['lens']);
  });

  it('handles async mounts, including a downgrade while mounting', async () => {
    const { reg, reloads } = setup('labor');
    const un = vi.fn();
    let resolve!: (u: () => void) => void;
    reg.register(feat('candidates', 'labor', { mount: () => new Promise((r) => (resolve = r)) }));
    reg.start();
    expect(reg.isMounted('candidates')).toBe(false);
    reg.setTier('standard'); // still mounting: no teardown yet → reload
    expect(reloads).toEqual([['candidates']]);
    resolve(un);
    await Promise.resolve();
    expect(un).toHaveBeenCalledOnce(); // the late teardown runs at once
    expect(reg.isMounted('candidates')).toBe(false);

    const ok = setup('standard');
    ok.reg.register(feat('places', 'standard', { mount: async () => () => {} }));
    ok.reg.start();
    await Promise.resolve();
    await Promise.resolve();
    expect(ok.reg.isMounted('places')).toBe(true);
  });

  it('reports mount errors and releases the host', async () => {
    const { reg, hosts, errors } = setup('standard');
    reg.register(feat('sync', 'standard', { mount: () => { throw new Error('boom'); } }));
    reg.register(feat('async', 'standard', { mount: () => Promise.reject(new Error('boom')) }));
    reg.start();
    await Promise.resolve();
    await Promise.resolve();
    expect(errors).toEqual(['sync', 'async']);
    expect(hosts.get('sync')!.released).toBe(true);
    expect(hosts.get('async')!.released).toBe(true);
    expect(reg.mounted()).toEqual([]);
  });

  it('rejects duplicate ids unless `replaces` names them', () => {
    const { reg } = setup('standard');
    const un = vi.fn();
    reg.register(feat('minimap', 'standard', { mount: () => un }));
    reg.start();
    expect(() => reg.register(feat('minimap', 'standard'))).toThrow(/already registered/);
    reg.register(feat('minimap', 'standard', { replaces: 'minimap', label: 'Spielkarte' }));
    expect(un).toHaveBeenCalledOnce();
    expect(reg.defs().map((d) => d.label)).toEqual(['Spielkarte']);
    expect(reg.isMounted('minimap')).toBe(true);
  });

  it('unregister tears down and notifies listeners', () => {
    const { reg } = setup('standard');
    const un = vi.fn();
    const changed = vi.fn();
    reg.onChange(changed);
    reg.start();
    const off = reg.register(feat('tutorial', 'standard', { mount: () => un }));
    off();
    off(); // idempotent
    expect(un).toHaveBeenCalledOnce();
    expect(reg.defs()).toEqual([]);
    expect(changed).toHaveBeenCalled();
  });
});

// ---- attribution (ADR 0026) -----------------------------------------------------------------

const MANIFEST_ATTR =
  '© GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0, Daten bearbeitet; © GeoBasis-DE/LVermGeoRP (2026), dl-de/by-2-0, www.lvermgeo.rlp.de, Daten bearbeitet; © GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0 (DOP20)';

describe('attribution', () => {
  it('splits the manifest string', () => {
    expect(splitAttribution(MANIFEST_ATTR)).toHaveLength(3);
    expect(splitAttribution(' a ;; b ')).toEqual(['a', 'b']);
    expect(splitAttribution(undefined)).toEqual([]);
  });

  it('classifies LVGL, RLP, OSM and unknown entries', () => {
    const [sl, rlp, dop] = splitAttribution(MANIFEST_ATTR).map(rowFromEntry);
    expect(sl.short).toBe('© GeoBasis-DE/LVGL-SL (2026)');
    expect(sl.licence?.url).toBe('https://www.govdata.de/dl-de/by-2-0');
    expect(sl.dataset?.url).toContain('lvgl.saarland.de');
    expect(sl.modified).toBe(true);
    expect(rlp.short).toBe('© GeoBasis-DE/LVermGeoRP');
    expect(rlp.dataset?.url).toBe('https://geobasis-rlp.de/data/dgm1/current/');
    expect(dop.dataset?.url).toContain('freewms/truedop');
    expect(dop.id).not.toBe(sl.id);
    expect(dop.use).toMatch(/DOP20/);
    expect(dop.modified).toBe(false);
    expect(rowFromEntry('© GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0 (ALKIS)').dataset?.url).toContain('wfs&id=414');
    expect(rowFromEntry('© OpenStreetMap-Mitwirkende, ODbL').licence?.url).toContain('openstreetmap.org/copyright');
    const other = rowFromEntry('© Stadt Homburg, dl-de/by-2-0, Daten bearbeitet');
    expect(other.short).toBe('© Stadt Homburg');
    expect(other.licence).not.toBeNull();
    expect(other.full).toBe('© Stadt Homburg, dl-de/by-2-0, Daten bearbeitet');
    expect(other.dataset).toBeNull();
  });

  it('gives every known dataset its own URI; unknown entries may carry one (V2.9)', () => {
    const rlp = (tag: string) => rowFromEntry(`© GeoBasis-DE/LVermGeoRP (2026), dl-de/by-2-0, www.lvermgeo.rlp.de, Daten bearbeitet (${tag})`);
    expect(rlp('LoD2').dataset?.url).toContain('geb3dlo');
    expect(rlp('ALKIS').dataset?.url).toContain('registry/wfs/519');
    expect(rlp('DOP20').dataset?.url).toContain('rp_dop20');
    expect(rowFromEntry('© GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0, Daten bearbeitet (LoD2)').dataset?.url).toContain('freiegeobasisdaten');
    expect(rowFromEntry('© GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0, Daten bearbeitet (Historische Karten)').dataset?.url).toContain('wms&id=2597');
    const withUrl = rowFromEntry('© Stadt Homburg, dl-de/by-2-0, https://www.homburg.de/opendata/gelaende.');
    expect(withUrl.dataset).toEqual({ label: 'homburg.de/opendata/gelaende', url: 'https://www.homburg.de/opendata/gelaende' });
    for (const r of sourceRows(MANIFEST_ATTR)) if (r.id !== 'software') expect(r.dataset?.url).toMatch(/^https:\/\//);
  });

  it('keeps manifest rows verbatim, adds app rows, dedupes by id', () => {
    const rows = sourceRows(MANIFEST_ATTR);
    expect(rows.slice(0, 3).map((r) => r.full)).toEqual(splitAttribution(MANIFEST_ATTR));
    expect(rows.length).toBe(3 + APP_ROWS.length);
    expect(sourceRows(`${MANIFEST_ATTR}; ${MANIFEST_ATTR}`).length).toBe(rows.length);
    expect(rows.some((r) => /OpenStreetMap/.test(r.short))).toBe(true);
  });

  it('splash lines are unique short notices', () => {
    const lines = splashLines(sourceRows(MANIFEST_ATTR));
    expect(lines.slice(0, 2)).toEqual(['© GeoBasis-DE/LVGL-SL (2026)', '© GeoBasis-DE/LVermGeoRP']);
    expect(new Set(lines).size).toBe(lines.length);
  });
});

function fakeClock() {
  let now = 0;
  let timers: { at: number; fn: () => void; id: number }[] = [];
  let next = 1;
  const clock: Clock = {
    now: () => now,
    setTimeout: (fn, ms) => {
      timers.push({ at: now + ms, fn, id: next });
      return next++;
    },
    clearTimeout: (id) => {
      timers = timers.filter((t) => t.id !== id);
    },
  };
  const advance = (ms: number) => {
    now += ms;
    for (const t of timers.filter((x) => x.at <= now)) {
      timers = timers.filter((x) => x !== t);
      t.fn();
    }
  };
  return { clock, advance };
}

describe('splash collapse timer (ADR 0026 rule 2)', () => {
  it('collapses after 8 s', () => {
    const { clock, advance } = fakeClock();
    const cb = vi.fn();
    const t = createCollapseTimer(cb, clock);
    advance(SPLASH_MS - 1);
    expect(cb).not.toHaveBeenCalled();
    advance(1);
    expect(cb).toHaveBeenCalledOnce();
    expect(t.collapsed).toBe(true);
  });

  it('× collapses at once, only once', () => {
    const { clock, advance } = fakeClock();
    const cb = vi.fn();
    const t = createCollapseTimer(cb, clock);
    t.dismiss();
    t.dismiss();
    advance(SPLASH_MS);
    expect(cb).toHaveBeenCalledOnce();
  });

  it('interaction collapses only after the 5 s guard', () => {
    const { clock, advance } = fakeClock();
    const cb = vi.fn();
    const t = createCollapseTimer(cb, clock);
    advance(SPLASH_GUARD_MS - 1);
    expect(t.interact()).toBe(false);
    expect(cb).not.toHaveBeenCalled();
    advance(1);
    expect(t.interact()).toBe(true);
    expect(cb).toHaveBeenCalledOnce();
    advance(SPLASH_MS);
    expect(cb).toHaveBeenCalledOnce();
  });

  it('dispose cancels without collapsing', () => {
    const { clock, advance } = fakeClock();
    const cb = vi.fn();
    createCollapseTimer(cb, clock).dispose();
    advance(SPLASH_MS * 2);
    expect(cb).not.toHaveBeenCalled();
  });
});

// ---- flight helpers -------------------------------------------------------------------------

describe('walk + speed', () => {
  it('walk keeps the eye 1.7 m over the ground, holds height over gaps', () => {
    expect(walkY(300, 450)).toBeCloseTo(300 + WALK_EYE);
    expect(walkY(Number.NaN, 450)).toBe(450);
    expect(walkY(300, 450, 2)).toBe(302);
  });

  it('steps along the speed ladder and clamps at its ends', () => {
    expect(stepSpeed(1, 1)).toBe(2);
    expect(stepSpeed(1, -1)).toBe(0.5);
    expect(stepSpeed(SPEED_STEPS.at(-1)!, 1)).toBe(SPEED_STEPS.at(-1));
    expect(stepSpeed(SPEED_STEPS[0], -1)).toBe(SPEED_STEPS[0]);
    // off-grid (wheel): one press lands on the neighbouring step in that direction
    expect(stepSpeed(1.3, 1)).toBe(2);
    expect(stepSpeed(1.3, -1)).toBe(1);
    expect(stepSpeed(3, 1)).toBe(4);
    expect(stepSpeed(3, -1)).toBe(2);
  });

  it('formats the multiplier in German', () => {
    expect(fmtSpeedMult(1)).toBe('×1');
    expect(fmtSpeedMult(0.25)).toBe('×0,25');
  });
});

// ---- keybind dialog rows --------------------------------------------------------------------

describe('visibleShortcuts', () => {
  it('hides rows of unmounted features and keeps the rest', () => {
    const none = visibleShortcuts(() => false);
    expect(none.every((r) => !r.feature)).toBe(true);
    expect(none.length).toBeGreaterThan(0);
    const all = visibleShortcuts(() => true);
    expect(all.length).toBe(SHORTCUTS.length);
    const relief = visibleShortcuts((id) => id === 'relief-lab');
    expect(relief.some((r) => r.feature === 'relief-lab')).toBe(true);
    expect(relief.some((r) => r.feature === 'measure')).toBe(false);
  });

  it('appends extra rows from sibling features', () => {
    const extra: Shortcut[] = [{ group: SHORTCUTS[0].group, keys: ['F'], label: 'Relikt-Blick', codes: ['KeyF'], feature: 'lens' }];
    expect(visibleShortcuts((id) => id === 'lens', extra).at(-1)?.label).toBe('Relikt-Blick');
    expect(visibleShortcuts(() => false, extra).some((r) => r.label === 'Relikt-Blick')).toBe(false);
  });
});

describe('game HUD helpers', () => {
  it('normalises headings into [0, 360)', () => {
    expect(normDeg(-10)).toBe(350);
    expect(normDeg(725)).toBe(5);
    expect(normDeg(Number.NaN)).toBe(0);
  });
  it('tape offset puts the heading under the centre, continuous within a turn', () => {
    // strip starts at −360°: heading 0 sits 360° into the strip
    expect(tapeOffset(0)).toBeCloseTo(-360 * TAPE_PX_PER_DEG);
    expect(tapeOffset(90) - tapeOffset(0)).toBeCloseTo(-90 * TAPE_PX_PER_DEG);
    expect(tapeOffset(360)).toBeCloseTo(tapeOffset(0));
    expect(tapeOffset(-1)).toBeCloseTo(tapeOffset(359));
  });
  it('mini height bar is log-scaled and clamped', () => {
    expect(aglFill(0)).toBe(0);
    expect(aglFill(-5)).toBe(0);
    expect(aglFill(999)).toBeCloseTo(1);
    expect(aglFill(5000)).toBe(1);
    expect(aglFill(30)).toBeGreaterThan(0.45);
    expect(aglFill(30)).toBeLessThan(0.55);
  });
  it('compass labels', () => {
    expect(compass(0)).toBe('N');
    expect(compass(47)).toBe('NO');
    expect(compass(-90)).toBe('W');
  });
});
