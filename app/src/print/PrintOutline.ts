/**
 * F21: outline of the selected print tile on the terrain — a draped screen-space ribbon reusing the
 * vectors' `DrapedLines` (true heights sampled from the DTM, exaggeration applied in the vertex
 * shader: y = hRef + (h − hRef)·exag), cut to the loaded AOI.
 */
import { Group } from 'three';
import type { Camera, Vector3, WebGLRenderer } from 'three';
import type { Origin } from '../geo';
import type { Terrain } from '../terrain/Terrain';
import { DrapedLines } from '../vectors/DrapedLines';
import type { LocalLine } from '../vectors/drape';
import { outlineRuns } from './printData';
import type { Bbox } from './printData';

const STYLE = 0;
const COLOR: [number, number, number] = [1, 0.62, 0.1];

export class PrintOutline extends Group {
  private lines: DrapedLines | null = null;

  constructor(
    private readonly terrain: Terrain,
    private readonly origin: Origin,
    private readonly aoi: Bbox,
  ) {
    super();
    this.name = 'PrintOutline';
    this.matrixAutoUpdate = false;
  }

  /** Show the outline of `bbox` (UTM), or nothing. Returns the number of drawn segments. */
  setTile(bbox: Readonly<Bbox> | null): number {
    if (this.lines) {
      this.remove(this.lines);
      this.lines.dispose();
      this.lines = null;
    }
    if (!bbox) return 0;
    const runs = outlineRuns(bbox, this.origin, this.aoi, 2);
    const ls: LocalLine[] = runs.map((xz) => ({ xz: Float64Array.from(xz), style: STYLE }));
    if (!ls.length) return 0;
    const span = Math.max(bbox[2] - bbox[0], bbox[3] - bbox[1]);
    // Visible from far away (the whole tile in view), built for every bucket of the tile.
    const far = Math.max(6000, span * 4);
    this.lines = new DrapedLines({ lines: ls }, this.terrain, {
      fade: [far * 0.75, far],
      lift: 0.4,
      casingPx: 1.4,
      casingAlpha: 0.9,
      renderOrder: 8,
      depthBias: 0.002,
      buildRadius: far + span,
    });
    const u = this.lines.material.uniforms;
    (u.uColors.value as Vector3[])[STYLE].set(...COLOR);
    (u.uWidths.value as number[])[STYLE] = 3.2;
    this.add(this.lines);
    return this.lines.segmentCount;
  }

  update(camera: Camera, renderer: WebGLRenderer): void {
    if (this.visible) this.lines?.update(camera, renderer);
  }

  dispose(): void {
    this.setTile(null);
  }
}
