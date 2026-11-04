/**
 * Low-poly instanced trees and shrubs (KB-I11, research/11 §3, S4; skill skb-schlossgarten planting.md).
 * One InstancedMesh for trunks and one per crown variant and species; deterministic (mulberry32).
 *
 * Crowns are built in true proportions per species (radius `crown`, height `height · (1 − trunkFrac)`), so instances
 * scale almost uniformly and the normals stay right. Shapes per species: lobed (Tilia ovoid and dense, Aesculus a broad
 * dark dome, Castanea broad and open, Malus low and wide with a leaning trunk, old beech broad), a narrow column
 * (Lombardy poplar), a tiered cone (conifers), a clipped cone (yew) and a low 2-lobe mass (flowering shrubs).
 */
import * as THREE from 'three';
import { hash12, mulberry32 } from '../layout/geom.ts';
import { AVENUE_ROW, GARDEN, GARDEN_DETAIL } from '../layout/grammar.ts';

/** Per-face flower speckles of a crown variant: `faceShare[v]` of the faces of variant v take colour `colours[v]`. */
export interface Bloom {
  colours: readonly string[];
  faceShare: readonly number[];
  /** 0..1 of the way from the leaf to the flower colour (default 1). */
  strength?: number;
}

export type CrownShape = 'lobed' | 'column' | 'tiered' | 'cone' | 'shrub' | 'clipped';

export interface TreeSpecies {
  key: string;
  /** Total height (m) at scale 1 and crown radius (m). */
  height: number;
  crown: number;
  /** Clear trunk height as a fraction of the height. */
  trunkFrac: number;
  leaf: string;
  bark: string;
  /** Icosahedron detail of the lobes (0 = 20 faces, 1 = 80). */
  detail: 0 | 1;
  shape?: CrownShape;
  /** Lobed crowns: lobe count and how far the side lobes sit from the centre (0..1 of the crown radius). */
  lobes?: number;
  spread?: number;
  /** Per-instance flower colours: `share` of the instances take one of `colours` (mixed `amount` into the leaf). */
  flowers?: { colours: readonly string[]; share: number; amount: number };
  /** Flower speckles on a few crown faces (vertex colours), not whole-crown colour (wave-2 review). */
  bloom?: Bloom;
  /** Per-instance tint toward `colour` by 0..`amount` (e.g. the cream catkins of Castanea in July). */
  tint?: { colour: string; amount: number };
  /** Trunk lean (deg, random direction), e.g. old apple trees. */
  lean?: number;
  /** Draw a trunk (shrubs and clipped yews have none). */
  trunk?: boolean;
  /** Trunk radius at the base (m, at scale 1) instead of the height rule (thin grafted stems of standard roses). */
  trunkR?: number;
  /**
   * Nursery standard (Hochstamm, GARDEN_DETAIL.standard): a clear stem of [min, max] m whatever the instance scale, the
   * crown filling the rest of the height, `crownWidth` [min, max] m across (wave-5 residual: young garden trees
   * 1778-88 read as feathered blobs or lollipops).
   */
  standard?: { clearStem: readonly [number, number]; crownWidth: readonly [number, number] };
  /** Per-instance size jitter ± (default 0.2; clipped tub standards are kept to one size per row). */
  jitter?: number;
  /** Glossy leaves (citrus): a lower roughness on the crowns and their leaf cards. */
  gloss?: boolean;
  /** Fruit on the crown surface (`perTree` small spheres of `radius` m, colours picked per fruit). */
  fruit?: { colours: readonly string[]; perTree: number; radius: number; tag: string };
  /** Tag of the values. */
  tag?: string;
}

/**
 * Species palette for summer 1789. Heights are 1789 sizes: avenues and clumps planted 1778-88 are young (5-8 m),
 * retained edge trees 18-25 m (research/11 §3.2) [D->/I]. Colours are sRGB starting points [I].
 */
export const SPECIES: Record<string, TreeSpecies> = {
  // young avenue lime: dense ovoid crown, crown D ≈ 3.4 m at 6 m [N; I size]
  tilia: { key: 'tilia', height: 6, crown: 1.7, trunkFrac: 0.38, leaf: '#5C7C34', bark: '#5A4E42', detail: 1, lobes: 5, spread: 0.36, tag: 'N avenue norm; young 1789 D->' },
  // young feathered lime / hornbeam of a landscape planting (Heister): branched almost to the ground, crown D 4-6 m at
  // 6 m, not an avenue standard with a clear stem [N nursery practice; I] (wave-2 review: lawn trees read as lollipops)
  // wave 5: planted 1778-88 as nursery standards (clear stem 2-2.5 m, crown 4-6 m) in a paler, less saturated green than
  // the old wood [N nursery Hochstamm; I hue] (supersedes the wave-2 feathered form; the crown stays broad, no lollipop)
  tilia_young: { key: 'tilia_young', height: 6, crown: 2.4, trunkFrac: 0.38, leaf: '#687A48', bark: '#5A4E42', detail: 1, lobes: 5, spread: 0.42, standard: GARDEN_DETAIL.standard, tag: 'N nursery standard (GARDEN_DETAIL.standard); I hue' },
  // wave-9 review fix (TF-47): the young limes of the framing groups as feathered Heister: 6-7 m, a narrow ovoid crown
  // (3 m across) branched from 1.2-1.5 m, many small clumps (the close-crown look of the older trees, not the big-lobe
  // shell of the nursery standard), July leaf mid / yellow-green (research/11 §3.1: Tilia "mid / yellow-green, dense
  // ovoid crowns") [N nursery Heister; I sizes, hue]
  tilia_heister: { key: 'tilia_heister', height: 6.5, crown: 1.5, trunkFrac: 0.21, leaf: '#5C8039', bark: '#5A4E42', detail: 1, lobes: 12, spread: 0.36, tag: 'N nursery Heister (feathered); N research/11 §3.1 July hue; I sizes' },
  // apple: low, wide, irregular, trunk leaning ±8° (research/11 S4) [D Apfelallee; N form]
  malus: { key: 'malus', height: 4, crown: 2.0, trunkFrac: 0.3, leaf: '#66803A', bark: '#5A4A3C', detail: 1, lobes: 5, spread: 0.55, lean: 8, tag: 'D Apfelallee; N form' },
  // horse chestnut: broad dark dome, no leaf-miner browning in 1789 [I species; N look]
  aesculus: { key: 'aesculus', height: 7, crown: 2.6, trunkFrac: 0.32, leaf: '#3E5E29', bark: '#4F4438', detail: 1, lobes: 6, spread: 0.42, standard: GARDEN_DETAIL.standard, tag: 'I species; N look; N standard' },
  // sweet chestnut (Herzogskastanien): broad, open crown, cream catkins in July [D species; N look]
  castanea: { key: 'castanea', height: 7, crown: 3.0, trunkFrac: 0.32, leaf: '#5E7040', bark: '#5B5046', detail: 1, lobes: 6, spread: 0.6, tint: { colour: '#D9CF8E', amount: 0.3 }, standard: GARDEN_DETAIL.standard, tag: 'D de.wikipedia Esskastanien; N July catkins; N standard, I hue' },
  // Lombardy poplar: narrow column, crown from low on the stem [D depiction; I species; date U]
  populus_italica: { key: 'populus_italica', height: 10, crown: 1.5, trunkFrac: 0.12, leaf: '#6E8A4E', bark: '#6A6458', detail: 1, shape: 'column', tag: 'D depiction PV/Petri; I species; U date' },
  // conifers (Pinus strobus, Picea, Larix): dark pointed singles in Petri's lawn [D symbol; N species]
  // irregular whorled crown (young Pinus strobus / Picea), not a smooth stacked cone (wave-2 review: "Christmas trees")
  conifer: { key: 'conifer', height: 10, crown: 2.8, trunkFrac: 0.08, leaf: '#2D4733', bark: '#4E4136', detail: 0, shape: 'tiered', tag: 'D plan symbol; N species; I shape' },
  // flowering shrubs (Syringa, Philadelphus, Rosa, Viburnum): broad 2-3 lobe masses; in July only roses, Spiraea and
  // Hypericum flower, so ~5 % of the crown faces carry flower speckles (GARDEN.julyBloom) [D plan clumps; N species, bloom]
  shrub_flowering: {
    key: 'shrub_flowering',
    height: 2.6,
    crown: 2.0,
    trunkFrac: 0.04,
    leaf: '#6A7F50',
    bark: '#4F4438',
    // detail 1: the faceted 20-face lobes read as crystals at eye level (wave-2 review); ~80 faces per lobe also make
    // the bloom speckles small
    detail: 1,
    shape: 'shrub',
    trunk: false,
    bloom: GARDEN.julyBloom,
    tag: 'D plan multicoloured clumps; N species; N July bloom',
  },
  // wave-9 review fix (TF-46): the tall shrubs of the framing groups (Syringa, Philadelphus, Viburnum, Cornus mas) flower
  // in spring and early summer, so in July they are a fresh mixed green without bloom [N research/11 §3.1; I hue]
  shrub_green: {
    key: 'shrub_green',
    height: 3.0,
    crown: 1.9,
    trunkFrac: 0.04,
    leaf: '#5B7E3F',
    bark: '#4F4438',
    detail: 0,
    shape: 'shrub',
    trunk: false,
    tag: 'D plan clumps; N species out of flower in July (research/11 §3.1); I hue',
  },
  // clipped yew cones in plates-bandes, 0.65-1.0 m [N d'Argenville]
  taxus_cone: { key: 'taxus_cone', height: 1.0, crown: 0.42, trunkFrac: 0, leaf: '#22341E', bark: '#3A2F26', detail: 0, shape: 'cone', trunk: false, tag: "N d'Argenville" },
  // retained old beech (Überhälter) at forest edges and in clumps: 18-25 m, light grey bark [I; N bark colour]
  // open-grown, so the crown comes down low (trunkFrac 0.2, not a forest bole) [N open-grown beech form]
  beech_old: { key: 'beech_old', height: 22, crown: 7.0, trunkFrac: 0.2, leaf: '#41602F', bark: '#8A8580', detail: 1, lobes: 6, spread: 0.48, tag: 'I retained trees research/11 §3.2; bark N; N open-grown form' },
  // forest (beech / oak): bark lightened from #4B4238 (read as black sticks, visual-audit V1) toward beech grey [I]
  forest: { key: 'forest', height: 24, crown: 6.8, trunkFrac: 0.3, leaf: '#3F5C2E', bark: '#6E6860', detail: 0, lobes: 2, spread: 0.42, tag: 'I' },
  // standard roses in the plates-bandes (wave 5, KB-I34): a 1.1 m stem and a small round head in July bloom
  // [N d'Argenville / HMS roses on the S terrace; I size, hues]
  rosa_standard: {
    key: 'rosa_standard',
    height: 1.55,
    // wave 6: a looser, slightly wider head of five lobes (with leaf cards in the viewer), not a ball on a stick [I]
    crown: 0.3,
    trunkFrac: 0.7,
    leaf: '#4A6A30',
    bark: '#4A3A2A',
    detail: 0,
    lobes: 5,
    spread: 0.5,
    // a grafted rose stem is 2-3 cm thick, not a 9 cm pole [N; I]
    trunkR: 0.016,
    bloom: { colours: ['#C44A55', '#E58A9A', '#F0E4DC'], faceShare: [0.34, 0.3, 0.28], strength: 0.9 },
    tag: 'N standard roses (GARDEN_DETAIL.angloise roseStem / roseCrown); HMS roses on the terrace; I hues',
  },
  // orange / lemon standards in tubs (wave-6 review, KB-I34): a clipped round head, glossy dark green, a few fruits.
  // GARDEN_DETAIL.tub scales the 2.2 m tree to 2.8 m: clear stem 0.43 · 2.8 = 1.2 m, head 1.6 m high and 1.5 m across;
  // one size per row (jitter 3 %), as nursery standards set out for the summer [D tubs research/01 row 17; N clipped
  // standard, research/11 §3 palette "glossy dark green, white flowers, green / orange fruit"; I hue #2E4A2B]
  citrus: {
    key: 'citrus',
    height: 2.2,
    crown: 0.6,
    trunkFrac: 0.43,
    leaf: '#2E4A2B',
    bark: '#5A4A3A',
    detail: 1,
    shape: 'clipped',
    jitter: 0.03,
    gloss: true,
    // a grafted orange standard has a slim stem (~10-13 cm at 2.8 m), not the 24 cm of the height rule [N; I]
    trunkR: 0.05,
    // ripe (last year's) and green fruit in July [N citrus fruit hangs ~12 months; I count]
    fruit: { colours: ['#E07A1F', '#E8901F', '#D86A18', '#7E9A3A'], perTree: 9, radius: 0.04, tag: 'N research/11 §3 palette (green / orange fruit); I count, size' },
    tag: 'D tubs; N clipped standard; I hue',
  },
  // wave 9 (garden): the low front layer of the graded framing groups (catalogue TF-45, GARDEN_GRADED): roses, Spiraea
  // and Hypericum in flower in July, so more crown faces carry the July colours than in the mixed clumps
  // [N research/11 §3.1; I shares]
  shrub_july: {
    key: 'shrub_july',
    height: 1.2,
    crown: 1.0,
    trunkFrac: 0.04,
    // wave-9 review fix: a fresher green (the olive read as an autumn cast next to the yellow flowers in Kino and photo
    // mode) and rose and white flowers only (Rosa gallica, R. × centifolia, Spiraea; no yellow Hypericum variant) [I]
    leaf: '#5C7E44',
    bark: '#4F4438',
    detail: 1,
    shape: 'shrub',
    trunk: false,
    bloom: { colours: ['#D497A6', '#ECE6D2', '#C98390'], faceShare: [0.12, 0.08, 0.1], strength: 0.45 },
    tag: 'D plan multicoloured clumps; N July-flowering roses and Spiraea; I bloom shares and hues',
  },
};

let warnedKastanie = false;

/**
 * Species from a catalogue text such as "Tilia (N)", "Malus domestica" or "Castanea sativa (D: Esskastanien)"
 * (research/11 §3.3: "Kastanie" must say which; alone it maps to Aesculus with a warning).
 */
export function speciesFor(text: string | undefined): TreeSpecies {
  const t = (text ?? '').toLowerCase();
  if (/edelkastanie|esskastanie|castanea|sweet chestnut/.test(t)) return SPECIES.castanea;
  if (/rosskastanie|aesculus|marronnier|horse chestnut/.test(t)) return SPECIES.aesculus;
  if (/kastanie|chestnut/.test(t)) {
    if (!warnedKastanie) {
      warnedKastanie = true;
      console.warn(`[trees] "${text}": Kastanie without species, using Aesculus; the catalogue must say which (research/11 §3.3)`);
    }
    return SPECIES.aesculus;
  }
  if (/pappel|populus/.test(t)) return SPECIES.populus_italica;
  if (/malus|apfel/.test(t)) return SPECIES.malus;
  if (/taxus|eibe/.test(t)) return SPECIES.taxus_cone;
  // wave-9 review fix: the framing groups' feathered Heister (TF-47) before the nursery-standard rule
  if (/heister/.test(t) && /tilia|linde/.test(t)) return SPECIES.tilia_heister;
  // feathered young trees of a landscape planting (clumps, lawn solitaires) [N]; before the avenue lime
  if (/feathered|heister|solitär|solitary/.test(t) && /tilia|linde|carpinus|hainbuche/.test(t)) return SPECIES.tilia_young;
  if (/hainbuche|carpinus/.test(t)) return SPECIES.tilia; // young broadleaf of the same size class [I]; before "pinus"
  if (/conifer|\bpinus|picea|larix|kiefer|fichte|lärche|nadel/.test(t)) return SPECIES.conifer;
  if (/july-flowering|juliblüher/.test(t)) return SPECIES.shrub_july; // before the generic shrub test ("\brosa\b")
  if (/out of flower/.test(t)) return SPECIES.shrub_green; // wave-9 review fix (TF-46)
  if (/shrub|strauch|sträucher|syringa|philadelphus|viburnum|cornus|laburnum|spiraea|\brosa\b/.test(t)) return SPECIES.shrub_flowering;
  if (/citrus|orange|pomeranz/.test(t)) return SPECIES.citrus;
  if (/beech_old|fagus|buche|retained|überhälter/.test(t)) return SPECIES.beech_old;
  return SPECIES.tilia;
}

export interface TreeInstance {
  x: number;
  y: number;
  z: number;
  /** Height scale factor (height / species height). */
  scale?: number;
  /**
   * Wave 10: a young avenue tree: its size, crown, lean and variant come from a hash of its position (rowVariation,
   * grammar AVENUE_ROW) instead of the group's random stream, which it still consumes, so the other trees of the
   * group keep their looks.
   */
  row?: boolean;
}

/**
 * Wave 10 (audit #12): independent per-tree values of a young avenue tree from a hash of its position (grammar
 * AVENUE_ROW): height and crown-width factors, crown-depth factor, lean (deg) and its azimuth (rad), crown variant
 * (0..variants-1), whether it is a replanted younger tree, and (wave 11) crown anisotropy and leaf tone / hue offsets.
 * Pure and deterministic.
 */
export function rowVariation(x: number, z: number, variants = 3): { height: number; width: number; depth: number; lean: number; leanAz: number; variant: number; replant: boolean; aniso: number; tone: number; hue: number } {
  const kx = Math.round(x * 4);
  const kz = Math.round(z * 4);
  const u = (i: number) => hash12(kx * 0.37 + i * 17.13, kz * 0.41 - i * 11.71);
  const replant = u(1) < 1 / AVENUE_ROW.replantEvery;
  return {
    height: (1 + AVENUE_ROW.height * (2 * u(2) - 1)) * (replant ? AVENUE_ROW.replantScale : 1),
    width: 1 + AVENUE_ROW.width * (2 * u(3) - 1),
    depth: 1 + AVENUE_ROW.depth * (2 * u(4) - 1),
    lean: AVENUE_ROW.lean * u(5),
    leanAz: u(6) * Math.PI * 2,
    variant: Math.min(variants - 1, Math.floor(u(7) * variants)),
    replant,
    // wave 11: out-of-round crown (x : z = aniso : 1 / aniso) and leaf tone (lightness, hue offsets)
    aniso: 1 + AVENUE_ROW.aniso * (2 * u(8) - 1),
    tone: AVENUE_ROW.tone * (2 * u(9) - 1),
    hue: AVENUE_ROW.hue * (2 * u(10) - 1),
  };
}

export interface TreeMeshOptions {
  /** Stakes per tree (young avenue trees, GARDEN.stake); 0 = none. */
  stakes?: number;
  /** Per-instance size jitter ± (default 0.2). */
  jitter?: number;
}

const leafMats = new Map<string, THREE.MeshStandardMaterial>();
/**
 * Leaf material; `speckled` = with per-vertex flower speckles (Bloom), `gloss` = glossy leaves (citrus: `userData.gloss`
 * so the viewer's leaf cards take a glossy lobe; the crown shell only a little smoother, roughness 0.85, since a smooth
 * sphere-level highlight read as a plastic ball), still named 'vegetation.leaf' for the viewer.
 */
function leafMaterial(speckled = false, gloss = false): THREE.MeshStandardMaterial {
  const k = `${speckled ? 'leaf-vc' : 'leaf'}${gloss ? '-gloss' : ''}`;
  let m = leafMats.get(k);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: gloss ? 0.85 : 0.92, vertexColors: speckled });
    m.name = 'vegetation.leaf';
    if (gloss) m.userData.gloss = true;
    leafMats.set(k, m);
  }
  return m;
}
/** Fruit material (plain PBR, instance colours). */
function fruitMaterial(): THREE.MeshStandardMaterial {
  let m = leafMats.get('fruit');
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.45 });
    m.name = 'vegetation.fruit';
    leafMats.set('fruit', m);
  }
  return m;
}
function barkMaterial(): THREE.MeshStandardMaterial {
  let m = leafMats.get('bark');
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95 });
    m.name = 'vegetation.bark';
    leafMats.set('bark', m);
  }
  return m;
}

/**
 * Spruce / fir form of the 'tiered' conifer crown (KB-I66) [N Picea / Abies habit; I numbers]: branch whorls, base
 * radius exponent of the cone, spray thickness (× length), droop of the lowest sprays (rad), inner cone radius.
 */
export const CONIFER_FORM = { whorls: 9, taper: 0.9, thick: 0.34, droop: 0.36, core: 0.5, tag: 'N Picea / Abies habit; I numbers' } as const;

/** Crown height (m) of a species at scale 1. */
export function crownHeight(sp: TreeSpecies): number {
  return sp.height * (1 - sp.trunkFrac);
}

/**
 * Crown builder state: positions, normals and the per-vertex `crown` attribute (xyz = position in the crown envelope,
 * filled in by `finishCrown`; w = clump random 0..0.98, −1 on branch limbs). The viewer's foliage shading reads it
 * (viewer/src/foliage.ts, KB-I44): inner-crown occlusion, per-clump colour and the wind phase.
 */
interface CrownBuf {
  pos: number[];
  nrm: number[];
  w: number[];
}

/**
 * Append geometry `g0` (a lobe / clump) at `c`: vertices jittered per position (`jit` range, horizontal), normals
 * blended between the lobe's own smooth sphere normal and the crown envelope normal (`blend` = envelope share).
 * Detail-0 icosahedra have flat face normals in three; the sphere normal removes the faceted "crystal" look
 * (KB-I44, wave-2 review). `w` is the clump random for all its vertices.
 */
function pushLobe(g0: THREE.BufferGeometry, c: THREE.Vector3, rnd: () => number, jit: [number, number], blend: number, buf: CrownBuf, w: number, stretch = 1, keepNormals = false): void {
  // cones / cylinders are indexed: expand to a triangle soup first (icosahedra already are)
  const g = g0.index ? g0.toNonIndexed() : g0;
  if (g !== g0) g0.dispose();
  const p = g.attributes.position;
  const ni = g.attributes.normal;
  const cache = new Map<string, number>();
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const n2 = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!cache.has(k)) cache.set(k, jit[0] + rnd() * (jit[1] - jit[0]));
    const f = cache.get(k)!;
    v.set(p.getX(i) * f, p.getY(i), p.getZ(i) * f).add(c);
    buf.pos.push(v.x, v.y, v.z);
    if (keepNormals) n.set(ni.getX(i), ni.getY(i), ni.getZ(i));
    else n.set(p.getX(i), p.getY(i), p.getZ(i)).normalize();
    n2.set(v.x, v.y / (stretch * stretch), v.z).normalize();
    n.multiplyScalar(1 - blend).addScaledVector(n2, blend).normalize();
    buf.nrm.push(n.x, n.y, n.z);
    buf.w.push(w);
  }
  g.dispose();
}

/**
 * Leafy crown of clustered clumps (KB-I44): `clumps` small icosahedra spread over an ellipsoid envelope of radius 1
 * and half-height `stretch` (Fibonacci directions, jittered), their centres at `shell` of the envelope so their outer
 * faces form a lumpy, leafy silhouette, plus a darker core that closes the gaps. `profile(t)` (t = −1 base … 1 top)
 * scales the envelope radius per height (taper, column); `bottom` drops clumps below that height (a flatter, more
 * open underside). Limbs: `limbs` tapered 3-sided branches from the crown base out to the clumps, visible through the
 * gaps (w = −1, dark bark in the shader).
 */
export interface ClumpCrownOptions {
  clumps: number;
  /** clump radius (fraction of the envelope radius) */
  clumpR: number;
  /** vertical half-height of the envelope (radius 1) */
  stretch?: number;
  /** radial position of the clump centres (fraction of the envelope) */
  shell?: number;
  /** extra random scatter of clump centres (0..1), e.g. open Castanea crowns */
  scatter?: number;
  profile?: (t: number) => number;
  bottom?: number;
  core?: boolean;
  limbs?: number;
  detail?: 0 | 1;
  /** envelope-normal share of the shading normal */
  blend?: number;
  /** per-vertex radial jitter of the clumps */
  jitter?: [number, number];
  /**
   * clump radius range (× clumpR), default [0.8, 1.2]. A wider range (0.6–1.3) breaks the regular "tiled" look of
   * equal clumps (wave-3 review: turtle-shell pattern) [I].
   */
  sizes?: [number, number];
  /** small outline clumps (0.3–0.5 × clumpR) just outside the shell that break the silhouette [I] */
  twigs?: number;
  /**
   * 'fib' (default): clumps on a Fibonacci spiral over the envelope. 'dome': one top clump and a ring of
   * `clumps − 1` evenly spaced clumps, so even 3–4 clumps fill the envelope's silhouette from every side (the mid
   * forest crown; wave-3 review: 3 spiral clumps read as a narrow column from most directions).
   */
  layout?: 'fib' | 'dome';
}

export function clumpCrown(seed: number, o: ClumpCrownOptions, buf: CrownBuf = { pos: [], nrm: [], w: [] }): CrownBuf {
  const rnd = mulberry32(seed ^ 0x3c1a);
  const st = o.stretch ?? 1;
  const shell = o.shell ?? 0.68;
  const prof = o.profile ?? (() => 1);
  const bottom = o.bottom ?? -0.75;
  const blend = o.blend ?? 0.5;
  const N = Math.max(1, o.clumps);
  const golden = Math.PI * (3 - Math.sqrt(5));
  const c = new THREE.Vector3();
  const rot = rnd() * Math.PI * 2;
  const [s0, s1] = o.sizes ?? [0.8, 1.2];
  if (o.layout === 'dome') {
    // top clump plus a ring: the ring sits a little below the middle, the top clump closes the dome
    const ring = Math.max(2, N - 1);
    for (let i = 0; i < ring; i++) {
      const a = rot + (i / ring) * Math.PI * 2 + (rnd() - 0.5) * 0.5;
      const rr = shell * (0.92 + 0.16 * rnd());
      c.set(Math.cos(a) * rr, (-0.16 + (rnd() - 0.5) * 0.1) * st, Math.sin(a) * rr);
      const g = new THREE.IcosahedronGeometry(o.clumpR * (s0 + (s1 - s0) * rnd()), o.detail ?? 0);
      pushLobe(g, c, rnd, o.jitter ?? [0.88, 1.1], blend, buf, rnd() * 0.98, st);
    }
    if (N > 2) {
      c.set((rnd() - 0.5) * 0.12, (shell * 0.62 + (rnd() - 0.5) * 0.06) * st, (rnd() - 0.5) * 0.12);
      const g = new THREE.IcosahedronGeometry(o.clumpR * (0.95 + 0.15 * rnd()), o.detail ?? 0);
      pushLobe(g, c, rnd, o.jitter ?? [0.88, 1.1], blend, buf, rnd() * 0.98, st);
    }
    return buf;
  }
  for (let i = 0; i < N; i++) {
    // Fibonacci sphere, upper part denser (crowns are leafier on top)
    const y = 1 - ((i + 0.5) / N) * (1 - bottom);
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const a = rot + i * golden + (rnd() - 0.5) * 0.9;
    const sc = o.scatter ?? 0;
    const rr = shell * (1 + (rnd() - 0.5) * (0.25 + sc));
    const pr = prof(y);
    c.set(Math.cos(a) * r * rr * pr, y * rr * st + (rnd() - 0.5) * 0.15 * st, Math.sin(a) * r * rr * pr);
    // lower clumps a little smaller; size jitter (default ±20 %)
    const cr = o.clumpR * (s0 + (s1 - s0) * rnd()) * (0.85 + 0.15 * (y + 1) / 2) * Math.max(0.55, Math.min(1, pr * 1.2));
    const g = new THREE.IcosahedronGeometry(cr, o.detail ?? 0);
    pushLobe(g, c, rnd, o.jitter ?? [0.88, 1.1], blend, buf, rnd() * 0.98, st);
  }
  // outline twigs: small clumps just outside the shell, mostly in the upper two thirds
  const T = o.twigs ?? 0;
  for (let i = 0; i < T; i++) {
    const y = 0.85 - rnd() * 1.25;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const a = rot + rnd() * Math.PI * 2;
    const pr = prof(y);
    const rr = (shell + o.clumpR * 0.75) * (0.95 + 0.1 * rnd());
    c.set(Math.cos(a) * r * rr * pr, y * rr * st, Math.sin(a) * r * rr * pr);
    const g = new THREE.IcosahedronGeometry(o.clumpR * (0.3 + 0.2 * rnd()), 0);
    pushLobe(g, c, rnd, [0.85, 1.12], blend, buf, rnd() * 0.98, st);
  }
  if (o.core !== false) {
    const g = new THREE.IcosahedronGeometry(shell * 0.92, 0);
    g.scale(prof(0), st, prof(0));
    pushLobe(g, new THREE.Vector3(0, 0, 0), rnd, [0.9, 1.05], 0.7, buf, rnd() * 0.98, st);
  }
  const L = o.limbs ?? 0;
  for (let l = 0; l < L; l++) {
    const a = rot + (l / L) * Math.PI * 2 + (rnd() - 0.5) * 0.8;
    const r0 = 0.07 + 0.03 * rnd();
    const from = new THREE.Vector3(0, -st * 0.95, 0);
    const to = new THREE.Vector3(Math.cos(a) * shell * 0.75, (rnd() * 0.5 - 0.05) * st, Math.sin(a) * shell * 0.75);
    pushLimb(from, to, r0, r0 * 0.35, buf);
  }
  return buf;
}

/** A tapered 3-sided branch from `a` to `b` (radii ra, rb), w = −1. */
function pushLimb(a: THREE.Vector3, b: THREE.Vector3, ra: number, rb: number, buf: CrownBuf): void {
  const axis = b.clone().sub(a).normalize();
  const u = new THREE.Vector3(0, 1, 0).cross(axis);
  if (u.lengthSq() < 1e-6) u.set(1, 0, 0);
  u.normalize();
  const v = axis.clone().cross(u).normalize();
  const ring = (c: THREE.Vector3, r: number) =>
    [0, 1, 2].map((k) => {
      const t = (k / 3) * Math.PI * 2;
      const d = u.clone().multiplyScalar(Math.cos(t)).addScaledVector(v, Math.sin(t));
      return { p: c.clone().addScaledVector(d, r), n: d };
    });
  const A = ring(a, ra);
  const B = ring(b, rb);
  for (let k = 0; k < 3; k++) {
    const k1 = (k + 1) % 3;
    for (const q of [A[k], B[k], B[k1], A[k], B[k1], A[k1]]) {
      buf.pos.push(q.p.x, q.p.y, q.p.z);
      buf.nrm.push(q.n.x, q.n.y, q.n.z);
      buf.w.push(-1);
    }
  }
}

/** Scale positions so the crown spans radius `R` horizontally and `H` vertically, centred on y = 0. */
function normalise(pos: number[], R: number, H: number): void {
  let rMax = 1e-6;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    rMax = Math.max(rMax, Math.hypot(pos[i], pos[i + 2]));
    y0 = Math.min(y0, pos[i + 1]);
    y1 = Math.max(y1, pos[i + 1]);
  }
  const ym = (y0 + y1) / 2;
  const sy = H / Math.max(1e-6, y1 - y0);
  for (let i = 0; i < pos.length; i += 3) {
    pos[i] *= R / rMax;
    pos[i + 2] *= R / rMax;
    pos[i + 1] = (pos[i + 1] - ym) * sy;
  }
}

/**
 * Like `normalise`, but the horizontal scale makes the crown's mean silhouette half-width (over 8 horizontal view
 * directions) 1 instead of its largest radius: a crown of few clumps reaches its largest radius in one direction
 * only, so radius-normalised it looked 25-30 % narrower than its instance scale from most sides (wave-3 review: the
 * forest read as columns). The largest radius may then exceed 1 a little.
 */
function normaliseSilhouette(pos: number[], H: number): void {
  normalise(pos, 1, H);
  let sum = 0;
  const K = 8;
  for (let k = 0; k < K; k++) {
    const a = (k / K) * Math.PI;
    const cx = Math.cos(a);
    const cz = Math.sin(a);
    let u0 = Infinity;
    let u1 = -Infinity;
    for (let i = 0; i < pos.length; i += 3) {
      const u = -pos[i] * cz + pos[i + 2] * cx;
      if (u < u0) u0 = u;
      if (u > u1) u1 = u;
    }
    sum += (u1 - u0) / 2;
  }
  const f = K / Math.max(1e-6, sum);
  for (let i = 0; i < pos.length; i += 3) {
    pos[i] *= f;
    pos[i + 2] *= f;
  }
}

/**
 * Geometry of a finished crown buffer: positions as given (already in their final frame), normals, and the `crown`
 * attribute with xyz = position / (R, H/2, R) relative to the envelope centre `cy` (so |xyz| ≈ 1 on the surface).
 */
export function finishCrown(buf: CrownBuf, R: number, halfH: number, cy = 0): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(buf.pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(buf.nrm, 3));
  const cw = new Float32Array((buf.pos.length / 3) * 4);
  for (let i = 0, j = 0; i < buf.pos.length; i += 3, j += 4) {
    cw[j] = buf.pos[i] / R;
    cw[j + 1] = (buf.pos[i + 1] - cy) / halfH;
    cw[j + 2] = buf.pos[i + 2] / R;
    cw[j + 3] = buf.w[i / 3];
  }
  geo.setAttribute('crown', new THREE.Float32BufferAttribute(cw, 4));
  geo.computeBoundingSphere();
  return geo;
}

/**
 * A clump crown of mean silhouette radius 1 and height 2 (centred on y = 0) for instancing with (radius, half-height)
 * scales.
 */
export function unitCrown(seed: number, o: ClumpCrownOptions): THREE.BufferGeometry {
  const buf = clumpCrown(seed, o);
  normaliseSilhouette(buf.pos, 2);
  return finishCrown(buf, 1, 1);
}

/** Options of `unitDome` (KB-I66). */
export interface DomeOptions {
  /** polar angles of the rings from the top (rad), first 0 (pole) and last π */
  rings?: readonly number[];
  /** number of broad bumps (leaf masses) on the surface */
  lumps?: number;
  /** bump height (fraction of the radius) */
  lump?: number;
  /** per-vertex radial jitter ± (fraction) */
  jitter?: number;
}
/**
 * Far-tier crown (KB-I10 / wave-3 review "buckets"): a rounded ellipsoid of radius 1 and height 2 with a pole on top,
 * `segments` meridians and three rings biased toward the top, so the skyline silhouette is a dome and not the flat
 * top edge of a stretched icosahedron. Smooth (sphere) normals and the `crown` attribute (one clump). 5 meridians
 * (an odd count has a near-constant width from every side) and 2 inner rings: 5 + 2·5 + 5 = 20 triangles, as many
 * as the old icosahedron. `o` (KB-I66): more rings and a lumpy radius for the forest's mid and far crowns.
 */
export function unitDome(segments = 5, seed = 97, o: DomeOptions = {}): THREE.BufferGeometry {
  const rnd = mulberry32(seed ^ 0x51d);
  // rings: polar angle from the top (rad); two rings in the upper half round the skyline silhouette
  const rings = o.rings ?? [0, 0.72, 1.5, Math.PI];
  // KB-I66: lumpy outline. `lumps` random bump directions raise the surface by up to `lump` (a few broad leaf masses
  // instead of a regular polygon), plus a per-vertex radial jitter; the pole stays on the axis (dome skyline test)
  const bumps = Array.from({ length: o.lumps ?? 0 }, () => {
    const u = rnd() * 2 - 1;
    const a = rnd() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    return { d: new THREE.Vector3(s * Math.cos(a), Math.abs(u) * 0.8 + 0.1, s * Math.sin(a)).normalize(), a: (o.lump ?? 0) * (0.6 + 0.4 * rnd()) };
  });
  const jit = o.jitter ?? 0;
  const radius = new Map<string, number>();
  const pt = (k: number, j: number): THREE.Vector3 => {
    const th = rings[k];
    const jj = k === 0 || k === rings.length - 1 ? 0 : ((j % segments) + segments) % segments;
    const ph = ((jj + (k % 2) * 0.5) / segments) * Math.PI * 2;
    const v = new THREE.Vector3(Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph));
    const key = `${k},${jj}`;
    let r = radius.get(key);
    if (r === undefined) {
      r = 1;
      if (k > 0 && k < rings.length - 1) {
        // bumps fade toward the poles (sin²), so the pole stays the top and the shoulder stays round (no "bucket")
        for (const b of bumps) r += b.a * Math.max(0, v.dot(b.d)) ** 3 * Math.sin(th) ** 2;
        r *= 1 + (rnd() - 0.5) * 2 * jit;
      }
      radius.set(key, r);
    }
    return v.multiplyScalar(r);
  };
  const buf: CrownBuf = { pos: [], nrm: [], w: [] };
  const w = rnd() * 0.98;
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
    for (const v of [a, b, c]) {
      buf.pos.push(v.x, v.y, v.z);
      const n = v.clone().normalize();
      buf.nrm.push(n.x, n.y, n.z);
      buf.w.push(w);
    }
  };
  for (let j = 0; j < segments; j++) {
    const j1 = (j + 1) % segments;
    tri(pt(0, 0), pt(1, j1), pt(1, j));
    for (let k = 1; k < rings.length - 2; k++) {
      tri(pt(k, j), pt(k, j1), pt(k + 1, j));
      tri(pt(k, j1), pt(k + 1, j1), pt(k + 1, j));
    }
    tri(pt(rings.length - 2, j), pt(rings.length - 2, j1), pt(rings.length - 1, 0));
  }
  normaliseSilhouette(buf.pos, 2);
  return finishCrown(buf, 1, 1);
}

/** Clump layout per crown shape and species character (Tilia dense ovoid, Aesculus broad dark dome, Castanea open,
 * Malus low and wide, old beech broad; KB-I11 shapes kept recognisable) [I]. */
function lobedClumps(sp: TreeSpecies, shape: CrownShape): ClumpCrownOptions {
  const st = Math.max(0.45, crownHeight(sp) / (2 * sp.crown));
  // site trees stand near the eye-level views: detail-1 clumps (80 faces) so their silhouettes don't read as rocks.
  // Shrubs (~600 in the gardens, 1-2 m) take 8 detail-0 clumps (180 faces instead of 500: −0.19 M triangles).
  // Shrubs (~600 in the gardens, 1-2 m) take 10 small detail-0 clumps of mixed size (~220 faces):
  // the 8 large clumps of wave 3 read as a mound of boulders at eye level (wave-3 review, poses 16/17).
  // Wave 5: still a mound at pose 16/17 -> a loosely vase-shaped multi-stem shrub: slightly narrower base (profile),
  // no smooth core, scattered clumps of very mixed size, outline twigs and three stems in the gaps [N Syringa /
  // Philadelphus habit; I numbers] (~320 faces)
  // Wave 6: the three limbs read as black stilts under a hovering mass at eye level (KB-I63, pose 33). A flowering
  // shrub is branched from the ground [N Syringa / Philadelphus habit], so: no limbs, the clumps reach down to the
  // ground (bottom −0.9) with a skirt of low clumps, and a small core so no daylight shows through the base [I].
  // clipped tub standard (citrus): a dense, nearly round head of many even clumps that shades as one sphere; the leaf
  // cards give its leafy surface in the viewer [N clipped orange standards; I numbers]
  if (shape === 'clipped')
    return { clumps: 18, clumpR: 0.3, stretch: st, shell: 0.74, bottom: -0.85, scatter: 0, core: true, limbs: 0, blend: 0.8, detail: 1, sizes: [0.85, 1.1], jitter: [0.96, 1.04], twigs: 0 };
  if (shape === 'shrub')
    return {
      clumps: 13,
      clumpR: 0.31,
      stretch: st,
      shell: 0.7,
      bottom: -0.9,
      scatter: 0.55,
      core: true,
      limbs: 0,
      blend: 0.62,
      detail: 0,
      sizes: [0.45, 1.3],
      twigs: 4,
      profile: (t: number) => (t < 0 ? 0.86 + 0.14 * Math.sqrt(t + 1) : 1 - 0.12 * t),
    };
  const lobes = sp.lobes ?? (sp.detail ? 5 : 2);
  const spread = sp.spread ?? 0.42;
  const open = Math.max(0, spread - 0.42) * 2; // Castanea, Malus: more scattered, gappier
  // big crowns (retained beeches, R 7 m) get more, smaller clumps: clumps of a fixed share of the crown read as
  // metre-sized hexagonal plates at 60 m (wave-3 review, pose 13) [I]
  const big = Math.max(1, (sp.crown / 3) ** 1.2);
  return {
    clumps: Math.round((4 + lobes) * big),
    clumpR: (0.44 - open * 0.08) / Math.sqrt(big),
    stretch: st,
    shell: 0.64 + open * 0.08,
    scatter: open,
    bottom: -0.55,
    core: true,
    limbs: sp.trunk === false ? 0 : 3,
    blend: 0.62,
    detail: sp.detail,
    // mixed clump sizes (wave-3 review: equal clumps tile like a turtle shell); outline twigs only on the cheap
    // detail-0 crowns (site trees are drawn at every distance: ~280 feathered limes alone) [I]
    sizes: [0.6, 1.3],
    twigs: sp.detail ? 0 : 2,
  };
}

/**
 * Crown geometry of a species in metres (radius sp.crown, height crownHeight(sp), centred on its middle), with the
 * `crown` attribute for the foliage shading. Species with `bloom` get a vertex colour per face: 1 for leaf faces,
 * flower / leaf colour (linear) on `faceShare[variant]` of the faces, so that colour × the per-instance leaf colour
 * gives the flower hue.
 */
export function crownGeometry(sp: TreeSpecies, seed: number, variant = 0): THREE.BufferGeometry {
  const rnd = mulberry32(seed);
  const buf: CrownBuf = { pos: [], nrm: [], w: [] };
  const shape = sp.shape ?? 'lobed';
  const R = sp.crown;
  const H = crownHeight(sp);
  if (shape === 'tiered') {
    // KB-I66: a young spruce / fir (Picea, Abies; Pinus strobus is softer but the same outline at 10 m) [N habit; I
    // numbers]: a narrow cone of CONIFER_FORM.whorls branch whorls, each of 5-6 flat drooping sprays pointing out from
    // the stem, the tiers overlapping like shingles (the 4 tiers of 3 round lobes of wave 2 read as stacked ornaments,
    // pose 34), a dark inner cone that closes the gaps, and a slim leader. Needle cards cover it in the viewer.
    const F = CONIFER_FORM;
    const Ht = 3.2; // build height (normalised to the crown height below)
    const core = new THREE.ConeGeometry(F.core, Ht * 0.92, 7, 1, true);
    pushLobe(core, new THREE.Vector3(0, Ht * 0.46, 0), rnd, [0.95, 1.05], 0.6, buf, 0.5 + rnd() * 0.1, 1.6);
    const up = new THREE.Vector3(0, 1, 0);
    const q = new THREE.Quaternion();
    const qd = new THREE.Quaternion();
    const ax = new THREE.Vector3();
    for (let k = 0; k < F.whorls; k++) {
      const t = (k + 0.5 * rnd()) / F.whorls; // 0 base .. 1 top
      const r = Math.max(0.12, (1 - t) ** F.taper) * (0.9 + 0.2 * rnd());
      const n = k < F.whorls - 2 ? 6 + Math.floor(rnd() * 2) : 5;
      const a0 = rnd() * Math.PI * 2;
      for (let l = 0; l < n; l++) {
        const ang = a0 + (l / n) * Math.PI * 2 + (rnd() - 0.5) * 0.7;
        const len = r * (0.56 + 0.2 * rnd());
        const g = new THREE.IcosahedronGeometry(1, 0);
        // flat spray: long along the branch (x), thin vertically, a little narrower across
        g.scale(len, len * F.thick, len * (0.75 + 0.2 * rnd()));
        // droop: lower branches hang more [N Picea habit]
        g.applyQuaternion(qd.setFromAxisAngle(ax.set(0, 0, 1), -(F.droop * (1 - t) + 0.05) * (0.8 + 0.4 * rnd())));
        g.applyQuaternion(q.setFromAxisAngle(up, -ang));
        const off = r * 0.52;
        pushLobe(g, new THREE.Vector3(Math.cos(ang) * off, t * Ht * 0.86 + 0.08, Math.sin(ang) * off), rnd, [0.9, 1.1], 0.35, buf, rnd() * 0.98, 1.6);
      }
    }
    pushLobe(new THREE.ConeGeometry(0.06, 0.55, 5, 1, false), new THREE.Vector3(0, Ht * 0.97, 0), rnd, [0.95, 1.05], 0.2, buf, rnd() * 0.98, 1.6, true);
  } else if (shape === 'cone') {
    const g = new THREE.ConeGeometry(1, 2, 12, 2, false);
    // w = 0.99: a clipped surface (no leaf cards, no shell darkening under them; viewer foliage.ts)
    rnd();
    pushLobe(g, new THREE.Vector3(0, 0, 0), rnd, [0.97, 1.03], 0.3, buf, 0.99, 1, true);
  } else if (shape === 'column') {
    // Lombardy poplar (wave-3 review: "a stack of lumps"): one tapered column, widest a third up and ending in a
    // point, with fine shallow clumps on its surface for the leafy texture (KB-I11 silhouette kept) [I]
    const st = 3.2;
    const prof = (t: number) => Math.max(0.0, 1 - 0.75 * Math.max(0, t + 0.35) ** 1.3 - 0.45 * Math.max(0, -0.35 - t) ** 0.8);
    const pts: THREE.Vector2[] = [];
    const STEPS = 10;
    for (let k = 0; k <= STEPS; k++) {
      const t = -1 + (2 * k) / STEPS;
      const r = k === 0 || k === STEPS ? 0 : 0.62 * Math.max(0.12, prof(t));
      pts.push(new THREE.Vector2(r, t * st));
    }
    // lathe points run bottom → top, so the faces wind outward
    pushLobe(new THREE.LatheGeometry(pts, 8), new THREE.Vector3(0, 0, 0), rnd, [0.93, 1.07], 0.35, buf, rnd() * 0.98, st, true);
    const N = 34;
    for (let i = 0; i < N; i++) {
      const t = -0.85 + 1.75 * ((i + rnd()) / N);
      const a = rnd() * Math.PI * 2;
      const r = 0.62 * Math.max(0.12, prof(t)) * 0.9;
      const g = new THREE.IcosahedronGeometry(0.13 + 0.12 * Math.max(0.2, prof(t)) * (0.7 + 0.6 * rnd()), 0);
      pushLobe(g, new THREE.Vector3(Math.cos(a) * r, t * st, Math.sin(a) * r), rnd, [0.9, 1.1], 0.55, buf, rnd() * 0.98, st);
    }
  } else {
    clumpCrown(seed, lobedClumps(sp, shape), buf);
  }
  normalise(buf.pos, R, H);
  const geo = finishCrown(buf, R, H / 2);
  if (sp.bloom) geo.setAttribute('color', new THREE.Float32BufferAttribute(bloomTint(sp, sp.bloom, geo.getAttribute('crown') as THREE.BufferAttribute, variant, seed), 3));
  return geo;
}

/** Largest flower tint of a vertex (share of the way from the leaf to the flower colour) [I]. */
export const BLOOM_TINT_MAX = 0.15;

/**
 * Per-vertex flower tint of a crown (wave-3 review: the per-face speckles of `bloomColours` read as stray pink
 * triangles). About 4 × `faceShare[variant]` of the clumps flower; on those the tint rises toward the clump tips
 * (outer vertices of the crown envelope) up to BLOOM_TINT_MAX of the way from the leaf to the flower colour, so the
 * flowers read as a soft haze on the sunny outside, never as a solid patch. Values are multipliers of the per-instance
 * leaf colour (1 = leaf), deterministic per seed.
 */
export function bloomTint(sp: TreeSpecies, bloom: Bloom, crown: THREE.BufferAttribute, variant: number, seed: number): number[] {
  const rnd = mulberry32(seed ^ 0x6b6c6f6f);
  const leaf = new THREE.Color(sp.leaf);
  const n = Math.max(1, bloom.colours.length);
  const fl = new THREE.Color(bloom.colours[variant % n]);
  const ratio = [fl.r / Math.max(leaf.r, 1e-3), fl.g / Math.max(leaf.g, 1e-3), fl.b / Math.max(leaf.b, 1e-3)];
  const share = Math.min(1, 4 * (bloom.faceShare[variant % Math.max(1, bloom.faceShare.length)] ?? 0));
  const flowering = new Map<number, boolean>();
  const col: number[] = [];
  for (let i = 0; i < crown.count; i++) {
    const w = crown.getW(i);
    let on = flowering.get(w);
    if (on === undefined) flowering.set(w, (on = w >= 0 && rnd() < share));
    const r = Math.hypot(crown.getX(i), crown.getY(i), crown.getZ(i));
    const t = on ? Math.min(1, Math.max(0, (r - 0.7) / 0.3)) : 0;
    const a = BLOOM_TINT_MAX * t * t * (3 - 2 * t);
    col.push(1 + (ratio[0] - 1) * a, 1 + (ratio[1] - 1) * a, 1 + (ratio[2] - 1) * a);
  }
  return col;
}

/**
 * Per-face flower speckles (3 vertices per face; wave 2). No longer used by crownGeometry (see `bloomTint`); kept for
 * its tests and as the reference of the July bloom share.
 */
export function bloomColours(sp: TreeSpecies, bloom: Bloom, faces: number, variant: number, seed: number): number[] {
  const rnd = mulberry32(seed ^ 0x6b6c6f6f);
  const leaf = new THREE.Color(sp.leaf);
  const n = Math.max(1, bloom.colours.length);
  const fl = new THREE.Color(bloom.colours[variant % n]).lerp(leaf, 1 - (bloom.strength ?? 1));
  const ratio = [fl.r / Math.max(leaf.r, 1e-3), fl.g / Math.max(leaf.g, 1e-3), fl.b / Math.max(leaf.b, 1e-3)];
  const share = bloom.faceShare[variant % Math.max(1, bloom.faceShare.length)] ?? 0;
  const col: number[] = [];
  for (let f = 0; f < faces; f++) {
    const c = rnd() < share ? ratio : [1, 1, 1];
    for (let k = 0; k < 3; k++) col.push(c[0], c[1], c[2]);
  }
  return col;
}

/**
 * Crown of a nursery standard (TreeSpecies.standard) of total height `h`: clear stem from the range (random `a`), the
 * crown from the stem to the top (at least 1.5 m), crown width from the range (random `b`), never wider than 1.3 × the
 * crown height. Returns the stem and crown height (m) and the crown geometry's scale factors (horizontal, vertical).
 */
export function standardCrown(sp: TreeSpecies, h: number, a: number, b: number): { stem: number; crownH: number; width: number; sx: number; sy: number } {
  const st = sp.standard!;
  const stem = Math.min(st.clearStem[0] + (st.clearStem[1] - st.clearStem[0]) * a, h * 0.5);
  const ch = Math.max(1.5, h - stem);
  const width = Math.min(st.crownWidth[0] + (st.crownWidth[1] - st.crownWidth[0]) * b, ch * 1.3);
  return { stem, crownH: ch, width, sx: width / 2 / sp.crown, sy: ch / crownHeight(sp) };
}

/** Instanced trees of one species at the given positions (local frame, y = ground height). */
export function treeMeshes(sp: TreeSpecies, trees: TreeInstance[], seed = 1789, name = 'trees', opts: TreeMeshOptions = {}): THREE.Group {
  const group = new THREE.Group();
  group.name = `${name}/${sp.key}`;
  if (!trees.length) return group;
  const crownH = crownHeight(sp);
  const hasTrunk = sp.trunk !== false;
  const r0 = sp.trunkR ?? 0.18 * (sp.height / 6) ** 0.7;
  const trunkGeo = new THREE.CylinderGeometry(sp.trunkR ? r0 * 0.8 : 0.12 * (sp.height / 6) ** 0.7, r0, 1, 6, 1, true);
  trunkGeo.translate(0, 0.5, 0);
  // three crown variants per species, each an InstancedMesh; trees pick one at random
  const VARIANTS = 3;
  const crownGeos = Array.from({ length: VARIANTS }, (_, v) => crownGeometry(sp, seed + v * 7919, v));
  const pick = mulberry32(seed ^ 0x2545f491);
  const which = trees.map((t) => {
    const w = Math.floor(pick() * VARIANTS);
    return t.row ? rowVariation(t.x, t.z, VARIANTS).variant : w;
  });
  const trunks = hasTrunk ? new THREE.InstancedMesh(trunkGeo, barkMaterial(), trees.length) : null;
  const crownsV = crownGeos.map((g, v) => {
    const n = which.filter((w) => w === v).length;
    const im = new THREE.InstancedMesh(g, leafMaterial(!!sp.bloom, !!sp.gloss), Math.max(1, n));
    im.count = n;
    im.name = `${name}/${sp.key}/crowns${v ? `-${v}` : ''}`;
    return im;
  });
  const nStakes = Math.max(0, Math.floor(opts.stakes ?? 0));
  let stakes: THREE.InstancedMesh | null = null;
  if (nStakes) {
    const sg = new THREE.BoxGeometry(GARDEN.stake.size, 1, GARDEN.stake.size);
    sg.translate(0, 0.5, 0);
    stakes = new THREE.InstancedMesh(sg, barkMaterial(), trees.length * nStakes);
    stakes.name = `${name}/${sp.key}/stakes`;
  }
  const fill = crownsV.map(() => 0);
  if (trunks) trunks.name = `${name}/${sp.key}/trunks`;
  const rnd = mulberry32(seed ^ 0x5bd1e995);
  const jitter = opts.jitter ?? sp.jitter ?? 0.2;
  const clipped = sp.shape === 'clipped';
  // fruit on the crown surface (citrus): small spheres, positions from their own stream (the tree stream stays as is)
  const fruitN = sp.fruit ? sp.fruit.perTree * trees.length : 0;
  const fruit = fruitN ? new THREE.InstancedMesh(new THREE.SphereGeometry(1, 7, 5), fruitMaterial(), fruitN) : null;
  const fruitRnd = mulberry32(seed ^ 0x0f7a17);
  const fruitCols = (sp.fruit?.colours ?? []).map((x) => new THREE.Color(x));
  let fi = 0;
  const fp = new THREE.Vector3();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const qt = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const off = new THREE.Vector3();
  const c = new THREE.Color();
  const leaf = new THREE.Color(sp.leaf);
  const hsl = { h: 0, s: 0, l: 0 };
  const leafL = leaf.getHSL({ h: 0, s: 0, l: 0 }).l;
  const bark = new THREE.Color(sp.bark);
  const stakeCol = new THREE.Color('#9A8768');
  const flowerCols = (sp.flowers?.colours ?? []).map((x) => new THREE.Color(x));
  const tint = sp.tint ? new THREE.Color(sp.tint.colour) : null;
  trees.forEach((t, i) => {
    // wave 10: a young avenue tree takes its own hashed values (rowVariation); the stream is consumed all the same
    const rv = t.row ? rowVariation(t.x, t.z, VARIANTS) : null;
    const sj = 1 - jitter + rnd() * 2 * jitter;
    const s = (t.scale ?? 1) * (rv ? rv.height : sj);
    const h = sp.height * s;
    q.setFromAxisAngle(up, rnd() * Math.PI * 2);
    if (sp.lean) {
      const a = rnd() * Math.PI * 2;
      qt.setFromAxisAngle(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), ((rnd() * 2 - 1) * sp.lean * Math.PI) / 180);
      q.premultiply(qt);
    }
    if (rv) {
      qt.setFromAxisAngle(new THREE.Vector3(Math.cos(rv.leanAz), 0, Math.sin(rv.leanAz)), (rv.lean * Math.PI) / 180);
      q.premultiply(qt);
    }
    const base = new THREE.Vector3(t.x, t.y, t.z);
    // nursery standard: absolute clear stem, crown fills the rest of the height at its own width (standardCrown)
    const std = sp.standard ? standardCrown(sp, h, rnd(), rnd()) : null;
    if (trunks) {
      const trunkTop = std ? std.stem + std.crownH * 0.3 : h * sp.trunkFrac + crownH * s * 0.3;
      m.compose(base.clone().setY(t.y - 0.2), q, new THREE.Vector3(s, trunkTop + 0.2, s));
      trunks.setMatrixAt(i, m);
      trunks.setColorAt(i, bark);
    }
    const jr = clipped ? (rnd(), 1) : 0.9 + rnd() * 0.2; // crown width variation (clipped heads: none)
    const j = rv ? rv.width : jr;
    // (a young avenue tree's crown reaches lower or higher on its stem: depth, top kept at h)
    const cd = rv ? rv.depth : 1;
    if (std) {
      off.set(0, std.stem + std.crownH / 2, 0).applyQuaternion(q);
      m.compose(base.clone().add(off), q, new THREE.Vector3(std.sx, std.sy, std.sx));
    } else {
      off.set(0, h - (crownH * s * cd) / 2, 0).applyQuaternion(q);
      const an = rv ? rv.aniso : 1;
      m.compose(base.clone().add(off), q, new THREE.Vector3(s * j * an, s * cd, (s * j) / an));
    }
    const im = crownsV[which[i]];
    const k = fill[which[i]]++;
    im.setMatrixAt(k, m);
    // hue / saturation / lightness variation (fix round 1: uniform dark crowns); overlapping shrubs of a clump
    // planting vary less in lightness, or the mass reads mottled (wave-3 review, poses 16/17)
    const lj = sp.shape === 'shrub' ? 0.06 : 0.14;
    // wave 5: the lightness offset works in the linear working space, so on a dark leaf (clipped yew #22341E, L ≈ 0.02)
    // ±0.05 sent instances to black or to 4× the colour; scale it with the leaf lightness below L 0.08 and keep at
    // least 60 % of the species' lightness
    // clipped standards of one row: half the variation
    const vk = clipped ? 0.5 : 1;
    c.copy(leaf).offsetHSL((rnd() - 0.5) * 0.07 * vk, (rnd() - 0.5) * 0.18 * vk, (rnd() - 0.35) * lj * vk * Math.min(1, leafL / 0.08));
    c.getHSL(hsl);
    if (hsl.l < 0.6 * leafL) c.setHSL(hsl.h, hsl.s, 0.6 * leafL);
    const fl = rnd();
    const fc = rnd();
    if (sp.flowers && flowerCols.length && fl < sp.flowers.share) c.lerp(flowerCols[Math.floor(fc * flowerCols.length)], sp.flowers.amount);
    if (tint && sp.tint) c.lerp(tint, fc * sp.tint.amount);
    // wave 11: a young avenue tree's own leaf tone (rowVariation), scaled like the lightness jitter above
    if (rv) c.offsetHSL(rv.hue, 0, rv.tone * Math.min(1, leafL / 0.08));
    im.setColorAt(k, c);
    if (fruit && sp.fruit) {
      // on the outer surface of the head, mostly on its sides and lower half (fruit hangs) [I]
      const R = sp.crown;
      const Hh = crownH / 2; // crown half-height in crown units (the matrix scales them)
      for (let f = 0; f < sp.fruit.perTree; f++) {
        const yy = -0.85 + fruitRnd() * 1.35;
        const a = fruitRnd() * Math.PI * 2;
        const rr = Math.sqrt(Math.max(0, 1 - yy * yy));
        fp.set(Math.cos(a) * rr * R * 1.01, yy * Hh * 1.01, Math.sin(a) * rr * R * 1.01).applyMatrix4(m);
        const fr = sp.fruit.radius * (0.85 + 0.3 * fruitRnd());
        fruit.setMatrixAt(fi, new THREE.Matrix4().compose(fp, q, new THREE.Vector3(fr, fr, fr)));
        fruit.setColorAt(fi, fruitCols[Math.floor(fruitRnd() * fruitCols.length)]);
        fi++;
      }
    }
    if (stakes) {
      for (let st = 0; st < nStakes; st++) {
        const a = rnd() * Math.PI * 2 + (st * Math.PI * 2) / nStakes;
        m.compose(
          new THREE.Vector3(t.x + Math.cos(a) * GARDEN.stake.offset, t.y - 0.3, t.z + Math.sin(a) * GARDEN.stake.offset),
          new THREE.Quaternion(),
          new THREE.Vector3(1, GARDEN.stake.height + 0.3, 1),
        );
        stakes.setMatrixAt(i * nStakes + st, m);
        stakes.setColorAt(i * nStakes + st, stakeCol);
      }
    }
  });
  if (trunks) {
    trunks.castShadow = true;
    trunks.receiveShadow = true;
    trunks.computeBoundingSphere();
    trunks.userData = { part: 'vegetation', species: sp.key };
    group.add(trunks);
  }
  for (const im of crownsV) {
    if (!im.count) continue;
    im.castShadow = im.receiveShadow = true;
    im.computeBoundingSphere();
    im.userData = { part: 'vegetation', species: sp.key };
    group.add(im);
  }
  if (fruit) {
    fruit.name = `${name}/${sp.key}/fruit`;
    fruit.castShadow = false;
    fruit.receiveShadow = true;
    fruit.computeBoundingSphere();
    // a 8 cm fruit is a pixel at ~120 m [I]
    fruit.userData = { part: 'vegetation', species: sp.key, lod: 0, maxDistance: 120 };
    group.add(fruit);
  }
  if (stakes) {
    stakes.castShadow = false;
    stakes.receiveShadow = true;
    stakes.computeBoundingSphere();
    // near detail only (LOD0): a stake is 6 cm wide, invisible beyond ~150 m [N stakes; render I]
    stakes.userData = { part: 'vegetation', species: sp.key, lod: 0, maxDistance: 150 };
    group.add(stakes);
  }
  return group;
}
