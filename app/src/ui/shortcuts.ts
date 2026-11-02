/**
 * The one table of keyboard/mouse controls actually bound in the app (final polish). The HUD
 * "Steuerung" block and the introduction overlay are rendered from it; a unit test scans
 * `app/src` for `e.code === '…'` / `k.has('…')` bindings and fails when one is missing here.
 * Pure (no DOM): `codes` lists the KeyboardEvent.code values each row responds to.
 */

export type ShortcutGroup = 'Flug' | 'Ansicht' | 'Ebenen' | 'Werkzeuge' | 'Hilfe';
/** Optional data a row depends on (row hidden when the AOI lacks it). */
export type ShortcutFeature = 'osm' | 'parcels' | 'buildings' | 'pointclouds' | 'candidates' | 'reconstruction';

export interface Shortcut {
  group: ShortcutGroup;
  /** Key caps as shown (German). */
  keys: string[];
  label: string;
  /** Compact label for the HUD list (defaults to `label`). */
  short?: string;
  codes: string[];
  requires?: ShortcutFeature;
  /** Shown in the compact HUD list (else only in the full help). */
  hud?: boolean;
}

const digits = (prefix: string) => Array.from({ length: 10 }, (_, i) => `${prefix}${i}`);

export const SHORTCUTS: readonly Shortcut[] = [
  // ---- Flug (DroneController) ----
  { group: 'Flug', keys: ['Klick'], label: 'Maus fangen (Esc gibt sie frei)', short: 'Maus fangen', codes: [], hud: true },
  { group: 'Flug', keys: ['Ziehen'], label: 'umsehen ohne Fangen', short: 'umsehen', codes: [], hud: true },
  {
    group: 'Flug',
    keys: ['W', 'A', 'S', 'D'],
    label: 'fliegen (auch Pfeiltasten)', short: 'fliegen / Pfeile',
    codes: ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'],
    hud: true,
  },
  { group: 'Flug', keys: ['Leertaste', 'E'], label: 'steigen', codes: ['Space', 'KeyE'], hud: true },
  { group: 'Flug', keys: ['Umschalt', 'Q'], label: 'sinken', codes: ['ShiftLeft', 'ShiftRight', 'KeyQ'], hud: true },
  {
    group: 'Flug',
    keys: ['Mausrad', '+', '−'],
    label: 'Tempo',
    codes: ['Equal', 'NumpadAdd', 'BracketRight', 'Minus', 'NumpadSubtract', 'Slash'],
    hud: true,
  },
  { group: 'Flug', keys: ['Gamepad'], label: 'Sticks fliegen/umsehen · LT/RT sinken/steigen · LB/RB Tempo', codes: [] },
  // ---- Ansicht (reliefPanel) ----
  { group: 'Ansicht', keys: ['1–9', '0'], label: 'Reliefdarstellung wählen', short: 'Relief', codes: [...digits('Digit'), ...digits('Numpad')], hud: true },
  { group: 'Ansicht', keys: ['Umschalt + 1–6'], label: 'Kombination (Relikte suchen, Gräben, Mauern …)', short: 'Kombination', codes: [], hud: true },
  { group: 'Ansicht', keys: ['B'], label: 'Überlagerung ein/aus', short: 'Überlagerung', codes: ['KeyB'], hud: true },
  { group: 'Ansicht', keys: ['V'], label: 'Wald: aus / transparent / voll', short: 'Wald', codes: ['KeyV'], hud: true },
  { group: 'Ansicht', keys: ['K'], label: 'Kontrast automatisch', short: 'Kontrast auto', codes: ['KeyK'], hud: true },
  // ---- Ebenen (feature modules) ----
  { group: 'Ebenen', keys: ['O'], label: 'Wege (OSM)', codes: ['KeyO'], requires: 'osm', hud: true },
  { group: 'Ebenen', keys: ['F'], label: 'Flurstücke', codes: ['KeyF'], requires: 'parcels', hud: true },
  { group: 'Ebenen', keys: ['G'], label: 'Gebäude (LoD2)', codes: ['KeyG'], requires: 'buildings', hud: true },
  { group: 'Ebenen', keys: ['C'], label: 'Punktwolke (Fokusgebiete)', short: 'Punktwolke', codes: ['KeyC'], requires: 'pointclouds', hud: true },
  { group: 'Ebenen', keys: ['X'], label: 'Verdachtsflächen', codes: ['KeyX'], requires: 'candidates', hud: true },
  { group: 'Ebenen', keys: ['R'], label: 'Rekonstruktion 1789 (Hypothese)', short: 'Rekonstruktion 1789', codes: ['KeyR'], requires: 'reconstruction', hud: true },
  {
    group: 'Ebenen',
    keys: ['T'],
    label: 'Schloss betreten (Schloss-Viewer, nahe am Schloss) · Umschalt+T zu Fuß',
    short: 'Schloss betreten',
    codes: ['KeyT'],
    requires: 'reconstruction',
    hud: true,
  },
  { group: 'Ebenen', keys: ['N', 'P'], label: 'nächste / vorige Verdachtsfläche (wenn eingeblendet)', short: 'nächste/vorige', codes: ['KeyN', 'KeyP'], requires: 'candidates', hud: true },
  // ---- Werkzeuge ----
  { group: 'Werkzeuge', keys: ['M'], label: 'Fundmarker setzen (Esc bricht ab)', short: 'Fundmarker', codes: ['KeyM', 'Escape'], hud: true },
  {
    group: 'Werkzeuge',
    keys: ['L'],
    label: 'Messen · Enter fertig · Rücktaste Punkt zurück · Esc abbrechen', short: 'Messen',
    codes: ['KeyL', 'Enter', 'NumpadEnter', 'Backspace', 'Escape'],
    hud: true,
  },
  // ---- Hilfe ----
  { group: 'Hilfe', keys: ['H'], label: 'diese Hilfe im HUD ein/aus', short: 'Hilfe ein/aus', codes: ['KeyH'], hud: true },
  { group: 'Hilfe', keys: ['?'], label: 'Einführung & alle Tastenkürzel', short: 'alle Kürzel', codes: [], hud: true },
  { group: 'Hilfe', keys: ['Esc'], label: 'Tour beenden / Dialog schließen', codes: ['Escape'] },
];

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = ['Flug', 'Ansicht', 'Ebenen', 'Werkzeuge', 'Hilfe'];

/** Rows whose data exists in this AOI (`has(feature)`), optionally only the compact HUD rows. */
export function availableShortcuts(has: (f: ShortcutFeature) => boolean, hudOnly = false): Shortcut[] {
  return SHORTCUTS.filter((s) => (!s.requires || has(s.requires)) && (!hudOnly || s.hud));
}

/** All KeyboardEvent.code values covered by the table. */
export function documentedCodes(): Set<string> {
  return new Set(SHORTCUTS.flatMap((s) => s.codes));
}

const escapeHtml = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** HTML for a list of rows: `<kbd>` caps + label, one `<div>` per row, grouped with headings. */
export function shortcutsHtml(
  rows: readonly Shortcut[],
  opts: { headings?: boolean; tag?: 'div' | 'li'; short?: boolean } = {},
): string {
  const tag = opts.tag ?? 'div';
  let html = '';
  for (const g of SHORTCUT_GROUPS) {
    const inGroup = rows.filter((r) => r.group === g);
    if (!inGroup.length) continue;
    if (opts.headings) html += `<div class="sle-keys-group">${g}</div>`;
    for (const r of inGroup) {
      const caps = r.keys.map((k) => `<kbd>${escapeHtml(k)}</kbd>`).join(' ');
      html += `<${tag} class="sle-keys-row">${caps} <span>${escapeHtml(opts.short ? (r.short ?? r.label) : r.label)}</span></${tag}>`;
    }
  }
  return html;
}
