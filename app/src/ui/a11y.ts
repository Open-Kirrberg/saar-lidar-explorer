/**
 * Accessibility helpers (final polish).
 *
 * - Space/Enter on a focused button must activate the button only: the drone controller (Space =
 *   climb, with preventDefault) and other global handlers would otherwise swallow the activation.
 * - Icon-only buttons (✕, ⓘ, ▸ …) anywhere in the app get an `aria-label` from their `title`.
 *   A MutationObserver covers buttons added later by feature modules, without editing them.
 */

/** True when a button's visible text has no letters or digits (an icon/symbol button). */
export function isIconOnly(text: string): boolean {
  return !/[\p{L}\p{N}]/u.test(text);
}

/** Accessible name to add, or null when the button already has one / nothing to derive it from. */
export function derivedAriaLabel(b: { text: string; ariaLabel: string | null; labelledBy: string | null; title: string | null }): string | null {
  if (b.ariaLabel || b.labelledBy || !isIconOnly(b.text)) return null;
  const t = b.title?.trim();
  return t ? t : null;
}

const ACTIVATABLE = 'button, summary, [role="button"], [role="radio"], [role="tab"], a[href]';

function labelButtons(root: ParentNode): void {
  for (const el of root.querySelectorAll<HTMLElement>('button, [role="button"]')) {
    const label = derivedAriaLabel({
      text: el.textContent ?? '',
      ariaLabel: el.getAttribute('aria-label'),
      labelledBy: el.getAttribute('aria-labelledby'),
      title: el.getAttribute('title'),
    });
    if (label) el.setAttribute('aria-label', label);
  }
}

function safeMatches(el: Element, sel: string): boolean {
  try {
    return el.matches(sel);
  } catch {
    return true; // very old engines without :focus-visible: prefer working keyboard activation
  }
}

export function installA11y(root: HTMLElement = document.body): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.code !== 'Space' && e.code !== 'Enter' && e.code !== 'NumpadEnter') return;
    const t = e.target as HTMLElement | null;
    if (!t?.matches?.(ACTIVATABLE)) return;
    // Only for keyboard focus: after a mouse click the button keeps focus, and Space must still
    // climb (flight) rather than re-click it.
    if (!safeMatches(t, ':focus-visible')) return;
    // Let the browser activate the focused control; keep global shortcuts (fly up, finish
    // measurement …) from also reacting. No preventDefault: that would cancel the click.
    e.stopPropagation();
  };
  window.addEventListener('keydown', onKey, true);

  labelButtons(root);
  let queued = false;
  const mo = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      labelButtons(root);
    });
  });
  mo.observe(root, { childList: true, subtree: true });
  return () => {
    window.removeEventListener('keydown', onKey, true);
    mo.disconnect();
  };
}
