/**
 * Roomy modal dialog for the shell (keybinds, settings, share, „Quellen und Lizenzen“): labelled
 * (role=dialog, aria-modal), focus trapped, Esc closes, focus returns to the opener. On phones it
 * fills the screen. Uses the v1 `isolateModalKeys` so no flight key fires behind it, and the
 * `.sle-overlay` class so `modalOpen()` (tour, markers) sees it.
 */
import { el } from './dom';
import { ICONS } from './dom';
import { isolateModalKeys } from '../ui/modalKeys';

export interface DialogOptions {
  /** DOM id of the overlay (one dialog per id; opening again closes the old one). */
  id: string;
  title: string;
  body: HTMLElement | DocumentFragment;
  /** Wider layout (keybind dialog). */
  wide?: boolean;
  onClose?: () => void;
}

export interface DialogHandle {
  root: HTMLElement;
  close(): void;
}

let openCount = 0;

export function isDialogOpen(id?: string): boolean {
  return id ? !!document.getElementById(id) : openCount > 0;
}

export function openDialog(o: DialogOptions): DialogHandle {
  document.getElementById(o.id)?.dispatchEvent(new Event('sle:close'));
  const opener = document.activeElement as HTMLElement | null;
  const titleId = `${o.id}-title`;
  const closeBtn = el('button', { type: 'button', class: 'sle-dlg-close', 'aria-label': 'Schließen', title: 'Schließen (Esc)', html: ICONS.close });
  const panel = el(
    'div',
    { class: `sle-dlg${o.wide ? ' wide' : ''}` },
    el('header', { class: 'sle-dlg-head' }, el('h2', { id: titleId, text: o.title }), closeBtn),
    el('div', { class: 'sle-dlg-body' }, o.body),
  );
  const root = el('div', { id: o.id, class: 'sle-overlay sle-dlg-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId }, panel);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    openCount--;
    uninstall();
    root.remove();
    o.onClose?.();
    if (opener?.isConnected) opener.focus({ preventScroll: true });
  };
  const uninstall = isolateModalKeys(root, (e) => {
    if (e.key !== 'Escape') return false;
    close();
    return true;
  });
  closeBtn.addEventListener('click', close);
  root.addEventListener('click', (e) => {
    if (e.target === root) close();
  });
  root.addEventListener('sle:close', close);
  openCount++;
  (document.querySelector('#app') ?? document.body).appendChild(root);
  // First focusable inside the body, else the close button.
  const first = panel.querySelector<HTMLElement>('.sle-dlg-body button, .sle-dlg-body input, .sle-dlg-body a[href], .sle-dlg-body select');
  (first ?? closeBtn).focus({ preventScroll: true });
  return { root, close };
}
