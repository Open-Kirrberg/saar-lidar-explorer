import { describe, expect, it } from 'vitest';
import { FLY_M, advance, angleDiff, skip, start, stepText, visibleSteps } from '../src/tutorial/steps';
import type { Snapshot, Target, TutState } from '../src/tutorial/steps';
import { CASTLE_ZONE, pickTarget } from '../src/tutorial/Tutorial';

const T0 = { E: 380000, N: 5462000, heading: 0, pitch: -25 };
const snap = (p: Partial<Snapshot> = {}): Snapshot => ({ ...T0, placesOpen: false, mapOpen: false, enterOffered: false, inCastle: false, ...p });
const castle: Target = { E: 382132, N: 5466104, radius_m: 250, kind: 'portal', inAoi: true };

function run(st: TutState, ...s: Snapshot[]): TutState {
  for (const x of s) st = advance(st, x, castle);
  return st;
}

describe('tutorial steps (V2.9)', () => {
  it('angleDiff wraps around north', () => {
    expect(angleDiff(350, 10)).toBe(20);
    expect(angleDiff(10, 350)).toBe(20);
    expect(angleDiff(180, 0)).toBe(180);
  });

  it('walks look → fly → find → approach → enter → done by doing each action', () => {
    let st = start(T0);
    expect(st.step).toBe('look');
    expect(advance(st, snap({ heading: 10 }), castle)).toBe(st); // small turn: same object
    st = run(st, snap({ heading: 25 }));
    expect(st.step).toBe('fly');
    st = run(st, snap({ heading: 25, E: T0.E + FLY_M - 1 }));
    expect(st.step).toBe('fly');
    st = run(st, snap({ heading: 25, E: T0.E + FLY_M + 1 }));
    expect(st.step).toBe('find');
    st = run(st, snap({ E: T0.E + 200, placesOpen: true }));
    expect(st.step).toBe('approach');
    st = run(st, snap({ E: castle.E + 100, N: castle.N }));
    expect(st.step).toBe('enter');
    st = run(st, snap({ E: castle.E + 100, N: castle.N, enterOffered: true }));
    expect(st.step).toBe('enter');
    st = run(st, snap({ inCastle: true }));
    expect(st).toMatchObject({ step: 'done', end: 'entered' });
  });

  it('pitch and moving also count as looking; minimap counts as finding', () => {
    expect(run(start(T0), snap({ pitch: -35 })).step).toBe('fly');
    expect(run(start(T0), snap({ N: T0.N + 50 })).step).toBe('fly');
    const find: TutState = { step: 'find', ref: T0 };
    expect(run(find, snap({ mapOpen: true })).step).toBe('approach');
  });

  it('jumps to enter from any step once near the castle, and back to approach when leaving', () => {
    const near = snap({ E: castle.E, N: castle.N - 200 });
    expect(run(start(T0), near).step).toBe('enter');
    const st = run(start(T0), near, snap({ E: castle.E, N: castle.N - 600 }));
    expect(st.step).toBe('approach');
  });

  it('without a castle in the AOI: only look + fly, then done', () => {
    const away = { ...castle, inAoi: false };
    expect(visibleSteps(away)).toEqual(['look', 'fly']);
    let st = advance(start(T0), snap({ heading: 30 }), away);
    st = advance(st, snap({ E: T0.E + 500 }), away);
    expect(st).toMatchObject({ step: 'done', end: 'flown' });
    expect(advance(start(T0), snap({ E: castle.E, N: castle.N }), away).step).not.toBe('enter');
    expect(skip({ step: 'fly', ref: T0 }, T0, away).step).toBe('done');
  });

  it('every step can be skipped; the last skip ends it', () => {
    let st = start(T0);
    const seen: string[] = [st.step];
    while (st.step !== 'done') {
      st = skip(st, T0, castle);
      seen.push(st.step);
    }
    expect(seen).toEqual(['look', 'fly', 'find', 'approach', 'enter', 'done']);
    expect(st.end).toBe('arrived');
    expect(advance(st, snap({ inCastle: true }), castle)).toBe(st);
  });

  it('texts: German, touch vs keyboard, heritage line at the end, no real-world guidance', () => {
    const env = (touch: boolean, enterOffered = false, target: Target | null = castle) => ({ touch, target, enterOffered });
    expect(stepText(start(T0), env(true)).body).toMatch(/Finger/);
    expect(stepText(start(T0), env(false)).body).toMatch(/Maus/);
    expect(stepText({ step: 'fly', ref: T0 }, env(false)).body).toMatch(/W oder ↑/);
    expect(stepText({ step: 'find', ref: T0 }, env(true)).anchors).toEqual(['places', 'minimap']);
    expect(stepText({ step: 'find', ref: T0 }, env(true, false, { ...castle, kind: 'site' })).anchors).toEqual(['places']);
    expect(stepText({ step: 'enter', ref: T0 }, env(false, true)).body).toMatch(/Betreten.*E/);
    expect(stepText({ step: 'enter', ref: T0 }, env(true, true)).body).not.toMatch(/drück E/);
    const done = stepText({ step: 'done', ref: T0, end: 'entered' }, env(false));
    expect(done.body).toMatch(/Hypothesen/);
    expect(done.body).toMatch(/Schauen, nicht graben/);
    for (const step of ['look', 'fly', 'find', 'approach', 'enter', 'done'] as const)
      for (const touch of [true, false]) {
        const t = stepText({ step, ref: T0, end: 'arrived' }, env(touch));
        expect(`${t.title} ${t.body}`).not.toMatch(/Standort|vor Ort|Detektor|Metallsuch|hingehen/i);
        expect(t.body.length).toBeLessThan(170);
      }
  });

  it('picks the castle portal by zone id, else the palace site', () => {
    const inAoi = () => true;
    const portal = { zoneId: CASTLE_ZONE, portalId: 'ehrenhof', name_de: 'Schloss Karlsberg', label_de: 'Schloss betreten', E: 382132, N: 5466104, radius_m: 250, facing_deg: 260, kind: 'reconstructed' as const };
    const other = { ...portal, zoneId: 'testraum', E: 1, N: 2 };
    expect(pickTarget([other, portal], inAoi)).toMatchObject({ kind: 'portal', E: 382132, radius_m: 250 });
    const site = pickTarget([other], inAoi);
    expect(site.kind).toBe('site');
    expect(Math.hypot(site.E - portal.E, site.N - portal.N)).toBeLessThan(300); // ruins ≈ next to the portal
    expect(pickTarget([], () => false).inAoi).toBe(false);
  });
});
