/**
 * Catalogue v2 building data: edits of the v1 entries (P1-P34 of research/07 §3, the HMS
 * measurements of research/08 §7); the buildings newly placed from the georeferenced 2006
 * Lageplan (research/07 §2.6 / §3.2, N1-N28) are in newBuildings.ts. Conflict rule (task brief, research/07 §3):
 *   documented period sources > georeferenced research plan (LP06) > LiDAR positions >
 *   HMS heights/massing > comparables/norms.
 * Footprints: LiDAR where it measures a foundation; LP06 for topology/length and for everything
 * the LiDAR does not show. Heights: HMS (one cornice at 356.0 m) over period norms.
 */
import type { GridFrame } from '../../model/src/frame.ts';
import { dirEN } from '../../model/src/frame.ts';
import { centroid, openRing, type P2 } from '../../model/src/layout/geom.ts';
import { roofSection } from '../../model/src/layout/roof.ts';
import type { Building, EN, Facade, FollyKind, RingEN, Roof, Storey, StoreyKind } from '../../model/src/spec.ts';
import { minRect, r2, ring, uvRect, type Lp06Building } from './common.ts';
import { MENAGERIE_CHANNEL, MENAGERIE_FRONT_AZ, MENAGERIE_ROWS, MENAGERIE_RUN_DEPTH } from './menagerie.ts';

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
  // KB-I02 (research/09 §6.5 C8, research/10 §a.4, research/11 §7): sources the info panel should name
  mannlich: 'research/10 T1: J. C. von Mannlich, Ein deutscher Maler und Hofmann, ed. E. Stollreither, Berlin 1910 (PD scan, archive.org eindeutschermale00mann)',
  schwan2012: 'research/10 T5: J. Schwan, "Schloss Carlsberg bei Homburg-Saar - die Wiederentdeckung eines Wittelsbacherschlosses", Burgen und Schlösser 53 (2012) 241-250',
  schneiderWeb: 'research/11 §7: R. Schneider, schloss-carlsberg.de articles (archived 2022/23): "Entwurf zur Gestaltung der Carlsberger Gärten" (Petri plan), "Rotunde der Orangerie, 1785", room arrangement "Stand 2003"',
  ndbHautt: 'research/09 §8: W. Medding, "Hautt, Christian Ludwig", NDB 8 (1969) 133 f. (deutsche-biographie.de/sfz28384.html)',
  koblenz: 'research/09 §2.5: Kurfürstliches Schloss Koblenz 1777-93, 1998 finish "Weißgrau, Grau für die Architekturglieder" (de.wikipedia) - comparable D->',
  herzogvorstadt: 'research/09 §2.5: Zweibrücken Herzogvorstadt (Hautt 1760-75), Putzbauten with Lisenengliederung (de.wikipedia Kulturdenkmäler Zweibrücken-Stadtmitte) - comparable D->',
  hemmer: 'research/09 §3.4: SSG press release on Hemmer lightning rods at Schwetzingen (17 Jul 1776, "Fünfstern"), schloesser-und-gaerten.de 2026 - comparable D->',
  // KB-I29 (research/10 §b.4): the only source with find-spot detail for the menagerie ring
  t20: 'research/10 T20: urlaub.saarland, "Bärenzwinger" (https://www.urlaub.saarland/attraktion/baerenzwinger-1986e52928): circular amphitheatre with 19 square, slate-roofed, separated houses; island pavilion foundations found 2016; Herzogsterrassen 1786',
  // KB-I21 (research/09 §2.3, §6.1 G4): rendered Fachwerk in the Karlsberg service and secondary buildings
  fachwerk: 'research/09 §2.3, §6.5 C1: Fachwerk documented at Karlsberg (the 1793 fire hit "die Gebäude, die aus Holz (Fachwerk) waren", de.wikipedia Schloss Karlsberg); which buildings and storeys were timber-framed I',
  // KB-I30 / KB-I39 (research/10 §a.1, §b.6; research/11 §0 item 5): zone evidence for the follies and staffage
  v23: 'research/10 V23: M. Schindler, overview map of the Carlsberg and Karlslust with 31 numbered features (Schwan 2010 p. XXXI; Schwan 2012 Abb. 1), schematic placement, positions ± 50-100 m',
  karlslustFollies: 'research/11 §0 item 5, S14: Saarpfalz-Touristik "Die Karlslust im Waldpark Schloss Karlsberg" (Chinese pavilion, Turkish pavilion, Turkish tent, hay wagon, aviary); J. Schwan lecture via homburg1.de 2018 ("ein chinesischer Pavillon, ein türkisches Zelt")',
  t25voliere: 'research/10 T25: J. Schwan, "… Die Voliere in der Karlslust und andere Gevögels", Saarpfalz 150 (2023) 6-13 (print, not read)',
  reddingLanger: 'research/09 §5: Richard Redding Antiques, G. Jacob canapé c. 1781-82, citing B. Langer, Die Möbel der Residenz München, 1995 (antechamber no. 8, "Apparat du Souverain")',
} as const;

// ---------------------------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------------------------

export const st = (name: string, height: number, kind: StoreyKind, tag: string): Storey => ({ name, height, kind, tag });

/**
 * Palace group storeys: one floor stack and one cornice (356.0) for CdL, arms, W wing, kitchen wing.
 * `lower` / `upper` name the floors after their main rooms; `useTag` gives the evidence of those names
 * (fix wave 4: the names follow the KB-I25 room programme, checks.ts `functionIssues` keeps them in step).
 */
export function palaceStoreys(upper: string, lower = 'Erdgeschoss', useTag = ''): Storey[] {
  const use = useTag ? `; use: ${useTag}` : '';
  return [
    st('Sockel / Souterrain (Kellerfenster)', 1.4, 'plinth', 'HMS CdL plinth 344.8-346.2 (research/08 §4); same for the whole palace group I'),
    st(lower, 5.2, 'floor', `HMS EG windows 347.0-349.9, upper windows from 352.3 -> floors 346.2 / 351.4 (D-> with N sills 0.7-0.9); I${use}`),
    st(upper, 4.6, 'floor', `HMS one cornice at 356.0 on CdL, arms, W wing, kitchen wing (research/08 §1.2); D enwp continuous cornice${use}`),
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

export const FARM_FACADE: Facade = {
  material: 'lime-washed render on rubble',
  colour: '#E8DFC8',
  dressings: 'sandstone door and window frames',
  members_colour: '#BDBAB2',
  members_material: 'stone',
  plinth_colour: '#A65E4A',
  shutters: 'plank, dark green #3F5A3A (stables oxblood #6E2E26)',
  shutter_type: 'plank',
  shutter_colour: '#3F5A3A',
  lightning_rods: true,
  tags: 'N (period norm); red tile roofs on the service town D PV 1791 (research/07 §1.1); plank shutters green #3F5A3A or oxblood #6E2E26 N (research/09 §3.7, KB-I15)',
};

/** Stables: oxblood shutters and gates instead of green [N research/09 §3.7; choice per class I] (KB-I15). */
export const STABLE_SHUTTER = '#6E2E26';
/** Court-building shutters: blue-grey [D-> Baunetz Klassizismus; HMS] (research/09 §3.2, C3; KB-I15). */
export const COURT_SHUTTER = '#5F6F7A';

export const PALACE_FACADE_BASE: Facade = {
  material: 'lime render',
  colour: '#ECE8DF',
  dressings: 'Lisenen, bands, surrounds and cornice in grey-painted render #B9B8B2; exposed sandstone only at portals (LC grey-pink #BFAEA5), steps and the red Buntsandstein plinth #A65E4A',
  members_colour: '#B9B8B2',
  members_material: 'render',
  portal_colour: '#BFAEA5',
  plinth_colour: '#A65E4A',
  shutters: 'louvred Jalousieläden, blue-grey #5F6F7A',
  shutter_type: 'louvred',
  shutter_colour: COURT_SHUTTER,
  lightning_rods: true,
  tags: 'render colour: D (Orangerie "hell verputzt", schloss-karlsberg.de), D LC 1790 pale render, D-> Koblenz/Wilhelmshöhe; members grey painted render #B9B8B2 D-> Koblenz 1998 "Grau für die Architekturglieder", I for Karlsberg (rushed, painter-led site, Hautt 1785 Gutachten D NDB; research/09 §1.2-1.3, §2.5, E7, C4); portal dressings grey-pink #BFAEA5 D LC 1790 hue (research/09 §3.7); shutters blue-grey #5F6F7A D-> Baunetz Klassizismus + HMS (research/09 §3.2, C3; KB-I15)',
};

/**
 * Wave 8: the follies (template 'folly', KB-I31 / KB-I39 / KB-I30) had inherited PALACE_FACADE_BASE: lime render,
 * Jalousieläden, Hemmer rods and the palace evidence tags (LC 1790, Koblenz) in the catalogue and the info box. Each
 * kind now states what the generator actually draws (exterior/folly.ts, grammar FOLLY) and that its form is a period
 * norm [N], with no shutters and no rods. The hexes stay those the folly builder reads (wall, members, plinth, stone),
 * so the 3D model does not change.
 */
export const FOLLY_FACADE: Record<FollyKind, Pick<Facade, 'material' | 'dressings' | 'tags'>> = {
  altan: {
    material: 'two rendered piers on red Buntsandstein base courses carrying a deck at the Beletage floor',
    dressings: 'sandstone imposts and entablature (architrave, frieze, cornice) under a stone balustrade',
    tags: 'existence D (T5 Abb. 11 "Fundamente des Altans"); position I; form, materials and colours N (period Altan on piers; FOLLY.altan); base courses in the wing plinth stone #A65E4A D (KB-B02)',
  },
  monopteros: {
    material: 'open round colonnade: eight Tuscan columns in grey-painted render on a three-step sandstone stylobate, shallow lead dome with a gilt finial',
    dressings: 'none (columns, entablature ring and dome only)',
    tags: 'existence D-> (V23 no. 2); form, materials and colours N (period monopteros, FOLLY.monopteros); position I ± 50-100 m',
  },
  apiary: {
    material: 'open timber shelter with shelves of straw skeps under a tiled lean-to roof',
    dressings: 'none (bare timber)',
    tags: 'existence D-> (V23 no. 16 zone); form, materials and colours N (period bee shelter, FOLLY.apiary); position I ± 50-100 m',
  },
  chinese: {
    material: 'open painted timber pavilion on a stone plinth: lacquer-red posts, green lattice railings, painted upswept roof with bells and a gilt finial',
    dressings: 'none (painted timber; colours N after period chinoiserie)',
    tags: 'existence D (research/11 §0 item 5, S14; Schwan 2018); zone D-> V23 no. 31; form and colours N (research/11 S14 "octagonal, curved roof, red and green paint"; Chambers 1757 and the Wörlitz / Oranienbaum chinoiseries as norm comparables); position I ± 50-100 m',
  },
  tent: {
    material: 'striped canvas tent on a central pole',
    dressings: 'none (canvas, gilt pole finial)',
    tags: 'existence D (research/11 S14); form and colours N ("striped tent 8-10 m", FOLLY.tent); position I ± 50-100 m',
  },
  hay_wagon: {
    material: 'full-size timber hay wagon loaded with hay (staffage)',
    dressings: 'none',
    tags: 'existence D (research/11 S14); form N (FOLLY.hayWagon); position I ± 50-100 m',
  },
  aviary: {
    material: 'small rendered octagonal core under a slate roof with wire-mesh flights on a low stone base',
    dressings: 'none (grey-painted render cornice band)',
    tags: 'existence D (research/11 S14); zone D-> V23 no. 20; form, materials and colours N (FOLLY.aviary); position I ± 50-100 m',
  },
};

/** Colours the folly builder reads (wall, members, plinth, exposed stone); described per kind in FOLLY_FACADE. */
export const FOLLY_FACADE_BASE: Facade = {
  colour: '#ECE8DF',
  members_colour: '#B9B8B2',
  members_material: 'render',
  portal_colour: '#BFAEA5',
  plinth_colour: '#A65E4A',
  shutters: 'none',
  shutter_type: 'none',
  lightning_rods: false,
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
    b.roof = mansard(18.0, PALACE_EAVES, 21, 3.8, 'mansard D LC 1790 + PL (wings and CdL); break 359.8 and side ridge 362.7 HMS (research/08 §4) -> upper pitch 21° D->; slate D T1 (Mannlich 1910 p. 356 "unter dem Schieferdache", p. 370 Schieferplatten hauled up the hill; research/10 §b.1) + PV 1791 slate-blue palace roofs', {
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
    addSources(b, SRC.lp06, SRC.lc, SRC.pl, SRC.hms08, SRC.mannlich, SRC.hemmer, SRC.reddingLanger);
    b.notes =
      'v2: block BETWEEN the arm heads (u 28.2-46.2, v -20.3..20.6 = 40.9 x 18 m): LP06 draws a 46 x 19 m block between the wing heads projecting ~7 m E (D->, +1-3 m drawing thickness), HMS measures 44.5 x 18.4 m between the arms (research/08 §4); the length is the LiDAR court width (KB-01, 40.9-41.6 m) because both arms run along its flanks to u 39. Depth 18 m (LiDAR/HMS agree). East half on rising ground: garden door at grade. "42 m staircase" (enwp) read as 42 Pariser Fuss = 13.6 m -> 5-axis stair hall 13.25 m (C8, I). KB-I53 (research/10 §d.4): T1/Molitor "einstöckiges Wohnhaus mit Mansarden" describes the 1760/61 core (or counts the upper floor only, period usage I); LC 1790 shows 2 full storeys + mansard and the higher centre roof with lantern (D), matching HMS 366.2 -> massing kept.';
    b.alternatives = [
      'v1: 78 x 18 m range across the arm ends (u 28.2-46.2, v -37.3..40.6); the LiDAR KB-04 corner block may belong to it (medium-low confidence for the v2 topology)',
      'whole CdL under one mansard without the raised centre pavilion (en.wikipedia "only the CdL had a mansard")',
      'high hipped roof on the whole block (Louisenhof "probably Walmdach", hib)',
    ];
  },
  'KB-B02': (b, { grid }) => {
    b.name_de = 'Südflügel – Flügel der Herzogin';
    // fix wave 4 (review of KB-I25): function and storey names follow the moved room programme (research/10 §0.4, §b.1)
    b.function =
      "Duchess's apartment on the OG towards the Corps de logis (D LP06 legend 3), the apartment of Pfalzgraf Max Joseph in its W half and the Salon im Südflügel over the W portico (D R12 names; positions I); EG: two guest apartments, vestibule and stair at the W head pavilion and the Durchfahrt to the terrace garden (D R12 \"Appartements im Südflügel\", \"Vestibül und Treppe\", \"Durchfahrt\"; T5: long a carcass, interior partly unfinished in 1789 I); vaulted cellars (D LiDAR); W head pavilion with portico and Freitreppe (D LC 1790)";
    b.footprint = uvRect(grid, -36.0, 39.0, -37.3, -20.3);
    b.storeys = palaceStoreys('Obergeschoss (Appartements der Herzogin und des Pfalzgrafen)', 'Erdgeschoss (Gästeappartements, Vestibül und Treppe)', 'D LP06 legend 3, R12 room names (KB-I25)');
    b.roof = mansard(17.0, PALACE_EAVES, 28, BREAK_ABOVE_EAVES, 'mansard with two dormer rows D LC 1790 + PL; pitches 70/28 and break +4.1 HMS; ridge 363.8 reproduces HMS 363.7 ±1.0; Mansardwalmdach on the W head pavilion D LC');
    b.facade = {
      ...PALACE_FACADE_BASE,
      axes: 23,
      axis_spacing: 3.15,
      portal: 'central round-arched Durchfahrt (2 axes) to the south terrace garden (HMS gate u -1.6..4.9); W head pavilion: 4-column portico with balcony over a broad Freitreppe (~11 steps) (D LC 1790); court: wing-centre balcony over the court Durchfahrt (D PL symmetrised, low; KB-I72)',
      axis_tags: 'spacing 3.15 HMS (21 axes over 66 m, scale-free count); 75 m arm -> 23 axes on the outer face, 20 on the open court face (grid aligned) I; W head 4 axes D LC',
    };
    b.interior = 'detailed';
    b.confidence = 'high';
    b.placement = 'lidar+hms';
    b.built = '1782 – c. 1785/89 (long a carcass) [D T5]';
    addSources(b, SRC.lp06, SRC.lc, SRC.pl, SRC.hms08, SRC.schwan2012);
    b.notes =
      'v2: arm runs along the CdL flank to u 39 (75 x 17 m): LP06 (74 m drawn) + HMS (73 m) both show the wing heads flanking the CdL (P1b). Depth 17 m LiDAR = HMS 17.3. Sunken rooms ~2 m below the court = vaulted cellars (LiDAR). South face overlooks the terrace garden (LP06 44 "Schloßterrasse", HMS). Ownership: LP06 legend names the S wing the Duchess\'s (the HMS caption reads "herzoglicher Wohnflügel"); LP06 wins (research plan > HMS). KB-I02: contracts for the southern Ehrenhof wing auctioned 1782; for some years largely a carcass while the collection wing had priority (D T5 Schwan 2012; research/10 §b.1) -> 1789: exterior finished, interior partly unfinished [I].';
    b.alternatives = [
      'HMS 2022: "herzoglicher Wohnflügel mit Speisesälen und Silberkammer" (Duke) - LP06 legend 3 says Duchess',
      'E end at u 28.2 (64 m, the LiDAR KB-02 length) instead of along the CdL flank',
      'roof gable 45° (en.wikipedia after Schneider 1988) - contradicted by LC 1790 and PL (low)',
      'v1 alternative "= Kavaliersbau" superseded: LP06 19 places the Cavaliershaus on the north row (KB-B49)',
    ];
  },
  'KB-B03': (b, { grid }) => {
    b.name_de = 'Nordflügel – Flügel des Herzogs';
    // fix wave 4 (review of KB-I25): function and storey names follow the moved room programme (research/10 §0.4, §b.1)
    b.function =
      "Duke's apartment on the OG along the court side, ending in the Salon Mannlich (D LP06 legend 2; T1 pp. 392 f.); OG towards the Küchenhof: Großer Bildersaal, Kleiner Bildersaal and Tanzsaal (D T5 accounts; floor of the Tanzsaal U, positions I); EG: Silberkammer (porcelain and silver chambers) at the Küchenhof access (D T5, R12 EG 6), guard room, Kavalierszimmer, Registratur and the Durchfahrt to the Küchenhof (HMS; I)";
    b.footprint = uvRect(grid, -33.9, 39.0, 20.6, 40.6);
    b.storeys = palaceStoreys('Obergeschoss (Appartement des Herzogs, Bildersäle, Tanzsaal)', 'Erdgeschoss (Silberkammer, Wachstube, Durchfahrt)', 'D LP06 legend 2, T5, R12 (KB-I25)');
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
    // fix wave 4 (review of KB-I25): the EG holds the library, the OG the collections (research/10 §0.5, §b.1; T5 > R12 2003)
    b.function =
      'collection wing (D Weber ToC, BuS 2012 "collection wing to the north"); EG: the Hofbibliothek in four rooms in a row (D T5 accounts + T7 no. 2, "160 Schuh" ≈ 52 m; here ≈ 36 m I) and the Wachtstube at the gate; OG: Naturalienkabinett with the Waffensammlung adjoining (D T5), physical cabinet (D 05 §e.2; floor I) and probably the Kupferstichkabinett (U); the gunsmith had his own house KB-B40 (D PV f.); W carriage gate with sentry boxes into the Küchenhof (HMS)';
    b.footprint = uvRect(grid, -33.9, -20.9, 40.6, 98.0);
    b.storeys = palaceStoreys('Obergeschoss (Naturalienkabinett, Waffensammlung)', 'Erdgeschoss (Hofbibliothek, Wachtstube)', 'D T5 (KB-I25)');
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
    b.built = 'c. 1784 [D T5]';
    addSources(b, SRC.lp06, SRC.hms08, SRC.schwan2012);
    b.notes =
      'KB-I02: built c. 1784 north of the Ehrenhof at right angles to the court wing (D T5 Schwan 2012; research/10 §b.1; was "from 1782"). LiDAR KB-05 footprint kept (snapped to the palace grid, joined to the N arm). LP06 4 "Westflügel" lies on it (±6 m). HMS 62 x 17 m conflicts with KB-05 50 x 13 (research/08 §6) -> alternative. Its N end meets the W end of the gallery (KB-B06).';
    b.alternatives = ['HMS 2022: 62 x 17 m reaching v ≈103 with a stepped ridge 364.0 / 362', 'gallery on its upper floor instead of a separate range'];
  },
  'KB-B05': (b, { grid }) => {
    b.name_de = 'Ostflügel / Küchenbau (Küchenflügel)';
    // fix wave 4 (review of KB-I25): the Großer Speisesaal is on the OG (research/10 §0.4, §b.1 KB-B05)
    b.function =
      'court kitchen (Hofküche, 1779/80-84) on the EG with confectionery, bakery, scullery and serving room linked to the N arm (D 05 §e.2 names; positions I); OG: the Großer Speisesaal next to the N wing with two stove niches (D T1 pp. 338, 341; R12 OG 24; stoves O4/T26), its vestibule at the Küchenbautreppe (D R12 OG 25, 28 names), the Küchenschreiberei and the Mundkoch\'s lodging (I); most cooks lodged in the mansard (I, research/10 §b.1)';
    b.footprint = uvRect(grid, 20.8, 33.9, 40.6, 86.5);
    b.storeys = palaceStoreys('Obergeschoss (Großer Speisesaal)', 'Erdgeschoss (Hofküche)', 'D T1 pp. 338, 341, R12 OG 24 (KB-I25)');
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
      // KB-I21: built in haste from March 1788 on a wooden passage (T5) [D]; a rendered timber-frame range [I]
      fachwerk: { tag: 'D T5 (LA Speyer B3 2590 Bl. 9, March 1788): the gallery grew from "dem neuen hölzernen Gang" (research/10 §b.1); rendered Fachwerk range I (research/09 §2.3, G4, C1): 0.30 m wall, shallow reveals (grammar FACHWERK)' },
      portal: 'door from the Sammlungsflügel stair (W end), door to the end pavilion (E end)',
      axis_tags: 'axes I/N (3.9 m)',
    };
    b.interior = 'detailed';
    b.confidence = 'low';
    b.placement = 'map+lidar';
    b.lidar_ids = ['KB-07 (scarp under the S half)'];
    addSources(b, SRC.lp06, SRC.hms08, SRC.mannlich, SRC.schwan2012, SRC.schneiderWeb, SRC.fachwerk);
    // KB-I24 (research/10 §0.1-0.2, §b.1 KB-B06/B07): the gallery ends in a colonnade and the round Tempelzimmer
    b.function =
      'picture gallery (collection -> Alte Pinakothek): one long hall lit from the S, closed N hanging wall; grew from a wooden connecting passage (order of March 1788) [D T5]; from its E end an open colonnade leads to the round Tempelzimmer KB-B07 [D T1 p. 375 colonnade + rotunda, T5 Tempelzimmer; order gallery - colonnade - rotunda I, R12 lists "Tempelzimmer (Granitsaal) - Kolonnade - Rotunde" (KB-B07 alternative)], from the middle a glass door to the Bibliothekspavillon KB-B06a [D T1 pp. 374 f., T5]';
    b.facade.portal =
      'door from the Sammlungsflügel stair (W end); glazed door into the colonnade to the Tempelzimmer (E end, I); glass door in the N wall to the Bibliothekspavillon (D T1/T5 "from the middle", position along the hall I)';
    b.notes =
      'v2 (P10): LP06 6 draws a thin range (6-8 m) from the Westflügel E past the Küchenflügel to a square end pavilion, ~95-105 m in all; here 82.9 m hall, 8 m wide on the KB-07 scarp line (v 94-102). Level 344.8 vs 347.6 was open (P10); the upper level is taken because the E half lies entirely on the plateau. KB-I24: Mannlich\'s "hundert Fuß" mistranslates the French "cent pas" = 100 Schritt = 300 pieds ≈ 97.4 m (Schwan 2012 n. 47) [D->]; that matches LP06 (95-105 m). Hall 82.9 m (u -20.9..62.0) + colonnade 3.5 m + rotunda D 10.5 m: the rotunda\'s outer face lies 96.9 m from the Sammlungsflügel (u 76.0), the portico steps reach u ≈ 80 [D-> length; I split].';
    b.alternatives = [
      '81 m reading of "cent pas" (a common pas of 2½ pieds, Schwan 2012 n. 47) [D->]: hall + rotunda end ≈ 81 m from the Sammlungsflügel (u ≈ 60), i.e. a hall of ≈ 66 m in front of the rotunda',
      'v1: 62 x 11.5 m inside the Küchenhof at court level (u -20.9..41, v 87-98.5)',
      'HMS 2022: ≈40 m low range (eaves ≈349.1) ending in a rotunda (superseded by the "cent pas" reading, research/10 §b.1)',
      'gallery = upper floor of the Sammlungsflügel',
    ];
  },
  'KB-B07': (b, { grid }) => {
    // KB-I24 (research/10 §0.2, §b.1 KB-B07; history-check H03): a round Ionic temple room, not the LP06 square pavilion
    b.name_de = 'Tempelzimmer / Rotunde am Gartenende der Galerie (Granitsaal)';
    b.function =
      'round temple room "à la grecque" at the garden end of the picture gallery, reached through the gallery and an open colonnade: Ionic pilasters, large glass doors (Verrerie de Saint-Louis), outside an Ionic rotunda with a portico and triangular pediment, three steps down into the garden; from 1789 walls of marble and granite imitated in paper with columns and figures, two upholstered benches, mirror doors [D T5 (accounts, damage inventory T7 no. 2), T1 p. 375 "eine offene, durch eine Kolonnade abgeschlossene Rotunde", R12 OG 16-18 "Tempelzimmer (Granitsaal) - Kolonnade - Rotunde"]. Here Tempelzimmer and Rotunde are read as one building with the colonnade before it [I]; R12 and T1 also allow Tempelzimmer, then colonnade, then a separate open Rotunde (alternative; KB-I54)';
    b.built = '1788-89 (with the gallery; paper marble and granite from 1789) [D T5]';
    b.cls = 'PAV';
    // centre on the gallery line (v 98), outer face 96.9 m from the Sammlungsflügel; D 10.5 m [N ≈ 10-12 m; HMS ≈ 12 m]
    b.footprint = circleRing(grid.toEN(70.75, 98.0), 10.5, 32);
    b.base_h = 349.1;
    b.base_h_note =
      'I: the plateau rises E of the gallery (DTM 2025 ≈ 349.1-349.3 in front of the portico); floor 349.7 = grade + three steps (D T5 "drei Stufen") of 0.16 m (N); the colonnade climbs from the gallery floor 348.8 by 6 risers [I]';
    b.storeys = [
      st('Sockel', 0.6, 'plinth', 'I: floor 349.7 = portico grade 349.2 + 3 steps (research/10 §b.1)'),
      st('Tempelzimmer (Rundsaal)', 6.6, 'floor', 'N: Ionic order (pilasters + entablature) 6.6 m = Vignola column 5.28 m (9 D) + entablature 1/4; entablature top 356.3 ≈ palace cornice 356.0 HMS'),
      st('Attika', 0.9, 'kneewall', 'N: plain attic ring hiding the springing of the low dome (research/10 §b.1 "low dome or conical roof behind a parapet")'),
    ];
    b.roof = {
      type: 'dome',
      eaves_h: 357.2,
      dome_rise_ratio: 0.25,
      material: 'sheet lead (N)',
      cover: 'lead',
      tags: 'low dome behind the attic N (research/10 §b.1 KB-B07: "low dome or conical roof behind a parapet"); rise 1/4 of the diameter N; lead sheet N',
    };
    b.facade = {
      ...PALACE_FACADE_BASE,
      shutters: 'none (glazed doors)',
      shutter_type: 'none',
      windows: 'large glass doors (portes-fenêtres) between Ionic pilasters [D T5]; St-Louis glass [D T5]; doors in five of eight bays, niches beside the colonnade [I]',
      portal: 'Ionic portico of four columns with a triangular pediment on the garden (E) axis, three steps down into the garden [D T5]; open colonnade on the W axis to the gallery [D T1 p. 375, R12; I length]',
      axis_tags: 'eight bays N (one per 4.1 m of drum); which bays are glazed I',
      rotunda: {
        order: 'ionic',
        axis_azimuth: Math.round(grid.azimuthGridDeg * 10) / 10,
        bays: ['door', 'door', 'door', 'niche', 'link', 'niche', 'door', 'door'],
        portico: { columns: 4, width: 6.4, depth: 2.6, steps: 3, pediment: true, tag: 'D T5 portico with triangular pediment, three steps; 4 Ionic columns (tetrastyle), width and depth N' },
        colonnade: {
          length: 3.5,
          width: 5.0,
          columns_per_side: 2,
          floor_h: 348.8,
          eaves_h: 354.8,
          to: 'KB-B06',
          tag: 'D T1 p. 375 / p. 381 "Kolonnade der Galerie im Garten" (existence); position between the gallery end and the Tempelzimmer I - R12 order differs ("Tempelzimmer (Granitsaal) - Kolonnade - Rotunde": colonnade beyond the Tempelzimmer, see the KB-B07 alternative; KB-I54); length (3.5 m) and form I; floor = gallery 348.8, entablature at the gallery eaves 354.8 I',
        },
        tag: 'D T5 (round temple room, Ionic pilasters, glass doors, Ionic rotunda with pedimented portico, three steps), T1 p. 375, R12; diameter, bay count and proportions N (Vignola Ionic); research/10 §b.1 KB-B07',
      },
    };
    b.interior = 'none';
    b.rooms = [
      {
        id: 'B07.1.tempelzimmer',
        name_de: 'Tempelzimmer (Granitsaal)',
        function: 'round temple room: Ionic pilasters, glass doors; from 1789 marble and granite imitated in paper with columns and figures, two upholstered benches, mirror doors',
        storey: 1,
        polygon: Array.from({ length: 24 }, (_, i): [number, number] => [Math.round(4.8 * Math.cos((i / 24) * 2 * Math.PI) * 1000) / 1000, Math.round(4.8 * Math.sin((i / 24) * 2 * Math.PI) * 1000) / 1000]),
        floor_h: 349.7,
        ceiling_h: 356.3,
        finish: { floor: 'stone.marble', walls: 'stone.marble', ceiling: 'ceiling.stucco' },
        tag: 'D T5 (T7 no. 2) name, finish from 1789 (paper marble and granite #E8E2D6 / #8D8580 N hues, research/10 §c.2); R12 OG 16 "Tempelzimmer (Granitsaal)"; built by exterior/rotunda.ts at LOD2',
      },
    ];
    b.confidence = 'med';
    b.placement = 'map';
    b.priority = 4;
    addSources(b, SRC.lp06, SRC.hms08, SRC.mannlich, SRC.schwan2012, SRC.schneiderWeb);
    b.notes =
      'KB-I24: form D (T5, T7, R12): a round Ionic temple room with a pedimented portico at the garden end of the gallery, reached through a colonnade; diameter 10.5 m N (HMS ≈ 12 m), centre on the gallery line, outer face 96.9 m from the Sammlungsflügel (the "cent pas" ≈ 97 m, Schwan 2012 n. 47) [D-> length]. Confidence med: form documented, size and exact position I/N. v2 (P11) had the LP06 square pavilion here (now an alternative).';
    b.alternatives = [
      'LP06 6 (P11): square end pavilion ≈ 10 x 12 m with a pavilion roof at u 62-72, v 92-104 (drawn ≈ 382284/5466230, placed 9 m W because the LP06 gallery is drawn ~10 % long) [D-> LP06 topology; form superseded by T5]',
      'HMS 2022: domed rotunda D ≈ 12 m ("Bildergalerie mit anschließender Rotunde")',
      '81 m reading of "cent pas" (2½ pieds per pas): the rotunda ends ≈ 81 m from the Sammlungsflügel (u ≈ 60) [D->]',
      'floor at the gallery level 348.8 with the 1789 garden ≈ 0.9 m lower than today in front of the portico, and no steps in the colonnade [U]',
      'R12 / T1 order (fix wave 4): Tempelzimmer at the gallery end (round, glazed, Ionic pilasters, pedimented portico, T5), the colonnade beyond it, and an open peristyle Rotunde as a separate garden element closing the colonnade (T1 p. 375 "eine offene, durch eine Kolonnade abgeschlossene Rotunde") [D R12/T1 order; I form and position]; open question for Schwan 2012 figures / the T7 inventory order (KB-I54)',
    ];
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
          turret: { kind: 'dachreiter', height: 3.7, fachwerk: true, tag: 'HMS octagonal Dachreiter, top ≈361.5; KB-I21: rendered timber frame I (research/09 §6.5 C1)' },
          tag: 'HMS centre risalit with Dachreiter',
        },
      ],
    };
    b.facade = {
      ...PALACE_FACADE_BASE,
      dressings: 'members in grey-painted render over the red Buntsandstein dressings; exposed red sandstone only in the high basement (plinth) and at the portals',
      members_colour: '#B9B8B2',
      axes: 25,
      axis_spacing: 3.35,
      windows: 'floor-length (portes-fenêtres) on the parterre (E) side and the ends on the Saalgeschoss; sill windows on the upper tier of every front; two window tiers above the high basement on the W',
      portal: '3-axis pedimented centre risalit on both fronts (HMS W front; I parterre side); basement door on the W bench',
      axis_tags: '25 ± 1 axes HMS at 3.4 -> 3.35 on the 84 m LiDAR length',
      // KB-I28: "meterhohen, weiß gestrichenen Fenstern und Toren" [D T5]; hue N (grammar ORANGERIE_JOINERY)
      joinery_colour: '#F2F0EA',
      // KB-I28 + wave-6 review fix (one rule for every front and storey, Decisions log): no louvred shutters on the
      // Orangerie at all. T5 names only the white-painted windows and doors, an orangery hall wants the full low winter
      // sun, the HMS reading shows none on the lower tier, and the wings KB-B11/B12/B12a have none [I]; a louvred upper
      // tier over an unshuttered hall tier read as a three-storey barracks from the pond side
      shutters: 'none (white-painted windows and doors only, D T5; no louvres on any front or storey I)',
      shutter_type: 'none',
      tags: '"hell verputzt" D (skb; T21) and white-painted windows and doors D T5 (joinery #F2F0EA N, KB-I28; no louvred shutters on any front or storey I, wave-6 review); three wings D; axes HMS; members grey painted render #B9B8B2 I (KB-I15, history-check E4 answered: today\'s ruin shows bare red sandstone because the render is lost; the 1789 building was rendered, research/09 §2.5, research/10 §b.2); sills and window surrounds member grey, never plinth red; high basement red ashlar = plinth #A65E4A',
    };
    b.interior = 'detailed';
    addSources(b, SRC.hms08, SRC.pv);
    b.notes =
      'Standing ruin. base_h = lower bench 335.3 (W); hall floor = parterre 340.8. v2: HMS shows two window tiers above the basement and eaves 16 m above the W foot (research/08 §4) -> Saalgeschoss + upper tier; the central Pfeilersaal is double height, the end bays carry courtiers\' rooms (PV 1791 b.). Plan 84 x 10 m (LiDAR = HMS 85.5 x 10).';
    b.alternatives = ['v1: one 7.0 m Saal, eaves 347.8, 21 axes at 3.9', 'one double-height Saal over the full length (11.2 m) - HMS [U]'];
  },
  'KB-B11': (b, ctx) => {
    b.name_de = 'Orangerie, Nordflügel';
    b.footprint = extendRect(b.footprint!, ctx.b10c, 39.0);
    b.roof = pitched('hip', 12.0, 348.4, 40, 'slate', 'slate', 'N');
    b.facade = { ...b.facade, axes: 9, axis_spacing: 3.9, joinery_colour: '#F2F0EA', tags: 'white-painted windows and doors D T5 (#F2F0EA N, KB-I28)' };
    b.placement = 'map+lidar';
    // KB-I28: the gunsmith's and clockmaker's workshops "im Erdgeschoss eines Seitenflügels" [D Schwan 2010 p. 317 via
    // T5]; drawn in this (N) wing because the S wing carries the Komödienhaus [I] (interior programme ORANGERIE_NORD)
    b.function = 'orangery side wing (plant hall); the court gunsmith\'s and clockmaker\'s workshops in its ground floor [D existence Schwan 2010 p. 317 via T5; this wing I]';
    b.interior = 'detailed';
    addSources(b, SRC.lp06, SRC.hms08, SRC.schwan2012);
    b.notes = 'v2 (P12): LP06 7 N arm ≈45 m from the W front; HMS projects 35 ± 3 m beyond the main wing, 13 m deep (research/08 §4) -> 39 m long (v1 rectangle extended E), v1 depth 12 m kept (HMS 13). KB-I02: the Komödienhaus (1783) was attached to the SOUTH wing KB-B12, not here (D T5 Schwan 2012: "An den südlichen Seitenflügel baute man ab 1783 ein kleines Komödienhaus mit Logen an"; research/10 §b.2). Gunsmith\'s and clockmaker\'s workshops in the EG of one side wing D (Schwan 2010 p. 317 via T5); which wing U - KB-I28 draws them at the W (court) end of this wing, next to the main range, because the S wing carries the Komödienhaus [I].';
    b.alternatives = ['v2 name "Orangerie, Nordflügel (Komödienhaus/Theatersaal 1783?)": theatre here [U], superseded by T5 (south wing)'];
  },
  'KB-B12': (b, ctx) => {
    b.name_de = 'Orangerie, Südflügel mit Komödienhaus (ab 1783)';
    b.function = 'orangery side wing; a small Komödienhaus with boxes was built onto it from 1783, fitted with older panelling from the palace; stage and parterre could be raised to one level by large floor screws for dancing (D T5; research/10 §b.2)';
    b.footprint = extendRect(b.footprint!, ctx.b10c, 58.5);
    b.roof = pitched('hip', 12.0, 348.4, 40, 'slate', 'slate', 'N');
    b.facade = { ...b.facade, axes: 15, axis_spacing: 3.9, joinery_colour: '#F2F0EA', tags: 'white-painted windows and doors D T5 (#F2F0EA N, KB-I28)' };
    b.placement = 'map+lidar';
    addSources(b, SRC.lp06, SRC.schwan2012);
    b.notes = 'KB-I02: the Komödienhaus is an annex ("angebaut") of this wing [D T5]; KB-I28 draws it as a separate attached volume on the S face (KB-B12a, hypothetical) [I form]. v2 (P13): LP06 7 S arm runs from the main range E to the V-shaped scarp corner of KB-33 (≈382315/5465940) -> v1 rectangle extended E to 58.5 x 12 m (LP06 70-75 m drawn incl. the main range).';
  },
  'KB-B13': (b) => {
    b.name_de = 'Rotunde / Rundbau an der Orangerie (1785)';
    b.priority = 6;
    addSources(b, SRC.lp06, SRC.mannlich, SRC.schwan2012, SRC.schneiderWeb);
    // KB-I03: an ephemeral fair building of December 1785, not part of the summer-1789 state
    b.epoch = { from: 1785, to: 1785 };
    b.epoch_tag =
      'D: T1 Mannlich 1910 pp. 386 f. (Venetian fair Dec 1785: "ein einziges ungeheures Gebäude aus Holz und bemalter Leinwand" in the Orangerie court); T6 Schneider (built of timber "ausschließlich für die Veranstaltungen … und danach wieder abgetragen"); T5 "ephemerer Festbau" (research/10 §0.3, §b.2)';
    b.notes =
      (b.notes ?? '') +
      ' v2 (P14): NOT drawn in LP06 (no rotunda in the Orangerie court); K05 too coarse. KB-I03: temporary timber-and-canvas fair rotunda of Dec 1785, then taken down [D T1, T5, T6] -> epoch 1785 only; hidden in the 1789 scene, kept for a later "Dezember 1785" scene (KB-I48). The LiDAR rings KB-34 may be its footprint or a later stone start [I/U].';
  },
  'KB-B14': (b) => {
    b.name_de = 'Orangerie-Stützmauer (Terrassenmauer West)';
    b.facade = { ...b.facade, tags: 'D standing wall, measured in the LiDAR (KB-30: top 340.8, foot 335.1, research/03); material red Buntsandstein D (ruin); coping N' };
    b.notes = (b.notes ?? '') + ' KB-I02: evidence tag added (D standing ruin, LiDAR KB-30).';
  },
  'KB-B20': (b) => {
    b.name_de = 'Marstall, Westbau';
    b.footprint = axisRect([382190.0, 5466462.5], 1.2, 165, 12);
    b.facade = { ...b.facade, axes: 45, axis_spacing: 3.6 };
    b.confidence = 'med';
    b.placement = 'map+lidar';
    b.lidar_ids = ['KB-20 (W edge)'];
    b.function = 'ducal stables ("einen Stall für tausend Pferde und eine ungeheure Reitbahn": D Mannlich, as commission, T1 p. 365; capacity unverified), tack rooms, grooms';
    addSources(b, SRC.lp06, SRC.k05, SRC.pv, SRC.mannlich);
    b.notes =
      'v2 (P16): W range of the two-court Marstall block (LP06 12, north fit ±7 m; K05 1805 two-court block on KB-20; PV h. "Les écuries avec leurs apartemens des palfreniers et manège") -> N 5466380-5466545 (165 m). LP06 draws 3 projections on its W face (risalits, positions U). "Stall für tausend Pferde": D (Mannlich, as commission; T1 p. 365; research/10 §b.3; C11 reworded by KB-I02, was "legend"). Molitor / Knigge give 1,500 horses; capacity unverified.';
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
    b.name_de = 'Hundezwinger';
    b.cls = 'GARD';
    b.function = 'kennel for the ducal hunting pack ("ein Zwinger für tausend Hunde", Mannlich 1910 p. 365) [D]: walled yard with a central house (LP06 15 "Zwinger", K05 square), next to the Jägerhaus KB-B24, whose court held a bakery and butchery for the pack (T1 intro after Molitor)';
    const yard = minRect(lp06.get('15')!.rings[1]);
    b.footprint = axisRect([382216.5, 5466571.3], 91.2, Math.min(67, yard.length), Math.min(45, yard.width));
    b.storeys = [st('Hofmauer', 2.5, 'wall', 'D-> Tschifflik wall 2.5 m; N')];
    b.roof = { type: 'none', cover: 'none' };
    b.facade = { material: 'lime-washed render on rubble, sandstone coping', colour: '#E8DFC8', content: 'walled yard; central Zwingerhaus = KB-B35' };
    b.confidence = 'med';
    b.placement = 'map';
    addSources(b, SRC.lp06, SRC.k05, SRC.mannlich);
    b.notes = 'v2 (P20): LP06 15 walled yard ≈68 x 48 m drawn at 382215/5466572 (K05 shows the square too); trimmed to 67 x 45 m so it clears the Jägerhaus. KB-I02: use D (T1 p. 365, research/10 §b.3), closes C6 / 01 Q7; confidence med = existence and use D, geometry LP06 + N.';
    b.alternatives = ['v2 name "Zwinger (Hundezwinger?)" with kennel function I (C6 ambiguity), superseded by T1 p. 365'];
  },
  'KB-B24': (b, { lp06 }) => {
    b.name_de = 'Jägerhaus, später Kaserne der Jäger und Scharfschützen';
    b.footprint = minRect(lp06.get('16')!.rings[0]).ring;
    b.facade = {
      ...b.facade,
      axes: 17,
      axis_spacing: 3.6,
      // KB-I21: a rendered timber-frame upper storey on a masonry ground floor, the usual service-range build-up [I]
      fachwerk: { storeys: [2], tag: 'I rendered Fachwerk upper storey on a masonry ground floor (research/09 §2.3, G4, C1 "upper storeys of service ranges")' },
    };
    b.placement = 'map';
    addSources(b, SRC.lp06, SRC.pv, SRC.fachwerk);
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
    // KB-I32 (wave 8): the 1789 scene shows Schneider's reading, the square "Pavillon zu Carlsberg" (1779-83) with an E
    // apse (KB-B28a) over the cellar pit KB-50; Schwan's "Eiskeller" reading becomes the alternative [research/11 §1.2
    // Pavilion 2, G14, S5 2]. Footprint, heights, roof and openings are N/I; placement 'hypothetical', confidence low.
    b.name_de = 'Pavillon zu Carlsberg (Hypothese nach Schneider; alias: Eiskeller)';
    b.cls = 'PAV';
    b.function =
      'two-storey garden pavilion with an upper-floor salon (French chimneypiece, two mirrors) ~250 m behind the Küchenflügel in a circular clearing; square with an apse on the E side [D Schneider via research/11 §1.2 Pavilion 2]; here over the LiDAR cellar pit KB-50 [I, low]';
    b.built = '1779-83 (D Schneider)';
    b.confidence = 'low';
    b.placement = 'hypothetical';
    // square ≈ 10 × 10 m [research/11 S5 2: I] on the pit centre (LiDAR KB-50, 382508/5466296), sides on the grid axes [I]
    b.footprint = axisRect([382508, 5466296], 90, 10, 10);
    b.base_h = 355.6; // ring-bank level round the pit (ground_dtm median 355.61) [I]
    b.storeys = [st('Sockel', 0.5, 'plinth', 'N'), st('Erdgeschoss', 3.6, 'floor', 'N'), st('Obergeschoss (Salon)', 4.0, 'floor', 'D upper-floor salon (Schneider); height N')];
    b.roof = pitched('pavilion', 10, 355.6 + 8.1, 35, 'slate (U)', 'slate', 'N pavilion roof of a square garden pavilion; slate U');
    b.facade = {
      ...PALACE_FACADE_BASE,
      axis_spacing: 3.0,
      sides: {
        court: { axes: 3, spacing: 3.0, tag: 'N three axes per side' },
        garden: { axes: 3, spacing: 3.0, tag: 'N' },
        // wave 9 fix: on this footprint end_a is the E side (its p0 is the SE corner) and end_b the W side; before, the
        // entrance and three axes stood behind the apse and the W front was blind
        end_a: { axes: 0, blind: true, tag: 'I behind the E apse KB-B28a (end_a faces E)' },
        end_b: { axes: 3, spacing: 3.0, tag: 'N; end_b faces W' },
      },
      portals: [{ side: 'end_b', axis: 'centre', kind: 'door', steps: 2, tag: 'I entrance in the W side towards the palace' }],
      tags: 'N facade of a small Louis-seize garden pavilion (render, sandstone dressings, white joinery); I entrance in the W side towards the palace; E side behind the apse KB-B28a (D Schneider "apse on the E side")',
    };
    b.interior = 'none';
    addSources(b, SRC.schneiderWeb);
    b.notes =
      'LiDAR KB-50: collapsed pit D 10 m, 1.8 m deep, with a ring bank (research/03). KB-I02: identity contested. Schneider (Petri plan c. 1788, research/11 §1.2 Pavilion 2) places the "Pavillon zu Carlsberg" (1779-83; upper-floor salon) ~250 m behind the Küchenflügel near a cellar foundation that the Deutsche Grundkarte shows ~60 m from Petri\'s position, and rejects Schwan\'s "Eiskeller" reading [D Schneider]; that this pit is that cellar is I (low). KB-I32 (wave 8): drawn as that pavilion, 10 x 10 m, two storeys, pavilion roof, with the E apse KB-B28a [N/I].';
    b.alternatives = ['Eiskeller (Schwan; OSM point 38 m N): an earth-covered ice cellar whose vault collapsed into the pit KB-50 [D OSM name; I]', 'the pavilion ~60 m from the pit at Petri\'s position (plan not georeferenced) [D Schneider; U position]'];
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
    // KB-I29 (research/10 §b.4, history-check H12): 19 square, slate-roofed, separated houses on the ring [D T20]
    b.name_de = 'Amphitheater (Menagerie-Rund mit 19 schiefergedeckten Tierhäusern und Loge, „Bärenzwinger“)';
    b.function = 'menagerie ring around a moat with a square island (built like an antique amphitheatre, T1 p. 384; modelled on the Versailles menagerie, T5): 19 small square slate-roofed houses separated by grilles, facing the moat, and a loge';
    b.facade = {
      ...b.facade,
      material: 'rendered rubble houses with iron grille fronts; slate pyramid roofs (D T20); iron grilles between the yards (I)',
      content: '19 square, slate-roofed, separated houses (D T20) + 1 loge (I) on the ring of house centres r 24.8 m, facing the moat; radial grilles between the yards',
      menagerie: {
        kind: 'ring',
        ring: { centre: [382935, 5464913], radius: 24.8, houses: 19, loge_azimuth: 0, roof: 'pyramid', cover: 'slate', moat_radius: 22 },
        tag: 'D T20 "kreisförmige Anlage mit 19 quadratischen, schiefergedeckten, separierten Häuschen"; T1 p. 384 amphitheatre for quadrupeds and birds of prey. Ring radius I (inside the LiDAR ring KL-01 r 27 m, outside the moat r ≈ 22 m, TF-37 D LiDAR); house size, loge (on the N axis, highest ground) and yard grilles N/I (grammar MENAGERIE): each yard = house + two radial grilles to the water + a grille closing it behind (wave-6 review) I. No find-spot detail beyond T20; never the modern Cor-Ten consolidation',
      },
    };
    b.roof = { type: 'none', cover: 'none', note: 'each house has its own slate pyramid roof (facade.menagerie, D T20)' };
    b.alternatives = [...(b.alternatives ?? []), 'v2 reading "19 half-round cages (r ≈ 2.5 m) + loge" (cage form N), superseded by T20 square slate-roofed houses (KB-I29)'];
    addSources(b, SRC.lp06, SRC.t20, SRC.mannlich, SRC.schwan2012);
    b.notes = (b.notes ?? '') + ' v2 (P27): LP06 53 names the round moated KL-01 "Amphitheater" (D 45 m drawn); v1 UP-07 Amphitheater (garden theatre 1782) merged here [I].';
  },
  'KL-B41': (b) => {
    // KB-I29 (research/10 §b.4): foundations found in 2016 [D T20]; the superstructure stays U. Wave-6 review fix /
    // KB-I67: only what is documented is drawn by default: the 10 m square island (LiDAR) with a sandstone quay, the
    // foundations as a low course and the spiral stair; the superstructure is the separate hypothesis KL-B41a
    b.name_de = 'Insel im Amphitheater mit den Fundamenten des Inselpavillons und Wendeltreppe';
    b.function = 'square island in the middle of the menagerie moat; the foundations of a pavilion with a spiral stair were found on it in 2016 (D T20); the pavilion above them U (hypothesis KL-B41a)';
    b.cls = 'GARD';
    b.storeys = [st('Insel (Kaimauer)', 1.0, 'wall', 'I quay ≈ 0.8 m over the moat water')];
    b.roof = { type: 'none', cover: 'none', note: 'no superstructure by default (U); see KL-B41a (Aufbau Hypothese)' };
    b.facade = {
      ...b.facade,
      material: 'red Buntsandstein quay wall with a grey coping, gravel top (I); foundations as a low sandstone course and the spiral stair (D T20)',
      content: 'island 10 m square (D LiDAR KL-01) with a sandstone quay (I); pavilion foundations on the 8 x 8 m footprint and a spiral stair in one inner corner (D T20 existence; corner I)',
      menagerie: {
        kind: 'island',
        island: { size: 10, top_h: 299.5, stair: true },
        tag: 'D LiDAR KL-01 square island 10 m; D T20 foundations (2016) and spiral stair; quay wall, coping and top 299.5 (≈ 0.8 m over the moat water 298.7) I; no find-spot detail beyond T20',
      },
    };
    b.confidence = 'med';
    b.interior = 'none';
    addSources(b, SRC.t20);
    b.notes = 'Island 10 m square D (LiDAR); pavilion foundations found 2016 and a spiral stair D T20; the pavilion above them U. Wave-6 review / KB-I67: by default only the documented island, foundations and stair are drawn (cls GARD: drawn by facade.menagerie, no pad); the open light superstructure is the separate low-confidence hypothesis KL-B41a ("Aufbau Hypothese"), which the viewer\'s low-confidence select hides. KB-I29: no find-spot detail beyond T20.';
    b.alternatives = [...(b.alternatives ?? []), 'v2 (KB-I29): the generic square hip-roofed garden pavilion (rendered, arched windows) on the island, form N - superseded: the superstructure is U (T20 names only foundations and a spiral stair)'];
  },
  'KL-B42': (b) => {
    b.name_de = 'sog. Tschifflik-Pavillon (Ruine „Tschifflik“/„Kapelle“)';
    b.function = 'the ruin traditionally called "Tschifflik" (LP06 65 "sog. Tschifflik Pavillon"); the real 1779-80 Turkish pavilion stood on the terrace opposite the cascade (KL-B46)';
    addSources(b, SRC.lp06);
    b.notes = 'v2 (P29): LP06 65 = this ruin ("so-called"); LP06 61 places the Tschifflik on the KL-03 terrace axis, matching the 1950s note "on a terrace opposite the cascade" (05 a.5). KB-I02: the Schwan/Schindler map V23 (no. 25) shows only one Tschifflik, W of the cascade, nearer KL-B46 than this ruin [D-> V23 schematic; I, low] (research/10 §b.6).';
  },
  'KL-B43': (b) => {
    b.name_de = 'Menagerie (Herzogsterrassen mit Reihen von Tierhäusern)';
    // KB-I29 (research/10 §b.4): T1 p. 383 "Viele einstöckige Häuschen, durch Gitter voneinander getrennt, standen in
    // gerader Reihe", runs crossed by a broad watercourse under an "elf Fuß hohes Netz"; p. 413 iron grilles
    b.function = 'menagerie extension on terraces (Herzogsterrassen 1786, T20; V23 no. 29): straight rows of single-storey animal houses, heated from outside in winter, separated by iron grilles, with runs crossed by a broad watercourse under an ≈ 3.6 m net (D T1 pp. 383, 413)';
    b.facade = {
      ...b.facade,
      material: 'rendered houses with iron grille fronts (D T1 p. 413), slate gable roofs (I by analogy with the documented ring, T20; cover U); runs of trampled ground fenced with square iron bars under a cord net on posts (D T1 p. 383); broad watercourse with sandstone kerbs (D T1 "breiter Wasserlauf"; kerbs I); dry sandstone terrace walls on the ≈ 1 m LiDAR steps (D KL-02; wall I); in beech wood (D T1 p. 383, beeches TF-39 I)',
      menagerie: {
        kind: 'rows',
        // back lines of the rows on the LiDAR terrace banks (scripts/catalogue-v2/menagerie.ts)
        rows: MENAGERIE_ROWS.map((r) => ({ p0: r.p0, p1: r.p1, houses: r.houses })),
        front_azimuth: MENAGERIE_FRONT_AZ,
        run_depth: MENAGERIE_RUN_DEPTH,
        channel: MENAGERIE_CHANNEL.map((p) => [p[0], p[1]] as EN),
        tag: 'D T1 p. 383 (straight rows of single-storey houses separated by grilles, broad watercourse, "elf Fuß hohes Netz" ≈ 3.6 m D->), p. 413 (iron grilles); rows on the LiDAR terraces KL-02 I (one row per terrace, backed against the bank, fronts and runs downhill); 13 slots per row, house size, runs and channel line N/I (grammar MENAGERIE); wave-6 review: terrace walls on the ≈ 1 m steps (D KL-02 height, wall I), slate roofs (I by analogy with T20), seeded irregular spacing I, trampled ground in the runs I, beeches round and between the rows (TF-39, LC-17; D T1 "in Buchenwald")',
      },
    };
    addSources(b, SRC.lp06, SRC.t20, SRC.mannlich);
    b.notes = (b.notes ?? '') + ' v2 (P28): LP06 54 names this terraced parallelogram "Menagerie"; its 5 cross-strips at the S end = cage cells. KB-I29: rows of houses on the terraces replace the v2 terrace-wall massing (research/10 §b.4); no find-spot detail beyond T20.';
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

/** v1 unplaced entries that LP06 places, that are merged into other entries, or that are not on the Karlsberg site. */
export const REMOVED_V1: Record<string, string> = {
  // KB-I02 (research/10 §b.6): off the Karlsberg site; kept as notes in OPEN_QUESTIONS (pipeline.ts), not silently dropped
  'UP-11': 'off site: Schlösschen Monbijou is a separate estate ("Hofgut Monbijou", "Schloss Monbijou (mit Inventar von 1791)" listed apart in the 1797 damage inventory, BayHStA KA Serienakten 2001 = research/10 T8) [D/I]',
  'UP-12': 'off site: the "Kirchturm aus der Karlsbergzeit" is the tower of the Protestant parish church in Homburg town (Weber 1954, research/10 T26) [D]',
  'UP-01': 'KB-B49 Cavaliershaus (LP06 19)',
  'UP-02': 'KB-B43 Remisen (LP06 14)',
  'UP-03': 'KB-B26 Brauerei und Wirtshaus (LP06 22; PV l./q.)',
  'UP-04': 'KB-B41 Taubenhaus (LP06 8; PV c.)',
  'UP-07': 'KL-B40 Amphitheater (LP06 53) [I]',
  'UP-14': 'KB-B85 Fasanerie (LP06 51; PV 7.)',
  'UP-15': 'KB-B84 Carlsluster Torhaus (LP06 50)',
  'UP-16': 'KL-B48 Treillagenpavillon (LP06 63)',
  'UP-17': 'KB-B80 Hirschwürzloch (LP06 46)',
  // KB-I30 / KB-I36 (research/10 §b.3, §b.6): placed as zone hypotheses or merged
  'UP-05': 'KB-B90 Bienenhaus (zone hypothesis SE of the Orangerie, V23 no. 16) [D-> V23; I]',
  'UP-06': 'KB-B54 / KB-B56 Treibhäuser (Ananas, Kaffee, Papaya; research/10 §b.3) [I]',
  'UP-08': 'KL-B50 Chinesischer Pavillon (zone hypothesis S of the Schwanenweiher, V23 no. 31) [D-> V23; I]',
};

const UNPLACED_NOTES: Record<string, [string, string]> = {
  'UP-09': ['Lusthaus des Prinzen', 'candidates: Petri plan Pavilion 3, round, near today\'s Forst-Bauhof on the slope to the Hirschwürzloch, possibly the one-storey "Prinzenlusthaus" (round panelling, Krutthofen 1793) [D Schneider "denkbar"; research/11 §1.2, S16], placed hypothetically as KB-B88 (KB-I32); V23 no. 17 zone SE of the Orangerie [D-> V23 schematic]; LP06 Pavillons 31/35/52 (KB-B81..83) [U]'],
  'UP-10': ['Lustgarten der Herzogin', 'candidate: the terrace garden TF-08 S of the S wing (the Duchess\'s wing, LP06 legend 3; Le Clerc 1790 treillage) [I, low; research/11 §1.3, S16]. LP06 49 "Pavillon im Bereich des Herzogsgartens" has a label but no drawn building [U]'],
  'UP-11': ['Schlösschen Monbijou', 'candidates: LP06 Pavillons 31/35/52 [U]'],
  'UP-12': ['Kirchturm aus der Karlsbergzeit', 'not placed by any source here'],
  'UP-13': ['Ökonomiegebäude / „Le Petit Hameau“ / Fasanerie der Herzogin', 'candidate: Carlsdorf (Sanddorf) LP06 42 = PV 5. "le petit hameau hors du parc" (KB-B68..72) [I]'],
  'UP-18': ['Kapelle, Ballhaus, Apotheke', 'the Wache is now placed (Wachhäuser KB-B37/38 = PV t. "Grand corps de garde devant le Château"). Ballhaus = the Tanzsaal in the N wing KB-B03 (D T5) and/or the convertible Komödienhaus floor at KB-B12 [I; research/10 §b.6], so no separate building. Kapelle and Apotheke stay unplaced'],
};

/** Palace group (court buildings with the PALACE_FACADE_BASE palette): comparables behind the KB-I15 palette. */
const PALACE_GROUP = new Set(['KB-B01', 'KB-B02', 'KB-B03', 'KB-B04', 'KB-B05', 'KB-B06', 'KB-B07', 'KB-B10']);

/**
 * KB-I19 facade finish year (`facade.build_year`, research/09 §6.5 C2): the year the facade was finished, i.e. its
 * last limewash before 1789. Explicit rows for the dated palace group (fact sheet build dates: research/01 §1.2,
 * research/10 §b, Schwan 2012 = T5); every other building takes the last year 1770-1795 named in its `built` text.
 * The completion year stands for the facade age [I]: limewash was renewed when the work was done, not later.
 */
const BUILD_YEAR: Record<string, [number, string]> = {
  'KB-B01': [1782, 'D 01 §1.2 CdL refurbished/enlarged 1778-82 (core 1760/61); finish year = completion I'],
  'KB-B02': [1788, 'D T5 contracted 1782, long a carcass (Rohbau), c. 1785/89 (research/10 §b.1); finished late I'],
  'KB-B03': [1784, 'D 01 §1.2 N wing from 1779, (84?); finish year I'],
  'KB-B04': [1784, 'D T5 Sammlungsflügel built c. 1784 (research/10 §b.1)'],
  'KB-B05': [1784, 'D 01 §1.2 kitchen wing 1779/80-84'],
  'KB-B06': [1788, 'D T5 gallery from a wooden passage, order of March 1788 (research/10 §b.1)'],
  'KB-B07': [1789, 'D T5 with the gallery 1788; interior paper marble and granite from 1789 (research/10 §b.1)'],
  'KB-B10': [1780, 'D 01 §1.2 Orangerie conversion of the Schweizerei 1780'],
  'KB-B11': [1783, 'D 01 §1.2 Orangerie wings 1780-83'],
  'KB-B12': [1783, 'D T5 Komödienhaus at the S wing 1783 (research/10 §b.1)'],
};

/**
 * Last plausible building year named in a `built` text ("1778-85" -> 1785, "1779/80-84" -> 1784, "1778/79-86" ->
 * 1786), or undefined for undated texts ("U", "1780s", "before 1789 (LP06)").
 */
export function finishYear(built: string | undefined): number | undefined {
  if (!built || /before|\b1[78]\d0s\b/i.test(built)) return undefined;
  const years: number[] = [];
  let century: string | null = null;
  for (const t of built.match(/\d{2,4}/g) ?? []) {
    if (t.length === 4) {
      century = t.slice(0, 2);
      years.push(Number(t));
    } else if (t.length === 2 && century) years.push(Number(century + t));
  }
  const ok = years.filter((y) => y >= 1770 && y <= 1795);
  return ok.length ? Math.max(...ok) : undefined;
}

/** Set `facade.build_year` (+ tag) from BUILD_YEAR or the `built` text; leaves undated buildings alone. */
export function setBuildYear(b: Building): void {
  if (!b.facade) return;
  const row = BUILD_YEAR[b.id];
  if (row) {
    b.facade.build_year = row[0];
    b.facade.build_year_tag = row[1];
    return;
  }
  const y = finishYear(b.built);
  if (y === undefined) return;
  b.facade.build_year = y;
  b.facade.build_year_tag = `D-> catalogue built "${b.built}"; last named year = facade finish I`;
}

export function applyEdits(buildings: Building[], ctx: BuildCtx): Building[] {
  const out: Building[] = [];
  for (const b of buildings) {
    if (REMOVED_V1[b.id]) continue;
    const p = EDITS[b.id];
    if (p) p(b, ctx);
    if (b.placement !== 'unplaced') setBuildYear(b);
    if (PALACE_GROUP.has(b.id)) addSources(b, SRC.koblenz, SRC.herzogvorstadt, SRC.ndbHautt);
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
