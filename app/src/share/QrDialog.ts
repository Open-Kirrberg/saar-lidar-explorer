/**
 * "QR-Code zur Website" dialog: segmented choice Website / Diese Ansicht, QR code as inline SVG,
 * the URL as selectable text, "Link kopieren" and "QR als PNG speichern". Modal (`.sle-overlay`,
 * keys isolated, Tab trapped, Esc closes). "Diese Ansicht" uses the same hash as "Teilen" and is
 * disabled while that hash would reveal the user's position (F20 locate privacy).
 */
import type { AppState, Store } from '../state';
import { copyText } from '../ui/clipboard';
import { isolateModalKeys } from '../ui/modalKeys';
import { PUBLIC_URL, QR_TARGETS, QR_TARGET_LABELS, qrTargetUrl, viewHash } from './publicUrl';
import type { QrTarget } from './publicUrl';
import { QR_QUIET, qrMatrix, qrSvg } from './qr';
import type { QrMatrix } from './qr';
import './qr.css';

export interface QrDialogDeps {
  store: Store<AppState>;
  /** Would the current view reveal the user's position (locate privacy zone)? */
  revealsPosition(): boolean;
  publicUrl?: string;
}

const ID = 'sle-qr';
/** While open, re-check the view hash / privacy state this often (camera may follow the user). */
const RECHECK_MS = 1000;

export function isQrDialogOpen(): boolean {
  return !!document.getElementById(ID);
}

export function openQrDialog(deps: QrDialogDeps): void {
  if (isQrDialogOpen()) return;
  const base = deps.publicUrl ?? PUBLIC_URL;
  const prevFocus = document.activeElement as HTMLElement | null;
  let target: QrTarget = 'site';
  let url = '';
  let matrix: QrMatrix | null = null;

  const wrap = document.createElement('div');
  wrap.id = ID;
  wrap.className = 'sle-overlay';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  wrap.setAttribute('aria-labelledby', 'sle-qr-title');
  wrap.innerHTML = `
    <div class="sle-modal sle-qr">
      <h2 id="sle-qr-title">QR-Code zur Website</h2>
      <div class="sle-seg" role="radiogroup" aria-label="Ziel des QR-Codes"></div>
      <p class="sle-dim sle-small sle-qr-note" data-k="note"></p>
      <div class="sle-qr-code" data-k="code"></div>
      <code class="sle-qr-url" data-k="url"></code>
      <p class="sle-qr-status sle-small" data-k="status" role="status" aria-live="polite"></p>
      <div class="sle-actions">
        <button type="button" class="sle-btn" data-act="copy">Link kopieren</button>
        <button type="button" class="sle-btn" data-act="png">QR als PNG speichern</button>
        <span class="sle-spacer"></span>
        <button type="button" class="primary" data-act="close">Schließen</button>
      </div>
      <p class="sle-dim sle-small">Der Link enthält nie Fundmarker, Verdachtsflächen oder Ihren Standort.</p>
    </div>`;
  const $ = <T extends HTMLElement>(s: string) => wrap.querySelector<T>(s)!;
  const seg = $('.sle-seg');
  const note = $('[data-k=note]');
  const codeEl = $('[data-k=code]');
  const urlEl = $('[data-k=url]');
  const status = $('[data-k=status]');

  const radios = new Map<QrTarget, HTMLButtonElement>();
  for (const t of QR_TARGETS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.t = t;
    b.setAttribute('role', 'radio');
    b.textContent = QR_TARGET_LABELS[t];
    b.addEventListener('click', () => pick(t));
    seg.appendChild(b);
    radios.set(t, b);
  }

  const hashNow = () => viewHash(deps.store.get(), deps.revealsPosition());

  function render(): void {
    const hash = hashNow();
    const viewOk = hash !== null;
    if (target === 'view' && !viewOk) target = 'site';
    const viewBtn = radios.get('view')!;
    viewBtn.disabled = !viewOk;
    viewBtn.title = viewOk ? 'Website mit Position, Blickrichtung und Darstellung dieser Ansicht' : 'Gesperrt: die Ansicht verrät Ihren Standort';
    for (const [t, b] of radios) {
      const on = t === target;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    note.textContent = !viewOk
      ? '„Diese Ansicht“ ist gesperrt, solange die Ansicht Ihren Standort verrät – erst über 1 km wegfliegen.'
      : target === 'view'
        ? 'Öffnet die Website an dieser Stelle – Position, Blickrichtung, Überhöhung und Sonne.'
        : 'Öffnet die Startseite der öffentlichen Website.';
    const next = qrTargetUrl(base, target, hash);
    if (next === url) return;
    url = next;
    matrix = qrMatrix(url);
    codeEl.innerHTML = qrSvg(matrix, { label: `QR-Code: ${url}` });
    codeEl.querySelector('svg')?.setAttribute('aria-label', `QR-Code: ${url}`);
    urlEl.textContent = url;
    status.textContent = '';
  }

  function pick(t: QrTarget): void {
    if (t === 'view' && radios.get('view')!.disabled) return;
    target = t;
    render();
  }

  const copy = async () => {
    if (await copyText(url)) {
      status.textContent = 'Link kopiert.';
      return;
    }
    // No clipboard (no user activation, permissions): select the text for manual copying.
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(urlEl);
    sel?.removeAllRanges();
    sel?.addRange(range);
    status.textContent = 'Kopieren nicht möglich – der Link ist markiert, bitte manuell kopieren.';
  };

  const savePng = () => {
    if (!matrix) return;
    const m = matrix;
    const n = m.size + 2 * QR_QUIET;
    const scale = Math.max(4, Math.ceil(800 / n));
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = n * scale;
    const g = canvas.getContext('2d');
    if (!g) return void (status.textContent = 'PNG konnte nicht erzeugt werden.');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = '#000';
    for (let r = 0; r < m.size; r++) {
      for (let c = 0; c < m.size; c++) if (m.dark[r * m.size + c]) g.fillRect((c + QR_QUIET) * scale, (r + QR_QUIET) * scale, scale, scale);
    }
    const name = `saar-lidar-explorer-qr-${target === 'view' ? 'ansicht' : 'website'}.png`;
    canvas.toBlob((blob) => {
      if (!blob) return void (status.textContent = 'PNG konnte nicht erzeugt werden.');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      status.textContent = `Gespeichert als ${name}.`;
    }, 'image/png');
  };

  const timer = setInterval(() => wrap.isConnected && render(), RECHECK_MS);
  const close = () => {
    clearInterval(timer);
    uninstallKeys();
    wrap.remove();
    if (prevFocus?.isConnected) prevFocus.focus({ preventScroll: true });
  };
  const uninstallKeys = isolateModalKeys(wrap, (e) => {
    if (e.key === 'Escape') {
      close();
      return true;
    }
    // WAI-ARIA radio pattern inside the segment.
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (d && seg.contains(e.target as Node)) {
      const enabled = QR_TARGETS.filter((t) => !radios.get(t)!.disabled);
      const i = Math.max(0, enabled.indexOf(target));
      pick(enabled[(i + d + enabled.length) % enabled.length]);
      radios.get(target)!.focus();
      return true;
    }
    return false;
  });
  wrap.addEventListener('sle:close', close);
  $('[data-act=close]').addEventListener('click', close);
  $('[data-act=copy]').addEventListener('click', () => void copy());
  $('[data-act=png]').addEventListener('click', savePng);
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap) close();
  });

  render();
  (document.querySelector('#app') ?? document.body).appendChild(wrap);
  radios.get(target)!.focus();
}
