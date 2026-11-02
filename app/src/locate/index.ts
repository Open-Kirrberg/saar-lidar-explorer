/**
 * F20 "Mein Standort" entry point: creates the locate controller (see Locate.ts) and the desktop
 * panel card. Mobile UIs call `getLocate()` (or use the returned API) and render their own button.
 */
import type { AppContext } from '../main';
import type { Minimap } from '../map/Minimap';
import type { Labels3D } from '../ui/Labels3D';
import { createPanelSection } from '../ui/panelSection';
import { createLocate } from './Locate';
import type { LocateApi, LocateState } from './Locate';
import './locate.css';

export { createLocate, getLocate } from './Locate';
export type { CompassStatus, LocateApi, LocateState, LocateStatus } from './Locate';

/** Tooltip/privacy text shared by every "Mein Standort" button. */
export const LOCATE_PRIVACY_DE =
  'Zeigt Ihren Standort (GPS/WLAN des Geräts). Datenschutz: Die Position bleibt nur im Arbeitsspeicher dieses Tabs – ' +
  'sie wird nicht gespeichert, nicht in die Adresse oder eine Meldung geschrieben und nirgendwohin gesendet. ' +
  'Auch die Kameraposition in der Adresse bzw. „Ansicht teilen“ ruht, solange die Ansicht näher als 1 km daran ist.';

export function initLocate(ctx: AppContext, panel: HTMLElement, deps: { minimap?: Minimap | null; labels: Labels3D }): LocateApi {
  const api = createLocate(ctx, deps);
  createLocatePanel(panel, api);
  return api;
}

function createLocatePanel(panel: HTMLElement, api: LocateApi): void {
  const sec = createPanelSection(panel, 'locate', 'Mein Standort', false);
  sec.body.innerHTML = `
    <div class="sle-row">
      <button type="button" class="sle-btn" data-act="locate">Mein Standort</button>
      <label title="Position laufend aktualisieren; die Kamera fliegt mit"><input type="checkbox" data-k="follow"> Folgen</label>
      <button type="button" class="sle-btn" data-act="compass" title="Blickrichtung des Handys als Pfeil zeigen (Kompass)">Kompass</button>
    </div>
    <p class="sle-small sle-loc-status" data-k="status" role="status" aria-live="polite"></p>
    <div class="sle-row" data-k="actions" hidden>
      <button type="button" class="sle-btn" data-act="nearest">Zum nächsten Punkt im Gebiet</button>
      <button type="button" class="sle-btn" data-act="clear" title="Standort ausblenden und vergessen">Ausblenden</button>
    </div>
    <p class="sle-dim sle-small">Bleibt privat: nicht gespeichert, nicht gesendet. Am Handy nur über HTTPS
      (<code>pnpm run dev:lan</code>). Solange die Ansicht näher als 1 km an Ihrem Standort ist, bleibt die Adresse
      unverändert und „Ansicht teilen“ ist gesperrt.</p>`;
  const q = <T extends HTMLElement>(sel: string) => sec.body.querySelector<T>(sel)!;
  const locateBtn = q<HTMLButtonElement>('[data-act=locate]');
  const follow = q<HTMLInputElement>('[data-k=follow]');
  const compass = q<HTMLButtonElement>('[data-act=compass]');
  const status = q<HTMLElement>('[data-k=status]');
  const actions = q<HTMLElement>('[data-k=actions]');
  const nearest = q<HTMLButtonElement>('[data-act=nearest]');
  locateBtn.title = LOCATE_PRIVACY_DE;

  locateBtn.addEventListener('click', () => void api.locateMe());
  follow.addEventListener('change', () => {
    follow.checked = api.toggleFollow(follow.checked);
  });
  compass.addEventListener('click', () => void api.toggleCompass());
  nearest.addEventListener('click', () => void api.flyToNearest());
  q<HTMLButtonElement>('[data-act=clear]').addEventListener('click', () => api.clear());

  const COMPASS_TEXT: Record<LocateState['compass'], string> = {
    off: '',
    waiting: 'Kompass: warte auf Sensor …',
    on: 'Kompass an (Pfeil = Blickrichtung des Handys, magnetisch ± einige Grad).',
    unavailable: 'Kein Kompass verfügbar (Gerät ohne Sensor oder Browser liefert keine Nordrichtung).',
    denied: 'Kompass-Zugriff abgelehnt.',
  };
  api.onState((s) => {
    locateBtn.disabled = s.status === 'locating';
    locateBtn.classList.toggle('on', s.status === 'inside');
    follow.checked = s.follow;
    compass.hidden = !s.compassSupported;
    compass.classList.toggle('on', s.compass === 'on' || s.compass === 'waiting');
    status.textContent = [s.message, COMPASS_TEXT[s.compass]].filter(Boolean).join(' ');
    status.classList.toggle('error', s.status === 'error');
    actions.hidden = s.status !== 'inside' && s.status !== 'outside';
    nearest.hidden = s.status !== 'outside';
    sec.setCount(s.status === 'inside' ? 'im Gebiet' : s.status === 'outside' ? 'außerhalb' : '');
  });
}
