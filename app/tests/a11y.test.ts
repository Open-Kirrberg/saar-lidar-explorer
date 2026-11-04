import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { derivedAriaLabel, isIconOnly } from '../src/ui/a11y';
import { contrastRatio, over, parseHex } from '../src/ui/contrast';

const css = (f: string) => readFileSync(join(__dirname, '..', 'src', 'ui', f), 'utf8');
const varValue = (text: string, name: string) => new RegExp(`${name}:\\s*([^;]+);`).exec(text)![1].trim();
const rgba = (v: string) => {
  const m = /rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/.exec(v)!;
  return { rgb: [Number(m[1]), Number(m[2]), Number(m[3])] as [number, number, number], a: Number(m[4]) };
};

describe('contrast (panel text ≥ 4.5:1)', () => {
  const style = css('style.css');
  const dim = parseHex(varValue(style, '--ui-dim'));
  const fg = parseHex(varValue(style, '--ui-fg'));
  const accent = parseHex(varValue(style, '--ui-accent'));
  const bg = rgba(varValue(style, '--ui-bg'));
  const white: [number, number, number] = [255, 255, 255];

  it('WCAG reference values', () => {
    expect(contrastRatio([0, 0, 0], white)).toBeCloseTo(21, 5);
    expect(contrastRatio(white, white)).toBeCloseTo(1, 5);
  });

  it('dim/normal/accent text on the translucent HUD/toolbar background over white terrain', () => {
    const ground = over(bg.rgb, bg.a, white); // worst case: bright terrain behind the panel
    expect(contrastRatio(dim, ground)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(fg, ground)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(accent, ground)).toBeGreaterThanOrEqual(4.5);
  });

  it('dim and body text on the opaque panel cards (#1f1f1f, #111 heads, #1f2326 dialogs)', () => {
    for (const card of ['#1f1f1f', '#111111', '#1f2326', '#2c2c2c']) {
      expect(contrastRatio(dim, parseHex(card))).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(parseHex('#ebebeb'), parseHex(card))).toBeGreaterThanOrEqual(4.5);
    }
    // Active (accent) buttons use dark text.
    expect(contrastRatio(parseHex('#1c1c1c'), accent)).toBeGreaterThanOrEqual(4.5);
  });

  it('shell splash, bar, drawers and „© Quellen“ (--ui-bg-strong) stay readable over white terrain', () => {
    const f = rgba(varValue(style, '--ui-bg-strong'));
    expect(contrastRatio(dim, over(f.rgb, f.a, white))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(accent, over(f.rgb, f.a, white))).toBeGreaterThanOrEqual(4.5);
    // Sources rows (#2a2f34) in the dialog.
    expect(contrastRatio(dim, parseHex('#2a2f34'))).toBeGreaterThanOrEqual(4.5);
  });
});

describe('icon-only buttons get an aria-label', () => {
  it('detects symbol-only text', () => {
    expect(isIconOnly('✕')).toBe(true);
    expect(isIconOnly(' ⓘ ')).toBe(true);
    expect(isIconOnly('▸')).toBe(true);
    expect(isIconOnly('?')).toBe(true);
    expect(isIconOnly('Teilen')).toBe(false);
    expect(isIconOnly('1')).toBe(false);
  });

  it('derives the label from the title only when needed', () => {
    expect(derivedAriaLabel({ text: '✕', ariaLabel: null, labelledBy: null, title: 'Schließen' })).toBe('Schließen');
    expect(derivedAriaLabel({ text: '✕', ariaLabel: 'x', labelledBy: null, title: 'Schließen' })).toBeNull();
    expect(derivedAriaLabel({ text: '✕', ariaLabel: null, labelledBy: 'id', title: 'Schließen' })).toBeNull();
    expect(derivedAriaLabel({ text: 'Löschen', ariaLabel: null, labelledBy: null, title: 'x' })).toBeNull();
    expect(derivedAriaLabel({ text: '✕', ariaLabel: null, labelledBy: null, title: '  ' })).toBeNull();
  });
});
