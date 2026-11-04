/** Small DOM helpers and inline icons for the shell (no framework). */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | undefined> = {},
  ...children: Array<Node | string | null | undefined>
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === 'class') e.className = String(v);
    else if (k === 'text') e.textContent = String(v);
    else if (k === 'html') e.innerHTML = String(v);
    else e.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined) e.append(c);
  return e;
}

export const escapeHtml = (t: string): string => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Insert `child` into `parent` keeping ascending `data-seq` order (re-attached wrappers keep their place). */
export function attachOrdered(parent: HTMLElement, child: HTMLElement): void {
  if (child.parentElement === parent) return;
  const seq = Number(child.dataset.seq ?? 0);
  const next = [...parent.children].find((c) => Number((c as HTMLElement).dataset.seq ?? 0) > seq) ?? null;
  parent.insertBefore(child, next);
}

const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICONS = {
  fly: svg('<path d="M2 16l20-8-8 12-2-6z"/>'),
  walk: svg('<circle cx="13" cy="4" r="2"/><path d="M10 22l2-7 3 3v4M9 12l2-4 4 2 2 3M11 8l-2 7"/>'),
  minus: svg('<path d="M5 12h14"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  places: svg('<path d="M12 22s7-7 7-12a7 7 0 10-14 0c0 5 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/>'),
  share: svg('<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>'),
  keys: svg('<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>'),
  settings: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>'),
  tools: svg('<path d="M14.7 6.3a4 4 0 00-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 005.4-5.4l-2.5 2.5-2.5-.5-.5-2.5z"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
};

export interface Toast {
  (text: string, warn?: boolean, ms?: number, selectable?: boolean): void;
}

/** One polite status line above the action bar. */
export function createToast(parent: HTMLElement): Toast {
  const t = el('div', { class: 'sle-toast sle-shell-toast', role: 'status', 'aria-live': 'polite' });
  t.hidden = true;
  parent.appendChild(t);
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (text, warn = false, ms = 2600, selectable = false) => {
    t.textContent = text;
    t.classList.toggle('warn', warn);
    t.classList.toggle('selectable', selectable);
    t.hidden = false;
    clearTimeout(timer);
    timer = setTimeout(() => (t.hidden = true), ms);
  };
}

/** Pointer and viewport facts for layout and quality defaults (F20). */
export function deviceEnv(): { coarse: boolean; width: number; height: number } {
  let coarse = false;
  try {
    coarse = window.matchMedia('(pointer: coarse)').matches;
  } catch {
    /* old browsers */
  }
  return { coarse, width: window.innerWidth, height: window.innerHeight };
}
