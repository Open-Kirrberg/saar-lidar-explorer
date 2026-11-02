/**
 * Known areas of interest (pure, no DOM). Bounding boxes are copied from `pipeline/aois.toml`
 * ([E_min, N_min, E_max, N_max], EPSG:25832) — keep them in sync by hand when an AOI changes.
 * The three focus areas are drawn as dashed outlines on the minimap; `overall` covers them all.
 */
export interface KnownAoi {
  id: string;
  /** German display name (minimap tooltip, "Gebiet" switcher). */
  name_de: string;
  bbox: [number, number, number, number];
  /** Focus area (outlined on the minimap) vs. the combined overall AOI. */
  focus: boolean;
}

export const KNOWN_AOIS: readonly KnownAoi[] = [
  { id: 'overall', name_de: 'Gesamtgebiet (Homburg / Kirrberg / Karlsberg)', bbox: [378000, 5460000, 384000, 5468000], focus: false },
  { id: 'karlsberg', name_de: 'Schloss Karlsberg', bbox: [381000, 5465000, 384000, 5468000], focus: true },
  { id: 'homburg', name_de: 'Homburg + Schlossberg', bbox: [378000, 5463000, 381000, 5466000], focus: true },
  { id: 'kirrberg', name_de: 'Kirrberg + Merburg', bbox: [380000, 5460000, 383000, 5463500], focus: true },
];

export const PREFERRED_AOI = 'overall';
export const LEGACY_DEFAULT_AOI = 'karlsberg';

export const FOCUS_AREAS: readonly KnownAoi[] = KNOWN_AOIS.filter((a) => a.focus);

/** `?aoi=` value (validated like manifest.ts' aoiFromUrl), or null if absent/invalid. */
export function aoiParam(search: string): string | null {
  const v = new URLSearchParams(search).get('aoi');
  return v && /^[\w-]+$/.test(v) ? v : null;
}

/**
 * The AOI to load: an explicit `?aoi=` wins; otherwise 'overall' when its manifest exists, else
 * 'karlsberg' (the MVP AOI; manifest.ts falls back to the fixture if that is missing too).
 */
export function chooseAoi(search: string, overallAvailable: boolean): string {
  return aoiParam(search) ?? (overallAvailable ? PREFERRED_AOI : LEGACY_DEFAULT_AOI);
}

/**
 * Start AOI for a deployment that ships only `deployed` AOIs (`VITE_AOIS`, e.g. the public build
 * with just 'overall'): `?aoi=` wins when it is deployed, else the preferred AOI if deployed, else
 * the first one. No probing needed — the deployment knows what it has.
 */
export function chooseDeployedAoi(search: string, deployed: readonly string[]): string {
  const p = aoiParam(search);
  if (p && deployed.includes(p)) return p;
  return deployed.includes(PREFERRED_AOI) ? PREFERRED_AOI : deployed[0]!;
}

/** Known AOIs to offer in the "Gebiet" switcher: all, or only the deployed ones. */
export function switchableAois(deployed: readonly string[] | null): readonly KnownAoi[] {
  return deployed ? KNOWN_AOIS.filter((a) => deployed.includes(a.id)) : KNOWN_AOIS;
}

/** Is UTM (E, N) inside the bbox (inclusive)? */
export function inBbox(b: readonly [number, number, number, number], E: number, N: number): boolean {
  return E >= b[0] && E <= b[2] && N >= b[1] && N <= b[3];
}

/**
 * URL (search + hash) for switching to `aoi`: sets `?aoi=`, keeps other params; keeps the
 * camera hash only if its position lies inside the target AOI (else the AOI centre is used).
 */
export function switchAoiHref(
  loc: { pathname: string; search: string; hash: string },
  aoi: string,
  pos: { E: number; N: number } | null,
): string {
  const params = new URLSearchParams(loc.search);
  params.set('aoi', aoi);
  const target = KNOWN_AOIS.find((a) => a.id === aoi);
  const keepHash = !!(pos && target && inBbox(target.bbox, pos.E, pos.N));
  return `${loc.pathname}?${params.toString()}${keepHash ? loc.hash : ''}`;
}

/** Densified rectangle ring (UTM) for drawing a UTM box in Web Mercator. */
export function bboxRing(b: readonly [number, number, number, number], perEdge = 8): Array<[number, number]> {
  const [e0, n0, e1, n1] = b;
  const corners: Array<[number, number]> = [
    [e0, n0],
    [e1, n0],
    [e1, n1],
    [e0, n1],
  ];
  const out: Array<[number, number]> = [];
  for (let i = 0; i < 4; i++) {
    const [ea, na] = corners[i];
    const [eb, nb] = corners[(i + 1) % 4];
    for (let k = 0; k < perEdge; k++) {
      const t = k / perEdge;
      out.push([ea + (eb - ea) * t, na + (nb - na) * t]);
    }
  }
  return out;
}
