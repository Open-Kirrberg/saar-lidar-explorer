/**
 * Room programmes of the palace wings (catalogue v2) from compact parameters.
 *
 * Every building gets one axis grid along s (s_k = s0 + p·k). Both long facades put their
 * windows on that grid (facade.sides with from/to), and every cross wall sits on a pier
 * midpoint between two grid axes, so no partition can meet a window on either side.
 * A floor is a list of zones: a grid range [k0, k1] and a pile band (garden / court /
 * corridor, or full depth). Zones become rooms (polygons in [s, t]), adjacent zones get doors
 * (enfilade double doors on the state floors), stair zones get Stair records, and explicit
 * passages link the wings. checks.ts verifies the result against layoutBuilding().
 *
 * Programme content: research/05 §e (I) adapted to the v2 plan (41 m CdL block, arms along
 * its flanks), room names from Weber's ToC / room-guide snippets [D names, positions I],
 * sizes and finishes from research/02 §2.11-2.12 [N].
 */
import { buildingFrame } from '../../model/src/layout/footprint.ts';
import { centroid } from '../../model/src/layout/geom.ts';
import { FACHWERK, INTERIOR_DOOR, PARTITION_WALL, STAIR } from '../../model/src/layout/grammar.ts';
import { pileBands, rectST, type PileBand, type PileOptions } from '../../model/src/layout/rooms.ts';
import { resolveCourtToward } from '../../model/src/layout/site.ts';
import { stairRun, type StairClass } from '../../model/src/layout/stairs.ts';
import { storeyStack } from '../../model/src/layout/storeys.ts';
import type { Building, EN, FacadeSideSpec, Finish, Opening, PortalSpec, RaisedRoofSection, Risalit, Room, SideName, SiteSpec, Stair, StairKind } from '../../model/src/spec.ts';
import { r2, r3 } from './common.ts';

// ---------------------------------------------------------------------------------------------
// Parameter types
// ---------------------------------------------------------------------------------------------

type Band = 'garden' | 'court' | 'corridor' | 'full';

const FIN = {
  crimson: { floor: 'floor.parquet', walls: 'wall.silk.crimson', ceiling: 'ceiling.stucco' },
  blue: { floor: 'floor.parquet', walls: 'wall.silk.blue', ceiling: 'ceiling.stucco' },
  green: { floor: 'floor.parquet', walls: 'wall.silk.green', ceiling: 'ceiling.stucco' },
  // KB-I27: named room colours (research/10 §c.2; research/09 §6.2 M8, §6.5 C5)
  yellow: { floor: 'floor.parquet', walls: 'wall.silk.yellow', ceiling: 'ceiling.stucco' },
  grey: { floor: 'floor.parquet', walls: 'wall.silk.grey', ceiling: 'ceiling.stucco' },
  boiserie: { floor: 'floor.parquet', walls: 'wall.boiserie', ceiling: 'ceiling.stucco' },
  hall: { floor: 'floor.flags', walls: 'stone.grey', ceiling: 'ceiling.stucco' },
  stair: { floor: 'floor.flags', walls: 'wall.limewash', ceiling: 'ceiling.stucco' },
  service: { floor: 'floor.planks', walls: 'wall.limewash', ceiling: 'wall.limewash' },
  kitchen: { floor: 'floor.flags', walls: 'wall.limewash', ceiling: 'wall.limewash' },
  cellar: { floor: 'floor.brick', walls: 'stone.rubble', ceiling: 'stone.rubble' },
  passage: { floor: 'ground.cobbles', walls: 'render.lime', ceiling: 'render.lime' },
  orangery: { floor: 'floor.flags', walls: 'wall.limewash', ceiling: 'ceiling.stucco' },
} as const satisfies Record<string, Finish>;
type FinKey = keyof typeof FIN;

const FIN_TAG: Record<FinKey, string> = {
  crimson: 'D Lyon silks, gilding (05 §e); colour per room U; parquet N',
  blue: 'D Lyon silks (05 §e); colour per room U; parquet N',
  green: 'D silks; green for picture walls N; parquet N',
  yellow: 'D silks; yellow damask for the Gelber Salon (hue I research/09 M8); parquet N',
  grey: 'D silks; grey damask for the Grauer Salon (hue N research/10 §c.2); parquet N',
  boiserie: 'D Louis-Seize boiseries (Georges Jacob, 05 §e); Tafelparkett N',
  hall: 'D-> red and grey sandstone flags (05 §e.1); stucco N',
  stair: 'N sandstone steps and flags, limewash',
  service: 'N planks and limewash',
  kitchen: 'N flagged, vaulted kitchen',
  cellar: 'D vaulted Buntsandstein cellars (05 §e); brick floor N',
  passage: 'N cobbled Durchfahrt',
  orangery: 'N flagged floor (tubs); stucco ceiling N',
};

interface StairDef {
  kind: StairKind;
  cls: StairClass;
  to: number;
  up: [number, number];
  tag: string;
}

interface Zone {
  k: [number, number];
  band: Band;
  id: string;
  name: string;
  fn?: string;
  fin: FinKey;
  tag?: string;
  stair?: StairDef;
  /** Room rises through the next storey (stair halls, Pfeilersaal); the next floor has a `void`. */
  double?: boolean;
  /** Placeholder on an upper floor for a double room from below (id of that room zone). */
  voidOf?: string;
  /** KB-I27: silk hue (#RRGGBB, N) of a room whose name carries a colour; `colourTag` says where the colour comes from. */
  colour?: string;
  /** KB-I26/I27: contrasting damask border (#RRGGBB, N; Mannlich T1 p. 365). */
  border?: string;
  colourTag?: string;
}

interface Floor {
  storey: number;
  layout: NonNullable<PileOptions['layout']>;
  outerWall: number;
  courtPileClear?: number;
  corridorClear?: number;
  /** Band whose doors are enfilade double doors on one line (state floors). */
  enfilade?: 'garden' | 'court';
  zones: Zone[];
}

interface Passage {
  id: string;
  storeys: number[];
  side: SideName;
  /** Position along the side expressed as s (long sides) or t (ends). */
  at: number;
  /** Per-storey override of `at` (fix round 1: OG passage moved onto the Dienertreppe's upper landing). */
  atByStorey?: Record<number, number>;
  to: string;
  width?: number;
  height?: number;
  sill?: number;
  tag: string;
}

interface Prog {
  id: string;
  /** Grid spacing and the s of grid index 0 (from the frame length). */
  p: number;
  s0: (L: number) => number;
  kmin: number;
  kmax: number;
  garden: [number, number] | 'blind';
  court: [number, number] | 'blind';
  /** End sides: t positions of the windows (uniform spacing) or blind. */
  end_a: number[] | 'blind';
  end_b: number[] | 'blind';
  sideTag: string;
  /** Window type per side where the class default does not apply (fix round 1). */
  windowKinds?: Partial<Record<SideName, { kind: 'window' | 'porte_fenetre'; storeys?: number[]; tag: string }>>;
  portals?: (ax: AxisOf) => PortalSpec[];
  risalits?: (ax: AxisOf) => Risalit[];
  raised?: (ax: AxisOf) => RaisedRoofSection[];
  floors: Floor[];
  passages: Passage[];
  /** Door ids (`door-<roomA>-<roomB>`) not to generate (fix round 1: doors a stair landing cannot serve). */
  skipDoors?: string[];
  interiorTag: string;
}

/** Facade axis index of a grid index on a long side (court numbering runs against +s). */
type AxisOf = (side: 'garden' | 'court', k: number, span?: number) => number;

// ---------------------------------------------------------------------------------------------
// Programmes
// ---------------------------------------------------------------------------------------------

const TAG_I = 'I (programme: research/05 §e adapted to the v2 plan; sizes N 02 §2.11)';

function stairZone(k: [number, number], band: Band, id: string, name: string, kind: StairKind, cls: StairClass, to: number, up: [number, number], tag: string, double = true): Zone {
  return { k, band, id, name, fn: 'stair hall', fin: 'stair', stair: { kind, cls, to, up, tag }, double, tag };
}
const voidZ = (k: [number, number], band: Band, of: string): Zone => ({ k, band, id: `${of}-void`, name: '', fin: 'stair', voidOf: of });

/** KB-I27: R12 colour names of one OG suite, assigned to the Duke's N-wing apartment (research/10 §c.2). */
const R12_DUKE = 'D R12 (Stand 2003) OG 11 D-14 G "Rotes Vorzimmer, Grauer Salon, Grünes Schlafzimmer, Kirschrotes Kabinett" (names of one suite); assigned to the Duke\'s N-wing apartment (same sequence) I';

const CDL: Prog = {
  id: 'KB-B01',
  p: 2.65,
  s0: () => -(15 * 2.65) / 2 + 2.65 / 2,
  kmin: 0,
  kmax: 14,
  garden: [0, 14],
  court: [0, 14],
  // free garden-pile part of the ends (u 39-46.2, t -9..-1.8): two windows
  end_a: [-6.775, -4.125],
  end_b: [-6.775, -4.125],
  sideTag: 'HMS 15 axes (4+7+4) on both fronts; spacing D-> 40.9 m / 15; end windows only on the free garden-pile part I',
  portals: (ax) => [
    { side: 'court', axis: ax('court', 7), kind: 'portal', storey: 1, steps: 10, tag: '10 steps D-> (1.4 m Sockel / 0.145); stair HMS short straight ~5 steps between sentries (secondary, step count conflicts); width N Blondel; sizes I; low' },
    { side: 'garden', axis: ax('garden', 7), kind: 'door', storey: 1, steps: 2, grade_h: 345.9, tag: 'I through-going vestibule (05 §e.1); garden door with a 2-step perron down to the parterre TF-09 (345.9) I (fix round 1)' },
    {
      side: 'garden',
      axis: ax('garden', 6, 3),
      kind: 'porte_fenetre',
      span_axes: 3,
      storey: 2,
      // wave-8 review fix (KB-I72): one balcony across the three doors instead of three balconets
      balcony_run: { depth: 1.2, tag: 'I 05 §e.1 Festsaal "3 portes-fenêtres to a balcony" read as one continuous balcony (N 09 §3.5 ironwork); depth 1.2 m I' },
      tag: 'I 3 portes-fenêtres of the Festsaal to a balcony (05 §e.1)',
    },
  ],
  risalits: (ax) => [
    { side: 'garden', first_axis: ax('garden', 4, 7), axis_count: 7, kind: 'centre', projection: 0.5, tag: 'D LC 1790 7-axis centre pavilion = Louisenhof core (D hib 7 axes); projection N' },
    { side: 'court', first_axis: ax('court', 4, 7), axis_count: 7, kind: 'centre', projection: 0.5, tag: 'D LC 1790 + HMS 4+7+4; projection N' },
  ],
  raised: (ax) => [
    {
      side: 'garden',
      first_axis: ax('garden', 4, 7),
      axis_count: 7,
      extra_h: 3.5,
      type: 'hip',
      turret: { kind: 'lantern', height: 1.6, tag: 'D LC 1790 / PL lantern and spire; top >= 367.8 HMS lower bound, spire height U' },
      tag: 'D LC 1790 + PL centre pavilion with its own higher roof; ridge 366.2 HMS (research/08 §4)',
    },
  ],
  floors: [
    {
      storey: 1,
      layout: 'double',
      outerWall: 1.0,
      courtPileClear: 5.6,
      enfilade: 'garden',
      zones: [
        { k: [0, 1], band: 'garden', id: 'eg-kabinett', name: 'Schreibkabinett des Herzogs', fn: 'study', fin: 'boiserie', tag: 'D room guide "Schlafzimmer + Schreibkabinett" on the EG; position I' },
        { k: [2, 3], band: 'garden', id: 'eg-schlafzimmer', name: 'Schlafzimmer des Herzogs', fn: 'bedroom (private apartment)', fin: 'blue', tag: 'D room guide (EG); position I' },
        { k: [4, 5], band: 'garden', id: 'eg-gelber-salon', name: 'Gelber Salon', fn: 'salon (private apartment): yellow damask in gilt Tapetenleisten', fin: 'yellow', border: '#EEE8D8', colourTag: 'D name "Gelber Salon" (room guide, R12 EG); yellow #C9A94E I research/09 M8 (alternative #D9B95B N research/10 §c.2); ivory border N (Mannlich T1 p. 365: contrasting broad borders D)', tag: 'D room guide "Gelber Salon + Schreibkabinett" (EG); position I' },
        { k: [6, 8], band: 'full', id: 'eg-vestibuel', name: 'Vestibül (Durchgang Hof – Garten)', fn: 'through vestibule on the axis, four pairs of columns', fin: 'hall', tag: 'I 05 §e.1 (axis passage Ehrenhof - east avenue); columns N' },
        stairZone([9, 13], 'full', 'eg-prunktreppe', 'Prunktreppenhaus (Kaiserstiege)', 'imperial', 'prunk', 2, [1, 0], 'I "42 [Fuß] staircase" (enwp) read as 42 Pariser Fuß = 13.6 m -> 5 axes 13.25 m (C8); imperial type N (Würzburg/Brühl)'),
        { k: [14, 14], band: 'garden', id: 'eg-garderobe-nord', name: 'Garderobe', fin: 'service', fn: 'garderobe' },
        stairZone([0, 1], 'court', 'eg-dienertreppe-sued', 'Dienertreppe Süd', 'dogleg', 'service', 2, [0, -1], 'N service stair in the court pile (05 §e.1); link to the S arm'),
        { k: [2, 3], band: 'court', id: 'eg-garderobe-sued', name: 'Garderobe', fin: 'service', fn: 'garderobe' },
        { k: [4, 5], band: 'court', id: 'eg-antichambre', name: 'Antichambre', fn: 'antechamber of the private apartment', fin: 'boiserie' },
        { k: [14, 14], band: 'court', id: 'eg-durchgang-nord', name: 'Durchgang zum Nordflügel', fn: 'link to the N arm', fin: 'stair' },
      ],
    },
    {
      storey: 2,
      layout: 'double',
      outerWall: 0.85,
      courtPileClear: 5.75,
      enfilade: 'garden',
      zones: [
        { k: [0, 1], band: 'garden', id: 'og-kabinett', name: 'Kabinett (Tempelzimmer?)', fn: 'cabinet', fin: 'boiserie', tag: 'D Tempelzimmer named in Weber ToC, location U' },
        { k: [2, 3], band: 'garden', id: 'og-paradeschlafzimmer', name: 'Paradeschlafzimmer', fn: 'state bedroom, alcove with balustrade, lit à la romaine', fin: 'crimson', tag: 'D Paradeschlafzimmer with lit à la romaine (05 §e.1); position I' },
        { k: [4, 5], band: 'garden', id: 'og-audienzzimmer', name: 'Audienzzimmer', fn: 'audience chamber', fin: 'crimson' },
        { k: [6, 8], band: 'garden', id: 'og-festsaal', name: 'Salon / Festsaal', fn: 'festival salon with 3 portes-fenêtres to the balcony', fin: 'boiserie', tag: 'I 05 §e.1 (12 x 9 m there, here 3 axes 7.8 x 10 m)' },
        voidZ([9, 13], 'full', 'eg-prunktreppe'),
        { k: [14, 14], band: 'garden', id: 'og-wintergarten', name: 'Durchgang / Wintergarten (?) zum Nordflügel', fn: 'link to the N arm', fin: 'boiserie', tag: 'D Wintergarten named in Weber ToC, location U' },
        voidZ([0, 1], 'court', 'eg-dienertreppe-sued'),
        { k: [2, 3], band: 'court', id: 'og-garderobe-sued', name: 'Garderobe', fin: 'service', fn: 'garderobe, jib doors' },
        { k: [4, 5], band: 'court', id: 'og-antichambre', name: 'Antichambre (Nr. 8)', fn: 'antechamber no. 8 before the "Apparat du Souverain" (state apartment): 2 bergères and a seating set of the Jacob suite delivered 5 March 1782', fin: 'boiserie', tag: 'D Redding citing Langer 1995 no. 46: two bergères of the Jacob suite (5 March 1782) stood in "antichambre no. 8" before the "Apparat du Souverain" (research/09 §4.1, I6); identification with this room I' },
        { k: [6, 8], band: 'court', id: 'og-gardesaal', name: 'Garde- / Vorsaal', fn: 'guard hall above the vestibule', fin: 'boiserie', tag: 'I 05 §e.1' },
        { k: [14, 14], band: 'court', id: 'og-durchgang-nord', name: 'Durchgang zum Nordflügel', fin: 'service' },
      ],
    },
  ],
  passages: [
    { id: 'cdl-sued', storeys: [1, 2], side: 'end_a', at: 5.2, atByStorey: { 2: 3.4 }, to: 'KB-B02', tag: 'I link CdL court pile -> S arm; OG door on the upper landing of the Dienertreppe (fix round 1)' },
    { id: 'cdl-nord', storeys: [1, 2], side: 'end_b', at: 5.2, to: 'KB-B03', tag: 'I link CdL court pile -> N arm' },
  ],
  // fix round 1: the OG Garderobe is reached from the Antichambre (jib doors); a door onto the Dienertreppe
  // void could not be served by any landing of the 4.8 x 5.6 m stair hall
  skipDoors: ['door-B01.1.eg-dienertreppe-sued-B01.2.og-garderobe-sued'],
  interiorTag: 'research/05 §e.1 adapted to the 41 m block (v2): private apartment of the Duke on the EG garden side, state apartment on the Beletage',
};

const SUED: Prog = {
  id: 'KB-B02',
  p: 3.15,
  s0: () => -(23 * 3.15) / 2 + 3.15 / 2,
  kmin: 0,
  kmax: 22,
  garden: [0, 22],
  court: [0, 19],
  end_a: [-5.1, -1.7, 1.7, 5.1],
  end_b: [-4.05, 4.05],
  sideTag: 'spacing 3.15 HMS; 23 axes on the terrace face, 20 on the open court face (grid aligned) I; W head 4 axes D LC 1790',
  portals: (ax) => [
    { side: 'court', axis: ax('court', 11, 2), kind: 'durchfahrt', span_axes: 2, storey: 1, tag: 'HMS round-arched Durchfahrt u -1.6..4.9 -> grid axes 11-12' },
    // wave-8 review fix (KB-I72): PL draws a balcony in each wing centre (the porcelain plate is symmetrised; LC does not
    // show this face): a balcony on consoles over the court Durchfahrt, the court face's centre [D PL existence, low; I]
    {
      side: 'court',
      axis: ax('court', 11, 2),
      kind: 'porte_fenetre',
      span_axes: 2,
      storey: 2,
      balcony_run: { depth: 1.0, tag: 'D PL (porcelain plate, symmetrised) balcony in each wing centre (research/07 §1.1); over the court Durchfahrt I; slab on consoles, iron railing N; depth I; low' },
      tag: 'I portes-fenêtres onto the wing-centre balcony (KB-I72; D PL, low)',
    },
    { side: 'garden', axis: ax('garden', 11, 2), kind: 'durchfahrt', span_axes: 2, storey: 1, tag: 'HMS gate to the terrace garden (TF-08)' },
    // wave-7 review fix (KB-I31): the Altan KB-B02a over the gate is entered from the Beletage through two-leaf
    // portes-fenêtres on the two gate axes (no iron balconet: the Altan's stone balustrade guards them)
    { side: 'garden', axis: ax('garden', 11, 2), kind: 'porte_fenetre', span_axes: 2, storey: 2, balconet: false, tag: 'I portes-fenêtres onto the Altan KB-B02a (D existence T5 Abb. 11; an Altan at Beletage level opens from the rooms through portes-fenêtres N); axes follow the Altan hypothesis I' },
    {
      side: 'end_a',
      axis: 1,
      kind: 'portal',
      span_axes: 2,
      storey: 1,
      steps: 11,
      portico: { columns: 4, balcony: true, tag: 'D LC 1790 4 columns + balcony; column size and depth N' },
      tag: 'D LC 1790 4-column portico with balcony over a broad Freitreppe (~10-12 steps)',
    },
  ],
  risalits: () => [{ side: 'end_a', first_axis: 0, axis_count: 4, kind: 'centre', projection: 0.6, pediment: false, tag: 'D LC 1790 W head pavilion (portico); projection N' }],
  floors: [
    {
      storey: 1,
      layout: 'double',
      outerWall: 0.7,
      courtPileClear: 5.6,
      enfilade: 'garden',
      zones: [
        // KB-I25 (research/10 §0.4, §b.1 KB-B02; history-check H05): the S wing EG held guest apartments, a vestibule
        // with the stair and the Durchfahrt (R12 "Appartements im Südflügel", "Vestibül und Treppe", "Durchfahrt");
        // the silver chamber belongs to the N wing (T5) and the Großer Speisesaal to the kitchen wing OG (T1 p. 338)
        { k: [0, 1], band: 'full', id: 'eg-kopfvestibuel', name: 'Vestibül im Kopfpavillon', fn: 'entrance hall behind the portico; with the stair beside it R12 "Vestibül und Treppe"', fin: 'hall', tag: 'D LC 1790 portico; D R12 (Stand 2003) "Vestibül und Treppe" in the S wing (name); position at the W head I' },
        stairZone([2, 3], 'full', 'eg-treppe-west', 'Treppenhaus West', 'dogleg', 'secondary', 2, [0, 1], 'D R12 "Vestibül und Treppe" (S wing, name); dogleg type and position N/I'),
        { k: [4, 5], band: 'garden', id: 'eg-gast1-antichambre', name: 'Antichambre (Gästeappartement I)', fn: 'antechamber of a guest apartment', fin: 'boiserie', tag: 'D R12 "Appartements im Südflügel" (name); rooms and positions I; T5: the wing long a carcass, finish in 1789 partly U' },
        { k: [6, 8], band: 'garden', id: 'eg-gast1-schlafzimmer', name: 'Schlafzimmer (Gästeappartement I)', fn: 'bedroom of a guest apartment', fin: 'blue', tag: 'D R12 "Appartements im Südflügel" (name); room I' },
        { k: [9, 10], band: 'garden', id: 'eg-gast1-kabinett', name: 'Kabinett (Gästeappartement I)', fn: 'cabinet of a guest apartment', fin: 'boiserie', tag: 'D R12 (name); room I' },
        { k: [4, 6], band: 'court', id: 'eg-gast1-garderobe', name: 'Garderobe (Gästeappartement I)', fn: 'garderobe', fin: 'service' },
        { k: [7, 10], band: 'court', id: 'eg-gast1-diener', name: 'Dienerzimmer (Gästeappartement I)', fn: 'servants of the guest apartment', fin: 'service' },
        { k: [11, 12], band: 'full', id: 'eg-durchfahrt', name: 'Durchfahrt zum Terrassengarten', fn: 'carriage passage', fin: 'passage', tag: 'HMS; D R12 "Durchfahrt" (S wing)' },
        { k: [13, 14], band: 'garden', id: 'eg-gast2-antichambre', name: 'Antichambre (Gästeappartement II)', fn: 'antechamber of a guest apartment', fin: 'boiserie', tag: 'D R12 "Appartements im Südflügel" (name); rooms and positions I' },
        { k: [15, 17], band: 'garden', id: 'eg-gast2-schlafzimmer', name: 'Schlafzimmer (Gästeappartement II)', fn: 'bedroom of a guest apartment', fin: 'green', tag: 'D R12 (name); room I' },
        { k: [18, 19], band: 'garden', id: 'eg-gast2-kabinett', name: 'Kabinett (Gästeappartement II)', fn: 'cabinet of a guest apartment', fin: 'boiserie', tag: 'D R12 (name); room I' },
        { k: [20, 22], band: 'garden', id: 'eg-wartezimmer', name: 'Wartezimmer', fin: 'boiserie' },
        { k: [13, 16], band: 'court', id: 'eg-korridor', name: 'Korridor', fin: 'service' },
        { k: [17, 19], band: 'court', id: 'eg-garderobe', name: 'Garderobe', fin: 'service' },
        { k: [20, 22], band: 'court', id: 'eg-durchgang-cdl', name: 'Durchgang zum Corps de logis', fin: 'stair' },
      ],
    },
    {
      storey: 2,
      layout: 'double',
      outerWall: 0.7,
      courtPileClear: 5.6,
      enfilade: 'garden',
      zones: [
        // KB-I25: R12 OG "Vestibül und Salon im Südflügel" and "Appartement des Pfalzgrafen Max Joseph" beside the
        // Duchess's rooms (LP06 legend 3) [D names; I positions: the Pfalzgraf in the W half, the Duchess towards the CdL]
        { k: [0, 1], band: 'full', id: 'og-kopfsalon', name: 'Salon im Südflügel (Balkon über dem Portikus)', fin: 'blue', tag: 'D R12 "Vestibül und Salon im Südflügel" (name); D LC 1790 balcony over the portico; room I' },
        voidZ([2, 3], 'full', 'eg-treppe-west'),
        { k: [4, 5], band: 'garden', id: 'og-antichambre-pfalzgraf', name: 'Antichambre des Pfalzgrafen', fn: 'antechamber, apartment of Pfalzgraf Max Joseph', fin: 'boiserie', tag: 'D R12 "Appartement des Pfalzgrafen Max Joseph" (name); rooms and position (W half of the S wing OG) I' },
        { k: [6, 8], band: 'garden', id: 'og-schlafzimmer-pfalzgraf', name: 'Schlafzimmer des Pfalzgrafen Max Joseph', fn: 'bedroom of the apartment of Pfalzgraf Max Joseph', fin: 'blue', tag: 'D R12 (name); room I' },
        { k: [9, 10], band: 'garden', id: 'og-kabinett-pfalzgraf', name: 'Kabinett des Pfalzgrafen', fin: 'boiserie', tag: 'D R12 (name); room I' },
        { k: [11, 12], band: 'garden', id: 'og-kabinett-herzogin', name: 'Kabinett der Herzogin', fn: 'private cabinet of the Duchess; two portes-fenêtres onto the Altan KB-B02a over the garden gate (hypothesis)', fin: 'boiserie', tag: 'D LP06 legend 3 "Flügel der Herzogin"; rooms I; Altan access I (wave-7 review fix)' },
        { k: [13, 15], band: 'garden', id: 'og-schlafzimmer-herzogin', name: 'Schlafzimmer der Herzogin', fin: 'blue', tag: 'D LP06 legend 3 "Flügel der Herzogin"; rooms I' },
        { k: [16, 17], band: 'garden', id: 'og-salon-herzogin', name: 'Roter Salon der Herzogin', fin: 'crimson', colour: '#A33A35', border: '#E6DCC0', colourTag: 'D R12 (Stand 2003) "Roter Salon der Herzogin" (name); in her LP06 wing I; red #A33A35 N research/10 §c.2; ivory border N', tag: 'D LP06 legend 3 "Flügel der Herzogin"; D R12 room name; position I' },
        { k: [18, 19], band: 'garden', id: 'og-audienz-herzogin', name: 'Audienzzimmer der Herzogin', fin: 'crimson' },
        { k: [20, 22], band: 'garden', id: 'og-antichambre1', name: 'Antichambre der Herzogin', fin: 'boiserie' },
        { k: [4, 7], band: 'court', id: 'og-dienerzimmer-west', name: 'Garderobe und Dienerzimmer', fin: 'service' },
        { k: [8, 10], band: 'court', id: 'og-alkovenkammer', name: 'Garderobe (hinter dem Alkoven)', fin: 'service' },
        { k: [11, 12], band: 'court', id: 'og-kammer', name: 'Kammer', fin: 'service' },
        { k: [13, 16], band: 'court', id: 'og-korridor', name: 'Korridor', fin: 'service' },
        { k: [17, 19], band: 'court', id: 'og-dienerzimmer', name: 'Dienerzimmer', fin: 'service' },
        { k: [20, 22], band: 'court', id: 'og-durchgang-cdl', name: 'Durchgang zum Corps de logis', fin: 'service' },
      ],
    },
  ],
  passages: [{ id: 'sued-cdl', storeys: [1, 2], side: 'court', at: 30.5, atByStorey: { 2: 32.3 }, to: 'KB-B01', tag: 'I link to the CdL court pile (Dienertreppe Süd); OG 1.8 m further E, in line with the CdL landing door (fix round 1)' }],
  interiorTag: 'KB-I25 (research/10 §0.4, §b.1): EG guest apartments, vestibule with stair, Durchfahrt; OG Salon im Südflügel, apartment of Pfalzgraf Max Joseph, Duchess towards the CdL (R12 names D, LP06 "Flügel der Herzogin" D; positions I); the HMS dining-room / Silberkammer caption is retired (T5, T1 p. 338); double pile N',
};

const NORD: Prog = {
  id: 'KB-B03',
  p: 3.15,
  s0: (L) => L / 2 - 1.125 - 3.15 / 2 - 18 * 3.15,
  kmin: -4,
  kmax: 18,
  garden: [2, 14],
  court: [0, 18],
  end_a: [-5.395, -0.395, 4.605],
  end_b: [-5.395, -0.395, 4.605],
  sideTag: 'spacing 3.15 HMS; 19 court axes on the open Ehrenhof face, 13 Küchenhof axes between the Sammlungsflügel and the Küchenbau I; ends 3 axes on the pile centres I',
  portals: (ax) => [
    {
      side: 'court',
      axis: ax('court', 8, 2),
      kind: 'durchfahrt',
      span_axes: 2,
      storey: 1,
      // wave-8 review fix (KB-I72): LC 1790 shows a columned porch in the N wing centre, PL a balcony in each wing centre
      portico: { columns: 4, balcony: true, depth: 3.0, tag: 'D LC 1790 columned porch in the N wing centre + D PL balcony in each wing centre (research/07 §1.1); placed on the court Durchfahrt (the centre of the court face) I; grouped Tuscan columns N (HMS junction portico, 06); 4 columns, depth 3.0 m N/I; low' },
      tag: 'HMS Durchfahrt to the Küchenhof u -6.1..-0.4 -> grid axes 8-9',
    },
    { side: 'court', axis: ax('court', 8, 2), kind: 'porte_fenetre', span_axes: 2, storey: 2, balconet: false, tag: 'I portes-fenêtres onto the porch balcony (KB-I72; D LC porch, D PL wing-centre balcony; doors N)' },
    { side: 'garden', axis: ax('garden', 8, 2), kind: 'durchfahrt', span_axes: 2, storey: 1, tag: 'HMS' },
  ],
  floors: [
    {
      storey: 1,
      layout: 'double_corridor',
      outerWall: 0.7,
      courtPileClear: 8.0,
      corridorClear: 2.2,
      zones: [
        stairZone([-4, -1], 'full', 'eg-treppe-ost', 'Treppenhaus Ost', 'dogleg', 'secondary', 2, [0, 1], 'N; link to the CdL'),
        { k: [0, 2], band: 'court', id: 'eg-wachstube', name: 'Wachstube', fn: 'guard room', fin: 'service', tag: 'HMS EG guard; I' },
        { k: [3, 4], band: 'court', id: 'eg-offiziere', name: 'Offizierszimmer der Wache', fin: 'service' },
        { k: [5, 7], band: 'court', id: 'eg-kavaliere-1', name: 'Kavalierszimmer', fn: 'courtiers\' rooms', fin: 'boiserie', tag: 'I 05 §e.2 (Kavaliere)' },
        { k: [0, 7], band: 'corridor', id: 'eg-korridor-ost', name: 'Korridor', fin: 'service', tag: 'N double pile with corridor (02 §2.11)' },
        // KB-I25 (research/10 §b.1 KB-B03; history-check H08): the Silberkammer is in the N wing (T5), on the EG at the
        // Küchenhof access next to the kitchen link (R12 EG 6 "Porzellan- und Silberkammern") [D wing; I position]
        { k: [0, 1], band: 'garden', id: 'eg-silberdiener', name: 'Silberdiener', fn: 'silver servants next to the kitchen link', fin: 'service', tag: 'I (moved from the S wing with the silver chamber, KB-I25)' },
        { k: [2, 4], band: 'garden', id: 'eg-silberkammer', name: 'Silberkammer (Porzellan- und Silberkammern)', fn: 'silver and porcelain chamber at the Küchenhof access', fin: 'service', tag: 'D T5 Silberkammer in the N wing; D R12 EG 6 "Porzellan- und Silberkammern" with the kitchen rooms (name); EG and position I' },
        { k: [5, 7], band: 'garden', id: 'eg-kammer-2', name: 'Kammer', fin: 'service' },
        { k: [8, 9], band: 'full', id: 'eg-durchfahrt', name: 'Durchfahrt zum Küchenhof', fn: 'carriage passage', fin: 'passage', tag: 'HMS' },
        { k: [10, 12], band: 'court', id: 'eg-kavaliere-2', name: 'Kavalierszimmer', fin: 'boiserie' },
        { k: [13, 15], band: 'court', id: 'eg-kavaliere-3', name: 'Kavalierszimmer', fin: 'boiserie' },
        { k: [10, 15], band: 'corridor', id: 'eg-korridor-west', name: 'Korridor', fin: 'service' },
        { k: [10, 12], band: 'garden', id: 'eg-kammer-3', name: 'Kammer', fin: 'service' },
        { k: [13, 15], band: 'garden', id: 'eg-registratur', name: 'Registratur', fin: 'service' },
        stairZone([16, 18], 'full', 'eg-treppe-west', 'Treppenhaus West', 'dogleg', 'secondary', 2, [0, 1], 'N; link to the Sammlungsflügel'),
      ],
    },
    {
      storey: 2,
      layout: 'double_corridor',
      outerWall: 0.7,
      courtPileClear: 8.0,
      corridorClear: 2.2,
      enfilade: 'court',
      zones: [
        voidZ([-4, -1], 'full', 'eg-treppe-ost'),
        { k: [0, 2], band: 'court', id: 'og-antichambre', name: 'Antichambre des Herzogs (Rotes Vorzimmer)', fin: 'crimson', colour: '#9B2D2A', border: '#D8C690', colourTag: `${R12_DUKE}; red #9B2D2A N research/10 §c.2; straw border N`, tag: 'D LP06 legend 2 "Flügel des Herzogs"; rooms I' },
        { k: [3, 5], band: 'court', id: 'og-audienz', name: 'Audienzzimmer des Herzogs', fin: 'crimson' },
        { k: [6, 9], band: 'court', id: 'og-salon', name: 'Salon des Herzogs (Grauer Salon)', fin: 'grey', colour: '#A7A9A4', border: '#5E6B7C', colourTag: `${R12_DUKE}; grey #A7A9A4 N research/10 §c.2; blue-grey border N` },
        { k: [10, 12], band: 'court', id: 'og-schlafzimmer', name: 'Schlafzimmer des Herzogs (Grünes Schlafzimmer)', fin: 'green', colour: '#5E7F5B', border: '#E4DAC0', colourTag: `${R12_DUKE}; green #5E7F5B N research/10 §c.2; ivory border N` },
        { k: [13, 13], band: 'court', id: 'og-kabinett', name: 'Kabinett (Kirschrotes Kabinett)', fin: 'crimson', colour: '#8E2F3A', border: '#D8C690', colourTag: `${R12_DUKE}; cherry #8E2F3A N research/10 §c.2; straw border N` },
        { k: [14, 15], band: 'court', id: 'og-salon-mannlich', name: 'Salon Mannlich', fn: 'dining salon next to the Duke\'s rooms: tiered flowers and trees between the windows, a round table with a copper fountain basin (T1 pp. 392 f.)', fin: 'boiserie', tag: 'D T5 nn. 42-44 "Salon Mannlich" next to the Duke\'s room (name, neighbourhood); D T1 pp. 392 f. (furnishing); position I' },
        { k: [0, 15], band: 'corridor', id: 'og-korridor', name: 'Korridor', fin: 'service' },
        // KB-I25 (research/10 §0.4, §b.1 KB-B03; history-check H08): "kleiner und großer Bildersaal im ersten
        // Obergeschoss" and a Tanzsaal in the N wing (T5); the Küchenhof side gives the north light for the hang [I]
        { k: [0, 1], band: 'garden', id: 'og-garderobe-1', name: 'Garderobe', fin: 'service' },
        { k: [2, 6], band: 'garden', id: 'og-grosser-bildersaal', name: 'Großer Bildersaal', fn: 'picture room hung so densely that a chair-height rail protected the pictures ("Obacht auf die Bilder!")', fin: 'green', tag: 'D T5 "kleiner und großer Bildersaal im ersten Obergeschoss" (accounts); 60 Schuh (≈ 19.5 m D->) of chair rails in the Duke\'s wing (LA Speyer B3 2584 Bl. 143 via T5); position on the Küchenhof side I; green ground N' },
        { k: [7, 9], band: 'garden', id: 'og-kleiner-bildersaal', name: 'Kleiner Bildersaal', fn: 'smaller picture room', fin: 'green', tag: 'D T5 (accounts, name and floor); position I' },
        { k: [10, 15], band: 'garden', id: 'og-tanzsaal', name: 'Tanzsaal', fn: 'dance hall of the N wing', fin: 'boiserie', tag: 'D T5 Tanzsaal in the N wing (name); floor and position U (here OG beside the Bildersäle I); also UP-18 "Ballhaus" (research/10 §b.6)' },
        voidZ([16, 18], 'full', 'eg-treppe-west'),
      ],
    },
  ],
  passages: [
    { id: 'nord-cdl', storeys: [1, 2], side: 'court', at: -29.45, to: 'KB-B01', tag: 'I link to the CdL (Durchgang Nord)' },
    { id: 'nord-sammlung', storeys: [1, 2], side: 'garden', at: 29.95, to: 'KB-B04', tag: 'I link to the Sammlungsflügel' },
    { id: 'nord-kueche', storeys: [1], side: 'garden', at: -27.8, to: 'KB-B05', tag: 'I service link to the Küchenbau (Anrichte)' },
  ],
  interiorTag: 'LP06 "Flügel des Herzogs" (Duke on the OG, D); KB-I25: OG Bildersäle, Tanzsaal and Salon Mannlich (T5, D names; positions I), EG Silberkammer at the Küchenhof access (T5, R12; I); EG guard / courtiers (HMS, I); double pile with corridor on the 20 m LiDAR depth N',
};

const SAMMLUNG: Prog = {
  id: 'KB-B04',
  p: 3.0,
  s0: () => -(19 * 3.0) / 2 + 1.5,
  kmin: 0,
  kmax: 18,
  garden: [0, 18],
  court: [2, 18],
  end_a: [-3.0, 0, 3.0],
  end_b: 'blind',
  sideTag: '19 axes HMS (scale-free count) at 3.0 m on the LiDAR length; court face from the gallery corner I',
  portals: (ax) => [
    { side: 'garden', axis: ax('garden', 16, 2), kind: 'durchfahrt', span_axes: 2, storey: 1, tag: 'HMS carriage gate with sentry boxes (v 45.5-48.5) -> grid axes 16-17' },
    { side: 'court', axis: ax('court', 16, 2), kind: 'durchfahrt', span_axes: 2, storey: 1, tag: 'HMS' },
  ],
  floors: [
    {
      storey: 1,
      layout: 'single',
      outerWall: 0.7,
      zones: [
        stairZone([0, 1], 'full', 'eg-treppe-nord', 'Treppenhaus Nord', 'dogleg', 'secondary', 2, [0, 1], 'I half landing 348.8 = gallery floor (KB-B06)'),
        // KB-I25 (research/10 §0.5, §b.1 KB-B04; history-check H07): EG = Wachtstube + the Hofbibliothek in four rooms in
        // a row "160 Schuh" long (≈ 52 m) left of it [D T5 accounts + T7 no. 2; T5 > R12 2003]. Here 4 x 3 axes
        // (≈ 36 m): the 57 m LiDAR wing also holds the N stair (gallery landing), the guard room and the HMS gate [I].
        { k: [2, 4], band: 'full', id: 'eg-bibliothek', name: 'Hofbibliothek', fn: 'court library, first of four rooms in a row: oak cases floor to ceiling, Greek-key frieze; the one room with brass-wire doors on crimson taffeta (T5)', fin: 'boiserie', tag: 'D T5 "Hofbibliothek in vier hintereinanderliegenden Räumen", 160 Schuh ≈ 52 m (here 36 m I); oak cases, frieze "a la greece" D T5 (KB-I27); brass-wire doors on crimson taffeta in one room D T5, which room U: the first (at the N stair) I; position N end I' },
        { k: [5, 7], band: 'full', id: 'eg-bibliothek-2', name: 'Hofbibliothek II', fn: 'court library, second room: oak cases floor to ceiling, Greek-key frieze', fin: 'boiserie', tag: 'D T5 (four rooms; oak cases and frieze for the library); I' },
        { k: [8, 10], band: 'full', id: 'eg-bibliothek-3', name: 'Hofbibliothek III', fn: 'court library, third room: oak cases floor to ceiling, Greek-key frieze', fin: 'boiserie', tag: 'D T5 (four rooms; oak cases and frieze for the library); I' },
        { k: [11, 13], band: 'full', id: 'eg-bibliothek-4', name: 'Hofbibliothek IV', fn: 'court library, fourth room: oak cases floor to ceiling, Greek-key frieze', fin: 'boiserie', tag: 'D T5 (four rooms, left of the Wachtstube; oak cases and frieze for the library); I' },
        { k: [14, 15], band: 'full', id: 'eg-wachstube', name: 'Wachtstube am Tor', fin: 'service', tag: 'D T5 Wachtstube on the EG; HMS sentry boxes at the gate; I' },
        { k: [16, 17], band: 'full', id: 'eg-durchfahrt', name: 'Durchfahrt (Tor zur Paradestraße)', fin: 'passage', tag: 'HMS' },
        stairZone([18, 18], 'full', 'eg-treppe-sued', 'Treppenhaus Süd', 'dogleg', 'service', 2, [0, 1], 'N; link to the N arm'),
      ],
    },
    {
      storey: 2,
      layout: 'single',
      outerWall: 0.7,
      zones: [
        voidZ([0, 1], 'full', 'eg-treppe-nord'),
        // KB-I25: 1st OG = Naturalienkabinett with the Waffensammlung rooms adjoining [D T5 (T7 no. 2; LA Speyer B3 2609)]
        { k: [2, 7], band: 'full', id: 'og-naturalienkabinett', name: 'Naturalienkabinett', fn: 'natural-history cabinet: white-painted glass cabinets, display tables', fin: 'boiserie', tag: 'D T5 Naturalienkabinett on the 1st OG; white glass cabinets D T5 (KB-I27); position in the wing I' },
        { k: [8, 12], band: 'full', id: 'og-waffensammlung', name: 'Waffensammlung', fn: 'armoury collection: white panelling, three large mirror doors, gun racks, inlaid table with green cloth', fin: 'boiserie', tag: 'D T5 Waffensammlung adjoining the Naturalienkabinett on the 1st OG; white wooden panelling D T5 (boiserie); position I' },
        { k: [13, 14], band: 'full', id: 'og-physik', name: 'Physikalisches Kabinett', fin: 'boiserie', tag: 'D physikalisches Kabinett (05 §e.2); 1st OG I (research/10 §b.1); position I' },
        { k: [15, 17], band: 'full', id: 'og-kupferstich', name: 'Kupferstichkabinett (?)', fin: 'boiserie', tag: 'U (05 §e.2 "probably")' },
        voidZ([18, 18], 'full', 'eg-treppe-sued'),
      ],
    },
  ],
  passages: [
    { id: 'sammlung-galerie', storeys: [1], side: 'court', at: -26.7, to: 'KB-B06', sill: 2.6, height: 2.4, tag: 'I door from the N stair half landing (348.8) into the gallery' },
    // KB-I52 (review-1 #18): the OG door onto the upper gallery of the Treppenhaus Süd (the half landing lies on the
    // hall's middle, t 0 ± 0.5 m, 2.5 m below the Beletage floor), so the OG link sits 3 m off the middle [I]
    { id: 'sammlung-nord', storeys: [1, 2], side: 'end_b', at: 0, atByStorey: { 2: 3.0 }, to: 'KB-B03', tag: 'I link to the N arm; OG door on the upper gallery of the Treppenhaus Süd (KB-I52)' },
  ],
  // KB-I52: the Kupferstichkabinett is entered from the Physikalisches Kabinett (enfilade); its door onto the stair
  // would open over the half landing [I]
  skipDoors: ['door-B04.2.og-kupferstich-B04.1.eg-treppe-sued'],
  interiorTag: 'KB-I25 (research/10 §0.5, §b.1): EG Wachtstube + Hofbibliothek in four rooms, 1st OG Naturalienkabinett, Waffensammlung, physical cabinet [D T5 > R12 2003; positions I]; the gunsmith is KB-B40 (trapdoor from the gallery, T5 n. 62); single pile on the 13 m LiDAR depth',
};

const KUECHE: Prog = {
  id: 'KB-B05',
  p: 3.2,
  s0: () => -(14 * 3.2) / 2 + 1.6,
  kmin: 0,
  kmax: 13,
  garden: [0, 13],
  court: [0, 13],
  end_a: 'blind',
  end_b: [-3.2, 0, 3.2],
  sideTag: 'spacing 3.2 HMS -> 14 axes on 45.9 m I; S end against the N arm blind',
  portals: (ax) => [
    { side: 'court', axis: ax('court', 7), kind: 'door', storey: 1, tag: 'I kitchen door to the Küchenhof' },
    { side: 'court', axis: ax('court', 12), kind: 'door', storey: 1, tag: 'I scullery door (axis 12 since the two-axis Küchenbautreppe, KB-I52)' },
  ],
  floors: [
    {
      storey: 1,
      layout: 'single',
      outerWall: 0.7,
      zones: [
        { k: [0, 1], band: 'full', id: 'eg-anrichte', name: 'Anrichte (Durchgang zum Nordflügel)', fn: 'serving room', fin: 'kitchen', tag: 'I serving link to the palace' },
        { k: [2, 4], band: 'full', id: 'eg-konditorei', name: 'Konditorei', fin: 'kitchen', tag: 'D Konditorei (05 §e.2); position I' },
        { k: [5, 9], band: 'full', id: 'eg-hofkueche', name: 'Hofküche', fn: 'vaulted court kitchen, open hearth and Potager ranges', fin: 'kitchen', tag: 'D Hofküche 1779/80-84 (KB-06 block); 16 x 11.7 m I (05: 12 x 16 m); S wall on the line of the KB-06 S wall D LiDAR' },
        // KB-I52 (review-1 #18): the Küchenbautreppe takes two axes, so its first flight leaves the Hofküche door free
        // (a 3.2 m hall forced a three-flight stair whose first flight ran past that door) [I]
        stairZone([10, 11], 'full', 'eg-treppe', 'Küchenbautreppe', 'dogleg', 'service', 2, [0, 1], 'D R12 OG 25 "Küchenbautreppe" (name); N; two axes I (KB-I52)'),
        { k: [12, 12], band: 'full', id: 'eg-spuelkueche', name: 'Spülküche', fin: 'kitchen', tag: 'D Spülküche (05 §e.2); position I' },
        { k: [13, 13], band: 'full', id: 'eg-baeckerei', name: 'Bäckerei', fin: 'kitchen', tag: 'D Bäckerei (05 §e.2); position I' },
      ],
    },
    {
      storey: 2,
      layout: 'single',
      outerWall: 0.7,
      zones: [
        // KB-I25 (research/10 §0.4, §b.1 KB-B05; history-check H06): "einen großen, schönen Speisesaal im ersten
        // Stockwerk" of the kitchen wing, with two niches for the O4 stoves [D T1 pp. 338, 341; R12 OG 24]; S part
        // next to the N wing I; cooks' lodgings in the mansard I
        // fix wave 4 (review): 7 axes with a centre axis (k 3), and the vestibule between the hall and the stair landing
        // (k 7-9 next to the stair void k 10), so guests come up the Küchenbautreppe into the vestibule [I]
        { k: [0, 6], band: 'full', id: 'og-speisesaal', name: 'Großer Speisesaal', fn: 'state dining hall with two stove niches (altar-shaped enamelled-copper stoves crowned by bronze Ceres and Diana/Hebe, O4)', fin: 'boiserie', tag: 'D T1 p. 338 (Mannlich 1910) + R12 OG 24 "Großer Speisesaal" (name, floor); two stove niches D T1 p. 341, T26 (O4); position in the S part and 7 axes I; finish N' },
        { k: [7, 9], band: 'full', id: 'og-vestibuel', name: 'Vestibül des Küchenflügels', fn: 'vestibule between the Küchenbautreppe and the dining hall', fin: 'stair', tag: 'D R12 OG 28 "Vestibül des Küchenflügels" (name); position at the stair landing I' },
        voidZ([10, 11], 'full', 'eg-treppe'),
        { k: [12, 12], band: 'full', id: 'og-kuechenschreiber', name: 'Küchenschreiberei', fin: 'service', tag: 'N kitchen office of a court kitchen (name and position I; not in the sources)' },
        { k: [13, 13], band: 'full', id: 'og-mundkoch', name: 'Wohnung des Mundkochs', fin: 'service', tag: 'I cooks\' rooms (05 §e.2); most cooks in the mansard I (research/10 §b.1)' },
      ],
    },
  ],
  passages: [{ id: 'kueche-nord', storeys: [1], side: 'end_a', at: -3.0, to: 'KB-B03', tag: 'I serving link to the N arm' }],
  interiorTag: 'kitchen rooms named in research/05 §e.2 (D/I), positions I; KB-I25: Großer Speisesaal on the OG (T1 pp. 338, 341; R12 OG 24-28, D); single pile',
};

const GALERIE: Prog = {
  id: 'KB-B06',
  p: 3.9,
  s0: () => -(21 * 3.9) / 2 + 1.95,
  kmin: 0,
  kmax: 20,
  // KB-I24: one glass door in the N hanging wall to the Bibliothekspavillon KB-B06a (axis 14) and a glazed door at the
  // E end into the colonnade of the Tempelzimmer KB-B07 (research/10 §b.1)
  garden: [14, 14],
  court: [0, 20],
  end_a: [0],
  end_b: 'blind',
  sideTag: 'S-lit gallery, N hanging wall closed N 02; 21 axes at 3.9 I',
  portals: (ax) => [
    { side: 'garden', axis: ax('garden', 14), kind: 'porte_fenetre', storey: 1, tag: 'D T1/T5 glass door from the middle of the gallery to the Bibliothekspavillon (KB-B06a); N side and axis I (research/10 §b.1)' },
    { side: 'end_a', axis: 0, kind: 'porte_fenetre', storey: 1, tag: 'I glazed door from the gallery into the colonnade to the Tempelzimmer (KB-B07; D T1 p. 375, R12 sequence)' },
  ],
  floors: [
    {
      storey: 1,
      layout: 'single',
      // KB-I21: the gallery is rendered Fachwerk (catalogue facade.fachwerk): a 0.30 m outer wall (grammar FACHWERK)
      outerWall: FACHWERK.wall,
      zones: [
        { k: [0, 1], band: 'full', id: 'kabinett-ost', name: 'Kabinett am Ostende (Vorraum zur Kolonnade)', fn: 'small picture cabinet; glazed door to the colonnade and the Tempelzimmer', fin: 'green', tag: 'I (KB-I24: the gallery runs into the colonnade and the Tempelzimmer, research/10 §b.1)' },
        { k: [2, 18], band: 'full', id: 'bildergalerie', name: 'Bildergalerie', fn: 'picture gallery, hanging wall N, light from the S; glass door to the Bibliothekspavillon; walls boarded and hung with green damask with arabesques (Lyon), 20 crystal chandeliers, gilt-bronze side tables with six-arm candelabra on the piers, 104 gilt curule armchairs in the same damask with gold fringes', fin: 'green', colour: '#4E6B4F', colourTag: 'D T1 pp. 374 f. / T5 green damask with arabesques (Lyon); hue #4E6B4F N research/10 §c.3', tag: 'D picture gallery (collection -> Alte Pinakothek); 66 x 6.7 m I; parquet D (05 §e.2, T1 p. 394); green damask D T1 pp. 374 f.' },
        { k: [19, 20], band: 'full', id: 'vorraum-west', name: 'Vorraum (vom Sammlungsflügel)', fin: 'boiserie' },
      ],
    },
  ],
  passages: [
    { id: 'galerie-sammlung', storeys: [1], side: 'end_b', at: 2.0, to: 'KB-B04', tag: 'I door from the Sammlungsflügel stair landing' },
  ],
  interiorTag: 'one long hall (05 §e.2) on the v2 8 m range; KB-I24: colonnade and Tempelzimmer at the E end, Bibliothekspavillon off the N wall (research/10 §b.1)',
};

const ORANGERIE: Prog = {
  id: 'KB-B10',
  p: 3.3,
  s0: () => -(25 * 3.3) / 2 + 1.65,
  kmin: 0,
  kmax: 24,
  garden: [0, 24],
  court: [4, 20],
  end_a: [-1.65, 1.65],
  end_b: [-1.65, 1.65],
  sideTag: '25 ± 1 axes HMS at 3.3 m on the 84 m LiDAR length; parterre face only between the wings KB-B11/B12 (grid aligned) I',
  windowKinds: {
    garden: { kind: 'window', tag: 'W front: two tiers of sill windows above the high basement (HMS research/08 §4; facade.windows), portes-fenêtres only on the parterre (E) side' },
    // wave-6 review fix: floor-length portes-fenêtres only where the Saalgeschoss opens onto the parterre; the courtiers'
    // upper tier (Logis der Kavaliere) has sill windows on every front, like the HMS upper W tier [I]
    court: { kind: 'window', storeys: [2], tag: 'upper tier (courtiers\' lodgings): sill windows as on the W front (HMS upper W tier) I; portes-fenêtres only on the Saalgeschoss' },
    end_a: { kind: 'window', storeys: [2], tag: 'upper tier: sill windows I' },
    end_b: { kind: 'window', storeys: [2], tag: 'upper tier: sill windows I' },
  },
  portals: (ax) => [{ side: 'garden', axis: ax('garden', 12), kind: 'door', storey: 0, tag: 'I basement door on the W bench (TF-07), Sommellerie access' }],
  risalits: (ax) => [
    { side: 'garden', first_axis: ax('garden', 11, 3), axis_count: 3, kind: 'centre', projection: 0.5, pediment: true, tag: 'HMS 3-axis pedimented centre (W front)' },
    { side: 'court', first_axis: ax('court', 11, 3), axis_count: 3, kind: 'centre', projection: 0.5, pediment: true, tag: 'I parterre side mirrors the W front' },
  ],
  floors: [
    {
      storey: 0,
      layout: 'single',
      outerWall: 1.0,
      zones: [
        stairZone([0, 1], 'full', 'k-treppe-nord', 'Treppenhaus Nord', 'dogleg', 'secondary', 1, [0, 1], 'N', false),
        { k: [2, 3], band: 'full', id: 'k-keller-nord', name: 'Kellerraum', fin: 'cellar' },
        { k: [4, 12], band: 'full', id: 'k-sommellerie', name: 'Sommellerie (Weinkeller)', fn: 'cellarage', fin: 'cellar', tag: 'D PV 1791 b. "la Sommellerie"; high basement D LiDAR; position I' },
        { k: [13, 20], band: 'full', id: 'k-vorratskeller', name: 'Vorratskeller', fin: 'cellar', tag: 'I' },
        { k: [21, 22], band: 'full', id: 'k-keller-sued', name: 'Kellerraum', fin: 'cellar' },
        stairZone([23, 24], 'full', 'k-treppe-sued', 'Treppenhaus Süd', 'dogleg', 'secondary', 1, [0, -1], 'N', false),
      ],
    },
    {
      storey: 1,
      layout: 'single',
      outerWall: 1.0,
      zones: [
        stairZone([0, 1], 'full', 's-treppe-nord', 'Treppenhaus Nord', 'dogleg', 'secondary', 2, [0, 1], 'N', false),
        { k: [2, 3], band: 'full', id: 's-gaertner-nord', name: 'Gärtnerstube', fin: 'service', tag: 'N' },
        { k: [4, 20], band: 'full', id: 's-pfeilersaal', name: 'Pfeilersaal (Orangerie und Festsaal)', fn: 'citrus overwintering, summer festival hall', fin: 'orangery', double: true, tag: 'D floor-length windows (skb); double height through the upper tier I (HMS two window rows)' },
        { k: [21, 22], band: 'full', id: 's-gaertner-sued', name: 'Gärtnerstube', fin: 'service', tag: 'N' },
        stairZone([23, 24], 'full', 's-treppe-sued', 'Treppenhaus Süd', 'dogleg', 'secondary', 2, [0, -1], 'N', false),
      ],
    },
    {
      storey: 2,
      layout: 'single',
      outerWall: 0.85,
      zones: [
        { k: [0, 1], band: 'full', id: 'o-treppe-nord', name: 'Treppenhaus Nord (Austritt)', fin: 'stair' },
        { k: [2, 3], band: 'full', id: 'o-kavaliere-nord', name: 'Logis der Kavaliere', fin: 'boiserie', tag: 'D PV 1791 b. "demeure des Courtisans"; over the end bays I' },
        voidZ([4, 20], 'full', 's-pfeilersaal'),
        { k: [21, 22], band: 'full', id: 'o-kavaliere-sued', name: 'Logis der Kavaliere', fin: 'boiserie', tag: 'D PV 1791 b.; I' },
        { k: [23, 24], band: 'full', id: 'o-treppe-sued', name: 'Treppenhaus Süd (Austritt)', fin: 'stair' },
      ],
    },
  ],
  passages: [],
  interiorTag: 'PV 1791 b. (orangery + courtiers + Sommellerie, D); layout I',
};

/**
 * KB-I28: Orangerie N wing. "Im Erdgeschoss eines Seitenflügels" the court gunsmith and clockmaker had their workshops
 * [D Schwan 2010 p. 317 via T5]; drawn here at the W end next to the main range, because the S wing carries the
 * Komödienhaus [I]. The rest of the wing is a plant hall [D orangery wings 1780-83, 01 §1.2]. 9 axes at 3.9 m as the
 * catalogue facade; +s runs W (the W end adjoins KB-B10 and stays blind).
 */
const WERKSTATT_TAG = 'D Schwan 2010 p. 317 via T5 (research/10 §b.2): workshops of the court gunsmith and clockmaker in the EG of an Orangerie side wing; this wing and position I';
const ORANGERIE_NORD: Prog = {
  id: 'KB-B11',
  p: 3.9,
  s0: () => -(9 * 3.9) / 2 + 1.95,
  kmin: 0,
  kmax: 8,
  garden: [0, 8],
  court: [0, 8],
  end_a: [-1.95, 1.95],
  end_b: 'blind',
  sideTag: '9 axes at 3.9 m (catalogue); W end against the main range KB-B10 I',
  portals: (ax) => [{ side: 'court', axis: ax('court', 7), kind: 'door', storey: 1, tag: 'I workshop door from the Orangerie court' }],
  floors: [
    {
      storey: 1,
      layout: 'single',
      outerWall: 1.0,
      zones: [
        { k: [0, 4], band: 'full', id: 'n-pflanzenhalle', name: 'Pflanzenhalle (Orangerie, Nordflügel)', fn: 'citrus and plant overwintering', fin: 'orangery', tag: 'D orangery wings 1780-83 (01 §1.2); I' },
        { k: [5, 6], band: 'full', id: 'n-werkstatt-uhrmacher', name: 'Werkstatt des Hofuhrmachers', fn: 'clockmaker\'s workshop', fin: 'service', tag: WERKSTATT_TAG },
        { k: [7, 8], band: 'full', id: 'n-werkstatt-buechsenmacher', name: 'Werkstatt des Büchsenmachers', fn: 'gunsmith\'s workshop', fin: 'service', tag: WERKSTATT_TAG },
      ],
    },
  ],
  passages: [],
  interiorTag: 'KB-I28: plant hall + two workshops (D Schwan 2010 p. 317 via T5; wing and layout I)',
};

export const PROGRAMMES: Prog[] = [CDL, SUED, NORD, SAMMLUNG, KUECHE, GALERIE, ORANGERIE, ORANGERIE_NORD];

// ---------------------------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------------------------

const PART = PARTITION_WALL;

interface Geo {
  L: number;
  W: number;
  s: (k: number) => number;
}

function sideFromGrid(g: Geo, p: number, side: 'garden' | 'court', range: [number, number] | 'blind', tag: string): FacadeSideSpec {
  if (range === 'blind') return { axes: 0, blind: true, tag };
  const [ka, kb] = range;
  const axes = kb - ka + 1;
  const from = side === 'garden' ? g.s(ka) - p / 2 + g.L / 2 : g.L / 2 - (g.s(kb) + p / 2);
  return { axes, spacing: p, from: r3(from), to: r3(from + axes * p), tag };
}

function endFromT(W: number, side: 'end_a' | 'end_b', ts: number[] | 'blind', tag: string): FacadeSideSpec {
  if (ts === 'blind' || !ts.length) return { axes: 0, blind: true, tag: `${tag}; blind (adjoining wing) I` };
  const sorted = [...ts].sort((a, b) => a - b);
  const spacing = sorted.length > 1 ? sorted[1] - sorted[0] : 3.0;
  const tmin = sorted[0];
  const tmax = sorted[sorted.length - 1];
  const from = side === 'end_b' ? tmin - spacing / 2 + W / 2 : W / 2 - tmax - spacing / 2;
  return { axes: sorted.length, spacing: r3(spacing), from: r3(from), to: r3(from + sorted.length * spacing), tag };
}

function bandsOf(f: Floor, W: number): Record<Band, PileBand | undefined> {
  const bands = pileBands(W, { outerWall: f.outerWall, layout: f.layout, courtPileClear: f.courtPileClear, corridorClear: f.corridorClear });
  const by = (n: PileBand['name']) => bands.find((b) => b.name === n);
  const single = by('single');
  const tg = -W / 2 + f.outerWall;
  const tc = W / 2 - f.outerWall;
  return {
    garden: by('garden') ?? single,
    court: by('court') ?? single,
    corridor: by('corridor'),
    full: { name: 'single', t0: tg, t1: tc },
  };
}

interface Placed {
  zone: Zone;
  roomId: string;
  sL: number;
  sR: number;
  t0: number;
  t1: number;
  isStair: boolean;
}

export interface ProgrammeResult {
  rooms: Room[];
  openings: Opening[];
  stairs: Stair[];
}

export function buildProgramme(prog: Prog, b: Building, spec: SiteSpec): ProgrammeResult & { facade: Pick<Building['facade'], 'sides' | 'portals' | 'risalits'>; raised?: RaisedRoofSection[] } {
  const frame = buildingFrame(b.footprint!, { courtToward: resolveCourtToward(spec, b.court_toward, centroid(b.footprint!) as EN) });
  const L = frame.length;
  const W = frame.width;
  const s0 = prog.s0(L);
  const g: Geo = { L, W, s: (k) => s0 + prog.p * k };
  const stack = storeyStack(b);
  const pfx = `${b.id.replace('KB-', '')}`;

  // ---- facade on the grid
  const axisOf: AxisOf = (side, k, span = 1) => {
    const range = side === 'garden' ? prog.garden : prog.court;
    if (range === 'blind') throw new Error(`${b.id}: ${side} is blind`);
    const ax = side === 'garden' ? k - range[0] : range[1] - (k + span - 1);
    if (ax < 0 || ax + span - 1 > range[1] - range[0]) throw new Error(`${b.id}: grid ${k}+${span} outside the ${side} axes`);
    return ax;
  };
  const sides: Partial<Record<SideName, FacadeSideSpec>> = {
    garden: sideFromGrid(g, prog.p, 'garden', prog.garden, prog.sideTag),
    court: sideFromGrid(g, prog.p, 'court', prog.court, prog.sideTag),
    end_a: endFromT(W, 'end_a', prog.end_a, prog.sideTag),
    end_b: endFromT(W, 'end_b', prog.end_b, prog.sideTag),
  };
  for (const [side, wk] of Object.entries(prog.windowKinds ?? {}) as [SideName, { kind: 'window' | 'porte_fenetre'; storeys?: number[]; tag: string }][]) {
    const sd = sides[side];
    if (sd) sides[side] = { ...sd, window_kind: wk.kind, ...(wk.storeys ? { window_kind_storeys: wk.storeys } : {}), tag: `${sd.tag ?? ''}; ${wk.tag}` };
  }

  // ---- rooms
  const rooms: Room[] = [];
  const stairs: Stair[] = [];
  const openings: Opening[] = [];
  const placedByStorey = new Map<number, Placed[]>();
  const roomIdOf = (z: Zone, storey: number) => `${pfx}.${storey}.${z.voidOf ?? z.id}`;
  const doubleRooms = new Map<string, Placed>();

  for (const f of prog.floors) {
    const level = stack.levels[f.storey];
    if (!level?.walkable) throw new Error(`${b.id}: storey ${f.storey} is not walkable`);
    const bands = bandsOf(f, W);
    const endFace = L / 2 - f.outerWall;
    const sLeft = (k0: number) => (k0 === prog.kmin ? -endFace : (g.s(k0 - 1) + g.s(k0)) / 2 + PART / 2);
    const sRight = (k1: number) => (k1 === prog.kmax ? endFace : (g.s(k1) + g.s(k1 + 1)) / 2 - PART / 2);
    const placed: Placed[] = [];
    for (const z of f.zones) {
      const band = bands[z.band];
      if (!band) throw new Error(`${b.id} storey ${f.storey}: band ${z.band} not in layout ${f.layout}`);
      const p: Placed = { zone: z, roomId: '', sL: sLeft(z.k[0]), sR: sRight(z.k[1]), t0: band.t0, t1: band.t1, isStair: !!z.stair };
      if (z.voidOf) {
        const below = doubleRooms.get(z.voidOf);
        if (!below) throw new Error(`${b.id}: void of unknown double room ${z.voidOf}`);
        p.roomId = below.roomId;
        p.isStair = below.isStair;
        placed.push(p);
        continue;
      }
      p.roomId = roomIdOf(z, f.storey);
      const isTop = f.storey === stack.levels.length - 1;
      const topBuildUp = isTop && b.roof.type === 'mansard' ? 0.5 : 0;
      let ceiling = level.ceiling_h - topBuildUp;
      if (z.double) {
        const up = stack.levels[f.storey + 1];
        // a double room ends under the top storey's ceiling joists (mansard floor / roof tie beams)
        ceiling = up.ceiling_h - (f.storey + 1 === stack.levels.length - 1 ? 0.5 : 0);
        doubleRooms.set(z.id, p);
      }
      rooms.push({
        id: p.roomId,
        name_de: z.name,
        function: z.fn,
        storey: f.storey,
        polygon: rectST(r3(p.sL), r3(p.sR), r3(p.t0), r3(p.t1)),
        floor_h: r2(level.floor_h),
        ceiling_h: r2(ceiling),
        finish: { ...FIN[z.fin], ...(z.colour ? { colour: z.colour } : {}), ...(z.border ? { border: z.border } : {}) },
        tag: [z.tag ?? TAG_I, `finish ${FIN_TAG[z.fin]}`, ...(z.colourTag ? [`colour ${z.colourTag}`] : [])].join('; '),
      });
      if (z.stair) {
        const st = z.stair;
        const to = stack.levels[st.to];
        const run = stairRun(to.floor_h - level.floor_h, st.cls);
        stairs.push({
          id: `stair-${p.roomId}`,
          kind: st.kind,
          storey_from: f.storey,
          storey_to: st.to,
          polygon: rectST(r3(p.sL), r3(p.sR), r3(p.t0), r3(p.t1)),
          up_dir: st.up,
          riser: r3(run.riser),
          tread: r3(run.tread),
          flight_width: st.cls === 'freitreppe' ? 3.0 : STAIR[st.cls].width,
          tag: `${st.tag}; ${run.risers} risers, Blondel 2R+T = ${run.blondel.toFixed(3)} (02 §2.10)`,
        });
      }
      placed.push(p);
    }
    checkTiling(b.id, f, placed, prog);
    placedByStorey.set(f.storey, placed);

    // ---- doors between neighbours along each band
    const seen = new Set<string>();
    const bandNames: Band[] = (['garden', 'corridor', 'court'] as Band[]).filter((n) => bands[n] && (f.layout !== 'single' || n === 'garden'));
    for (const bn of bandNames) {
      const band = bands[bn]!;
      const seq = placed.filter((p) => p.zone.band === bn || p.zone.band === 'full').sort((x, y) => x.zone.k[0] - y.zone.k[0]);
      for (let i = 0; i + 1 < seq.length; i++) {
        const A = seq[i];
        const B = seq[i + 1];
        if (A.roomId === B.roomId) continue;
        const key = [A.roomId, B.roomId].sort().join('|');
        if (seen.has(key)) continue;
        // no doors into the air space of a double room unless it is a stair hall
        if ((A.zone.voidOf && !A.isStair) || (B.zone.voidOf && !B.isStair)) continue;
        seen.add(key);
        if (prog.skipDoors?.includes(`door-${A.roomId}-${B.roomId}`)) continue;
        const s = (g.s(A.zone.k[1]) + g.s(B.zone.k[0])) / 2;
        const t0 = Math.max(A.t0, B.t0, band.t0);
        const t1 = Math.min(A.t1, B.t1, band.t1);
        const enf = f.enfilade === bn;
        const dw = enf ? INTERIOR_DOOR.enfilade : INTERIOR_DOOR.single;
        let lineT: number;
        if (bn === 'garden') lineT = band.t0 + INTERIOR_DOOR.offsetFromWindowWall + dw.width / 2;
        else if (bn === 'court') lineT = band.t1 - INTERIOR_DOOR.offsetFromWindowWall - dw.width / 2;
        else lineT = (band.t0 + band.t1) / 2;
        if (f.layout === 'single') lineT = enf ? band.t0 + INTERIOR_DOOR.offsetFromWindowWall + dw.width / 2 : (band.t0 + band.t1) / 2;
        lineT = Math.min(Math.max(lineT, t0 + dw.width / 2 + 0.2), t1 - dw.width / 2 - 0.2);
        openings.push({
          id: `door-${A.roomId}-${B.roomId}`,
          kind: enf ? 'double_door' : 'door',
          storey: f.storey,
          wall: { kind: 'segment', p0: [r3(s), r3(t0)], p1: [r3(s), r3(t1)], rooms: [A.roomId, B.roomId] },
          a: r3(lineT - t0),
          width: dw.width,
          height: Math.min(dw.height, r2(level.ceiling_h - level.floor_h - 0.3)),
          sill: 0,
          head: 'straight',
          tag: enf ? `${INTERIOR_DOOR.enfilade.tag}; enfilade line ${INTERIOR_DOOR.offsetFromWindowWall} m from the window wall (02 §2.11)` : `${INTERIOR_DOOR.single.tag}`,
        });
      }
    }

    // ---- doors through the spine walls
    if (f.layout !== 'single') {
      const hub: Band = f.layout === 'double_corridor' ? 'corridor' : 'garden';
      const outerBands: Band[] = f.layout === 'double_corridor' ? ['garden', 'court'] : ['court'];
      const hubs = placed.filter((p) => p.zone.band === hub);
      for (const ob of outerBands) {
        for (const R of placed.filter((p) => p.zone.band === ob)) {
          if (R.zone.voidOf && !R.isStair) continue;
          const mid = (R.sL + R.sR) / 2;
          const H = hubs.find((h) => mid >= h.sL - 1e-6 && mid <= h.sR + 1e-6);
          if (!H || H.roomId === R.roomId) continue;
          if (H.zone.voidOf && !H.isStair) continue;
          const dw = INTERIOR_DOOR.single;
          // keep clear of cross walls of both rooms
          const lo = Math.max(R.sL, H.sL) + dw.width / 2 + 0.3;
          const hi = Math.min(R.sR, H.sR) - dw.width / 2 - 0.3;
          if (hi < lo) continue;
          const sD = Math.min(Math.max(mid, lo), hi);
          const tWall = R.t0 > H.t1 ? (H.t1 + R.t0) / 2 : (R.t1 + H.t0) / 2;
          const sA = Math.max(R.sL, H.sL);
          const sB = Math.min(R.sR, H.sR);
          openings.push({
            id: `door-${H.roomId}-${R.roomId}`,
            kind: 'door',
            storey: f.storey,
            wall: { kind: 'segment', p0: [r3(sA), r3(tWall)], p1: [r3(sB), r3(tWall)], rooms: [H.roomId, R.roomId] },
            a: r3(sD - sA),
            width: dw.width,
            height: dw.height,
            sill: 0,
            head: 'straight',
            tag: `${dw.tag}; door in the spine wall I`,
          });
        }
      }
    }
  }

  // ---- passages to the neighbouring wings
  for (const ps of prog.passages) {
    for (const storey of ps.storeys) {
      const level = stack.levels[storey];
      const at = ps.atByStorey?.[storey] ?? ps.at;
      const a = ps.side === 'garden' ? at + L / 2 : ps.side === 'court' ? L / 2 - at : ps.side === 'end_b' ? at + W / 2 : W / 2 - at;
      const width = ps.width ?? 1.3;
      const height = ps.height ?? Math.min(3.0, r2(level.ceiling_h - level.floor_h - 0.4));
      openings.push({
        id: `passage-${ps.id}-${storey}`,
        kind: 'passage',
        storey,
        wall: { kind: 'side', side: ps.side },
        a: r3(a),
        width,
        height,
        sill: ps.sill ?? 0,
        head: 'straight',
        tag: `${ps.tag} (to ${ps.to})`,
      });
    }
  }

  const portals = prog.portals?.(axisOf) ?? [];
  const risalits = prog.risalits?.(axisOf);
  const raised = prog.raised?.(axisOf);
  return { rooms, openings, stairs, facade: { sides, portals, risalits }, raised };
}

/** Every band of a floor must be covered once from kmin to kmax (full zones count for all bands). */
function checkTiling(id: string, f: Floor, placed: Placed[], prog: Prog): void {
  const bands: Band[] = f.layout === 'single' ? ['full'] : f.layout === 'double' ? ['garden', 'court'] : ['garden', 'corridor', 'court'];
  for (const bn of bands) {
    const seq = placed.filter((p) => p.zone.band === bn || p.zone.band === 'full' || f.layout === 'single').sort((x, y) => x.zone.k[0] - y.zone.k[0]);
    let k = prog.kmin;
    for (const p of seq) {
      if (p.zone.k[0] !== k) throw new Error(`${id} storey ${f.storey} band ${bn}: zone ${p.zone.id} starts at ${p.zone.k[0]}, expected ${k}`);
      k = p.zone.k[1] + 1;
    }
    if (k !== prog.kmax + 1) throw new Error(`${id} storey ${f.storey} band ${bn}: covered to ${k - 1}, expected ${prog.kmax}`);
  }
}

/** Apply all programmes to the spec (facade sides/portals/risalits, roof.raised, rooms, openings, stairs). */
export function applyProgrammes(spec: SiteSpec): void {
  for (const prog of PROGRAMMES) {
    const b = spec.buildings.find((x) => x.id === prog.id);
    if (!b) throw new Error(`programme for missing building ${prog.id}`);
    const res = buildProgramme(prog, b, spec);
    b.facade.sides = res.facade.sides;
    b.facade.portals = res.facade.portals;
    if (res.facade.risalits) b.facade.risalits = res.facade.risalits;
    else delete b.facade.risalits;
    if (res.raised) b.roof.raised = res.raised;
    b.rooms = res.rooms;
    b.openings = res.openings;
    b.stairs = res.stairs;
    b.interior = 'detailed';
    b.notes = `${b.notes ?? ''} Interior v2: ${prog.interiorTag} (scripts/catalogue-v2/programme.ts).`.trim();
  }
}
