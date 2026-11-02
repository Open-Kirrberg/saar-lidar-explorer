/**
 * Catalogue v2: the buildings newly placed from the georeferenced 2006 Lageplan (research/07 §2.6 / §3.2, N1-N28;
 * §3.1 P17/P19/P20/P23/P26), the unplaced ones, the Ehrenhof grille and the Carlsberger Hof ranges. Split out of
 * buildings.ts (edits of the v1 entries); same conflict rule and sources (`SRC`).
 */
import { dirEN } from '../../model/src/frame.ts';
import { centroid, openRing, type P2 } from '../../model/src/layout/geom.ts';
import type { Building, BuildingClass, Confidence, EN, Facade, Placement, RingEN, Roof, Storey } from '../../model/src/spec.ts';
import {
  COURT_SHUTTER,
  FARM_FACADE,
  FOLLY_FACADE,
  FOLLY_FACADE_BASE,
  PALACE_FACADE_BASE,
  SRC,
  STABLE_SHUTTER,
  axisRect,
  circleRing,
  mansard,
  pitched,
  setBuildYear,
  st,
  type BuildCtx,
} from './buildings.ts';
import { minRect, r2, ring, uvRect } from './common.ts';

type Template = 'svc2' | 'svc1' | 'farm' | 'pav' | 'guard' | 'glass' | 'stable' | 'yardhouse' | 'temple' | 'garden_round' | 'folly';

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
  /** KB-I03: years the building stood (to inclusive) + evidence. */
  epoch?: Building['epoch'];
  epoch_tag?: string;
  /** KB-I24: facade fields merged over the template facade (e.g. a blind side against an adjoining range). */
  facade?: Partial<Facade>;
  /** Wave-5 fix: roof fields merged over the template roof (e.g. KB-B87's double-stepped dome). */
  roof?: Partial<Roof>;
  /** KB-I28: storeys instead of the template's (e.g. the Komödienhaus hall). */
  storeys?: Storey[];
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
    case 'garden_round':
      // KB-I32: one-storey round garden pavilion (research/11 §1.2 Pavilions 1 and 3: "round", one storey) [D form; N heights]
      return [st('Sockel', 0.45, 'plinth', 'N'), st('Saal', 4.2, 'floor', 'N one-storey garden pavilion')];
    case 'glass':
      return [st('Sockel', 0.3, 'plinth', 'N'), st('Glashaus', 3.5, 'floor', 'N')];
    case 'folly':
      // KB-I39 / KB-I30: one open storey; exterior/folly.ts draws the folly from grammar FOLLY (heights N)
      return [st('Staffage (offen)', 3.5, 'floor', 'N folly height (grammar FOLLY)')];
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
    case 'garden_round':
      // KB-I32: Pavilion 1 had a "double-stepped dome" [D Schneider]; drawn as one raised dome (rise 0.42 D) [I]; cover U
      return { type: 'dome', eaves_h: eaves, dome_rise_ratio: 0.42, material: 'sheet lead (U)', cover: 'lead', tags: 'D Schneider "double-stepped dome" (Pavilion 1); single raised dome I; lead U' };
    case 'glass':
      // wave-5 fix: the lean-to (glazed S slope, tiled back strip) is drawn by facade.glasshouse; no separate roof
      return { type: 'none', eaves_h: eaves, material: 'glazed lean-to sloping S, tiled strip over the back (I)', cover: 'tile', tags: 'D Petri via Schneider "greenhouses facing due S"; lean-to form N (facade.glasshouse, GARDEN_DETAIL.glasshouse)' };
    case 'folly':
      // KB-I31 / KB-I39 / KB-I30: the folly builder draws its own roof (concave tent, cone, dome, lean-to, deck)
      return { type: 'none', eaves_h: eaves, material: 'drawn by facade.folly (grammar FOLLY, N)', cover: 'none', tags: 'N form (exterior/folly.ts)' };
  }
}

const NEW: NewSpec[] = [
  // ---- wave-6 review fix / KB-I67: the island pavilion's superstructure as a separate, switchable hypothesis
  {
    id: 'KL-B41a',
    name_de: 'Inselpavillon der Menagerie – Aufbau (Hypothese)',
    function:
      'pavilion on the island in the middle of the menagerie ring, above the foundations and the spiral stair found in 2016 (D T20); its form is unknown: drawn as an open light structure (painted timber posts, a beam, a slate pyramid roof like the ring houses) so the ensemble reads without inventing walls and windows [I, low]',
    built: 'before 1789 (U)',
    footprint: () => ring([
      [382931, 5464909],
      [382939, 5464909],
      [382939, 5464917],
      [382931, 5464917],
    ]),
    cls: 'GARD',
    template: 'pav',
    confidence: 'low',
    placement: 'hypothetical',
    priority: 6,
    dtmHint: 299.85,
    base: 299.85,
    notes:
      'Wave-6 review fix / KB-I67: the documented part (island, foundations, spiral stair) is KL-B41; this is only the superstructure, labelled "Aufbau Hypothese" and hidden with the viewer\'s low-confidence select. Open posts instead of a rendered house because T20 gives no walls, openings or roof [U]; slate by analogy with the 19 ring houses (T20) [I]; eaves 3.6 m over the foundation course N.',
    sources: [SRC.t20],
    alternatives: ['a closed rendered garden pavilion with arched windows and a hip roof (the v2 drawing) [U]', 'a two-storey belvedere served by the spiral stair (the stair suggests an upper floor or a roof terrace) [U]'],
    storeys: [st('Pavillon (offen, Hypothese)', 3.6, 'floor', 'N eaves 3.6 m over the foundation course; open structure I')],
    roof: pitched('pavilion', 8, 299.85 + 3.6, 35, 'slate (I by analogy with the ring houses; U)', 'slate', 'I by analogy with the T20 ring houses; superstructure U'),
    facade: {
      material: 'painted timber posts and beam (I), slate pyramid roof (I); superstructure U',
      menagerie: { kind: 'open_pavilion', tag: 'I, low: open light structure on the KL-B41 foundations (D T20); form U' },
    },
  },
  // ---- KB-I28: Komödienhaus built onto the Orangerie S wing from 1783 (research/10 §b.2; T5)
  {
    id: 'KB-B12a',
    name_de: 'Komödienhaus (Anbau am Südflügel der Orangerie, ab 1783)',
    function:
      'small court theatre with boxes, fitted with older panelling from the palace; stage and parterre could be raised to one level by large floor screws for dancing [D T5 Schwan 2012: "An den südlichen Seitenflügel baute man ab 1783 ein kleines Komödienhaus mit Logen an"; research/10 §b.2]',
    built: '1783 (D T5)',
    // against the W half of the KB-B12 S face (a 2-22 m from its W end), where the 1789 ground in front is level
    // (340.7-342.0 m); the E half runs onto the KB-33 scarp [I]
    footprint: () => axisRect([382276.43, 5465925.94], 77.68, 20, 11),
    cls: 'RANGE1',
    template: 'pav',
    confidence: 'low',
    placement: 'hypothetical',
    priority: 5,
    dtmHint: 341.2,
    base: 340.8,
    notes:
      'KB-I28: existence and attachment to the S wing D (T5 "angebaut"); form, size (20 x 11 m) and position along the wing I: a plain rendered hall with a hip roof under the eaves of the wing, five windows to the S, the entrance in the W end; inside (not modelled) boxes, a raised stage and the screw floor [D T5]. Joinery white as the Orangerie [D T5; hue N].',
    sources: [SRC.schwan2012, SRC.lp06],
    court_toward: 'KB-B12',
    alternatives: ['the E end of the S wing itself fitted out as the theatre (no separate volume) [I]', 'a larger annex on the S face, up to the scarp corner [U]'],
    storeys: [st('Sockel', 0.6, 'plinth', 'N'), st('Komödiensaal (Logen, Bühne, Schraubboden)', 6.4, 'floor', 'N one tall hall for stage, parterre and one tier of boxes; eaves under the wing eaves 348.4 I')],
    roof: { ...pitched('hip', 11, 340.8 + 7.0, 38, 'slate', 'slate', 'hip roof I, eaves 0.6 m under the wing eaves; slate as the Orangerie wings'), dormers: { lower: 'none', upper: 'none', tag: 'I a theatre hall needs no roof rooms' } },
    facade: {
      sides: {
        court: { axes: 0, blind: true, tag: 'I against the S wall of the Orangerie S wing KB-B12' },
        garden: { axes: 5, spacing: 3.6, tag: 'I five tall windows to the S' },
        end_a: { axes: 1, spacing: 3.6, tag: 'I' },
        end_b: { axes: 1, spacing: 3.6, tag: 'I' },
      },
      portals: [{ side: 'end_a', axis: 'centre', kind: 'door', tag: 'I entrance in the W end (end_a faces W)' }],
      joinery_colour: '#F2F0EA',
      shutter_type: 'none',
      tags: 'rendered like the Orangerie ("hell verputzt" D T21/skb), white joinery D T5 (#F2F0EA N); form I',
    },
  },
  // ---- KB-I24: Bibliothekspavillon off the gallery (research/10 §0.2, §b.1 KB-B06; history-check H04)
  {
    id: 'KB-B06a',
    name_de: 'Bibliothekspavillon an der Galerie (Kunstbibliothek)',
    function:
      'small rich pavilion with the art library, entered from the middle of the picture gallery through a glass door; it also held "lieux à l\'Angloise" (a water closet, Bender/Kleber p. 259 via research/10) [D T1, T5 existence; position along the hall, side and size I/U]',
    built: '1788-89 (with the gallery) U',
    footprint: ({ grid }) => uvRect(grid, 1.7, 8.2, 102.0, 107.5),
    cls: 'PAV',
    template: 'pav',
    confidence: 'low',
    placement: 'hypothetical',
    priority: 6,
    dtmHint: 347.3,
    base: 348.3,
    notes:
      'KB-I24: existence D (T1, T5: "from the middle" of the gallery through a glass door). Side I: the N (garden) side, because at mid-length the S side is the Küchenhof 4 m below (the gallery stands on a substructure there) and the kitchen wing; the research preferred the S side only because the N wall is the hanging wall (research/10 §b.1). Along the hall I: at grid axis 14 (u 1.7-8.2, ≈ 15 m W of the hall middle) so that it stays clear of the walled Holländische Gärtnerei KB-B27, whose S wall runs diagonally N of the gallery. Size 6.5 x 5.5 m N (research: ≈ 8 x 8 m N). Floor = gallery floor 348.8 (plinth 0.5) I.',
    sources: [SRC.mannlich, SRC.schwan2012],
    alternatives: [
      'S (garden) side on the plateau E of the Küchenbau (u ≈ 42-50), where the gallery stands at grade (research/10 §b.1 preference; ≈ 25 m E of the hall middle) [I]',
      'exactly at mid-length on the N side, 8 x 8 m (would cross the Holländische Gärtnerei wall KB-B27) [N size]',
    ],
    facade: {
      sides: {
        court: { axes: 0, blind: true, tag: 'I against the gallery N wall (glass door from the gallery)' },
        garden: { axes: 2, spacing: 2.6, tag: 'N two windows to the garden' },
        end_a: { axes: 1, spacing: 2.6, tag: 'N' },
        end_b: { axes: 1, spacing: 2.6, tag: 'N' },
      },
      shutters: 'louvred Jalousieläden, blue-grey #5F6F7A',
      tags: 'palace palette as the gallery (KB-I15) I; form N',
    },
  },
  // ---- Marstall parts (P17, P19) and Zwinger house (P20), Brauerei W wing (P23)
  { id: 'KB-B31', name_de: 'Marstall, Ostbau (Südteil)', function: 'stables / grooms\' lodgings (PV h.)', built: '1778-85', footprint: () => axisRect([382240.5, 5466397.5], 1.2, 47, 12), cls: 'STABLE', template: 'stable', confidence: 'low', placement: 'map', priority: 5, dtmHint: 344.1, base: 344.1, notes: 'P17: S part of the LP06 12 E range (S of the Reithalle), north fit ±7 m.', sources: [SRC.lp06, SRC.k05], axes: 13 },
  { id: 'KB-B32', name_de: 'Marstall, Nordflügel', function: 'N closing range of the Marstall courts', built: '1778-85', footprint: () => axisRect([382217.1, 5466539.0], 91.2, 39.0, 12), cls: 'STABLE', template: 'stable', confidence: 'low', placement: 'map', priority: 5, dtmHint: 344.1, base: 344.1, notes: 'P19: LP06 12 N closing range between the W and E ranges.', sources: [SRC.lp06, SRC.k05], axes: 10 },
  { id: 'KB-B33', name_de: 'Marstall, Querbau (Mitte)', function: 'E-W cross range dividing the Marstall courts; gate passage in the middle (gap in LP06)', built: '1778-85', footprint: () => axisRect([382216.15, 5466494.0], 91.2, 38.95, 11), cls: 'STABLE', template: 'stable', confidence: 'low', placement: 'map', priority: 6, dtmHint: 344.1, base: 344.1, notes: 'P19: LP06 12 draws E-W stubs from both ranges at N ≈5466488-5466500 with a gap between them -> cross range with a central passage [I].', sources: [SRC.lp06], axes: 10 },
  { id: 'KB-B34', name_de: 'Marstall, Querbau (Süd)', function: 'E-W cross range at the S end of the Marstall courts', built: '1778-85', footprint: () => axisRect([382214.7, 5466405.0], 91.2, 39.8, 11), cls: 'STABLE', template: 'stable', confidence: 'low', placement: 'map', priority: 6, dtmHint: 344.1, base: 344.1, notes: 'P19: LP06 12 E-W stubs at N ≈5466398-5466411 [I].', sources: [SRC.lp06], axes: 10 },
  { id: 'KB-B35', name_de: 'Zwingerhaus', function: 'house in the middle of the Zwinger yard (kennel / keeper I)', built: '1780-83 (?)', lp06: ['15', 0], cls: 'FARM', template: 'yardhouse', confidence: 'low', placement: 'map', priority: 6, dtmHint: 343.8, notes: 'P20: LP06 15 central house (≈13 x 7 m drawn); HMS walled square with a central house.', sources: [SRC.lp06, SRC.k05] },
  { id: 'KB-B36', name_de: 'Brauerei und Wirtshaus, Westflügel', function: 'side wing of the brewery/inn (stables of the hôtellerie, PV l. I)', built: '1778-82', footprint: () => axisRect([382239.8, 5466765.85], 1.2, 14.3, 9.0), cls: 'WING2', template: 'svc2', confidence: 'low', placement: 'map', priority: 6, dtmHint: 344.5, notes: 'P23: W leg of the LP06 22 L-shape.', sources: [SRC.lp06, SRC.pv] },
  // ---- Ehrenhof (N1, N2)
  { id: 'KB-B37', name_de: 'Wachhaus Süd (an der Ehrenhofmündung)', function: 'guard house (PV t. "Grand corps de garde devant le Château"; LC: guard pavilion with a tetrastyle portico)', built: '1780s U', lp06: ['28', 0], cls: 'PAV', template: 'guard', confidence: 'med', placement: 'map', priority: 4, dtmHint: 342.0, notes: 'N1: LP06 28 "Wachhäuser", two small houses ≈7 x 8 m flanking the court mouth (core fit ±6 m); LC 1790 shows two small buildings in front of the court.', sources: [SRC.lp06, SRC.lc, SRC.pv, SRC.fachwerk], facade: { fachwerk: { tag: 'I small guard house in rendered Fachwerk (research/09 §2.3, G4, C1 "Wachhäuser"): 0.30 m wall, shallow reveals' } } },
  { id: 'KB-B38', name_de: 'Wachhaus Nord (an der Ehrenhofmündung)', function: 'guard house (PV t.; LC)', built: '1780s U', lp06: ['28', 1], cls: 'PAV', template: 'guard', confidence: 'med', placement: 'map', priority: 4, dtmHint: 342.0, notes: 'N1: LP06 28, northern house.', sources: [SRC.lp06, SRC.lc, SRC.pv, SRC.fachwerk], facade: { fachwerk: { tag: 'I small guard house in rendered Fachwerk (research/09 §2.3, G4, C1 "Wachhäuser"): 0.30 m wall, shallow reveals' } } },
  { id: 'KB-B40', name_de: 'Waffenschmiede', function: 'armourers\' house (PV f. "Maison des armuriers")', built: 'U', footprint: ({ lp06 }) => shift(minRect(lp06.get('10')!.rings[0]).ring, ...gridShift(0, 1.0)), cls: 'FARM', template: 'svc2', confidence: 'low', placement: 'map', priority: 5, dtmHint: 344.7, notes: 'N3: LP06 10 (17 x 10 m, north fit ±7 m), shifted 1 m N to clear the gallery.', sources: [SRC.lp06, SRC.pv, SRC.fachwerk], facade: { fachwerk: { storeys: [2], tag: 'I rendered Fachwerk upper storey on a masonry ground floor (research/09 §2.3, G4, C1 "upper storeys of service ranges")' } } },
  { id: 'KB-B41', name_de: 'Taubenhaus mit Wohnungen', function: 'dovecote with lodgings on both sides (PV c. "Colombier avec ses logemens de part et d\'autre"); v1 UP-04', built: '1779-82', lp06: ['8', 0], cls: 'RANGE1', template: 'svc2', confidence: 'low', placement: 'map', priority: 5, dtmHint: 341.0, notes: 'N4: LP06 8 (57 x 10 m, core fit ±6 m) S of the Orangerie; central dovecote tower (PV c.) not modelled separately [U].', sources: [SRC.lp06, SRC.pv, SRC.fachwerk], axes: 15, facade: { fachwerk: { storeys: [2], tag: 'I rendered Fachwerk upper storey on a masonry ground floor (research/09 §2.3, G4, C1 "upper storeys of service ranges")' } } },
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
  { id: 'KB-B54', name_de: 'Treibhaus in der Holländischen Gärtnerei (Ost; Ananas, Kaffee, Papaya)', function: 'lean-to forcing house facing S (D Petri: two greenhouses facing due S; I which LP06 building); KB-I30: absorbs v1 UP-06 Ananashaus: Treibhäuser from 1781 for citrus, flowers, vegetables, figs, peaches, coffee, papaya, pineapple and melons (D T5 Schwan 2012), losses in the Treibhäuser in the 1793 damage list (D T7 nos. 16-20), Molitor\'s "Warmhaus" (D T1 intro) (research/10 §b.3); which crop in which house I', lp06: ['11', 0], cls: 'FARM', template: 'glass', confidence: 'low', placement: 'map', priority: 7, dtmHint: 347.6, notes: 'N14: LP06 11 small building in the garden (Treibhaus? I). Wave-5 fix (research/11 §1.2, G12, S11): how many glasshouses? LP06 11 draws three small buildings in a row [D]; Petri c. 1788 shows two greenhouses facing due S with a central passage [D Schneider]; PV g. names "la serre chaude ... avec son logement" [D]. Read here as two lean-to forcing houses (E KB-B54, W KB-B56) with the gardener\'s lodging and passage KB-B55 between them [I, low]. Lean-to form (solid N back wall, glazing sloped to the S, tiled strip over the back) N, sizes I.', sources: [SRC.lp06, SRC.pv, SRC.schneiderWeb, SRC.schwan2012, SRC.mannlich] },
  { id: 'KB-B55', name_de: 'Gärtnerwohnung mit Durchgang zwischen den Treibhäusern (Logement?)', function: 'gardener\'s lodging and central passage between the two forcing houses (I, low: PV g. "la serre chaude ... avec son logement" D; Petri "central passage" D)', lp06: ['11', 1], cls: 'FARM', template: 'svc1', confidence: 'low', placement: 'map', priority: 7, dtmHint: 347.6, notes: 'N14: LP06 11. Wave-5 fix (research/11 §1.2, G12, S11): how many glasshouses? LP06 11 draws three small buildings in a row [D]; Petri c. 1788 shows two greenhouses facing due S with a central passage [D Schneider]; PV g. names "la serre chaude ... avec son logement" [D]. Read here as two lean-to forcing houses (E KB-B54, W KB-B56) with the gardener\'s lodging and passage KB-B55 between them [I, low]. Lean-to form (solid N back wall, glazing sloped to the S, tiled strip over the back) N, sizes I. v2 had it as a third Treibhaus.', sources: [SRC.lp06, SRC.pv, SRC.schneiderWeb], alternatives: ['a third forcing house (LP06 draws three buildings alike) [I]'] },
  { id: 'KB-B56', name_de: 'Treibhaus in der Holländischen Gärtnerei (West; Feigen, Pfirsiche, Melonen)', function: 'lean-to forcing house facing S (D Petri: two greenhouses facing due S; I which LP06 building); KB-I30: with KB-B54 the Treibhäuser of T5 (figs, peaches, coffee, papaya, pineapple, melons D; research/10 §b.3) and v1 UP-06; which crop in which house I', lp06: ['11', 2], cls: 'FARM', template: 'glass', confidence: 'low', placement: 'map', priority: 7, dtmHint: 347.6, notes: 'N14: LP06 11 (W of the road). Wave-5 fix (research/11 §1.2, G12, S11): how many glasshouses? LP06 11 draws three small buildings in a row [D]; Petri c. 1788 shows two greenhouses facing due S with a central passage [D Schneider]; PV g. names "la serre chaude ... avec son logement" [D]. Read here as two lean-to forcing houses (E KB-B54, W KB-B56) with the gardener\'s lodging and passage KB-B55 between them [I, low]. Lean-to form (solid N back wall, glazing sloped to the S, tiled strip over the back) N, sizes I.', sources: [SRC.lp06, SRC.schneiderWeb, SRC.schwan2012] },
  ...['a', 'b', 'c'].map(
    (k, i): NewSpec => ({ id: `KB-B57${k}`, name_de: `Schäferei (LP06 25, Bau ${i + 1})`, function: 'sheep farm (PV 4. "La nouvelle bergerie" ? I)', lp06: ['25', i], cls: 'FARM', template: 'farm', confidence: 'low', placement: 'map', priority: 7, dtmHint: 316, notes: 'N15: LP06 25 (global fit ±15 m).', sources: [SRC.lp06] }),
  ),
  ...['a', 'b'].map((k, i): NewSpec => ({ id: `KB-B60${k}`, name_de: `Schäferei (LP06 26, Bau ${i + 1})`, function: 'sheep farm', lp06: ['26', i], cls: 'FARM', template: 'farm', confidence: 'low', placement: 'map', priority: 7, dtmHint: 311, notes: 'N15: LP06 26 (global fit ±15 m).', sources: [SRC.lp06] })),
  { id: 'KB-B62', name_de: 'Landwirtschaftlich genutztes Gebäude (LP06 27)', function: 'farm building', lp06: ['27', 0], cls: 'FARM', template: 'farm', confidence: 'low', placement: 'map', priority: 7, dtmHint: 309, notes: 'N15: LP06 27 (global fit ±15 m).', sources: [SRC.lp06] },
  { id: 'KB-B63', name_de: 'Wachhaus am Taleingang (Nord)', function: 'guard house at the park entrance (PV 1. "Les deux petites maisons en entrant au parc pour le corps de garde et la barrière")', lp06: ['37', 0], cls: 'PAV', template: 'guard', confidence: 'low', placement: 'map', priority: 6, dtmHint: 257.6, notes: 'N16: LP06 37 (global fit ±15 m).', sources: [SRC.lp06, SRC.pv, SRC.fachwerk], facade: { fachwerk: { tag: 'I small guard house in rendered Fachwerk (research/09 §2.3, G4, C1 "Wachhäuser"): 0.30 m wall, shallow reveals' } } },
  { id: 'KB-B64', name_de: 'Wachhaus am Taleingang (Süd)', function: 'guard house at the park entrance (PV 1.)', lp06: ['37', 1], cls: 'PAV', template: 'guard', confidence: 'low', placement: 'map', priority: 6, dtmHint: 257.6, notes: 'N16: LP06 37.', sources: [SRC.lp06, SRC.pv, SRC.fachwerk], facade: { fachwerk: { tag: 'I small guard house in rendered Fachwerk (research/09 §2.3, G4, C1 "Wachhäuser"): 0.30 m wall, shallow reveals' } } },
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
  // ---- KB-I32: garden pavilions behind the palace from the Petri plan c. 1788 (research/11 §1.2, G8, S5). Positions are
  // read off Schneider's description of the unreferenced plan (±20-30 m), so placement 'hypothetical', confidence low.
  // Pavilion 2 (Pavillon zu Carlsberg) is KB-B28, Pavilion 4 the Brunnenhaus KB-B80; the octagon point de vue at the E
  // end of a path from the Marstall is not located closely enough to place [U] (open, see the backlog).
  {
    id: 'KB-B87',
    name_de: 'Rundpavillon mit gestufter Kuppel (Herzogsgarten, später „Eremitage“)',
    function: 'round garden pavilion with a double-stepped dome near the Corps de logis, built 1785/86 in the area then called "Wald"; moved to the Karlslust in 1792 and only then called the "Eremitage" (its round foundations there are exposed) [D Schneider via research/11 §1.2, §0 item 3]',
    built: '1785/86 (D Schneider); moved 1792',
    footprint: ({ grid }) => circleRing(grid.toEN(70.0, -56.0), 9.0, 32),
    cls: 'PAV',
    template: 'garden_round',
    confidence: 'low',
    placement: 'hypothetical',
    priority: 7,
    dtmHint: 347.5,
    // wave-5 fix: the double-stepped dome [D Schneider form] as two set-back tiers with a drum-head cornice and a lantern
    // [N; I proportions, GARDEN_DETAIL.steppedDome]
    roof: { dome_tiers: 2, tags: 'D Schneider "double-stepped dome" (Pavilion 1, research/11 §1.2); drawn as two set-back tiers with a cornice and a small lantern N, proportions I (GARDEN_DETAIL.steppedDome); lead U' },
    // the entrance faces the belt walk HG-02, reached by the spur walk HG-06 [I]
    court_toward: 'HG-02',
    epoch: { from: 1785, to: 1791 },
    epoch_tag: 'D built 1785/86, moved to the Karlslust in 1792 (Schneider via research/11 §1.2); to 1791 inclusive I',
    notes:
      'KB-I32 (research/11 S5 1): Petri plan Pavilion 1, "a pink circle SE of the CdL, just S of the S-wing line" [D plan via Schneider; reading I]; here at palace grid u 70, v -56 (±20 m) at the edge of the Herzogsgarten lawn, E of the terrace garden TF-08. D 9 m and one storey N/I (research/11 S5: D ≈ 8-10 m). Wave-5 fix: the double-stepped dome (two set-back tiers, drum-head cornice, lantern; form D, proportions I); set into a dense planting (clumps HG-26..28, the "Wald" of 1785/86 [D name; I extent]) with the entrance toward the belt walk on the spur walk HG-06 [I]. In the Karlslust from 1792 (KL-12 "Eremitage" site): not modelled for 1792 yet.',
    sources: [SRC.schneiderWeb],
    alternatives: ['position anywhere within ±20-30 m of u 70 / v -56 (Petri plan not georeferenced, research/11 Q2)', 'a stepped dome without a lantern, or tiers of other proportions (Schneider "double-stepped" only) [U form]'],
  },
  {
    id: 'KB-B88',
    name_de: 'Runder Pavillon über dem Hirschwürzloch (Prinzenlusthaus?)',
    function: 'round one-storey pavilion near today\'s Forst-Bauhof on ground falling to the Hirschwürzloch, in a clearing with a few accent plantings, raised for a long view; possibly the "Prinzenlusthaus" (round interior panelling, Krutthofen 1793) = UP-09 [D Schneider "denkbar"; research/11 §1.2 Pavilion 3, S5 3]',
    built: 'before 1789 U (on the Petri plan c. 1788)',
    footprint: ({ grid }) => circleRing(grid.toEN(463.0, -64.0), 8.0, 32),
    cls: 'PAV',
    template: 'garden_round',
    confidence: 'low',
    placement: 'hypothetical',
    priority: 7,
    dtmHint: 333.0,
    notes:
      'KB-I32 (research/11 S5 3): Petri plan Pavilion 3 at the bend where the belt walk "turns and descends in serpentines into the Hirschwürzloch" near today\'s Forst-Bauhof [D Schneider]; placed beside the head of the serpentine HG-03 (palace grid u 463, v -64, ±30 m) [I]; D 8 m N/I; clearing D ≈ 30 m (landcover LC-33) I. Identity with the Prinzenlusthaus (UP-09) only "denkbar" (Schneider) [U].',
    sources: [SRC.schneiderWeb],
    alternatives: ['UP-09 Lusthaus des Prinzen elsewhere (V23 no. 17 zone SE of the Orangerie, research/10 §b.6) [D-> schematic]'],
  },
  {
    id: 'KB-B28a',
    name_de: 'Apsis des Pavillons zu Carlsberg (Hypothese)',
    function: 'semicircular apse on the E side of the Pavillon zu Carlsberg KB-B28 [D Schneider "apse on the E side"; size and height N/I]',
    built: '1779-83 (D Schneider, with KB-B28)',
    // centred on the E wall of KB-B28 (382513/5466296): half of the drum stands inside the pavilion, so the visible part is
    // the half-round apse with its half-dome [I]; D 5.6 m (a little over half the wall) N
    footprint: () => circleRing([382513.0, 5466296.0], 5.6, 32),
    cls: 'PAV',
    template: 'garden_round',
    confidence: 'low',
    placement: 'hypothetical',
    priority: 7,
    dtmHint: 355.6,
    base: 355.6,
    storeys: [st('Sockel', 0.5, 'plinth', 'N'), st('Apsis', 3.6, 'floor', 'I as high as the ground floor of KB-B28')],
    roof: { dome_rise_ratio: 0.36, material: 'slate (U)', cover: 'slate', tags: 'N half-dome (the inner half lies inside KB-B28) as a flat calotte (rise 0.36 D, wave 9: the hemisphere read as a helmet against the wall) N/I; slate U' },
    notes:
      'KB-I32 (wave 8; research/11 §1.2 Pavilion 2, S5 2): Schneider describes the Pavillon zu Carlsberg as square with an apse on the E side [D]. Modelled as a round drum centred on the E wall of KB-B28 so only its outer half shows [I]; the footprint overlap with KB-B28 is intended (checks.ts ATTACHED).',
    sources: [SRC.schneiderWeb],
    alternatives: ['an apse rising through both storeys under the main roof [U]', 'no apse at the cellar pit if the pit is the Eiskeller (KB-B28 alternative)'],
  },
  // ---- KB-I31: Altan of the S wing (research/10 §b.1: T5 Abb. 11 "Mauerrest des südlichen Schlossflügels mit Fundamenten
  // des Altans" D existence; position U, here the garden (S) front over the Durchfahrt to the terrace garden TF-08 I)
  {
    id: 'KB-B02a',
    name_de: 'Altan am Südflügel (Gartenseite, Hypothese)',
    function:
      'upper-floor terrace (Altan) on piers in front of the S wing, at the floor of the Beletage (apartments of the Duchess and of Pfalzgraf Max Joseph), over the mouth of the Durchfahrt to the terrace garden TF-08 [D existence T5 Abb. 11 "Fundamente des Altans"; position, size and form I/N]',
    built: '1782-89 with the S wing (U)',
    // centred on the garden Durchfahrt (axes 11-12, u 3.08), 5.9 m wide (the two gate axes, end piers clear of the
    // neighbouring windows; clear span 4.4 m = FOLLY.altan.maxSpan), 4.2 m deep [N] (wave-7 review fix: was 4 axes)
    footprint: ({ grid }) => uvRect(grid, 0.13, 6.03, -41.52, -37.32),
    cls: 'PAV',
    template: 'folly',
    confidence: 'low',
    placement: 'hypothetical',
    priority: 6,
    dtmHint: 344.06,
    base: 344.06,
    notes:
      'KB-I31: existence D (T5 Abb. 11: wall remnant of the S wing "mit Fundamenten des Altans"); where along the wing U. Placed on the garden (S) front over the Durchfahrt to the terrace garden TF-08 (LP06 44), where an Altan would serve the Beletage apartments and frame the garden gate [I]; the research also names the W head pavilion as possible [I]. Deck = Beletage floor 351.4 (KB-B02 OG) I. Wave-7 review fix: the Altan covers only the two gate axes (5.9 m), carried by two rendered piers on red Buntsandstein base courses level with the wing plinth, sandstone imposts and a full entablature (architrave, frieze, cornice) under a stone balustrade [N]; it is entered from the Kabinett der Herzogin through two-leaf portes-fenêtres on the two gate axes of the KB-B02 Beletage (catalogue portal, no balconet) [I: an Altan at floor level must open from the rooms; N period practice]. Those portes-fenêtres belong to KB-B02 and stay when the hypothesis switch hides the Altan: the Altan existed (D), only its place is the hypothesis [I].',
    sources: [SRC.schwan2012, SRC.lp06],
    court_toward: 'KB-B02',
    alternatives: ['at the W head pavilion of the S wing (research/10 §b.1) [I]', 'a lower terrace at the Erdgeschoss floor (346.2) on vaults [U]', 'a cantilevered balcony rather than a terrace on piers [U]', 'four axes wide (12.6 m, wave 7) with portes-fenêtres on all four Beletage axes [I]'],
    storeys: [st('Pfeiler (offen, Altan)', 7.34, 'floor', 'I deck at the KB-B02 Beletage floor 351.4 over the terrace 344.06')],
    facade: { plinth_colour: '#A65E4A', folly: { kind: 'altan', gate_width: 3.4, tag: 'D existence T5 Abb. 11; form N (FOLLY.altan); gate 3.4 m = the Durchfahrt (KB-B02 portal) I; base courses in the red Buntsandstein of the wing plinth #A65E4A D (KB-B02 plinth)' } },
  },
  // ---- KB-I30 (research/10 §b.6, V23 schematic, ± 50-100 m): zone placements, all hypothetical and low
  {
    id: 'KB-B89',
    name_de: 'Monopteros am Westende des Karlsbergweihers (Hypothese)',
    function: 'round open garden temple (Monopteros) near the W end of the Karlsbergweiher, close to the Karlsberger Hof [D-> V23 no. 2; form N, position I ± 50-100 m]',
    built: 'before 1789 U',
    footprint: () => circleRing([381832, 5465914], 7.5, 32),
    cls: 'PAV',
    template: 'folly',
    confidence: 'low',
    placement: 'hypothetical',
    priority: 7,
    dtmHint: 279.5,
    notes:
      'KB-I30: V23 no. 2 "Monopteros" near the W end of the Karlsbergweiher (TF-20), towards the Karlsberger Hof (no. 1) [D-> schematic, ± 50-100 m]. Placed on the N bank above the W dam TF-22, looking E over the pond [I]. Eight Tuscan columns on a three-step stylobate under a shallow lead dome, D 7.5 m N (FOLLY.monopteros).',
    sources: [SRC.v23, SRC.schwan2012],
    court_toward: 'TF-20',
    alternatives: ['on the S bank or on the dam itself (V23 schematic) [U]', 'on the island TF-21 [U]'],
    facade: { folly: { kind: 'monopteros', tag: 'D-> V23 no. 2; form N (round open colonnade, FOLLY.monopteros)' } },
  },
  {
    id: 'KB-B90',
    name_de: 'Bienenhaus (Hypothese, Zone SO der Orangerie)',
    function: 'apiary: a timber bee shelter with straw skeps on shelves, open to the S (v1 UP-05) [D-> V23 no. 16 zone; form N]',
    built: '1783 (v1 UP-05) U',
    footprint: () => axisRect([382328, 5465962], 80.5, 4.2, 2.4),
    cls: 'PAV',
    template: 'folly',
    confidence: 'low',
    placement: 'hypothetical',
    priority: 8,
    dtmHint: 345.8,
    notes:
      'KB-I30 (v1 UP-05): V23 no. 16 puts the Bienenhaus in a hatched zone SE of the Orangerie, E of the road where the Apfelallee TF-14 starts [D-> schematic, ± 50-100 m]; placed ≈ 20 m NE of the avenue head [I]. A small timber shelter with three shelves of straw skeps under a tiled lean-to, open to the S N (FOLLY.apiary). The Prinzenlusthaus V23 no. 17 of the same zone is UP-09 (KB-B88 is the other candidate).',
    sources: [SRC.v23, SRC.hist],
    alternatives: ['anywhere in the V23 zone SE of the Orangerie (± 50-100 m) [D->]'],
    storeys: [st('Bienenstand (offen)', 2.7, 'floor', 'N back-wall height (FOLLY.apiary)')],
    facade: { folly: { kind: 'apiary', tag: 'D-> V23 no. 16 (zone); form N (FOLLY.apiary)' } },
  },
  {
    id: 'KB-B91',
    name_de: 'Wassermaschine (Maschinenhaus, Hypothese)',
    function: 'water-lifting machine for the palace supply on the NW slope below the plateau; its form is unknown, drawn as a plain small machine house [D-> V23 no. 7; form U, position I ± 50-100 m]',
    built: 'before 1789 U',
    footprint: () => axisRect([382092, 5466318], 80.5, 7.0, 5.0),
    cls: 'FARM',
    template: 'svc1',
    confidence: 'low',
    placement: 'hypothetical',
    priority: 8,
    dtmHint: 331.0,
    notes:
      'KB-I30: V23 no. 7 "Wassermaschine" NW of the palace on the slope [D-> schematic, ± 50-100 m]. Placed on the NW slope W of the Holländische Gärtnerei, ≈ 13 m below the plateau edge [I]. What the machine was (pump, horse gin, water wheel) is U, so only a plain rendered house with a tile roof is drawn [N].',
    sources: [SRC.v23],
    alternatives: ['a horse gin or a pump in the open (no house) [U]', 'further N towards the Marstall (V23 schematic) [U]'],
  },
  { id: 'KB-B86', name_de: 'Gebäude Nr. 67 (nicht in der Legende)', function: 'unnamed building (LP06 67)', lp06: ['67', 0], cls: 'FARM', template: 'svc2', confidence: 'low', placement: 'map', priority: 8, dtmHint: 352.4, notes: 'N28: LP06 draws no. 67 without a legend entry.', sources: [SRC.lp06] },
  // ---- KB-I39 (research/11 §0 item 5, S14; research/10 §b.4, §b.6): Karlslust follies of 1789, documented but not
  // located; zone placements after V23 (± 50-100 m), all hypothetical and low. The "Turkish pavilion" is the Tschifflik
  // KL-B46. No Eremitage in 1789: the round pavilion KB-B87 moved to the Karlslust only in 1792 (research/11 §1.2).
  {
    id: 'KL-B50',
    name_de: 'Chinesischer Pavillon („Chinoise“, Hypothese)',
    function: 'Chinese pavilion of the Karlslust (v1 UP-08 Chinoiserie), S of the Schwanenweiher [D presence research/11 §0 item 5; D-> V23 no. 31 zone; form N "octagonal, curved roof, red and green paint" (research/11 S14)]',
    built: 'before 1789 U',
    footprint: () => circleRing([382945, 5464648], 8.0, 32),
    cls: 'PAV',
    template: 'folly',
    confidence: 'low',
    placement: 'hypothetical',
    priority: 7,
    dtmHint: 262.5,
    notes:
      'KB-I39 / KB-I30 (v1 UP-08): V23 no. 31 "Chinoise" in the Karlslust S of the Schwanenweiher (TF-32..34) [D-> schematic, ± 50-100 m]; HM_1950_108: the Chinese temple existed "in similar form" only in the Karlslust (research/10 §b.6) [D]. Placed on the level valley floor S of Schwanenweiher 3, entrance facing the ponds [I]. Open octagon D 8 m, red posts, green lattice, concave green roof with a gilt finial N (FOLLY.chinese).',
    sources: [SRC.karlslustFollies, SRC.v23, SRC.schwan2012],
    court_toward: 'TF-34',
    alternatives: ['anywhere S of the Schwanenweiher within the V23 zone [D->]', 'a closed chinoiserie house rather than an open pavilion [U]'],
    facade: { folly: { kind: 'chinese', tag: 'D presence; form N (research/11 S14: octagonal, curved roof, red and green paint; FOLLY.chinese)' } },
  },
  {
    id: 'KL-B51',
    name_de: 'Türkisches Zelt (Hypothese)',
    function: 'Turkish tent of the Karlslust [D presence research/11 §0 item 5 ("ein türkisches Zelt", Schwan via homburg1 2018); D-> V23 no. 24 zone W/NW of the amphitheatre; form N striped tent]',
    built: 'before 1789 U',
    footprint: () => circleRing([382897, 5464957], 8.5, 32),
    cls: 'PAV',
    template: 'folly',
    confidence: 'low',
    placement: 'hypothetical',
    priority: 7,
    dtmHint: 307.5,
    notes:
      'KB-I39: V23 nos. 20-24 (Volierenpavillon, "Drei Pavillons", Heuwagen, Zelt) share one hatched zone W and NW of the amphitheatre (no. 22 = KL-B40) [D-> schematic, ± 50-100 m]. Placed on the level band of the Tschifflik terrace (≈ 307 m) between KL-B46 and the amphitheatre moat [I]. Striped canvas drum and cone D 8.5 m N (FOLLY.tent); canvas may have been painted sheet metal or real fabric [U].',
    sources: [SRC.karlslustFollies, SRC.v23],
    court_toward: 'KL-B40',
    alternatives: ['anywhere in the V23 zone W/NW of the amphitheatre [D->]', 'a seasonal fabric tent, not standing all summer [U]'],
    facade: { folly: { kind: 'tent', tag: 'D presence; form N (research/11 S14 "striped tent 8-10 m"; FOLLY.tent)' } },
  },
  {
    id: 'KL-B52',
    name_de: 'Heuwagen (Staffage, Hypothese)',
    function: 'hay-wagon folly of the Karlslust: a full-size hay wagon as garden staffage [D presence research/11 §0 item 5; D-> V23 no. 23 zone; form N]',
    built: 'before 1789 U',
    footprint: () => axisRect([382848, 5464986], 95.0, 10.6, 3.0),
    cls: 'PAV',
    template: 'folly',
    confidence: 'low',
    placement: 'hypothetical',
    priority: 8,
    dtmHint: 316.0,
    notes:
      'KB-I39: V23 no. 23 "Heuwagen" in the zone W/NW of the amphitheatre [D-> schematic, ± 50-100 m]; placed on the level meadow band above the Tschifflik terrace (≈ 316 m) [I]. Whether the folly was a real wagon or a disguised hut (a "Heuwagen" with a room inside) is U; drawn as a full-size loaded wagon N (FOLLY.hayWagon).',
    sources: [SRC.karlslustFollies, SRC.v23],
    alternatives: ['a small room disguised as a hay load on a wagon (a garden cabinet) [U]'],
    storeys: [st('Wagen (Staffage)', 2.9, 'floor', 'N wagon bed 1.05 m + hay load 1.9 m (FOLLY.hayWagon)')],
    facade: { folly: { kind: 'hay_wagon', tag: 'D presence; form N full-size wagon (research/11 S14; FOLLY.hayWagon)' } },
  },
  {
    id: 'KL-B53',
    name_de: 'Volierenpavillon (Hypothese)',
    function: 'aviary pavilion of the Karlslust [D presence research/11 §0 item 5; D-> V23 no. 20 zone W/NW of the amphitheatre; T25 Schwan 2023 on the Voliere (not read); form N]',
    built: 'before 1789 U',
    footprint: () => axisRect([382872, 5464929], 80.5, 14.0, 4.6),
    cls: 'PAV',
    template: 'folly',
    confidence: 'low',
    placement: 'hypothetical',
    priority: 7,
    dtmHint: 302.0,
    notes:
      'KB-I39: V23 no. 20 "Volierenpavillon" in the zone W/NW of the amphitheatre [D-> schematic, ± 50-100 m]; T1 p. 381 names pheasants, peacocks, cassowaries, pelicans and herons in the Karlslust (research/10 §b.4) [D]. Placed W of the amphitheatre moat below the Tschifflik terrace [I]. A rendered octagonal core (D 4.6 m, slate pyramid) with two wire-cage wings N (FOLLY.aviary); the wire is iron and not in the explorer layer.',
    sources: [SRC.karlslustFollies, SRC.v23, SRC.t25voliere, SRC.mannlich],
    court_toward: 'KL-B40',
    alternatives: ['anywhere in the V23 zone W/NW of the amphitheatre [D->]', 'a round cage pavilion (Vogelhaus) without a rendered core [U]'],
    storeys: [st('Sockel', 0.3, 'plinth', 'N'), st('Volierenhaus', 3.4, 'floor', 'N (FOLLY.aviary)')],
    facade: { folly: { kind: 'aviary', tag: 'D presence; D-> V23 no. 20; form N (FOLLY.aviary)' } },
  },
  // ---- Karlslust
  { id: 'KL-B46', name_de: 'Tschifflik-Pavillon (auf der Terrasse gegenüber der Kaskade)', function: 'Turkish-style pavilion 1779-80, largest of four pavilions', built: '1779-80', lp06: ['61', 0], cls: 'PAV', template: 'pav', confidence: 'low', placement: 'map', priority: 4, dtmHint: 307.5, notes: 'N7: LP06 61 "Tschifflik Pavillon" on the KL-03 terrace axis (two marks, 31 x 17 m drawn; karlslust fit ±8 m); 1950s note "on a terrace opposite the cascade" (05 a.5). Oriental form U (cf. Schwetzingen Moschee). KB-I02: V23 no. 25 shows one Tschifflik W of the cascade, nearer this site than the KL-B42 ruin [D-> V23 schematic; I, low]; T1 p. 387: during the 1785 fête the court sat in "the pavilion opposite on the hill" (research/10 §b.4, §b.6).', sources: [SRC.lp06, SRC.syn, SRC.mannlich] },
  { id: 'KL-B47', name_de: 'Gebäude an der Terrasse (LP06 62)', function: 'building on the upper terrace (LP06 62 "Terrasse")', lp06: ['62', 0], cls: 'PAV', template: 'pav', confidence: 'low', placement: 'map', priority: 6, dtmHint: 320.1, notes: 'N26: LP06 62 (32 x 17 m drawn, karlslust fit ±10 m).', sources: [SRC.lp06] },
  { id: 'KL-B48', name_de: 'Treillagenpavillon', function: 'trellis pavilion with terraces (v1 UP-16 "Trilagen-Pavillon")', lp06: ['63', 0], cls: 'PAV', template: 'pav', confidence: 'low', placement: 'map', priority: 6, dtmHint: 307.9, notes: 'N26: LP06 63 (33 x 18 m drawn, karlslust fit ±10 m). Trellis (Treillage) structure: render as open lattice [I].', sources: [SRC.lp06] },
  { id: 'KL-B49', name_de: 'Hymenäostempel (Standort, 1785)', function: 'temple of Hymen for the 1785 wedding (LP06 59 "Standort des Hymenäostempel 1785")', built: '1785', lp06: ['59', 0], cls: 'PAV', template: 'temple', confidence: 'low', placement: 'map', priority: 6, dtmHint: 286.6, notes: 'N27: LP06 59 site mark (≈8 x 8 m) by the KL-09 rondell at the top of the Große Kaskade. Form U. KB-I03: a fireworks stage set of the Dec 1785 fête (the temple "rose from the smoke" before a volcano scenery, T1 p. 387) [D] -> epoch 1785 only; the site mark stays in the catalogue.', sources: [SRC.lp06, SRC.mannlich], epoch: { from: 1785, to: 1785 }, epoch_tag: 'D: T1 Mannlich 1910 p. 387 (fireworks stage set of Dec 1785); T24 Schwan 2007 on the fête (research/10 §b.4)' },
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
    const storeys = n.storeys ?? storeysFor(n.template);
    const eaves = base + storeys.reduce((s, x) => s + x.height, 0);
    const roof: Roof = n.cls === 'FARM_GROUP' ? { type: 'none', cover: 'none', material: 'red Biberschwanz tile', note: 'envelope as drawn in LP06 - generator places ranges inside or a placeholder' } : roofFor(n.template, r2(m.width), eaves);
    if (n.roof) Object.assign(roof, n.roof);
    const facade: Facade =
      n.template === 'folly'
        ? { ...FOLLY_FACADE_BASE, axis_spacing: 3.6 }
        : n.template === 'guard' || n.template === 'pav' || n.template === 'temple' || n.template === 'garden_round'
          ? { ...PALACE_FACADE_BASE, axis_spacing: 3.6 }
          : { ...FARM_FACADE, axis_spacing: n.cls === 'STABLE' ? 3.6 : 3.4 };
    if (n.axes) facade.axes = n.axes;
    if (n.facade) Object.assign(facade, n.facade);
    if (n.template === 'folly' && facade.folly) Object.assign(facade, FOLLY_FACADE[facade.folly.kind]);
    if (n.template === 'glass') facade.glasshouse = { tag: 'D Petri via Schneider "two greenhouses facing due S" (research/11 §1.2, G12, S11); lean-to N; sizes I (GARDEN_DETAIL.glasshouse)' };
    // KB-I15 shutter colours by class: court-town ranges (WING2 / RANGE1: barracks, Cavaliershaus, Taubenhaus, Remisen,
    // Torhaus) share the court blue-grey [D-> Baunetz; HMS; class split I]; stables oxblood, farm buildings green [N]
    if (n.template === 'stable') facade.shutter_colour = STABLE_SHUTTER;
    else if (n.cls === 'WING2' || n.cls === 'RANGE1') facade.shutter_colour = COURT_SHUTTER;
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
    if (n.epoch) {
      b.epoch = n.epoch;
      if (n.epoch_tag) b.epoch_tag = n.epoch_tag;
    }
    setBuildYear(b);
    return b;
  });
}

/**
 * KB-I30 (research/10 §b.3, §b.6): documented items with no usable position, kept as unplaced entries (no geometry).
 * V23 zones are noted (± 50-100 m) but too vague, or the item is not a building the generator could draw honestly.
 */
const NEW_UNPLACED: { id: string; name_de: string; function: string; notes: string; sources: string[] }[] = [
  { id: 'UP-19', name_de: 'Wintervogelhaus', function: 'winter aviary on the Orangerie side of the plateau (Molitor via T1 intro) [D existence]', notes: 'research/10 §b.3, §b.5: Molitor lists a "Wintervogelhaus" with the Orangerie [D]; position U (Orangerie side of the plateau). Not placed.', sources: [SRC.mannlich] },
  { id: 'UP-20', name_de: 'Seidenhasenhaus', function: 'angora-rabbit house [D-> V23 no. 11]', notes: 'research/10 §b.6: V23 no. 11 in a hatched zone N of the Sammlungsflügel (KB-B04) [D-> schematic, ± 50-100 m]; the zone is filled by the gallery, the Holländische Gärtnerei and the Nordterrasse, so no spot is free of conflict. Zone only.', sources: [SRC.v23] },
  { id: 'UP-21', name_de: 'Schießhaus', function: 'shooting house [D-> V23 no. 12]', notes: 'research/10 §b.6: V23 no. 12, same hatched zone N of the Sammlungsflügel as nos. 11 and 13 [D-> schematic]. Zone only.', sources: [SRC.v23] },
  { id: 'UP-22', name_de: 'Sauschütte', function: 'boar-feeding place [D-> V23 no. 13]', notes: 'research/10 §b.6: V23 no. 13, same hatched zone N of the Sammlungsflügel [D-> schematic]; a feeding place, probably no building [I]. Zone only.', sources: [SRC.v23] },
  { id: 'UP-23', name_de: 'Vogeltränke', function: 'bird-watering place in the Karlslust [D-> V23 no. 19]', notes: 'research/10 §b.6: V23 no. 19 N of the menagerie zone [D-> schematic]; a basin or trough rather than a building [I]. Zone only (a terrain feature for the garden side if it is ever drawn).', sources: [SRC.v23] },
  { id: 'UP-24', name_de: 'Terrasse mit „Drei Pavillons“', function: 'terrace with three pavilions in the Karlslust [D-> V23 no. 21]', notes: 'research/10 §b.6: V23 no. 21 in the zone W/NW of the amphitheatre; candidates are the LP06 marks on the Tschifflik terrace KL-B46..48 ("largest of four pavilions", KL-B46) [I]. Not placed separately.', sources: [SRC.v23, SRC.lp06] },
  { id: 'UP-25', name_de: '„Langer Gang“ (Galerieverlängerung nach Norden)', function: 'timber passage of > 100 m from the picture gallery N past the Treibhäuser to the Marställe and the Reitschule, first a connecting passage, later meant as a gallery extension (T5) [D existence; U date and line]', notes: 'research/10 §b.1: added after the gallery (1788) proved too small; whether it stood complete in summer 1789 is U, and its line (W or E of the Holländische Gärtnerei KB-B27) is U. Not placed (optional future epoch item).', sources: [SRC.schwan2012] },
];

export function newUnplaced(): Building[] {
  return NEW_UNPLACED.map((u) => ({
    id: u.id,
    name_de: u.name_de,
    cls: '?',
    function: u.function,
    built: 'U',
    priority: 9,
    confidence: 'low',
    placement: 'unplaced',
    footprint: null,
    base_h: null,
    storeys: [],
    roof: { type: 'none', cover: 'none' },
    facade: {},
    interior: 'none',
    sources: u.sources,
    notes: `Documented, no position evidence. v2 (KB-I30): ${u.notes}`,
    alternatives: [],
    ground_dtm: null,
    lidar_ids: [],
  }));
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
