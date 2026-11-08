import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './minimap.css';
import { Ray, Vector3 } from 'three';
import { utmToWgs84, worldToWgs84, wgs84ToUtm } from '../geo';
import type { AppContext } from '../main';
import type { ShellApi } from '../shell/types';
import type { Marker } from '../markers/markerStore';
import type { Poi } from '../pois/pois';
import { POI_TYPE_LABELS } from '../pois/pois';
import { isTyping } from '../ui/keys';
import { modalOpen } from '../ui/modalKeys';
import { FOCUS_AREAS, bboxRing } from './aois';
import { horizontalFovDeg, minimapPose, northBadgeOffset, unrotatePoint, wedgePath } from './bearing';
import type { MapMode } from './bearing';
import { cornerLift, zoomToFitAround } from './fit';
import { borderNdc, footprintFromRays } from './footprint';
import { DOP_WMS, mergeOverlayPrefs, syncOverlayPrefs, xyzOverlay } from './overlays';
import { resolveDataPath } from '../data/urls';
import type { RayHit, V3 } from './footprint';
import { tileLabelPoint, tileOutlineRings } from '../catalog/outline';

const PREFS_KEY = 'sle.map.v2';
/** Dispatched synchronously when the full-screen map opens / closes (the shell re-places its corner). */
export const MAP_FULL_EVENT = 'sle:map-full';
/** v1 prefs (size/collapsed/follow are gone; base, overlays and relief opacity carry over into Labor). */
const PREFS_KEY_V1 = 'sle.map.v1';
const CP_WMS = 'https://geoportal.saarland.de/gdi-sl/inspirewms_Flurstuecke_Grundstuecke_ALKIS?';
const FOOTPRINT_MAX_DIST = 2500;
const FOOTPRINT_INTERVAL_MS = 150;
const OSM_LINK = '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
const TOPO_LINK = '<a href="https://opentopomap.org" target="_blank" rel="noopener">OpenTopoMap</a>';

interface Prefs {
  /** Compact minimap orientation (the full-screen map is always north-up). */
  mode: MapMode;
  /** Zoom of the compact minimap. */
  zoom: number;
  /** Labor only: base layer, overlays and relief opacity of the layer control. */
  base: string;
  overlays: string[];
  reliefOpacity: number;
  /** Overlays the user has seen in the layer control (new ones get switched on once). */
  knownOverlays?: string[];
}

const FOCUS_OVERLAY = 'Schwerpunktgebiete';
const AOI_OVERLAY = 'Untersuchungsgebiet';
const POI_OVERLAY = 'Bekannte Orte';
const MARKER_OVERLAY = 'Fundmarker';
/** Standard / Entdecker: a game map, no layer choice (ADR 0036). */
const GAME_OVERLAYS = [AOI_OVERLAY, POI_OVERLAY, MARKER_OVERLAY];

const DEFAULT_PREFS: Prefs = {
  mode: 'heading',
  zoom: 15,
  base: 'OpenStreetMap',
  overlays: ['Relief: VAT (Kombination)', AOI_OVERLAY, FOCUS_OVERLAY, POI_OVERLAY, MARKER_OVERLAY],
  reliefOpacity: 0.55,
};

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) };
    const v1 = localStorage.getItem(PREFS_KEY_V1);
    if (v1) {
      const o = JSON.parse(v1) as Partial<Prefs>;
      const keep: Partial<Prefs> = {};
      for (const k of ['zoom', 'base', 'overlays', 'reliefOpacity', 'knownOverlays'] as const) if (o[k] !== undefined) Object.assign(keep, { [k]: o[k] });
      return { ...DEFAULT_PREFS, ...keep };
    }
  } catch {
    /* private mode etc. */
  }
  return { ...DEFAULT_PREFS };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** A zone portal on the map (V2.6b `zonePortals()` feeds this through `setPortals`). */
export interface MapPortal {
  id: string;
  E: number;
  N: number;
  /** German label, e.g. „Schloss Karlsberg 1789“. */
  label: string;
}

export interface MinimapCallbacks {
  onPoiClick?: (poi: Poi) => void;
  onMarkerClick?: (m: Marker) => void;
  /** Default: fly to the portal. */
  onPortalClick?: (p: MapPortal) => void;
  /** Tier source (the feature host's shell; `ctx.shell` is not set yet while features mount). */
  shell?: Pick<ShellApi, 'tier' | 'onTier'>;
}

/**
 * Game minimap (V2.3, ADR 0036) in the shell's `slots.minimap`: round dial, player centred, FOV-correct
 * view cone, north-up / heading-up (CSS-rotated Leaflet container), click-to-fly, one button to a
 * full-screen north-up map. Standard/Entdecker show OSM + AOI outline + places + markers + portals;
 * Labor adds the v1 layer control (relief, ortho, historic maps, cadastre), relief opacity and the
 * ray-cast view footprint.
 */
export class Minimap {
  readonly map: L.Map;
  private readonly prefs: Prefs;
  private readonly root: HTMLElement;
  private readonly mapEl: HTMLElement;
  private readonly northBtn: HTMLButtonElement;
  private readonly centerBtn: HTMLButtonElement;
  private readonly attrEl: HTMLElement;
  private readonly player: L.Marker;
  private readonly footprint: L.Polygon;
  private readonly poiLayer = L.layerGroup();
  private readonly markerLayer = L.layerGroup();
  private readonly portalLayer = L.layerGroup();
  private readonly reliefLayers: L.TileLayer[] = [];
  private readonly bases: Record<string, L.Layer>;
  private readonly overlays: Record<string, L.Layer>;
  private readonly fullControls: L.Control[] = [];
  private readonly offs: Array<() => void> = [];
  private camPending = false;
  private lastFootprint = 0;
  private footprintTimer: ReturnType<typeof setTimeout> | null = null;
  /** Current CSS rotation of the Leaflet container (deg). */
  private rotation = 0;
  private full = false;
  /** Full-screen map follows the player until dragged. The compact dial always follows. */
  private follow = true;
  private compactZoom: number;
  /** showBounds() opened the full-screen map; endTemporaryView() closes it again. */
  private temporaryFull = false;
  /** Area the user selected (e.g. a place outline): the full map fits it when it opens. */
  private focus: L.LatLngBounds | null = null;
  /** Compact dial zoomed out to show `bounds` around the player until `until` (ms, extended while flying). */
  private peek: { bounds: L.LatLngBounds; until: number; ms: number; zoom: number } | null = null;
  private peekTimer: ReturnType<typeof setTimeout> | null = null;
  /** Full map: px the bottom-right controls move up to clear the shell's „© Quellen“ button. */
  private cornerLiftPx = 0;
  private coneFov = 0;
  private coneRadius = 0;
  private labor = false;
  private destroyed = false;

  constructor(
    container: HTMLElement,
    private readonly ctx: AppContext,
    private readonly cb: MinimapCallbacks = {},
  ) {
    this.root = container;
    this.prefs = loadPrefs();
    this.compactZoom = this.prefs.zoom;
    const { manifest } = ctx;
    container.classList.add('gmm');
    container.innerHTML = `
      <div class="gmm-dial"><div class="gmm-map" role="application" aria-label="Karte – klicken, um dorthin zu fliegen"></div></div>
      <div class="gmm-ring" aria-hidden="true"></div>
      <button type="button" class="gmm-btn gmm-north" title="Karte drehen: Blickrichtung oben / Norden oben"><span>N</span></button>
      <button type="button" class="gmm-btn gmm-expand" title="Große Karte" aria-label="Große Karte öffnen">
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 10V4h6M20 14v6h-6M4 4l6 6M20 20l-6-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <button type="button" class="gmm-btn gmm-close" title="Karte schließen (Esc)" aria-label="Große Karte schließen">✕</button>
      <button type="button" class="gmm-btn gmm-center" title="Auf meine Position zentrieren" aria-label="Zentrieren" hidden>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="currentColor"/><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4" stroke="currentColor" stroke-width="2"/></svg>
      </button>
      <div class="gmm-attr"></div>`;
    this.mapEl = container.querySelector<HTMLElement>('.gmm-map')!;
    this.northBtn = container.querySelector<HTMLButtonElement>('.gmm-north')!;
    this.centerBtn = container.querySelector<HTMLButtonElement>('.gmm-center')!;
    this.attrEl = container.querySelector<HTMLElement>('.gmm-attr')!;

    const E0 = manifest.origin.E0 + (manifest.size.width * manifest.cellSize) / 2; // size is in cells
    const N0 = manifest.origin.N0 + (manifest.size.height * manifest.cellSize) / 2;
    const c0 = utmToWgs84(E0, N0);

    this.map = L.map(this.mapEl, {
      center: [c0.lat, c0.lon],
      zoom: this.prefs.zoom,
      minZoom: 10,
      maxZoom: 20,
      zoomControl: false,
      attributionControl: false, // compact: own „© OpenStreetMap“ line outside the dial; full: Leaflet control
      keyboard: false, // arrow keys belong to the drone
      doubleClickZoom: false, // a click flies; avoid double flights
      boxZoom: false,
      dragging: false, // the dial is player-centred; the full-screen map can be dragged
      scrollWheelZoom: 'center',
      touchZoom: 'center',
    });

    // ---- base layers (OSM tile usage policy: attribution, no prefetch/bulk) ----
    const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 20,
      maxNativeZoom: 19,
      attribution: `&copy; ${OSM_LINK}-Mitwirkende`,
    });
    const topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      maxZoom: 20,
      maxNativeZoom: 17,
      subdomains: 'abc',
      attribution: `Kartendaten: &copy; ${OSM_LINK}-Mitwirkende, SRTM | Darstellung: &copy; ${TOPO_LINK} (CC-BY-SA)`,
    });
    const blank = L.layerGroup();
    this.bases = { OpenStreetMap: osm, OpenTopoMap: topo, 'Kein Hintergrund': blank };

    // ---- overlays (all of them in Labor; GAME_OVERLAYS below) ----
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
    // S2 catalog mode: stacked per-place relief tiles (alpha 0 outside each place's own tiles).
    if (ctx.catalog) {
      const group = L.layerGroup();
      const added = new Set<string>();
      let name = 'Relief: VAT (Kombination)';
      const addPlaces = () => {
        for (const r of ctx.catalog!.places.ready()) {
          const x = r.manifest.xyz?.vat;
          if (!x || added.has(r.place.id)) continue;
          added.add(r.place.id);
          const b = x.bounds;
          const layer = L.tileLayer(resolveDataPath(r.baseUrl, x.url), {
            minZoom: 10,
            maxZoom: 20,
            minNativeZoom: x.minZoom,
            maxNativeZoom: x.maxZoom,
            bounds: b ? L.latLngBounds(b) : undefined,
            opacity: this.prefs.reliefOpacity,
            attribution: esc(r.manifest.attribution.split(';')[0] ?? ''),
            className: 'mm-relief',
          });
          this.reliefLayers.push(layer);
          group.addLayer(layer);
        }
      };
      const first = ctx.catalog.places.ready().find((r) => r.manifest.xyz?.vat);
      if (first) name = xyzOverlay('vat', first.manifest.xyz!.vat, first.manifest.layers, first.manifest.imageLayers).name;
      addPlaces();
      ctx.catalog.places.onChange(addPlaces);
      overlays[name] = group;
    }
    overlays[AOI_OVERLAY] = ctx.catalog ? this.catalogOutlines() : this.aoiOutline();
    overlays[FOCUS_OVERLAY] = this.focusOutlines();
    overlays[POI_OVERLAY] = this.poiLayer;
    overlays[MARKER_OVERLAY] = this.markerLayer;
    this.overlays = overlays;

    // Overlays added in a later version are on by default once, even with saved prefs.
    // Prefs are global: knownOverlays is a union over all AOIs visited (mergeOverlayPrefs).
    this.savePrefs(mergeOverlayPrefs(this.prefs, Object.keys(overlays), DEFAULT_PREFS.overlays, [FOCUS_OVERLAY]));

    // Only the Labor layer control fires these (programmatic add/remove does not).
    this.map.on('baselayerchange', (e: L.LayersControlEvent) => {
      this.savePrefs({ base: e.name });
      this.renderAttribution();
    });
    this.map.on('overlayadd overlayremove', () =>
      this.savePrefs({
        // Keep saved on-states of overlays this AOI doesn't define (e.g. hist_*/relief in the fixture).
        overlays: syncOverlayPrefs(
          this.prefs.overlays,
          Object.keys(overlays),
          Object.entries(overlays).filter(([, l]) => this.map.hasLayer(l)).map(([n]) => n),
        ),
      }),
    );

    // ---- player (arrow + view cone) and Labor footprint ----
    this.footprint = L.polygon([], {
      color: '#ffb000',
      weight: 1.5,
      fillColor: '#ffd27a',
      fillOpacity: 0.18,
      interactive: false,
    });
    this.player = L.marker([c0.lat, c0.lon], { interactive: false, keyboard: false, zIndexOffset: 1000 });
    this.updatePlayerIcon();
    this.player.addTo(this.map);
    this.portalLayer.addTo(this.map);

    // ---- interactions ----
    this.map.on('click', (e: L.LeafletMouseEvent) => this.flyToLatLng(this.eventLatLng(e)));
    this.map.on('dragstart', () => this.setFollow(false));
    this.map.on('zoomend', () => {
      if (!this.full) {
        // A peek zoom is temporary; a zoom the user makes during a peek ends it and is kept.
        if (this.peek && this.map.getZoom() !== this.peek.zoom) this.stopPeek(false);
        if (!this.peek) {
          this.compactZoom = this.map.getZoom();
          this.savePrefs({ zoom: this.compactZoom });
        }
      }
      if (this.full ? this.follow : true) this.recenter();
    });
    this.northBtn.addEventListener('click', () => this.setMode(this.prefs.mode === 'heading' ? 'north' : 'heading'));
    container.querySelector('.gmm-expand')!.addEventListener('click', () => this.setFull(true));
    container.querySelector('.gmm-close')!.addEventListener('click', () => this.setFull(false));
    this.centerBtn.addEventListener('click', () => this.setFollow(true));
    for (const b of [this.northBtn, this.centerBtn, ...container.querySelectorAll<HTMLElement>('.gmm-btn, .gmm-attr')]) {
      L.DomEvent.disableClickPropagation(b);
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape' && this.full && !isTyping(e.target) && !modalOpen(e.target)) {
        e.preventDefault();
        this.setFull(false);
      }
    };
    window.addEventListener('keydown', onKey);
    this.offs.push(() => window.removeEventListener('keydown', onKey));

    const ro = new ResizeObserver(() => {
      this.map.invalidateSize({ animate: false });
      this.syncCornerLift();
      this.updatePlayerIcon();
      this.placeNorthBadge();
      if (this.full && !this.follow) this.scheduleCamera(true);
      else {
        this.recenter();
        this.scheduleCamera(true);
      }
    });
    ro.observe(this.mapEl);
    this.offs.push(() => ro.disconnect());

    // The minimap never writes camera keys; ignore its own tag anyway (store convention).
    this.offs.push(ctx.store.subscribe((_s, _c, source) => source !== 'map' && this.scheduleCamera(), ['E', 'N', 'h', 'heading', 'pitch']));
    const onReady = () => this.scheduleCamera(true);
    window.addEventListener('sle:ready', onReady);
    this.offs.push(() => window.removeEventListener('sle:ready', onReady));
    const shell = this.shell();
    if (shell) this.offs.push(shell.onTier(() => this.applyTier()));

    this.applyTier();
    this.applyMode();
    this.scheduleCamera(true);
  }

  // ---- public ---------------------------------------------------------------------------------

  /** 'north' | 'heading' of the compact dial (persisted). */
  get mode(): MapMode {
    return this.prefs.mode;
  }

  setMode(mode: MapMode): void {
    this.savePrefs({ mode });
    this.applyMode();
    this.scheduleCamera();
  }

  /** Whether the full-screen map is open. */
  get isFull(): boolean {
    return this.full;
  }

  /** Open / close the full-screen north-up map (draggable, zoom buttons; layer control in Labor). */
  setFull(on: boolean): void {
    if (on === this.full) return;
    this.temporaryFull = false;
    this.full = on;
    this.root.classList.toggle('gmm-full', on);
    // The shell re-places its „© Quellen“ corner now (a phone sheet hides behind the full map), before we measure it.
    window.dispatchEvent(new CustomEvent(MAP_FULL_EVENT, { detail: { full: on } }));
    for (const c of this.fullControls.splice(0)) c.remove();
    const m = this.map;
    if (on) {
      m.dragging.enable();
      m.options.scrollWheelZoom = true;
      m.options.touchZoom = true;
      m.boxZoom.enable();
      this.fullControls.push(L.control.zoom({ position: 'bottomright', zoomInTitle: 'Hineinzoomen', zoomOutTitle: 'Herauszoomen' }));
      const attr = L.control.attribution({ position: 'bottomright' });
      attr.setPrefix('<a href="https://leafletjs.com" title="Leaflet">Leaflet</a>');
      this.fullControls.push(attr);
      if (this.labor) {
        this.fullControls.push(L.control.layers(this.bases, this.overlays, { collapsed: true, position: 'topleft' }));
        if (this.reliefLayers.length) this.fullControls.push(this.opacityControl());
      }
      for (const c of this.fullControls) c.addTo(m);
    } else {
      m.dragging.disable();
      m.options.scrollWheelZoom = 'center';
      m.options.touchZoom = 'center';
      m.boxZoom.disable();
      if (m.getZoom() !== this.compactZoom) m.setZoom(this.compactZoom, { animate: false });
    }
    this.setFollow(true);
    this.applyMode();
    this.syncCornerLift();
    // A selected area (place outline) and the player both show when the full map opens.
    if (on && this.focus) this.fitFull(L.latLngBounds(this.focus.getSouthWest(), this.focus.getNorthEast()).extend(this.player.getLatLng()));
    this.root.querySelector<HTMLElement>(on ? '.gmm-close' : '.gmm-expand')?.focus({ preventScroll: true });
    // Size changes are picked up by the ResizeObserver.
  }

  /**
   * Show an area (e.g. a selected place's outline, WGS84 bounds). Full-screen map: fit it (stops
   * following; the centre button returns to the player). Compact dial (player-centred, round): zoom
   * out for `peekMs` after the current flight ends so the area shows around the player, then back to
   * the user's zoom (a zoom by the user ends the peek). Nothing is persisted.
   */
  fitBounds(bounds: L.LatLngBounds, opts: { peekMs?: number; maxZoom?: number } = {}): void {
    if (!bounds.isValid()) return;
    if (this.full) {
      this.fitFull(bounds, opts.maxZoom);
      return;
    }
    const ms = opts.peekMs ?? 4000;
    this.peek = { bounds, until: performance.now() + ms, ms, zoom: this.map.getZoom() };
    this.updateCamera();
    this.schedulePeekEnd();
  }

  /**
   * The selected area (null clears it): fitted now (see `fitBounds`) and again, together with the
   * player, whenever the full-screen map opens while it is set.
   */
  setFocus(bounds: L.LatLngBounds | null, opts: { peekMs?: number; fit?: boolean } = {}): void {
    this.focus = bounds && bounds.isValid() ? bounds : null;
    if (this.focus) {
      if (opts.fit !== false) this.fitBounds(this.focus, opts);
    } else this.stopPeek(true);
  }

  /**
   * Temporarily show `points` (e.g. the AOI and the user's position) on the full-screen map.
   * `endTemporaryView()` closes it again. Nothing is persisted.
   */
  showBounds(points: L.LatLngExpression[]): void {
    const wasFull = this.full;
    this.setFull(true);
    this.temporaryFull = !wasFull;
    this.fitFull(L.latLngBounds(points), 15, 16);
  }

  /** Undo `showBounds()`. */
  endTemporaryView(): void {
    if (this.temporaryFull) this.setFull(false);
    else this.setFollow(true);
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
        .on('click', () => {
          this.cb.onPoiClick?.(p);
          this.afterFly();
        })
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
        .on('click', () => {
          this.cb.onMarkerClick?.(m);
          this.afterFly();
        })
        .addTo(this.markerLayer);
    }
  }

  /**
   * Zone portals as door icons (hook for V2.6b: `services.minimap?.setPortals(zonePortals())`).
   * Shown in every tier; a click flies there (or calls `onPortalClick`).
   */
  setPortals(portals: MapPortal[]): void {
    this.portalLayer.clearLayers();
    for (const p of portals) {
      const ll = utmToWgs84(p.E, p.N);
      L.marker([ll.lat, ll.lon], {
        icon: L.divIcon({
          className: 'gmm-portal-icon',
          html: `<div class="gmm-portal"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="M6 21V10a6 6 0 0 1 12 0v11Z" fill="#ffe7a3" stroke="#5a3a00" stroke-width="1.6"/><circle cx="14.5" cy="15" r="1.2" fill="#5a3a00"/></svg></div>`,
          iconSize: [26, 26],
          iconAnchor: [13, 13],
        }),
        keyboard: false,
        bubblingMouseEvents: false,
        zIndexOffset: 500,
        title: p.label,
      })
        .bindTooltip(esc(p.label), { direction: 'top', offset: [0, -12] })
        .on('click', () => {
          if (this.cb.onPortalClick) this.cb.onPortalClick(p);
          else void this.ctx.flyTo(p.E, p.N, { agl: Math.max(this.ctx.controller.agl, 40), lookAt: true });
          this.afterFly();
        })
        .addTo(this.portalLayer);
    }
  }

  /** Full-screen map: follow the player (or stop after a drag). The compact dial always follows. */
  setFollow(on: boolean): void {
    this.follow = on;
    this.centerBtn.hidden = on || !this.full;
    if (on) this.recenter();
  }

  /** Remove the map and all listeners (feature unmount). */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const off of this.offs.splice(0)) off();
    if (this.footprintTimer) clearTimeout(this.footprintTimer);
    if (this.peekTimer) clearTimeout(this.peekTimer);
    this.map.remove();
    this.root.classList.remove('gmm', 'gmm-full', 'gmm-heading');
    this.root.innerHTML = '';
  }

  // ---- internals ------------------------------------------------------------------------------

  private shell(): Pick<ShellApi, 'tier' | 'onTier'> | null {
    return this.cb.shell ?? (this.ctx.shell as ShellApi | null) ?? null;
  }

  /** Leaflet's own latlng is wrong on a CSS-rotated container: undo the rotation around its centre. */
  private eventLatLng(e: L.LeafletMouseEvent): L.LatLng {
    if (!this.rotation) return e.latlng;
    const ev = e.originalEvent;
    const r = this.mapEl.getBoundingClientRect(); // rotation keeps the centre
    const size = this.map.getSize();
    const p = unrotatePoint(ev.clientX - (r.left + r.width / 2), ev.clientY - (r.top + r.height / 2), this.rotation, size.x, size.y);
    return this.map.containerPointToLatLng(L.point(p.x, p.y));
  }

  private flyToLatLng(ll: L.LatLng): void {
    const { E, N } = wgs84ToUtm(ll.lat, ll.lng);
    const { controller, store } = this.ctx;
    const pitch = Math.min(Math.max(store.get().pitch, -89), -20);
    // Keep the current height above ground (display metres), centre the clicked point in view.
    void this.ctx.flyTo(E, N, { agl: Math.max(controller.agl, 10), pitch, lookAt: true });
    this.afterFly();
  }

  /** After a click-to-fly the full-screen map closes, so the flight is visible. */
  private afterFly(): void {
    if (this.full) this.setFull(false);
    else this.setFollow(true);
  }

  private applyTier(): void {
    const labor = this.shell()?.tier() === 'labor';
    this.labor = labor;
    const m = this.map;
    const baseName = labor ? this.prefs.base : 'OpenStreetMap';
    for (const [name, layer] of Object.entries(this.bases)) {
      if (name === baseName || (!(baseName in this.bases) && name === 'OpenStreetMap')) layer.addTo(m);
      else layer.remove();
    }
    const on = labor ? this.prefs.overlays : GAME_OVERLAYS;
    for (const [name, layer] of Object.entries(this.overlays)) {
      if (on.includes(name)) layer.addTo(m);
      else layer.remove();
    }
    if (labor) this.footprint.addTo(m);
    else this.footprint.remove();
    if (this.full) {
      // Rebuild the full-screen controls for the new tier.
      this.setFull(false);
      this.setFull(true);
    }
    this.renderAttribution();
    this.scheduleCamera(true);
  }

  private applyMode(): void {
    const heading = !this.full && this.prefs.mode === 'heading';
    this.root.classList.toggle('gmm-heading', heading);
    this.northBtn.setAttribute('aria-pressed', String(heading));
    this.northBtn.setAttribute('aria-label', heading ? 'Karte: Blickrichtung oben (umschalten auf Norden oben)' : 'Karte: Norden oben (umschalten auf Blickrichtung oben)');
    if (!heading) this.setRotation(0);
  }

  private setRotation(deg: number): void {
    const d = Math.abs(deg) < 1e-6 ? 0 : deg;
    if (d === this.rotation) return;
    this.rotation = d;
    this.mapEl.style.transform = d ? `rotate(${d.toFixed(3)}deg)` : '';
    this.placeNorthBadge();
  }

  private placeNorthBadge(): void {
    // Just inside the rim, so the badge never leaves the screen at the top edge.
    const r = this.mapEl.clientWidth / 2;
    const o = northBadgeOffset(this.rotation, Math.max(r - 15, 0));
    this.northBtn.style.setProperty('--nx', `${o.x.toFixed(1)}px`);
    this.northBtn.style.setProperty('--ny', `${o.y.toFixed(1)}px`);
  }

  /** „© OpenStreetMap“ (linked) stays visible under the compact dial (ADR 0026); full map: Leaflet control. */
  private renderAttribution(): void {
    const topo = this.labor && this.map.hasLayer(this.bases.OpenTopoMap);
    this.attrEl.innerHTML = `&copy; ${OSM_LINK}${topo ? ` · ${TOPO_LINK}` : ''}`;
  }

  /** Player arrow + FOV-correct view cone (one divIcon, rotated as a whole). */
  private updatePlayerIcon(): void {
    const cam = this.ctx.camera as { fov?: number; aspect?: number };
    const fov = horizontalFovDeg(cam.fov ?? 60, cam.aspect ?? 1.6);
    const w = this.mapEl.clientWidth || 180;
    const radius = Math.round(this.full ? 110 : Math.max(36, w * 0.44));
    if (Math.abs(fov - this.coneFov) < 0.25 && radius === this.coneRadius) return;
    this.coneFov = fov;
    this.coneRadius = radius;
    const R = radius;
    this.player.setIcon(
      L.divIcon({
        className: 'gmm-player-icon',
        html: `<div class="gmm-player" style="width:${2 * R}px;height:${2 * R}px"><svg viewBox="${-R} ${-R} ${2 * R} ${2 * R}" width="${2 * R}" height="${2 * R}" aria-hidden="true">
          <defs><radialGradient id="gmm-cone-g" cx="0" cy="0" r="${R}" gradientUnits="userSpaceOnUse">
            <stop offset="0" stop-color="#ffb000" stop-opacity="0.55"/><stop offset="1" stop-color="#ffb000" stop-opacity="0.05"/></radialGradient></defs>
          <path class="gmm-cone" d="${wedgePath(fov, R)}" fill="url(#gmm-cone-g)" stroke="#ff8a00" stroke-opacity="0.7" stroke-width="1"/>
          <path d="M0,-10 L7,8 L0,4 L-7,8 Z" fill="#ff5a1f" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/></svg></div>`,
        iconSize: [2 * R, 2 * R],
        iconAnchor: [R, R],
      }),
    );
    this.lastArrow = NaN;
  }

  private lastArrow = NaN;

  private opacityControl(): L.Control {
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
    return new Ctl({ position: 'bottomleft' });
  }

  /** Outline of the loaded AOI (solid red, tooltip with its name and size). */
  private aoiOutline(): L.Polygon {
    const { origin, name, cellSize } = this.ctx.manifest;
    const size = { width: this.ctx.manifest.size.width * cellSize, height: this.ctx.manifest.size.height * cellSize }; // cells → m
    const ring = this.toLatLngs(bboxRing([origin.E0, origin.N0, origin.E0 + size.width, origin.N0 + size.height]));
    const km = (m: number) => (m / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 });
    return L.polygon(ring, { color: '#e03c31', weight: 2, fill: false, interactive: true, bubblingMouseEvents: true }).bindTooltip(
      `Geladenes Gebiet: ${esc(name)}<br><small>${km(size.width)} × ${km(size.height)} km</small>`,
      { sticky: true },
    );
  }

  /**
   * S2 catalog mode: outline (union of owned 1 km tiles) and name of every catalog place. 3D places
   * solid, places without 3D yet dashed („Ortspate gesucht“).
   */
  private catalogOutlines(): L.LayerGroup {
    const g = L.layerGroup();
    for (const p of this.ctx.catalog!.catalog.places) {
      const rings = tileOutlineRings(p.bbox, p.tiles).map((r) => this.toLatLngs(r));
      if (!rings.length) continue;
      const has3d = p.status !== 'stats';
      L.polyline(rings, {
        color: has3d ? '#e03c31' : '#7d7d7d',
        weight: has3d ? 2 : 1.5,
        dashArray: has3d ? undefined : '5 5',
        interactive: true,
        bubblingMouseEvents: true, // clicks still fly the camera
      })
        .bindTooltip(`${esc(p.name_de)}${has3d ? (p.status === 'building' ? ' (im Aufbau)' : '') : ' – Ortspate gesucht'}`, { sticky: true })
        .addTo(g);
      const lp = tileLabelPoint(p.bbox, p.tiles);
      if (lp) {
        const ll = utmToWgs84(lp[0], lp[1]);
        L.tooltip({ permanent: true, direction: 'center', className: 'gmm-place-name', interactive: false })
          .setLatLng([ll.lat, ll.lon])
          .setContent(esc(p.name_de))
          .addTo(g);
      }
    }
    return g;
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

  private savePrefs(patch: Partial<Prefs>): void {
    Object.assign(this.prefs, patch);
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(this.prefs));
    } catch {
      /* ignore */
    }
  }

  /** Full map: fit `b` inside the controls (close / centre top right, zoom bottom right above „© Quellen“). */
  private fitFull(b: L.LatLngBounds, maxZoom = 16, pad = 24): void {
    this.setFollow(false);
    this.map.invalidateSize({ animate: false });
    this.syncCornerLift();
    this.map.fitBounds(b, { paddingTopLeft: [pad, pad + 8], paddingBottomRight: [pad + 40, pad + this.cornerLiftPx], maxZoom, animate: false });
  }

  /** Compact dial zoom at which the peek area's farthest corner lies inside the round dial. */
  private peekZoom(center: L.LatLng): number {
    const pk = this.peek!;
    const z = this.map.getZoom();
    const c = this.map.project(center, z);
    let d = 0;
    for (const ll of [pk.bounds.getNorthWest(), pk.bounds.getNorthEast(), pk.bounds.getSouthWest(), pk.bounds.getSouthEast()]) {
      d = Math.max(d, this.map.project(ll, z).distanceTo(c));
    }
    const r = (this.root.querySelector<HTMLElement>('.gmm-dial')?.clientWidth ?? 150) / 2;
    return zoomToFitAround(z, d, r * 0.85, this.map.getMinZoom(), this.compactZoom);
  }

  private schedulePeekEnd(): void {
    if (this.peekTimer) clearTimeout(this.peekTimer);
    const tick = () => {
      this.peekTimer = null;
      const pk = this.peek;
      if (!pk || this.destroyed) return;
      const now = performance.now();
      if (this.ctx.controller.flying) pk.until = Math.max(pk.until, now + pk.ms); // the peek runs out after the flight
      if (now < pk.until) this.peekTimer = setTimeout(tick, Math.min(500, pk.until - now + 10));
      else this.stopPeek(true);
    };
    this.peekTimer = setTimeout(tick, 300);
  }

  /** End the dial peek; `restore` returns to the user's zoom. */
  private stopPeek(restore: boolean): void {
    if (this.peekTimer) clearTimeout(this.peekTimer);
    this.peekTimer = null;
    if (!this.peek) return;
    this.peek = null;
    if (restore && !this.full && !this.destroyed && this.map.getZoom() !== this.compactZoom) this.map.setZoom(this.compactZoom, { animate: false });
  }

  /** Full map: lift Leaflet's bottom-right controls (zoom, attribution) above the „© Quellen“ button. */
  private syncCornerLift(): void {
    let lift = 0;
    if (this.full) {
      const keep = document.querySelector<HTMLElement>('[data-shell-anchor="sources"]')?.getBoundingClientRect() ?? null;
      lift = cornerLift(this.root.getBoundingClientRect(), keep);
    }
    if (lift === this.cornerLiftPx) return;
    this.cornerLiftPx = lift;
    this.root.style.setProperty('--gmm-br-lift', `${lift}px`);
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
    if (this.camPending || this.destroyed) return;
    this.camPending = true;
    requestAnimationFrame(() => {
      this.camPending = false;
      if (!this.destroyed) this.updateCamera();
    });
  }

  /** Synchronous update (also used by `window.sle.step` checks via the store subscription). */
  updateCamera(): void {
    const s = this.ctx.store.get();
    if (!s.E && !s.N) return;
    const pose = minimapPose(this.full ? 'north' : this.prefs.mode, s.heading, s.E, s.N);
    this.setRotation(pose.mapRotation);
    this.updatePlayerIcon();
    const ll = utmToWgs84(s.E, s.N);
    const latlng = L.latLng(ll.lat, ll.lon);
    this.player.setLatLng(latlng);
    if (pose.arrow !== this.lastArrow) {
      const el = this.player.getElement()?.querySelector<HTMLElement>('.gmm-player');
      if (el) {
        el.style.transform = `rotate(${pose.arrow.toFixed(3)}deg)`;
        this.lastArrow = pose.arrow;
      }
    }
    if (!this.full || this.follow) {
      const p = this.map.latLngToContainerPoint(latlng);
      const c = this.map.getSize().divideBy(2);
      const zoom = !this.full && this.peek ? this.peekZoom(latlng) : this.map.getZoom();
      if (this.peek && !this.full) this.peek.zoom = zoom;
      if (p.distanceTo(c) > 0.5 || zoom !== this.map.getZoom()) this.map.setView(latlng, zoom, { animate: false });
    }
    if (!this.labor) return;
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
