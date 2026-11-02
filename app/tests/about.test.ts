/** „Über & Datenschutz“: the privacy text must list every server the app requests, and stay truthful about defaults. */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXTERNAL_SERVICES, LINK_ONLY_HOSTS, OWN_HOSTS, hostingText } from '../src/ui/aboutText';

const SRC = join(import.meta.dirname, '..', 'src');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|css|html)$/.test(n) ? [p] : [];
  });
}

describe('privacy text covers every external host in app/src', () => {
  it('each http(s) host is a listed third-party service, a link-only host or the deployment itself', () => {
    const known = new Set([...EXTERNAL_SERVICES.map((s) => s.host), ...LINK_ONLY_HOSTS, ...OWN_HOSTS]);
    const unknown = new Map<string, string>();
    for (const f of files(SRC)) {
      for (const m of readFileSync(f, 'utf8').matchAll(/https?:\/\/([a-zA-Z0-9.{}-]+)/g)) {
        if (!known.has(m[1])) unknown.set(m[1], f.slice(SRC.length + 1));
      }
    }
    expect(Object.fromEntries(unknown)).toEqual({});
  });

  it('every listed service is still used somewhere (no stale entries)', () => {
    const all = files(SRC)
      .filter((f) => !f.endsWith('aboutText.ts'))
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n');
    for (const s of EXTERNAL_SERVICES) expect(all.includes(`https://${s.host}`), s.host).toBe(true);
  });

  it('"by default" matches the minimap defaults (OSM base on; DOP/ALKIS overlays off)', () => {
    const mm = readFileSync(join(SRC, 'map', 'Minimap.ts'), 'utf8');
    const defaults = /const DEFAULT_PREFS[^=]*=\s*\{([\s\S]*?)\n\};/.exec(mm)?.[1] ?? '';
    expect(defaults).toMatch(/base: 'OpenStreetMap'/);
    const overlays = /overlays: \[([^\]]*)\]/.exec(defaults)?.[1] ?? '';
    expect(overlays).not.toMatch(/Luftbild|Flurstücke|Gemarkung|DOP/);
    const byHost = Object.fromEntries(EXTERNAL_SERVICES.map((s) => [s.host, s.byDefault]));
    expect(byHost).toEqual({ 'tile.openstreetmap.org': true, '{s}.tile.opentopomap.org': false, 'geoportal.saarland.de': false });
  });
});

describe('hostingText', () => {
  it('public site: GitHub Pages, data from the same host', () => {
    const t = hostingText('open-kirrberg.github.io', 'open-kirrberg.github.io');
    expect(t.github).toBe(true);
    expect(t.text).toMatch(/GitHub Pages/);
    expect(t.text).toMatch(/IP-Adresse/);
    expect(t.text).toMatch(/Auch die Gelände/);
  });

  it('GitHub Pages site with data on another host names that host', () => {
    const t = hostingText('open-kirrberg.github.io', 'data.example.org');
    expect(t.github).toBe(true);
    expect(t.text).toMatch(/von data\.example\.org geladen/);
    expect(t.text).not.toMatch(/ebenfalls GitHub/);
  });

  it('local run: no GitHub claim', () => {
    const t = hostingText('127.0.0.1:5240', '127.0.0.1:5240');
    expect(t.github).toBe(false);
    expect(t.text).not.toMatch(/GitHub/);
    expect(t.text).toMatch(/127\.0\.0\.1:5240/);
  });

  it('local page with data from GitHub Pages mentions GitHub for the data', () => {
    const t = hostingText('localhost:5240', 'open-kirrberg.github.io');
    expect(t.github).toBe(true);
    expect(t.text).toMatch(/open-kirrberg\.github\.io ist GitHub Pages/);
  });
});
