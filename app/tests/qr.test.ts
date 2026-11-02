import { describe, expect, it } from 'vitest';
import { DEFAULT_PUBLIC_URL, asciiUrl, publicSiteUrl, qrTargetUrl, viewHash } from '../src/share/publicUrl';
import { qrMatrix, qrSvg } from '../src/share/qr';
import { formatHash } from '../src/state';
import type { HashState } from '../src/state';

const STATE: HashState = {
  E: 375123.44,
  N: 5464321.06,
  h: 412.3,
  heading: 33.3,
  pitch: -25,
  layer: 'hillshade',
  overlay: 'none',
  overlayOpacity: 0.6,
  forest: 'off',
  exaggeration: 2,
  sunAzimuth: 315,
  sunElevation: 35,
  sunDirections: 1,
  preset: '',
};

describe('publicSiteUrl', () => {
  it('defaults to the GitHub Pages site', () => {
    expect(DEFAULT_PUBLIC_URL).toBe('https://open-kirrberg.github.io/saar-lidar-explorer/');
    expect(publicSiteUrl({})).toBe(DEFAULT_PUBLIC_URL);
    expect(publicSiteUrl({ VITE_PUBLIC_URL: '   ' })).toBe(DEFAULT_PUBLIC_URL);
  });
  it('takes VITE_PUBLIC_URL when it is an absolute http(s) URL, without a hash', () => {
    expect(publicSiteUrl({ VITE_PUBLIC_URL: 'https://example.org/sle/' })).toBe('https://example.org/sle/');
    expect(publicSiteUrl({ VITE_PUBLIC_URL: ' https://example.org/sle/#1,2,3 ' })).toBe('https://example.org/sle/');
    expect(publicSiteUrl({ VITE_PUBLIC_URL: 'http://192.168.1.5:5250/' })).toBe('http://192.168.1.5:5250/');
  });
  it('rejects relative, non-http and malformed values', () => {
    expect(publicSiteUrl({ VITE_PUBLIC_URL: '/sle/' })).toBe(DEFAULT_PUBLIC_URL);
    expect(publicSiteUrl({ VITE_PUBLIC_URL: 'javascript:alert(1)' })).toBe(DEFAULT_PUBLIC_URL);
    expect(publicSiteUrl({ VITE_PUBLIC_URL: 'https://' })).toBe(DEFAULT_PUBLIC_URL);
  });
});

describe('qrTargetUrl / viewHash', () => {
  const base = DEFAULT_PUBLIC_URL;
  it('site mode is the plain public URL', () => {
    expect(qrTargetUrl(base, 'site', formatHash(STATE))).toBe(base);
    expect(qrTargetUrl(`${base}#old`, 'site', null)).toBe(base);
  });
  it('view mode appends exactly the "Teilen" share hash', () => {
    const hash = viewHash(STATE, false);
    expect(hash).toBe(formatHash(STATE));
    expect(qrTargetUrl(base, 'view', hash)).toBe(`${base}${formatHash(STATE)}`);
    expect(qrTargetUrl(base, 'view', 'a,b')).toBe(`${base}#a,b`);
  });
  it('no view hash while the view reveals the user position → site URL', () => {
    expect(viewHash(STATE, true)).toBeNull();
    expect(qrTargetUrl(base, 'view', viewHash(STATE, true))).toBe(base);
  });
  it('produces ASCII only', () => {
    expect(asciiUrl('https://x.org/ä?q=€😀')).toBe('https://x.org/%C3%A4?q=%E2%82%AC%F0%9F%98%80');
    expect(asciiUrl('https://x.org/%C3%A4')).toBe('https://x.org/%C3%A4');
    // eslint-disable-next-line no-control-regex
    expect(/^[\x00-\x7f]*$/.test(qrTargetUrl('https://ö.example/', 'view', formatHash({ ...STATE, layer: 'hänge' })))).toBe(true);
  });
});

describe('qrMatrix / qrSvg', () => {
  it('encodes the public URL at level M with finder patterns', () => {
    const m = qrMatrix(DEFAULT_PUBLIC_URL);
    expect((m.size - 17) % 4).toBe(0);
    expect(m.size).toBeGreaterThanOrEqual(21);
    const at = (r: number, c: number) => m.dark[r * m.size + c];
    // 7×7 finder: dark ring, light ring, 3×3 dark core — top-left, top-right, bottom-left.
    for (const [r0, c0] of [[0, 0], [0, m.size - 7], [m.size - 7, 0]]) {
      for (let i = 0; i < 7; i++) {
        expect(at(r0, c0 + i)).toBe(1);
        expect(at(r0 + 6, c0 + i)).toBe(1);
      }
      expect(at(r0 + 1, c0 + 1)).toBe(0);
      expect(at(r0 + 3, c0 + 3)).toBe(1);
    }
  });
  it('grows with longer URLs and is deterministic', () => {
    const view = `${DEFAULT_PUBLIC_URL}${formatHash(STATE)}`;
    const a = qrMatrix(view);
    expect(a.size).toBeGreaterThan(qrMatrix(DEFAULT_PUBLIC_URL).size);
    expect(qrMatrix(view)).toEqual(a);
  });
  it('SVG has a white quiet zone and covers exactly the dark modules', () => {
    const m = qrMatrix(DEFAULT_PUBLIC_URL);
    const svg = qrSvg(m, { label: 'QR <Website>' });
    const n = m.size + 8;
    expect(svg).toContain(`viewBox="0 0 ${n} ${n}"`);
    expect(svg).toContain('shape-rendering="crispEdges"');
    expect(svg).toContain('<title>QR &lt;Website&gt;</title>');
    const d = /<path fill="#000" d="([^"]*)"/.exec(svg)![1];
    let area = 0;
    let minX = Infinity;
    for (const [, x, , w] of d.matchAll(/M(\d+) (\d+)h(\d+)/g)) {
      area += Number(w);
      minX = Math.min(minX, Number(x));
    }
    expect(area).toBe(m.dark.reduce((s, v) => s + v, 0));
    expect(minX).toBe(4);
  });
});
