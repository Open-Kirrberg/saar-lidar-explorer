/**
 * Drawing of "Sie sind hier" (F20): pulsing dot (DOM pin via Labels3D — follows the displayed
 * terrain, i.e. the exaggeration formula), accuracy ring draped on the terrain (DrapedLines: true
 * heights per ≤ 2 m vertex, y = hRef + (h − hRef)·exag in the shader), optional heading arrow;
 * on the Leaflet minimap a blue dot + accuracy circle (+ arrow).
 *
 * PRIVACY: the position lives only in these display objects; `userData.reportHide` keeps the ring
 * out of F18 report images (DOM labels never reach the WebGL snapshot).
 */
import L from 'leaflet';
import { Group, Vector3 } from 'three';
import type { Camera, PerspectiveCamera, Vector3 as V3, WebGLRenderer } from 'three';
import { utmToWgs84, utmToWorld } from '../geo';
import type { Origin } from '../geo';
import type { Terrain } from '../terrain/Terrain';
import type { Labels3D } from '../ui/Labels3D';
import { DrapedLines } from '../vectors/DrapedLines';
import { densifyLine } from '../vectors/drape';
import { ringPoints, ringRadius, screenAngleDeg } from './locateMath';

const LABEL_GROUP = 'locate';
const LABEL_ID = 'locate:me';
const RING_COLOR: [number, number, number] = [0.3, 0.62, 1.0];

export interface LocateFix {
  E: number;
  N: number;
  accuracy: number;
}

const _a = new Vector3();
const _b = new Vector3();

export class LocateLayer extends Group {
  private ring: DrapedLines | null = null;
  private ringKey = '';
  private dotEl: HTMLElement | null = null;
  private arrowEl: HTMLElement | null = null;
  private fix: LocateFix | null = null;
  /** Inside the AOI → 3D drawing; outside → minimap only. */
  private in3d = false;
  /** Device heading relative to grid north (deg), or null. */
  private gridHeading: number | null = null;
  private trueHeading: number | null = null;

  private readonly mapGroup = L.layerGroup();
  private mapCircle: L.Circle | null = null;
  private mapDot: L.CircleMarker | null = null;
  private mapArrow: L.Marker | null = null;

  constructor(
    private readonly terrain: Terrain,
    private readonly labels: Labels3D,
    private readonly origin: Origin,
    private readonly map: L.Map | null,
  ) {
    super();
    this.name = 'LocateLayer';
    this.userData.reportHide = true;
    if (map) this.mapGroup.addTo(map);
  }

  /** Show / move the marker. `in3d` = the fix is inside the AOI (terrain exists there). */
  setFix(fix: LocateFix | null, in3d: boolean): void {
    this.fix = fix;
    this.in3d = !!fix && in3d;
    this.update3d();
    this.updateMap();
  }

  /** Device heading: true bearing (minimap) and grid bearing (3D world), or null to hide the arrow. */
  setHeading(trueDeg: number | null, gridDeg: number | null): void {
    this.trueHeading = trueDeg;
    this.gridHeading = gridDeg;
    this.dotEl?.classList.toggle('has-heading', gridDeg !== null);
    this.updateMapArrow();
  }

  private update3d(): void {
    const f = this.fix;
    if (!f || !this.in3d) {
      this.labels.remove(LABEL_ID);
      this.dotEl = this.arrowEl = null;
      this.setRing(null);
      return;
    }
    if (!this.dotEl) {
      const el = document.createElement('div');
      el.className = 'sle-locdot';
      el.innerHTML = '<span class="pulse"></span><span class="arrow"></span><span class="core"></span>';
      el.title = 'Sie sind hier';
      this.dotEl = el;
      this.arrowEl = el.querySelector<HTMLElement>('.arrow');
      el.classList.toggle('has-heading', this.gridHeading !== null);
    }
    // Labels3D.set re-creates the CSS2DObject; the same element is re-used (no flicker of state).
    this.labels.set(LABEL_ID, LABEL_GROUP, f.E, f.N, this.dotEl, { lift: 0, maxDistance: 25000 });
    const r = ringRadius(f.accuracy);
    const key = `${Math.round(f.E)}|${Math.round(f.N)}|${Math.round(r)}`;
    if (key !== this.ringKey) this.setRing({ ...f, accuracy: r }, key);
  }

  private setRing(f: LocateFix | null, key = ''): void {
    if (this.ring) {
      this.remove(this.ring);
      this.ring.dispose();
      this.ring = null;
    }
    this.ringKey = key;
    if (!f) return;
    const c = utmToWorld(f.E, f.N, this.origin);
    const xz = densifyLine(ringPoints(c.x, c.z, f.accuracy), 2);
    const dl = new DrapedLines({ lines: [{ xz: Float64Array.from(xz), style: 0 }] }, this.terrain, {
      fade: [20000, 30000],
      lift: 0.4,
      renderOrder: 8,
      perFrameBudget: 16,
      casingAlpha: 0.9,
    });
    const u = dl.material.uniforms;
    (u.uColors.value[0] as V3).set(...RING_COLOR);
    u.uWidths.value[0] = 3;
    dl.userData.reportHide = true;
    this.ring = dl;
    this.add(dl);
  }

  /** Per frame (scene.onBeforeRender): ribbon LOD/resampling + 3D heading arrow orientation. */
  update(camera: Camera, renderer: WebGLRenderer): void {
    this.ring?.update(camera, renderer);
    const f = this.fix;
    if (!f || !this.in3d || this.gridHeading === null || !this.arrowEl) return;
    const c = utmToWorld(f.E, f.N, this.origin);
    const y = this.terrain.surfaceY(c.x, c.z);
    if (!Number.isFinite(y)) return;
    const h = (this.gridHeading * Math.PI) / 180;
    // 20 m ahead along the heading (+x east, −z north).
    _a.set(c.x, y, c.z).project(camera as PerspectiveCamera);
    _b.set(c.x + 20 * Math.sin(h), y, c.z - 20 * Math.cos(h)).project(camera as PerspectiveCamera);
    const el = renderer.domElement;
    const w = el.clientWidth;
    const hh = el.clientHeight;
    const ang = screenAngleDeg(((_a.x + 1) / 2) * w, ((1 - _a.y) / 2) * hh, ((_b.x + 1) / 2) * w, ((1 - _b.y) / 2) * hh);
    this.arrowEl.style.transform = `rotate(${ang.toFixed(1)}deg)`;
  }

  private updateMap(): void {
    if (!this.map) return;
    const f = this.fix;
    if (!f) {
      this.mapGroup.clearLayers();
      this.mapCircle = this.mapDot = this.mapArrow = null;
      return;
    }
    const ll = utmToWgs84(f.E, f.N);
    const at: L.LatLngExpression = [ll.lat, ll.lon];
    const r = Math.max(1, f.accuracy);
    if (!this.mapCircle) {
      this.mapCircle = L.circle(at, {
        radius: r,
        color: '#2f7cff',
        weight: 1.5,
        fillColor: '#2f7cff',
        fillOpacity: 0.12,
        interactive: false,
      }).addTo(this.mapGroup);
      this.mapDot = L.circleMarker(at, {
        radius: 7,
        color: '#fff',
        weight: 2.5,
        fillColor: '#2f7cff',
        fillOpacity: 1,
        bubblingMouseEvents: false,
        className: 'sle-locdot-map',
      })
        .bindTooltip('Sie sind hier', { direction: 'top', offset: [0, -6] })
        .addTo(this.mapGroup);
    } else {
      this.mapCircle.setLatLng(at).setRadius(r);
      this.mapDot!.setLatLng(at);
    }
    this.updateMapArrow();
  }

  private updateMapArrow(): void {
    if (!this.map) return;
    const f = this.fix;
    if (!f || this.trueHeading === null) {
      if (this.mapArrow) this.mapGroup.removeLayer(this.mapArrow);
      this.mapArrow = null;
      return;
    }
    const ll = utmToWgs84(f.E, f.N);
    if (!this.mapArrow) {
      this.mapArrow = L.marker([ll.lat, ll.lon], {
        icon: L.divIcon({ className: 'sle-locarrow-map', html: '<span></span>', iconSize: [36, 36], iconAnchor: [18, 18] }),
        interactive: false,
        keyboard: false,
        zIndexOffset: -100,
      }).addTo(this.mapGroup);
    } else this.mapArrow.setLatLng([ll.lat, ll.lon]);
    const span = this.mapArrow.getElement()?.querySelector<HTMLElement>('span');
    if (span) span.style.transform = `rotate(${this.trueHeading.toFixed(1)}deg)`;
  }

  /** Leaflet bounds covering the fix (incl. accuracy) — for fitting the minimap. */
  mapLatLng(): L.LatLng | null {
    if (!this.fix) return null;
    const ll = utmToWgs84(this.fix.E, this.fix.N);
    return L.latLng(ll.lat, ll.lon);
  }

  dispose(): void {
    this.setFix(null, false);
    this.mapGroup.remove();
  }
}
