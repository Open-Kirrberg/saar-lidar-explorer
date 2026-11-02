/**
 * First-run introduction (final polish): flight keys, the most important toggles and the full
 * shortcut table. Dismissible ("Los geht's", Esc, click outside), "nicht mehr zeigen" persists in
 * the settings; reopened with `?` or the help button. Not modal: focus moves in, isn't trapped.
 */
import { availableShortcuts, shortcutsHtml } from './shortcuts';
import type { ShortcutFeature } from './shortcuts';
import { isolateModalKeys } from './modalKeys';
import { touchHelpHtml } from './mobileMode';

export interface IntroOptions {
  hasFeature: (f: ShortcutFeature) => boolean;
  /** Current "nicht mehr zeigen" state. */
  seen: boolean;
  onClose: (dontShowAgain: boolean) => void;
  /** Present when a tour exists for this AOI. */
  startTour?: () => void;
  /** F20: touch variant (gestures + bottom bar instead of keys). */
  touch?: boolean;
}

const ID = 'sle-intro';

export function isIntroOpen(): boolean {
  return !!document.getElementById(ID);
}

export function closeIntro(): void {
  document.getElementById(ID)?.dispatchEvent(new Event('sle:close'));
}

export function showIntro(o: IntroOptions): void {
  if (isIntroOpen()) return;
  const prevFocus = document.activeElement as HTMLElement | null;
  const has = o.hasFeature;
  const layerKeys = (['osm', 'parcels', 'buildings', 'pointclouds', 'candidates', 'reconstruction'] as const)
    .filter(has)
    .map((f) => ({ osm: '<kbd>O</kbd> Wege', parcels: '<kbd>F</kbd> Flurstücke', buildings: '<kbd>G</kbd> Gebäude', pointclouds: '<kbd>C</kbd> Punktwolke', candidates: '<kbd>X</kbd> Verdachtsflächen', reconstruction: '<kbd>R</kbd> Rekonstruktion 1789' })[f]);

  const wrap = document.createElement('div');
  wrap.id = ID;
  wrap.className = 'sle-overlay';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  wrap.setAttribute('aria-labelledby', 'sle-intro-title');
  wrap.innerHTML = `
    <div class="sle-modal sle-intro${o.touch ? ' sle-intro-touch' : ''}">
      <h2 id="sle-intro-title">Willkommen im Saar LiDAR Explorer</h2>
      <p>Fliegen Sie wie mit einer Drohne über das Gelände – der Laserscan 2025 zeigt den Boden
      <em>unter</em> dem Wald. Mauern, Gräben, Gruben und Hügel, die Sie entdecken, sind
      <strong>Hypothesen</strong>: schauen, nicht graben.</p>
      ${o.touch ? touchCols() : `<div class="sle-intro-cols">
        <div>
          <h3>Fliegen</h3>
          <ul class="sle-intro-list">
            <li><kbd>Klick</kbd> ins Bild fängt die Maus, <kbd>Esc</kbd> gibt sie frei</li>
            <li><kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> oder Pfeile: fliegen</li>
            <li><kbd>Leertaste</kbd>/<kbd>E</kbd> steigen · <kbd>Umschalt</kbd>/<kbd>Q</kbd> sinken</li>
            <li><kbd>Mausrad</kbd> oder <kbd>+</kbd>/<kbd>−</kbd>: Tempo</li>
          </ul>
        </div>
        <div>
          <h3>Wichtigste Schalter</h3>
          <ul class="sle-intro-list">
            <li><kbd>1</kbd>–<kbd>9</kbd> Reliefdarstellung, <kbd>Umschalt</kbd>+<kbd>1</kbd> „Relikte suchen“</li>
            <li><kbd>V</kbd> Wald ein/aus · <kbd>B</kbd> Überlagerung · <kbd>K</kbd> Kontrast</li>
            ${layerKeys.length ? `<li>${layerKeys.join(' · ')}</li>` : ''}
            <li><kbd>M</kbd> Fundmarker · <kbd>L</kbd> Messen · <kbd>?</kbd> diese Hilfe</li>
          </ul>
        </div>
      </div>
      <details class="sle-intro-all">
        <summary>Alle Tastenkürzel</summary>
        <div class="sle-keys">${shortcutsHtml(availableShortcuts(has), { headings: true })}</div>
      </details>`}
      <div class="sle-actions">
        <label><input type="checkbox" data-k="seen"> nicht mehr zeigen</label>
        <span class="sle-spacer"></span>
        ${o.startTour ? '<button type="button" class="sle-btn" data-act="tour">Tour starten</button>' : ''}
        <button type="button" class="primary" data-act="ok">Los geht’s</button>
      </div>
    </div>`;
  const cb = wrap.querySelector<HTMLInputElement>('[data-k=seen]')!;
  cb.checked = o.seen;

  const close = (then?: () => void) => {
    uninstallKeys();
    wrap.remove();
    o.onClose(cb.checked);
    if (then) then();
    else if (prevFocus?.isConnected) prevFocus.focus({ preventScroll: true });
  };
  // Esc closes; other keys stay inside the overlay (no shortcuts behind it), Tab is trapped.
  const uninstallKeys = isolateModalKeys(wrap, (e) => {
    if (e.key !== 'Escape') return false;
    close();
    return true;
  });
  wrap.addEventListener('sle:close', () => close());
  wrap.querySelector('[data-act=ok]')!.addEventListener('click', () => close());
  wrap.querySelector('[data-act=tour]')?.addEventListener('click', () => close(o.startTour));
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap) close();
  });
  (document.querySelector('#app') ?? document.body).appendChild(wrap);
  wrap.querySelector<HTMLButtonElement>('[data-act=ok]')!.focus();
}

/** Touch variant of the two columns (F20): gestures + what the bottom-bar buttons do. */
function touchCols(): string {
  return `<div class="sle-intro-cols">
        <div>
          <h3>Gesten</h3>
          <ul class="sle-intro-list sle-touch-list">${touchHelpHtml(undefined, 'li')}</ul>
        </div>
        <div>
          <h3>Unten in der Leiste</h3>
          <ul class="sle-intro-list">
            <li><b>Standort</b> – zu Ihrer Position fliegen (wenn im Gebiet)</li>
            <li><b>Relief</b> – Darstellung wechseln: VAT, Lokales Relief, Luftbild, Karte 1840</li>
            <li><b>Ebenen</b> – Wald, Wege, Flurstücke, Gebäude, Verdachtsflächen</li>
            <li><b>Karte</b> – Übersichtskarte; antippen fliegt dorthin</li>
            <li><b>Mehr</b> – alle Einstellungen, Orte, Fundmarker, Messen</li>
          </ul>
        </div>
      </div>`;
}
