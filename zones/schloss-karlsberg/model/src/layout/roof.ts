/**
 * Roof sections and plans (pure).
 *
 * A section is taken across the building (along t), from the eaves line on one long side to
 * the other; `depth` is the wall-to-wall depth at the eaves. Rules (research/02 §2.7):
 *   mansard : lower slope (Brisis) at pitch_lower up to the break, upper slope (Terrasson) at
 *             pitch_upper to the ridge; pitch_upper = 0 gives the flat deck seen in HMS.
 *             Break height default = 0.4 · depth/2 (this reproduces every v1 ridge_h).
 *   hip/gable/pavilion/cone : rise = depth/2 · tan(pitch).
 *   dome    : rise = 0.3 · depth (default; reproduces v1).
 * If the catalogue gives ridge_h, the section is solved to MATCH it (mansard: break height;
 * pitched: pitch) and `adjusted` + `notes` say so.
 */
import type { RoofType } from '../spec.ts';
import { GARDEN_DETAIL, ROOF } from './grammar.ts';

const DEG = Math.PI / 180;

export interface RoofSectionInput {
  type: RoofType;
  depth: number;
  eaves_h: number;
  pitch_lower?: number;
  pitch_upper?: number;
  break_ratio?: number;
  dome_rise_ratio?: number;
  /** Dome only: 2 = double-stepped dome with cornice and lantern (GARDEN_DETAIL.steppedDome); default 1. */
  dome_tiers?: number;
  /** Target ridge (m DHHN2016). */
  ridge_h?: number;
  /** Solve the section to hit ridge_h (default true). */
  matchRidge?: boolean;
}

export interface RoofSection {
  type: RoofType;
  depth: number;
  eaves_h: number;
  ridge_h: number;
  rise: number;
  pitch_lower: number;
  pitch_upper: number;
  /** Mansard: absolute height and horizontal inset (from the eaves line) of the break. */
  break_h?: number;
  break_inset?: number;
  /** Width of the flat top (mansard deck, flat roof). 0 for a ridge line. */
  deck_width: number;
  /** Horizontal inset of the ridge / deck edge from the eaves line. */
  ridge_inset: number;
  /** Section outline [t, h] from t = −depth/2 (eaves) over the top to t = +depth/2 (eaves). */
  profile: [number, number][];
  /** Dome only: number of tiers (2 = stepped dome; the profile is final, revolve it as is). */
  tiers?: number;
  adjusted: boolean;
  notes: string[];
}

export function roofSection(inp: RoofSectionInput): RoofSection {
  const d = inp.depth;
  const half = d / 2;
  const e = inp.eaves_h;
  const notes: string[] = [];
  let adjusted = false;
  const target = inp.ridge_h !== undefined && (inp.matchRidge ?? true) ? inp.ridge_h - e : undefined;

  const flatResult = (rise: number, type: RoofType): RoofSection => ({
    type,
    depth: d,
    eaves_h: e,
    ridge_h: e + rise,
    rise,
    pitch_lower: 0,
    pitch_upper: 0,
    deck_width: d,
    ridge_inset: 0,
    profile: [
      [-half, e],
      [-half, e + rise],
      [half, e + rise],
      [half, e],
    ],
    adjusted,
    notes,
  });

  switch (inp.type) {
    case 'none':
      return flatResult(0, 'none');
    case 'flat':
      return flatResult(0, 'flat');
    case 'mound':
      // the earth body is the 'mound' storey itself (eaves = its top); no extra roof rise
      return flatResult(target ?? 0, 'mound');
    case 'dome': {
      const ratio = inp.dome_rise_ratio ?? ROOF.domeRiseRatio;
      if ((inp.dome_tiers ?? 1) >= 2) return steppedDomeSection(d, e, ratio * d);
      let rise = ratio * d;
      if (target !== undefined && Math.abs(target - rise) > 0.05) {
        notes.push(`dome rise ${rise.toFixed(2)} m replaced by catalogue ridge (${target.toFixed(2)} m)`);
        rise = target;
        adjusted = true;
      }
      // quarter-ellipse profile sampled at 16 segments per side
      const profile: [number, number][] = [];
      const n = 16;
      for (let i = 0; i <= 2 * n; i++) {
        const a = Math.PI - (i / (2 * n)) * Math.PI;
        profile.push([half * Math.cos(a), e + rise * Math.sin(a)]);
      }
      return {
        type: 'dome',
        depth: d,
        eaves_h: e,
        ridge_h: e + rise,
        rise,
        pitch_lower: 90,
        pitch_upper: 0,
        deck_width: 0,
        ridge_inset: half,
        profile,
        adjusted,
        notes,
      };
    }
    case 'mansard': {
      const pl = inp.pitch_lower ?? ROOF.mansardLowerPitch;
      const pu = inp.pitch_upper ?? ROOF.mansardUpperPitch;
      const tl = Math.tan(pl * DEG);
      const tu = Math.tan(pu * DEG);
      let hb = (inp.break_ratio ?? ROOF.mansardBreakRatio) * half;
      if (target !== undefined) {
        // rise = hb + (half − hb/tl)·tu  ->  hb = (rise − half·tu) / (1 − tu/tl)
        const den = 1 - tu / tl;
        const solved = Math.abs(den) > 1e-9 ? (target - half * tu) / den : NaN;
        if (Number.isFinite(solved) && solved > 0 && solved <= half * tl) {
          if (Math.abs(solved - hb) > 0.01) {
            adjusted = true;
            notes.push(`mansard break solved to ${solved.toFixed(2)} m to match ridge_h`);
          }
          hb = solved;
        } else {
          notes.push('ridge_h not reachable with the given pitches; kept default break ratio');
        }
      }
      const bi = hb / tl;
      const restHalf = half - bi;
      const hu = restHalf * tu;
      const rise = hb + hu;
      const deck = pu <= 0 ? 2 * restHalf : 0;
      const profile: [number, number][] =
        deck > 0
          ? [
              [-half, e],
              [-half + bi, e + hb],
              [half - bi, e + hb],
              [half, e],
            ]
          : [
              [-half, e],
              [-half + bi, e + hb],
              [0, e + rise],
              [half - bi, e + hb],
              [half, e],
            ];
      return {
        type: 'mansard',
        depth: d,
        eaves_h: e,
        ridge_h: e + rise,
        rise,
        pitch_lower: pl,
        pitch_upper: pu,
        break_h: e + hb,
        break_inset: bi,
        deck_width: deck,
        ridge_inset: deck > 0 ? bi : half,
        profile,
        adjusted,
        notes,
      };
    }
    case 'hip':
    case 'gable':
    case 'pavilion':
    case 'cone': {
      let p = inp.pitch_lower ?? ROOF.hipPitch;
      if (target !== undefined) {
        const solved = Math.atan2(target, half) / DEG;
        if (Math.abs(solved - p) > 0.25) {
          adjusted = true;
          notes.push(`pitch ${p}° replaced by ${solved.toFixed(1)}° to match ridge_h`);
        }
        p = solved;
      }
      return { ...pitched(inp.type, d, e, p), adjusted, notes };
    }
  }
}

function pitched(type: RoofType, d: number, e: number, pitch: number): RoofSection {
  const half = d / 2;
  const rise = half * Math.tan(pitch * DEG);
  return {
    type,
    depth: d,
    eaves_h: e,
    ridge_h: e + rise,
    rise,
    pitch_lower: pitch,
    pitch_upper: pitch,
    deck_width: 0,
    ridge_inset: half,
    profile: [
      [-half, e],
      [0, e + rise],
      [half, e],
    ],
    adjusted: false,
    notes: [],
  };
}

export interface RoofPlan {
  /** Length of the ridge line (0 for pavilion/cone/dome apex). */
  ridgeLength: number;
  /** Inset of the ridge ends from the end walls (hipped ends), 0 for gables. */
  ridgeEndInset: number;
  /** Mansard: plan size of the break line rectangle [along s, along t]. */
  breakRect?: [number, number];
  /** Mansard deck / flat top size [along s, along t]. */
  deckRect?: [number, number];
  hippedEnds: boolean;
}

/** Plan of a roof over a rectangle `length` × section.depth. */
export function roofPlan(section: RoofSection, length: number, hippedEnds?: boolean): RoofPlan {
  const t = section.type;
  const hipped = hippedEnds ?? (t === 'hip' || t === 'mansard' || t === 'pavilion');
  if (t === 'pavilion' || t === 'cone' || t === 'dome' || t === 'mound') {
    return { ridgeLength: 0, ridgeEndInset: length / 2, hippedEnds: true };
  }
  if (t === 'flat' || t === 'none') {
    return { ridgeLength: length, ridgeEndInset: 0, hippedEnds: false, deckRect: [length, section.depth] };
  }
  if (t === 'gable' || !hipped) {
    const plan: RoofPlan = { ridgeLength: length, ridgeEndInset: 0, hippedEnds: false };
    if (t === 'mansard') {
      plan.breakRect = [length, section.depth - 2 * (section.break_inset ?? 0)];
      if (section.deck_width > 0) plan.deckRect = [length, section.deck_width];
    }
    return plan;
  }
  // hipped: end slopes have the same pitch as the long slopes
  const inset = Math.min(section.ridge_inset, length / 2);
  const plan: RoofPlan = { ridgeLength: Math.max(0, length - 2 * section.ridge_inset), ridgeEndInset: inset, hippedEnds: true };
  if (t === 'mansard') {
    const bi = section.break_inset ?? 0;
    plan.breakRect = [Math.max(0, length - 2 * bi), section.depth - 2 * bi];
    if (section.deck_width > 0) plan.deckRect = [Math.max(0, length - 2 * bi), section.deck_width];
  }
  return plan;
}

/**
 * Height of the roof surface above a plan point at distance `inset` from the nearest eaves line
 * (for dormer placement / collision): along the section profile.
 */
export function roofHeightAtInset(section: RoofSection, inset: number): number {
  const t = -section.depth / 2 + Math.max(0, Math.min(section.depth / 2, inset));
  const p = section.profile;
  for (let i = 1; i < p.length; i++) {
    const [t0, h0] = p[i - 1];
    const [t1, h1] = p[i];
    if (t >= t0 && t <= t1 && t1 > t0) return h0 + ((t - t0) / (t1 - t0)) * (h1 - h0);
  }
  return section.ridge_h;
}

/**
 * Double-stepped dome (GARDEN_DETAIL.steppedDome, KB-B87): drum-head cornice, lower tier, set-back ledge and riser,
 * upper tier, lantern with a cap and a pointed spire. `rise` (ratio x diameter) scales the two tiers; the cornice and
 * the lantern come on top. The profile runs from the eaves (t = −depth/2, the cornice projects beyond it) over the apex
 * to +depth/2 and is final (no re-sampling); corners between tiers stay sharp in the revolved mesh.
 */
export function steppedDomeSection(d: number, e: number, rise: number): RoofSection {
  const S = GARDEN_DETAIL.steppedDome;
  const R = d / 2;
  const left: [number, number][] = [];
  const P = (r: number, h: number) => left.push([-r, h]);
  // cornice: soffit out, fascia up, top back in
  P(R, e);
  P(R + S.cornice.overhang, e);
  P(R + S.cornice.overhang, e + S.cornice.height);
  const r1 = R - 0.04;
  let z = e + S.cornice.height;
  P(r1, z);
  // lower tier: part of a quarter ellipse from r1 to endRadius · r1
  const ellipse = (r0: number, rEnd: number, h: number, steps: number) => {
    const t1 = Math.acos(Math.min(1, rEnd / r0));
    const a = h / Math.sin(t1);
    const z0 = z;
    for (let i = 1; i <= steps; i++) {
      const t = (i / steps) * t1;
      P(r0 * Math.cos(t), z0 + a * Math.sin(t));
    }
    z = z0 + h;
  };
  ellipse(r1, S.tier1.endRadius * r1, S.tier1.rise * rise, 6);
  // ledge and riser
  const r2 = S.ledgeRadius * R;
  P(r2, z);
  z += S.riser * rise;
  P(r2, z);
  // upper tier up to the lantern
  const rl = S.lantern.radius * R;
  ellipse(r2, rl, S.tier2.rise * rise, 8);
  // lantern, cap, spire
  z += S.lantern.height;
  P(rl, z);
  P(rl + S.lantern.capOverhang, z);
  z += S.lantern.capRise;
  P(rl + S.lantern.capOverhang, z);
  z += S.lantern.spire;
  left.push([0, z]);
  const right = left
    .slice(0, -1)
    .reverse()
    .map(([t, h]): [number, number] => [-t, h]);
  const total = z - e;
  return {
    type: 'dome',
    depth: d,
    eaves_h: e,
    ridge_h: z,
    rise: total,
    pitch_lower: 90,
    pitch_upper: 0,
    deck_width: 0,
    ridge_inset: R,
    profile: [...left, ...right],
    tiers: 2,
    adjusted: false,
    notes: [],
  };
}
