/**
 * Catalog mode (S2): a quiet HUD line while the camera is over a place without detailed 3D —
 * „Kirkel · noch kein Detail-3D · 🙋 Ortspate gesucht“ (link to Open-Kirrberg), or „3D im Aufbau“
 * for a 'building' place. The catalog `status` decides (contract "Catalog": it wins over stats).
 * `placeHintAt` is pure; `registerPlaceHint` mounts the 🟢 Standard feature `place-hint`.
 */
import type { Catalog } from '../data/catalog';
import { placeAt } from '../data/catalog';
import type { AppContext } from '../main';
import { ORTSPATE_URL } from '../places/placesData';
import { el } from '../shell/dom';

export interface PlaceHint {
  id: string;
  name: string;
  status: 'stats' | 'building';
}

/** The hint for ground point (E, N): the owning place when it is 'stats' or 'building', else null. */
export function placeHintAt(cat: Catalog, E: number, N: number): PlaceHint | null {
  if (!Number.isFinite(E) || !Number.isFinite(N)) return null;
  const p = placeAt(cat, E, N);
  if (!p || p.status === '3d') return null;
  return { id: p.id, name: p.name_de, status: p.status };
}

export function registerPlaceHint(ctx: AppContext): () => void {
  const cat = ctx.catalog;
  if (!cat) return () => {};
  return ctx.shell.registerFeature({
    id: 'place-hint',
    tier: 'standard',
    label: 'Hinweis: Ort ohne Detail-3D',
    mount(h) {
      const name = el('b', {});
      const what = el('span', {});
      const link = el('a', { class: 'sle-place-hint-link', href: ORTSPATE_URL, target: '_blank', rel: 'noopener noreferrer', title: 'Eigene Gemeinde in 3D bringen: Open-Kirrberg auf GitHub', text: '🙋 Ortspate gesucht' });
      const box = el('div', { class: 'sle-place-hint', role: 'status' }, name, what, link);
      box.hidden = true;
      h.hud.append(box);
      let last = '';
      const render = () => {
        const s = ctx.store.get();
        const hint = placeHintAt(cat.catalog, s.E, s.N);
        const key = hint ? `${hint.id}/${hint.status}` : '';
        if (key === last) return;
        last = key;
        box.hidden = !hint;
        if (!hint) return;
        name.textContent = hint.name;
        what.textContent = hint.status === 'stats' ? ' · noch kein Detail\u20113D ' : ' · 3D im Aufbau';
        link.hidden = hint.status !== 'stats';
      };
      const off = ctx.store.subscribe(render, ['E', 'N']);
      render();
      return () => {
        off();
        box.remove();
      };
    },
  });
}
