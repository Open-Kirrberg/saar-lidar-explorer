/**
 * Catalogue v2 building data: edits of the v1 entries (P1-P34 of research/07 §3, the HMS
 * measurements of research/08 §7) and the buildings newly placed from the georeferenced 2006
 * Lageplan (research/07 §2.6 / §3.2, N1-N28). Conflict rule (task brief, research/07 §3):
 *   documented period sources > georeferenced research plan (LP06) > LiDAR positions >
 *   HMS heights/massing > comparables/norms.
 * Footprints: LiDAR where it measures a foundation; LP06 for topology/length and for everything
 * the LiDAR does not show. Heights: HMS (one cornice at 356.0 m) over period norms.
 */
import type { GridFrame } from '../../model/src/frame.ts';
import { dirEN } from '../../model/src/frame.ts';
import { centroid, openRing, type P2 } from '../../model/src/layout/geom.ts';
import { roofSection } from '../../model/src/layout/roof.ts';
import type { Building, BuildingClass, Confidence, EN, Facade, Placement, RingEN, Roof, Storey, StoreyKind } from '../../model/src/spec.ts';
import { minRect, r2, ring, uvRect, type Lp06Building } from './common.ts';

export interface BuildCtx {
  grid: GridFrame;
  lp06: Map<string, Lp06Building>;
  /** Centroid of the Orangerie main range (KB-B10), anchor for its wings. */
  b10c: EN;
}

/** Extend a rectangle along its long axis to `length`, keeping the end nearer to `anchor`. */
export function extendRect(r: RingEN, anchor: EN, length: number): RingEN {
  const m = minRect(r);
  const pts = openRing(m.ring);
  const e0: EN = [pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]];
  const e1: EN = [pts[2][0] - pts[1][0], pts[2][1] - pts[1][1]];
  const long = Math.hypot(...e0) >= Math.hypot(...e1) ? e0 : e1;
  const L = Math.hypot(...long);
  let ax: EN = [long[0] / L, long[1] / L];
  const c = centroid(pts);
  // axis pointing away from the anchor
  if ((c[0] - anchor[0]) * ax[0] + (c[1] - anchor[1]) * ax[1] < 0) ax = [-ax[0], -ax[1]];
  const near: EN = [c[0] - (ax[0] * m.length) / 2, c[1] - (ax[1] * m.length) / 2];
  const nc: EN = [near[0] + (ax[0] * length) / 2, near[1] + (ax[1] * length) / 2];
  const az = (Math.atan2(ax[0], ax[1]) * 180) / Math.PI;
  return axisRect(nc, az, length, m.width);
}

// ---------------------------------------------------------------------------------------------
// Source keys (sources[] entries)
// ---------------------------------------------------------------------------------------------

export const SRC = {
  lidar: 'research/03-lidar-site-analysis.md + lidar_features.geojson (DGM1 SL 2025)',
  lp06: 'research/07-period-sources.md: LP06 = 2006 Lageplan, schloss-carlsberg.de (CC BY-SA 2.0 DE), georeferenced; footprints CC BY-SA-derived',
  lc: 'research/07: Le Clerc 1790 "Vue du Château de Carlsberg" (PD, Commons)',
  pv: 'research/07 App. B: "Pleine vue du Carlsberg" 1791, legend (PD, Commons)',
  pl: 'research/07: porcelain plate "Le Château de Carlsberg" (PD)',
  k05: 'research/07: ruins map 1805 (PD, Commons)',
  hms08: 'research/08-reference-mesh-measurements.md (HMS 2022 reference mesh, numbers only, (c) Matzerath/HMS)',
  syn: 'research/05-synthesis.md',
  grammar: 'research/02-comparable-palaces-design-grammar.md',
  hist: 'research/01-history-and-sources.md',
} as const;

// ---------------------------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------------------------

const st = (name: string, height: number, kind: StoreyKind, tag: string): Storey => ({ name, height, kind, tag });

/** Palace group storeys: one floor stack and one cornice (356.0) for CdL, arms, W wing, kitchen wing. */
export function palaceStoreys(upper: string): Storey[] {
  return [
    st('Sockel / Souterrain (Kellerfenster)', 1.4, 'plinth', 'HMS CdL plinth 344.8-346.2 (research/08 §4); same for the whole palace group I'),
    st('Erdgeschoss', 5.2, 'floor', 'HMS EG windows 347.0-349.9, upper windows from 352.3 -> floors 346.2 / 351.4 (D-> with N sills 0.7-0.9); I'),
    st(upper, 4.6, 'floor', 'HMS one cornice at 356.0 on CdL, arms, W wing, kitchen wing (research/08 §1.2); D enwp continuous cornice'),
  ];
}

export const PALACE_EAVES = 356.0;
/** Mansard break above the eaves [HMS 15.3 m above the court = 4.1 m above the cornice]. */
export const BREAK_ABOVE_EAVES = 4.1;

export function mansard(depth: number, eaves: number, pitchUpper: number, breakAbove: number, tags: string, extra: Partial<Roof> = {}): Roof {
  const break_ratio = Math.round((breakAbove / (depth / 2)) * 10000) / 10000;
  const sec = roofSection({ type: 'mansard', depth, eaves_h: eaves, pitch_lower: 70, pitch_upper: pitchUpper, break_ratio });
  return {
    type: 'mansard',
    pitch_lower: 70,
    pitch_upper: pitchUpper,
    break_ratio,
    eaves_h: r2(eaves),
    ridge_h: r2(sec.ridge_h),
    depth_m: depth,
    hipped_ends: true,
    material: 'slate (rectangular French cover)',
    cover: 'slate',
    dormers: { lower: 'every', upper: 'alternate', head: 'segmental', tag: 'D LC 1790 two dormer rows (research/07 §1.2); HMS one dormer per axis, oculi every 2nd axis' },
    chimneys: { every_axes: 2.5, tag: 'N 02 §2.8; LC tall chimneys' },
    tags,
    ...extra,
  };
}

export function pitched(type: 'hip' | 'gable' | 'pavilion' | 'cone', depth: number, eaves: number, pitch: number, material: string, cover: Roof['cover'], tags: string): Roof {
  const sec = roofSection({ type, depth, eaves_h: eaves, pitch_lower: pitch });
  return { type, pitch_lower: pitch, eaves_h: r2(eaves), ridge_h: r2(sec.ridge_h), depth_m: r2(depth), material, cover, tags };
}

const FARM_FACADE: Facade = {
  material: 'lime-washed render on rubble',
  colour: '#E8DFC8',
  dressings: 'sandstone door and window frames',
  members_colour: '#BDBAB2',
  plinth_colour: '#A65E4A',
  shutters: 'plank or louvred, dark green',
  shutter_type: 'plank',
  lightning_rods: true,
  tags: 'N (period norm); red tile roofs on the service town D PV 1791 (research/07 §1.1)',
};

const PALACE_FACADE_BASE: Facade = {
  material: 'lime render',
  colour: '#ECE8DF',
  dressings: 'grey-painted / yellow-grey Buntsandstein members #BDBAB2-#C8B38C, red Buntsandstein plinth #A65E4A',
  members_colour: '#BDBAB2',
  plinth_colour: '#A65E4A',
  shutters: 'louvred Jalousieläden, dark grey-green #5E665B (HMS dark shutters; hue U)',
  shutter_type: 'louvred',
  shutter_colour: '#5E665B',
  lightning_rods: true,
  tags: 'render colour: D (Orangerie "hell verputzt", schloss-karlsberg.de), D LC 1790 pale render, D-> Koblenz/Wilhelmshöhe; members N/U; shutters dark HMS (hue U, fix round 1: the v2 pale grey #BDBAB2 vanished on the render)',
};

/** Rectangle by centre, axis azimuth (grid), length (along az) and width. */
export function axisRect(c: EN, azDeg: number, length: number, width: number): RingEN {
  const a = dirEN(azDeg);
  const n: EN = [a[1], -a[0]];
  const hl = length / 2;
  const hw = width / 2;
  return ring([
    [c[0] - a[0] * hl - n[0] * hw, c[1] - a[1] * hl - n[1] * hw],
    [c[0] + a[0] * hl - n[0] * hw, c[1] + a[1] * hl - n[1] * hw],
    [c[0] + a[0] * hl + n[0] * hw, c[1] + a[1] * hl + n[1] * hw],
    [c[0] - a[0] * hl + n[0] * hw, c[1] - a[1] * hl + n[1] * hw],
  ]);
}

/** Regular n-gon (closed, CCW) of diameter d. */
export function circleRing(c: EN, d: number, n = 16): RingEN {
  const pts: P2[] = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    pts.push([c[0] + (d / 2) * Math.cos(a), c[1] + (d / 2) * Math.sin(a)]);
  }
  return ring(pts);
}

// ---------------------------------------------------------------------------------------------
// Edits of v1 entries
// ---------------------------------------------------------------------------------------------

type Patch = (b: Building, ctx: BuildCtx) => void;

const addSources = (b: Building, ...s: string[]) => {
  b.sources = [...new Set([...(b.sources ?? []), ...s])];
};

const EDITS: Record<string, Patch> = {
  'KB-B01': (b, { grid }) => {
    b.name_de = 'Corps de logis (Hauptpalais; Kern = Louisenhof-Herrenhaus 1760/61)';
    b.function = 'ducal residence: through vestibule, Prunktreppe (imperial stair), private rooms on the EG, state apartment and festival salon on the Beletage';
    b.footprint = uvRect(grid, 28.2, 46.2, -20.3, 20.6);
    b.confidence = 'med';
    b.placement = 'lidar+hms';
    b.storeys = palaceStoreys('Beletage (Paradeappartement)');
    b.roof = mansard(18.0, PALACE_EAVES, 21, 3.8, 'mansard D LC 1790 + PL (wings and CdL); break 359.8 and side ridge 362.7 HMS (research/08 §4) -> upper pitch 21° D->; slate D-> PV 1791 slate-blue palace roofs', {
      centre: '7-axis centre pavilion with its own higher hipped roof, lantern and spire (D LC 1790, PL); centre ridge 366.2 HMS',
    });
    b.facade = {
      ...PALACE_FACADE_BASE,
      axes_court_west: 15,
      axes_garden_east: 15,
      axis_spacing: 2.65,
      rhythm: '4 + 7 (centre pavilion = Louisenhof core) + 4',
      portal: 'court: central portal with Freitreppe (10 steps); garden: door on the EG axis, 3 portes-fenêtres to a balcony on the Beletage centre',
      axis_tags: 'court 15 = 4+7+4 HMS (research/06, 08; scale-free count); 7-axis centre D LC 1790 + D hib (Louisenhof 7 x 4 axes); garden side mirrored I; spacing 2.65 D-> 40.9 m court width / 15 (LiDAR)',
    };
    b.interior = 'detailed';
    b.court_toward = 'TF-01';
    addSources(b, SRC.lp06, SRC.lc, SRC.pl, SRC.hms08);
    b.notes =
      'v2: block BETWEEN the arm heads (u 28.2-46.2, v -20.3..20.6 = 40.9 x 18 m): LP06 draws a 46 x 19 m block between the wing heads projecting ~7 m E (D->, +1-3 m drawing thickness), HMS measures 44.5 x 18.4 m between the arms (research/08 §4); the length is the LiDAR court width (KB-01, 40.9-41.6 m) because both arms run along its flanks to u 39. Depth 18 m (LiDAR/HMS agree). East half on rising ground: garden door at grade. "42 m staircase" (enwp) read as 42 Pariser Fuss = 13.6 m -> 5-axis stair hall 13.25 m (C8, I).';
    b.alternatives = [
      'v1: 78 x 18 m range across the arm ends (u 28.2-46.2, v -37.3..40.6); the LiDAR KB-04 corner block may belong to it (medium-low confidence for the v2 topology)',
      'whole CdL under one mansard without the raised centre pavilion (en.wikipedia "only the CdL had a mansard")',
      'high hipped roof on the whole block (Louisenhof "probably Walmdach", hib)',
    ];
  },
  'KB-B02': (b, { grid }) => {
    b.name_de = 'Südflügel – Flügel der Herzogin';
    b.function = "Duchess's apartment on the OG (D LP06 legend 3); EG: dining rooms, buffet, silver chamber (HMS caption, now read as the EG use I); vaulted cellars (D LiDAR); W head pavilion with portico and Freitreppe (D LC 1790)";
    b.footprint = uvRect(grid, -36.0, 39.0, -37.3, -20.3);
    b.storeys = palaceStoreys('Obergeschoss (Appartement der Herzogin)');
    b.roof = mansard(17.0, PALACE_EAVES, 28, BREAK_ABOVE_EAVES, 'mansard with two dormer rows D LC 1790 + PL; pitches 70/28 and break +4.1 HMS; ridge 363.8 reproduces HMS 363.7 ±1.0; Mansardwalmdach on the W head pavilion D LC');
    b.facade = {
      ...PALACE_FACADE_BASE,
      axes: 23,
      axis_spacing: 3.15,
      portal: 'central round-arched Durchfahrt (2 axes) to the south terrace garden (HMS gate u -1.6..4.9); W head pavilion: 4-column portico with balcony over a broad Freitreppe (~11 steps) (D LC 1790)',
      axis_tags: 'spacing 3.15 HMS (21 axes over 66 m, scale-free count); 75 m arm -> 23 axes on the outer face, 20 on the open court face (grid aligned) I; W head 4 axes D LC',
    };
    b.interior = 'detailed';
    b.confidence = 'high';
    b.placement = 'lidar+hms';
    addSources(b, SRC.lp06, SRC.lc, SRC.pl, SRC.hms08);
    b.notes =
      'v2: arm runs along the CdL flank to u 39 (75 x 17 m): LP06 (74 m drawn) + HMS (73 m) both show the wing heads flanking the CdL (P1b). Depth 17 m LiDAR = HMS 17.3. Sunken rooms ~2 m below the court = vaulted cellars (LiDAR). South face overlooks the terrace garden (LP06 44 "Schloßterrasse", HMS). Ownership: LP06 legend names the S wing the Duchess\'s (the HMS caption reads "herzoglicher Wohnflügel"); LP06 wins (research plan > HMS).';
    b.alternatives = [
      'HMS 2022: "herzoglicher Wohnflügel mit Speisesälen und Silberkammer" (Duke) - LP06 legend 3 says Duchess',
      'E end at u 28.2 (64 m, the LiDAR KB-02 length) instead of along the CdL flank',
      'roof gable 45° (en.wikipedia after Schneider 1988) - contradicted by LC 1790 and PL (low)',
      'v1 alternative "= Kavaliersbau" superseded: LP06 19 places the Cavaliershaus on the north row (KB-B49)',
    ];
  },
  'KB-B03': (b, { grid }) => {
    b.name_de = 'Nordflügel – Flügel des Herzogs';
    b.function = "Duke's apartment on the OG (D LP06 legend 2); EG guard, court offices and Durchfahrt to the Küchenhof (HMS)";
    b.footprint = uvRect(grid, -33.9, 39.0, 20.6, 40.6);
    b.storeys = palaceStoreys('Obergeschoss (Appartement des Herzogs)');
    b.roof = mansard(20.0, PALACE_EAVES, 24, BREAK_ABOVE_EAVES, 'mansard D LC 1790 + PL; break +4.1 HMS; upper pitch 24° (HMS range 24-35) so the 20 m LiDAR depth gives the HMS twin-arm ridge 363.8-363.9 (D->)');
    b.facade = {
      ...PALACE_FACADE_BASE,
      axes: 19,
      axis_spacing: 3.15,
      portal: 'Durchfahrt (2 axes) to the Küchenhof (HMS gate u -6.1..-0.4); columned porch in the centre of the court face (D LC 1790, low resolution)',
      axis_tags: 'spacing 3.15 HMS (N arm 20 ± 1 axes); 19 axes on the open court face u -33.9..28.2 I; Küchenhof face 13 axes between the Sammlungsflügel and the Küchenbau I',
    };
    b.interior = 'detailed';
    b.placement = 'lidar+hms';
    addSources(b, SRC.lp06, SRC.lc, SRC.pl, SRC.hms08);
    b.notes =
      'v2: 72.9 x 20 m, along the CdL flank to u 39 (LP06 74 m drawn, HMS 74 m, LiDAR KB-03 band 78 m with KB-04 at its E end). Depth: LiDAR band 20 m kept (HMS 17.5 as alternative) -> triple pile with a central corridor. LP06 legend 2: "Flügel des Herzogs". en.wikipedia "1779-1794" = typo (C5).';
    b.alternatives = ['depth 17.5 m (HMS, twin of the S arm) inside the 20 m LiDAR band', 'E end at u 28.2 (62 m)', 'HMS: Duke in the S wing'];
  },
  'KB-B04': (b, { grid }) => {
    b.name_de = 'Westflügel / Sammlungsflügel (Bibliothek, Naturalienkabinett, Waffensammlung)';
    b.function = 'collections: armoury and gunsmith on the EG, library, natural-history and physics cabinets on the OG (D Weber ToC, BuS 2012 "collection wing to the north"; HMS caption); W carriage gate with sentry boxes into the Küchenhof (HMS)';
    b.footprint = uvRect(grid, -33.9, -20.9, 40.6, 98.0);
    b.storeys = palaceStoreys('Obergeschoss (Sammlungen)');
    b.roof = mansard(13.0, PALACE_EAVES, 28, BREAK_ABOVE_EAVES, 'mansard HMS + PV slate-blue palace roofs + continuous cornice D; not depicted in LC/PL (behind the N wing) -> med; HMS ridge 364.0 needs its 17 m depth, the LiDAR 13 m gives 362.8 (HMS S part ≈362)');
    b.facade = {
      ...PALACE_FACADE_BASE,
      axes: 19,
      axis_spacing: 3.0,
      portal: 'carriage gate (Durchfahrt, 2 axes) near the S end on the W (Paradestraße) side, flanked by sentry boxes (HMS v 45.5-48.5)',
      axis_tags: '19 axes HMS (W-face dormers at 3.29, scale-free count) compressed to 3.0 m on the 57.4 m LiDAR length I',
    };
    b.interior = 'detailed';
    b.placement = 'lidar+hms';
    addSources(b, SRC.lp06, SRC.hms08);
    b.notes =
      'LiDAR KB-05 footprint kept (snapped to the palace grid, joined to the N arm). LP06 4 "Westflügel" lies on it (±6 m). HMS 62 x 17 m conflicts with KB-05 50 x 13 (research/08 §6) -> alternative. Its N end meets the W end of the gallery (KB-B06).';
    b.alternatives = ['HMS 2022: 62 x 17 m reaching v ≈103 with a stepped ridge 364.0 / 362', 'gallery on its upper floor instead of a separate range'];
  },
  'KB-B05': (b, { grid }) => {
    b.name_de = 'Ostflügel / Küchenbau (Küchenflügel)';
    b.function = 'court kitchen (Hofküche, 1779/80-84) with confectionery, bakery, scullery and serving room linked to the N arm; cooks\' lodgings on the OG';
    b.footprint = uvRect(grid, 20.8, 33.9, 40.6, 86.5);
    b.storeys = palaceStoreys('Obergeschoss (Wohnungen der Küchenbediensteten)');
    b.roof = mansard(13.1, PALACE_EAVES, 28, BREAK_ABOVE_EAVES, 'mansard HMS (72/28); not depicted in LC/PL; cornice 356.0 HMS; HMS top 361.7 vs 362.8 here (within 1σ)', {
      chimneys: { every_axes: 2, section: [1.2, 1.6], above_roof: 2.5, tag: 'N kitchen stacks 02 §2.8 (CHIMNEY.kitchenSection)' },
    });
    b.facade = {
      ...PALACE_FACADE_BASE,
      axes: 14,
      axis_spacing: 3.2,
      portal: 'doors to the Küchenhof',
      axis_tags: 'spacing 3.2 HMS (12 axes on its 40.5 m) -> 14 axes on 45.9 m I',
    };
    b.interior = 'detailed';
    b.placement = 'lidar+hms';
    addSources(b, SRC.lp06, SRC.hms08);
    b.notes =
      'v2 (P9): extended S from the KB-06 rectangle (v 58.4-86.5, the 1779/80 kitchen block = D LiDAR closed rectangle) to the N arm (v 40.6) - LP06 5 runs to the N wing (52 x 18 drawn), HMS 40.5 m, LiDAR rubble S of KB-06 (img/34). The KB-06 S wall is kept as an internal cross wall. E face stands ~1 m in front of the KB-07 scarp (upper plateau 347.6): EG windows there are culled by the terrain test.';
    b.alternatives = ['28 x 13 m detached block on KB-06 only (v1)', 'HMS 2022: 40.5 m (v 46.3-86.4), leaving a 5.7 m gap to the N arm'];
  },
  'KB-B06': (b, { grid }) => {
    b.name_de = 'Galerieflügel (Bildergalerie)';
    b.function = 'picture gallery (collection -> Alte Pinakothek): one long hall lit from the S, closed N hanging wall';
    b.footprint = uvRect(grid, -20.9, 62.0, 94.0, 102.0);
    b.base_h = 347.6;
    b.base_h_note = 'upper plateau level (DTM under the LP06 line 347.6, research/07 P10); the S part stands over the Küchenhof on a substructure (plinth extended to 344.8)';
    b.storeys = [
      st('Sockel / Unterbau', 1.2, 'plinth', 'I: gallery floor 348.8 = half landing of the N stair of the Sammlungsflügel (346.2 + 5.2/2)'),
      st('Galeriegeschoss', 6.0, 'floor', 'N side-lit gallery 6-8 m high (02); HMS reads a lower range (eaves 349.1, low confidence)'),
    ];
    b.roof = pitched('hip', 8.0, 354.8, 30, 'slate', 'slate', 'low hipped roof I/N; slate D-> PV palace group');
    b.facade = {
      ...PALACE_FACADE_BASE,
      axes: 21,
      axis_spacing: 3.9,
      windows: 'tall windows on the court (south) side only; north wall closed (hanging wall)',
      portal: 'door from the Sammlungsflügel stair (W end), door to the end pavilion (E end)',
      axis_tags: 'axes I/N (3.9 m)',
    };
    b.interior = 'detailed';
    b.confidence = 'low';
    b.placement = 'map+lidar';
    b.lidar_ids = ['KB-07 (scarp under the S half)'];
    addSources(b, SRC.lp06, SRC.hms08);
    b.notes =
      'v2 (P10): LP06 6 draws a thin range (6-8 m) from the Westflügel E past the Küchenflügel to a square end pavilion, ~95-105 m in all; here 82.9 m + 10 m pavilion (KB-B07), 8 m wide on the KB-07 scarp line (v 94-102). Level 344.8 vs 347.6 was open (P10); the upper level is taken because the E half lies entirely on the plateau.';
    b.alternatives = [
      'v1: 62 x 11.5 m inside the Küchenhof at court level (u -20.9..41, v 87-98.5)',
      'HMS 2022: ≈40 m low range (eaves ≈349.1) ending in a rotunda',
      'gallery = upper floor of the Sammlungsflügel',
    ];
  },
  'KB-B07': (b, { grid }) => {
    b.name_de = 'Pavillon am Ostende der Galerie';
    b.function = 'square end pavilion of the picture gallery (LP06 6)';
    b.built = '1788 (with the gallery) U';
    b.footprint = uvRect(grid, 62.0, 72.0, 92.0, 104.0);
    b.base_h = 347.6;
    b.storeys = [st('Sockel', 1.2, 'plinth', 'I = gallery'), st('Saal', 6.6, 'floor', 'N')];
    b.roof = pitched('pavilion', 10.0, 355.4, 40, 'slate', 'slate', 'pavilion roof I; LP06 square plan');
    b.facade = { ...PALACE_FACADE_BASE, axis_spacing: 3.6, portal: 'door from the gallery', axis_tags: 'N' };
    b.confidence = 'low';
    b.placement = 'map';
    b.priority = 5;
    addSources(b, SRC.lp06);
    b.notes = 'v2 (P11): LP06 draws a ≈10 x 12 m rectangular pavilion at the E end of the gallery (≈382284/5466230); placed 9 m further W because the LP06 gallery is drawn ~10 % long. The HMS rotunda is kept as an alternative.';
    b.alternatives = ['HMS 2022: domed rotunda D ≈12 m ("Bildergalerie mit anschließender Rotunde")'];
  },
  'KB-B10': (b) => {
    b.name_de = 'Orangerie, Hauptflügel (aus der Schweizerei 1780)';
    b.function = 'orangery (citrus overwintering) and summer festival hall (Pfeilersaal); courtiers\' lodgings on the upper tier and the Sommellerie (cellarage) in the high basement (D PV 1791 b.)';
    b.storeys = [
      st('hohes Kellergeschoss (Sommellerie; nur im W frei)', 5.5, 'basement', 'D high basement (skb) = D LiDAR 5.3-5.6 m drop KB-30'),
      st('Saalgeschoss (Pfeilersaal, bodentiefe Fenster)', 6.6, 'floor', 'D floor-length windows (skb); HMS lower window tier 341.5-345.0'),
      st('Obergeschoss (Logis der Kavaliere)', 4.6, 'floor', 'HMS second window tier 347.5-350.3 and eaves 16.1 above the W foot / 352.0 abs. (S09); D PV b. "demeure des Courtisans"'),
    ];
    b.roof = {
      ...pitched('hip', 10.0, 352.0, 49, 'slate (U; HMS dark roof)', 'slate', 'hip ≈50° HMS, ridge 357.8 HMS (S09 absolute)'),
      raised: [
        {
          side: 'garden',
          first_axis: 11,
          axis_count: 3,
          extra_h: 0,
          type: 'hip',
          turret: { kind: 'dachreiter', height: 3.7, tag: 'HMS octagonal Dachreiter, top ≈361.5' },
          tag: 'HMS centre risalit with Dachreiter',
        },
      ],
    };
    b.facade = {
      ...PALACE_FACADE_BASE,
      dressings: 'red Buntsandstein (ruin masonry is reddish sandstone, Commons photos)',
      members_colour: '#A65E4A',
      axes: 25,
      axis_spacing: 3.35,
      windows: 'floor-length (portes-fenêtres) on the parterre (E) side; two window tiers above the high basement on the W',
      portal: '3-axis pedimented centre risalit on both fronts (HMS W front; I parterre side); basement door on the W bench',
      axis_tags: '25 ± 1 axes HMS at 3.4 -> 3.35 on the 84 m LiDAR length',
      tags: '"hell verputzt" D (skb); three wings D; axes HMS',
    };
    b.interior = 'detailed';
    addSources(b, SRC.hms08, SRC.pv);
    b.notes =
      'Standing ruin. base_h = lower bench 335.3 (W); hall floor = parterre 340.8. v2: HMS shows two window tiers above the basement and eaves 16 m above the W foot (research/08 §4) -> Saalgeschoss + upper tier; the central Pfeilersaal is double height, the end bays carry courtiers\' rooms (PV 1791 b.). Plan 84 x 10 m (LiDAR = HMS 85.5 x 10).';
    b.alternatives = ['v1: one 7.0 m Saal, eaves 347.8, 21 axes at 3.9', 'one double-height Saal over the full length (11.2 m) - HMS [U]'];
  },
  'KB-B11': (b, ctx) => {
    b.name_de = 'Orangerie, Nordflügel (Komödienhaus/Theatersaal 1783?)';
    b.footprint = extendRect(b.footprint!, ctx.b10c, 39.0);
    b.roof = pitched('hip', 12.0, 348.4, 40, 'slate', 'slate', 'N');
    b.facade = { ...b.facade, axes: 9, axis_spacing: 3.9 };
    b.placement = 'map+lidar';
    addSources(b, SRC.lp06, SRC.hms08);
    b.notes = 'v2 (P12): LP06 7 N arm ≈45 m from the W front; HMS projects 35 ± 3 m beyond the main wing, 13 m deep (research/08 §4) -> 39 m long (v1 rectangle extended E), v1 depth 12 m kept (HMS 13). Theatre location in the complex U.';
  },
  'KB-B12': (b, ctx) => {
    b.name_de = 'Orangerie, Südflügel';
    b.footprint = extendRect(b.footprint!, ctx.b10c, 58.5);
    b.roof = pitched('hip', 12.0, 348.4, 40, 'slate', 'slate', 'N');
    b.facade = { ...b.facade, axes: 15, axis_spacing: 3.9 };
    b.placement = 'map+lidar';
    addSources(b, SRC.lp06);
    b.notes = 'v2 (P13): LP06 7 S arm runs from the main range E to the V-shaped scarp corner of KB-33 (≈382315/5465940) -> v1 rectangle extended E to 58.5 x 12 m (LP06 70-75 m drawn incl. the main range).';
  },
  'KB-B13': (b) => {
    b.name_de = 'Rotunde / Rundbau an der Orangerie (1785)';
    b.priority = 6;
    addSources(b, SRC.lp06);
    b.notes =
      (b.notes ?? '') +
      ' v2 (P14): NOT drawn in LP06 (no rotunda in the Orangerie court); K05 too coarse. Possibly a temporary festival building for the 1785 wedding [I]. Low; render as optional.';
  },
  'KB-B14': (b) => {
    b.name_de = 'Orangerie-Stützmauer (Terrassenmauer West)';
  },
  'KB-B20': (b) => {
    b.name_de = 'Marstall, Westbau';
    b.footprint = axisRect([382190.0, 5466462.5], 1.2, 165, 12);
    b.facade = { ...b.facade, axes: 45, axis_spacing: 3.6 };
    b.confidence = 'med';
    b.placement = 'map+lidar';
    b.lidar_ids = ['KB-20 (W edge)'];
    addSources(b, SRC.lp06, SRC.k05, SRC.pv);
    b.notes =
      'v2 (P16): W range of the two-court Marstall block (LP06 12, north fit ±7 m; K05 1805 two-court block on KB-20; PV h. "Les écuries avec leurs apartemens des palfreniers et manège") -> N 5466380-5466545 (165 m). LP06 draws 3 projections on its W face (risalits, positions U). "Stable for 1000 horses" = legend (C11).';
  },
  'KB-B21': (b) => {
    b.name_de = 'Marstall, Ostbau (Nordteil)';
    b.footprint = axisRect([382242.0, 5466511.0], 1.2, 66, 12);
    b.facade = { ...b.facade, axes: 18, axis_spacing: 3.6 };
    b.priority = 4;
    b.placement = 'map';
    b.lidar_ids = [];
    addSources(b, SRC.lp06, SRC.k05);
    b.notes = 'v2 (P17): LP06 12 E range lies ~30 m W of the v1 position, inside the terrace (not on the E scarp KB-21); its middle is the Reithalle (KB-B22), its S part is KB-B31.';
    b.alternatives = ['v1: mirror of the W range on the E scarp (E ≈382266)'];
  },
  'KB-B22': (b) => {
    b.name_de = 'Reithalle (Reithaus)';
    b.footprint = axisRect([382245.0, 5466449.0], 1.2, 54, 20);
    b.facade = { ...b.facade, axes: 12, axis_spacing: 4.2 };
    b.roof = pitched('hip', 20.0, 354.1, 38, 'red Biberschwanz tile', 'tile', 'N; red tile D PV');
    b.placement = 'map';
    addSources(b, SRC.lp06, SRC.pv);
    b.notes = 'v2 (P18): LP06 13 "Reithalle" in the middle of the E range (57 x 26 m drawn, north fit ±7 m) -> 54 x 20 m (Vienna 55 x 18 upper bound D). PV h. "manège aux chevaux". Commons photo of the Marstall ramp filed as "Reithalle".';
  },
  'KB-B23': (b, { lp06 }) => {
    b.name_de = 'Zwinger (Hundezwinger?)';
    b.cls = 'GARD';
    b.function = 'walled yard with a central house (LP06 15 "Zwinger", K05 square); kennel function I (hunting dogs; the Jägerhaus is next to it)';
    const yard = minRect(lp06.get('15')!.rings[1]);
    b.footprint = axisRect([382216.5, 5466571.3], 91.2, Math.min(67, yard.length), Math.min(45, yard.width));
    b.storeys = [st('Hofmauer', 2.5, 'wall', 'D-> Tschifflik wall 2.5 m; N')];
    b.roof = { type: 'none', cover: 'none' };
    b.facade = { material: 'lime-washed render on rubble, sandstone coping', colour: '#E8DFC8', content: 'walled yard; central Zwingerhaus = KB-B35' };
    b.confidence = 'low';
    b.placement = 'map';
    addSources(b, SRC.lp06, SRC.k05);
    b.notes = 'v2 (P20): LP06 15 walled yard ≈68 x 48 m drawn at 382215/5466572 (K05 shows the square too); trimmed to 67 x 45 m so it clears the Jägerhaus. "Zwinger 1780-83" ambiguity (C6) stays: kennel I.';
  },
  'KB-B24': (b, { lp06 }) => {
    b.name_de = 'Jägerhaus, später Kaserne der Jäger und Scharfschützen';
    b.footprint = minRect(lp06.get('16')!.rings[0]).ring;
    b.facade = { ...b.facade, axes: 17, axis_spacing: 3.6 };
    b.placement = 'map';
    addSources(b, SRC.lp06, SRC.pv);
    b.notes = 'v2 (P21): LP06 16 (66 x 14 m, north fit ±7 m) on the W side of the road; PV i. "La maison des Veneurs". The LiDAR platform KB-52 lies ~12 m further E (1836-41 Forsthaus marks) -> alternative.';
    b.alternatives = ['v1: 100 x 14 m on the KB-52 platform (E 382196-382210)'];
  },
  'KB-B25': (b, { lp06 }) => {
    b.name_de = 'Lazarett';
    b.footprint = minRect(lp06.get('21')!.rings[0]).ring;
    b.facade = { ...b.facade, axes: 8, axis_spacing: 3.6 };
    b.placement = 'map';
    addSources(b, SRC.lp06, SRC.pv);
    b.notes = 'v2 (P22): LP06 21 "Lazarett", 32 x 10 m E-W at 382228/5466800 (moved 65 m N of v1); PV o. "L\'hôpital".';
  },
  'KB-B26': (b) => {
    b.name_de = 'Brauerei und Wirtshaus';
    b.function = 'brewery (1778-82) and inn: PV q. "Grand Cabaret à la bière", l. "L\'hôtellerie avec ses écuries" (absorbs v1 UP-03 Wirtshaus)';
    b.footprint = axisRect([382251.1, 5466777.6], 90.8, 31.0, 9.0);
    b.facade = { ...b.facade, axes: 8, axis_spacing: 3.6 };
    b.placement = 'map';
    addSources(b, SRC.lp06, SRC.pv);
    b.notes = 'v2 (P23): LP06 22 L-shape 32 x 23 m at 382247/5466774 -> this E-W main range + W wing KB-B36.';
  },
  'KB-B27': (b) => {
    b.name_de = 'Holländische Gärtnerei (Hofgärtnerei): ummauerter Garten mit Treibhäusern';
    addSources(b, SRC.lp06, SRC.k05, SRC.pv);
    b.notes = (b.notes ?? '') + ' v2 (P24): LP06 11 "Holländische Gärtnerei" covers KB-23 exactly (+ a part W of the road); K05 hatched garden parcels; three small buildings inside = KB-B54..56. PV g. "La serre chaude ... avec son logement".';
  },
  'KB-B28': (b) => {
    b.name_de = 'Eiskeller';
  },
  'KB-B29': (b) => {
    b.name_de = 'Baumagazin (heute Karlsberger Hof)';
    const pts = openRing(b.footprint!);
    const mr = minRect(b.footprint!);
    const rp = openRing(mr.ring);
    // long axis direction (towards N) of today's building
    const e0 = [rp[1][0] - rp[0][0], rp[1][1] - rp[0][1]];
    const e1 = [rp[2][0] - rp[1][0], rp[2][1] - rp[1][1]];
    const long = Math.hypot(e0[0], e0[1]) >= Math.hypot(e1[0], e1[1]) ? e0 : e1;
    const L = Math.hypot(long[0], long[1]);
    let ax: EN = [long[0] / L, long[1] / L];
    if (ax[1] < 0) ax = [-ax[0], -ax[1]];
    const c = centroid(pts);
    const az = (Math.atan2(ax[0], ax[1]) * 180) / Math.PI;
    const c2: EN = [c[0] + ax[0] * 10, c[1] + ax[1] * 10];
    b.footprint = axisRect(c2, az, 85, mr.width);
    b.facade = { ...b.facade, axes: 24, axis_spacing: 3.4 };
    addSources(b, SRC.lp06, SRC.pv);
    b.notes =
      'Only surviving building (LoD2 40 x 11 m today). v2 (P25): LP06 36 draws the 1789 magazine ≈97 x 18 m (global fit ±15 m), PV z. "Le grand magasin avec ses logemens", dewp "longer, lower, other roof" [D] -> 85 m along today\'s axis, today\'s part = S/central section (I). Width kept from the LoD2 building.';
    b.alternatives = ["today's 40 x 11 m LoD2 footprint (DESLT9866A103F47 + A104DD3)"];
  },
  'KB-B30': (b, { lp06 }) => {
    b.name_de = 'Carlsberger Hof (Meierei), Hauptbau';
    b.cls = 'FARM';
    b.function = 'farm of the residence (PV 2. "La cense avec ses apartemens" I): one of four ranges around a court (LP06 38)';
    const rings = lp06.get('38')!.rings.map((r) => minRect(r));
    rings.sort((x, y) => y.length * y.width - x.length * x.width);
    b.footprint = rings[0].ring;
    b.storeys = [st('Sockel', 0.4, 'plinth', 'N'), st('Erdgeschoss', 3.4, 'floor', 'N'), st('Obergeschoss', 3.0, 'floor', 'N')];
    b.roof = pitched('gable', r2(rings[0].width), (b.base_h ?? 259.16) + 6.8, 48, 'red Biberschwanz tile', 'tile', 'N; red tile D PV');
    b.facade = { ...FARM_FACADE, axis_spacing: 3.4 };
    b.placement = 'map';
    b.priority = 6;
    addSources(b, SRC.lp06, SRC.pv);
    b.notes = 'v2 (P26): the v1 envelope (KB-60) is replaced by the four LP06 38 ranges around a court ≈105 x 49 m (global fit ±15 m): this one + KB-B30b..d.';
    b.alternatives = ['v1: envelope of today\'s building group (KB-60)'];
  },
  'KL-B40': (b) => {
    b.name_de = 'Amphitheater (Rundbau mit 19 halbrunden Käfigen und Loge, „Bärenzwinger“)';
    addSources(b, SRC.lp06);
    b.notes = (b.notes ?? '') + ' v2 (P27): LP06 53 names the round moated KL-01 "Amphitheater" (D 45 m drawn); v1 UP-07 Amphitheater (garden theatre 1782) merged here [I].';
  },
  'KL-B41': (b) => {
    b.name_de = 'Pavillon auf der Insel im Amphitheater';
  },
  'KL-B42': (b) => {
    b.name_de = 'sog. Tschifflik-Pavillon (Ruine „Tschifflik“/„Kapelle“)';
    b.function = 'the ruin traditionally called "Tschifflik" (LP06 65 "sog. Tschifflik Pavillon"); the real 1779-80 Turkish pavilion stood on the terrace opposite the cascade (KL-B46)';
    addSources(b, SRC.lp06);
    b.notes = 'v2 (P29): LP06 65 = this ruin ("so-called"); LP06 61 places the Tschifflik on the KL-03 terrace axis, matching the 1950s note "on a terrace opposite the cascade" (05 a.5).';
  },
  'KL-B43': (b) => {
    b.name_de = 'Menagerie (Herzogsterrassen mit eisernen Bären-Kästen)';
    addSources(b, SRC.lp06);
    b.notes = (b.notes ?? '') + ' v2 (P28): LP06 54 names this terraced parallelogram "Menagerie"; its 5 cross-strips at the S end = cage cells.';
  },
  'KL-B44': (b) => {
    b.name_de = 'Point de Vue';
    b.function = 'viewpoint pavilion (LP06 55)';
    addSources(b, SRC.lp06);
    b.notes = 'v2 (P30): LP06 55 "Point de Vue" (11 x 11 m drawn, 26 m from this LiDAR ring mound KL-12; the LiDAR position is kept). v1 "Eremitage (?)" was an OSM name only.';
  },
  'KL-B45': (b) => {
    b.name_de = 'Altertum (künstliche Ruine mit Muschelnische)';
    addSources(b, SRC.lp06);
    b.notes = (b.notes ?? '') + ' v2 (P31): LP06 56 "Altertum" (sham ruin, arc).';
  },
};

/** v1 unplaced entries that LP06 places or that are merged into other entries. */
export const REMOVED_V1: Record<string, string> = {
  'UP-01': 'KB-B49 Cavaliershaus (LP06 19)',
  'UP-02': 'KB-B43 Remisen (LP06 14)',
  'UP-03': 'KB-B26 Brauerei und Wirtshaus (LP06 22; PV l./q.)',
  'UP-04': 'KB-B41 Taubenhaus (LP06 8; PV c.)',
  'UP-07': 'KL-B40 Amphitheater (LP06 53) [I]',
  'UP-14': 'KB-B85 Fasanerie (LP06 51; PV 7.)',
  'UP-15': 'KB-B84 Carlsluster Torhaus (LP06 50)',
  'UP-16': 'KL-B48 Treillagenpavillon (LP06 63)',
  'UP-17': 'KB-B80 Hirschwürzloch (LP06 46)',
};

const UNPLACED_NOTES: Record<string, [string, string]> = {
  'UP-05': ['Bienenhaus', 'not placed by LP06/K05/PV (research/07 §2.6)'],
  'UP-06': ['Ananashaus / Großes Treib- und Gewächshaus', 'candidates: the three small buildings in the Holländische Gärtnerei (KB-B54..56) or the Gärtnereien LP06 34/45/47 (KB-B76..78) [I]'],
  'UP-08': ['Chinoiserie (Pavillon und chinesischer Tempel)', 'candidates: LP06 Pavillons 31/35/52 (KB-B81..83) [U]'],
  'UP-09': ['Lusthaus des Prinzen', 'candidates: LP06 Pavillons 31/35/52 (KB-B81..83) [U]'],
  'UP-10': ['Lustgarten der Herzogin', 'LP06 49 "Pavillon im Bereich des Herzogsgartens" has a label but no drawn building [U]'],
  'UP-11': ['Schlösschen Monbijou', 'candidates: LP06 Pavillons 31/35/52 [U]'],
  'UP-12': ['Kirchturm aus der Karlsbergzeit', 'not placed by any source here'],
  'UP-13': ['Ökonomiegebäude / „Le Petit Hameau“ / Fasanerie der Herzogin', 'candidate: Carlsdorf (Sanddorf) LP06 42 = PV 5. "le petit hameau hors du parc" (KB-B68..72) [I]'],
  'UP-18': ['Kapelle, Ballhaus, Apotheke', 'the Wache is now placed (Wachhäuser KB-B37/38 = PV t. "Grand corps de garde devant le Château"); chapel, ball house and pharmacy are still unplaced'],
};

export function applyEdits(buildings: Building[], ctx: BuildCtx): Building[] {
  const out: Building[] = [];
  for (const b of buildings) {
    if (REMOVED_V1[b.id]) continue;
    const p = EDITS[b.id];
    if (p) p(b, ctx);
    const u = UNPLACED_NOTES[b.id];
    if (u) {
      b.name_de = u[0];
      b.notes = `Documented, no position evidence. v2: ${u[1]}.`;
      b.roof = { type: 'none', cover: 'none' };
    }
    if (b.court_toward === undefined) delete b.court_toward;
    out.push(b);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// New buildings (research/07 §3.2 N1-N28, §3.1 P17/P19/P20/P23/P26)
// ---------------------------------------------------------------------------------------------

type Template = 'svc2' | 'svc1' | 'farm' | 'pav' | 'guard' | 'glass' | 'stable' | 'yardhouse' | 'temple';

interface NewSpec {
  id: string;
  name_de: string;
  function: string;
  built?: string;
  /** LP06 plan number + ring index, or explicit ring. */
  lp06?: [string, number];
  footprint?: (ctx: BuildCtx) => RingEN;
  cls: BuildingClass;
  template: Template;
  confidence: Confidence;
  placement: Placement;
  priority: number;
  /** DTM median fallback (research/07 §2.6) until sample_dtm.py has run. */
  dtmHint: number;
  /** Fixed base level instead of the DTM median. */
  base?: number;
  notes: string;
  sources: string[];
  axes?: number;
  court_toward?: string;
  alternatives?: string[];
}

function storeysFor(t: Template): Storey[] {
  switch (t) {
    case 'svc2':
      return [st('Sockel', 0.4, 'plinth', 'N'), st('Erdgeschoss', 3.6, 'floor', 'N'), st('Obergeschoss', 3.4, 'floor', 'N; two-storey service buildings D PV 1791')];
    case 'svc1':
    case 'yardhouse':
      return [st('Sockel', 0.3, 'plinth', 'N'), st('Erdgeschoss', 3.6, 'floor', 'N')];
    case 'farm':
      return [st('Sockel', 0.3, 'plinth', 'N'), st('Erdgeschoss', 3.4, 'floor', 'N'), st('Kniestock / Heuboden', 1.2, 'kneewall', 'N')];
    case 'stable':
      return [st('Sockel', 0.3, 'plinth', 'N'), st('Stallgeschoss', 4.5, 'floor', 'N'), st('Heuboden / Kniestock', 1.2, 'kneewall', 'N')];
    case 'pav':
    case 'temple':
      return [st('Sockel', 0.5, 'plinth', 'N'), st('Saal', 4.5, 'floor', 'N')];
    case 'guard':
      return [st('Sockel', 0.4, 'plinth', 'N'), st('Wachstube', 3.8, 'floor', 'N')];
    case 'glass':
      return [st('Sockel', 0.3, 'plinth', 'N'), st('Glashaus', 3.5, 'floor', 'N')];
  }
}

function roofFor(t: Template, depth: number, eaves: number): Roof {
  const tile = 'red Biberschwanz tile';
  switch (t) {
    case 'svc2':
      return pitched('hip', depth, eaves, 45, tile, 'tile', 'N; red tile D PV 1791');
    case 'stable': {
      const r = mansard(depth, eaves, 30, 0.4 * (depth / 2), 'N; red tile D PV 1791 (service town)');
      return { ...r, material: tile, cover: 'tile', dormers: { lower: 'alternate', upper: 'none', tag: 'N' }, chimneys: undefined };
    }
    case 'svc1':
    case 'farm':
    case 'yardhouse':
      return pitched('gable', depth, eaves, 48, tile, 'tile', 'N; red tile D PV 1791');
    case 'pav':
      return pitched('pavilion', depth, eaves, 35, 'slate (U)', 'slate', 'N; PV pyramid-roofed pavilions');
    case 'temple':
      return pitched('pavilion', depth, eaves, 25, 'lead (U)', 'lead', 'U (temple form N)');
    case 'guard':
      return pitched('hip', depth, eaves, 40, 'slate', 'slate', 'hip roof D LC 1790 (guard pavilions at the court mouth); slate D-> PV palace group');
    case 'glass':
      return pitched('hip', depth, eaves, 30, 'tile ridge, glazed south slope (I)', 'tile', 'I glasshouse; form N');
  }
}

const NEW: NewSpec[] = [
  // ---- Marstall parts (P17, P19) and Zwinger house (P20), Brauerei W wing (P23)
  { id: 'KB-B31', name_de: 'Marstall, Ostbau (Südteil)', function: 'stables / grooms\' lodgings (PV h.)', built: '1778-85', footprint: () => axisRect([382240.5, 5466397.5], 1.2, 47, 12), cls: 'STABLE', template: 'stable', confidence: 'low', placement: 'map', priority: 5, dtmHint: 344.1, base: 344.1, notes: 'P17: S part of the LP06 12 E range (S of the Reithalle), north fit ±7 m.', sources: [SRC.lp06, SRC.k05], axes: 13 },
  { id: 'KB-B32', name_de: 'Marstall, Nordflügel', function: 'N closing range of the Marstall courts', built: '1778-85', footprint: () => axisRect([382217.1, 5466539.0], 91.2, 39.0, 12), cls: 'STABLE', template: 'stable', confidence: 'low', placement: 'map', priority: 5, dtmHint: 344.1, base: 344.1, notes: 'P19: LP06 12 N closing range between the W and E ranges.', sources: [SRC.lp06, SRC.k05], axes: 10 },
  { id: 'KB-B33', name_de: 'Marstall, Querbau (Mitte)', function: 'E-W cross range dividing the Marstall courts; gate passage in the middle (gap in LP06)', built: '1778-85', footprint: () => axisRect([382216.15, 5466494.0], 91.2, 38.95, 11), cls: 'STABLE', template: 'stable', confidence: 'low', placement: 'map', priority: 6, dtmHint: 344.1, base: 344.1, notes: 'P19: LP06 12 draws E-W stubs from both ranges at N ≈5466488-5466500 with a gap between them -> cross range with a central passage [I].', sources: [SRC.lp06], axes: 10 },
  { id: 'KB-B34', name_de: 'Marstall, Querbau (Süd)', function: 'E-W cross range at the S end of the Marstall courts', built: '1778-85', footprint: () => axisRect([382214.7, 5466405.0], 91.2, 39.8, 11), cls: 'STABLE', template: 'stable', confidence: 'low', placement: 'map', priority: 6, dtmHint: 344.1, base: 344.1, notes: 'P19: LP06 12 E-W stubs at N ≈5466398-5466411 [I].', sources: [SRC.lp06], axes: 10 },
  { id: 'KB-B35', name_de: 'Zwingerhaus', function: 'house in the middle of the Zwinger yard (kennel / keeper I)', built: '1780-83 (?)', lp06: ['15', 0], cls: 'FARM', template: 'yardhouse', confidence: 'low', placement: 'map', priority: 6, dtmHint: 343.8, notes: 'P20: LP06 15 central house (≈13 x 7 m drawn); HMS walled square with a central house.', sources: [SRC.lp06, SRC.k05] },
  { id: 'KB-B36', name_de: 'Brauerei und Wirtshaus, Westflügel', function: 'side wing of the brewery/inn (stables of the hôtellerie, PV l. I)', built: '1778-82', footprint: () => axisRect([382239.8, 5466765.85], 1.2, 14.3, 9.0), cls: 'WING2', template: 'svc2', confidence: 'low', placement: 'map', priority: 6, dtmHint: 344.5, notes: 'P23: W leg of the LP06 22 L-shape.', sources: [SRC.lp06, SRC.pv] },
  // ---- Ehrenhof (N1, N2)
  { id: 'KB-B37', name_de: 'Wachhaus Süd (an der Ehrenhofmündung)', function: 'guard house (PV t. "Grand corps de garde devant le Château"; LC: guard pavilion with a tetrastyle portico)', built: '1780s U', lp06: ['28', 0], cls: 'PAV', template: 'guard', confidence: 'med', placement: 'map', priority: 4, dtmHint: 342.0, notes: 'N1: LP06 28 "Wachhäuser", two small houses ≈7 x 8 m flanking the court mouth (core fit ±6 m); LC 1790 shows two small buildings in front of the court.', sources: [SRC.lp06, SRC.lc, SRC.pv] },
  { id: 'KB-B38', name_de: 'Wachhaus Nord (an der Ehrenhofmündung)', function: 'guard house (PV t.; LC)', built: '1780s U', lp06: ['28', 1], cls: 'PAV', template: 'guard', confidence: 'med', placement: 'map', priority: 4, dtmHint: 342.0, notes: 'N1: LP06 28, northern house.', sources: [SRC.lp06, SRC.lc, SRC.pv] },
  { id: 'KB-B40', name_de: 'Waffenschmiede', function: 'armourers\' house (PV f. "Maison des armuriers")', built: 'U', footprint: ({ lp06 }) => shift(minRect(lp06.get('10')!.rings[0]).ring, ...gridShift(0, 1.0)), cls: 'FARM', template: 'svc2', confidence: 'low', placement: 'map', priority: 5, dtmHint: 344.7, notes: 'N3: LP06 10 (17 x 10 m, north fit ±7 m), shifted 1 m N to clear the gallery.', sources: [SRC.lp06, SRC.pv] },
  { id: 'KB-B41', name_de: 'Taubenhaus mit Wohnungen', function: 'dovecote with lodgings on both sides (PV c. "Colombier avec ses logemens de part et d\'autre"); v1 UP-04', built: '1779-82', lp06: ['8', 0], cls: 'RANGE1', template: 'svc2', confidence: 'low', placement: 'map', priority: 5, dtmHint: 341.0, notes: 'N4: LP06 8 (57 x 10 m, core fit ±6 m) S of the Orangerie; central dovecote tower (PV c.) not modelled separately [U].', sources: [SRC.lp06, SRC.pv], axes: 15 },
  { id: 'KB-B42', name_de: 'Chevau-leger-Kaserne', function: 'barracks of the light horse (PV d. "Caserne des chevaux légers")', built: 'U', lp06: ['9', 0], cls: 'WING2', template: 'svc2', confidence: 'low', placement: 'map', priority: 5, dtmHint: 337.4, notes: 'N5: LP06 9 (59 x 15 m, core fit ±10 m) on the slope S of the Orangerie (DTM 334-342.5).', sources: [SRC.lp06, SRC.pv], axes: 16 },
  { id: 'KB-B43', name_de: 'Remisen', function: 'coach houses (v1 UP-02)', built: '1782-85', lp06: ['14', 0], cls: 'RANGE1', template: 'svc1', confidence: 'low', placement: 'map', priority: 5, dtmHint: 343.6, notes: 'N6: LP06 14 (60 x 12 m, north fit ±8 m) E of the Marstall on the second road.', sources: [SRC.lp06], axes: 15, court_toward: 'TF-05' },
  { id: 'KB-B44', name_de: 'Torfschuppen (Süd)', function: 'peat shed', lp06: ['17', 2], cls: 'FARM', template: 'farm', confidence: 'low', placement: 'map', priority: 7, dtmHint: 337.1, notes: 'N8: LP06 17, on the E bank of the deep hollow way.', sources: [SRC.lp06] },
  { id: 'KB-B45', name_de: 'Torfschuppen (Mitte)', function: 'peat shed', lp06: ['17', 1], cls: 'FARM', template: 'farm', confidence: 'low', placement: 'map', priority: 7, dtmHint: 337.1, notes: 'N8: LP06 17.', sources: [SRC.lp06] },
  { id: 'KB-B46', name_de: 'Torfschuppen (Nord)', function: 'peat shed', lp06: ['17', 0], cls: 'FARM', template: 'farm', confidence: 'low', placement: 'map', priority: 7, dtmHint: 337.1, notes: 'N8: LP06 17.', sources: [SRC.lp06] },
  { id: 'KB-B47', name_de: 'Jägerhof (Südflügel)', function: 'hunt yard (LP06 18; U-shape open to the W)', lp06: ['18', 1], cls: 'FARM_GROUP', template: 'svc2', confidence: 'low', placement: 'map', priority: 6, dtmHint: 342.4, notes: 'N9: LP06 18, S part of the U (envelope as drawn).', sources: [SRC.lp06] },
  { id: 'KB-B48', name_de: 'Jägerhof (Nordflügel)', function: 'hunt yard (LP06 18)', lp06: ['18', 0], cls: 'FARM_GROUP', template: 'svc2', confidence: 'low', placement: 'map', priority: 6, dtmHint: 342.4, notes: 'N9: LP06 18, N part of the U (envelope as drawn).', sources: [SRC.lp06] },
  { id: 'KB-B49', name_de: 'Cavaliershaus', function: 'lodging for courtiers / officers (v1 UP-01 Kavaliersbau; PV m. "Maison et logement des officiers" I); cellar "Räuberhöhle" survives (Commons)', built: '1779-85', lp06: ['19', 0], cls: 'WING2', template: 'svc2', confidence: 'low', placement: 'map', priority: 5, dtmHint: 344.0, notes: 'N10: LP06 19 (81 x 12 m, north fit ±10 m) on the W side of the road N of the Jägerhaus; red tile, 2 storeys (PV).', sources: [SRC.lp06, SRC.pv], axes: 22, court_toward: 'TF-10' },
  { id: 'KB-B50', name_de: 'Kaserne mit Exerzierplatz (Südteil)', function: 'barracks with parade ground (PV k. "La caserne avec la place d\'armes")', lp06: ['20', 1], cls: 'FARM_GROUP', template: 'svc2', confidence: 'low', placement: 'map', priority: 6, dtmHint: 343.1, notes: 'N11: LP06 20 multi-wing barracks (envelope as drawn).', sources: [SRC.lp06, SRC.pv] },
  { id: 'KB-B51', name_de: 'Kaserne mit Exerzierplatz (Nordteil)', function: 'barracks (PV k.)', lp06: ['20', 0], cls: 'FARM_GROUP', template: 'svc2', confidence: 'low', placement: 'map', priority: 6, dtmHint: 343.1, notes: 'N11: LP06 20 (envelope as drawn).', sources: [SRC.lp06, SRC.pv] },
  { id: 'KB-B52', name_de: 'Kaserne gegenüber dem Lazarett (West)', function: 'one of the two new barracks opposite the hospital (PV p.)', lp06: ['23', 0], cls: 'WING2', template: 'svc2', confidence: 'low', placement: 'map', priority: 6, dtmHint: 343.5, notes: 'N12: LP06 23 (25 x 12 m E-W, north fit ±12 m).', sources: [SRC.lp06, SRC.pv], axes: 6 },
  { id: 'KB-B53', name_de: 'Kaserne gegenüber dem Lazarett (Ost)', function: 'second new barracks (PV p.)', lp06: ['24', 0], cls: 'WING2', template: 'svc2', confidence: 'low', placement: 'map', priority: 6, dtmHint: 340.7, notes: 'N13: LP06 24 (22 x 12 m E-W).', sources: [SRC.lp06, SRC.pv], axes: 5 },
  { id: 'KB-B54', name_de: 'Treibhaus in der Holländischen Gärtnerei (Ost)', function: 'forcing house (I; UP-06 candidate)', lp06: ['11', 0], cls: 'FARM', template: 'glass', confidence: 'low', placement: 'map', priority: 7, dtmHint: 347.6, notes: 'N14: LP06 11 small building in the garden (Treibhaus? I).', sources: [SRC.lp06, SRC.pv] },
  { id: 'KB-B55', name_de: 'Treibhaus in der Holländischen Gärtnerei (Mitte)', function: 'forcing house (I)', lp06: ['11', 1], cls: 'FARM', template: 'glass', confidence: 'low', placement: 'map', priority: 7, dtmHint: 347.6, notes: 'N14: LP06 11.', sources: [SRC.lp06] },
  { id: 'KB-B56', name_de: 'Treibhaus in der Holländischen Gärtnerei (West)', function: 'forcing house (I)', lp06: ['11', 2], cls: 'FARM', template: 'glass', confidence: 'low', placement: 'map', priority: 7, dtmHint: 347.6, notes: 'N14: LP06 11 (W of the road).', sources: [SRC.lp06] },
  ...['a', 'b', 'c'].map(
    (k, i): NewSpec => ({ id: `KB-B57${k}`, name_de: `Schäferei (LP06 25, Bau ${i + 1})`, function: 'sheep farm (PV 4. "La nouvelle bergerie" ? I)', lp06: ['25', i], cls: 'FARM', template: 'farm', confidence: 'low', placement: 'map', priority: 7, dtmHint: 316, notes: 'N15: LP06 25 (global fit ±15 m).', sources: [SRC.lp06] }),
  ),
  ...['a', 'b'].map((k, i): NewSpec => ({ id: `KB-B60${k}`, name_de: `Schäferei (LP06 26, Bau ${i + 1})`, function: 'sheep farm', lp06: ['26', i], cls: 'FARM', template: 'farm', confidence: 'low', placement: 'map', priority: 7, dtmHint: 311, notes: 'N15: LP06 26 (global fit ±15 m).', sources: [SRC.lp06] })),
  { id: 'KB-B62', name_de: 'Landwirtschaftlich genutztes Gebäude (LP06 27)', function: 'farm building', lp06: ['27', 0], cls: 'FARM', template: 'farm', confidence: 'low', placement: 'map', priority: 7, dtmHint: 309, notes: 'N15: LP06 27 (global fit ±15 m).', sources: [SRC.lp06] },
  { id: 'KB-B63', name_de: 'Wachhaus am Taleingang (Nord)', function: 'guard house at the park entrance (PV 1. "Les deux petites maisons en entrant au parc pour le corps de garde et la barrière")', lp06: ['37', 0], cls: 'PAV', template: 'guard', confidence: 'low', placement: 'map', priority: 6, dtmHint: 257.6, notes: 'N16: LP06 37 (global fit ±15 m).', sources: [SRC.lp06, SRC.pv] },
  { id: 'KB-B64', name_de: 'Wachhaus am Taleingang (Süd)', function: 'guard house at the park entrance (PV 1.)', lp06: ['37', 1], cls: 'PAV', template: 'guard', confidence: 'low', placement: 'map', priority: 6, dtmHint: 257.6, notes: 'N16: LP06 37.', sources: [SRC.lp06, SRC.pv] },
  { id: 'KB-B65', name_de: 'Scheune', function: 'barn', lp06: ['39', 0], cls: 'FARM', template: 'farm', confidence: 'low', placement: 'map', priority: 7, dtmHint: 255.5, notes: 'N17: LP06 39 (global fit ±15 m).', sources: [SRC.lp06] },
  { id: 'KB-B66', name_de: 'Kelterei', function: 'wine press house (vineyard PV x. "La vigne")', lp06: ['40', 0], cls: 'FARM', template: 'svc1', confidence: 'low', placement: 'map', priority: 7, dtmHint: 260.5, notes: 'N17: LP06 40.', sources: [SRC.lp06, SRC.pv] },
  { id: 'KB-B67', name_de: 'Pastorshäuschen', function: "pastor's house", lp06: ['41', 0], cls: 'FARM', template: 'svc1', confidence: 'low', placement: 'map', priority: 7, dtmHint: 274.4, notes: 'N17: LP06 41.', sources: [SRC.lp06] },
  ...[0, 1, 2, 3, 4].map(
    (i): NewSpec => ({ id: `KB-B${68 + i}`, name_de: `Carlsdorf (Sanddorf), Haus ${i + 1}`, function: 'village house outside the park (PV 5. "Le petit hameau hors du parc" ? I; UP-13 candidate)', lp06: ['42', i], cls: 'FARM', template: 'farm', confidence: 'low', placement: 'map', priority: 7, dtmHint: 262, notes: 'N18: LP06 42 (global fit ±15 m).', sources: [SRC.lp06, SRC.pv] }),
  ),
  ...[0, 1, 2].map((i): NewSpec => ({ id: `KB-B${73 + i}`, name_de: `Neue Schäferei, Bau ${i + 1}`, function: 'new sheep farm (PV 4. "La nouvelle bergerie et maison")', lp06: ['43', i], cls: 'FARM', template: 'farm', confidence: 'low', placement: 'map', priority: 7, dtmHint: 251.6, notes: 'N19: LP06 43 (global fit ±15 m).', sources: [SRC.lp06, SRC.pv] })),
  { id: 'KB-B76', name_de: 'Gärtnerei (LP06 34)', function: 'nursery house', lp06: ['34', 0], cls: 'FARM', template: 'svc1', confidence: 'low', placement: 'map', priority: 7, dtmHint: 286, notes: 'N20: LP06 34 (global fit ±15 m).', sources: [SRC.lp06] },
  { id: 'KB-B77', name_de: 'Gärtnerei Reichard mit Kegelbahn', function: "court gardener Ludwig Reichard's nursery with a skittle alley (LP06 45)", lp06: ['45', 0], cls: 'FARM', template: 'svc1', confidence: 'low', placement: 'map', priority: 7, dtmHint: 349.7, notes: 'N20: LP06 45 (global fit ±15 m).', sources: [SRC.lp06] },
  { id: 'KB-B78', name_de: 'Gärtnerei (LP06 47)', function: 'nursery house', lp06: ['47', 0], cls: 'FARM', template: 'svc1', confidence: 'low', placement: 'map', priority: 7, dtmHint: 351.1, notes: 'N20: LP06 47.', sources: [SRC.lp06] },
  { id: 'KB-B79', name_de: 'Brunnenhaus (LP06 33)', function: 'well / fountain house', lp06: ['33', 0], cls: 'PAV', template: 'pav', confidence: 'low', placement: 'map', priority: 7, dtmHint: 290.5, notes: 'N21: LP06 33 (global fit ±15 m); different from the Hirschwürzloch.', sources: [SRC.lp06] },
  { id: 'KB-B80', name_de: 'Hirschwürzloch (Brunnenhaus / Hirschbrunnen)', function: 'fountain house 1783 (v1 UP-17)', built: '1783', footprint: ({ lp06 }) => circleRing(centroid(openRing(lp06.get('46')!.rings[0])) as EN, 15), cls: 'PAV', template: 'pav', confidence: 'low', placement: 'map', priority: 7, dtmHint: 309.5, notes: 'N22: LP06 46 round building D ≈17 m drawn -> 15 m (global fit ±15 m).', sources: [SRC.lp06] },
  { id: 'KB-B81', name_de: 'Pavillon (LP06 31)', function: 'garden pavilion (UP-08/09/11 candidate U)', lp06: ['31', 0], cls: 'PAV', template: 'pav', confidence: 'low', placement: 'map', priority: 7, dtmHint: 309, notes: 'N23: LP06 31 (global fit ±15 m).', sources: [SRC.lp06] },
  { id: 'KB-B82', name_de: 'Pavillon (LP06 35)', function: 'garden pavilion (U)', lp06: ['35', 0], cls: 'PAV', template: 'pav', confidence: 'low', placement: 'map', priority: 7, dtmHint: 274, notes: 'N23: LP06 35.', sources: [SRC.lp06] },
  { id: 'KB-B83', name_de: 'Pavillon (LP06 52)', function: 'pavilion near the Fasanerie (U)', lp06: ['52', 0], cls: 'PAV', template: 'pav', confidence: 'low', placement: 'map', priority: 7, dtmHint: 354, notes: 'N23: LP06 52 (39 x 15 m drawn - large for a pavilion).', sources: [SRC.lp06] },
  { id: 'KB-B84', name_de: 'Carlsluster Torhaus', function: 'gatehouse of the Karlslust (v1 UP-15); fountain at the entrance survives (Commons)', built: '1782', lp06: ['50', 0], cls: 'RANGE1', template: 'svc2', confidence: 'low', placement: 'map', priority: 6, dtmHint: 356.0, notes: 'N24: LP06 50 (43 x 14 m, global fit ±15 m).', sources: [SRC.lp06], axes: 11 },
  { id: 'KB-B85', name_de: 'Fasanerie', function: 'pheasantry (v1 UP-14; PV 7. "La Faisanderie dans le bois d\'Erbach avec son petit corps de garde")', built: '1780-81', lp06: ['51', 0], cls: 'FARM', template: 'farm', confidence: 'low', placement: 'map', priority: 6, dtmHint: 353.5, notes: 'N25: LP06 51 (48 x 18 m, global fit ±15 m).', sources: [SRC.lp06, SRC.pv] },
  { id: 'KB-B86', name_de: 'Gebäude Nr. 67 (nicht in der Legende)', function: 'unnamed building (LP06 67)', lp06: ['67', 0], cls: 'FARM', template: 'svc2', confidence: 'low', placement: 'map', priority: 8, dtmHint: 352.4, notes: 'N28: LP06 draws no. 67 without a legend entry.', sources: [SRC.lp06] },
  // ---- Karlslust
  { id: 'KL-B46', name_de: 'Tschifflik-Pavillon (auf der Terrasse gegenüber der Kaskade)', function: 'Turkish-style pavilion 1779-80, largest of four pavilions', built: '1779-80', lp06: ['61', 0], cls: 'PAV', template: 'pav', confidence: 'low', placement: 'map', priority: 4, dtmHint: 307.5, notes: 'N7: LP06 61 "Tschifflik Pavillon" on the KL-03 terrace axis (two marks, 31 x 17 m drawn; karlslust fit ±8 m); 1950s note "on a terrace opposite the cascade" (05 a.5). Oriental form U (cf. Schwetzingen Moschee).', sources: [SRC.lp06, SRC.syn] },
  { id: 'KL-B47', name_de: 'Gebäude an der Terrasse (LP06 62)', function: 'building on the upper terrace (LP06 62 "Terrasse")', lp06: ['62', 0], cls: 'PAV', template: 'pav', confidence: 'low', placement: 'map', priority: 6, dtmHint: 320.1, notes: 'N26: LP06 62 (32 x 17 m drawn, karlslust fit ±10 m).', sources: [SRC.lp06] },
  { id: 'KL-B48', name_de: 'Treillagenpavillon', function: 'trellis pavilion with terraces (v1 UP-16 "Trilagen-Pavillon")', lp06: ['63', 0], cls: 'PAV', template: 'pav', confidence: 'low', placement: 'map', priority: 6, dtmHint: 307.9, notes: 'N26: LP06 63 (33 x 18 m drawn, karlslust fit ±10 m). Trellis (Treillage) structure: render as open lattice [I].', sources: [SRC.lp06] },
  { id: 'KL-B49', name_de: 'Hymenäostempel (Standort, 1785)', function: 'temple of Hymen for the 1785 wedding (LP06 59 "Standort des Hymenäostempel 1785")', built: '1785', lp06: ['59', 0], cls: 'PAV', template: 'temple', confidence: 'low', placement: 'map', priority: 6, dtmHint: 286.6, notes: 'N27: LP06 59 site mark (≈8 x 8 m) by the KL-09 rondell at the top of the Große Kaskade. Form U (possibly temporary).', sources: [SRC.lp06] },
];

function gridShift(du: number, dv: number): [number, number] {
  // shift in the palace grid expressed in EN (u az 80.5°, v az 350.5°)
  const u = dirEN(80.5);
  const v = dirEN(350.5);
  return [du * u[0] + dv * v[0], du * u[1] + dv * v[1]];
}

function shift(r: RingEN, dE: number, dN: number): RingEN {
  return ring(openRing(r).map((p) => [p[0] + dE, p[1] + dN] as P2));
}

export function newBuildings(ctx: BuildCtx): Building[] {
  return NEW.map((n) => {
    let fp: RingEN;
    if (n.footprint) fp = n.footprint(ctx);
    else {
      const [no, idx] = n.lp06!;
      const lp = ctx.lp06.get(no);
      if (!lp || !lp.rings[idx]) throw new Error(`${n.id}: LP06 ${no} ring ${idx} missing`);
      const raw = lp.rings[idx];
      if (n.cls === 'FARM_GROUP') fp = raw;
      else {
        const m = minRect(raw);
        fp = m.rectangularity >= 0.8 ? m.ring : raw;
      }
    }
    const m = minRect(fp);
    const base = n.base ?? n.dtmHint;
    const storeys = storeysFor(n.template);
    const eaves = base + storeys.reduce((s, x) => s + x.height, 0);
    const roof: Roof = n.cls === 'FARM_GROUP' ? { type: 'none', cover: 'none', material: 'red Biberschwanz tile', note: 'envelope as drawn in LP06 - generator places ranges inside or a placeholder' } : roofFor(n.template, r2(m.width), eaves);
    const facade: Facade =
      n.template === 'guard' || n.template === 'pav' || n.template === 'temple' ? { ...PALACE_FACADE_BASE, axis_spacing: 3.6 } : { ...FARM_FACADE, axis_spacing: n.cls === 'STABLE' ? 3.6 : 3.4 };
    if (n.axes) facade.axes = n.axes;
    const b: Building = {
      id: n.id,
      name_de: n.name_de,
      cls: n.cls,
      function: n.function,
      built: n.built ?? 'before 1789 (LP06) U',
      priority: n.priority,
      confidence: n.confidence,
      placement: n.placement,
      footprint: fp,
      base_h: base,
      base_h_note: n.base !== undefined ? 'terrace level (LiDAR)' : 'DTM median under the footprint (sample_dtm.py); generator extends the plinth to ground_dtm.min',
      storeys,
      roof,
      facade,
      interior: 'none',
      lidar_ids: [],
      sources: n.sources,
      notes: `v2 new: ${n.notes}`,
      alternatives: n.alternatives ?? [],
      ground_dtm: null,
    };
    if (n.court_toward) b.court_toward = n.court_toward;
    return b;
  });
}

/** Ehrenhof grille (N2) as a WALL line. */
export function grilleBuilding(ctx: BuildCtx): Building {
  const a = ctx.grid.toEN(-34.0, -20.3);
  const b = ctx.grid.toEN(-34.0, 20.6);
  return {
    id: 'KB-B39',
    name_de: 'Ehrenhofgitter mit Tor',
    cls: 'WALL',
    function: 'wrought-iron grille with gate piers and a central gate across the Ehrenhof (D LC 1790, PL); chain-and-post barrier in front (PL)',
    built: '1780s U',
    priority: 3,
    confidence: 'med',
    placement: 'relative',
    footprint: null,
    line: [rEN2(a), rEN2(b)],
    base_h: 344.8,
    storeys: [],
    roof: { type: 'none', cover: 'none' },
    facade: {
      material: 'wrought-iron grille (metal.iron) on a low red sandstone base, sandstone gate piers with vases',
      height_m: 3.6,
      content: 'grille: open ironwork, not a solid wall; central double gate 4 m',
      tags: 'D LC 1790 + PL (grille + gate); height N; line position U (court mouth here, could be nearer the CdL)',
    },
    interior: 'none',
    lidar_ids: [],
    sources: [SRC.lc, SRC.pl],
    notes: 'v2 new (N2): position U - placed between the W ends of the arms (u -34.0).',
    alternatives: ['grille nearer the Corps de logis (inner court)'],
    ground_dtm: null,
  };
}

function rEN2(p: EN): EN {
  return [r2(p[0]), r2(p[1])];
}

/** The other three ranges of the Carlsberger Hof (P26). */
export function carlsbergerHofRanges(ctx: BuildCtx, mainId = 'KB-B30'): Building[] {
  const rings = ctx.lp06.get('38')!.rings.map((r) => minRect(r));
  rings.sort((x, y) => y.length * y.width - x.length * x.width);
  return rings.slice(1).map((m, i) => {
    const base = 259.2;
    const storeys = [st('Sockel', 0.4, 'plinth', 'N'), st('Erdgeschoss', 3.4, 'floor', 'N'), st('Kniestock / Heuboden', 1.2, 'kneewall', 'N')];
    return {
      id: `${mainId}${'bcd'[i]}`,
      name_de: `Carlsberger Hof (Meierei), Wirtschaftsflügel ${i + 1}`,
      cls: 'FARM',
      function: 'farm range around the court (LP06 38)',
      built: 'before 1789 (LP06) U',
      priority: 6,
      confidence: 'low',
      placement: 'map',
      footprint: m.ring,
      base_h: base,
      base_h_note: 'DTM median under the footprint (sample_dtm.py)',
      storeys,
      roof: pitched('gable', r2(m.width), base + 5.0, 48, 'red Biberschwanz tile', 'tile', 'N; red tile D PV'),
      facade: { ...FARM_FACADE, axis_spacing: 3.4 },
      interior: 'none',
      lidar_ids: ['KB-60'],
      sources: [SRC.lp06, SRC.pv],
      notes: 'v2 new (P26): one of the four LP06 38 ranges (global fit ±15 m).',
      alternatives: [],
      ground_dtm: null,
    } satisfies Building;
  });
}
