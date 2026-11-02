/**
 * "Tour" through known sites (final polish) — pure part: the stop list and its resolution
 * against `pois.geojson` and the AOI. Texts are short, German and framed as hypotheses.
 */
import type { Poi } from '../pois/pois';

export interface TourStopDef {
  /** `pois.geojson` id. */
  poiId: string;
  title: string;
  text: string;
  /** Relief preset id (terrain/relief.ts PRESETS); skipped when the AOI lacks its layers. */
  preset: string;
  /** Oblique view: horizontal distance and height above ground (true metres). */
  dist: number;
  agl: number;
}

export const TOUR_STOPS: readonly TourStopDef[] = [
  {
    poiId: 'r03-01',
    title: 'Schloss Karlsberg',
    text:
      'Die 1793 zerstörte Residenz Herzog Karls II. August. Stufen und gerade Kanten im Relief deuten ' +
      'auf Terrassen und Mauerzüge – Hypothesen, die Grundrisse sind nur teilweise belegt.',
    preset: 'mauern',
    dist: 260,
    agl: 140,
  },
  {
    poiId: 'r03-02',
    title: 'Orangerie',
    text:
      'Ruine der Orangerie unterhalb des Schlosses. Achten Sie auf rechteckige Erhebungen (rötlich) ' +
      'und Senken (bläulich) – mögliche Fundamente, aber auch Wege oder Schutt.',
    preset: 'relikte',
    dist: 180,
    agl: 100,
  },
  {
    poiId: 'r03-04',
    title: 'Karlsbergweiher',
    text:
      'Weiher mit Insel westlich des Schlosses. Dämme, alte Uferlinien und Zuläufe könnten zur ' +
      'barocken Gartenanlage gehören – oder jünger sein.',
    preset: 'schummer-lrm',
    dist: 220,
    agl: 110,
  },
  {
    poiId: 'r03-10',
    title: 'Schwanenweiher (Karlslust)',
    text:
      'Drei Weiher des Landschaftsgartens Karlslust mit Dämmen und Kaskade. Dunkle Linien im ' +
      'Himmelssicht-Bild können Gräben oder alte Wasserläufe sein.',
    preset: 'graeben',
    dist: 240,
    agl: 120,
  },
  {
    poiId: 'r03-17',
    title: 'Burgruine Merburg',
    text:
      'Mittelalterliche Burgstelle bei Kirrberg. Ein umlaufender Graben und der Burghügel sind ' +
      'im Relief vermutlich erkennbar – Lage und Ausdehnung bleiben Hypothese.',
    preset: 'graeben',
    dist: 200,
    agl: 110,
  },
  {
    poiId: 'r03-22',
    title: 'Grabhügel „Rabenhorst“',
    text:
      'Überlieferte Gruppe keltischer Grabhügel. Runde, flache Erhebungen erscheinen rötlich – ' +
      'nicht jede Kuppe ist ein Hügelgrab (Wurzelteller, Meilerplätze, Abraum).',
    preset: 'relikte',
    dist: 220,
    agl: 110,
  },
  {
    poiId: 'r03-26',
    title: 'Hohenburg / Schlossberg',
    text:
      'Burgruine und Reste der Vauban-Festung über Homburg. Bastionen und Gräben zeichnen sich ' +
      'als Kanten ab; spätere Umbauten und Wege überlagern sie.',
    preset: 'mauern',
    dist: 320,
    agl: 170,
  },
];

export interface TourStop extends TourStopDef {
  E: number;
  N: number;
  poiName: string;
}

/**
 * Stops whose POI exists and lies inside the AOI (`inAoi`), in tour order. `toUtm` converts the
 * POI's WGS84 position (injected so this stays free of proj4 in tests).
 */
export function resolveTour(
  pois: readonly Poi[],
  toUtm: (lat: number, lon: number) => { E: number; N: number },
  inAoi: (E: number, N: number) => boolean,
  defs: readonly TourStopDef[] = TOUR_STOPS,
): TourStop[] {
  const byId = new Map(pois.map((p) => [p.id, p]));
  const out: TourStop[] = [];
  for (const d of defs) {
    const p = byId.get(d.poiId);
    if (!p) continue;
    const { E, N } = toUtm(p.lat, p.lon);
    if (!Number.isFinite(E) || !Number.isFinite(N) || !inAoi(E, N)) continue;
    out.push({ ...d, E, N, poiName: p.name });
  }
  return out;
}

/** Next index for a step of ±1, or -1 when the tour runs past either end. */
export function tourStep(index: number, delta: number, count: number): number {
  const next = index + delta;
  return next < 0 || next >= count ? -1 : next;
}

/** Fly duration (s): near-instant when the user prefers reduced motion. */
export function tourFlyDuration(reducedMotion: boolean): number | undefined {
  return reducedMotion ? 0.05 : undefined;
}
