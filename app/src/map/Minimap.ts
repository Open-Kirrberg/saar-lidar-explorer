import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Ray, Vector3 } from 'three';
import { gridConvergenceDeg, utmToWgs84, worldToWgs84, wgs84ToUtm } from '../geo';
import type { AppContext } from '../main';
import type { Marker } from '../markers/markerStore';
import type { Poi } from '../pois/pois';
import { POI_TYPE_LABELS } from '../pois/pois';
import { FOCUS_AREAS, bboxRing } from './aois';
import { borderNdc, footprintFromRays } from './footprint';
import { DOP_WMS, mergeOverlayPrefs, syncOverlayPrefs, xyzOverlay } from './overlays';
import { resolveDataPath } from '../data/urls';
import type { RayHit, V3 } from './footprint';

const PREFS_KEY = 'sle.map.v1';
const CP_WMS = 'https://geoportal.saarland.de/gdi-sl/inspirewms_Flurstuecke_Grundstuecke_ALKIS?';
const FOOTPRINT_MAX_DIST = 2500;
const FOOTPRINT_INTERVAL_MS = 150;

type Size = 's' | 'l' | 'full';

interface Prefs {
  size: Size;
  collapsed: boolean;
  follow: boolean;
  zoom: number;
  base: string;
  overlays: string[];
  reliefOpacity: number;
  /** Overlays the user has seen in the layer control (new ones get switched on once). */
  knownOverlays?: string[];
}

const FOCUS_OVERLAY = 'Schwerpunktgebiete';

const DEFAULT_PREFS: Prefs = {
  size: 's',
  collapsed: false,
  follow: true,
  zoom: 15,
  base: 'OpenStreetMap',
  overlays: ['Relief: VAT (Kombination)', 'Untersuchungsgebiet', FOCUS_OVERLAY, 'Bekannte Orte', 'Fundmarker'],
  reliefOpacity: 0.55,
};

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) };
  } catch {
    /* private mode etc. */
  }
  return { ...DEFAULT_PREFS };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export interface MinimapCallbacks {
  onPoiClick?: (poi: Poi) => void;
  onMarkerClick?: (m: Marker) => void;
}

/**
 * Leaflet minimap in #minimap (F4): OSM/OpenTopoMap base, own relief XYZ overlays, AOI outline,
 * INSPIRE CP WMS (Flurstücke), POIs, user markers, camera marker + view footprint; click → flyTo.
 */
export class Minimap {
  readonly map: L.Map;
  private readonly prefs: Prefs;
  private readonly root: HTMLElement;
  private readonly camMarker: L.Marker;
  private readonly footprint: L.Polygon;
  private readonly poiLayer = L.layerGroup();
  private readonly markerLayer = L.layerGroup();
  private readonly reliefLayers: L.TileLayer[] = [];
  private followInput!: HTMLInputElement;
  private camPending = false;
  private lastFootprint = 0;
  private footprintTimer: ReturnType<typeof setTimeout> | null = null;
  private convergence = 0;
  /** Saved values of prefs that currently hold a transient (not persisted) in-memory value. */
  private readonly unsaved: Partial<Prefs> = {};
  /** Bounds to show once the map has a size (it may be hidden in the mobile sheet). */
  private pendingBounds: L.LatLngBounds | null = null;
  /** Zoom before showBounds(); restored by endTemporaryView(). */
  private zoomBefore: number | null = null;
  private fitting = false;

  constructor(
    container: HTMLElement,
    private readonly ctx: AppContext,
    private readonly cb: MinimapCallbacks = {},
  ) {
    this.root = container;
    this.prefs = loadPrefs();
    const { manifest } = ctx;
    container.classList.add('sle-minimap');
    container.innerHTML = `
      <div class="mm-bar">
        <button class="mm-collapse" title="Karte ein-/ausklappen" aria-expanded="true">▾</button>
        <span class="mm-title">Karte</span>
        <label class="mm-follow" title="Karte folgt der Kamera"><input type="checkbox"> folgen</label>
        <span class="mm-sizes" role="group" aria-label="Kartengröße">
          <button data-size="s">klein</button><button data-size="l">groß</button><button data-size="full">Vollbild</button>
        </span>
      </div>
      <div class="mm-map"></div>`;
    const mapEl = container.querySelector<HTMLElement>('.mm-map')!;

    const E0 = manifest.origin.E0 + manifest.size.width / 2;
    const N0 = manifest.origin.N0 + manifest.size.height / 2;
    const c0 = utmToWgs84(E0, N0);
    this.convergence = gridConvergenceDeg(E0, N0);

    this.map = L.map(mapEl, {
      center: [c0.lat, c0.lon],
      zoom: this.prefs.zoom,
      minZoom: 10,
      maxZoom: 20,
      zoomControl: true,
      keyboard: false, // arrow keys belong to the drone
      doubleClickZoom: false, // a click flies; avoid double flights
      attributionControl: true,
    });
    this.map.attributionControl.setPrefix('<a href="https://leafletjs.com" title="Leaflet">Leaflet</a>');

    // ---- base layers (OSM tile usage policy: attribution, no prefetch/bulk) ----
    const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 20,
      maxNativeZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende',
    });
    const topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      maxZoom: 20,
      maxNativeZoom: 17,
      subdomains: 'abc',
      attribution:
        'Kartendaten: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende, SRTM | Darstellung: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
    });
    const blank = L.layerGroup();
    const bases: Record<string, L.Layer> = { OpenStreetMap: osm, OpenTopoMap: topo, 'Kein Hintergrund': blank };

    // ---- overlays ----
    const overlays: Record<string, L.Layer> = {};
    const baseUrl = ctx.terrain.baseUrl; // the AOI actually loaded (fixture fallback included)
    const shortAttr = esc(manifest.attribution.split(';')[0] ?? manifest.attribution);
    for (const [key, x] of Object.entries(manifest.xyz ?? {})) {
      const ov = xyzOverlay(key, x, manifest.layers, manifest.imageLayers);
      const b = (x as { bounds?: [[number, number], [number, number]] }).bounds ?? manifest.wgs84Bounds;
      const layer = L.tileLayer(resolveDataPath(baseUrl, x.url), {
        minZoom: 10,
        maxZoom: 20,
        minNativeZoom: x.minZoom,
        maxNativeZoom: x.maxZoom,
        bounds: b ? L.latLngBounds(b) : undefined,
        // Historic maps (F14) are pictures: own opacity, not the relief slider.
        opacity: ov.image ? 0.85 : this.prefs.reliefOpacity,
        attribution: ov.image && ov.attribution ? esc(ov.attribution) : shortAttr,
        className: ov.image ? 'mm-image' : 'mm-relief',
      });
      if (!ov.image) this.reliefLayers.push(layer);
      overlays[ov.name] = layer;
    }
    // F13: live TrueDOP20 WMS for the 2D map (the 3D drape uses the pipeline's `ortho` chunks).
    overlays[DOP_WMS.label] = L.tileLayer.wms(DOP_WMS.url, {
      layers: DOP_WMS.layer,
      styles: '',
      format: 'image/jpeg',
      transparent: false,
      version: '1.3.0',
      minZoom: DOP_WMS.minZoom,
      maxZoom: 20,
      bounds: L.latLngBounds(DOP_WMS.bounds),
      attribution: DOP_WMS.attribution,
      className: 'mm-image',
    } as L.WMSOptions);
    const cadastreAttr = `Flurstücke: &copy; GeoBasis-DE/LVGL-SL (2026), <a href="https://www.govdata.de/dl-de/by-2-0">dl-de/by-2-0</a>`;
    overlays['Flurstücke (ab Zoom 16)'] = L.tileLayer.wms(CP_WMS, {
      layers: 'CP.CadastralParcel',
      styles: 'CP.CadastralParcel.LabelOnReferencePoint',
      format: 'image/png',
      transparent: true,
      version: '1.3.0',
      minZoom: 16,
      maxZoom: 20,
      attribution: cadastreAttr,
    } as L.WMSOptions);
    overlays['Gemarkung/Flur (ab Zoom 15)'] = L.tileLayer.wms(CP_WMS, {
      layers: 'CP.CadastralZoning',
      styles: '',
      format: 'image/png',
      transparent: true,
      version: '1.3.0',
      minZoom: 15,
      maxZoom: 20,
      attribution: cadastreAttr,
    } as L.WMSOptions);
    overlays['Untersuchungsgebiet'] = this.aoiOutline();
    overlays[FOCUS_OVERLAY] = this.focusOutlines();
    overlays['Bekannte Orte'] = this.poiLayer;
    overlays['Fundmarker'] = this.markerLayer;

    // Overlays added in a later version are on by default once, even with saved prefs.
    // Prefs saved before knownOverlays existed knew everything except the focus areas.
    // Prefs are global: knownOverlays is a union over all AOIs visited (mergeOverlayPrefs).
    this.savePrefs(mergeOverlayPrefs(this.prefs, Object.keys(overlays), DEFAULT_PREFS.overlays, [FOCUS_OVERLAY]));

    (bases[this.prefs.base] ?? osm).addTo(this.map);
    for (const [name, layer] of Object.entries(overlays)) if (this.prefs.overlays.includes(name)) layer.addTo(this.map);
    L.control.layers(bases, overlays, { collapsed: true, position: 'topright' }).addTo(this.map);
    this.map.on('baselayerchange', (e: L.LayersControlEvent) => this.savePrefs({ base: e.name }));
    const syncOverlays = () =>
      this.savePrefs({
        // Keep saved on-states of overlays this AOI doesn't define (e.g. hist_*/relief in the fixture).
        overlays: syncOverlayPrefs(
          this.prefs.overlays,
          Object.keys(overlays),
          Object.entries(overlays).filter(([, l]) => this.map.hasLayer(l)).map(([n]) => n),
        ),
      });
    this.map.on('overlayadd overlayremove', syncOverlays);

    if (this.reliefLayers.length) this.addOpacityControl();

    // ---- camera marker + footprint ----
    this.footprint = L.polygon([], {
      color: '#ffb000',
      weight: 1.5,
      fillColor: '#ffd27a',
      fillOpacity: 0.18,
      interactive: false,
    }).addTo(this.map);
    this.camMarker = L.marker([c0.lat, c0.lon], {
      icon: L.divIcon({
        className: 'mm-cam-icon',
        html: `<div class="mm-cam"><svg viewBox="-12 -12 24 24" width="26" height="26" aria-hidden="true">
          <path d="M0,-10 L7,8 L0,4 L-7,8 Z" fill="#ff5a1f" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg></div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      }),
      interactive: false,
      keyboard: false,
      zIndexOffset: 1000,
    }).addTo(this.map);

    // ---- interactions ----
    this.map.on('click', (e: L.LeafletMouseEvent) => this.flyToLatLng(e.latlng));
    this.map.on('dragstart', () => this.setFollow(false));
    this.map.on('zoomend', () => {
      if (this.fitting) this.setTransient('zoom', this.map.getZoom());
      else this.savePrefs({ zoom: this.map.getZoom() });
      if (this.prefs.follow) this.recenter();
    });

    this.bindBar();
    new ResizeObserver(() => {
      if (this.prefs.collapsed) return;
      this.map.invalidateSize({ animate: false });
      if (!this.applyPendingBounds() && this.prefs.follow) this.recenter();
      this.scheduleCamera(true);
    }).observe(mapEl);
    this.applySize();
    ctx.store.subscribe(() => this.scheduleCamera(), ['E', 'N', 'h', 'heading', 'pitch']);
    window.addEventListener('sle:ready', () => this.scheduleCamera(true));
    this.scheduleCamera(true);
  }

  // ---- public ---------------------------------------------------------------------------------

  /**
   * F20 mobile "Karte" sheet: the map must be expanded while the sheet shows it. `persist` = false
   * keeps the change in memory only, so later pref saves (zoom, base layer…) don't overwrite the
   * saved desktop preference. Re-measures the map (it may have been hidden).
   */
  get collapsed(): boolean {
    return this.prefs.collapsed;
  }

  setCollapsed(collapsed: boolean, persist = false): void {
    if (persist) this.savePrefs({ collapsed });
    else this.setTransient('collapsed', collapsed);
    this.applySize();
    if (!collapsed) {
      this.map.invalidateSize({ animate: false });
      if (!this.applyPendingBounds() && this.prefs.follow) this.recenter();
    }
  }

  /**
   * Temporarily stop following and show `points` (e.g. the AOI and the user's position). Nothing
   * is persisted; `endTemporaryView()` restores follow + zoom. While the map is hidden or 0-sized
   * (mobile sheet closed) the fit waits until the map is shown.
   */
  showBounds(points: L.LatLngExpression[]): void {
    if (this.zoomBefore === null) this.zoomBefore = this.map.getZoom();
    this.setFollow(false, false);
    this.pendingBounds = L.latLngBounds(points);
    if (!this.prefs.collapsed) this.map.invalidateSize({ animate: false });
    this.applyPendingBounds();
  }

  /** Undo `showBounds()`: restore the saved follow state and the previous zoom. */
  endTemporaryView(): void {
    this.pendingBounds = null;
    const zoom = this.zoomBefore;
    this.zoomBefore = null;
    if ('follow' in this.unsaved) this.setFollow(this.unsaved.follow!, false);
    if (zoom !== null && zoom !== this.map.getZoom()) {
      this.fitting = true;
      try {
        this.map.setZoom(zoom, { animate: false });
      } finally {
        this.fitting = false;
      }
    }
    if (this.prefs.follow) this.recenter();
  }

  setPois(pois: Poi[]): void {
    this.poiLayer.clearLayers();
    for (const p of pois) {
      L.circleMarker([p.lat, p.lon], {
        radius: 5,
        color: '#fff',
        weight: 1.5,
        fillColor: '#2f6fd6',
        fillOpacity: 0.95,
        bubblingMouseEvents: false,
      })
        .bindTooltip(`${esc(p.name)}<br><small>${esc(POI_TYPE_LABELS[p.type])}</small>`, { direction: 'top', offset: [0, -4] })
        .on('click', () => this.cb.onPoiClick?.(p))
        .addTo(this.poiLayer);
    }
  }

  setMarkers(markers: Marker[]): void {
    this.markerLayer.clearLayers();
    for (const m of markers) {
      const ll = utmToWgs84(m.E, m.N);
      L.circleMarker([ll.lat, ll.lon], {
        radius: 6,
        color: '#3a1d00',
        weight: 1.5,
        fillColor: '#ff8c1a',
        fillOpacity: 1,
        bubblingMouseEvents: false,
      })
        .bindTooltip(`${esc(m.title)}<br><small>${esc(m.category)}</small>`, { direction: 'top', offset: [0, -5] })
        .on('click', () => this.cb.onMarkerClick?.(m))
        .addTo(this.markerLayer);
    }
  }

  /** `persist` = false changes follow in memory only (the saved preference stays). */
  setFollow(on: boolean, persist = true): void {
    if (persist) this.savePrefs({ follow: on });
    else this.setTransient('follow', on);
    if (this.followInput) this.followInput.checked = on;
    if (on) this.recenter();
  }

  // ---- internals ------------------------------------------------------------------------------

  private flyToLatLng(ll: L.LatLng): void {
    const { E, N } = wgs84ToUtm(ll.lat, ll.lng);
    const { controller, store } = this.ctx;
    const pitch = Math.min(Math.max(store.get().pitch, -89), -20);
    // Keep the current height above ground (display metres), centre the clicked point in view.
    void this.ctx.flyTo(E, N, { agl: Math.max(controller.agl, 10), pitch, lookAt: true });
    this.setFollow(true);
  }

  /** Outline of the loaded AOI (solid red, tooltip with its name and size). */
  private aoiOutline(): L.Polygon {
    const { origin, size, name } = this.ctx.manifest;
    const ring = this.toLatLngs(bboxRing([origin.E0, origin.N0, origin.E0 + size.width, origin.N0 + size.height]));
    const km = (m: number) => (m / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 });
    return L.polygon(ring, { color: '#e03c31', weight: 2, fill: false, interactive: true, bubblingMouseEvents: true }).bindTooltip(
      `Geladenes Gebiet: ${esc(name)}<br><small>${km(size.width)} × ${km(size.height)} km</small>`,
      { sticky: true },
    );
  }

  /** Dashed outlines of the focus areas (pipeline/aois.toml), German tooltips. */
  private focusOutlines(): L.LayerGroup {
    const g = L.layerGroup();
    for (const a of FOCUS_AREAS) {
      L.polygon(this.toLatLngs(bboxRing(a.bbox)), {
        color: '#7a3cff',
        weight: 1.5,
        dashArray: '6 5',
        fill: false,
        interactive: true,
        bubblingMouseEvents: true, // clicks still fly the camera
      })
        .bindTooltip(`Schwerpunkt: ${esc(a.name_de)}`, { sticky: true })
        .addTo(g);
    }
    return g;
  }

  private toLatLngs(ring: Array<[number, number]>): L.LatLngTuple[] {
    return ring.map(([E, N]) => {
      const ll = utmToWgs84(E, N);
      return [ll.lat, ll.lon] as L.LatLngTuple;
    });
  }

  private addOpacityControl(): void {
    const Ctl = L.Control.extend({
      onAdd: () => {
        const div = L.DomUtil.create('div', 'leaflet-bar mm-opacity');
        div.innerHTML = `<label title="Deckkraft der Relief-Ebenen">Relief <input type="range" min="0" max="1" step="0.05"></label>`;
        const input = div.querySelector('input')!;
        input.value = String(this.prefs.reliefOpacity);
        input.addEventListener('input', () => {
          const v = Number(input.value);
          for (const l of this.reliefLayers) l.setOpacity(v);
          this.savePrefs({ reliefOpacity: v });
        });
        L.DomEvent.disableClickPropagation(div);
        L.DomEvent.disableScrollPropagation(div);
        return div;
      },
    });
    new Ctl({ position: 'bottomleft' }).addTo(this.map);
  }

  private bindBar(): void {
    const bar = this.root.querySelector<HTMLElement>('.mm-bar')!;
    this.followInput = bar.querySelector<HTMLInputElement>('.mm-follow input')!;
    this.followInput.checked = this.prefs.follow;
    this.followInput.addEventListener('change', () => this.setFollow(this.followInput.checked));
    for (const b of bar.querySelectorAll<HTMLButtonElement>('[data-size]')) {
      b.addEventListener('click', () => {
        this.savePrefs({ size: b.dataset.size as Size, collapsed: false });
        this.applySize();
      });
    }
    bar.querySelector('.mm-collapse')!.addEventListener('click', () => {
      this.savePrefs({ collapsed: !this.prefs.collapsed });
      this.applySize();
    });
  }

  private applySize(): void {
    const r = this.root;
    r.classList.remove('size-s', 'size-l', 'size-full');
    r.classList.add(`size-${this.prefs.size}`);
    r.classList.toggle('collapsed', this.prefs.collapsed);
    const btn = r.querySelector<HTMLElement>('.mm-collapse')!;
    btn.textContent = this.prefs.collapsed ? '▸' : '▾';
    btn.setAttribute('aria-expanded', String(!this.prefs.collapsed));
    for (const b of r.querySelectorAll<HTMLElement>('[data-size]')) b.classList.toggle('active', b.dataset.size === this.prefs.size);
    // Map size changes are picked up by the ResizeObserver (also during the CSS transition).
    this.scheduleCamera(true);
  }

  private savePrefs(patch: Partial<Prefs>): void {
    Object.assign(this.prefs, patch);
    for (const k of Object.keys(patch) as Array<keyof Prefs>) delete this.unsaved[k];
    try {
      // Transient in-memory values (sheet-forced expand, locate fit) never reach storage.
      localStorage.setItem(PREFS_KEY, JSON.stringify({ ...this.prefs, ...this.unsaved }));
    } catch {
      /* ignore */
    }
  }

  /** Change a pref in memory only; the saved value is kept and written by later saves. */
  private setTransient<K extends keyof Prefs>(key: K, value: Prefs[K]): void {
    if (!(key in this.unsaved)) (this.unsaved as Record<K, Prefs[K]>)[key] = this.prefs[key];
    this.prefs[key] = value;
    if (this.unsaved[key] === value) delete this.unsaved[key];
  }

  /** Fit pending bounds once the map has a real size. Returns true when it fitted. */
  private applyPendingBounds(): boolean {
    const b = this.pendingBounds;
    if (!b || this.prefs.collapsed) return false;
    const size = this.map.getSize();
    if (size.x <= 0 || size.y <= 0) return false;
    this.pendingBounds = null;
    this.fitting = true;
    try {
      this.map.fitBounds(b, { padding: [16, 16], maxZoom: 15, animate: false });
    } finally {
      this.fitting = false;
    }
    return true;
  }

  private recenter(): void {
    const { E, N } = this.ctx.store.get();
    if (!E && !N) return;
    const ll = utmToWgs84(E, N);
    this.map.setView([ll.lat, ll.lon], this.map.getZoom(), { animate: false });
  }

  /** Coalesce camera updates to one per animation frame; footprint additionally throttled. */
  private scheduleCamera(forceFootprint = false): void {
    if (forceFootprint) this.lastFootprint = 0;
    if (this.camPending) return;
    this.camPending = true;
    requestAnimationFrame(() => {
      this.camPending = false;
      this.updateCamera();
    });
  }

  private updateCamera(): void {
    if (this.prefs.collapsed) return;
    const s = this.ctx.store.get();
    if (!s.E && !s.N) return;
    const ll = utmToWgs84(s.E, s.N);
    const latlng = L.latLng(ll.lat, ll.lon);
    this.camMarker.setLatLng(latlng);
    const el = this.camMarker.getElement()?.querySelector<HTMLElement>('.mm-cam');
    if (el) el.style.transform = `rotate(${s.heading + this.convergence}deg)`;

    if (this.prefs.follow) {
      const p = this.map.latLngToContainerPoint(latlng);
      const c = this.map.getSize().divideBy(2);
      if (p.distanceTo(c) > 2) this.map.setView(latlng, this.map.getZoom(), { animate: false });
    }

    const now = performance.now();
    if (now - this.lastFootprint >= FOOTPRINT_INTERVAL_MS) {
      this.lastFootprint = now;
      this.updateFootprint();
    } else if (!this.footprintTimer) {
      // Make sure the final pose gets a footprint once motion stops.
      this.footprintTimer = setTimeout(() => {
        this.footprintTimer = null;
        this.scheduleCamera();
      }, FOOTPRINT_INTERVAL_MS);
    }
  }

  private readonly ray = new Ray();
  private readonly ndcV = new Vector3();

  private updateFootprint(): void {
    const { camera, terrain, manifest } = this.ctx;
    camera.updateMatrixWorld();
    const o = camera.position;
    const origin: V3 = { x: o.x, y: o.y, z: o.z };
    const dirs: V3[] = borderNdc(3).map(([x, y]) => {
      const v = this.ndcV.set(x, y, 0.5).unproject(camera).sub(o).normalize();
      return { x: v.x, y: v.y, z: v.z };
    });
    const hit: RayHit = (or, d, maxDist) => {
      this.ray.origin.set(or.x, or.y, or.z);
      this.ray.direction.set(d.x, d.y, d.z);
      const p = terrain.intersectRay(this.ray, maxDist);
      return p ? p.distanceTo(this.ray.origin) : null;
    };
    const pts = footprintFromRays(origin, dirs, hit, FOOTPRINT_MAX_DIST);
    this.footprint.setLatLngs(
      pts.map((p) => {
        const w = worldToWgs84(p.x, p.z, manifest.origin);
        return [w.lat, w.lon] as L.LatLngTuple;
      }),
    );
  }
}
