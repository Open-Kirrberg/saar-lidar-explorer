import { describe, expect, it } from 'vitest';
import { dataSubPath } from '../scripts/dataPath';

describe('dataSubPath (dev/preview data middleware)', () => {
  it('maps data URLs anchored at the root', () => {
    expect(dataSubPath('/data/karlsberg/manifest.json')).toBe('karlsberg/manifest.json');
    expect(dataSubPath('/data/karlsberg/h/12_3.png?v=2')).toBe('karlsberg/h/12_3.png');
    expect(dataSubPath('/data/pois.geojson#x')).toBe('pois.geojson');
    expect(dataSubPath('/data/a%20b/x.json')).toBe('a b/x.json');
  });

  it('leaves the app source alone (regression: SLE_DATA_DIR 404 on /src/data/*)', () => {
    expect(dataSubPath('/src/data/manifest.ts')).toBeNull();
    expect(dataSubPath('/src/data/decode.worker.ts?worker_file&type=module')).toBeNull();
    expect(dataSubPath('/@fs/x/data/y.ts')).toBeNull();
    expect(dataSubPath('/node_modules/.vite/deps/data/x.js')).toBeNull();
    expect(dataSubPath('/src/main.ts')).toBeNull();
    expect(dataSubPath('/data/')).toBeNull();
  });

  it('honours an absolute base and treats a relative base as the root', () => {
    expect(dataSubPath('/sle/data/overall/manifest.json', '/sle/')).toBe('overall/manifest.json');
    expect(dataSubPath('/sle/src/data/manifest.ts', '/sle/')).toBeNull();
    expect(dataSubPath('/data/overall/manifest.json', './')).toBe('overall/manifest.json');
    expect(dataSubPath('/src/data/manifest.ts', './')).toBeNull();
  });

  it('returns null for malformed escapes', () => {
    expect(dataSubPath('/data/%E0%A4%A')).toBeNull();
  });
});
