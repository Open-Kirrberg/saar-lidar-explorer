import { describe, expect, it } from 'vitest';
import type { KV } from '../src/markers/markerStore';
import type { ParcelRecord } from '../src/parcelsearch/query';
import {
  SAVED_PARCELS_KEY,
  SavedParcels,
  isQuotaError,
  parcelKey,
  parseSaved,
  sanitizeSaved,
  savedToRecord,
} from '../src/parcelsearch/savedParcels';

const mem = (init: Record<string, string> = {}): KV & { data: Record<string, string> } => {
  const data = { ...init };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
};

const local = (text: string, kennz = `0101230010${text.padStart(5, '0')}_____`): ParcelRecord => ({
  E: 366909.123,
  N: 5458831.456,
  source: 'st-ingbert',
  props: { text, flstkennz: kennz, gemarkung: 'Hassel', flur: 'Flur 6', lage: 'Am Bach' },
  rings: [[[366900, 5458820], [366920, 5458820], [366920, 5458840], [366900, 5458820]]],
});

const online: ParcelRecord = {
  E: 378600,
  N: 5460300,
  source: 'wfs',
  props: { text: '100', flstkennz: '10210000100100______', gemarkung: 'Kirrberg', flur: 'Flur 1' },
  rings: [[[378590.123, 5460290.987], [378610.004, 5460290], [378610, 5460310], [378590.123, 5460290.987]]],
  flaeche_m2: 412.345,
};

let t = Date.parse('2026-11-16T10:00:00Z');
const clock = () => new Date((t += 1000));

describe('savedParcels', () => {
  it('round-trips through storage, newest first', () => {
    const kv = mem();
    const a = new SavedParcels(kv, clock);
    expect(a.add(local('1405/1')).result).toBe('ok');
    expect(a.add(online).result).toBe('ok');
    const b = new SavedParcels(kv, clock);
    expect(b.list().map((s) => s.props.text)).toEqual(['100', '1405/1']);
    const rec = savedToRecord(b.list()[1]);
    expect(rec).toMatchObject({ E: 366909.12, N: 5458831.46, source: 'st-ingbert' });
    expect(rec.props).toEqual(local('1405/1').props);
    expect(JSON.parse(kv.data[SAVED_PARCELS_KEY]).version).toBe(1);
  });

  it('keeps rings only for online hits, rounded to 0.01 m', () => {
    const s = new SavedParcels(mem(), clock);
    s.add(local('7'));
    s.add(online);
    const [wfs, loc] = s.list();
    expect(loc.rings).toBeUndefined();
    expect(wfs.rings?.[0][0]).toEqual([378590.12, 5460290.99]);
    expect(wfs.flaeche_m2).toBe(412.35);
    expect(savedToRecord(wfs).rings?.[0]).toHaveLength(4);
  });

  it('dedupes by Kennzeichen (re-save moves to the top, keeps the note)', () => {
    const s = new SavedParcels(mem(), clock);
    s.add(local('1'));
    s.add(local('2'));
    s.setNote(parcelKey(local('1').props), 'Hohlweg am Waldrand');
    s.add(local('1'));
    expect(s.list().map((x) => x.props.text)).toEqual(['1', '2']);
    expect(s.list()[0].note).toBe('Hohlweg am Waldrand');
    expect(s.has(local('2'))).toBe(true);
    expect(s.remove(parcelKey(local('2').props))).toBe('ok');
    expect(s.has(local('2'))).toBe(false);
  });

  it('falls back to Gemarkung|Flur|Nummer without a Kennzeichen', () => {
    expect(parcelKey({ flstkennz: '', gemarkung: 'Mörsbach', flur: 'Flur 0', text: '200' })).toBe('g:Mörsbach|Flur 0|200');
    expect(parcelKey({ flstkennz: '0101__', gemarkung: 'x', flur: '', text: '1' })).toBe('k:0101');
    const s = new SavedParcels(mem(), clock);
    s.add(local('200', ''));
    s.add(local('200', ''));
    s.add(local('201', ''));
    expect(s.list()).toHaveLength(2);
  });

  it('caps the list, dropping the oldest', () => {
    const s = new SavedParcels(mem(), clock, 3);
    for (const n of ['1', '2', '3']) expect(s.add(local(n)).dropped).toBe(0);
    expect(s.add(local('4')).dropped).toBe(1);
    expect(s.list().map((x) => x.props.text)).toEqual(['4', '3', '2']);
  });

  it('ignores corrupt or foreign stored data and bad entries', () => {
    expect(parseSaved('{not json')).toEqual([]);
    expect(parseSaved('[1,2]')).toEqual([]);
    expect(parseSaved(JSON.stringify({ version: 1, parcels: 'x' }))).toEqual([]);
    const good = { E: 366909, N: 5458831, source: 'st-ingbert', props: { text: '5', flstkennz: '', gemarkung: 'Hassel', flur: 'Flur 6' }, savedAt: '2026-11-16T09:00:00Z' };
    const list = parseSaved(
      JSON.stringify({
        version: 1,
        parcels: [
          good,
          null,
          'x',
          { ...good, E: null },
          { ...good, E: 0, N: 0 },
          { ...good, N: 366909, E: 5458831 },
          { ...good, props: { ...good.props, text: '' } },
          { ...good, props: 'x' },
          { ...good, source: 'wfs', rings: [[[1, 'a']]], props: { ...good.props, text: '6' }, savedAt: 'nope', note: 42 },
        ],
      }),
    );
    expect(list.map((s) => s.props.text)).toEqual(['5', '6']);
    expect(list[1].rings).toBeUndefined();
    expect(list[1].note).toBeUndefined();
    // Local entries never carry rings, even if stored ones do.
    expect(sanitizeSaved({ ...good, rings: [[[1, 2], [3, 4], [5, 6]]] })?.rings).toBeUndefined();
  });

  it('degrades to memory when storage is missing or throws', () => {
    const none = new SavedParcels(null, clock);
    expect(none.persistent).toBe(false);
    expect(none.add(local('1')).result).toBe('unavailable');
    expect(none.list()).toHaveLength(1);

    const broken: KV = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw Object.assign(new Error('denied'), { name: 'SecurityError' });
      },
    };
    const s = new SavedParcels(broken, clock);
    expect(s.list()).toEqual([]);
    expect(s.add(local('1')).result).toBe('unavailable');
    expect(s.persistent).toBe(false);
    expect(s.list()).toHaveLength(1);
  });

  it('keeps the stored list when the storage is full', () => {
    const kv = mem();
    const s = new SavedParcels(kv, clock);
    s.add(local('1'));
    const before = kv.data[SAVED_PARCELS_KEY];
    kv.setItem = () => {
      throw Object.assign(new Error('full'), { name: 'QuotaExceededError', code: 22 });
    };
    expect(s.add(local('2')).result).toBe('quota');
    expect(s.list().map((x) => x.props.text)).toEqual(['1']);
    expect(kv.data[SAVED_PARCELS_KEY]).toBe(before);
    expect(isQuotaError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' })).toBe(true);
    expect(isQuotaError(new Error('x'))).toBe(false);
  });

  it('trims notes and clears empty ones', () => {
    const s = new SavedParcels(mem(), clock);
    s.add(local('1'));
    const k = s.list()[0].key;
    s.setNote(k, '  ' + 'x'.repeat(300));
    expect(s.list()[0].note).toHaveLength(200);
    s.setNote(k, '   ');
    expect('note' in s.list()[0]).toBe(false);
  });
});
