/** Public GitHub Pages build: URL resolution for absolute data roots, AOI limits, castle handover. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { aoiBaseUrl, chunkUrl, dataRootUrl, pointTileUrl } from '../src/data/manifest';
import {
  absoluteRoot,
  deployedAois,
  impressumUrl,
  isAbsoluteHttpUrl,
  parseAoiList,
  resolveDataPath,
  viewerUrlOverride,
} from '../src/data/urls';
import { chooseDeployedAoi } from '../src/map/aois';
import { DEFAULT_VIEWER_URL, backTargetUrl, buildViewerUrl, isTrustedHandoverUrl } from '../src/reconstruction/recon';

const DATA = 'https://open-kirrberg.github.io/saar-lidar-data/';
const PAGE = 'https://open-kirrberg.github.io/saar-lidar-explorer/?aoi=overall#382262,5466126,400,90,-20';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('absolute data roots (public build)', () => {
  it('dataRootUrl / aoiBaseUrl / chunk + point tile URLs are absolute on the data host', () => {
    vi.stubEnv('VITE_DATA_URL', DATA);
    vi.stubGlobal('location', { href: PAGE, origin: 'https://open-kirrberg.github.io' });
    expect(dataRootUrl()).toBe(DATA);
    const base = aoiBaseUrl('overall');
    expect(base).toBe(`${DATA}overall/`);
    expect(chunkUrl(base, 'dtm/{i}_{j}.png', 3, 7)).toBe(`${DATA}overall/dtm/3_7.png`);
    expect(pointTileUrl(base, { id: 'a', path: 'pointclouds/a/{tx}_{ty}.bin' } as never, 1, 2)).toMatch(/^https:\/\/open-kirrberg\.github\.io\/saar-lidar-data\/overall\//);
  });

  it('absolute data root also works without a location (workers get absolute URLs either way)', () => {
    vi.stubEnv('VITE_DATA_URL', DATA.slice(0, -1)); // no trailing slash
    vi.stubGlobal('location', undefined);
    expect(dataRootUrl()).toBe(DATA);
    // what the decode worker fetches is the URL built on the main thread — already absolute
    expect(new URL(chunkUrl(aoiBaseUrl('overall'), 'relief/vat/{i}_{j}.png', 0, 0)).host).toBe('open-kirrberg.github.io');
  });

  it('absoluteRoot adds the slash and resolves relative roots against the page', () => {
    expect(absoluteRoot('https://x.org/d', undefined)).toBe('https://x.org/d/');
    expect(absoluteRoot('data/', 'https://h.io/app/index.html')).toBe('https://h.io/app/data/');
    expect(absoluteRoot('/d', 'https://h.io/app/')).toBe('https://h.io/d/');
  });
});

describe('resolveDataPath (xyz URLs may point to a second data repo)', () => {
  it('keeps absolute http(s) templates and appends relative ones without encoding the braces', () => {
    const base = `${DATA}overall/`;
    const abs = 'https://open-kirrberg.github.io/saar-lidar-data-2/overall/xyz/vat/{z}/{x}/{y}.png';
    expect(resolveDataPath(base, abs)).toBe(abs);
    expect(resolveDataPath(base, 'xyz/vat/{z}/{x}/{y}.png')).toBe(`${base}xyz/vat/{z}/{x}/{y}.png`);
    expect(isAbsoluteHttpUrl('HTTPS://a.b/c')).toBe(true);
    expect(isAbsoluteHttpUrl('javascript:alert(1)')).toBe(false);
    expect(resolveDataPath(base, 'javascript:alert(1)')).toBe(`${base}javascript:alert(1)`);
  });
});

describe('deployed AOIs', () => {
  it('parses the comma list, drops invalid ids, empty → null', () => {
    expect(parseAoiList('overall')).toEqual(['overall']);
    expect(parseAoiList(' overall, karlsberg ,../x,overall')).toEqual(['overall', 'karlsberg']);
    expect(parseAoiList('')).toBeNull();
    expect(parseAoiList(undefined)).toBeNull();
    vi.stubEnv('VITE_AOIS', 'overall');
    expect(deployedAois()).toEqual(['overall']);
  });

  it('start AOI: deployed ?aoi= wins, else overall, else the first deployed one', () => {
    expect(chooseDeployedAoi('', ['overall'])).toBe('overall');
    expect(chooseDeployedAoi('?aoi=karlsberg', ['overall'])).toBe('overall');
    expect(chooseDeployedAoi('?aoi=fixture', ['overall'])).toBe('overall');
    expect(chooseDeployedAoi('?aoi=karlsberg', ['overall', 'karlsberg'])).toBe('karlsberg');
    expect(chooseDeployedAoi('', ['kirrberg', 'homburg'])).toBe('kirrberg');
  });

});

describe('castle viewer handover on the public site', () => {
  const pose = { E: 382262.7, N: 5466126.3, h: 380, heading: 90, pitch: -20 };
  const ORIGIN = 'https://open-kirrberg.github.io';

  it('viewerUrlOverride: unset → null, off → off, relative → absolute against the page', () => {
    expect(viewerUrlOverride('', PAGE)).toBeNull();
    expect(viewerUrlOverride('OFF', PAGE)).toBe('off');
    expect(viewerUrlOverride('/saar-lidar-explorer/castle/', PAGE)).toBe(`${ORIGIN}/saar-lidar-explorer/castle/`);
  });

  it('same-origin viewer/back URLs are trusted, other hosts are not', () => {
    expect(isTrustedHandoverUrl(`${ORIGIN}/saar-lidar-explorer/castle/`, ORIGIN)).toBe(true);
    expect(isTrustedHandoverUrl('https://evil.example/castle/', ORIGIN)).toBe(false);
    expect(isTrustedHandoverUrl(`https://user:pw@open-kirrberg.github.io/x`, ORIGIN)).toBe(false);
    expect(isTrustedHandoverUrl(`${ORIGIN}/x`, undefined)).toBe(false); // node: no page origin
    expect(isTrustedHandoverUrl('http://localhost:5260/', undefined)).toBe(true);
  });

  it('buildViewerUrl / backTargetUrl keep the public same-origin URLs', () => {
    vi.stubGlobal('location', { href: PAGE, origin: ORIGIN });
    const v = buildViewerUrl(`${ORIGIN}/saar-lidar-explorer/castle/`, pose, 'fliegen', PAGE);
    expect(v.startsWith(`${ORIGIN}/saar-lidar-explorer/castle/?src=explorer&E=382262.7`)).toBe(true);
    expect(buildViewerUrl('https://evil.example/', pose, 'fliegen', PAGE).startsWith(DEFAULT_VIEWER_URL)).toBe(true);
    const back = backTargetUrl(PAGE, pose);
    expect(back.startsWith(`${ORIGIN}/saar-lidar-explorer/?aoi=overall#382262.7,5466126.3,380,90,-20`)).toBe(true);
  });
});

describe('Impressum link (VITE_IMPRESSUM_URL, „Über & Datenschutz“)', () => {
  it('unset / blank → null (no link, nothing invented)', () => {
    vi.stubEnv('VITE_IMPRESSUM_URL', '');
    expect(impressumUrl()).toBeNull();
    expect(impressumUrl(undefined, PAGE)).toBeNull();
    expect(impressumUrl('   ', PAGE)).toBeNull();
  });

  it('absolute http(s) kept, relative resolved against the page', () => {
    expect(impressumUrl('https://example.org/impressum', PAGE)).toBe('https://example.org/impressum');
    expect(impressumUrl(' http://example.org/i ', undefined)).toBe('http://example.org/i');
    expect(impressumUrl('impressum.html', PAGE)).toBe('https://open-kirrberg.github.io/saar-lidar-explorer/impressum.html');
    expect(impressumUrl('/impressum/', PAGE)).toBe('https://open-kirrberg.github.io/impressum/');
  });

  it('rejects other schemes, credentials and garbage', () => {
    expect(impressumUrl('javascript:alert(1)', PAGE)).toBeNull();
    expect(impressumUrl('data:text/html,x', PAGE)).toBeNull();
    expect(impressumUrl('mailto:a@b.c', PAGE)).toBeNull();
    expect(impressumUrl('https://u:p@example.org/', PAGE)).toBeNull();
    expect(impressumUrl('impressum.html', undefined)).toBeNull(); // relative without a page
  });

  it('reads the env var by default', () => {
    vi.stubGlobal('location', { href: PAGE });
    vi.stubEnv('VITE_IMPRESSUM_URL', 'https://example.org/impressum');
    expect(impressumUrl()).toBe('https://example.org/impressum');
  });
});
