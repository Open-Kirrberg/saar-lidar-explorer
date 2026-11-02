/**
 * F9: AOI choice at start-up ('overall' when its manifest exists, else 'karlsberg'; `?aoi=` wins)
 * and the small "Gebiet" switcher card listing the known AOIs whose manifest loads. Switching
 * reloads the page with `?aoi=` (keeps the camera hash when it lies inside the target AOI).
 */
import { aoiBaseUrl } from '../data/manifest';
import { getLocate } from '../locate/Locate';
import { aoiParam, chooseAoi, chooseDeployedAoi, switchAoiHref, switchableAois } from '../map/aois';
import { deployedAois } from '../data/urls';
import type { AppContext } from '../main';
import { createPanelSection } from './panelSection';

/** Does `<data>/<aoi>/manifest.json` exist and look like a v1/v2 manifest? (Vite answers 404s with index.html.) */
export async function manifestExists(aoi: string): Promise<boolean> {
  try {
    const res = await fetch(aoiBaseUrl(aoi) + 'manifest.json', { cache: 'no-cache' });
    if (!res.ok) return false;
    const text = await res.text();
    if (!text.trimStart().startsWith('{')) return false;
    const v = (JSON.parse(text) as { version?: unknown }).version;
    return v === 1 || v === 2;
  } catch {
    return false;
  }
}

/** AOI to load at start-up (one small probe for 'overall' unless `?aoi=` is given). */
export async function resolveStartAoi(search: string = location.search): Promise<string> {
  const deployed = deployedAois(); // public build: only the shipped AOIs, no probes
  if (deployed) return chooseDeployedAoi(search, deployed);
  if (aoiParam(search)) return chooseAoi(search, false);
  return chooseAoi(search, await manifestExists('overall'));
}

/** Panel card "Gebiet" (only when at least one other known AOI is available; `VITE_AOIS` limits the probes). */
export async function createAoiSwitcher(ctx: AppContext, panel: HTMLElement): Promise<void> {
  const current = ctx.manifest.aoi;
  const avail = await Promise.all(switchableAois(deployedAois()).map(async (a) => ((await manifestExists(a.id)) ? a : null)));
  const list = avail.filter((a): a is NonNullable<typeof a> => a !== null);
  if (!list.some((a) => a.id !== current)) return;

  const sec = createPanelSection(panel, 'aoi', 'Gebiet', false);
  sec.setCount(list.find((a) => a.id === current)?.name_de.split(' (')[0] ?? current);
  sec.body.innerHTML = `
    <div class="sle-row">
      <label title="Datensatz wechseln (lädt die Seite neu)">Gebiet
        <select class="sle-input" data-k="aoi" style="width:auto"></select></label>
    </div>
    <p class="sle-dim sle-small">Wechsel lädt die Seite neu. Das Gesamtgebiet enthält alle Schwerpunkte.</p>`;
  const sel = sec.body.querySelector<HTMLSelectElement>('[data-k=aoi]')!;
  const opts = list.slice();
  if (!opts.some((a) => a.id === current)) opts.unshift({ id: current, name_de: ctx.manifest.name || current, bbox: [0, 0, 0, 0], focus: false });
  for (const a of opts) {
    const o = document.createElement('option');
    o.value = a.id;
    o.textContent = a.name_de;
    sel.appendChild(o);
  }
  sel.value = current;
  sel.addEventListener('change', () => {
    const st = ctx.store.get();
    const { E, N } = st;
    // F20: don't carry a pose next to "Mein Standort" into the new URL.
    const keep = Number.isFinite(E) && (E || N) && !getLocate()?.revealsPosition(st);
    location.href = switchAoiHref(location, sel.value, keep ? { E, N } : null);
  });
}
