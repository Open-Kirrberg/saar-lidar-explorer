/**
 * Shell dialogs: „Steuerung“ (keybinds + gestures, replaces the removed 23-line HUD list),
 * „Einstellungen“ (tier, feature settings slot, help, reset) and „Teilen“ (link + QR).
 */
import { getLocate } from '../locate';
import type { AppContext } from '../main';
import { openQrDialog } from '../share/QrDialog';
import { formatHash, shareUrl } from '../state';
import { openAbout } from '../ui/about';
import { copyText } from '../ui/clipboard';
import { showDisclaimer } from '../ui/disclaimer';
import { TOUCH_GESTURES } from '../ui/mobileMode';
import { SHORTCUT_GROUPS, visibleShortcuts } from '../ui/shortcuts';
import type { Shortcut } from '../ui/shortcuts';
import { openDialog } from './dialog';
import { el } from './dom';
import type { Toast } from './dom';
import { TIERS, TIER_HINTS, TIER_LABELS } from './tiers';
import type { Tier } from './tiers';

// ---- Steuerung --------------------------------------------------------------------------------------

export function openKeysDialog(
  isMounted: (id: string) => boolean,
  extra: readonly Shortcut[],
  touch: boolean,
  /** V2.9: restart the first-flight tutorial (button above the lists). */
  tutorial: (() => void) | null = null,
): void {
  const rows = visibleShortcuts(isMounted, extra);
  const cols = el('div', { class: 'sle-keys-cols' });
  const group = (title: string, items: Array<{ caps: string[]; label: string }>) => {
    if (!items.length) return;
    const list = el('ul', { class: 'sle-keys-list' });
    for (const it of items) {
      const caps = el('span', { class: 'sle-keys-caps' });
      it.caps.forEach((c, i) => {
        if (i) caps.append(' ');
        caps.append(el('kbd', { text: c }));
      });
      list.append(el('li', {}, caps, el('span', { class: 'sle-keys-label', text: it.label })));
    }
    cols.append(el('section', { class: 'sle-keys-group' }, el('h3', { text: title }), list));
  };
  const gestures = () => group('Gesten (Touch)', TOUCH_GESTURES.map((g) => ({ caps: [g.gesture], label: g.label })));
  if (touch) gestures();
  for (const g of SHORTCUT_GROUPS) group(g, rows.filter((r) => r.group === g).map((r) => ({ caps: r.keys, label: r.label })));
  if (!touch) gestures();
  const body = el(
    'div',
    {},
    el('p', { class: 'sle-dim', text: 'Was gerade verfügbar ist. Mehr Werkzeuge gibt es in den Stufen Entdecker und Labor (Einstellungen).' }),
    cols,
  );
  if (tutorial) {
    const b = el('button', { type: 'button', class: 'sle-btn', 'data-tut': 'restart', text: 'Einführung starten' });
    b.addEventListener('click', () => {
      dlg.close();
      tutorial();
    });
    body.prepend(el('p', { class: 'sle-row' }, b, el('span', { class: 'sle-dim sle-small', text: 'Fünf Schritte bis zum Schloss.' })));
  }
  const dlg = openDialog({ id: 'sle-keys', title: 'Steuerung', body, wide: true });
}

// ---- Einstellungen ------------------------------------------------------------------------------------

export interface SettingsDialogDeps {
  tier(): Tier;
  setTier(t: Tier): void;
  /** Feature settings (host.settings wrappers), moved into the dialog while it is open. */
  featureSlot: HTMLElement;
  openKeys(): void;
  openSources(): void;
  /** Two-step reset (clears preferences, keeps markers/reviews), then reload. */
  reset(): void;
}

export function openSettingsDialog(d: SettingsDialogDeps): void {
  const body = el('div', { class: 'sle-settings' });

  // Tier: radio group with descriptions.
  const tierGroup = el('div', { class: 'sle-tier-group', role: 'radiogroup', 'aria-labelledby': 'sle-tier-label' });
  const radios: HTMLInputElement[] = [];
  for (const t of TIERS) {
    const input = el('input', { type: 'radio', name: 'sle-tier', value: t, id: `sle-tier-${t}` }) as HTMLInputElement;
    input.checked = d.tier() === t;
    input.addEventListener('change', () => {
      if (input.checked) d.setTier(t);
    });
    radios.push(input);
    tierGroup.append(
      el(
        'label',
        { class: 'sle-tier', for: `sle-tier-${t}` },
        input,
        el('span', { class: 'sle-tier-name', text: TIER_LABELS[t] }),
        el('span', { class: 'sle-tier-hint', text: TIER_HINTS[t] }),
      ),
    );
  }
  body.append(el('h3', { id: 'sle-tier-label', text: 'Stufe' }), tierGroup);

  // Feature settings (quality, exaggeration … from Entdecker on).
  body.append(d.featureSlot);

  // Help + legal.
  const btn = (text: string, fn: () => void) => {
    const b = el('button', { type: 'button', class: 'sle-btn', text });
    b.addEventListener('click', fn);
    return b;
  };
  const reset = el('button', { type: 'button', class: 'sle-btn', text: 'Einstellungen zurücksetzen' });
  let armed: ReturnType<typeof setTimeout> | undefined;
  reset.addEventListener('click', () => {
    if (!armed) {
      reset.textContent = 'Wirklich zurücksetzen? Nochmal klicken';
      reset.classList.add('danger');
      armed = setTimeout(() => {
        armed = undefined;
        reset.textContent = 'Einstellungen zurücksetzen';
        reset.classList.remove('danger');
      }, 4000);
      return;
    }
    d.reset();
  });
  body.append(
    el('h3', { text: 'Hilfe und Hinweise' }),
    el(
      'div',
      { class: 'sle-btn-grid' },
      btn('Steuerung', () => {
        dlg.close();
        d.openKeys();
      }),
      btn('Schauen, nicht graben', () => {
        dlg.close();
        showDisclaimer(true);
      }),
      btn('Quellen und Lizenzen', () => {
        dlg.close();
        d.openSources();
      }),
      btn('Über & Datenschutz', () => {
        dlg.close();
        openAbout();
      }),
      reset,
    ),
    el('p', {
      class: 'sle-dim sle-small',
      text: 'Gespeichert werden nur Einstellungen in diesem Browser. Fundmarker, Bewertungen und Messungen bleiben beim Zurücksetzen erhalten und sind nie Teil eines geteilten Links.',
    }),
  );
  const dlg = openDialog({
    id: 'sle-settings',
    title: 'Einstellungen',
    body,
    onClose: () => {
      d.featureSlot.remove();
      clearTimeout(armed);
    },
  });
}

// ---- Teilen ---------------------------------------------------------------------------------------------

export function openShareDialog(ctx: AppContext, toast: Toast): void {
  const { store } = ctx;
  const revealsPosition = () => getLocate()?.revealsPosition(store.get()) ?? false;
  const field = el('input', { type: 'text', class: 'sle-input', readonly: true, 'aria-label': 'Link zu dieser Ansicht' }) as HTMLInputElement;
  const refresh = () => (field.value = revealsPosition() ? '' : shareUrl(location, store.get()));
  refresh();
  const copy = el('button', { type: 'button', class: 'sle-btn primary', text: 'Link kopieren' });
  const qr = el('button', { type: 'button', class: 'sle-btn', text: 'QR-Code zur Website' });
  copy.addEventListener('click', async () => {
    if (revealsPosition()) {
      toast('Ansicht teilen ist gesperrt, solange die Ansicht Ihren Standort verrät. Erst über 1 km wegfliegen.', true, 6000);
      return;
    }
    refresh();
    try {
      history.replaceState(null, '', formatHash(store.get())); // address bar matches what was copied
    } catch {
      /* ignore */
    }
    if (await copyText(field.value)) {
      dlg.close();
      toast('Link kopiert – Position, Ansicht, Überhöhung und Sonne. Ohne Fundmarker und Verdachtsflächen.');
    } else {
      field.select();
      toast('Kopieren nicht möglich – bitte den Link oben markieren und kopieren.', true, 6000);
    }
  });
  qr.addEventListener('click', () => {
    dlg.close();
    openQrDialog({ store, revealsPosition });
  });
  field.addEventListener('focus', () => field.select());
  const body = el(
    'div',
    { class: 'sle-share' },
    el('p', { text: 'Link zu genau dieser Ansicht (Position, Blickrichtung, Darstellung). Fundmarker und Verdachtsflächen sind nie enthalten.' }),
    field,
    el('div', { class: 'sle-actions' }, copy, qr),
  );
  const dlg = openDialog({ id: 'sle-share', title: 'Teilen', body });
}
