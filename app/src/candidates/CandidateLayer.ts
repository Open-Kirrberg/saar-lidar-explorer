/**
 * F15 candidates in 3D: every visible candidate's outline (or a circle of its diameter) as a
 * draped screen-space ribbon, coloured by class, reusing the vectors' `DrapedLines` (true height
 * per vertex → exaggeration applied in the vertex shader, y = hRef + (h − hRef)·exag; baked z
 * where the file has it, else sampled from the terrain and re-sampled as chunks load).
 * The selected candidate is drawn again on top, wider and with a stronger casing.
 */
import { Group, Vector3 } from 'three';
import type { Camera, WebGLRenderer } from 'three';
import { CANDIDATE_CLASSES } from '../data/manifest';
import type { Origin } from '../geo';
import type { Terrain } from '../terrain/Terrain';
import { DrapedLines } from '../vectors/DrapedLines';
import type { LocalLine } from '../vectors/drape';
import { isKnownPath, outlinePositions } from './candidateData';
import type { Candidate } from './candidateData';
import { CLASS_COLORS, KNOWN_PATH_COLOR, SELECTED_COLOR, candidateColor, hexRgb } from './colors';

/** Style slots in our own DrapedLines material (independent of the OSM style table). */
const KNOWN_STYLE = CANDIDATE_CLASSES.length; // after the class styles
const SELECTED_STYLE = KNOWN_STYLE + 1;
const styleOf = (c: Candidate) => (isKnownPath(c) ? KNOWN_STYLE : CANDIDATE_CLASSES.indexOf(c.cls));

function toLine(c: Candidate, origin: Origin, style: number): LocalLine | null {
  const pts = outlinePositions(c);
  if (pts.length < 2) return null;
  const xz = new Float64Array(pts.length * 2);
  const h = new Float64Array(pts.length);
  let anyZ = false;
  pts.forEach((p, k) => {
    xz[2 * k] = p[0] - origin.E0;
    xz[2 * k + 1] = -(p[1] - origin.N0);
    h[k] = p[2];
    if (Number.isFinite(p[2])) anyZ = true;
  });
  return anyZ ? { xz, style, h } : { xz, style };
}

function applyStyles(lines: DrapedLines, widths: { normal: number; selected: number }): void {
  const u = lines.material.uniforms;
  const colors = u.uColors.value as Vector3[];
  const w = u.uWidths.value as number[];
  CANDIDATE_CLASSES.forEach((cls, k) => {
    colors[k].set(...hexRgb(CLASS_COLORS[cls]));
    w[k] = widths.normal;
  });
  colors[KNOWN_STYLE].set(...hexRgb(KNOWN_PATH_COLOR));
  w[KNOWN_STYLE] = widths.normal * 0.8;
  colors[SELECTED_STYLE].set(...hexRgb(SELECTED_COLOR));
  w[SELECTED_STYLE] = widths.selected;
}

const FADE: [number, number] = [1200, 2600];

export class CandidateLayer extends Group {
  private lines: DrapedLines | null = null;
  private selected: DrapedLines | null = null;

  constructor(
    private readonly terrain: Terrain,
    private readonly origin: Origin,
  ) {
    super();
    this.name = 'Candidates';
    this.matrixAutoUpdate = false;
  }

  /** Replace the drawn set (call when the filter or the decisions change). */
  setCandidates(list: readonly Candidate[]): void {
    if (this.lines) {
      this.remove(this.lines);
      this.lines.dispose();
      this.lines = null;
    }
    const ls = list.map((c) => toLine(c, this.origin, styleOf(c))).filter((l): l is LocalLine => l !== null);
    if (!ls.length) return;
    this.lines = new DrapedLines({ lines: ls }, this.terrain, { fade: FADE, lift: 0.25, casingPx: 0.9, renderOrder: 6 });
    applyStyles(this.lines, { normal: 2.4, selected: 4 });
    this.add(this.lines);
  }

  setSelected(c: Candidate | null): void {
    if (this.selected) {
      this.remove(this.selected);
      this.selected.dispose();
      this.selected = null;
    }
    if (!c) return;
    const l = toLine(c, this.origin, SELECTED_STYLE);
    if (!l) return;
    this.selected = new DrapedLines({ lines: [l] }, this.terrain, { fade: [3000, 5000], lift: 0.3, casingPx: 1.6, casingAlpha: 0.95, renderOrder: 7, depthBias: 0.002 });
    applyStyles(this.selected, { normal: 2.4, selected: 5 });
    // Selection = the same class colour, wider and with a stronger casing (drawn on top).
    (this.selected.material.uniforms.uColors.value as Vector3[])[SELECTED_STYLE].set(...hexRgb(candidateColor(c)));
    this.add(this.selected);
  }

  get segmentCount(): number {
    return this.lines?.segmentCount ?? 0;
  }

  update(camera: Camera, renderer: WebGLRenderer): void {
    if (!this.visible) return;
    this.lines?.update(camera, renderer);
    this.selected?.update(camera, renderer);
  }

  dispose(): void {
    this.setCandidates([]);
    this.setSelected(null);
  }
}
