/**
 * Wires the map & UX features (F4 minimap, F6 Fundmarker, F7 Bekannte Orte, F8 disclaimer/attribution)
 * into the AppContext. Called once from main.ts right after `window.sle` is set.
 */
import { initBuildings } from '../buildings/Buildings';
import { initCandidates } from '../candidates/Candidates';
import type { AppContext } from '../main';
import { Minimap } from '../map/Minimap';
import { MarkerManager } from '../markers/MarkerManager';
import { PARCEL_ATTRIBUTION } from '../markers/parcel';
import { initMeasure } from '../measure';
import { createPoiPanel } from '../pois/PoiPanel';
import { initReconstruction } from '../reconstruction/Reconstruction';
import { openReportDialog } from '../report/ReportDialog';
import { initVectorLayers } from '../vectors/VectorLayers';
import { openAbout } from './about';
import { showDisclaimer } from './disclaimer';
import './features.css';
import { Labels3D } from './Labels3D';

export interface Features {
  minimap: Minimap;
  markers: MarkerManager;
  labels: Labels3D;
}

export function initFeatures(ctx: AppContext): Features {
  const app = document.querySelector<HTMLElement>('#app')!;
  const panel = document.querySelector<HTMLElement>('#panel')!;
  const viewport = document.querySelector<HTMLElement>('#viewport')!;

  showDisclaimer();
  buildAttribution();

  const labels = new Labels3D(viewport, ctx.camera, ctx.terrain, ctx.manifest.origin);
  const markers = new MarkerManager(ctx, panel, labels);
  let poiFly: ((id: string) => void) | null = null;
  const minimap = new Minimap(document.querySelector<HTMLElement>('#minimap')!, ctx, {
    onPoiClick: (p) => poiFly?.(p.id),
    onMarkerClick: (m) => markers.flyTo(m),
  });
  markers.onChange((list) => minimap.setMarkers(list));
  markers.setReportHandler((m) => openReportDialog(ctx, m)); // F18: "Meldung erstellen" (download only)
  initVectorLayers(ctx, panel); // F10: Wege (OSM) in 3D + F12 parcel lookup (only if manifest.vectors)
  initBuildings(ctx, panel); // F11: LoD2 Gebäude in 3D, key G (only if manifest.models.buildings)
  initCandidates(ctx, panel, { minimap, markers, labels }); // F15: Verdachtsflächen, keys X, N/P (only if manifest.candidates)
  // 🧊 F16 point cloud + Röntgen are frozen (ADR 0020): src/pointcloud/ and its tests stay, initPointClouds() is not called.
  void createPoiPanel(ctx, panel, labels).then((api) => {
    minimap.setPois(api.pois);
    poiFly = (id) => {
      const p = api.pois.find((x) => x.id === id);
      if (p) api.flyTo(p);
    };
  });

  // Toolbar: Markieren (the ⓘ button lives in the attribution footer)
  const bar = document.createElement('div');
  bar.id = 'sle-toolbar';
  bar.innerHTML = `
    <button type="button" data-act="mark" title="Fundmarker setzen (Taste M)">Markieren <kbd>M</kbd></button>`;
  bar.querySelector('[data-act=mark]')!.addEventListener('click', () => markers.setActive(!markers.active));
  markers.onModeChange((on) => bar.querySelector('[data-act=mark]')!.classList.toggle('on', on));
  app.appendChild(bar);
  initMeasure(ctx, panel, labels, { toolbar: bar, exclusiveWith: markers }); // F17: Messen, key L
  // F19: Rekonstruktion 1789 (shared dataset data/shared/karlsberg1789/, not in the manifest), keys R, T
  void initReconstruction(ctx, panel, { minimap, toolbar: bar });

  return { minimap, markers, labels };

  function buildAttribution(): void {
    const footer = document.querySelector<HTMLElement>('#attribution');
    if (!footer || footer.dataset.sle) return;
    footer.dataset.sle = '1';
    const base = document.createElement('span');
    base.textContent = footer.textContent ?? '';
    const extra = document.createElement('span');
    extra.innerHTML =
      ` · Karte © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>-Mitwirkende` +
      ` · ${PARCEL_ATTRIBUTION.replace('dl-de/by-2-0', '<a href="https://www.govdata.de/dl-de/by-2-0" target="_blank" rel="noopener">dl-de/by-2-0</a>')}` +
      ` · Orte: OSM (ODbL), Wikipedia`;
    const info = document.createElement('button');
    info.type = 'button';
    info.className = 'sle-info-btn';
    info.textContent = 'ⓘ';
    info.title = 'Hinweise: Schauen, nicht graben';
    info.addEventListener('click', () => showDisclaimer(true));
    const about = document.createElement('button');
    about.type = 'button';
    about.className = 'sle-about-btn';
    about.textContent = 'Über & Datenschutz';
    about.addEventListener('click', openAbout);
    footer.replaceChildren(info, about, ' · ', base, extra);
  }
}
