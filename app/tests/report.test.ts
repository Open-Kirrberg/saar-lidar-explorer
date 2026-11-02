import { describe, expect, it } from 'vitest';
import {
  attributionLines,
  escapeHtml,
  escapeMultiline,
  formatDms,
  formatHeight,
  formatUtm,
  formatWgs84Decimal,
  isInlineImage,
  lonLatToPixel,
  metersPerPixel,
  niceScaleLength,
  parseParcelLabel,
  reportFileName,
  slugify,
  tileIntersectsBounds,
  tilesForView,
  toDms,
} from '../src/report/format';
import { buildReportHtml } from '../src/report/template';
import type { ReportData } from '../src/report/template';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const JPG = 'data:image/jpeg;base64,/9j/4AAQ';

describe('DMS formatting', () => {
  it('splits decimal degrees', () => {
    expect(toDms(49.335123, 'lat')).toEqual({ deg: 49, min: 20, sec: 6.44, hemi: 'N' });
    expect(formatDms(49.335123, 'lat')).toBe('49° 20′ 06,44″ N');
    expect(formatDms(7.378456, 'lon')).toBe('7° 22′ 42,44″ E');
  });
  it('carries rounded 60″ into minutes and degrees', () => {
    // 7.9999999° = 7° 59′ 59.99964″ → rounds to 8° 00′ 00,00″
    expect(formatDms(7.9999999, 'lon')).toBe('8° 00′ 00,00″ E');
    // 49° 20′ 59.996″ → 49° 21′ 00,00″
    expect(formatDms(49 + 20 / 60 + 59.996 / 3600, 'lat')).toBe('49° 21′ 00,00″ N');
  });
  it('handles negative values via hemisphere', () => {
    expect(formatDms(-33.5, 'lat')).toBe('33° 30′ 00,00″ S');
    expect(formatDms(-0.25, 'lon')).toBe('0° 15′ 00,00″ W');
  });
  it('formats decimal WGS84, UTM and height', () => {
    expect(formatWgs84Decimal(49.3351234, 7.3784567)).toBe('49.335123° N, 7.378457° E');
    expect(formatUtm(380123.456, 5463210.1)).toEqual({ E: '380123,46 m', N: '5463210,10 m' });
    expect(formatHeight(352.1)).toBe('352,10 m ü. NHN (DHHN2016)');
    expect(formatHeight(null)).toBe('–');
    expect(formatHeight(NaN)).toBe('–');
  });
});

describe('escaping', () => {
  it('escapes HTML specials incl. quotes', () => {
    expect(escapeHtml(`<img src=x onerror="a('b')">&\``)).toBe('&#60;img src=x onerror=&#34;a(&#39;b&#39;)&#34;&#62;&#38;&#96;');
    expect(escapeHtml(null)).toBe('');
  });
  it('keeps line breaks in notes as <br> after escaping', () => {
    expect(escapeMultiline('a<b\r\nc')).toBe('a&#60;b<br>c');
  });
  it('accepts only inline raster data URLs', () => {
    expect(isInlineImage(PNG)).toBe(true);
    expect(isInlineImage(JPG)).toBe(true);
    expect(isInlineImage('https://example.org/a.png')).toBe(false);
    expect(isInlineImage('data:image/svg+xml;base64,PHN2Zz4=')).toBe(false);
    expect(isInlineImage('data:image/png;base64,abc" onerror="x')).toBe(false);
  });
});

describe('parcel label parsing', () => {
  it('splits Gemarkung, Flur, Flurstück and Lage', () => {
    expect(parseParcelLabel('Bruchhof-Sanddorf, Flur 22, Flurstück 5419/2 („Am Karlsberg“)')).toEqual({
      gemarkung: 'Bruchhof-Sanddorf',
      flur: '22',
      flurstueck: '5419/2',
      lage: 'Am Karlsberg',
      raw: 'Bruchhof-Sanddorf, Flur 22, Flurstück 5419/2 („Am Karlsberg“)',
    });
  });
  it('copes with missing parts and empty input', () => {
    expect(parseParcelLabel('Homburg, Flurstück 12')).toMatchObject({ gemarkung: 'Homburg', flur: '', flurstueck: '12' });
    expect(parseParcelLabel('')).toBeNull();
    expect(parseParcelLabel(null)).toBeNull();
  });
});

describe('tile math', () => {
  it('matches the known Web Mercator tile for Karlsberg at z18', () => {
    const p = lonLatToPixel(49.335, 7.378, 18);
    // Reference: x = floor((lon+180)/360·2^z), y via the Mercator formula.
    const n = 2 ** 18;
    const tx = Math.floor(((7.378 + 180) / 360) * n);
    const latR = (49.335 * Math.PI) / 180;
    const ty = Math.floor(((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n);
    expect(Math.floor(p.x / 256)).toBe(tx);
    expect(Math.floor(p.y / 256)).toBe(ty);
  });
  it('covers the canvas exactly with tiles and puts the centre in the middle', () => {
    const tiles = tilesForView(49.335, 7.378, 17, 720, 560);
    const c = lonLatToPixel(49.335, 7.378, 17);
    // Every canvas pixel is inside exactly one tile.
    const covered = (x: number, y: number) => tiles.filter((t) => x >= t.dx && x < t.dx + 256 && y >= t.dy && y < t.dy + 256).length;
    for (const [x, y] of [
      [0, 0],
      [719, 0],
      [0, 559],
      [719, 559],
      [360, 280],
    ])
      expect(covered(x, y)).toBe(1);
    // The tile containing the centre is placed so that the centre pixel lands at (360, 280).
    const tc = tiles.find((t) => t.x === Math.floor(c.x / 256) && t.y === Math.floor(c.y / 256))!;
    expect(tc.dx + (c.x - tc.x * 256)).toBeCloseTo(360, 0);
    expect(tc.dy + (c.y - tc.y * 256)).toBeCloseTo(280, 0);
  });
  it('filters tiles by bounds', () => {
    const bounds: [[number, number], [number, number]] = [
      [49.280571, 7.320101],
      [49.353672, 7.405009],
    ];
    const p = lonLatToPixel(49.335, 7.378, 15);
    expect(tileIntersectsBounds(Math.floor(p.x / 256), Math.floor(p.y / 256), 15, bounds)).toBe(true);
    const far = lonLatToPixel(50.5, 9, 15);
    expect(tileIntersectsBounds(Math.floor(far.x / 256), Math.floor(far.y / 256), 15, bounds)).toBe(false);
  });
  it('computes metres per pixel and nice scale lengths', () => {
    expect(metersPerPixel(0, 0)).toBeCloseTo(156543.03, 1);
    expect(metersPerPixel(49.335, 18)).toBeCloseTo(0.3895, 3);
    expect(niceScaleLength(87)).toBe(50);
    expect(niceScaleLength(230)).toBe(200);
    expect(niceScaleLength(1)).toBe(1);
    expect(niceScaleLength(0)).toBe(0);
  });
});

describe('misc', () => {
  it('builds safe file names', () => {
    expect(slugify('Graben am Hang (Süd) <x>')).toBe('graben-am-hang-sued-x');
    expect(slugify('***')).toBe('marker');
    expect(reportFileName('Trichter/Grube', new Date(2026, 10, 1))).toBe('meldung-trichter-grube-2026-11-01.html');
  });
  it('splits and de-duplicates attribution lines', () => {
    expect(attributionLines('A, x; B;  a, X ', 'B', undefined, 'C')).toEqual(['A, x', 'B', 'C']);
  });
});

function sample(over: Partial<ReportData> = {}): ReportData {
  return {
    marker: {
      id: 'm-1',
      title: 'Wall <b>am</b> Hang',
      note: 'Zeile 1\n<script>alert(1)</script>\n"quoted"',
      category: 'Mauer',
      created: '2026-11-01T10:00:00.000Z',
      E: 382165.25,
      N: 5466074.5,
      h: 352.12,
    },
    lat: 49.335123,
    lon: 7.378456,
    generated: '2026-11-01T12:30:00.000Z',
    aoiName: 'Karlsberg',
    parcel: 'Homburg, Flur 22, Flurstück 5451/3',
    parcelSource: 'ALKIS (lokale Flurstücksdaten)',
    view3d: { image: JPG, caption: '3D-Ansicht', details: ['Blickrichtung 90°'] },
    maps: [
      { image: JPG, caption: 'Detail' },
      { image: 'https://tile.openstreetmap.org/1/1/1.png', caption: 'remote (must be dropped)' },
    ],
    sources: ['© GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0', '<i>evil</i>'],
    notices: [],
    timeZone: 'Europe/Berlin',
    ...over,
  };
}

describe('report HTML', () => {
  const html = buildReportHtml(sample());

  it('is a self-contained document without scripts or remote loads', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain("default-src 'none'; img-src data:");
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<link/i);
    expect(html).not.toMatch(/src="(?!data:)/);
    expect(html).not.toContain('openstreetmap.org/1/1/1.png');
    expect(html).not.toMatch(/url\(/);
    expect(html).toContain('@page{size:A4');
  });

  it('escapes title, notes and sources', () => {
    expect(html).not.toContain('<b>am</b>');
    expect(html).toContain('Wall &#60;b&#62;am&#60;/b&#62; Hang');
    expect(html).toContain('&#60;script&#62;alert(1)&#60;/script&#62;');
    expect(html).toContain('Zeile 1<br>');
    expect(html).toContain('&#34;quoted&#34;');
    expect(html).toContain('&#60;i&#62;evil&#60;/i&#62;');
  });

  it('contains coordinates, parcel parts, category, dates and the heritage note', () => {
    expect(html).toContain('E 382165,25 m · N 5466074,50 m');
    expect(html).toContain('49.335123° N, 7.378456° E');
    expect(html).toContain('49° 20′ 06,44″ N, 7° 22′ 42,44″ E');
    expect(html).toContain('352,12 m ü. NHN');
    expect(html).toContain('Gemarkung <b>Homburg</b> · Flur <b>22</b> · Flurstück <b>5451/3</b>');
    expect(html).toContain('<th>Kategorie (eigene Einschätzung)</th><td>Mauer</td>');
    expect(html).toContain('01.11.2026, 11:00'); // created, Europe/Berlin (CET)
    expect(html).toContain('Schauen, nicht graben.');
    expect(html).toContain('SDschG §§ 3, 8');
    expect(html).toContain('(§ 16)');
    expect(html).toContain('Landesdenkmalamt Saarland');
    expect(html).toContain('Kampfmittelgefahr');
  });

  it('contains exactly the one marker and only inline images', () => {
    expect(html.match(/Marker-ID m-1/g)).toHaveLength(1);
    const imgs = [...html.matchAll(/<img src="([^"]*)"/g)].map((m) => m[1]);
    expect(imgs).toEqual([JPG, JPG]);
  });

  it('degrades gracefully without images or parcel', () => {
    const h = buildReportHtml(sample({ view3d: null, maps: [], parcel: null, notices: ['Kein Kartenausschnitt'] }));
    expect(h).toContain('Keine 3D-Ansicht enthalten.');
    expect(h).toContain('Kein Kartenausschnitt enthalten.');
    expect(h).toContain('nicht ermittelt');
    expect(h).not.toContain('Quelle:');
    expect(h).not.toMatch(/<img/);
  });

  it('has no digging/detector guidance', () => {
    expect(html).not.toMatch(/Spaten|Schaufel|Metalldetektor verwenden|graben Sie/i);
  });
});

describe('3D capture exclusions', async () => {
  const { isReportHidden } = await import('../src/report/snapshot');
  it('hides the F15 candidate group, F17 measurements and flagged objects only', () => {
    expect(isReportHidden({ name: 'Candidates', userData: {} })).toBe(true);
    expect(isReportHidden({ name: 'MeasureOverlay', userData: {} })).toBe(true);
    expect(isReportHidden({ name: '', userData: { reportHide: true } })).toBe(true);
    expect(isReportHidden({ name: 'Terrain', userData: {} })).toBe(false);
    expect(isReportHidden({ name: 'CandidatesX', userData: {} })).toBe(false);
  });
});
