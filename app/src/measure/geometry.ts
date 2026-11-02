/**
 * Pure measuring geometry (F17) in EPSG:25832 metres — no three.js / DOM.
 *
 * Lengths and areas are computed in the UTM grid (plane geometry). Over the explorer's area
 * (E ≈ 375–390 km, ~1.6° west of the 9°E central meridian) the grid is a little *short*:
 * point scale factor k ≈ 0.99977, so a grid length is ≈ 0.023 % below the ellipsoid length, and
 * the terrain at ~250–400 m ü. NN adds ≈ +0.005 % (height reduction). `groundFactor` returns the
 * combined correction grid → "Naturmaß" (horizontal distance at terrain height); it is shown as a
 * note, the UTM value stays the primary readout (it matches Leaflet's spherical distance to
 * ≈ 0.3 %, far inside the 1 % acceptance).
 */

export interface PointEN {
  E: number;
  N: number;
}

/** Horizontal length of an open polyline (grid metres). */
export function polylineLength(pts: readonly PointEN[]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i].E - pts[i - 1].E, pts[i].N - pts[i - 1].N);
  return s;
}

/** Perimeter of a closed ring (the closing edge last → first is added; don't repeat the first point). */
export function ringPerimeter(pts: readonly PointEN[]): number {
  if (pts.length < 2) return 0;
  const last = pts[pts.length - 1];
  return polylineLength(pts) + Math.hypot(pts[0].E - last.E, pts[0].N - last.N);
}

/**
 * Signed shoelace area (m², counter-clockwise in E/N positive). Coordinates are reduced to the
 * first vertex first, so 7-digit UTM northings don't cost precision.
 */
export function signedArea(pts: readonly PointEN[]): number {
  const n = pts.length;
  if (n < 3) return 0;
  const E0 = pts[0].E;
  const N0 = pts[0].N;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    s += (a.E - E0) * (b.N - N0) - (b.E - E0) * (a.N - N0);
  }
  return s / 2;
}

/** Horizontal (grid) area of a simple polygon, m². */
export function polygonArea(pts: readonly PointEN[]): number {
  return Math.abs(signedArea(pts));
}

/** True when two non-adjacent edges of the closed ring cross (area would be meaningless). */
export function ringSelfIntersects(pts: readonly PointEN[]): boolean {
  const n = pts.length;
  if (n < 4) return false;
  const cross = (o: PointEN, a: PointEN, b: PointEN) => (a.E - o.E) * (b.N - o.N) - (a.N - o.N) * (b.E - o.E);
  for (let i = 0; i < n; i++) {
    const a1 = pts[i];
    const a2 = pts[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // adjacent through the closing edge
      const b1 = pts[j];
      const b2 = pts[(j + 1) % n];
      const d1 = cross(b1, b2, a1);
      const d2 = cross(b1, b2, a2);
      const d3 = cross(a1, a2, b1);
      const d4 = cross(a1, a2, b2);
      if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
    }
  }
  return false;
}

/** Mean of the vertices (label anchor for areas). */
export function centroidOfVertices(pts: readonly PointEN[]): PointEN {
  let E = 0;
  let N = 0;
  for (const p of pts) {
    E += p.E;
    N += p.N;
  }
  const n = Math.max(pts.length, 1);
  return { E: E / n, N: N / n };
}

// ---- UTM scale ---------------------------------------------------------------------------------

/** GRS80 (ETRS89) ellipsoid. */
export const GRS80 = { a: 6378137, f: 1 / 298.257222101 } as const;
export const UTM_K0 = 0.9996;
export const UTM_FALSE_EASTING = 500000;
/** Geoid undulation (quasigeoid GCG2016) in the Saarland ≈ 48 m: ellipsoidal h ≈ NHN + 48 m. */
export const GEOID_UNDULATION_SAAR = 48;

/** Meridian (ρ) and prime-vertical (ν) radii of curvature of GRS80 at latitude φ (degrees). */
export function radiiOfCurvature(latDeg: number): { rho: number; nu: number } {
  const e2 = GRS80.f * (2 - GRS80.f);
  const s = Math.sin((latDeg * Math.PI) / 180);
  const w = Math.sqrt(1 - e2 * s * s);
  return { rho: (GRS80.a * (1 - e2)) / (w * w * w), nu: GRS80.a / w };
}

/**
 * UTM point scale factor at easting E (latitude φ in degrees for the local radius):
 * k = k0 · (1 + x²/(2R²) + x⁴/(24R⁴)), x = (E − 500 000)/k0, R² = ρν. Error < 1e-9 within a zone.
 */
export function gridScaleFactor(E: number, latDeg: number): number {
  const { rho, nu } = radiiOfCurvature(latDeg);
  const R2 = rho * nu;
  const x2 = ((E - UTM_FALSE_EASTING) / UTM_K0) ** 2;
  return UTM_K0 * (1 + x2 / (2 * R2) + (x2 * x2) / (24 * R2 * R2));
}

/**
 * Factor grid length → horizontal ground length ("Naturmaß") at mean terrain height `hNN`
 * (m ü. NN): (1/k) · (R + h_ell)/R with h_ell = hNN + geoid undulation.
 */
export function groundFactor(E: number, latDeg: number, hNN: number, geoidN = GEOID_UNDULATION_SAAR): number {
  const { rho, nu } = radiiOfCurvature(latDeg);
  const R = Math.sqrt(rho * nu);
  const hEll = Number.isFinite(hNN) ? hNN + geoidN : geoidN;
  return (1 / gridScaleFactor(E, latDeg)) * ((R + hEll) / R);
}

/**
 * Great-circle (haversine) distance on a sphere of radius 6 371 km (what Leaflet's
 * `map.distance` / `L.LatLng.distanceTo` returns) — for the "matches Leaflet within 1 %" check.
 */
export function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number, R = 6371000): number {
  const r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r;
  const dLon = (lon2 - lon1) * r;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}
