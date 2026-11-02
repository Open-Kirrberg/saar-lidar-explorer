import { describe, expect, it } from 'vitest';
import {
  RELIEF_CYCLE,
  SIMPLE_MAX_WIDTH,
  TOUCH_GESTURES,
  autoQuality,
  currentReliefStep,
  isPhoneLike,
  nextReliefStep,
  resolveUiMode,
  swipeCloses,
  toggleSheet,
  touchHelpHtml,
} from '../src/ui/mobileMode';
import { QUALITY_PRESETS, applyQuality, buildingRadii, pixelRatioFor, qualityKnobs } from '../src/ui/quality';
import type { QualityTargets } from '../src/ui/quality';
import { DEFAULT_SETTINGS, QUALITY_LEVELS, parseSettings } from '../src/ui/settings';

const phone = { coarse: true, width: 390, height: 844 };
const phoneLandscape = { coarse: true, width: 844, height: 390 };
const tablet = { coarse: true, width: 1024, height: 1366 };
const desktop = { coarse: false, width: 1600, height: 1000 };
const narrowDesktop = { coarse: false, width: 700, height: 900 };

describe('F20 layout mode', () => {
  it('auto: simple on touch-first devices or narrow viewports, full on desktops', () => {
    expect(resolveUiMode('auto', phone)).toBe('simple');
    expect(resolveUiMode(undefined, phoneLandscape)).toBe('simple');
    expect(resolveUiMode('auto', tablet)).toBe('simple');
    expect(resolveUiMode('auto', narrowDesktop)).toBe('simple');
    expect(resolveUiMode('auto', desktop)).toBe('full');
    expect(resolveUiMode('auto', { coarse: false, width: SIMPLE_MAX_WIDTH, height: 800 })).toBe('full');
    expect(resolveUiMode('auto', { coarse: false, width: SIMPLE_MAX_WIDTH - 1, height: 800 })).toBe('simple');
  });

  it('the manual override wins in both directions', () => {
    expect(resolveUiMode('full', phone)).toBe('full');
    expect(resolveUiMode('simple', desktop)).toBe('simple');
  });

  it('phone-like = touch and a short side below the threshold', () => {
    expect(isPhoneLike(phone)).toBe(true);
    expect(isPhoneLike(phoneLandscape)).toBe(true);
    expect(isPhoneLike(tablet)).toBe(false);
    expect(isPhoneLike(narrowDesktop)).toBe(false);
  });
});

describe('F20 automatic "Mobil" quality', () => {
  it('phones start on mobil unless the user picked a preset', () => {
    expect(autoQuality(DEFAULT_SETTINGS, phone)).toEqual({ level: 'mobil', auto: true });
    expect(autoQuality(DEFAULT_SETTINGS, desktop)).toEqual({ level: 'hoch', auto: false });
    expect(autoQuality(DEFAULT_SETTINGS, tablet)).toEqual({ level: 'hoch', auto: false });
    expect(autoQuality({ quality: 'hoch', qualityPicked: true }, phone)).toEqual({ level: 'hoch', auto: false });
    // Settings saved before F20 have no flag: a non-default level counts as the user's choice.
    expect(autoQuality({ quality: 'mittel' }, phone)).toEqual({ level: 'mittel', auto: false });
  });

  it('mobil preset: DPR ≤ 1.5, ~200 MB terrain, 0.5 M points, smaller radii than hoch', () => {
    const k = qualityKnobs('mobil');
    const h = QUALITY_PRESETS.hoch;
    expect(QUALITY_LEVELS).toContain('mobil');
    expect(QUALITY_LEVELS.slice(0, 3)).toEqual(['hoch', 'mittel', 'niedrig']);
    expect(pixelRatioFor('mobil', 3)).toBe(1.5);
    expect(pixelRatioFor('mobil', 1)).toBe(1);
    expect(k.budgetMiB).toBe(200);
    expect(k.pointBudget).toBe(500_000);
    for (const key of ['buildingRadius', 'labelScale', 'canopyDistance', 'lodScale'] as const) expect(k[key]).toBeLessThan(h[key]);
    const b = buildingRadii(k.buildingRadius);
    expect(b.fade[1]).toBeLessThan(b.loadRadius);
  });

  it('applying mobil sets the point budget as a preset unless the user set the slider', () => {
    const calls: Array<[number, boolean | undefined]> = [];
    const mk = (budgetUser: boolean): QualityTargets => ({
      setPixelRatio: () => undefined,
      devicePixelRatio: 3,
      streaming: { pixelError: 1, budget: 0, canopyDistance: 0 },
      lodDistances: [100, 200],
      baseDistances: [100, 200],
      pointClouds: { setBudget: (n, p) => calls.push([n, p]), prefs: { budgetUser } },
    });
    const t = mk(false);
    applyQuality('mobil', t, true);
    expect(t.streaming.budget).toBe(200 * 1024 * 1024);
    expect(calls).toEqual([[500_000, true]]);
    applyQuality('mobil', mk(true), true);
    expect(calls).toHaveLength(1);
  });

  it('settings keep uiMode / qualityPicked and drop invalid values', () => {
    expect(parseSettings({ quality: 'mobil', qualityPicked: true, uiMode: 'simple' })).toEqual({
      ...DEFAULT_SETTINGS,
      quality: 'mobil',
      qualityPicked: true,
      uiMode: 'simple',
    });
    expect(parseSettings({ uiMode: 'tiny', qualityPicked: 'yes' })).toEqual(DEFAULT_SETTINGS);
  });
});

describe('F20 relief cycle', () => {
  const look = (layer: string, overlay = '', preset = '') => ({ layer, overlay, preset });

  it('finds the current step: modes need no overlay/preset, presets match by id', () => {
    expect(currentReliefStep(RELIEF_CYCLE, look('vat'))).toBe(0);
    expect(currentReliefStep(RELIEF_CYCLE, look('slrm'))).toBe(1);
    expect(currentReliefStep(RELIEF_CYCLE, look('vat', 'slrm'))).toBe(-1); // user's own blend
    expect(currentReliefStep(RELIEF_CYCLE, look('dop', 'vat', 'luftbild-relief'))).toBe(2);
    expect(currentReliefStep(RELIEF_CYCLE, look('vat', '', 'relikte'))).toBe(-1);
  });

  it('cycles VAT → Lokales Relief → Luftbild × Relief → Karte 1840 → VAT; unknown looks start at VAT', () => {
    expect(RELIEF_CYCLE.map((s) => s.label)).toEqual(['VAT', 'Lokales Relief', 'Luftbild × Relief', 'Karte 1840']);
    expect(nextReliefStep(RELIEF_CYCLE, look('vat'))).toBe(1);
    expect(nextReliefStep(RELIEF_CYCLE, look('x', 'y', 'karte-relief'))).toBe(0);
    expect(nextReliefStep(RELIEF_CYCLE, look('live-hillshade'))).toBe(0);
    expect(nextReliefStep([], look('vat'))).toBe(-1);
  });

  it('works with a reduced cycle (AOI without images)', () => {
    const modesOnly = RELIEF_CYCLE.filter((s) => s.kind === 'mode');
    expect(nextReliefStep(modesOnly, look('slrm'))).toBe(0);
  });
});

describe('F20 bottom sheets', () => {
  it('one sheet at a time; the same button closes it', () => {
    expect(toggleSheet(null, 'map')).toBe('map');
    expect(toggleSheet('map', 'map')).toBe(null);
    expect(toggleSheet('map', 'layers')).toBe('layers');
  });

  it('swipe down closes after a quarter of the sheet (48–120 px) or a quick flick', () => {
    expect(swipeCloses(0, 100, 400)).toBe(false);
    expect(swipeCloses(-50, 100, 400)).toBe(false);
    expect(swipeCloses(99, 1000, 400)).toBe(false); // slow, < 100 px (a quarter of 400)
    expect(swipeCloses(100, 1000, 400)).toBe(true);
    expect(swipeCloses(120, 1000, 900)).toBe(true); // capped at 120 px
    expect(swipeCloses(47, 1000, 100)).toBe(false); // min 48 px
    expect(swipeCloses(30, 40, 600)).toBe(true); // flick 0.75 px/ms
    expect(swipeCloses(20, 10, 600)).toBe(false); // too short for a flick
    expect(swipeCloses(Number.NaN, 10, 600)).toBe(false);
  });
});

describe('F20 touch help', () => {
  it('lists pinch, drag, rotate, tilt and long-press, escaped', () => {
    const text = TOUCH_GESTURES.map((g) => g.gesture).join(' ');
    for (const w of ['1 Finger ziehen', 'auseinander', 'drehen', 'hoch/runter', 'lange drücken']) expect(text).toContain(w);
    const html = touchHelpHtml([{ gesture: '<b>', label: 'a&b' }], 'li');
    expect(html).toBe('<li class="sle-keys-row sle-touch-row"><span class="sle-gesture">&#60;b&#62;</span> <span>a&#38;b</span></li>');
  });
});
