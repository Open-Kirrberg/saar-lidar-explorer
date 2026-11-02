/**
 * Catalogue v2 terrain features for the time slice summer 1789: courts (surface + level),
 * terraces with retaining walls, avenues (species, spacing, row distance, 1789 height),
 * parterres, ponds with water levels and the Große Kaskade (re-identified, research/07 C3 / P32).
 * Levels marked "DTM" are replaced by the DTM median in pass 2 of build.ts (sample_dtm.py).
 */
import type { GridFrame } from '../../model/src/frame.ts';
import type { EN, GeoJsonGeometry, RingEN, TerrainFeature } from '../../model/src/spec.ts';
import { rEN, ring, uvRect, type LidarFeature } from './common.ts';

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
    t.tag = 'route D LiDAR; not drawn in LP06/K05 -> baroque date U (research/07 §3.2 note); trees N';
    t.confidence = 'med';
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
      surface: 'grass parterre with gravel walks',
      wall_height: 2.0,
      confidence: 'low',
      tag: 'D LP06 44 "Schloßterrasse" + HMS terrace garden S of the S arm; extent I (24 m deep); level DTM median; wall N',
      notes: 'v2 new: reached through the S-arm Durchfahrt (HMS gate). Depth and parterre pattern U.',
    },
    {
      id: 'TF-09',
      kind: 'parterre',
      name: 'Gartenparterre östlich des Corps de logis',
      geometry: poly(uvRect(g, 46.2, 110.0, -30.0, 30.0)),
      level: 345.9,
      surface: 'grass compartments with gravel walks on the axis (low, no broderie)',
      confidence: 'low',
      tag: 'I: garden door of the CdL on the axis (05 §e) + E avenue TF-11; level I 345.9 = EG floor 346.2 - 2 perron steps; rising ground 345.3-349.8 m D DTM; pattern U',
      notes:
        'v2 new: a simple parterre between the CdL garden front and the E avenue. Not drawn in LP06 (U). Fix round 1: level 345.9 (was the DTM median 347.39, above the EG floor 346.2); the parterre is levelled into the rising ground (cut up to 3.2 m at its E edge, talus I) and reached from the garden door by a 2-step perron.',
    },
    {
      id: 'TF-15',
      kind: 'parterre',
      name: 'Orangerie-Parterre (Kübelpflanzen im Sommer)',
      geometry: poly(uvRect(g, 2.0, 30.0, -178.0, -128.0)),
      level: 340.8,
      surface: 'grass compartments, gravel walks; citrus tubs set out in summer',
      confidence: 'med',
      tag: 'level D LiDAR KB-33; parterre in the U of the Orangerie D-> LP06 7; tubs outside May-October N (time slice summer)',
      notes: 'v2 new: inside TF-06, between the wings KB-B11/B12.',
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
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}
