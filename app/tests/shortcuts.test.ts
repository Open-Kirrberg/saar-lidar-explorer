import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SHORTCUTS, SHORTCUT_GROUPS, availableShortcuts, documentedCodes, shortcutsHtml } from '../src/ui/shortcuts';

const SRC = join(__dirname, '..', 'src');

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? tsFiles(p) : p.endsWith('.ts') ? [p] : [];
  });
}

/** KeyboardEvent.code values compared or collected anywhere in app/src. */
function boundCodes(): Map<string, string> {
  const found = new Map<string, string>();
  const patterns = [/\.code\s*===\s*'([A-Za-z0-9]+)'/g, /\bk\.has\('([A-Za-z0-9]+)'\)/g];
  for (const f of tsFiles(SRC)) {
    if (f.endsWith('shortcuts.ts')) continue;
    const text = readFileSync(f, 'utf8');
    for (const re of patterns) for (const m of text.matchAll(re)) found.set(m[1], f.slice(SRC.length + 1));
    // MOVE_KEYS list in the drone controller
    for (const m of text.matchAll(/MOVE_KEYS = new Set\(\[([^\]]+)\]/g)) {
      for (const k of m[1].matchAll(/'([A-Za-z0-9]+)'/g)) found.set(k[1], f.slice(SRC.length + 1));
    }
  }
  return found;
}

describe('shortcut table (HUD "Steuerung" + introduction)', () => {
  it('documents every key code bound in app/src', () => {
    const documented = documentedCodes();
    const bound = boundCodes();
    expect(bound.size).toBeGreaterThan(20); // the scan itself works
    const missing = [...bound].filter(([c]) => !documented.has(c)).map(([c, f]) => `${c} (${f})`);
    expect(missing).toEqual([]);
  });

  it('lists the keys the roadmap notes found missing (G O F X N P L C M B V K, 1–9)', () => {
    const codes = documentedCodes();
    for (const k of 'GOFXNPLCMBVKH') expect(codes.has(`Key${k}`)).toBe(true);
    for (let d = 0; d <= 9; d++) expect(codes.has(`Digit${d}`)).toBe(true);
  });

  it('hides rows for layers the AOI lacks; HUD rows are a subset', () => {
    const none = availableShortcuts(() => false);
    expect(none.some((s) => s.requires)).toBe(false);
    expect(availableShortcuts(() => true)).toHaveLength(SHORTCUTS.length);
    const hud = availableShortcuts(() => true, true);
    expect(hud.length).toBeLessThan(SHORTCUTS.length);
    expect(hud.every((s) => s.hud)).toBe(true);
  });

  it('every row has a known group, keys and a German label', () => {
    for (const s of SHORTCUTS) {
      expect(SHORTCUT_GROUPS).toContain(s.group);
      expect(s.keys.length).toBeGreaterThan(0);
      expect(s.label.length).toBeGreaterThan(2);
    }
  });

  it('renders escaped HTML with headings', () => {
    const html = shortcutsHtml([{ group: 'Hilfe', keys: ['<x>'], label: 'a & b', codes: [] }], { headings: true });
    expect(html).toContain('<div class="sle-keys-group">Hilfe</div>');
    expect(html).toContain('<kbd>&#60;x&#62;</kbd>');
    expect(html).toContain('a &#38; b');
    expect(shortcutsHtml(SHORTCUTS.filter((s) => s.short), { short: true })).toContain('Hilfe ein/aus');
  });
});
