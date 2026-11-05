/**
 * Built twins (ADR 0042): the zone HUD for clickable objects — info card, „entdeckt x / y“ counter, the small
 * „Neu entdeckt“ confirmation, a name tip next to the pointer and the crosshair under pointer lock.
 * German UI (du-form), plain DOM, text only (`textContent`, never HTML from the package). Styles: zones.css.
 */
import type { CardData } from '../catalogue';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

export interface TwinUiOptions {
  /** Show the counter (the catalogue has discoverable things). */
  counter: boolean;
  onClose(): void;
  onReset(): void;
}

export class TwinUi {
  readonly root: HTMLElement;
  private readonly card: HTMLElement;
  private readonly chip: HTMLElement;
  private readonly title: HTMLElement;
  private readonly text: HTMLElement;
  private readonly price: HTMLElement;
  private readonly priceVal: HTMLElement;
  private readonly priceUnit: HTMLElement;
  private readonly fresh: HTMLElement;
  private readonly counterBox: HTMLElement;
  private readonly counterText: HTMLElement;
  private readonly resetBtn: HTMLButtonElement;
  private readonly toastBox: HTMLElement;
  private readonly tip: HTMLElement;
  private readonly cross: HTMLElement;
  private readonly crossLabel: HTMLElement;
  private toastTimer = 0;
  private resetTimer = 0;
  private openKey: string | null = null;

  constructor(container: HTMLElement, private readonly opts: TwinUiOptions) {
    this.root = el('div', 'sle-twin-ui');
    // card
    this.card = el('section', 'sle-twin-card');
    this.card.hidden = true;
    this.card.setAttribute('role', 'dialog');
    this.card.setAttribute('aria-modal', 'false');
    this.card.setAttribute('aria-labelledby', 'sle-twin-card-title');
    const x = el('button', 'sle-twin-card-x', '×');
    x.type = 'button';
    x.setAttribute('aria-label', 'Karte schließen');
    x.title = 'Schließen (Esc)';
    x.addEventListener('click', () => this.opts.onClose());
    this.chip = el('span', 'sle-twin-chip');
    this.title = el('h2', 'sle-twin-card-title');
    this.title.id = 'sle-twin-card-title';
    this.text = el('p', 'sle-twin-card-text');
    this.price = el('p', 'sle-twin-price');
    this.priceVal = el('strong', 'sle-twin-price-val');
    this.priceUnit = el('span', 'sle-twin-price-unit');
    this.price.append(this.priceVal, ' ', this.priceUnit);
    this.fresh = el('p', 'sle-twin-fresh', 'Neu entdeckt!');
    const head = el('div', 'sle-twin-card-head');
    head.append(this.chip, x);
    this.card.append(head, this.title, this.text, this.price, this.fresh);
    // counter (zone HUD, below the title)
    this.counterBox = el('div', 'sle-twin-counter');
    this.counterBox.hidden = !opts.counter;
    this.counterText = el('span', 'sle-twin-counter-text');
    this.counterText.setAttribute('aria-live', 'polite');
    this.resetBtn = el('button', 'sle-twin-reset', '↺');
    this.resetBtn.type = 'button';
    this.resetBtn.setAttribute('aria-label', 'Entdeckt zurücksetzen');
    this.resetBtn.title = 'Entdeckt zurücksetzen (nur auf diesem Gerät gespeichert)';
    this.resetBtn.addEventListener('click', () => this.onResetClick());
    this.counterBox.append(this.counterText, this.resetBtn);
    // toast, tip, crosshair
    this.toastBox = el('div', 'sle-twin-toast');
    this.toastBox.setAttribute('role', 'status');
    this.toastBox.hidden = true;
    this.tip = el('div', 'sle-twin-tip');
    this.tip.hidden = true;
    this.cross = el('div', 'sle-twin-cross');
    this.cross.hidden = true;
    this.crossLabel = el('span', 'sle-twin-cross-label');
    this.crossLabel.hidden = true;
    this.cross.append(this.crossLabel);
    this.root.append(this.counterBox, this.cross, this.tip, this.toastBox, this.card);
    container.appendChild(this.root);
  }

  get cardKey(): string | null {
    return this.openKey;
  }

  /** The card element (taps on it are not taps outside). */
  get cardEl(): HTMLElement {
    return this.card;
  }

  showCard(c: CardData, isNew: boolean): void {
    this.openKey = c.key;
    this.chip.textContent = c.chip ?? '';
    this.chip.hidden = !c.chip;
    this.title.textContent = c.title;
    this.text.textContent = c.text;
    this.price.hidden = !c.price;
    this.priceVal.textContent = c.price ?? '';
    this.priceUnit.textContent = c.unit ?? '';
    this.fresh.hidden = !isNew;
    this.card.classList.toggle('sle-twin-card-product', !!c.price || !!c.chip);
    this.card.hidden = false;
    this.root.parentElement?.classList.add('sle-twin-card-open');
    // restart the pop-in
    this.card.classList.remove('sle-twin-pop');
    void this.card.offsetWidth;
    this.card.classList.add('sle-twin-pop');
  }

  hideCard(): void {
    this.openKey = null;
    this.card.hidden = true;
    this.root.parentElement?.classList.remove('sle-twin-card-open');
  }

  setCounter(found: number, total: number): void {
    this.counterText.textContent = `entdeckt ${found} / ${total}`;
    this.counterBox.classList.toggle('sle-twin-counter-done', total > 0 && found >= total);
    this.resetBtn.hidden = found === 0;
  }

  /** Small pulse on the counter + a short confirmation. */
  discovered(title: string, found: number, total: number): void {
    this.counterBox.classList.remove('sle-twin-bump');
    void this.counterBox.offsetWidth;
    this.counterBox.classList.add('sle-twin-bump');
    this.toast(found >= total ? `Alles entdeckt! ${found} / ${total}` : `Neu entdeckt: ${title} · ${found} / ${total}`);
  }

  toast(t: string): void {
    // the first-time walk hint has done its job; it shares the toast's place on phones
    this.root.parentElement?.querySelector('.sle-zone-hint')?.classList.add('sle-zone-hint-off');
    this.toastBox.textContent = t;
    this.toastBox.hidden = false;
    this.toastBox.classList.remove('sle-twin-toast-off');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toastBox.classList.add('sle-twin-toast-off');
      this.toastTimer = window.setTimeout(() => (this.toastBox.hidden = true), 400);
    }, 2400);
  }

  /** Name next to the pointer (CSS px in the zone layer), or hidden. */
  setTip(name: string | null, x = 0, y = 0): void {
    if (!name) {
      this.tip.hidden = true;
      return;
    }
    if (this.tip.textContent !== name) this.tip.textContent = name;
    this.tip.style.transform = `translate(${Math.round(x + 16)}px, ${Math.round(y + 14)}px)`;
    this.tip.hidden = false;
  }

  /** Crosshair under pointer lock; `name` = target under it (shown below with the key hint). */
  setCross(on: boolean, name: string | null): void {
    this.cross.hidden = !on;
    this.cross.classList.toggle('sle-twin-cross-on', on && !!name);
    const label = on && name ? `${name} · E` : '';
    if (this.crossLabel.textContent !== label) {
      this.crossLabel.textContent = label;
      this.crossLabel.hidden = !label;
    }
  }

  private onResetClick(): void {
    if (this.resetBtn.classList.contains('sle-twin-reset-ask')) {
      clearTimeout(this.resetTimer);
      this.resetBtn.classList.remove('sle-twin-reset-ask');
      this.resetBtn.textContent = '↺';
      this.opts.onReset();
      return;
    }
    this.resetBtn.classList.add('sle-twin-reset-ask');
    this.resetBtn.textContent = 'Zurücksetzen?';
    this.resetTimer = window.setTimeout(() => {
      this.resetBtn.classList.remove('sle-twin-reset-ask');
      this.resetBtn.textContent = '↺';
    }, 4000);
  }

  dispose(): void {
    clearTimeout(this.toastTimer);
    clearTimeout(this.resetTimer);
    this.root.remove();
  }
}
