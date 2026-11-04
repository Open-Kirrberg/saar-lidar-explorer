/**
 * ADR 0026: load splash (short source lines + „Schauen, nicht graben“) that collapses after 8 s
 * into the always-visible „© Quellen“ button, and the „Quellen und Lizenzen“ dialog.
 */
import { REPO_URL } from '../ui/aboutText';
import { showDisclaimer } from '../ui/disclaimer';
import { createCollapseTimer, sourceRows, splashLines } from './attribution';
import type { CollapseTimer, SourceRow } from './attribution';
import { openDialog } from './dialog';
import { ICONS, el } from './dom';

export interface SourcesUi {
  /** The „© Quellen“ button (never removed; tutorial anchor `sources`). */
  button: HTMLButtonElement;
  open(): void;
  timer: CollapseTimer;
}

const link = (l: { label: string; url: string }) => el('a', { href: l.url, target: '_blank', rel: 'noopener', text: l.label });

function rowEl(r: SourceRow): HTMLElement {
  const dl = el('dl', { class: 'sle-src-meta' });
  const add = (k: string, v: Node | string | null) => {
    if (!v) return;
    dl.append(el('dt', { text: k }), el('dd', {}, v));
  };
  add('Quellenvermerk', r.full);
  add('Lizenz', r.licence ? link(r.licence) : null);
  add('Datensatz', r.dataset ? link(r.dataset) : null);
  add('Verwendung', r.use || null);
  if (r.modified) add('Bearbeitung', 'Daten bearbeitet (umgerechnet, gekachelt, schattiert)');
  return el('li', { class: 'sle-src-row' }, el('h3', { text: r.provider }), dl);
}

export function createSources(opts: {
  /** Where the splash and the button live (the 3D view's UI layer). */
  parent: HTMLElement;
  attribution: string;
  /** Extra line in the dialog head (AOI name, fixture fallback). */
  areaNote: string;
  /** Element whose pointer/keyboard input counts as map interaction (the canvas). */
  interactionTarget: HTMLElement;
}): SourcesUi {
  const rows = sourceRows(opts.attribution);

  const open = () => {
    const body = el(
      'div',
      { class: 'sle-src' },
      el('p', { class: 'sle-dim', text: opts.areaNote }),
      el('ul', { class: 'sle-src-list' }, ...rows.map(rowEl)),
      el(
        'p',
        { class: 'sle-small' },
        'Weiterverwendung: Daten unter den genannten Lizenzen mit Quellenvermerk; App-Code MIT. Details: ',
        link({ label: 'NOTICE.md', url: `${REPO_URL}/blob/main/NOTICE.md` }),
        '.',
      ),
    );
    const hint = el('button', { type: 'button', class: 'sle-btn', text: 'Schauen, nicht graben – Hinweise lesen' });
    hint.addEventListener('click', () => {
      dlg.close();
      showDisclaimer(true);
    });
    body.append(el('p', {}, hint));
    const dlg = openDialog({ id: 'sle-sources', title: 'Quellen und Lizenzen', body, wide: true });
  };

  // ---- „© Quellen“ button (ADR 0026 rule 3: always visible, ≥ 44 px) --------------------------------
  const button = el('button', {
    type: 'button',
    class: 'sle-sources-btn',
    'data-shell-anchor': 'sources',
    title: 'Quellen und Lizenzen',
    'aria-haspopup': 'dialog',
    text: '© Quellen',
  });
  button.addEventListener('click', open);

  // ---- splash (rule 1–2) ------------------------------------------------------------------------
  const lines = splashLines(rows);
  const more = el('button', { type: 'button', class: 'sle-link', text: 'Alle Quellen' });
  more.addEventListener('click', open);
  const hints = el('button', { type: 'button', class: 'sle-link', text: 'Hinweise' });
  hints.addEventListener('click', () => showDisclaimer(true));
  const x = el('button', { type: 'button', class: 'sle-splash-x', 'aria-label': 'Hinweis schließen', title: 'Schließen', html: ICONS.close });
  const splash = el(
    'section',
    { class: 'sle-splash', 'aria-label': 'Hinweis und Quellen', role: 'note' },
    el(
      'div',
      { class: 'sle-splash-text' },
      el('strong', { text: 'Schauen, nicht graben. ' }),
      'Alles Hervorgehobene sind Hypothesen aus Geländedaten; Bodendenkmäler sind gesetzlich geschützt. ',
      hints,
      el('div', { class: 'sle-splash-src' }, `Daten: ${lines.join(' · ')} · `, more),
    ),
    x,
  );
  opts.parent.append(splash, button);

  const timer = createCollapseTimer(
    () => {
      splash.classList.add('out');
      // Keep focus sensible if it was inside the splash.
      if (splash.contains(document.activeElement)) button.focus({ preventScroll: true });
      setTimeout(() => splash.remove(), 250);
    },
    { now: () => performance.now(), setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (id) => clearTimeout(id as number) },
  );
  x.addEventListener('click', () => timer.dismiss());
  const onInteract = () => {
    if (timer.interact()) off();
  };
  const t = opts.interactionTarget;
  const off = () => {
    t.removeEventListener('pointerdown', onInteract);
    t.removeEventListener('wheel', onInteract);
    window.removeEventListener('keydown', onInteract);
  };
  t.addEventListener('pointerdown', onInteract);
  t.addEventListener('wheel', onInteract, { passive: true });
  window.addEventListener('keydown', onInteract);

  return { button, open, timer };
}
