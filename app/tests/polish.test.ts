import { describe, expect, it } from 'vitest';
import { LEGACY_PREFS_KEY, candidatePrefsKey, loadCandidatePrefs, saveCandidatePrefs } from '../src/candidates/prefs';
import { RETRY, planStreaming, retryDelayMs, retryDue } from '../src/pointcloud/lod';
import { formatBytes } from '../src/pointcloud/style';
import { AUTHORITY_LINES_DE, LDA_BODEN_WEB, buildReportHtml } from '../src/report/template';

class MemKV {
  m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

describe('candidate prefs per AOI', () => {
  it('defaults per AOI and keeps AOIs apart', () => {
    const kv = new MemKV();
    const a = loadCandidatePrefs(kv, 'karlsberg', 0.3);
    expect(a.prefs.on).toBe(false);
    expect(a.prefs.filter.minScore).toBe(0.3);
    a.prefs.filter.minScore = 0.6;
    saveCandidatePrefs(kv, 'karlsberg', a.prefs);
    expect(loadCandidatePrefs(kv, 'karlsberg', 0.3).prefs.filter.minScore).toBe(0.6);
    expect(loadCandidatePrefs(kv, 'homburg', 0.25).prefs.filter.minScore).toBe(0.25);
    expect(kv.getItem(candidatePrefsKey('karlsberg'))).not.toBeNull();
  });

  it('migrates the shared legacy key once (min score reset to the AOI default) and removes it', () => {
    const kv = new MemKV();
    kv.setItem(LEGACY_PREFS_KEY, JSON.stringify({ on: true, filter: { minScore: 0.4, showRejected: true, classes: { pit: false } } }));
    const r = loadCandidatePrefs(kv, 'overall', 0.3);
    expect(r.migrated).toBe(true);
    expect(r.prefs.on).toBe(true);
    expect(r.prefs.filter.minScore).toBe(0.3);
    expect(r.prefs.filter.showRejected).toBe(true);
    expect(r.prefs.filter.classes.pit).toBe(false);
    expect(kv.getItem(LEGACY_PREFS_KEY)).toBeNull();
    const other = loadCandidatePrefs(kv, 'karlsberg', 0.3);
    expect(other.migrated).toBe(false);
    expect(other.prefs.on).toBe(false);
    expect(other.prefs.filter.classes.pit).toBe(true);
  });

  it('tolerates broken JSON and missing storage', () => {
    const kv = new MemKV();
    kv.setItem(candidatePrefsKey('x'), '{nope');
    expect(loadCandidatePrefs(kv, 'x', 0.3).prefs.filter.minScore).toBe(0.3);
    expect(loadCandidatePrefs(null, 'x', 0.3).prefs.on).toBe(false);
    expect(saveCandidatePrefs(null, 'x', loadCandidatePrefs(null, 'x', 0.3).prefs)).toBe(false);
  });
});

describe('point cloud retries + memory readout', () => {
  it('backs off exponentially up to the cap and gives up after maxTries', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 10].map((n) => retryDelayMs(n))).toEqual([2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000]);
    expect(retryDue(1, 1000, 999)).toBe(false);
    expect(retryDue(1, 1000, 1000)).toBe(true);
    expect(retryDue(RETRY.maxTries, 0, 1e9)).toBe(false);
  });

  it('a failed tile that is due is planned again', () => {
    const t = { key: 'a', dist: 10, resident: false, loading: false, count: 100 };
    expect(planStreaming([{ ...t, failed: true }], 1000, 1500, 4).load).toEqual([]);
    expect(planStreaming([{ ...t, failed: !retryDue(1, 0, 5000) }], 1000, 1500, 4).load).toEqual(['a']);
  });

  it('formats bytes in de-DE', () => {
    expect(formatBytes(0)).toBe('0 MB');
    expect(formatBytes(12_345_678)).toBe('12,3 MB');
    expect(formatBytes(250_000_000)).toBe('250 MB');
    expect(formatBytes(1_234_000_000)).toBe('1,23 GB');
  });
});

describe('report: competent authority (research/03 only)', () => {
  it('names the LDA Bodendenkmalpflege page and the GDKE, without invented address data', () => {
    expect(LDA_BODEN_WEB).toBe('www.saarland.de/lda/DE/themen-aufgaben/Bodendenkmalpflege');
    const text = AUTHORITY_LINES_DE.join(' ');
    expect(text).toContain('GDKE');
    expect(text).not.toMatch(/\b\d{5}\b|Tel\.|@/); // no postcode, phone or e-mail
    const html = buildReportHtml({
      marker: { id: 'm1', title: 'T', note: '', category: 'Sonstiges', created: '2026-11-01T10:00:00Z', E: 382000, N: 5466000, h: 300 },
      lat: 49.3,
      lon: 7.3,
      generated: '2026-11-01T10:00:00Z',
      aoiName: 'Fixture',
      parcel: null,
      view3d: null,
      maps: [],
      sources: [],
      timeZone: 'UTC',
    });
    expect(html).toContain('Zuständige Stelle:');
    expect(html).toContain(LDA_BODEN_WEB);
  });
});
