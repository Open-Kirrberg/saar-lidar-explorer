/**
 * F20 bottom sheet: a panel that slides up above the mobile bottom bar. Drag handle + header
 * swipe down to close (`swipeCloses`), Esc closes, max 70 % of the viewport (CSS), safe-area
 * insets. The body scrolls on its own; only the header/handle starts a swipe so map panning and
 * list scrolling inside the sheet keep working.
 */
import { swipeCloses } from './mobileMode';

export interface SheetOptions {
  id: string;
  title: string;
  /** Extra buttons placed in the header before the close button. */
  actions?: HTMLElement[];
  onClose?: () => void;
}

export class BottomSheet {
  readonly root: HTMLElement;
  readonly body: HTMLElement;
  private readonly onClose?: () => void;

  constructor(parent: HTMLElement, o: SheetOptions) {
    this.onClose = o.onClose;
    const root = document.createElement('section');
    root.id = o.id;
    root.className = 'sle-sheet';
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'false');
    root.setAttribute('aria-labelledby', `${o.id}-title`);
    root.innerHTML = `
      <div class="sle-sheet-head">
        <div class="sle-sheet-handle" aria-hidden="true"></div>
        <div class="sle-sheet-titlebar">
          <h2 class="sle-sheet-title" id="${o.id}-title"></h2>
          <span class="sle-sheet-actions"></span>
          <button type="button" class="sle-sheet-close" aria-label="Schließen">✕</button>
        </div>
      </div>
      <div class="sle-sheet-body"></div>`;
    root.querySelector('.sle-sheet-title')!.textContent = o.title;
    const actions = root.querySelector<HTMLElement>('.sle-sheet-actions')!;
    for (const a of o.actions ?? []) actions.appendChild(a);
    this.root = root;
    this.body = root.querySelector<HTMLElement>('.sle-sheet-body')!;
    root.querySelector('.sle-sheet-close')!.addEventListener('click', () => this.close());
    root.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      this.close();
    });
    this.bindSwipe(root.querySelector<HTMLElement>('.sle-sheet-head')!);
    parent.appendChild(root);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(): void {
    if (this.isOpen) return;
    this.root.style.transform = '';
    this.root.hidden = false;
    this.root.classList.remove('closing');
  }

  /** Close (no-op when closed). `silent` skips the onClose callback (state already updated). */
  close(silent = false): void {
    if (!this.isOpen) return;
    this.root.hidden = true;
    this.root.style.transform = '';
    if (!silent) this.onClose?.();
  }

  private bindSwipe(head: HTMLElement): void {
    let drag: { id: number; y0: number; t0: number; dy: number } | null = null;
    head.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('button, input, select, a')) return;
      drag = { id: e.pointerId, y0: e.clientY, t0: performance.now(), dy: 0 };
      head.setPointerCapture(e.pointerId);
      this.root.classList.add('dragging');
    });
    head.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      drag.dy = Math.max(0, e.clientY - drag.y0);
      this.root.style.transform = `translateY(${drag.dy}px)`;
    });
    const end = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag;
      drag = null;
      if (head.hasPointerCapture(e.pointerId)) head.releasePointerCapture(e.pointerId);
      this.root.classList.remove('dragging');
      const close = e.type === 'pointerup' && swipeCloses(d.dy, performance.now() - d.t0, this.root.getBoundingClientRect().height);
      if (close) this.close();
      else this.root.style.transform = '';
    };
    head.addEventListener('pointerup', end);
    head.addEventListener('pointercancel', end);
  }
}
