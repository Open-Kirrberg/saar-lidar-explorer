/**
 * 1789 land cover (backlog KB-I09, research/11 S1 and §6.3, skb-schlossgarten references/site-zones.md).
 *
 * The viewer used "today's canopy > 8 m" as the 1789 forest, which wraps the palace in a closed wood. The period views
 * and plans show an open, cultivated ridge instead [D Pleine vue 1791 (PV); D Petri plan c. 1788, BSB Cod.icon. 180 h
 * 26r via Schneider; HMS]: hay meadows on the W and SW slopes, fields on the plateaus, the vineyard LP06 30, walled
 * kitchen gardens, Petri's lawn garden behind the palace, and forest only as belts around that lawn, on the E plateau
 * toward the Lambsbach (the Louisenhof "Buchenwald" of 1768) and on the steep valley sides.
 *
 * Output: the top-level `landcover` array of model/catalogue.json. scripts/prepare-terrain.py rasterises it into the
 * 1789 ground classes (8 field, 9 vineyard, 10 kitchen garden, 11 hay meadow; 6 forest, 1 lawn, 0 meadow = the rest)
 * and keeps today's canopy only for the 2025 terrain. Terrain features (courts, paths, ponds, buildings) are painted
 * over the land cover there, so the polygons may run under them.
 *
 * Paint order = array order (later wins). A `min_slope` area applies only to cells at least that steep (rise / run on
 * the 1789 DTM, smoothed), which is how the steep valley sides stay wooded without hand-drawn outlines.
 *
 * Precision: edges are ±30 m (research/11 Q2: the Petri plan is not georeferenced) unless an entry says otherwise;
 * the LP06 garden outlines come from research/07's global similarity fit (RMS 11.7 m) of the 2006 Lageplan.
 */
import type { GridFrame } from '../../model/src/frame.ts';
import { mulberry32 } from '../../model/src/layout/geom.ts';
import type { EN, LandcoverArea, RingEN } from '../../model/src/spec.ts';
import { ring } from './common.ts';

// Types live in the spec (validated by model/src/validate.ts); re-exported for the builder's callers.
export { LANDCOVER_COVERS, type LandcoverArea, type LandcoverCover } from '../../model/src/spec.ts';

/** Forest mix of the Buchenberg and the E plateau: beech 70 %, oak 20 %, hornbeam 10 % [I from D place names; research/11 §6.3]. */
const BEECH_MIX = [
  { species: 'fagus', share: 0.7 },
  { species: 'quercus', share: 0.2 },
  { species: 'carpinus', share: 0.1 },
];

const poly = (r: RingEN) => ({ type: 'Polygon' as const, coordinates: [r] as [RingEN] });

/**
 * A wood's outline as drawn: densify every edge to `step` m and move the new points by up to ±`amp` m across the edge
 * (seeded, deterministic). Hand-drawn forest outlines are ±30 m anyway (research/11 Q2); this only avoids ruler-straight
 * edges. The finer 6-10 m edge noise is added in prepare-terrain.py. [I]
 */
export function organic(pts: EN[], seed: number, step = 35, amp = 14): EN[] {
  const rnd = mulberry32(seed);
  const out: EN[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    out.push(a);
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.floor(L / step);
    const nx = -(b[1] - a[1]) / (L || 1);
    const ny = (b[0] - a[0]) / (L || 1);
    for (let k = 1; k < n; k++) {
      const t = k / n;
      const o = (rnd() * 2 - 1) * amp * Math.sin(Math.PI * t) ** 0.5;
      out.push([a[0] + (b[0] - a[0]) * t + nx * o, a[1] + (b[1] - a[1]) * t + ny * o]);
    }
  }
  return out;
}

/** All land cover areas for summer 1789, in paint order. */
export function landcoverAreas(g: GridFrame): LandcoverArea[] {
  const uv = (pts: [number, number][], wood = 0) => {
    const p = pts.map(([u, v]) => g.toEN(u, v));
    return poly(ring(wood ? organic(p, wood) : p));
  };
  const en = (pts: EN[], wood = 0) => poly(ring(wood ? organic(pts, wood) : pts));
  const out: LandcoverArea[] = [];
  const add = (a: LandcoverArea) => out.push(a);

  // ---- 1. periphery: fields on the plateaus and gentle hills, hay in the valley floors -------------------------
  add({
    id: 'LC-01',
    cover: 'field',
    name_de: 'Ackerflur auf dem Plateau N/NO der Wirtschaftsbauten',
    geometry: en([
      [382300, 5466560],
      [382470, 5466520],
      [382640, 5466480],
      [382800, 5466520],
      [382880, 5466700],
      [382840, 5466900],
      [382700, 5466990],
      [382640, 5466880],
      [382560, 5466830],
      [382430, 5466950],
      [382330, 5466980],
      [382290, 5466800],
    ]),
    confidence: 'low',
    tag: 'cover I (PV 1791 fields; K05 / LP06 parcels; HMS checkerboard fields), research/11 §6.3 "plateau N and NE of the service row"; extent I ±50 m',
  });
  add({
    id: 'LC-02',
    cover: 'field',
    name_de: 'Ackerflur um Carlsdorf (Sanddorf) und die Neue Schäferei',
    geometry: en([
      [381100, 5466350],
      [381340, 5466420],
      [381430, 5466600],
      [381560, 5466640],
      [381700, 5466760],
      [381820, 5467000],
      [381900, 5467200],
      [381100, 5467200],
    ]),
    confidence: 'low',
    tag: 'cover I (research/11 §6.3 "around the Carlsberger Hof"; the 1836-41 Bavarian Positionsblatt shows open land at Sanddorf, D-> later state); extent I',
  });
  add({
    id: 'LC-03',
    cover: 'field',
    name_de: 'Ackerflur auf dem Südplateau (Fasanerie, Carlsluster Torhaus)',
    geometry: en([
      [382120, 5465640],
      [382300, 5465700],
      [382470, 5465660],
      [382620, 5465620],
      [382760, 5465560],
      [382860, 5465420],
      [382880, 5465200],
      [382760, 5465120],
      [382560, 5465080],
      [382340, 5465060],
      [382180, 5465150],
      [382100, 5465350],
    ]),
    confidence: 'low',
    tag: 'cover I (gentle plateau at 355-365 m, D DTM; PV fields; HMS checkerboard fields); extent I ±50 m; crops U',
  });
  add({
    id: 'LC-04',
    cover: 'field',
    name_de: 'Ackerflur auf der Kuppe im Südwesten',
    geometry: en([
      [381150, 5464620],
      [381350, 5464620],
      [381560, 5464760],
      [381620, 5464960],
      [381540, 5465160],
      [381340, 5465200],
      [381150, 5465120],
    ]),
    confidence: 'low',
    tag: 'cover I (gentle hill top, D DTM; PV open land W of the residence); outside the documented grounds, U',
  });
  add({
    id: 'LC-05',
    cover: 'hay',
    name_de: 'Heuwiesen im westlichen Talgrund (Carlsberger Hof, Carlsdorf)',
    geometry: en([
      [381100, 5465500],
      [381420, 5465560],
      [381640, 5465700],
      [381760, 5465860],
      [381700, 5466120],
      [381640, 5466330],
      [381600, 5466560],
      [381440, 5466580],
      [381340, 5466400],
      [381100, 5466330],
    ]),
    confidence: 'low',
    tag: 'cover D PV 1791 (meadows in the valley below the palace), research/11 §6.3 "the valley floor"; extent I',
  });

  // ---- 2. steep valley sides stay wooded (slope rule) -------------------------------------------------------------
  add({
    id: 'LC-10',
    cover: 'forest',
    name_de: 'Hangwald an den steilen Talflanken (Süden, Osten, Karlslust)',
    geometry: en([
      [381100, 5464450],
      [383350, 5464450],
      [383350, 5467200],
      [382900, 5467200],
      [382900, 5466400],
      [382700, 5465900],
      [382150, 5465600],
      [381900, 5465560],
      [381500, 5465450],
      [381100, 5465400],
    ]),
    min_slope: 0.3,
    mix: BEECH_MIX,
    confidence: 'low',
    tag: 'N (steep valley sides left as wood in the 18th-c. upland farming of the Westrich) + research/11 §6.3 (d) "the steep Karlslust valley sides outside the garden scenes" [I]; slope rule >= 30 % on the 1789 DTM',
  });

  // ---- 3. explicit forest: E plateau, Hirschwürzloch, belts around Petri's lawn ----------------------------------
  add({
    id: 'LC-11',
    cover: 'forest',
    name_de: 'Buchenwald auf dem Ostplateau zum Lambsbach',
    geometry: en([
      [382700, 5466200],
      [382780, 5466430],
      [382900, 5466560],
      [382940, 5466800],
      [382900, 5467000],
      [382960, 5467200],
      [383350, 5467200],
      [383350, 5465500],
      [383000, 5465560],
      [382880, 5465680],
      [382800, 5465820],
    ], 11),
    mix: BEECH_MIX,
    confidence: 'med',
    tag: 'D Louisenhof plan 1768 (BSB 61r via Schneider): "herrschaftlicher Buchenwald" down to the Lambsbach; D Petri plan: Wald E of the lawn; research/11 §6.3 (a, c); W edge I ±50 m',
  });
  add({
    id: 'LC-12',
    cover: 'forest',
    name_de: 'Wald an den Hängen des Hirschwürzlochs',
    geometry: en([
      [382560, 5465980],
      [382640, 5465900],
      [382780, 5465800],
      [382900, 5465700],
      [383000, 5465700],
      [383000, 5466000],
      [382860, 5466120],
      [382700, 5466160],
      [382600, 5466120],
    ], 12),
    mix: BEECH_MIX,
    confidence: 'med',
    tag: 'D Petri plan via Schneider: the Hirschwürzloch slopes "dicht bewaldet"; research/11 §6.3 (b); extent I ±30 m',
  });
  add({
    id: 'LC-13',
    cover: 'forest',
    name_de: 'Waldgürtel nördlich des Herzogsgartens (mit der Waldparzelle hinter dem Schloss)',
    geometry: uv([
      [95, 125],
      [200, 118],
      [330, 112],
      [470, 95],
      [500, 250],
      [470, 330],
      [360, 300],
      [250, 285],
      [150, 250],
      [100, 190],
    ], 13),
    mix: BEECH_MIX,
    confidence: 'low',
    tag: 'D Petri plan via Schneider: forest belts around the lawn; TF-40 "Waldparzelle hinter dem Schloss" (1797/98 parcel plan, I med); KB-B28 "Pavillon zu Carlsberg" in a circular clearing D 40-50 m (D Schneider); outline I ±30 m',
  });
  add({
    id: 'LC-14',
    cover: 'forest',
    name_de: 'Waldgürtel südlich des Herzogsgartens',
    geometry: uv([
      [80, -110],
      [200, -122],
      [330, -112],
      [470, -70],
      [520, -170],
      [420, -210],
      [300, -205],
      [180, -190],
      [100, -160],
    ], 14),
    mix: BEECH_MIX,
    confidence: 'low',
    tag: 'D Petri plan via Schneider: forest belts N and S of the lawn; research/11 S2 (d); outline I ±30 m',
  });
  add({
    id: 'LC-15',
    cover: 'forest',
    name_de: 'Feldgehölz am Nordhang über dem Karlsbergweiher',
    geometry: en([
      [381900, 5465620],
      [382020, 5465640],
      [382130, 5465700],
      [382150, 5465800],
      [382060, 5465830],
      [381960, 5465790],
      [381880, 5465700],
    ], 15),
    mix: BEECH_MIX,
    confidence: 'low',
    tag: 'D PV 1791 "only small woods on the slopes"; this N-facing steep slope S of the Weiher is a likely one [I low]',
  });
  add({
    id: 'LC-16',
    cover: 'forest',
    name_de: 'Fasanengehölz an der Fasanerie',
    geometry: en([
      [382760, 5465250],
      [382850, 5465260],
      [382880, 5465380],
      [382820, 5465450],
      [382760, 5465400],
    ], 16),
    mix: [
      { species: 'quercus', share: 0.5 },
      { species: 'carpinus', share: 0.5 },
    ],
    confidence: 'low',
    tag: 'N (a pheasantry keeps copses for cover); Fasanerie LP06 51 D; copse position U',
  });

  // ---- 4. the residence: hay slopes, Petri's lawn, vineyard, kitchen gardens --------------------------------------
  add({
    id: 'LC-20',
    cover: 'hay',
    name_de: 'Heuwiesen an den West- und Südwesthängen unter dem Schloss',
    geometry: en([
      [381700, 5466130],
      [381760, 5465880],
      [381880, 5465860],
      [382000, 5465870],
      [382140, 5465870],
      [382220, 5465720],
      [382190, 5465560],
      [382300, 5465620],
      [382290, 5465900],
      [382180, 5466100],
      [382160, 5466400],
      [382150, 5466700],
      [382180, 5466900],
      [382100, 5467000],
      [381900, 5466900],
      [381780, 5466720],
      [381660, 5466560],
      [381640, 5466330],
    ]),
    confidence: 'med',
    tag: 'D PV 1791 (open grassland slopes below the palace, small woods only); research/11 §6.3 "W and SW slopes below the palace to the Karlsbergweiher"; HMS green July meadows; extent I',
  });
  add({
    id: 'LC-21',
    cover: 'hay',
    name_de: 'Wiesen der Karlslust (Talgrund)',
    geometry: en([
      [382560, 5464720],
      [382700, 5464640],
      [382860, 5464600],
      [383000, 5464640],
      [383100, 5464780],
      [383000, 5464900],
      [382880, 5465020],
      [382760, 5465040],
      [382640, 5464900],
    ]),
    confidence: 'low',
    tag: 'D PV / research/11 §6.3 "the Karlslust meadows"; extent I (valley floor around the ponds and the menagerie)',
  });
  // wave-6 review fix / KB-I67: the terrace menagerie lay "in Buchenwald" (T1 p. 383) [D]; the wood round the
  // terraces E, S and N (the NW side to the amphitheatre stays meadow), cleared 14 m round the KL-B43 outline by
  // prepare-terrain; the old beeches inside that clearing and between the rows are TF-39
  add({
    id: 'LC-17',
    cover: 'forest',
    name_de: 'Buchenwald um die Menagerie-Terrassen',
    geometry: en([
      [383005, 5464985],
      [383065, 5464995],
      [383135, 5464905],
      [383175, 5464800],
      [383170, 5464715],
      [383110, 5464672],
      [383035, 5464665],
      [382985, 5464690],
      [382962, 5464760],
      [382992, 5464815],
      [383030, 5464925],
    ], 17),
    mix: BEECH_MIX,
    confidence: 'low',
    tag: 'D T1 p. 383 "in Buchenwald" (the terrace menagerie); extent I ±30 m; beech mix as the Buchenberg I',
  });
  add({
    id: 'LC-22',
    cover: 'lawn',
    name_de: 'Herzogsgarten: offener Rasen (Petri, ab 1788)',
    geometry: uv([
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
    ]),
    confidence: 'low',
    tag: 'D Petri plan c. 1788 (BSB Cod.icon. 180 h 26r via Schneider): a large open lawn E of the CdL inside a kidney-shaped belt walk; research/11 S2; outline I ±30 m',
    notes: 'The lawn follows the natural slope (no levelling). Clumps, walks and the basin are terrain features (KB-I12, KB-I13).',
  });
  add({
    id: 'LC-23',
    cover: 'vineyard',
    name_de: 'Weinberg (LP06 30, „la vigne“)',
    geometry: en([
      [382150, 5466032],
      [381910, 5466036],
      [381896, 5466050],
      [381869, 5466016],
      [381847, 5466001],
      [381700, 5465950],
      [381696, 5465903],
      [381805, 5465925],
      [381850, 5465955],
      [381878, 5465990],
      [381900, 5465998],
      [382041, 5465986],
      [382150, 5465984],
    ]),
    confidence: 'med',
    tag: 'D PV 1791 legend x. "La vigne avec son logement"; D LP06 30 Weinberg (hatched strip from the court mouth down to the Gärtnerei 34); outline from research/07 global LP06 fit (RMS 11.7 m), I ±15 m',
    notes: 'Rows run down the slope (research/11 S10). Stakes and vines at LOD0 are KB-I35.',
  });
  add({
    id: 'LC-24',
    cover: 'kitchen_garden',
    name_de: 'Holländische Gärtnerei (LP06 11) beiderseits der Straße',
    geometry: en([
      [382090, 5466250],
      [382124, 5466219],
      [382285, 5466232],
      [382267, 5466380],
      [382175, 5466395],
      [382100, 5466400],
    ]),
    confidence: 'med',
    tag: 'D LP06 11 (hatched both sides of the road) + K05 hatched parcels; D Petri via Schneider: beds in rows toward the palace; outline LP06 global fit, I ±15 m',
  });
  add({
    id: 'LC-25',
    cover: 'kitchen_garden',
    name_de: 'Gartenland südlich des Taubenhauses (LP06, schraffiert)',
    geometry: en([
      [382382, 5465680],
      [382349, 5465864],
      [382283, 5465863],
      [382253, 5465854],
      [382256, 5465786],
      [382280, 5465657],
      [382378, 5465669],
    ]),
    confidence: 'low',
    tag: 'D LP06 hatched garden E of the road S of the Taubenhaus (no legend number); PV "light-green rectangular field (garden or nursery) under the palace row"; outline LP06 global fit, I ±15 m',
  });
  add({
    id: 'LC-26',
    cover: 'kitchen_garden',
    name_de: 'Gartenland am Jägerhaus (LP06, schraffiert)',
    geometry: en([
      [382199, 5466821],
      [382160, 5466821],
      [382149, 5466676],
      [382155, 5466671],
      [382193, 5466673],
    ]),
    confidence: 'low',
    tag: 'D LP06 hatched garden W of the road at the Jägerhaus; outline LP06 global fit, I ±20 m',
  });
  add({
    id: 'LC-27',
    cover: 'kitchen_garden',
    name_de: 'Gärten am Carlsberger Hof und an der Kelterei (LP06, schraffiert)',
    geometry: en([
      [381658, 5466068],
      [381649, 5466110],
      [381610, 5466154],
      [381566, 5466157],
      [381551, 5466105],
      [381500, 5466095],
      [381495, 5466040],
      [381495, 5465925],
      [381514, 5465918],
      [381573, 5465970],
      [381611, 5465989],
      [381610, 5466053],
    ]),
    confidence: 'low',
    tag: 'D LP06 hatched gardens around the Carlsberger Hof 38, Scheune 39, Kelterei 40 and Pastorshäuschen 41; use (kitchen garden or orchard) I; outline LP06 global fit, I ±20 m',
  });
  add({
    id: 'LC-28',
    cover: 'kitchen_garden',
    name_de: 'Gärtnerei Reichard (LP06 45) und Gärtnerei LP06 47',
    geometry: uv([
      [200, -95],
      [270, -98],
      [275, -135],
      [205, -135],
    ]),
    confidence: 'low',
    tag: 'D LP06 45 Gärtnerei Reichard (KB-B77) and 47 (KB-B78); research/11 §6.3 kitchen garden / nursery; bed area beside the buildings I',
  });
  add({
    id: 'LC-29',
    cover: 'kitchen_garden',
    name_de: 'Gärtnerei LP06 47',
    geometry: uv([
      [310, -215],
      [380, -215],
      [380, -265],
      [310, -265],
    ]),
    confidence: 'low',
    tag: 'D LP06 47 Gärtnerei (KB-B78); bed area beside the building I',
  });
  add({
    id: 'LC-30',
    cover: 'kitchen_garden',
    name_de: 'Gärtnerei LP06 34 im Tal',
    geometry: en([
      [381640, 5465860],
      [381730, 5465870],
      [381740, 5465930],
      [381650, 5465930],
    ]),
    confidence: 'low',
    tag: 'D LP06 34 Gärtnerei (KB-B76); bed area beside the building I',
  });

  // ---- 5. wave 5 garden detail (KB-I32, KB-I38): clearings for the chestnut grove and the hypothetical pavilion -----
  const ellipse = (cu: number, cv: number, ru: number, rv: number, wobble = 0) => {
    const pts: [number, number][] = [];
    for (let k = 0; k < 24; k++) {
      const t = (k / 24) * Math.PI * 2;
      pts.push([cu + (ru + wobble * Math.sin(3 * t)) * Math.cos(t), cv + (rv + wobble * Math.cos(2 * t)) * Math.sin(t)]);
    }
    return uv(pts);
  };
  add({
    id: 'LC-31',
    cover: 'meadow',
    name_de: 'Herzogskastanien: Wiese unter dem Kastanienhain',
    geometry: ellipse(325, -148, 35, 26, 3),
    confidence: 'low',
    tag: 'D sweet chestnut grove above the Hirschwürzloch (research/11 S13, G17); open grass under young planted trees I; outline I ±30 m (grove HK-01 + 5 m)',
  });
  add({
    id: 'LC-32',
    cover: 'lawn',
    name_de: 'Rasenplatz um den hypothetischen Rundpavillon (Petri)',
    geometry: ellipse(463, -64, 22, 22),
    confidence: 'low',
    tag: 'D Petri plan via Schneider: a circular building on the lawn E of the palace (research/11 §1.2); placement hypothetical (KB-B88); lawn circle D 44 I',
  });
  return out;
}
