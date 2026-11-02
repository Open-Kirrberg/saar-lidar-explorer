import type { AppContext } from '../main';
import { dataRootUrl } from '../data/manifest';
import { wgs84ToUtm } from '../geo';
import type { Labels3D } from '../ui/Labels3D';
import { createPanelSection } from '../ui/panelSection';
import { CONFIDENCE_LABELS, filterPois, groupPois, obliqueView, parsePois } from './pois';
import type { Poi } from './pois';

const PREFS_KEY = 'sle.pois.v1';
const LABEL_GROUP = 'poi';

/** Grid bearing (deg clockwise from grid north) from (E0,N0) to (E1,N1). */
export function gridBearing(E0: number, N0: number, E1: number, N1: number): number {
  return ((Math.atan2(E1 - E0, N1 - N0) * 180) / Math.PI + 360) % 360;
}

/** Fly to a target from the current direction of approach, ending at an oblique view. */
export function flyToSite(ctx: AppContext, E: number, N: number, dist = 120, agl = 60): Promise<boolean> {
  const s = ctx.store.get();
  const far = Math.hypot(E - s.E, N - s.N) > dist * 1.5;
  const heading = far ? gridBearing(s.E, s.N, E, N) : s.heading;
  const v = obliqueView(dist, agl, heading);
  return ctx.flyTo(E, N, { agl: v.agl * ctx.terrain.uniforms.uExag.value, heading: v.heading, pitch: v.pitch, lookAt: true });
}

export interface PoiPanelApi {
  pois: Poi[];
  flyTo(p: Poi): void;
}

/** "Bekannte Orte" (F7): grouped, searchable list in #panel + 3D labels. */
export async function createPoiPanel(
  ctx: AppContext,
  panel: HTMLElement,
  labels: Labels3D,
): Promise<PoiPanelApi> {
  const sec = createPanelSection(panel, 'pois', 'Bekannte Orte', true);
  const api: PoiPanelApi = { pois: [], flyTo: (p) => void flyTo(p) };
  let prefs = { inAoi: true, show3d: true };
  try {
    prefs = { ...prefs, ...(JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as object) };
  } catch {
    /* ignore */
  }
  const savePrefs = () => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      /* ignore */
    }
  };

  sec.body.innerHTML = `
    <input type="search" class="sle-input" placeholder="Suchen … (z. B. Weiher, Bunker)" aria-label="Bekannte Orte durchsuchen">
    <div class="sle-row">
      <label><input type="checkbox" data-k="inAoi"> nur im Gebiet</label>
      <label><input type="checkbox" data-k="show3d"> in 3D zeigen</label>
    </div>
    <div class="sle-list" role="list"></div>
    <p class="sle-dim sle-small">Quellen: OSM, Wikipedia u. a. (siehe Tooltip). Lagen teils ungenau.</p>`;
  const search = sec.body.querySelector<HTMLInputElement>('input[type=search]')!;
  const list = sec.body.querySelector<HTMLElement>('.sle-list')!;
  const cbInAoi = sec.body.querySelector<HTMLInputElement>('[data-k=inAoi]')!;
  const cbShow3d = sec.body.querySelector<HTMLInputElement>('[data-k=show3d]')!;
  cbInAoi.checked = prefs.inAoi;
  cbShow3d.checked = prefs.show3d;
  labels.setGroupVisible(LABEL_GROUP, prefs.show3d);

  const { origin, size } = ctx.manifest;
  const inAoi = (p: Poi) => {
    const { E, N } = wgs84ToUtm(p.lat, p.lon);
    return E >= origin.E0 && E <= origin.E0 + size.width && N >= origin.N0 && N <= origin.N0 + size.height;
  };

  const flyTo = (p: Poi) => {
    const { E, N } = wgs84ToUtm(p.lat, p.lon);
    for (const el of list.querySelectorAll('.active')) el.classList.remove('active');
    list.querySelector(`[data-id="${CSS.escape(p.id)}"]`)?.classList.add('active');
    return flyToSite(ctx, E, N);
  };

  const render = () => {
    const shown = filterPois(api.pois, { query: search.value, where: prefs.inAoi ? inAoi : undefined });
    sec.setCount(shown.length);
    list.replaceChildren();
    if (!shown.length) {
      list.innerHTML = `<p class="sle-dim">Keine Treffer.</p>`;
      return;
    }
    for (const g of groupPois(shown)) {
      const det = document.createElement('details');
      det.open = true;
      det.innerHTML = `<summary>${g.label} <span class="sle-dim">(${g.items.length})</span></summary>`;
      const ul = document.createElement('ul');
      for (const p of g.items) {
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'sle-item';
        b.dataset.id = p.id;
        b.title = [p.note, p.source].filter(Boolean).join('\n');
        b.innerHTML = `<span class="sle-conf c-${p.confidence}" title="${CONFIDENCE_LABELS[p.confidence]}"></span><span class="sle-item-name"></span>`;
        b.querySelector('.sle-item-name')!.textContent = p.name + (inAoi(p) ? '' : ' ↗');
        b.addEventListener('click', () => void flyTo(p));
        li.appendChild(b);
        ul.appendChild(li);
      }
      det.appendChild(ul);
      list.appendChild(det);
    }
  };

  search.addEventListener('input', render);
  // Keep Escape / typing inside the search box from reaching other handlers.
  search.addEventListener('keydown', (e) => e.stopPropagation());
  cbInAoi.addEventListener('change', () => {
    prefs.inAoi = cbInAoi.checked;
    savePrefs();
    render();
  });
  cbShow3d.addEventListener('change', () => {
    prefs.show3d = cbShow3d.checked;
    labels.setGroupVisible(LABEL_GROUP, prefs.show3d);
    savePrefs();
  });

  try {
    const res = await fetch(`${dataRootUrl()}pois.geojson`, { cache: 'no-cache' });
    const text = await res.text();
    api.pois = res.ok && text.trimStart().startsWith('{') ? parsePois(JSON.parse(text)) : [];
  } catch (err) {
    console.warn('[pois] could not load pois.geojson', err);
  }
  if (!api.pois.length) {
    list.innerHTML = `<p class="sle-dim">Keine bekannten Orte (pois.geojson fehlt).</p>`;
    return api;
  }

  for (const p of api.pois) {
    const { E, N } = wgs84ToUtm(p.lat, p.lon);
    const el = document.createElement('div');
    el.className = `sle-pin poi t-${p.type}`;
    el.innerHTML = `<span class="sle-pin-txt"></span><span class="sle-pin-stem"></span>`;
    el.querySelector('.sle-pin-txt')!.textContent = p.name;
    el.title = `${p.name} – klicken zum Hinfliegen`;
    el.addEventListener('click', () => void flyTo(p));
    labels.set(`poi:${p.id}`, LABEL_GROUP, E, N, el, { lift: 0, maxDistance: 3500 });
  }
  render();
  return api;
}
