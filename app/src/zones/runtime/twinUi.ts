/**
 * Built twins (ADR 0042): the zone HUD for clickable objects — info card, „entdeckt x / y“ counter, the small
 * „Neu entdeckt“ confirmation, a name tip next to the pointer, the crosshair under pointer lock and, when the
 * catalogue has fills, the state toggle (*Morgens* / *Feierabend*) below the counter; when it has a tour, the
 * *Führung* button next to it and the tour panel (title, text, *Zurück* / *Weiter*, *Tour beenden*).
 * German UI (du-form), plain DOM, text only (`textContent`, never HTML from the package). Styles: zones.css.
 */
import type { CardData } from '../catalogue';
import type { TourAction } from '../tour';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

export interface TwinUiFill {
  id: string;
  name_de: string;
  info_de: string;
}

export interface TwinUiOptions {
  /** Show the counter (the catalogue has discoverable things). */
  counter: boolean;
  /** Fill states: a toggle with one button each when there are ≥ 2. */
  fills?: readonly TwinUiFill[];
  /** The state shown first. */
  fill?: string | null;
  onFill?(id: string): void;
  /** The tour's name (the start button's tooltip); undefined = no tour, no button. */
  tour?: string;
  onTour?(action: TourAction): void;
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
  private readonly fillBtns = new Map<string, HTMLButtonElement>();
  private readonly resetBtn: HTMLButtonElement;
  private readonly toastBox: HTMLElement;
  private readonly tourBtn: HTMLButtonElement | null = null;
  private readonly tourBox: HTMLElement;
  private readonly tourCount: HTMLElement;
  private readonly tourTitle: HTMLElement;
  private readonly tourText: HTMLElement;
  private readonly tourBack: HTMLButtonElement;
  private readonly tourNext: HTMLButtonElement;
  private tourOn = false;
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
    // counter, then a row with the fill toggle and the tour button, in the upper left
    const hud = el('div', 'sle-twin-hud');
    const row = el('div', 'sle-twin-hud-row');
    hud.append(this.counterBox, row);
    const fills = opts.fills ?? [];
    if (fills.length >= 2) {
      const box = el('div', 'sle-twin-fills');
      box.setAttribute('role', 'group');
      box.setAttribute('aria-label', 'Tageszeit im Laden');
      for (const f of fills) {
        const b = el('button', 'sle-twin-fill', f.name_de);
        b.type = 'button';
        b.dataset.fill = f.id;
        if (f.info_de) b.title = f.info_de;
        b.addEventListener('click', () => this.opts.onFill?.(f.id));
        this.fillBtns.set(f.id, b);
        box.append(b);
      }
      row.append(box);
    }
    if (opts.tour !== undefined) {
      const b = el('button', 'sle-twin-tour-btn', 'Führung');
      b.type = 'button';
      b.title = `${opts.tour}: in ein paar Schritten durch den Laden`;
      b.addEventListener('click', () => this.opts.onTour?.('start'));
      this.tourBtn = b;
      row.append(b);
    }
    // tour panel (bottom left; on phones a bottom sheet like the card)
    this.tourBox = el('section', 'sle-twin-tour');
    this.tourBox.hidden = true;
    this.tourBox.setAttribute('role', 'region');
    this.tourBox.setAttribute('aria-label', opts.tour ?? 'Führung');
    this.tourCount = el('span', 'sle-twin-tour-count');
    const end = el('button', 'sle-twin-tour-end', 'Tour beenden');
    end.type = 'button';
    end.title = 'Tour beenden (Esc)';
    end.addEventListener('click', () => this.opts.onTour?.('end'));
    const tourHead = el('div', 'sle-twin-tour-head');
    tourHead.append(this.tourCount, end);
    const body = el('div', 'sle-twin-tour-body');
    body.setAttribute('aria-live', 'polite');
    this.tourTitle = el('h2', 'sle-twin-tour-title');
    this.tourText = el('p', 'sle-twin-tour-text');
    body.append(this.tourTitle, this.tourText);
    this.tourBack = el('button', 'sle-twin-tour-back', '‹ Zurück');
    this.tourBack.type = 'button';
    this.tourBack.addEventListener('click', () => this.opts.onTour?.('back'));
    this.tourNext = el('button', 'sle-twin-tour-next', 'Weiter ›');
    this.tourNext.type = 'button';
    this.tourNext.addEventListener('click', () => this.opts.onTour?.('next'));
    const nav = el('div', 'sle-twin-tour-nav');
    nav.append(this.tourBack, this.tourNext);
    this.tourBox.append(tourHead, body, nav);
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
    this.root.append(hud, this.cross, this.tip, this.toastBox, this.tourBox, this.card);
    container.appendChild(this.root);
    this.setFill(opts.fill ?? null);
  }

  /** Mark the current fill state's button. */
  setFill(id: string | null): void {
    for (const [k, b] of this.fillBtns) b.setAttribute('aria-pressed', String(k === id));
  }

  /** Show one tour stop (`counter` „2 / 6“; `back` enabled; `next` label „Weiter“ or „Fertig“). */
  showTour(stop: { title: string; text: string; counter: string; back: boolean; next: string }): void {
    this.tourCount.textContent = `Führung · ${stop.counter}`;
    this.tourTitle.textContent = stop.title;
    this.tourText.textContent = stop.text;
    this.tourBack.disabled = !stop.back;
    this.tourNext.textContent = stop.next === 'Fertig' ? 'Fertig ✓' : `${stop.next} ›`;
    this.tourBox.hidden = false;
    if (this.tourBtn) this.tourBtn.hidden = true;
    // the first-time walk hint has done its job (on phones it sits over the view)
    this.root.parentElement?.querySelector('.sle-zone-hint')?.classList.add('sle-zone-hint-off');
    this.root.parentElement?.classList.add('sle-twin-tour-open');
    if (!this.tourOn) {
      this.tourBox.classList.remove('sle-twin-pop');
      void this.tourBox.offsetWidth;
      this.tourBox.classList.add('sle-twin-pop');
    }
    this.tourOn = true;
  }

  hideTour(): void {
    this.tourOn = false;
    this.tourBox.hidden = true;
    if (this.tourBtn) this.tourBtn.hidden = false;
    this.root.parentElement?.classList.remove('sle-twin-tour-open');
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
