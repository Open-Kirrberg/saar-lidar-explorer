/**
 * 🏆 Orte im Vergleich — what the panel draws outside the drawer:
 *  - the selected Gemarkung outline(s) draped in 3D (DrapedLines like the Flurstücke lines, so the
 *    exaggeration rule holds in the shader), clipped to the AOI rectangle (no terrain elsewhere),
 *  - the same outline(s) on the minimap (Leaflet, full outline also beyond the AOI), set as the
 *    minimap focus: the dial zooms out briefly, the full-screen map fits it (Minimap.setFocus),
 *  - Riesenbaum pins per place in 3D (Labels3D: pin tip at the displayed ground + tree height, the
 *    tree itself is not exaggerated, see trees/TreeMaterial) and on the minimap. Phones get the short
 *    pin text („🌲 60,9 m“) so the label stays clear of the minimap dial,
 *  - the *Riesen* of the open place card (Phase 1): numbered dots on the minimap (✓ when discovered),
 *    the one tapped in the list as a pin in 3D (crown top) and a highlighted dot.
 * Coordinates: EPSG:25832 → local frame via utmToWorld (x = E − E0, z = −(N − N0)); never raw UTM in float32.
 */
import L from 'leaflet';
import type { Camera, Vector3, WebGLRenderer } from 'three';
import { utmToWgs84, utmToWorld } from '../geo';
import type { Origin } from '../geo';
import type { Minimap } from '../map/Minimap';
import type { Terrain } from '../terrain/Terrain';
import type { Labels3D } from '../ui/Labels3D';
import { densifyLine } from '../vectors/drape';
import type { LocalLine } from '../vectors/drape';
import { DrapedLines } from '../vectors/DrapedLines';
import { clipPolyline, fmtNum, giantPinText } from './placesData';
import type { AoiRect, Outlines, Place, Riese } from './placesData';

const OUTLINE_RGB: [number, number, number] = [0.27, 0.95, 0.78]; // teal: distinct from parcel / OSM styles
const OUTLINE_HEX = '#45f2c7';
const PIN_GROUP = 'place-giants';
const RIESE_GROUP = 'place-riesen';
/** Same breakpoint as the shell's phone layout (shell.css). */
const NARROW = '(max-width: 600px)';

export interface PlaceLayerDeps {
  terrain: Terrain;
  origin: Origin;
  /** AOI rectangle in metres (`aoiRect(manifest)`: size in cells × cellSize). */
  aoi: AoiRect;
  labels: Labels3D;
  scene: { add(o: DrapedLines): unknown; remove(o: DrapedLines): unknown };
  minimap: () => Minimap | null;
  onPinClick(p: Place): void;
}

export class PlaceLayer {
  private outline: DrapedLines | null = null;
  private mapOutline: L.LayerGroup | null = null;
  private mapPins: L.LayerGroup | null = null;
  private mapOf: L.Map | null = null;
  private pinsFor: Place[] = [];
  private mapRiesen: L.LayerGroup | null = null;
  private readonly narrow = typeof window.matchMedia === 'function' ? window.matchMedia(NARROW) : null;
  private readonly onNarrow = () => {
    if (this.pinsFor.length) this.setGiants([...this.pinsFor]);
  };

  constructor(private readonly d: PlaceLayerDeps) {
    this.narrow?.addEventListener?.('change', this.onNarrow);
  }

  /** Outline the given place ids (empty → none). */
  setOutline(ids: readonly string[], outlines: Outlines): void {
    this.clearOutline();
    const rings = ids.flatMap((id) => outlines.get(id) ?? []);
    if (!rings.length) return;
    const { origin, aoi, terrain } = this.d;
    const w = aoi.E1 - aoi.E0;
    const hM = aoi.N1 - aoi.N0;
    const lines: LocalLine[] = [];
    for (const r of rings) {
      const xz: number[] = [];
      for (const [E, N] of r) {
        const w = utmToWorld(E, N, origin);
        xz.push(w.x, w.z);
      }
      if (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1]) xz.push(xz[0], xz[1]); // close the ring
      for (const part of clipPolyline(xz, 0, w, -hM, 0)) {
        lines.push({ xz: Float64Array.from(densifyLine(part, 4)), style: 0 });
      }
    }
    if (lines.length) {
      const dl = new DrapedLines({ lines }, terrain, {
        fade: [11000, 16000],
        lift: 0.5,
        renderOrder: 7,
        perFrameBudget: 12,
        casingPx: 1.2,
        casingAlpha: 0.9,
        depthBias: 0.002,
      });
      const u = dl.material.uniforms;
      (u.uColors.value[0] as Vector3).set(...OUTLINE_RGB);
      u.uWidths.value[0] = 3.2;
      dl.userData.reportHide = true;
      this.outline = dl;
      this.d.scene.add(dl);
    }
    const mm = this.map();
    const lls = rings.map((r) =>
      r.map(([E, N]) => {
        const ll = utmToWgs84(E, N);
        return [ll.lat, ll.lon] as L.LatLngTuple;
      }),
    );
    this.bounds = L.latLngBounds(lls.flat());
    if (mm) {
      this.mapOutline = L.layerGroup().addTo(mm);
      for (const r of lls) L.polygon(r, { color: OUTLINE_HEX, weight: 2.5, fill: true, fillOpacity: 0.08, interactive: false }).addTo(this.mapOutline);
    }
    // At the default dial zoom (≈ 1 km across) a Gemarkung would not show: zoom out briefly / fit the full map.
    this.d.minimap()?.setFocus(this.bounds);
  }

  /** WGS84 bounds of the current outline (null → none). */
  bounds: L.LatLngBounds | null = null;

  /** Open the full-screen map on the current outline (temporary, like the „Wo bin ich?“ view). */
  showOnMap(): boolean {
    const mm = this.d.minimap();
    if (!mm || !this.bounds) return false;
    mm.showBounds([this.bounds.getSouthWest(), this.bounds.getNorthEast()]);
    return true;
  }

  private clearOutline(): void {
    if (this.outline) {
      this.d.scene.remove(this.outline);
      this.outline.dispose();
      this.outline = null;
    }
    this.mapOutline?.remove();
    this.mapOutline = null;
    if (this.bounds) this.d.minimap()?.setFocus(null);
    this.bounds = null;
  }

  /** Riesenbaum pins for these places (empty → hidden). */
  setGiants(places: readonly Place[]): void {
    this.clearGiants();
    this.pinsFor = places.filter((p) => p.tallest);
    const narrow = !!this.narrow?.matches;
    for (const p of this.pinsFor) {
      const t = p.tallest!;
      const text = `Riesenbaum ${p.name_de}: ${fmtNum(t.h, 1)} m`;
      const el = document.createElement('div');
      el.className = 'sle-pin sle-giant-pin';
      el.innerHTML = `<span class="sle-pin-txt"></span><span class="sle-pin-stem"></span>`;
      el.querySelector('.sle-pin-txt')!.textContent = giantPinText(p, t.h, narrow);
      el.setAttribute('aria-label', text);
      el.title = `${text} (LiDAR-Höhe, nicht vor Ort gemessen)${t.in_trees ? ' – der Baum steht im 3D-Wald' : ''}. Klicken zum Hinfliegen`;
      el.addEventListener('click', () => this.d.onPinClick(p));
      // Pin tip at the crown top: displayed ground + true tree height (trees are not exaggerated).
      this.d.labels.set(`giant:${p.id}`, PIN_GROUP, t.E, t.N, el, { lift: t.h, maxDistance: 9000 });
    }
    const mm = this.map();
    if (mm && this.pinsFor.length) {
      this.mapPins = L.layerGroup().addTo(mm);
      for (const p of this.pinsFor) {
        const t = p.tallest!;
        const ll = utmToWgs84(t.E, t.N);
        const label = `Riesenbaum ${p.name_de}: ${fmtNum(t.h, 1)} m`;
        L.marker([ll.lat, ll.lon], {
          icon: L.divIcon({ className: 'sle-giant-icon', html: '<span class="sle-giant-dot">🌲</span>', iconSize: [22, 22], iconAnchor: [11, 11] }),
          keyboard: false,
          bubblingMouseEvents: false,
          zIndexOffset: 400,
          title: label,
        })
          .bindTooltip(label.replace(/[&<>"']/g, ''), { direction: 'top', offset: [0, -10] })
          .on('click', () => this.d.onPinClick(p))
          .addTo(this.mapPins);
      }
    }
  }

  private clearGiants(): void {
    this.d.labels.clearGroup(PIN_GROUP);
    this.mapPins?.remove();
    this.mapPins = null;
    this.pinsFor = [];
  }

  /**
   * Riesen of one place (the open card): numbered minimap dots (✓ = discovered) and, for `active`,
   * a 3D pin at the crown top (true tree height, not exaggerated) plus a highlighted dot. null → none.
   */
  setRiesen(place: Place | null, active: Riese | null, discovered: (r: Riese) => boolean, onClick?: (r: Riese) => void): void {
    this.clearRiesen();
    if (!place || !place.riesen.length) return;
    if (active) {
      const el = document.createElement('div');
      el.className = 'sle-pin sle-giant-pin sle-riese-pin';
      el.innerHTML = `<span class="sle-pin-txt"></span><span class="sle-pin-stem"></span>`;
      el.querySelector('.sle-pin-txt')!.textContent = `🌲 Nr. ${active.rank} · ${fmtNum(active.h, 1)} m`;
      el.setAttribute('aria-label', `Riese Nr. ${active.rank} von ${place.name_de}: ${fmtNum(active.h, 1)} m`);
      el.title = `Riese Nr. ${active.rank} von ${place.name_de}: ${fmtNum(active.h, 1)} m (LiDAR-Höhe, nicht vor Ort gemessen)`;
      this.d.labels.set(`riese:${active.id ?? active.rank}`, RIESE_GROUP, active.E, active.N, el, { lift: active.h, maxDistance: 6000 });
    }
    const mm = this.map();
    if (!mm) return;
    this.mapRiesen = L.layerGroup().addTo(mm);
    for (const r of place.riesen) {
      const ll = utmToWgs84(r.E, r.N);
      const on = !!active && active === r;
      const found = discovered(r);
      const label = `Riese Nr. ${r.rank} von ${place.name_de}: ${fmtNum(r.h, 1)} m${found ? ' (entdeckt)' : ''}`;
      L.marker([ll.lat, ll.lon], {
        icon: L.divIcon({
          className: 'sle-giant-icon',
          html: `<span class="sle-riese-dot${on ? ' on' : ''}${found ? ' found' : ''}">${found ? '✓' : r.rank}</span>`,
          iconSize: on ? [24, 24] : [18, 18],
          iconAnchor: on ? [12, 12] : [9, 9],
        }),
        keyboard: false,
        bubblingMouseEvents: false,
        zIndexOffset: on ? 500 : 300,
        title: label,
      })
        .bindTooltip(label.replace(/[&<>"']/g, ''), { direction: 'top', offset: [0, -8] })
        .on('click', () => onClick?.(r))
        .addTo(this.mapRiesen);
    }
  }

  private clearRiesen(): void {
    this.d.labels.clearGroup(RIESE_GROUP);
    this.mapRiesen?.remove();
    this.mapRiesen = null;
  }

  /** Per frame: ribbon bucket build / re-sampling while terrain streams. */
  update(camera: Camera, renderer: WebGLRenderer): void {
    this.outline?.update(camera, renderer);
  }

  /** The minimap may (re)mount after us: re-add the 2D layers to the current map. */
  syncMap(): void {
    const mm = this.d.minimap()?.map ?? null;
    if (mm === this.mapOf) return;
    this.mapOf = mm;
    if (mm) {
      this.mapOutline?.addTo(mm);
      this.mapPins?.addTo(mm);
      this.mapRiesen?.addTo(mm);
      if (this.bounds) this.d.minimap()?.setFocus(this.bounds, { fit: false }); // remount (tier switch): no new peek
    }
  }

  private map(): L.Map | null {
    this.mapOf = this.d.minimap()?.map ?? null;
    return this.mapOf;
  }

  dispose(): void {
    this.narrow?.removeEventListener?.('change', this.onNarrow);
    this.clearOutline();
    this.clearGiants();
    this.clearRiesen();
  }
}
