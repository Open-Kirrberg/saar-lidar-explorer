import { utmToWgs84 } from '../geo';
import type { AppContext } from '../main';
import { flyToSiteExag } from '../candidates/flyToSite';
import { isTyping } from '../ui/keys';
import type { Labels3D } from '../ui/Labels3D';
import { createPanelSection, openPanelSection } from '../ui/panelSection';
import type { PanelSection } from '../ui/panelSection';
import {
  MARKER_CATEGORIES,
  loadMarkers,
  markersFromGeoJSON,
  markersToGeoJSON,
  mergeMarkers,
  newMarkerId,
  saveMarkers,
} from './markerStore';
import type { Marker } from './markerStore';
import { lookupParcel } from './parcel';

const LABEL_GROUP = 'marker';

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const fmt = (v: number, d = 0) => v.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });

/**
 * Fundmarker (F6): "Markieren" mode (key M), click on the terrain → form → saved marker.
 * Persisted in localStorage `sle.markers.v1`; shown in 3D (Labels3D) and on the map; GeoJSON export/import.
 * Pointer lock is only suspended while marker mode is on (controller.opts.lockOnClick = false).
 */
export class MarkerManager {
  markers: Marker[];
  active = false;
  private readonly kv = safeStorage();
  private readonly listeners = new Set<(m: Marker[]) => void>();
  private readonly modeListeners = new Set<(on: boolean) => void>();
  private readonly sec: PanelSection;
  private readonly hint: HTMLElement;
  private form: HTMLElement | null = null;
  private prevLockOnClick = true;
  private down: { x: number; y: number; t: number } | null = null;
  /** F18: "Meldung erstellen" handler (set by the report module); no button while null. */
  private reportHandler: ((m: Marker) => void) | null = null;

  constructor(
    private readonly ctx: AppContext,
    panel: HTMLElement,
    private readonly labels: Labels3D,
  ) {
    this.markers = loadMarkers(this.kv);
    this.sec = createPanelSection(panel, 'markers', 'Fundmarker', false);
    this.hint = document.createElement('div');
    this.hint.className = 'sle-mode-hint';
    this.hint.hidden = true;
    this.hint.innerHTML = `<b>Markieren</b> · Klick ins Gelände setzt einen Fundmarker · Ziehen = umsehen · <kbd>M</kbd>/<kbd>Esc</kbd> beendet`;
    document.querySelector('#app')!.appendChild(this.hint);
    this.buildSection();
    this.bindCanvas();
    window.addEventListener('keydown', (e) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === 'KeyM') {
        if (!e.repeat) this.setActive(!this.active); // holding M must not toggle at the key-repeat rate
      }
      else if (e.code === 'Escape') {
        if (this.form) this.closeForm();
        else if (this.active) this.setActive(false);
      }
    });
    this.sync();
  }

  onChange(fn: (m: Marker[]) => void): void {
    this.listeners.add(fn);
    fn(this.markers);
  }

  onModeChange(fn: (on: boolean) => void): void {
    this.modeListeners.add(fn);
  }

  setActive(on: boolean): void {
    if (on === this.active) return;
    this.active = on;
    const { controller } = this.ctx;
    if (on) {
      this.prevLockOnClick = controller.opts.lockOnClick;
      controller.opts.lockOnClick = false;
      if (controller.locked) document.exitPointerLock();
    } else {
      controller.opts.lockOnClick = this.prevLockOnClick;
      this.closeForm();
    }
    document.querySelector('#app')!.classList.toggle('marker-mode', on);
    this.hint.hidden = !on;
    this.sec.root.querySelector<HTMLButtonElement>('[data-act=mode]')!.classList.toggle('on', on);
    for (const fn of this.modeListeners) fn(on);
  }

  /** F18: enable the "Meldung erstellen" buttons in the list and the edit form. */
  setReportHandler(fn: ((m: Marker) => void) | null): void {
    this.reportHandler = fn;
    this.renderList();
  }

  flyTo(m: Marker): void {
    void flyToSiteExag(this.ctx, m.E, m.N, 80, 40, m.h);
  }

  /** Add (or replace by id) a marker programmatically, e.g. a confirmed F15 candidate; persists. */
  add(m: Marker): void {
    const i = this.markers.findIndex((x) => x.id === m.id);
    if (i >= 0) this.markers[i] = m;
    else this.markers.push(m);
    this.commit();
  }

  /** Set the Flurstück label of a stored marker (e.g. looked up after a candidate was confirmed); persists. */
  setParcel(id: string, parcel: string): boolean {
    const m = this.markers.find((x) => x.id === id);
    if (!m || !parcel || m.parcel === parcel) return false;
    m.parcel = parcel.slice(0, 200);
    this.commit();
    return true;
  }

  /** Delete a marker by id without asking (the caller confirmed inline); returns false if unknown. */
  delete(id: string): boolean {
    const n = this.markers.length;
    this.markers = this.markers.filter((x) => x.id !== id);
    if (this.markers.length === n) return false;
    this.commit();
    return true;
  }

  has(id: string): boolean {
    return this.markers.some((x) => x.id === id);
  }

  /** Current markers (read-only view). */
  list(): readonly Marker[] {
    return this.markers;
  }

  // ---- persistence ----------------------------------------------------------------------------

  private commit(): void {
    if (!saveMarkers(this.kv, this.markers)) this.toast('Speichern im Browser nicht möglich (localStorage).', true);
    this.sync();
  }

  private sync(): void {
    this.labels.clearGroup(LABEL_GROUP);
    for (const m of this.markers) this.labels.set(`marker:${m.id}`, LABEL_GROUP, m.E, m.N, this.pinEl(m), { lift: 0, maxDistance: 5000 });
    this.renderList();
    for (const fn of this.listeners) fn(this.markers);
  }

  private pinEl(m: Marker, draft = false): HTMLElement {
    const el = document.createElement('div');
    el.className = `sle-pin marker${draft ? ' draft' : ''}`;
    el.innerHTML = `<span class="sle-pin-txt"></span><span class="sle-pin-stem"></span>`;
    el.querySelector('.sle-pin-txt')!.textContent = draft ? 'neu' : m.title;
    if (!draft) {
      el.title = `${m.title} (${m.category}) – klicken zum Bearbeiten`;
      el.addEventListener('click', () => this.openForm(m, false));
    }
    return el;
  }

  // ---- canvas picking -------------------------------------------------------------------------

  private bindCanvas(): void {
    const dom = this.ctx.renderer.domElement;
    dom.addEventListener('pointerdown', (e) => {
      if (this.active && e.button === 0) this.down = { x: e.clientX, y: e.clientY, t: performance.now() };
    });
    dom.addEventListener('pointerup', (e) => {
      const d = this.down;
      this.down = null;
      if (!this.active || !d || e.button !== 0) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4 || performance.now() - d.t > 600) return;
      const hit = this.ctx.pickAt(e.clientX, e.clientY);
      if (!hit) {
        this.toast('Kein Gelände getroffen.', true);
        return;
      }
      const draft: Marker = {
        id: newMarkerId(),
        title: '',
        note: '',
        category: 'Sonstiges',
        created: new Date().toISOString(),
        E: Math.round(hit.E * 100) / 100,
        N: Math.round(hit.N * 100) / 100,
        h: Number.isFinite(hit.h) ? Math.round(hit.h * 100) / 100 : null,
      };
      this.openForm(draft, true);
    });
  }

  // ---- form -----------------------------------------------------------------------------------

  private openForm(m: Marker, isNew: boolean): void {
    this.closeForm();
    if (isNew) this.labels.set('marker:draft', LABEL_GROUP, m.E, m.N, this.pinEl(m, true));
    const { lat, lon } = utmToWgs84(m.E, m.N);
    const f = document.createElement('form');
    f.className = 'sle-form';
    f.innerHTML = `
      <h3>${isNew ? 'Neuer Fundmarker' : 'Fundmarker bearbeiten'}</h3>
      <label>Titel <input name="title" class="sle-input" maxlength="200" required placeholder="z. B. Graben am Hang"></label>
      <label>Kategorie <select name="category" class="sle-input">${MARKER_CATEGORIES.map((c) => `<option>${c}</option>`).join('')}</select></label>
      <label>Notiz <textarea name="note" class="sle-input" rows="3" maxlength="5000" placeholder="Beobachtung, Relief-Modus, Maße …"></textarea></label>
      <dl class="sle-meta">
        <dt>E / N (UTM 32)</dt><dd>${fmt(m.E, 1)} / ${fmt(m.N, 1)}</dd>
        <dt>Höhe</dt><dd>${m.h !== null ? `${fmt(m.h, 2)} m ü. NN` : '–'}</dd>
        <dt>WGS84</dt><dd>${lat.toFixed(6)}, ${lon.toFixed(6)}</dd>
        <dt>Flurstück</dt><dd data-k="parcel">${m.parcel ? '' : '<button type="button" class="sle-link" data-act="parcel">abfragen</button>'}</dd>
      </dl>
      <p class="sle-dim sle-small">Nur eine Hypothese – Schauen, nicht graben. Bleibt lokal in diesem Browser.</p>
      <div class="sle-actions">
        ${isNew ? '' : '<button type="button" data-act="delete" class="danger">Löschen</button>'}
        ${isNew || !this.reportHandler ? '' : '<button type="button" data-act="report" title="Druckbare HTML-Datei für diesen Marker herunterladen (nichts wird versendet)">Meldung erstellen</button>'}
        <span class="sle-spacer"></span>
        <button type="button" data-act="cancel">Abbrechen</button>
        <button type="submit" class="primary">Speichern</button>
      </div>`;
    const title = f.elements.namedItem('title') as HTMLInputElement;
    const cat = f.elements.namedItem('category') as HTMLSelectElement;
    const note = f.elements.namedItem('note') as HTMLTextAreaElement;
    title.value = m.title;
    cat.value = m.category;
    note.value = m.note;
    const parcelDd = f.querySelector<HTMLElement>('[data-k=parcel]')!;
    if (m.parcel) parcelDd.textContent = m.parcel;
    let parcel = m.parcel;
    const queryParcel = () => {
      parcelDd.textContent = 'wird abgefragt …';
      void lookupParcel(m.E, m.N).then((label) => {
        parcel = label ?? parcel;
        if (parcelDd.isConnected) parcelDd.textContent = label ?? 'nicht verfügbar';
        // Saved before the answer came back → patch the stored marker.
        const stored = this.markers.find((x) => x.id === m.id);
        if (label && stored && !stored.parcel) {
          stored.parcel = label;
          this.commit();
        }
      });
    };
    f.querySelector('[data-act=parcel]')?.addEventListener('click', queryParcel);
    if (isNew) queryParcel();

    f.addEventListener('keydown', (e) => {
      e.stopPropagation(); // keep M/Esc/H etc. inside the form
      if (e.key === 'Escape') this.closeForm();
    });
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const next: Marker = {
        ...m,
        title: title.value.trim() || 'Ohne Titel',
        category: cat.value as Marker['category'],
        note: note.value.trim(),
        ...(parcel ? { parcel } : {}),
      };
      const i = this.markers.findIndex((x) => x.id === m.id);
      if (i >= 0) this.markers[i] = next;
      else this.markers.push(next);
      this.closeForm();
      this.commit();
      openPanelSection(this.sec);
      this.toast(`„${next.title}“ gespeichert.`);
    });
    f.querySelector('[data-act=cancel]')!.addEventListener('click', () => this.closeForm());
    f.querySelector('[data-act=report]')?.addEventListener('click', () => {
      f.requestSubmit(); // save pending edits first (closes the form)
      const stored = this.markers.find((x) => x.id === m.id);
      if (stored && !this.form) this.reportHandler?.(stored);
    });
    f.querySelector('[data-act=delete]')?.addEventListener('click', () => {
      this.closeForm();
      this.remove(m);
    });
    document.querySelector('#app')!.appendChild(f);
    this.form = f;
    title.focus();
  }

  private closeForm(): void {
    this.labels.remove('marker:draft');
    this.form?.remove();
    this.form = null;
  }

  private remove(m: Marker): void {
    if (!confirm(`Fundmarker „${m.title}“ löschen?`)) return;
    this.markers = this.markers.filter((x) => x.id !== m.id);
    this.commit();
  }

  // ---- panel ----------------------------------------------------------------------------------

  private buildSection(): void {
    this.sec.body.innerHTML = `
      <div class="sle-row">
        <button type="button" data-act="mode" class="sle-btn" title="Taste M">Markieren (M)</button>
        <span class="sle-spacer"></span>
        <button type="button" data-act="export" class="sle-btn" title="Als GeoJSON (WGS84) speichern">Export</button>
        <button type="button" data-act="import" class="sle-btn" title="GeoJSON laden">Import</button>
        <input type="file" accept=".geojson,.json,application/geo+json,application/json" hidden>
      </div>
      <div class="sle-list sle-markers" role="list"></div>
      <p class="sle-dim sle-small">Fundmarker bleiben lokal im Browser. Genaue Lagen neuer Funde nicht veröffentlichen – Funde dem Landesdenkmalamt melden.</p>`;
    const q = <T extends HTMLElement>(s: string) => this.sec.body.querySelector<T>(s)!;
    q('[data-act=mode]').addEventListener('click', () => this.setActive(!this.active));
    q('[data-act=export]').addEventListener('click', () => this.exportGeoJSON());
    const file = q<HTMLInputElement>('input[type=file]');
    q('[data-act=import]').addEventListener('click', () => file.click());
    file.addEventListener('change', async () => {
      const fl = file.files?.[0];
      file.value = '';
      if (!fl) return;
      const r = markersFromGeoJSON(await fl.text());
      if (r.markers.length) {
        this.markers = mergeMarkers(this.markers, r.markers);
        this.commit();
      }
      this.toast(
        `${r.markers.length} Fundmarker importiert${r.skipped ? `, ${r.skipped} übersprungen` : ''}.${r.errors.length && !r.markers.length ? ` ${r.errors[0]}` : ''}`,
        r.markers.length === 0,
      );
    });
  }

  private renderList(): void {
    const list = this.sec.body.querySelector<HTMLElement>('.sle-markers')!;
    this.sec.setCount(this.markers.length);
    list.replaceChildren();
    if (!this.markers.length) {
      list.innerHTML = `<p class="sle-dim">Noch keine Fundmarker. „Markieren“ einschalten und ins Gelände klicken.</p>`;
      return;
    }
    const sorted = [...this.markers].sort((a, b) => b.created.localeCompare(a.created));
    for (const m of sorted) {
      const row = document.createElement('div');
      row.className = 'sle-marker-row';
      row.innerHTML = `
        <button type="button" class="sle-item" data-act="fly" title="Hinfliegen"><span class="sle-conf c-marker"></span><span class="sle-item-name"></span></button>
        <span class="sle-dim sle-small sle-cat"></span>
        ${this.reportHandler ? '<button type="button" class="sle-icon" data-act="report" title="Meldung erstellen (HTML herunterladen)">⎙</button>' : ''}
        <button type="button" class="sle-icon" data-act="edit" title="Bearbeiten">✎</button>
        <button type="button" class="sle-icon" data-act="del" title="Löschen">✕</button>`;
      row.querySelector('.sle-item-name')!.textContent = m.title;
      row.querySelector('.sle-cat')!.textContent = m.category;
      row.querySelector('[data-act=fly]')!.addEventListener('click', () => this.flyTo(m));
      row.querySelector('[data-act=edit]')!.addEventListener('click', () => {
        this.flyTo(m);
        this.openForm(m, false);
      });
      row.querySelector('[data-act=report]')?.addEventListener('click', () => this.reportHandler?.(m));
      row.querySelector('[data-act=del]')!.addEventListener('click', () => this.remove(m));
      list.appendChild(row);
    }
  }

  private exportGeoJSON(): void {
    if (!this.markers.length) {
      this.toast('Keine Fundmarker zum Exportieren.', true);
      return;
    }
    const blob = new Blob([JSON.stringify(markersToGeoJSON(this.markers), null, 1)], { type: 'application/geo+json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `fundmarker-${new Date().toISOString().slice(0, 10)}.geojson`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  private toast(msg: string, warn = false): void {
    const t = document.createElement('div');
    t.className = `sle-toast${warn ? ' warn' : ''}`;
    t.textContent = msg;
    document.querySelector('#app')!.appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }
}
