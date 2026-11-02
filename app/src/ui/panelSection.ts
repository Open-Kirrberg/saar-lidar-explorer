const UI_KEY = 'sle.ui.v1';

function readUi(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(UI_KEY) ?? '{}') as Record<string, boolean>;
  } catch {
    return {};
  }
}

function writeUi(patch: Record<string, boolean>): void {
  try {
    localStorage.setItem(UI_KEY, JSON.stringify({ ...readUi(), ...patch }));
  } catch {
    /* ignore */
  }
}

export interface PanelSection {
  root: HTMLElement;
  body: HTMLElement;
  setCount(n: number | string): void;
}

/** Collapsible card appended to #panel (below lil-gui), open state remembered per id. */
export function createPanelSection(panel: HTMLElement, id: string, title: string, openByDefault = false): PanelSection {
  const root = document.createElement('section');
  root.className = 'sle-card';
  root.id = `sle-${id}`;
  root.innerHTML = `
    <button type="button" class="sle-card-head" aria-expanded="false">
      <span class="sle-card-caret">▸</span><span class="sle-card-title"></span><span class="sle-card-count"></span>
    </button>
    <div class="sle-card-body"></div>`;
  root.querySelector('.sle-card-title')!.textContent = title;
  const head = root.querySelector<HTMLButtonElement>('.sle-card-head')!;
  const body = root.querySelector<HTMLElement>('.sle-card-body')!;
  const count = root.querySelector<HTMLElement>('.sle-card-count')!;
  const setOpen = (open: boolean, persist = true) => {
    root.classList.toggle('open', open);
    head.setAttribute('aria-expanded', String(open));
    root.querySelector('.sle-card-caret')!.textContent = open ? '▾' : '▸';
    if (persist) writeUi({ [id]: open });
  };
  setOpen(readUi()[id] ?? openByDefault, false);
  head.addEventListener('click', () => setOpen(!root.classList.contains('open')));
  panel.appendChild(root);
  return {
    root,
    body,
    setCount: (n) => (count.textContent = String(n)),
  };
}

/** Open a section programmatically (e.g. after placing a marker). */
export function openPanelSection(s: PanelSection): void {
  if (!s.root.classList.contains('open')) s.root.querySelector<HTMLButtonElement>('.sle-card-head')!.click();
}
