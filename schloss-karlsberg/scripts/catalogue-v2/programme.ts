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
import { INTERIOR_DOOR, PARTITION_WALL, STAIR } from '../../model/src/layout/grammar.ts';
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
  windowKinds?: Partial<Record<SideName, { kind: 'window' | 'porte_fenetre'; tag: string }>>;
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
    { side: 'court', axis: ax('court', 7), kind: 'portal', storey: 1, steps: 10, tag: 'D LC 1790 central portal + Freitreppe; 10 steps D-> 1.4 m Sockel / 0.145' },
    { side: 'garden', axis: ax('garden', 7), kind: 'door', storey: 1, steps: 2, grade_h: 345.9, tag: 'I through-going vestibule (05 §e.1); garden door with a 2-step perron down to the parterre TF-09 (345.9) I (fix round 1)' },
    { side: 'garden', axis: ax('garden', 6, 3), kind: 'porte_fenetre', span_axes: 3, storey: 2, tag: 'I 3 portes-fenêtres of the Festsaal to a balcony (05 §e.1)' },
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
        { k: [4, 5], band: 'garden', id: 'eg-gelber-salon', name: 'Gelber Salon', fn: 'salon (private apartment)', fin: 'boiserie', tag: 'D room guide "Gelber Salon + Schreibkabinett" (EG); position I' },
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
        { k: [4, 5], band: 'court', id: 'og-antichambre', name: 'Antichambre', fn: 'antechamber of the state apartment', fin: 'boiserie' },
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
    { side: 'garden', axis: ax('garden', 11, 2), kind: 'durchfahrt', span_axes: 2, storey: 1, tag: 'HMS gate to the terrace garden (TF-08)' },
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
        { k: [0, 1], band: 'full', id: 'eg-kopfvestibuel', name: 'Vestibül im Kopfpavillon', fn: 'entrance hall behind the portico', fin: 'hall', tag: 'D LC 1790 portico; hall I' },
        stairZone([2, 3], 'full', 'eg-treppe-west', 'Treppenhaus West', 'dogleg', 'secondary', 2, [0, 1], 'N secondary stair of the wing'),
        { k: [4, 5], band: 'garden', id: 'eg-silberkammer', name: 'Silberkammer', fn: 'silver chamber', fin: 'service', tag: 'HMS caption "Silberkammer"; on the EG I' },
        { k: [6, 10], band: 'garden', id: 'eg-speisesaal', name: 'Großer Speisesaal', fn: 'dining room', fin: 'boiserie', tag: 'HMS "Speisesäle" (10 x 15 m); EG I (LP06: OG = Duchess)' },
        { k: [4, 6], band: 'court', id: 'eg-silberdiener', name: 'Silberdiener', fn: 'silver servants', fin: 'service' },
        { k: [7, 10], band: 'court', id: 'eg-anrichte', name: 'Buffet / Anrichte', fn: 'serving room (kitchen via the court)', fin: 'service', tag: 'HMS Anrichte; I' },
        { k: [11, 12], band: 'full', id: 'eg-durchfahrt', name: 'Durchfahrt zum Terrassengarten', fn: 'carriage passage', fin: 'passage', tag: 'HMS' },
        { k: [13, 16], band: 'garden', id: 'eg-kleiner-speisesaal', name: 'Kleiner Speisesaal', fn: 'smaller dining room', fin: 'boiserie', tag: 'HMS "Speisesäle"; I' },
        { k: [17, 19], band: 'garden', id: 'eg-offiziere', name: 'Offizierszimmer', fin: 'service', tag: 'I 05 §e.2' },
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
        { k: [0, 1], band: 'full', id: 'og-kopfsalon', name: 'Salon im Kopfpavillon (Balkon über dem Portikus)', fin: 'blue', tag: 'D LC 1790 balcony over the portico; room I' },
        voidZ([2, 3], 'full', 'eg-treppe-west'),
        { k: [4, 5], band: 'garden', id: 'og-garderobe-herzogin', name: 'Garderobe der Herzogin', fin: 'service' },
        { k: [6, 7], band: 'garden', id: 'og-kabinett-herzogin', name: 'Kabinett der Herzogin', fin: 'boiserie' },
        { k: [8, 10], band: 'garden', id: 'og-schlafzimmer-herzogin', name: 'Schlafzimmer der Herzogin', fin: 'blue', tag: 'D LP06 legend 3 "Flügel der Herzogin"; rooms I' },
        { k: [11, 12], band: 'garden', id: 'og-audienz-herzogin', name: 'Audienzzimmer der Herzogin', fin: 'crimson' },
        { k: [13, 16], band: 'garden', id: 'og-salon-herzogin', name: 'Salon der Herzogin', fin: 'green' },
        { k: [17, 19], band: 'garden', id: 'og-antichambre2', name: 'Zweite Antichambre', fin: 'boiserie' },
        { k: [20, 22], band: 'garden', id: 'og-antichambre1', name: 'Erste Antichambre', fin: 'boiserie' },
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
  interiorTag: 'LP06 "Flügel der Herzogin" (Duchess on the OG, D) + HMS dining rooms / Silberkammer on the EG (I); double pile N',
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
    { side: 'court', axis: ax('court', 8, 2), kind: 'durchfahrt', span_axes: 2, storey: 1, tag: 'HMS Durchfahrt to the Küchenhof u -6.1..-0.4 -> grid axes 8-9' },
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
        { k: [0, 1], band: 'garden', id: 'eg-kammer-1', name: 'Kammer', fin: 'service' },
        { k: [2, 4], band: 'garden', id: 'eg-gesindestube', name: 'Gesindestube', fin: 'service' },
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
        { k: [0, 2], band: 'court', id: 'og-antichambre', name: 'Antichambre des Herzogs', fin: 'boiserie', tag: 'D LP06 legend 2 "Flügel des Herzogs"; rooms I' },
        { k: [3, 5], band: 'court', id: 'og-audienz', name: 'Audienzzimmer des Herzogs', fin: 'crimson' },
        { k: [6, 9], band: 'court', id: 'og-salon', name: 'Salon des Herzogs', fin: 'boiserie' },
        { k: [10, 12], band: 'court', id: 'og-schlafzimmer', name: 'Schlafzimmer des Herzogs', fin: 'blue' },
        { k: [13, 13], band: 'court', id: 'og-kabinett', name: 'Kabinett', fin: 'boiserie' },
        { k: [14, 15], band: 'court', id: 'og-bibliothek', name: 'Bibliothek des Herzogs (Handbibliothek)', fin: 'boiserie', tag: 'I (the main library is in the Sammlungsflügel)' },
        { k: [0, 15], band: 'corridor', id: 'og-korridor', name: 'Korridor', fin: 'service' },
        { k: [0, 1], band: 'garden', id: 'og-garderobe-1', name: 'Garderobe', fin: 'service' },
        { k: [2, 4], band: 'garden', id: 'og-garderobe-2', name: 'Garderobe', fin: 'service' },
        { k: [5, 9], band: 'garden', id: 'og-dienerzimmer', name: 'Dienerzimmer', fin: 'service' },
        { k: [10, 12], band: 'garden', id: 'og-garderobe-3', name: 'Garderobe', fin: 'service' },
        { k: [13, 15], band: 'garden', id: 'og-kammer', name: 'Kammer', fin: 'service' },
        voidZ([16, 18], 'full', 'eg-treppe-west'),
      ],
    },
  ],
  passages: [
    { id: 'nord-cdl', storeys: [1, 2], side: 'court', at: -29.45, to: 'KB-B01', tag: 'I link to the CdL (Durchgang Nord)' },
    { id: 'nord-sammlung', storeys: [1, 2], side: 'garden', at: 29.95, to: 'KB-B04', tag: 'I link to the Sammlungsflügel' },
    { id: 'nord-kueche', storeys: [1], side: 'garden', at: -27.8, to: 'KB-B05', tag: 'I service link to the Küchenbau (Anrichte)' },
  ],
  interiorTag: 'LP06 "Flügel des Herzogs" (Duke on the OG, D); EG guard / courtiers (HMS, I); double pile with corridor on the 20 m LiDAR depth N',
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
        { k: [2, 7], band: 'full', id: 'eg-waffensammlung', name: 'Waffensammlung', fn: 'armoury (collection)', fin: 'hall', tag: 'D Waffensammlung (05 §e.2); position I' },
        { k: [8, 10], band: 'full', id: 'eg-buechsenmacherei', name: 'Büchsenmacherei', fn: 'gunsmith', fin: 'service', tag: 'D Büchsenmacherei (05 §e.2); position I' },
        { k: [11, 13], band: 'full', id: 'eg-kanzlei', name: 'Kanzlei der Sammlungen', fin: 'service', tag: 'I' },
        { k: [14, 15], band: 'full', id: 'eg-wachstube', name: 'Wachstube am Tor', fin: 'service', tag: 'HMS sentry boxes at the gate; I' },
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
        { k: [2, 9], band: 'full', id: 'og-bibliothek', name: 'Bibliothek', fn: 'court library, wall cases with a gallery at 2.8 m', fin: 'boiserie', tag: 'D library -> Bamberg (05 §e.2); 24 x 11.6 m I (05: ≈ 10 x 25 m)' },
        { k: [10, 12], band: 'full', id: 'og-naturalienkabinett', name: 'Naturalienkabinett', fin: 'boiserie', tag: 'D Naturalienkabinett; position I' },
        { k: [13, 14], band: 'full', id: 'og-physik', name: 'Physikalisches Kabinett', fin: 'boiserie', tag: 'D physikalisches Kabinett; position I' },
        { k: [15, 17], band: 'full', id: 'og-kupferstich', name: 'Kupferstichkabinett (?)', fin: 'boiserie', tag: 'U (05 §e.2 "probably")' },
        voidZ([18, 18], 'full', 'eg-treppe-sued'),
      ],
    },
  ],
  passages: [
    { id: 'sammlung-galerie', storeys: [1], side: 'court', at: -26.7, to: 'KB-B06', sill: 2.6, height: 2.4, tag: 'I door from the N stair half landing (348.8) into the gallery' },
    { id: 'sammlung-nord', storeys: [1, 2], side: 'end_b', at: 0, to: 'KB-B03', tag: 'I link to the N arm' },
  ],
  interiorTag: 'collections named in Weber ToC / BuS 2012 (D), positions I; single pile on the 13 m LiDAR depth',
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
    { side: 'court', axis: ax('court', 11), kind: 'door', storey: 1, tag: 'I scullery door' },
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
        stairZone([10, 10], 'full', 'eg-treppe', 'Treppenhaus', 'dogleg', 'service', 2, [0, 1], 'N'),
        { k: [11, 11], band: 'full', id: 'eg-spuelkueche', name: 'Spülküche', fin: 'kitchen', tag: 'D Spülküche (05 §e.2); position I' },
        { k: [12, 13], band: 'full', id: 'eg-baeckerei', name: 'Bäckerei', fin: 'kitchen', tag: 'D Bäckerei (05 §e.2); position I' },
      ],
    },
    {
      storey: 2,
      layout: 'single',
      outerWall: 0.7,
      zones: [
        { k: [0, 1], band: 'full', id: 'og-mundkoch', name: 'Wohnung des Mundkochs', fin: 'service', tag: 'I cooks\' rooms (05 §e.2)' },
        { k: [2, 3], band: 'full', id: 'og-kammer-1', name: 'Kammer', fin: 'service' },
        { k: [4, 5], band: 'full', id: 'og-kammer-2', name: 'Kammer', fin: 'service' },
        { k: [6, 7], band: 'full', id: 'og-kammer-3', name: 'Kammer', fin: 'service' },
        { k: [8, 9], band: 'full', id: 'og-kuechenschreiber', name: 'Küchenschreiberei', fin: 'service' },
        voidZ([10, 10], 'full', 'eg-treppe'),
        { k: [11, 13], band: 'full', id: 'og-kammer-4', name: 'Kammer', fin: 'service' },
      ],
    },
  ],
  passages: [{ id: 'kueche-nord', storeys: [1], side: 'end_a', at: -3.0, to: 'KB-B03', tag: 'I serving link to the N arm' }],
  interiorTag: 'kitchen rooms named in research/05 §e.2 (D/I), positions I; single pile',
};

const GALERIE: Prog = {
  id: 'KB-B06',
  p: 3.9,
  s0: () => -(21 * 3.9) / 2 + 1.95,
  kmin: 0,
  kmax: 20,
  garden: 'blind',
  court: [0, 20],
  end_a: 'blind',
  end_b: 'blind',
  sideTag: 'S-lit gallery, N hanging wall closed N 02; 21 axes at 3.9 I',
  floors: [
    {
      storey: 1,
      layout: 'single',
      outerWall: 0.65,
      zones: [
        { k: [0, 1], band: 'full', id: 'kabinett-ost', name: 'Kabinett am Ostende', fn: 'small picture cabinet', fin: 'green' },
        { k: [2, 18], band: 'full', id: 'bildergalerie', name: 'Bildergalerie', fn: 'picture gallery, hanging wall N, light from the S', fin: 'green', tag: 'D picture gallery (collection -> Alte Pinakothek); 66 x 6.7 m I; parquet D (05 §e.2)' },
        { k: [19, 20], band: 'full', id: 'vorraum-west', name: 'Vorraum (vom Sammlungsflügel)', fin: 'boiserie' },
      ],
    },
  ],
  passages: [
    { id: 'galerie-sammlung', storeys: [1], side: 'end_b', at: 2.0, to: 'KB-B04', tag: 'I door from the Sammlungsflügel stair landing' },
    { id: 'galerie-pavillon', storeys: [1], side: 'end_a', at: 0, to: 'KB-B07', tag: 'I door to the end pavilion (LP06 6)' },
  ],
  interiorTag: 'one long hall (05 §e.2) on the v2 8 m range',
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
  windowKinds: { garden: { kind: 'window', tag: 'W front: two tiers of sill windows above the high basement (HMS research/08 §4; facade.windows), portes-fenêtres only on the parterre (E) side' } },
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

export const PROGRAMMES: Prog[] = [CDL, SUED, NORD, SAMMLUNG, KUECHE, GALERIE, ORANGERIE];

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
  for (const [side, wk] of Object.entries(prog.windowKinds ?? {}) as [SideName, { kind: 'window' | 'porte_fenetre'; tag: string }][]) {
    const sd = sides[side];
    if (sd) sides[side] = { ...sd, window_kind: wk.kind, tag: `${sd.tag ?? ''}; ${wk.tag}` };
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
        finish: { ...FIN[z.fin] },
        tag: [z.tag ?? TAG_I, `finish ${FIN_TAG[z.fin]}`].join('; '),
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
