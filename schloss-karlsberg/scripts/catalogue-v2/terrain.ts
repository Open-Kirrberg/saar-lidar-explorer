/**
 * Catalogue v2 terrain features for the time slice summer 1789: courts (surface + level),
 * terraces with retaining walls, avenues (species, spacing, row distance, 1789 height),
 * parterres, ponds with water levels and the Große Kaskade (re-identified, research/07 C3 / P32).
 * Levels marked "DTM" are replaced by the DTM median in pass 2 of build.ts (sample_dtm.py).
 */
import { E0, N0, type GridFrame } from '../../model/src/frame.ts';
import { chaikin, circleRing, clumpAccents, clumpPlantCount, distanceToLine, groveGrid, polylineSelfIntersects, walkSideSpot } from '../../model/src/layout/garden.ts';
import { mulberry32, pointAlong, pointInPolygon, polylineLength } from '../../model/src/layout/geom.ts';
import { GARDEN, GARDEN_DETAIL, GARDEN_GRADED } from '../../model/src/layout/grammar.ts';
import type { EN, GardenItem, GeoJsonGeometry, PlantMix, RingEN, TerrainFeature } from '../../model/src/spec.ts';
import { rEN, ring, uvRect, type LidarFeature } from './common.ts';
import { MENAGERIE_CHANNEL, MENAGERIE_FRONT_AZ, MENAGERIE_ROWS, MENAGERIE_RUN_DEPTH } from './menagerie.ts';
import { serpentineWalk } from '../../model/src/site/follyWalks.ts';

export interface TerrainCtx {
  grid: GridFrame;
  lidar: Map<string, LidarFeature>;
}

const poly = (r: RingEN): GeoJsonGeometry => ({ type: 'Polygon', coordinates: [r] });
const uvPoly = (g: GridFrame, pts: [number, number][]): RingEN => ring(pts.map(([u, v]) => g.toEN(u, v)));

function lidarPoly(ctx: TerrainCtx, id: string): RingEN {
  const f = ctx.lidar.get(id);
  if (!f || f.geometry.type !== 'Polygon') throw new Error(`lidar feature ${id} is not a polygon`);
  return ring(f.geometry.coordinates[0]);
}

function lidarLine(ctx: TerrainCtx, id: string): EN[] {
  const f = ctx.lidar.get(id);
  if (!f || f.geometry.type !== 'LineString') throw new Error(`lidar feature ${id} is not a line`);
  return f.geometry.coordinates.map((p) => rEN(p));
}

/** Terrain features whose `level` is the DTM median in pass 2 (id -> fallback used in pass 1). */
export const LEVEL_FROM_DTM: Record<string, number> = {
  'TF-08': 341.0,
};

export function applyTerrain(v1: TerrainFeature[], ctx: TerrainCtx): TerrainFeature[] {
  const g = ctx.grid;
  const byId = new Map(v1.map((t) => [t.id, structuredClone(t)]));
  const edit = (id: string, f: (t: TerrainFeature) => void) => {
    const t = byId.get(id);
    if (!t) throw new Error(`terrain ${id} missing in v1`);
    f(t);
  };
  const note = (t: TerrainFeature, s: string) => {
    t.notes = [t.notes, `v2: ${s}`].filter(Boolean).join(' ');
  };

  // ---- courts
  edit('TF-01', (t) => {
    t.name = "Ehrenhof (cour d'honneur)";
    t.level = 344.8;
    t.surface = 'gravel (sandstone grit) with flagged walks along the wings';
    t.tag = 'level D LiDAR KB-01 (344.5-344.9); surface N (French court norm), HMS shows cobbles (alternative); grille across the mouth D LC 1790 / PL (KB-B39)';
    note(t, 'court between the arms (u -36..28.2, 64 x 41 m); W mouth closed by the Ehrenhofgitter KB-B39 [D LC/PL, position U].');
  });
  edit('TF-02', (t) => {
    t.geometry = poly(uvRect(g, -20.9, 20.8, 40.6, 94.0));
    t.level = 344.8;
    t.surface = 'cobbles (Katzenkopfpflaster) with a drainage gutter';
    t.tag = 'level D LiDAR; extent D-> LP06 (court enclosed by N arm, W wing, kitchen wing, gallery); surface N service court';
    note(t, 'polygon reaches the gallery (v 94) since the gallery now lies on the KB-07 scarp (P10).');
  });

  // ---- terraces and retaining walls
  edit('TF-03', (t) => {
    t.geometry = poly(
      uvPoly(g, [
        [-38.8, -37.8],
        [46.2, -37.8],
        [46.2, 20.6],
        [39.5, 40.6],
        [34.9, 44.9],
        [41.5, 96.5],
        [35.3, 99.1],
        [5.3, 98.1],
        [-24.3, 98.5],
        [-38.8, 98.5],
      ]),
    );
    t.level = 344.8;
    t.surface = 'see courts; elsewhere gravel';
    t.wall_height = 2.8;
    t.tag = 'level D LiDAR; retaining wall with balustrade on the S and W faces D PL (terrace wall below the palace) + D LC (Freitreppe to a lower level); height D-> HMS/DTM step 2.0-2.9 m (generator extends to the DTM)';
    note(t, 'enlarged to carry the whole palace group: S edge on the S arm face (v -37.8), E edge on the CdL garden front (u 46.2; fix round 1, was 46.7: a 0.5 m strip at 344.8 in front of the garden door), N edge on the KB-07 scarp.');
  });
  edit('TF-04', (t) => {
    t.wall_height = 2.8;
    t.tag = 'D LiDAR scarp 2.7-3.0 m; sandstone retaining wall N/I';
    note(t, 'retaining wall 2.8 m; the gallery (KB-B06) stands on its crest, the Küchenbau E face just in front of it.');
  });
  edit('TF-05', (t) => {
    t.surface = 'sand / tan (riding ground) between the Marstall ranges, gravel elsewhere';
    t.wall_height = 3.0;
    t.tag = 'level D LiDAR; scarps 3.0 (S) / 4.4 m (E) D LiDAR; retaining walls N; surface N';
  });
  edit('TF-06', (t) => {
    // wave-6 review fix (pose 37): the v1 SW corner (382249/5465924) lay 1.6 m S of the Orangerie S end, so a retaining
    // wall wedge stuck out of the slope at the KB-B10 SW corner over a raw grass cut. The parterre now ends on the
    // building (vertex inside KB-B10 by its SE corner); S of the S end the ground falls naturally to the W bench
    // (2025 DTM: 341 -> 336 m over 14 m) [I]
    if (t.geometry.type === 'Polygon') {
      const r = t.geometry.coordinates[0] as EN[];
      for (const p of r)
        if (p[0] === 382249 && p[1] === 5465924) {
          p[0] = 382254.6;
          p[1] = 5465927.4;
        }
    }
    t.surface = 'grass with gravel walks (parterre, see TF-15)';
    t.level = 340.8;
    t.wall_height = 2.5;
    t.tag = 'level D LiDAR KB-33 (340.4-340.8); E V-scarp 2-3 m D LiDAR; wall N';
  });
  edit('TF-07', (t) => {
    t.surface = 'grass bench in front of the high basement';
    t.tag = 'level D LiDAR KB-32; E edge on the Orangerie W face (KB-B10) I';
    // fix round 1: the v1 bench stopped 4.6 m short of the wall; the strip in between kept the ruin rubble
    // (336.8-337.9 in the 2025 DTM) in front of the basement windows. The 1789 bench runs to the wall foot.
    t.geometry = poly(ring([
      [382227.1, 5465923.9],
      [382245.95, 5465924.96],
      [382228.05, 5466007.04],
      [382211.2, 5465997.1],
    ]));
    note(t, 'fix round 1: E edge moved from the v1 line (4.6 m W of the wall, ruin rubble today) onto the KB-B10 W face; the bench reaches the basement wall foot [I].');
  });

  // ---- avenues (1789: young trees)
  edit('TF-10', (t) => {
    t.trees = { species: 'Tilia (N)', rows: 2, spacing: 7, row_distance: 14, age_1793: '5-15 y', height: 6 };
    t.tag = 'route D LiDAR; species N (lime avenue norm); spacing / row distance N 02 §2.14; height 1789 D-> (planted 1776-85)';
    note(t, 'the "allée des marronniers sauvages" (PV u., horse chestnut) is documented but not located; it may be this avenue [U].');
  });
  edit('TF-11', (t) => {
    t.trees = { species: 'Tilia (N)', rows: 2, spacing: 7, row_distance: 16, height: 6 };
    t.tag = 'route D LiDAR; not drawn in LP06/K05 or on the Petri plan c. 1788 -> trees hypothetical (research/11 G4, S2 e); trees N';
    // KB-I12: in no period plan (LP06, K05, Petri) -> hypothetical, low; the axis stays an open vista across the lawn
    t.confidence = 'low';
    t.placement = 'hypothetical';
    note(
      t,
      'KB-I12: placement hypothetical, confidence low (research/11 G4). Decision (logged here and in the backlog): its trees are not drawn across the Herzogsgarten lawn HG-01, because the Petri plan shows an open lawn there [D Schneider]; outside the lawn they render by default and hide with the viewer\'s low-confidence select.',
    );
  });
  edit('TF-14', (t) => {
    t.trees = { species: 'Malus domestica (D: "Apfelallee")', rows: 2, spacing: 8, row_distance: 10, height: 4 };
    t.tag = 'D Apfelallee (Commons; LP06 48 = this line); spacing N; fruit-tree height 1789 N';
  });

  // ---- cascade re-identification (research/07 C3 / P32)
  const kl08 = lidarLine(ctx, 'KL-08');
  const kl03 = lidarLine(ctx, 'KL-03');
  edit('TF-30', (t) => {
    t.name = 'Große Kaskade (Karlslust)';
    // from the rondell KL-09 (top, S) down to the Tosbecken KL-04 (foot, N)
    t.geometry = { type: 'LineString', coordinates: [kl08[1], kl08[0]] };
    t.top = 287.5;
    t.foot = 271.7;
    t.width = 10;
    t.steps = { count: 10, riser_m: 1.58, tread_area_m: [10, '10-15'], tag: 'D dewp 10 steps x 1.5 m; D-> 15.8 m fall = rondell 287.5 - Tosbecken 271.7 (DTM)' };
    t.lidar_ids = ['KL-08', 'KL-09', 'KL-04'];
    t.confidence = 'med';
    t.tag = 'D LP06 58 "Große Kaskade" S of the round basin (= KL-08 -> KL-09, research/07 C3/P32); D dewp 10 x 1.5 m';
    t.notes =
      'v2: re-identified (research/07 P32): LP06 58 draws the cascade S of the Tosbecken, on the KL-08 axis rising to the rondell KL-09. The documented 10 x 1.5 m (15 m) now matches the 15.8 m DTM fall, which resolves the v1 conflict (26-39 m on KL-03). Water flows N into the Tosbecken. Geometry kept even where the explorer DTM crop does not reach.';
  });
  edit('TF-35', (t) => {
    t.kind = 'path';
    t.name = 'Terrassentreppe zum Tschifflik (gestufte Terrasse, LP06 61/62)';
    t.geometry = { type: 'LineString', coordinates: kl03 };
    t.top = 302.5;
    t.foot = 276.3;
    t.width = 10;
    t.lidar_ids = ['KL-03'];
    t.tag = 'D LP06 61/62 (terrace with the Tschifflik on its axis); levels D LiDAR KL-03';
    t.notes = 'v2: the stepped band N of the Tosbecken (KL-03, v1 "cascade") is a grey terrace in LP06 with the Tschifflik Pavillon (KL-B46) on its axis, "on a terrace opposite the cascade" (05 a.5).';
  });
  edit('TF-36', (t) => {
    t.name = 'Rondell am Kopf der Großen Kaskade (Hymenäostempel 1785 daneben)';
    t.tag = 'D LiDAR KL-09; LP06 59 temple site next to it';
  });
  edit('TF-34', (t) => {
    note(t, 'level conflict kept (DTM water-surface artefact?).');
  });
  edit('TF-37', (t) => {
    t.name = 'Wassergraben des Amphitheaters (LP06 53)';
  });
  edit('TF-38', (t) => {
    t.name = 'Menagerie-Terrassen (LP06 54)';
    // wave-6 review fix / KB-I67: no bare gravel apron; grass between the rows (the runs are trampled, exterior/menagerie.ts)
    t.surface = 'meadow under the beeches between the rows (I); the runs trampled (drawn by KL-B43)';
    t.tag = 'D LiDAR KL-02 (≈ 1 m terrace steps, kept in the 1789 terrain); LP06 54; T1 p. 383 "in Buchenwald" [D]; ground I';
  });
  edit('TF-40', (t) => {
    t.name = 'Waldparzelle hinter dem Schloss (Böschung, 1797/98)';
    t.confidence = 'med';
    t.tag = 'I, med: the low bank marking a separate forest parcel behind the palace (D Schneider, Petri plan commentary; in the 1797/98 parcel plan, not in Petri\'s design) = LiDAR KB-53 (research/11 §1.2, G18, S16)';
    note(t, 'KB-I02: identified as the bank of a forest parcel (Waldparzelle) [I, med], not a garden or plantation; v1 name "Rechteckige Wall-Einfriedung (Garten? Plantage?)".');
  });

  const out = [...byId.values()];

  // ---- new features
  out.push(
    {
      id: 'TF-08',
      kind: 'terrace',
      name: 'Schloßterrasse (Terrassengarten südlich des Südflügels, LP06 44)',
      geometry: poly(uvRect(g, -30.0, 36.0, -62.0, -37.8)),
      level: LEVEL_FROM_DTM['TF-08'],
      surface: 'lawn panels à l\'angloise in parterre sand',
      wall_height: 2.0,
      confidence: 'low',
      tag: 'D LP06 44 "Schloßterrasse" + HMS terrace garden S of the S arm; extent I (24 m deep); level DTM median; wall N',
      notes:
        'v2 new: reached through the S-arm Durchfahrt (HMS gate). Depth U. KB-I34: parterre à l\'angloise (4 lawn panels, box-edged plates-bandes with yew cones and standard roses, sanded sentiers, a 3 m centre walk on the Durchfahrt axis u 3.1) inside a green treillage with arched portals [research/11 S7]. Candidate "Lustgarten der Herzogin" (UP-10) [I, low]. Alternative (Petri design): one lawn with an oval clump and a round walk.',
      parterre: {
        type: 'angloise',
        panels: [4, 1],
        cross_walk: GARDEN_DETAIL.angloise.crossWalk,
        tag: "N d'Argenville parterre à l'angloise (research/11 §4.3, S7); 4 panels and the centre walk to the S-wing Durchfahrt I; roses, sunflowers, hollyhocks in the borders HMS",
      },
      fence: {
        type: 'treillage',
        height: GARDEN_DETAIL.treillage.height,
        portal_height: GARDEN_DETAIL.treillage.portalHeight,
        portals: [rEN(g.toEN(3.1, -62.0)), rEN(g.toEN(36.0, -49.9)), rEN(g.toEN(-30.0, -49.9))],
        tag: 'D Le Clerc 1790 "bounded by treillage" (Schneider fn 27) and HMS arched trellises (research/06 §3.7, research/11 §1.3); height and portals N/I; portals on the centre axis and the cross axis I',
      },
    },
    {
      id: 'TF-09',
      kind: 'terrace',
      name: 'Gartenterrasse vor dem Corps de logis (Herzogsgarten)',
      geometry: poly(uvRect(g, 46.2, 46.2 + GARDEN.gardenTerrace.depth, -30.0, 30.0)),
      level: 345.9,
      surface: 'gravel (Buntsandstein grit) garden terrace',
      // wave-2 review: a crisp edge instead of the ragged 2 m raster edge (GARDEN.terraceKerb, features.ts)
      coping: { width: 0.3, height: 0.3, material: 'stone.grey (dressed pale sandstone kerb)' },
      confidence: 'low',
      tag: 'D Petri plan c. 1788 (BSB Cod.icon. 180 h 26r via Schneider): open lawn to the garden front, "Hinweise auf ein Rasenparterre finden sich nicht"; I: a narrow gravel terrace at the garden door (research/10 b.7 allows a small parterre there), depth 7 m I (6-8 m, research/11 S2 a); level I 345.9 = EG floor 346.2 - 2 perron steps; natural ground 345.3-345.8 m D DTM; kerb 0.3 m pale sandstone N edging practice, I here; perron 3 axes wide N/I (GARDEN.perron)',
      notes:
        'v2 new as a hedged 4-compartment parterre (u 46.2-110) levelled up to 3.2 m into the slope. KB-I12: replaced by Petri\'s lawn garden HG-01 on the natural slope; only a 7 m gravel terrace at 345.9 remains in front of the garden door (2-step perron kept), no retaining wall (fill <= 0.6 m).',
    },
    ...herzogsgarten(g),
    ...gardenDetail(ctx),
    {
      id: 'TF-15',
      kind: 'parterre',
      name: 'Orangerie-Parterre (Kübelpflanzen im Sommer)',
      geometry: poly(uvRect(g, 2.0, 30.0, -178.0, -128.0)),
      level: 340.8,
      surface: 'lawn panels in parterre sand; citrus tubs set out in summer',
      confidence: 'med',
      tag: 'level D LiDAR KB-33; parterre in the U of the Orangerie D-> LP06 7; tubs outside May-October N (time slice summer)',
      notes:
        'v2 new: inside TF-06, between the wings KB-B11/B12. KB-I34: parterre à l\'angloise (2 x 2 lawn panels, plates-bandes with yew cones, sanded sentiers and walks) with green oak tubs of citrus in rows on the walk edges every 5 m [research/11 S8]; the old 0.45 m hedge boxes are gone.',
      parterre: {
        type: 'angloise',
        panels: [2, 2],
        cross_walk: GARDEN_DETAIL.angloise.crossWalk,
        tubs: true,
        tag: "N d'Argenville parterre à l'angloise (research/11 §4.3, S8); tub rows on the walk edges every 5 m N/I; tubs D research/01 row 17, HMS",
      },
    },
    {
      id: 'TF-43',
      kind: 'pond',
      name: 'Großes Bassin (Karlslust, LP06 60)',
      geometry: poly(lidarPoly(ctx, 'KL-13')),
      water_level: 288.0,
      confidence: 'low',
      lidar_ids: ['KL-13'],
      tag: 'D LP06 60 (≈40 x 20 m, ≈30 m from KL-13); KL-13 = basin I low (03 flagged it modern?); water level I (KL-13 floor 287.8 + 0.2)',
      notes: 'v2 new: the head basin of the cascade system (Commons "Großes Bassin").',
    },
    {
      id: 'TF-44',
      kind: 'pond',
      name: 'Kleines Bassin (Karlslust, LP06 64)',
      geometry: poly(lidarPoly(ctx, 'KL-11')),
      water_level: 296.7,
      confidence: 'low',
      lidar_ids: ['KL-11'],
      tag: 'D LP06 64; KL-11 = basin I low; water level I (KL-11 floor 296.4 + 0.3)',
      notes: 'v2 new.',
    },
  );
  const tf38 = out.find((f) => f.id === 'TF-38');
  if (tf38?.geometry.type === 'Polygon') out.push(menagerieBeeches(tf38.geometry.coordinates[0] as EN[]));
  out.push(...follySettings(out));
  out.push(...fences());
  out.push(...pleasureLawns());
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

/**
 * TF-39 (wave-6 review fix / KB-I67): the beech wood the terrace menagerie stood in ("in Buchenwald", T1 p. 383 [D]):
 * old beeches on the banks between the rows (half way between a run front and the next row's back line), above the
 * first row, below the last, and round the E, S and N sides of TF-38; the NW side towards the amphitheatre stays open
 * (the view across from the ring). Spacing ≈ 12 m, seeded jitter, never within 4.5 m of the watercourse [I].
 */
function menagerieBeeches(outline: EN[]): TerrainFeature {
  const rnd = mulberry32(0x4b4c3433);
  const f: EN = [Math.sin((MENAGERIE_FRONT_AZ * Math.PI) / 180), Math.cos((MENAGERIE_FRONT_AZ * Math.PI) / 180)];
  const runFront = 3.0 + MENAGERIE_RUN_DEPTH; // row house depth (grammar MENAGERIE.rowHouse) + run
  const pts: EN[] = [];
  const strip = (p0: EN, p1: EN, d: number) => {
    const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    const t: EN = [(p1[0] - p0[0]) / len, (p1[1] - p0[1]) / len];
    const n = Math.max(1, Math.round(len / 12));
    for (let k = 0; k <= n; k++) {
      const s = (len * k) / n + (rnd() * 2 - 1) * 2.5;
      const dd = d + (rnd() * 2 - 1) * 0.7;
      pts.push([p0[0] + t[0] * s + f[0] * dd, p0[1] + t[1] * s + f[1] * dd]);
    }
  };
  const rows = MENAGERIE_ROWS;
  strip(rows[0].p0, rows[0].p1, -4.5);
  for (let i = 0; i + 1 < rows.length; i++) {
    const gap = (rows[i + 1].p0[0] - rows[i].p0[0]) * f[0] + (rows[i + 1].p0[1] - rows[i].p0[1]) * f[1];
    if (gap - runFront >= 2.5) strip(rows[i].p0, rows[i].p1, (runFront + gap) / 2);
  }
  const last = rows[rows.length - 1];
  strip(last.p0, last.p1, runFront + 4.5);
  // round the outline, 6 m outside, except the NW edge (N tip -> W corner) facing the amphitheatre
  const ring0 = outline.slice(0, -1);
  let cx = 0;
  let cy = 0;
  for (const p of ring0) {
    cx += p[0] / ring0.length;
    cy += p[1] / ring0.length;
  }
  for (let i = 0; i < ring0.length; i++) {
    const a = ring0[i];
    const b = ring0[(i + 1) % ring0.length];
    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2;
    if (mx < cx && my > cy - 20) continue; // the NW edge
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let nx = (b[1] - a[1]) / len;
    let ny = -(b[0] - a[0]) / len;
    if ((mx - cx) * nx + (my - cy) * ny < 0) [nx, ny] = [-nx, -ny];
    const n = Math.max(1, Math.round(len / 13));
    for (let k = 0; k < n; k++) {
      const s = (len * (k + 0.5)) / n + (rnd() * 2 - 1) * 2.5;
      const o = 6 + rnd() * 3;
      pts.push([a[0] + ((b[0] - a[0]) * s) / len + nx * o, a[1] + ((b[1] - a[1]) * s) / len + ny * o]);
    }
  }
  const kept = pts.filter((p) => distanceToLine(MENAGERIE_CHANNEL, p) >= 4.5).map((p) => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10] as EN);
  if (kept.length < 50 || kept.length > 110) throw new Error(`TF-39: ${kept.length} beeches (50-110 expected)`);
  return {
    id: 'TF-39',
    kind: 'clump',
    name: 'Buchen der Menagerie-Terrassen (Buchenwald)',
    geometry: { type: 'MultiPoint', coordinates: kept },
    mix: [{ species: 'beech_old (Rotbuche, Fagus sylvatica: "in Buchenwald", T1 p. 383)', share: 1, height: [18, 26] }],
    confidence: 'low',
    tag: 'D T1 p. 383 (the terrace menagerie lay "in Buchenwald"); old beeches on the banks between the rows and round the terraces I; spacing ≈ 12 m, heights 18-26 m N; positions I (seeded); the NW side to the amphitheatre open I',
  };
}

// ------------------------------------------------------------------------------------------------ Herzogsgarten

/** Polyline in the palace grid (u, v) -> EN, rounded to 1 cm. */
const uvLine = (g: GridFrame, pts: [number, number][]): EN[] => pts.map(([u, v]) => rEN(g.toEN(u, v)));

const r4 = (x: number) => Math.round(x * 1e4) / 1e4;

/**
 * Clump compositions (research/11 S2 c): a shrub mass (~70 %), small feathered trees inside (30 %) and ONE accent
 * (two from D 18 m), plus one retained old tree where `retained` [D plan; I shares]. Accent and retained shares are
 * exact counts of the clump's plants (GARDEN.clump, wave-2 review: 10 % accents read as scattered single trees).
 */
const CLUMP_MIX = (d: number, accent: 'conifer' | 'poplar', retained = false): PlantMix[] => {
  const n = clumpPlantCount(d / 2);
  const acc = r4(clumpAccents(d) / n);
  const old = retained ? r4(1 / n) : 0;
  const trees = 0.3;
  return [
    { species: 'Flowering shrubs (Syringa, Philadelphus, Rosa, Viburnum, Cornus mas)', share: r4(1 - trees - acc - old), height: [GARDEN.shrub[0], GARDEN.shrub[1]] },
    { species: 'Tilia / Carpinus (young feathered trees)', share: trees, height: [GARDEN.youngTree[0], GARDEN.youngTree[1]] },
    accent === 'conifer'
      ? { species: 'Conifer (Pinus strobus, Picea, Larix)', share: acc, height: [7, 10] }
      : { species: 'Populus nigra Italica (Pyramidenpappel)', share: acc, height: [GARDEN.poplar.height[0], GARDEN.poplar.height[1]] },
    ...(retained ? [{ species: 'beech_old (retained edge tree, Fagus)', share: old, height: [GARDEN.retainedTree[0], GARDEN.retainedTree[1]] as [number, number] }] : []),
  ];
};

/**
 * Single trees on the lawn (research/11 S2 c, §3.2): mostly young plantings of 1778-88 (feathered, crowns from low on
 * the stem), a few conifers and poplars, and a few retained old trees of the former "Wald" [I; wave-2 review: a
 * quarter of 20 m retained beeches read as tall lollipops, not a garden of 1-11 years].
 */
const SINGLES_MIX: PlantMix[] = [
  { species: 'Tilia (young feathered solitary)', share: 0.3, height: [4.5, 7.5] },
  { species: 'Rosskastanie (Aesculus hippocastanum, young)', share: 0.2, height: [4.5, 7] },
  { species: 'Edelkastanie (Castanea sativa, young)', share: 0.15, height: [4.5, 7] },
  { species: 'Conifer (Pinus strobus, Picea, Larix)', share: 0.15, height: [5, 9] },
  { species: 'Populus nigra Italica (Pyramidenpappel)', share: 0.1, height: [8, 11] },
  { species: 'beech_old (retained tree of the former "Wald", Fagus)', share: 0.1, height: [16, 22] },
];

/**
 * Wave 9 (garden, audit #1: the lawn in front of the garden front read as an empty green plane at eye level, poses
 * 16/17): two framing groups graded low to tall away from the lawn (GARDEN_GRADED): low July-flowering roses and
 * Spiraea in front, tall flowering shrubs behind, young limes, Pyramidenpappeln and conifers at the back. `face` is the
 * lawn point the low front turns to; `back` names the back trees from one end of the group to the other [I].
 */
const FRAMING: { name: string; u: number; v: number; r: number; face: [number, number]; back: ('tilia' | 'poplar' | 'conifer')[] }[] = [
  // the right-hand coulisse of the view from the lawn over the basin to the garden front (poses 16/17), N of the axis
  // wave-9 review fix: the conifer takes the end slot nearest the axis, so it breaks the skyline at the right edge of
  // 16 / 17 (a young lime there filled the edge and hid the accent)
  { name: 'N', u: 132, v: 46, r: 7, face: [150, 25], back: ['conifer', 'tilia', 'poplar', 'tilia'] },
  // the left-hand one behind the basin, a dark backdrop to the jet seen from the lawn, S of the axis; it leaves the
  // Rundpavillon KB-B87 in view (u 96 hid it, wave-9 shot 16)
  // wave-9 review fix: a poplar stood exactly behind the jet; poplars now keep GARDEN_GRADED.sightClear m off the line of
  // sight from the lawn eye to the jet (FramingAvoid.sight), the dark conifer takes the slot behind the jet
  { name: 'S', u: 85, v: -22, r: 5.5, face: [150, 25], back: ['poplar', 'tilia', 'conifer'] },
];

interface FramingAvoid {
  belt: [number, number][];
  spur: [number, number][];
  basin: { at: [number, number]; r: number };
  /** single trees, furniture, wells and clump centres that keep a plant 6 m off */
  points: [number, number][];
  /** wave-9 review fix: lines of sight (eye → target, extended beyond the target) a Pyramidenpappel keeps clear of */
  sight?: { eye: [number, number]; at: [number, number] }[];
}

/** Distance of (u, v) from the ray eye → at, extended beyond `at` (points behind the eye count by their distance). */
export function sightDistance(s: { eye: [number, number]; at: [number, number] }, p: [number, number]): number {
  const dx = s.at[0] - s.eye[0];
  const dy = s.at[1] - s.eye[1];
  const L = Math.hypot(dx, dy);
  const t = ((p[0] - s.eye[0]) * dx + (p[1] - s.eye[1]) * dy) / L;
  if (t <= 0) return Math.hypot(p[0] - s.eye[0], p[1] - s.eye[1]);
  return Math.abs((p[0] - s.eye[0]) * dy - (p[1] - s.eye[1]) * dx) / L;
}

/** Plants of the framing groups in layers (front, mid, back with species), palace grid (u, v); deterministic. */
export function framingLayout(avoid: FramingAvoid): { front: [number, number][]; mid: [number, number][]; back: { at: [number, number]; sp: 'tilia' | 'poplar' | 'conifer' }[] } {
  const front: [number, number][] = [];
  const mid: [number, number][] = [];
  const back: { at: [number, number]; sp: 'tilia' | 'poplar' | 'conifer' }[] = [];
  const free = (u: number, v: number) =>
    !(u < 470 && Math.abs(v) < 12) && // the axis vista from the garden door stays open
    distanceToLine(avoid.belt, [u, v]) >= GARDEN.path.beltWalk / 2 + 1.5 &&
    distanceToLine(avoid.spur, [u, v]) >= GARDEN.path.spur / 2 + 1.5 &&
    Math.hypot(u - avoid.basin.at[0], v - avoid.basin.at[1]) >= avoid.basin.r + 6 &&
    avoid.points.every((p) => Math.hypot(p[0] - u, p[1] - v) >= 6);
  FRAMING.forEach((G, gi) => {
    const rnd = mulberry32(0x4b4945 + gi * 0x9e37);
    const fl = Math.hypot(G.face[0] - G.u, G.face[1] - G.v);
    const fx = (G.face[0] - G.u) / fl;
    const fy = (G.face[1] - G.v) / fl;
    const b = G.r * GARDEN_GRADED.depth;
    const placed: [number, number, number][] = [];
    const fill = (layer: number, want: number, spacing: number) => {
      for (let k = 0, n = 0; k < 6000 && n < want; k++) {
        const a = (rnd() * 2 - 1) * G.r;
        const d = (rnd() * 2 - 1) * b;
        if ((a / G.r) ** 2 + (d / b) ** 2 > 1) continue;
        const s = d / b;
        if ((s > GARDEN_GRADED.split[0] ? 0 : s < GARDEN_GRADED.split[1] ? 2 : 1) !== layer) continue;
        const u = G.u - fy * a + fx * d;
        const v = G.v + fx * a + fy * d;
        if (!free(u, v)) continue;
        if (placed.some((p) => Math.hypot(p[0] - u, p[1] - v) < (p[2] === layer ? spacing : 1.3))) continue;
        placed.push([u, v, layer]);
        n++;
      }
    };
    fill(2, G.back.length, GARDEN_GRADED.back.spacing);
    fill(1, Infinity, GARDEN_GRADED.mid.spacing);
    fill(0, Infinity, GARDEN_GRADED.front.spacing);
    const r2 = (p: [number, number, number]): [number, number] => [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100];
    // back trees from one end to the other along the group (tangent -fy, fx), named in order
    const bk = placed.filter((p) => p[2] === 2).sort((p, q) => (-fy * p[0] + fx * p[1]) - (-fy * q[0] + fx * q[1]));
    if (bk.length !== G.back.length) throw new Error(`framing group ${G.name}: ${bk.length} of ${G.back.length} back trees placed`);
    // a poplar on a line of sight swaps with the free slot farthest from all of them (wave-9 review fix)
    const sp = [...G.back];
    const clearOf = (p: [number, number, number]) => Math.min(Infinity, ...(avoid.sight ?? []).map((s) => sightDistance(s, [p[0], p[1]])));
    for (let i = 0; i < sp.length; i++) {
      if (sp[i] !== 'poplar' || clearOf(bk[i]) >= GARDEN_GRADED.sightClear) continue;
      let best = -1;
      for (let j = 0; j < sp.length; j++) if (sp[j] !== 'poplar' && clearOf(bk[j]) >= GARDEN_GRADED.sightClear && (best < 0 || clearOf(bk[j]) > clearOf(bk[best]))) best = j;
      if (best < 0) throw new Error(`framing group ${G.name}: no back slot ${GARDEN_GRADED.sightClear} m off the line of sight for the poplar`);
      [sp[i], sp[best]] = [sp[best], sp[i]];
    }
    bk.forEach((p, i) => back.push({ at: r2(p), sp: sp[i] }));
    for (const p of placed) if (p[2] === 1) mid.push(r2(p));
    for (const p of placed) if (p[2] === 0) front.push(r2(p));
  });
  return { front, mid, back };
}

function framingGroups(g: GridFrame, avoid: FramingAvoid): TerrainFeature[] {
  const L = framingLayout(avoid);
  if (L.front.length < 12 || L.mid.length < 8) throw new Error(`framing groups: ${L.front.length} front, ${L.mid.length} mid plants (too few)`);
  const PLAN = 'D Petri plan c. 1788 (research/11 S2 c: "multicoloured shrub clumps", columnar poplar-like trees, dark pointed conifers)';
  const common = { kind: 'clump' as const, confidence: 'low' as const, placement: 'hypothetical' as const, epoch: { from: 1788 } };
  const pts = (uv: [number, number][]): GeoJsonGeometry => ({ type: 'MultiPoint', coordinates: uv.map(([u, v]) => rEN(g.toEN(u, v))) });
  const backOf = (sp: 'tilia' | 'poplar' | 'conifer') => L.back.filter((b) => b.sp === sp).map((b) => b.at);
  const where = `two groups framing the view from the lawn to the garden front (palace grid u 132 v 46 and u 85 v -22, ±20-30 m); layered low to tall away from the lawn (${GARDEN_GRADED.tag}); positions I (seeded)`;
  return [
    {
      ...common,
      id: 'TF-45',
      name: 'Gehölzrahmen im Herzogsgarten: niedrige Juliblüher (Rosen, Spiersträucher) vorn',
      geometry: pts(L.front),
      mix: [{ species: 'July-flowering low shrubs (Rosa gallica, Rosa × centifolia, Spiraea, Hypericum)', share: 1, height: [GARDEN_GRADED.front.height[0], GARDEN_GRADED.front.height[1]] }],
      tag: `${PLAN}; species and July bloom N (research/11 §3.1); ${where}`,
      notes: 'Wave 9 (garden audit #1): the front layer of the framing groups TF-45..49. KB-I12 decision kept: no planting on the open lawn in the axis vista.',
    },
    {
      ...common,
      id: 'TF-46',
      name: 'Gehölzrahmen im Herzogsgarten: hohe Sträucher (im Juli ohne Blüte)',
      geometry: pts(L.mid),
      // wave-9 review fix: lilac, mock orange, Viburnum and Cornus mas are out of flower in July, so no bloom tint
      mix: [{ species: 'Tall shrubs out of flower in July (Syringa, Philadelphus, Viburnum, Cornus mas)', share: 1, height: [GARDEN_GRADED.mid.height[0], GARDEN_GRADED.mid.height[1]] }],
      tag: `${PLAN}; species N, bloom May-June (research/11 §3.1), so green in July; ${where}`,
    },
    {
      ...common,
      id: 'TF-47',
      name: 'Gehölzrahmen im Herzogsgarten: junge Linden',
      geometry: pts(backOf('tilia')),
      // wave-9 review fix: a young feathered Heister, branched from 1.2-1.5 m, narrow ovoid, not the nursery standard
      mix: [{ species: 'Tilia (young feathered Heister, branched from low on the stem)', share: 1, height: [GARDEN_GRADED.heister.height[0], GARDEN_GRADED.heister.height[1]] }],
      tag: `${PLAN}; young trees of 1778-88 N/I; feathered Heister form and mid / yellow-green July leaf N (research/11 §3.1, §3.2); ${where}`,
    },
    {
      ...common,
      id: 'TF-48',
      name: 'Gehölzrahmen im Herzogsgarten: Pyramidenpappeln',
      geometry: pts(backOf('poplar')),
      mix: [{ species: 'Populus nigra Italica (Pyramidenpappel)', share: 1, height: [GARDEN.poplar.height[0], GARDEN.poplar.height[1]] }],
      tag: `${PLAN}; columnar trees D Petri plan ("pappelartig"); species I; German cultivation date U (research/11 §3.1 conflict); kept ${GARDEN_GRADED.sightClear} m off the line of sight from the lawn to the jet I; ${where}`,
    },
    {
      ...common,
      id: 'TF-49',
      name: 'Gehölzrahmen im Herzogsgarten: Nadelbäume',
      geometry: pts(backOf('conifer')),
      mix: [{ species: 'Conifer (Pinus strobus, Picea, Larix)', share: 1, height: [7, 10] }],
      tag: `${PLAN}; species N (research/11 §3.1); ${where}`,
    },
  ];
}

/**
 * Bernhard Petri's Herzogsgarten behind the CdL, c. 1788 (KB-I12, research/11 §1.2, S2) and the axial basin with
 * fountain and two stag heads (KB-I13, research/11 §1.3, S3). All positions read off the Petri plan as described by
 * Schneider are ±20-30 m until the plan is georeferenced (research/11 §8 Q2), hence confidence low.
 */
export function herzogsgarten(g: GridFrame): TerrainFeature[] {
  const out: TerrainFeature[] = [];
  const PLAN = 'D Petri plan c. 1788, BSB Cod.icon. 180 h 26r, read by Schneider (research/11 §1.2)';

  // ---- HG-01 lawn: same outline as the landcover lawn LC-22 (scripts/catalogue-v2/landcover.ts)
  const lawn = uvPoly(g, [
    [46, -62],
    [90, -96],
    [200, -110],
    [330, -100],
    [440, -60],
    [470, 10],
    [450, 80],
    [330, 100],
    [200, 106],
    [110, 110],
    [62, 92],
    [46, 62],
  ]);
  out.push({
    id: 'HG-01',
    kind: 'lawn',
    name: 'Herzogsgarten: offener Rasen (Petri, ab 1788)',
    geometry: poly(lawn),
    surface: 'lawn (mown) on the natural slope 345.3-356 m',
    confidence: 'low',
    tag: `${PLAN}: "a large open lawn ... composed like an English landscape garden", no parterre; 1788 "nach der allerneuesten englischen Mode" (research/10 b.7, D); outline I ±30 m (= landcover LC-22)`,
    notes: 'KB-I12: replaces the v2 parterre TF-09. No levelling: the lawn follows the natural slope.',
    epoch: { from: 1788 },
    epoch_tag: 'D Petri began the English garden in 1788 (research/10 b.7)',
  });

  // ---- HG-02 belt walk: kidney loop from the garden terrace, E toward the gallery tip, NE, E, back S of the axis
  const beltCtl = BELT_CTL;
  const belt = uvLine(g, chaikin(beltCtl, 3));
  out.push({
    id: 'HG-02',
    kind: 'path',
    name: 'Beltwalk des Herzogsgartens (Rundweg, Petri)',
    geometry: { type: 'LineString', coordinates: belt },
    width: GARDEN.path.beltWalk,
    surface: 'gravel (Buntsandstein grit)',
    confidence: 'low',
    tag: `${PLAN}: a yellow-drawn walk round a kidney-shaped lawn, from the CdL toward the E tip of the gallery, NE, then E through open lawns, returning S of the axis; width N Sckell 10 Fuß = 3.0 m (GARDEN.path.beltWalk); geometry I ±30 m`,
    epoch: { from: 1788 },
  });

  // ---- HG-07 garden-front walk (wave-10 review fix, KB-I88): a sanded walk along the outer edge of the garden
  // terrace TF-09, past both ends of the belt walk (u 53.6, v ±12), on to the corners of the wings (v ±40)
  const FRONT_U = 46.2 + GARDEN.gardenTerrace.depth + GARDEN.path.frontWalk / 2;
  out.push({
    id: 'HG-07',
    kind: 'path',
    name: 'Weg an der Gartenterrasse (vor dem Corps de logis)',
    geometry: { type: 'LineString', coordinates: uvLine(g, [[FRONT_U, -40], [FRONT_U, 40]]) },
    width: GARDEN.path.frontWalk,
    surface: 'gravel (Buntsandstein grit), sanded',
    confidence: 'low',
    tag: `N a sanded walk 8-12 Fuß wide along the garden front of a palace, joining the walks of the garden (Hirschfeld, Sckell; research/11 §4.4); ${PLAN}: the belt walk starts at the garden front; width 10 Fuß = 3.0 m I (GARDEN.path.frontWalk); course along the terrace edge and length to the wing corners I`,
    epoch: { from: 1788 },
  });

  // ---- HG-03 serpentine branch down to the Hirschwürzloch Brunnenhaus KB-B80 (fall ≈ 28 m)
  const serpCtl = SERP_CTL;
  const serp = uvLine(g, chaikin(serpCtl, 3));
  out.push({
    id: 'HG-03',
    kind: 'path',
    name: 'Serpentinenweg ins Hirschwürzloch (zum Brunnenhaus)',
    geometry: { type: 'LineString', coordinates: serp },
    width: 2.4,
    surface: 'gravel (Buntsandstein grit)',
    confidence: 'low',
    tag: `${PLAN}: near today's Forst-Bauhof the walk "descends in serpentines into the Hirschwürzloch" (Brunnenhaus KB-B80, 1783); 4 bends I (GARDEN.serpentineRadius 15-25 m I); width N Sckell 8 Fuß ≈ 2.4 m; geometry I ±30 m`,
    epoch: { from: 1788 },
  });

  // ---- HG-04 axial basin with fountain and two stag heads (S3)
  const bc: [number, number] = [112, 0];
  const bR = 7.0;
  const bcEN = g.toEN(bc[0], bc[1]);
  const basinRing = ring(circleRing(bcEN, bR, 32));
  out.push({
    id: 'HG-04',
    kind: 'pond',
    name: 'Bassin mit Fontäne und zwei Hirschköpfen (Gartenachse)',
    geometry: poly(basinRing),
    // stands on the levelled lawn rondell HG-05 (349.5); water 0.3 m above it, coping top 0.52 m above the lawn
    water_level: 349.8,
    coping: { width: GARDEN.basin.copingWidth, height: GARDEN.basin.copingHeight, material: 'stone.grey (Buntsandstein, painted grey)' },
    fountain_h: GARDEN.basin.jet,
    ornaments: { kind: 'stag_head', count: 2, facing: 'KB-B01' },
    confidence: 'low',
    tag: 'D presence, jet and two stag heads, built after 1783 behind the palace on the CdL axis (LA Speyer B3 2595, B4 2547, B3 2611 via Schneider; research/11 §1.3, G7, S3); distance I (u 112 = 66 m E of the garden front, research/11 S3 60-80 m); round D 14 m N/U; coping 0.4 x 0.25 m N; jet 5 m N/U; water level I = rondell HG-05 349.5 + 0.3',
    notes:
      'KB-I13: possibly demolished and backfilled in 1790 (a day-labour list, Schneider), so it stands in summer 1789. The natural slope (348.9-350.0 m on the rim) is levelled to a lawn rondell HG-05 at 349.5 around it [I].',
    epoch: { from: 1783, to: 1790 },
    epoch_tag: 'D after 1783 (LA Speyer B3 2595); I demolition 1790 (day-labour list via Schneider)',
  });

  // ---- HG-05 levelled lawn round the basin (the natural ground falls 1.1 m across the rim): a rondell, so
  // scripts/prepare-terrain.py levels it like TF-36 and paints it lawn; the basin water and coping stand on it
  out.push({
    id: 'HG-05',
    kind: 'rondell',
    name: 'Rasenplatz um das Bassin (eingeebnet)',
    geometry: poly(ring(circleRing(bcEN, bR + GARDEN.basin.copingWidth + 2.6, 32))),
    level: 349.5,
    surface: 'grass (lawn), levelled',
    confidence: 'low',
    tag: 'I: a formal basin needs level ground (N d\'Argenville / research/11 §4.5); level = DTM median of the site 349.5 m (2025 DTM, u 108-116; rim 348.9-350.0); apron 2.6 m I',
    epoch: { from: 1783, to: 1790 },
    epoch_tag: 'with the basin HG-04',
  });

  // ---- HG-10.. clumps at walk bends and framing views; the axis stays open (|v| >= r + 12 inside the loop)
  const clumps: { id: string; u: number; v: number; d: number; accent: 'conifer' | 'poplar'; retained?: boolean }[] = [];
  const C = (id: string, u: number, v: number, d: number, accent: 'conifer' | 'poplar', retained = false) => clumps.push({ id, u, v, d, accent, retained });
  C('HG-10', 112, 50, 12, 'poplar');
  C('HG-11', 150, 106, 16, 'conifer', true);
  C('HG-12', 185, 58, 14, 'conifer');
  C('HG-13', 262, 112, 20, 'conifer', true);
  C('HG-14', 280, 56, 14, 'poplar');
  C('HG-15', 372, 98, 18, 'conifer', true);
  C('HG-16', 395, 40, 12, 'conifer');
  C('HG-17', 498, 34, 16, 'poplar', true);
  C('HG-18', 498, -38, 16, 'poplar', true);
  C('HG-19', 418, -28, 10, 'conifer');
  C('HG-20', 360, -88, 18, 'conifer', true);
  C('HG-21', 312, -42, 12, 'poplar');
  C('HG-22', 232, -96, 20, 'conifer', true);
  C('HG-23', 205, -48, 12, 'conifer');
  C('HG-24', 150, -88, 16, 'poplar', true);
  C('HG-25', 92, -70, 12, 'conifer');
  for (const c of clumps) {
    out.push({
      id: c.id,
      kind: 'clump',
      name: `Gehölzgruppe im Herzogsgarten (${c.accent === 'conifer' ? 'mit Nadelbaum' : 'mit Pyramidenpappel'})`,
      geometry: { type: 'Point', coordinates: rEN(g.toEN(c.u, c.v)) },
      radius: c.d / 2,
      mix: CLUMP_MIX(c.d, c.accent, c.retained),
      confidence: 'low',
      tag: `${PLAN}: single trees and groups, "multicoloured shrub clumps" (blue, pink, yellow dots), columnar (poplar-like) trees and dark pointed conifers; D ${c.d} m within 8-25 m; shrub mass ~70 %, young trees 30 %, ${clumpAccents(c.d)} accent(s) I (research/11 S2 c); species N (§3.1); position I ±30 m`,
      epoch: { from: 1788 },
    });
  }

  // ---- HG-06 spur walk and HG-26..28 the planted "Wald" round the Rundpavillon KB-B87 (wave-5 fix, research/11 §1.2)
  const beltUV = chaikin(beltCtl, 3);
  const pav = pavilionSettingUV();
  out.push({
    id: 'HG-06',
    kind: 'path',
    name: 'Stichweg zum Rundpavillon',
    geometry: { type: 'LineString', coordinates: uvLine(g, pav.spur) },
    width: GARDEN.path.spur,
    surface: 'gravel (Buntsandstein grit)',
    confidence: 'low',
    placement: 'hypothetical',
    tag: `I: a spur from the belt walk HG-02 to the entrance of the Rundpavillon KB-B87 (pavilions are reached by walks on the Petri plan, ${PLAN}); width N footpath 0.9-2.3 m (GARDEN.path.spur); geometry I with the pavilion (±20-30 m)`,
    epoch: { from: 1788 },
  });
  for (const c of pav.clumps) {
    out.push({
      id: c.id,
      kind: 'clump',
      name: 'Gehölz um den Rundpavillon („Wald“, dicht gepflanzt)',
      geometry: { type: 'Point', coordinates: rEN(g.toEN(c.u, c.v)) },
      radius: c.d / 2,
      mix: CLUMP_MIX(c.d, c.accent, c.retained),
      confidence: 'low',
      placement: 'hypothetical',
      tag: `D Schneider: the round pavilion was built 1785/86 "in an area then called Wald (planted densely)" (research/11 §1.2); a crescent of planting behind the pavilion, open toward the walk I; D ${c.d} m, mix as the Herzogsgarten clumps N/I; position I with the pavilion (±20-30 m)`,
      epoch: { from: 1785 },
    });
  }

  // ---- HG-30 single trees on the lawn (30-60, research/11 S2 c): seeded points, off the axis vista, walks, clumps.
  // The seeded loop is the wave-4 one (unchanged, so the trees keep their places); items added later (furniture, the
  // pavilion setting) push a conflicting tree out to their keep-off radius instead of re-running the loop (wave-5 fix:
  // the furniture rule inside the loop had reshuffled every later tree).
  const rnd = mulberry32(0x4b4930);
  const lawnUV = lawn.map(([E, N]) => g.toUV(E, N) as [number, number]);
  const singlesUV: [number, number][] = [];
  for (let k = 0; k < 4000 && singlesUV.length < 34; k++) {
    const u = 60 + rnd() * 410;
    const v = -105 + rnd() * 210;
    if (!pointInPolygon([u, v], lawnUV)) continue;
    if (Math.abs(v) < 22 && u < 480) continue; // the axis vista from the garden door stays open
    if (Math.hypot(u - bc[0], v - bc[1]) < 20) continue;
    if (distanceToLine(beltUV, [u, v]) < 6) continue;
    if (clumps.some((c) => Math.hypot(c.u - u, c.v - v) < c.d / 2 + 6)) continue;
    if (singlesUV.some((p) => { const e = rEN(g.toEN(p[0], p[1])); const q = g.toUV(e[0], e[1]); return Math.hypot(q[0] - u, q[1] - v) < 22; })) continue;
    singlesUV.push([u, v]);
  }
  const keepOff: { at: [number, number]; r: number }[] = [
    ...furnitureSpotsUV().map((f) => ({ at: f.at, r: 8 })), // benches and the herm stay free
    ...pav.clumps.map((c) => ({ at: [c.u, c.v] as [number, number], r: c.d / 2 + 6 })),
    { at: pav.centre, r: pav.radius + 10 },
  ];
  const singles: EN[] = singlesUV.map(([u0, v0]) => {
    let [u, v] = [u0, v0];
    for (let pass = 0; pass < 3; pass++) {
      for (const k of keepOff) {
        const d = Math.hypot(u - k.at[0], v - k.at[1]);
        if (d >= k.r) continue;
        const ex = d > 1e-6 ? (u - k.at[0]) / d : 1;
        const ey = d > 1e-6 ? (v - k.at[1]) / d : 0;
        u = k.at[0] + ex * (k.r + 0.5);
        v = k.at[1] + ey * (k.r + 0.5);
      }
      // off the spur walk: push sideways
      const dw = distanceToLine(pav.spur, [u, v]);
      if (dw < 6) {
        const a = pav.spur[0];
        const b = pav.spur[pav.spur.length - 1];
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const nx = -(b[1] - a[1]) / L;
        const ny = (b[0] - a[0]) / L;
        const side = (u - a[0]) * nx + (v - a[1]) * ny >= 0 ? 1 : -1;
        u += side * nx * (6.5 - dw);
        v += side * ny * (6.5 - dw);
      }
    }
    return rEN(g.toEN(u, v));
  });
  out.push({
    id: 'HG-30',
    kind: 'clump',
    name: 'Einzelbäume im Herzogsgarten',
    geometry: { type: 'MultiPoint', coordinates: singles },
    mix: SINGLES_MIX,
    confidence: 'low',
    tag: `${PLAN}: single trees between the groups; retained older trees of the former "Wald" (research/11 §3.2, I); count 30-60 (S2 c) I, 34 so the clumps read as the masses; species N, mostly young (1789: 1-11 years) I; positions I (seeded, off the axis vista)`,
    epoch: { from: 1788 },
  });

  // ---- TF-45..49 graded framing groups (wave 9): appended with ids after every other feature, so the seeded tree
  // streams of the existing plantings keep their places (trees of one species are drawn in catalogue order)
  out.push(
    ...framingGroups(g, {
      belt: beltUV,
      spur: pav.spur,
      basin: { at: bc, r: bR },
      points: [...singlesUV, ...furnitureSpotsUV().map((f) => f.at), [65, 60], [70, 41], ...pav.clumps.map((c) => [c.u, c.v] as [number, number])],
      // the lawn view of poses 16 / 17 (eye u 150, v 25) to the jet
      sight: [{ eye: [150, 25], at: bc }],
    }),
  );

  // ---- self-checks (deterministic layout facts; the build fails if a later edit breaks them)
  if (polylineSelfIntersects(beltUV)) throw new Error('HG-02 belt walk self-intersects');
  const serpUV = chaikin(serpCtl, 3);
  if (polylineSelfIntersects(serpUV)) throw new Error('HG-03 serpentine self-intersects');
  for (const c of clumps) {
    const r = c.d / 2;
    const dw = Math.min(distanceToLine(beltUV, [c.u, c.v]), distanceToLine(serpUV, [c.u, c.v]));
    if (dw < r + GARDEN.path.beltWalk / 2 + 1) throw new Error(`${c.id} touches a walk (${dw.toFixed(1)} m from the centre line, r ${r})`);
    if (Math.hypot(c.u - bc[0], c.v - bc[1]) < r + bR + 6) throw new Error(`${c.id} crowds the basin`);
    if (c.u < 470 && Math.abs(c.v) < r + 12) throw new Error(`${c.id} blocks the axis vista`);
  }
  if (singles.length < 30) throw new Error(`HG-30: only ${singles.length} single trees`);
  for (const c of pav.clumps) {
    const r = c.d / 2;
    if (distanceToLine(beltUV, [c.u, c.v]) < r + GARDEN.path.beltWalk / 2 + 1) throw new Error(`${c.id} touches the belt walk`);
    if (distanceToLine(pav.spur, [c.u, c.v]) < r + GARDEN.path.spur / 2 + 1) throw new Error(`${c.id} touches the spur walk`);
    if (Math.hypot(c.u - pav.centre[0], c.v - pav.centre[1]) < r + pav.radius + 1) throw new Error(`${c.id} overlaps the pavilion`);
    if (c.u - r < 36 + 4) throw new Error(`${c.id} crowds the TF-08 treillage`);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ wave 5 garden detail

/** Palace-grid direction (du, dv) as a grid azimuth (deg): +v is grid az 350.5, +u 80.5. */
function uvAzimuth(g: GridFrame, from: [number, number], to: [number, number]): number {
  const a = g.toEN(from[0], from[1]);
  const b = g.toEN(to[0], to[1]);
  return r2a((Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI);
}
const r2a = (az: number) => Math.round(((az % 360) + 360) % 360 * 10) / 10;

/** The belt walk and the serpentine in the palace grid (same control points as herzogsgarten()). */
export const BELT_CTL: [number, number][] = [
  [53.6, 12], [70, 30], [88, 58], [115, 78], [165, 88], [228, 93], [292, 88], [352, 78], [410, 66], [452, 46], [474, 14], [470, -18], [450, -40], [400, -55], [330, -64], [260, -72], [190, -74], [138, -64], [98, -44], [70, -26], [53.6, -12],
];
export const SERP_CTL: [number, number][] = [
  [452, -42], [440, -66], [398, -80], [382, -90], [420, -102], [455, -110], [462, -119], [430, -130], [415, -139], [440, -150], [464, -156],
];

/** KB-B87 Rundpavillon (scripts/catalogue-v2/buildings.ts): centre (palace grid u, v) and radius. */
export const KB_B87_UV: [number, number] = [70.0, -56.0];
export const KB_B87_R = 4.5;

/**
 * Setting of the Rundpavillon KB-B87 (wave-5 fix; research/11 §1.2 "built 1785/86 in an area then called Wald
 * (planted densely)" [D]): the entrance faces the nearest point of the belt walk (the catalogue sets the building's
 * `court_toward` to HG-02, so the door bay turns the same way), a spur walk runs from the belt walk to the steps, and a
 * crescent of three clumps closes the pavilion's back and flanks [I].
 */
export function pavilionSettingUV(): { centre: [number, number]; radius: number; spur: [number, number][]; clumps: { id: string; u: number; v: number; d: number; accent: 'conifer' | 'poplar'; retained: boolean }[] } {
  const belt = chaikin(BELT_CTL, 3);
  const [cu, cv] = KB_B87_UV;
  let best: [number, number] = belt[0];
  let bd = Infinity;
  const L = polylineLength(belt);
  for (let s = 0; s <= L; s += 0.25) {
    const p = pointAlong(belt, s).p;
    const d = Math.hypot(p[0] - cu, p[1] - cv);
    if (d < bd) {
      bd = d;
      best = [p[0], p[1]];
    }
  }
  const ex = (best[0] - cu) / bd;
  const ey = (best[1] - cv) / bd;
  const r2 = (x: number) => Math.round(x * 100) / 100;
  // from the walk's inner edge to 2 m in front of the drum (the steps project ~1.6 m)
  const a: [number, number] = [r2(best[0] - ex * (GARDEN.path.beltWalk / 2 - 0.2)), r2(best[1] - ey * (GARDEN.path.beltWalk / 2 - 0.2))];
  const b: [number, number] = [r2(cu + ex * (KB_B87_R + 2.0)), r2(cv + ey * (KB_B87_R + 2.0))];
  const spur: [number, number][] = [a, [r2((a[0] + b[0]) / 2), r2((a[1] + b[1]) / 2)], b];
  const back = Math.atan2(-ey, -ex);
  const C = (id: string, rel: number, dist: number, d: number, accent: 'conifer' | 'poplar', retained: boolean) => ({
    id,
    u: r2(cu + Math.cos(back + (rel * Math.PI) / 180) * dist),
    v: r2(cv + Math.sin(back + (rel * Math.PI) / 180) * dist),
    d,
    accent,
    retained,
  });
  return {
    centre: KB_B87_UV,
    radius: KB_B87_R,
    spur,
    clumps: [C('HG-26', 0, KB_B87_R + 9.5, 16, 'conifer', true), C('HG-27', 72, KB_B87_R + 8.5, 13, 'poplar', false), C('HG-28', -72, KB_B87_R + 8.5, 13, 'conifer', false)],
  };
}

/** Clump centres and diameters of the Herzogsgarten (as in herzogsgarten()). */
const CLUMPS_UV: [number, number, number][] = [
  [112, 50, 12], [150, 106, 16], [185, 58, 14], [262, 112, 20], [280, 56, 14], [372, 98, 18], [395, 40, 12], [498, 34, 16], [498, -38, 16], [418, -28, 10], [360, -88, 18], [312, -42, 12], [232, -96, 20], [205, -48, 12], [150, -88, 16], [92, -70, 12],
];

/** Garden furniture positions in the palace grid (benches and the Flora herm); exported so the single trees avoid them. */
export function furnitureSpotsUV(): { type: 'bench' | 'herm'; at: [number, number]; facingTo?: [number, number]; facingUV?: number; platform?: boolean; why: string }[] {
  const belt = chaikin(BELT_CTL, 3);
  const serp = chaikin(SERP_CTL, 3);
  const off = GARDEN.path.beltWalk / 2 + 0.95;
  const out: ReturnType<typeof furnitureSpotsUV> = [];
  // benches in front of the clumps next to the belt walk, back to the planting, looking across the walk [D Schneider]
  const L = polylineLength(belt);
  for (const [cu, cv, d] of CLUMPS_UV) {
    let best = { d: 0, dist: Infinity };
    for (let s = 0; s <= L; s += 1) {
      const p = pointAlong(belt, s).p;
      const dist = Math.hypot(p[0] - cu, p[1] - cv);
      if (dist < best.dist) best = { d: s, dist };
    }
    if (best.dist > d / 2 + 26 || best.dist < d / 2 + off + 0.8) continue; // a clump close to the walk (12-26 m off its edge)
    const { p, dir } = pointAlong(belt, best.d);
    const side: 1 | -1 = -dir[1] * (cu - p[0]) + dir[0] * (cv - p[1]) > 0 ? 1 : -1;
    const sp = walkSideSpot(belt, best.d, side, off);
    out.push({ type: 'bench', at: sp.at, facingUV: sp.facing, why: `clump front (D ${d} m)` });
  }
  // the E turn of the belt walk: a bench at the end of the axis vista, looking back W to the garden front [D Schneider "at the ends of vistas"]
  {
    let best = { d: 0, dist: Infinity };
    for (let s = 0; s <= L; s += 0.5) {
      const p = pointAlong(belt, s).p;
      const dist = Math.hypot(p[0] - 472, p[1]);
      if (dist < best.dist) best = { d: s, dist };
    }
    const { dir } = pointAlong(belt, best.d);
    const side: 1 | -1 = -dir[1] > 0 ? 1 : -1; // the outer (E) side of the walk's turn
    const sp = walkSideSpot(belt, best.d, side, off);
    out.push({ type: 'bench', at: sp.at, facingTo: [46, 0], why: 'end of the axis vista (outer side of the walk), facing the Corps de logis' });
  }
  // three benches on the steep climb of the serpentine, on levelled platforms, facing the Brunnenhaus KB-B80 [D Schneider]
  const LS = polylineLength(serp);
  for (const t of [0.42, 0.6, 0.78]) {
    const { p, dir } = pointAlong(serp, LS * t);
    const toB: [number, number] = [470 - p[0], -169 - p[1]];
    const side: 1 | -1 = -dir[1] * toB[0] + dir[0] * toB[1] > 0 ? -1 : 1;
    const sp = walkSideSpot(serp, LS * t, side, 2.4 / 2 + 0.95);
    out.push({ type: 'bench', at: sp.at, facingTo: [470, -169], platform: true, why: 'steep climb with views to the Hirschwürzloch' });
  }
  // Flora herm at the front of clump HG-10, looking S over the axis and the basin [D herm; position I]
  out.push({ type: 'herm', at: [112, 42.2], facingTo: [112, 0], why: 'clump front facing the axis vista' });
  return out;
}

/**
 * KB-I32..I38 (wave 5): garden furniture (benches, the Flora herm), the kitchen beds of the Holländische Gärtnerei and
 * the Herzogskastanien grove (research/11 S6, S11, S13). Positions are I ±30 m (the Petri plan is not georeferenced).
 */
export function gardenDetail(ctx: TerrainCtx): TerrainFeature[] {
  const g = ctx.grid;
  const out: TerrainFeature[] = [];
  const PLAN = 'D Petri plan c. 1788, BSB Cod.icon. 180 h 26r, read by Schneider (research/11 §1.2)';

  // ---- HG-40 benches and HG-41 the Flora herm (research/11 S6, §4.6)
  const spots = furnitureSpotsUV();
  const items = (type: 'bench' | 'herm'): GardenItem[] =>
    spots
      .filter((s) => s.type === type)
      .map((s) => ({
        type,
        at: rEN(g.toEN(s.at[0], s.at[1])),
        facing: s.facingTo ? uvAzimuth(g, s.at, s.facingTo) : r2a(s.facingUV! + 350.5),
        ...(s.platform ? { platform: true } : {}),
        tag: s.why,
      }));
  const benches = items('bench');
  out.push({
    id: 'HG-40',
    kind: 'furniture',
    name: 'Gartenbänke im Herzogsgarten (grün gestrichen)',
    geometry: { type: 'MultiPoint', coordinates: benches.map((b) => b.at) },
    items: benches,
    confidence: 'low',
    tag: `D 52 green-painted garden benches in the Orangerie cellar (Schügens damage list via Schneider; research/11 §0, §1.3); D ${PLAN}: "small rectangles" = park benches in front of plantings, at the ends of vistas and at viewpoints, on slopes on small levelled platforms, a dense run of 3 on a steep climb with views to the Hirschwürzloch; colour #3F5A3A D; form N (2.0 x 0.55 m, back 0.9 m); positions I ±30 m; count ${benches.length} I (12-20)`,
    epoch: { from: 1788 },
  });
  const herm = items('herm');
  out.push({
    id: 'HG-41',
    kind: 'furniture',
    name: 'Florahermé (gelblicher Sandstein) im Herzogsgarten',
    geometry: { type: 'MultiPoint', coordinates: herm.map((b) => b.at) },
    items: herm.map((h) => ({ ...h, name_de: 'Florahermé' })),
    confidence: 'low',
    tag: 'D a yellowish sandstone Flora herm survives (HMP Speyer, 40.5 cm fragment; research/10 O1, research/11 §1.3 "Florabüste", "angeblich" from the Karlsberg); D Petri plan small squares at marked points on the lawn = sculpture or aviaries (Schneider); pedestal 1.2 m and herm form N; position I (front of clump HG-10 facing the axis)',
    notes: 'KB-I33: the Bacchus group and the aviaries are documented but not located [U]; not placed.',
    epoch: { from: 1788 },
  });

  // ---- KG-01 kitchen and forcing garden of the Holländische Gärtnerei (KB-B27 walls, LiDAR KB-23; research/11 S11)
  const kb = lidarPoly(ctx, 'KB-23');
  const pts = kb.slice(0, -1);
  // layout axis = the wall edge closest to the palace grid u axis (the walls run ≈ 12° off the grid)
  let axis = 80.5;
  let bestDiff = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    let az = (Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI;
    az = ((az % 180) + 180) % 180;
    const diff = Math.abs(az - 80.5);
    if (diff < bestDiff) {
      bestDiff = diff;
      axis = az;
    }
  }
  // N wall (the edge with the largest mean v): its inner face looks S -> espaliers [N]
  let nEdge = 0;
  let nV = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    const a = g.toUV(pts[i][0], pts[i][1]);
    const b = g.toUV(pts[(i + 1) % pts.length][0], pts[(i + 1) % pts.length][1]);
    if ((a[1] + b[1]) / 2 > nV) {
      nV = (a[1] + b[1]) / 2;
      nEdge = i;
    }
  }
  const na = pts[nEdge];
  const nb = pts[(nEdge + 1) % pts.length];
  const nl = Math.hypot(nb[0] - na[0], nb[1] - na[1]);
  const tE = [(nb[0] - na[0]) / nl, (nb[1] - na[1]) / nl];
  // inward = toward the polygon centroid
  const cen = pts.reduce((acc, p) => [acc[0] + p[0] / pts.length, acc[1] + p[1] / pts.length], [0, 0]);
  let inn = [-tE[1], tE[0]];
  const mid = [(na[0] + nb[0]) / 2, (na[1] + nb[1]) / 2];
  if ((cen[0] - mid[0]) * inn[0] + (cen[1] - mid[1]) * inn[1] < 0) inn = [-inn[0], -inn[1]];
  const espIn = 0.55; // wall centre line -> 0.25 m off the 0.6 m wall face
  const esp: EN[] = [
    rEN([na[0] + tE[0] * 5 + inn[0] * espIn, na[1] + tE[1] * 5 + inn[1] * espIn]),
    rEN([nb[0] - tE[0] * 5 + inn[0] * espIn, nb[1] - tE[1] * 5 + inn[1] * espIn]),
  ];
  // hotbed frames S of the glasshouses KB-B54 / KB-B56 and the lodging KB-B55 (S faces at v ≈ 199-200), two rows [D-> BSB 25r couches; I]
  const frameRows: EN[][] = [193.6, 190.6].map((v) => [rEN(g.toEN(-14, v)), rEN(g.toEN(54, v))]);
  out.push({
    id: 'KG-01',
    kind: 'beds',
    name: 'Holländische Gärtnerei: Beete, Mistbeetkästen und Spalierobst',
    geometry: poly(kb),
    beds: {
      quarters: [2, 3],
      axis_deg: Math.round(axis * 100) / 100,
      frame_rows: frameRows,
      espaliers: [esp],
      tag: 'D Petri plan via Schneider: two greenhouses facing due S, rows of beds toward the palace; D-> BSB 25r forcing garden type (couches = hotbed frames); N beds 1.2-1.5 m, paths 0.5 m, espaliers on S-facing walls; quarters 2 x 3 I',
    },
    confidence: 'low',
    tag: 'D LP06 11 "Holländische Gärtnerei", K05 hatched garden parcels, PV g. "La serre chaude"; D Petri via Schneider (research/11 §1.2, G12, S11); layout N/I',
    notes: 'KB-I36: replaces the grid-like splat quarters inside the walls with beds in quarters whose rows alternate direction, hotbed frames in front of the glasshouses and espaliered fruit on the S-facing N wall [N].',
  });

  // ---- HK-01 Herzogskastanien above the Hirschwürzloch (research/11 S13, G17)
  const groveUV: [number, number][] = [];
  for (let k = 0; k < 24; k++) {
    const t = (k / 24) * Math.PI * 2;
    groveUV.push([325 + 30 * Math.cos(t) + 3 * Math.sin(3 * t), -148 + 21 * Math.sin(t) + 2 * Math.cos(2 * t)]);
  }
  groveUV.push(groveUV[0]);
  const G = GARDEN_DETAIL.grove;
  const grove = groveGrid(groveUV, (G.spacing[0] + G.spacing[1]) / 2, G.jitter, 0.35, 0x4b4b31).map((p) => rEN(g.toEN(p[0], p[1])));
  out.push({
    id: 'HK-01',
    kind: 'clump',
    name: 'Herzogskastanien (Esskastanienhain über dem Hirschwürzloch)',
    geometry: { type: 'MultiPoint', coordinates: grove },
    mix: [{ species: 'Edelkastanie (Castanea sativa, D: Herzogskastanien)', share: 1, height: [G.height[0], G.height[1]] }],
    confidence: 'low',
    tag: `D species and place: sweet chestnuts ("Esskastanien" gathered by the local people) above the Hirschwürzloch (de.wikipedia via research/11 §0 item 4, G17, S13); planted after 1777 -> 6-8 m in 1789 I (§3.2); loose ${G.spacing[0]}-${G.spacing[1]} m grid I; ${grove.length} trees I (20-40); position I ±30 m`,
    epoch: { from: 1778 },
  });
  if (grove.length < 20 || grove.length > 40) throw new Error(`HK-01: ${grove.length} trees (20-40 expected)`);
  if (benches.length < 12 || benches.length > 20) throw new Error(`HG-40: ${benches.length} benches (12-20 expected)`);
  return out;
}

/** Local viewer frame (x = E − E0, z = −(N − N0)) → EN. */
const loc = (x: number, z: number): EN => [E0 + x, N0 - z];
const locLine = (pts: [number, number][]): EN[] => pts.map(([x, z]) => rEN(loc(x, z)));
const locBox = (x0: number, x1: number, z0: number, z1: number): [number, number][] => [
  [x0, z0],
  [x1, z0],
  [x1, z1],
  [x0, z1],
];
const locCircle = (x: number, z: number, r: number): [number, number][] => circleRing([x, z], r, 16).slice(0, -1) as [number, number][];

/**
 * KB-I71 (wave-7 review fix): the setting of the wave-7 hypotheses, which stood on bare meadow without approach,
 * planting or water (poses 13, 11, 43, 44, 45). Serpentine gravel walks (2 m, the Herzogsgarten gravel) from the nearest
 * existing walk or way to each folly, shrub backdrops behind them, a mown lawn apron round the Monopteros, and for the
 * Wassermaschine KB-B91 a well shaft and a cart track from the N-S Allee TF-10. All hypothetical, low confidence, with
 * the follies' ±50–100 m caveat (V23 is schematic). Positions follow the catalogue footprints of buildings.ts (local
 * frame); model/tests/folly-setting.test.ts checks that every walk still ends at its building and crosses none.
 */
function follySettings(feats: TerrainFeature[]): TerrainFeature[] {
  const out: TerrainFeature[] = [];
  const V23 = 'D→ V23 (Schwan 2010 p. XXXI / 2012 Abb. 1; research/10 §b.6) places the folly only schematically (±50–100 m)';
  const WALK =
    'walk N 1780s landscape garden: pavilions and staffage are reached by winding walks (research/11 §4.4, the Petri plan\'s walks to its pavilions, research/11 §1.2); route, bends and width 2 m I; gravel as the Herzogsgarten walks (GARDEN path colour #B79A84) N';
  const SHRUBS = 'N the 1780s practice of setting a garden building against a shrubbery with an open front (research/11 §4.4, §3.1 species); position and size I';
  const backdrop: PlantMix[] = [
    { species: 'Flowering shrubs (Syringa, Philadelphus, Viburnum, Cornus mas)', share: 0.8, height: [GARDEN.shrub[0], GARDEN.shrub[1]] },
    { species: 'Tilia / Carpinus (young feathered trees)', share: 0.2, height: [GARDEN.youngTree[0], GARDEN.youngTree[1]] },
  ];
  const ringOf = (id: string): [number, number][] => {
    const f = feats.find((t) => t.id === id);
    if (f?.geometry.type !== 'Polygon') throw new Error(`folly setting: ${id} is not a polygon`);
    return (f.geometry.coordinates[0] as EN[]).map(([E, N]) => [E - E0, -(N - N0)] as [number, number]);
  };
  // obstacles in the local frame (footprints of buildings.ts KL-B50..53, KB-B89..91; the amphitheatre moat; the ponds)
  const voliere = locBox(1864.5, 1879.5, 67.4, 74.6);
  const tent = locCircle(1897, 43, 4.4);
  const wagon = locBox(1842.4, 1853.6, 11.8, 16.2);
  const tschifflik = locBox(1805.5, 1838.5, 39.5, 58.5); // KL-B46 on the terrace
  const avoidKL = [voliere, tent, wagon, tschifflik, ringOf('TF-37'), ringOf('TF-33'), ringOf('TF-34')];
  const walk = (
    id: string,
    name: string,
    legs: { a: [number, number]; b: [number, number]; amp?: number; side?: 1 | -1 }[],
    width: number,
    tag: string,
    notes: string,
    avoid: [number, number][][] = avoidKL,
  ): TerrainFeature => {
    const pts: [number, number][] = [];
    for (const l of legs) {
      const seg = serpentineWalk(l.a, l.b, { amp: l.amp, side: l.side, avoid, clear: 1.5 });
      pts.push(...(pts.length ? seg.slice(1) : seg));
    }
    return {
      id,
      kind: 'path',
      name,
      geometry: { type: 'LineString', coordinates: locLine(pts) },
      width,
      surface: 'gravel (Buntsandstein grit)',
      confidence: 'low',
      placement: 'hypothetical',
      tag,
      notes,
    };
  };
  const clump = (id: string, name: string, x: number, z: number, r: number, tag: string, mix: PlantMix[] = backdrop): TerrainFeature => ({
    id,
    kind: 'clump',
    name,
    geometry: { type: 'Point', coordinates: rEN(loc(x, z)) },
    radius: r,
    mix,
    confidence: 'low',
    placement: 'hypothetical',
    tag,
  });

  // ---- Karlslust staffage zone (KL-B51 tent, KL-B52 hay wagon, KL-B53 volière) W of the amphitheatre KL-B40
  out.push(
    walk(
      'KL-W1',
      'Staffageweg: Terrassentreppe – Volierenpavillon – Amphitheater (Hypothese)',
      [
        { a: [1820, 74], b: [1860, 76.8], amp: 0.08 },
        { a: [1860, 76.8], b: [1882, 74.8], amp: 0 },
        { a: [1882, 74.8], b: [1907.5, 78.5], amp: 0.08, side: -1 },
      ],
      2.0,
      `${V23} for KL-B53 and the amphitheatre KL-B40 (D LP06 53); ${WALK}; from the S end of the terrace stair TF-35 along the volière's S front to the W rim of the moat TF-37`,
      'KB-I71: leads to KL-B53 (front) and KL-B40; branches KL-W2 (tent) and KL-W3 (hay wagon).',
    ),
    walk(
      'KL-W2',
      'Weg zum Türkischen Zelt (Hypothese)',
      [{ a: [1890, 75.5], b: [1897.5, 48.6], amp: 0.12 }],
      2.0,
      `${V23} for KL-B51; ${WALK}; branch of KL-W1 up the slope (+4 m) to the tent`,
      'KB-I71: leads to KL-B51.',
    ),
    walk(
      'KL-W3',
      'Fahrspur zum Heuwagen (Hypothese)',
      [{ a: [1852, 76.6], b: [1848, 17.2], amp: 0.12 }],
      1.6,
      `${V23} for KL-B52; a trodden track up the hay meadow (+14 m) to the staffage wagon N/I; width 1.6 m N footpath (GARDEN path range); route I`,
      'KB-I71: leads to KL-B52.',
    ),
    clump('KL-C1', 'Strauchkulisse hinter dem Volierenpavillon (Hypothese)', 1872, 59, 5, `${V23} for KL-B53; ${SHRUBS}; N of the volière, its S front stays open to the walk`),
    clump('KL-C2', 'Strauchkulisse am Türkischen Zelt (Hypothese)', 1906.5, 35, 5, `${V23} for KL-B51; ${SHRUBS}; SE of the tent, the view from the walk and the ring stays open`),
  );

  // ---- KL-B50 Chinese pavilion S of the Schwanenweiher, from the cascade-head rondell TF-36
  out.push(
    walk(
      'KL-W4',
      'Weg vom Kaskadenkopf zum Chinesischen Pavillon (Hypothese)',
      [{ a: [1822, 350], b: [1940.6, 352.4], amp: 0.06 }],
      2.0,
      `${V23} for KL-B50; ${WALK}; from the rondell TF-36 at the head of the cascade along the S side of the Schwanenweiher (falls 23 m in three bends)`,
      'KB-I71: leads to KL-B50.',
    ),
    clump('KL-C3', 'Strauchkulisse hinter dem Chinesischen Pavillon (Hypothese)', 1947, 365, 6, `${V23} for KL-B50; ${SHRUBS}; S of the pavilion, open toward the ponds`),
  );

  // ---- KB-B89 Monopteros at the W end of the Karlsbergweiher: from the W dam TF-22, a mown lawn apron, shrubs behind
  const mono = { x: 832, z: -914 };
  out.push(
    walk(
      'KB-W5',
      'Dammweg und Stichweg zum Monopteros (Hypothese)',
      [
        { a: [821.5, -851], b: [818, -900.5], amp: 0 },
        { a: [818, -900.5], b: [828.4, -911.2], amp: 0.1 },
      ],
      2.0,
      `${V23} for KB-B89; ${WALK}; along the crest of the W dam TF-22 (D LP06) and up to the temple`,
      'KB-I71: leads to KB-B89.',
      [locCircle(mono.x, mono.z, 3.9), ringOf('TF-20')],
    ),
    {
      id: 'KB-L1',
      kind: 'lawn',
      name: 'Rasenplatz um den Monopteros (Hypothese)',
      geometry: poly(ring(locCircle(mono.x, mono.z + 2, 11).map(([x, z]) => loc(x, z)))),
      surface: 'lawn (mown)',
      confidence: 'low',
      placement: 'hypothetical',
      tag: `${V23} for KB-B89; N a temple on a mown lawn above the water, reaching toward the bank (research/11 §4.4); radius 11 m I`,
    },
    clump('KB-C4', 'Strauchkulisse hinter dem Monopteros (Hypothese)', mono.x - 2, mono.z - 13, 6, `${V23} for KB-B89; ${SHRUBS}; N of the temple toward the vineyard LC-23, open toward the pond`),
  );

  // ---- V23 no. 3 "Felsenpfad mit Inschrift" S of the Karlsbergweiher (research/10 §b.6): a narrow walk along the S
  // shore from the S end of the W dam TF-22 (where KB-W5 starts) to the E end of the pond. The inscribed rock has no
  // item kind and no text source, so it is not drawn [U]. The Sammelbecken (V23 no. 27) and the Vogeltränke (V23 no. 19)
  // stay undrawn: the LiDAR shows no separate basin S of the Schwanenweiher (KL-05..07 are the three ponds), and the
  // Vogeltränke is a zone without a form (UP-23).
  // Wave-8 review fix: a landscape-garden rock path is a narrow trodden path of Buntsandstein earth that follows the
  // bank, not a raked gravel walk: surface 'trodden earth' (prepare-terrain.py does not paint it into the ground
  // classes, so it moves no tree of the viewer's planners; site/features.ts draws a soft earth ribbon and a few low
  // Buntsandstein outcrops beside it). The route traces the ~278 m contour of the 1789 DTM (1.8 m above the water at
  // 276.18 m, 3–8 m off the pond outline) and passes 8 m N of the old walnut on the bank (viewer openTreePlan, x 901,
  // z −842), which it used to cut [I].
  const felsCtl: [number, number][] = [
    [821.5, -851], // S end of the W dam TF-22, where KB-W5 starts
    [828, -846],
    [836, -842.5],
    [846, -842.5],
    [856, -844],
    [866, -847],
    [876, -849.5],
    [888, -850.5],
    [900, -850],
    [912, -850],
    [924, -850.5],
    [934, -851.5],
    [944, -852.5],
    [956, -853.5],
  ];
  out.push({
    id: 'KB-W8',
    kind: 'path',
    name: 'Felsenpfad am Südufer des Karlsbergweihers (Hypothese)',
    geometry: { type: 'LineString', coordinates: locLine(chaikin(felsCtl, 3)) },
    width: 1.4,
    surface: 'trodden earth (Buntsandstein), rock outcrops',
    confidence: 'low',
    placement: 'hypothetical',
    tag: `D→ V23 no. 3 "Felsenpfad mit Inschrift" S of the Karlsbergweiher (research/10 §b.6, ±50–100 m); route along the S bank on the ~278 m contour of the 1789 DTM, 3–8 m off the water I; a footpath 1.4 m wide N (Sckell Fußpfade 0.9–1.6 m, research/11 §4.4) of trodden earth with low Buntsandstein outcrops beside it N (landscape-garden rockwork; the Karlslust tumulus and dams were faced with boulders, research/11 §1.4 [D]; positions and sizes I); the inscribed rock and its text U (not drawn)`,
    notes: 'KB-I71 residual (wave 8); wave-8 review fix: trodden earth on the contour, round the bank walnut.',
  });

  // ---- KB-B90 Bienenhaus: a spur up the bank from the Apfelallee TF-14
  out.push(
    walk(
      'KB-W6',
      'Stichweg zum Bienenhaus (Hypothese)',
      [{ a: [1305.1, -955.2], b: [1324.4, -962.1], amp: 0.12, side: -1 }],
      1.6,
      'D→ V23 Bienenhaus zone SE of the Orangerie (research/10 §b.6, ±50–100 m); a footpath from the Apfelallee TF-14 (N of the Orangerie S wing KB-B12) up the 4 m bank to the apiary N/I; width 1.6 m N',
      'KB-I71: leads to KB-B90.',
      [locBox(1325.5, 1330.5, -963.7, -960.3), [[1255.7, -927.0], [1312.9, -939.5], [1310.3, -951.3], [1253.2, -938.8]]],
    ),
  );

  // ---- KB-B91 Wassermaschine: a well shaft at the house and a cart track from the N-S Allee TF-10
  out.push(
    walk(
      'KB-W7',
      'Fahrweg zur Wassermaschine (Hypothese)',
      [{ a: [1172, -1317.5], b: [1097.2, -1318.4], amp: 0.06 }],
      2.5,
      'D→ V23 no. 7 Wassermaschine NW of the palace on the slope (research/10 §b.6, ±50–100 m); a cart track from the N-S Allee TF-10 down to the machine house (fall 10 m) N/I; the 1778-80 Wasserleitung to the Karlsberg (research/01 timeline, D) is buried and assumed to follow it [I], so it is not drawn',
      'KB-I71: leads to KB-B91 (E gable).',
      [locBox(1087.8, 1096.2, -1321.3, -1314.7)],
    ),
    {
      id: 'KB-WB1',
      kind: 'well',
      name: 'Brunnenschacht der Wassermaschine (Hypothese)',
      geometry: { type: 'Point', coordinates: rEN(loc(1092, -1311.3)) },
      confidence: 'low',
      placement: 'hypothetical',
      tag: 'D→ V23 no. 7 Wassermaschine (research/10 §b.6); D a well and water conduit to the Karlsberg 1778-80 (research/01 timeline); N a pump house of the period lifts from a well shaft beside or under it (Rosskunst / Pumpwerk), its drive (horse gin or treadwheel inside) U; shaft N of the house I; the spring line of the NW slope U',
      notes: 'KB-I71 (wave-7 review: "a water-lifting machine needs water"): the visible part of the hypothesis; KB-B91 itself is not moved (architecture).',
    },
    clump(
      'KB-C5',
      'Hoflinde und Sträucher an der Wassermaschine (Hypothese)',
      1092,
      -1328,
      5,
      'N a lime and shrubs beside a service house (research/11 §3.1); position I',
      [
        { species: 'Flowering shrubs (Sambucus, Cornus mas, Rosa)', share: 0.75, height: [GARDEN.shrub[0], GARDEN.shrub[1]] },
        { species: 'Tilia (Hoflinde, feathered solitary)', share: 0.25, height: [7, 9] },
      ],
    ),
  );
  return out;
}

/**
 * KB-I68: the two located fences. KB-F1 the post-and-rail fence Le Clerc 1790 draws in front of the court-mouth guard
 * houses KB-B37 / KB-B38 (research/11 §1.5), only between the two houses as the view shows it; KB-F2 the barrière between
 * the valley-entrance guard houses KB-B63 / KB-B64 (PV 1791 l. 1 "… pour le corps de garde et la barrière"). The ≈ 100 km
 * Wildzaun has no located line (KB-I40) and is not drawn. Both low confidence; the end points sit 0.3–0.4 m off the
 * catalogue footprints of buildings.ts (KB-B37/38 ±6 m, KB-B63/64 ±15 m).
 */
/**
 * Wave-8 review fix (pose 18): the mown lawn of the Herzogsgarten reaches the rotunda KB-B07 and the gallery's garden
 * end. Between the HG-01 / LC-22 outline (extents I ±30 m) and the forest belt N of it a wedge of pasture was left,
 * so the rotunda's garden side stood in meadow, against KB-I61 ("lawn up to the rotunda plinth"). KB-L2 closes it,
 * stopping short of the forest edge and the gallery [N pleasure-ground lawn round garden pavilions, research/11 §1.2;
 * outline I].
 */
function pleasureLawns(): TerrainFeature[] {
  // it keeps ≥ 9 m off the old oak standing out in front of the forest edge at (1314.9, −1253.1) (viewer openTreePlan
  // Überhälter: no tree within 8 m of a lawn), so no tree moves, and off the kitchen garden LC-24 (x < 1284)
  const pts: [number, number][] = [
    [1285, -1252],
    [1298, -1251],
    [1305, -1243.5],
    [1336, -1243.5],
    [1336, -1238],
    [1312, -1234],
    [1296, -1230],
    [1286, -1229],
  ];
  return [
    {
      id: 'KB-L2',
      kind: 'lawn',
      name: 'Rasen an der Rotunde (Gartenseite der Galerie)',
      geometry: poly(ring(pts.map(([x, z]) => loc(x, z)))),
      surface: 'lawn (mown)',
      confidence: 'low',
      tag: 'N the pleasure-ground lawn runs up to the garden pavilions (research/11 §1.2; KB-I61 lawn up to the rotunda plinth); the wedge between the HG-01 outline (Petri c. 1788, extents I ±30 m) and the forest belt N of it, short of the pasture with the old oak at the forest edge; outline I',
      epoch: { from: 1788 },
    },
  ];
}

function fences(): TerrainFeature[] {
  return [
    {
      id: 'KB-F1',
      kind: 'fence',
      name: 'Lattenzaun vor den Wachhäusern an der Ehrenhofmündung (Le Clerc 1790)',
      // from the SW corner of KB-B38 (N) to the NW corner of KB-B37 (S), 0.4 m out on the W (field) side
      geometry: { type: 'LineString', coordinates: [[382166.92, 5466117.0], [382170.62, 5466106.02]] },
      fence_line: { type: 'post_rail', height: 1.15, rails: 2, tag: 'D post-and-rail fence in front of the guard houses (Le Clerc 1790, research/11 §1.5); N two-rail field fence; height and post spacing I (FENCE.postRail)' },
      confidence: 'low',
      tag: 'D presence Le Clerc 1790 (research/11 §1.5: young round-headed trees in a loose row in front of the guard houses, with a post-and-rail fence); line only between KB-B38 and KB-B37 as the view draws it, its run in plan I (a 550 px view, not georeferenced); timber colour I',
      notes: 'KB-I68.',
    },
    {
      id: 'KB-V1',
      kind: 'path',
      name: 'Vorplatz vor der Terrassenmauer an der Ehrenhofmündung (Le Clerc 1790)',
      // wave-9 review fix: a 12 m strip along the foot of the TF-03 W wall (palace grid u -44.8, v -33 … +33), so the
      // free ground between the guard houses and the wall is one plane (prepare-terrain FORECOURT_*) without the two
      // rubble humps at the wall ends; the drive KB-V2 crosses it on the axis
      geometry: { type: 'LineString', coordinates: [[382187.26, 5466080.06], [382176.37, 5466145.15]] },
      width: 12,
      surface: 'gravel and sand (bare forecourt)',
      confidence: 'low',
      tag: 'D Le Clerc 1790 (research/11 §1.5, §4: "the forecourt is bare gravel / sand"; "courts in sand or gravel"); extent between the terrace wall TF-03 and the guard houses KB-B37 / KB-B38 I; one levelled plane I (generator rule; today\'s humps at the wall ends read as rubble cones); Buntsandstein gravel class N/I (research/11 S15)',
      notes: 'wave 8 (audit: the court mouth sat in hay up to the road); wave-9 review fix: a plane along the wall foot instead of a low-passed pad on the axis.',
    },
    {
      id: 'KB-V2',
      kind: 'path',
      name: 'Auffahrt zum Ehrenhofgitter (Rampe mit Wangenmauern)',
      // wave-9 review fix (47, 26): on the court axis (palace grid v +0.6, centred in the gap between the guard houses)
      // from the TF-03 wall line (u -38.8, the court level) down to the ground W of the guard houses (u -82); a walled
      // ramp: prepare-terrain grades it (DRIVE_*), site/drive.ts draws the flanking walls and access.ts cuts the
      // terrace wall across it
      geometry: { type: 'LineString', coordinates: [[382187.63, 5466114.19], [382145.03, 5466107.06]] },
      width: 8,
      top: 344.8,
      foot: 340.55,
      wall_height: 0.4,
      surface: 'gravel and sand (carriage drive)',
      confidence: 'low',
      tag: 'D main approach from the valley to the court mouth (LP06 29 Hauptzufahrt, research/07 §3.2) and a central gate in the grille (LC 1790, PL); D-> LiDAR 2025: on the court axis the ground falls ≈ 8-9 % from the mouth (≈ 344.0) to the guard houses (≈ 342.1) while beside the axis the terrace edge is a step; N carriage ramps <= 1:10 with walled sides (research/09 §5 ramps; research/02 terraces "ramps or stairs"); grade 1:10 (≈ 9.8 %), width 8 m, walls 0.8 m with a 0.4 m parapet I; a grade below 8 % would need a ≈ 75 m causeway through the guard-house gap and over the TF-10 junction (rejected, I)',
      notes: 'wave-9 review fix: the forecourt ended at a 2.0-2.3 m wall across the axis with no way up to the gate.',
    },
    {
      id: 'KB-F2',
      kind: 'fence',
      name: 'Barrière (Schlagbaum) zwischen den Wachhäusern am Taleingang (PV 1791)',
      // from the N face of KB-B64 (S) to the S face of KB-B63 (N), face midpoints
      geometry: { type: 'LineString', coordinates: [[381497.5, 5465889.27], [381497.1, 5465908.8]] },
      fence_line: { type: 'barriere', height: 1.1, rails: 2, tag: 'D existence PV 1791 legend 1 ("Les deux petites maisons en entrant au parc pour le corps de garde et la barrière"); N Schlagbaum on a pivot post with a counterweight, the rest of the gap closed by rails; beam 7 m, sizes and blue-white bands I (FENCE.barriere, the sentry-box colours)' },
      confidence: 'low',
      tag: 'D existence PV 1791 l. 1 (barrière beside the guard house KB-B63 / KB-B64, LP06 37); position between the two houses I (the road through the gap is not drawn in any located source); form N/I',
      notes: 'KB-I68.',
    },
  ];
}
