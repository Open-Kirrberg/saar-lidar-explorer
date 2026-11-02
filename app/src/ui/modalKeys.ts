/**
 * Keyboard isolation for modal overlays (disclaimer, intro): while open, no key reaches the app's
 * global shortcuts (WASD flight, M, digits, X/G/O/F/C/P, H …), Tab focus stays inside the dialog,
 * and the dialog's own keys (Escape/Enter) are handled first. Default actions of keys on the
 * dialog's own controls (Space on the checkbox, Enter on a button) still happen.
 *
 * All global shortcuts listen on `window` (bubble phase, a11y/tour in capture) — a document
 * capture listener that stops propagation runs before every one of those except window-capture
 * ones, which check `modalOpen()` themselves (TourGuide).
 */

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select, textarea, a[href], summary, [tabindex]:not([tabindex="-1"])';

/** Index to focus on Tab inside a focus trap of `count` elements (`current` −1 = focus outside). */
export function trapIndex(count: number, current: number, shift: boolean): number {
  if (count <= 0) return -1;
  if (current < 0) return shift ? count - 1 : 0;
  return shift ? (current - 1 + count) % count : (current + 1) % count;
}

/** Selector of the app's open blocking dialogs/forms (the tour must not steal their Escape). */
export const MODAL_SELECTOR = '#sle-disclaimer, .sle-overlay, #sle-report, .sle-form';

/** Is a blocking dialog or form open (or the key event's target inside one)? */
export function modalOpen(target?: EventTarget | null): boolean {
  const t = target as Element | null | undefined;
  return !!document.querySelector(MODAL_SELECTOR) || !!t?.closest?.(MODAL_SELECTOR);
}

/**
 * Install the isolation for `dialog`. `onKey` handles the dialog's own keys and returns true when
 * it consumed one (then default + propagation are stopped). Returns the uninstall function.
 */
export function isolateModalKeys(dialog: HTMLElement, onKey: (e: KeyboardEvent) => boolean): () => void {
  const handler = (e: KeyboardEvent) => {
    if (!dialog.isConnected) return;
    if (onKey(e)) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    e.stopPropagation(); // never reach global shortcuts while the dialog is open
    if (e.key !== 'Tab') return;
    const els = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
    const next = trapIndex(els.length, els.indexOf(document.activeElement as HTMLElement), e.shiftKey);
    if (next < 0) return;
    e.preventDefault();
    els[next].focus();
  };
  document.addEventListener('keydown', handler, true);
  return () => document.removeEventListener('keydown', handler, true);
}
