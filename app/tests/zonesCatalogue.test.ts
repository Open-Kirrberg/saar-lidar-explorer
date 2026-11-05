/**
 * Built twins, round 5 (zone contract „twin.catalogue“, docs/style.md „Interaction look“): the info-card catalogue
 * `sle-zone-catalogue-v1`, target resolution (product slots, nearest catalogue object, groups), card text and
 * price format, the local discovery store, and the merged pick BVH + highlight on a synthetic scene.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Box3, BoxGeometry, Group, Mesh, MeshBasicMaterial, Ray, Vector2, Vector3 } from 'three';
import type { WebGLRenderer } from 'three';
import {
  cardFor,
  categoryDe,
  DiscoveryStore,
  discoveryStorageKey,
  firstSentences,
  formatPriceEur,
  groupTarget,
  GROUP_NEAR_M,
  isEnclosing,
  parseZoneCatalogue,
  resolveTarget,
  saleUnitDe,
} from '../src/zones/catalogue';
import type { DiscoveryKV, ZoneCatalogue } from '../src/zones/catalogue';
import { parseZoneManifest } from '../src/zones/contract';
import { LIFT, TwinHighlight, TwinTargets } from '../src/zones/runtime/twinPick';
import { isResettableKey } from '../src/ui/settings';

const dir = join(import.meta.dirname, 'fixtures/zones/twin');
const raw = (): Record<string, any> => JSON.parse(readFileSync(join(dir, 'catalogue.json'), 'utf8'));
const cat = (): ZoneCatalogue => parseZoneCatalogue(raw())!;

class MemKV implements DiscoveryKV {
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

describe('zone catalogue: parse', () => {
  it('keeps valid rows, drops broken ones, dedupes discoverable', () => {
    const warns: string[] = [];
    const c = parseZoneCatalogue(raw(), (w) => warns.push(w))!;
    expect([...c.objects.keys()].sort()).toEqual(['raum', 'regal', 'regal/korb-1', 'theke', 'theke/vitrine', 'waise']);
    expect(c.objects.get('theke/vitrine')!.group).toBe('theke');
    expect(c.objects.get('waise')!.group).toBeUndefined();
    expect(c.products.get('testbrot')).toEqual({ name_de: 'Testbrot 500g', short_de: 'Kräftig & saftig.', info_de: 'Ein Brot zum Testen. Mit Kruste. Und Krume.', category: 'brot', price_eur: 3.4, sale_unit: 'Laib' });
    expect(c.products.get('teuer')!.price_eur).toBeNull();
    expect(c.discoverable).toEqual(['testbrot', 'testweck', 'theke', 'regal']);
    expect(c.consent.prices).toBe(true);
    expect(warns.join()).toMatch(/2 invalid row/);
  });

  it('no price consent → no prices; wrong schema → null', () => {
    const j = raw();
    j.consent = {};
    expect(parseZoneCatalogue(j)!.products.get('testbrot')!.price_eur).toBeNull();
    const warns: string[] = [];
    expect(parseZoneCatalogue({ ...raw(), schema: 'bh-catalogue-v1' }, (w) => warns.push(w))).toBeNull();
    expect(parseZoneCatalogue(null)).toBeNull();
    expect(warns.join()).toMatch(/schema/);
  });

  it('strings are plain text, capped', () => {
    const j = raw();
    j.objects.theke.name_de = `<b>x</b>\u0007${'a'.repeat(200)}`;
    const t = parseZoneCatalogue(j)!.objects.get('theke')!.name_de;
    expect(t.length).toBeLessThanOrEqual(80);
    expect(t.startsWith('<b>x</b> a')).toBe(true); // shown via textContent, never as HTML
  });
});

describe('zone contract: twin.catalogue', () => {
  const twinJson = (): Record<string, any> => JSON.parse(readFileSync(join(dir, 'zone.json'), 'utf8'));
  it('a format name stays a name (old packages), a *.json path is the card catalogue', () => {
    expect(parseZoneManifest(twinJson()).value!.twin!.catalogueFile).toBeUndefined();
    const j = twinJson();
    j.twin.catalogue = 'built/catalogue.json';
    const r = parseZoneManifest(j);
    expect(r.warnings).toEqual([]);
    expect(r.value!.twin!.catalogue).toBe('built/catalogue.json');
    expect(r.value!.twin!.catalogueFile).toBe('built/catalogue.json');
  });
  it('an unsafe path gives no cards but keeps the twin', () => {
    const j = twinJson();
    j.twin.catalogue = '../x/catalogue.json';
    const r = parseZoneManifest(j);
    expect(r.value!.twin).not.toBeNull();
    expect(r.value!.twin!.catalogueFile).toBeUndefined();
    expect(r.warnings.join()).toMatch(/twin.catalogue/);
  });
});

describe('zone catalogue: targets', () => {
  it('product slot wins, else the nearest catalogue object by node and id prefix', () => {
    const c = cat();
    expect(resolveTarget([{ id: 'regal/korb-1/platz-01', product: 'testbrot' }], c)).toEqual({ kind: 'product', key: 'regal/korb-1/platz-01', product: 'testbrot' });
    // the mesh of a multi-primitive node has no extras; its parent group does
    expect(resolveTarget([{}, { id: 'theke/vitrine/ebene-2' }], c)).toEqual({ kind: 'object', key: 'theke/vitrine' });
    expect(resolveTarget([{ id: 'theke/faecher' }], c)).toEqual({ kind: 'object', key: 'theke' });
    // unknown product → falls back to the slot's fixture
    expect(resolveTarget([{ id: 'regal/korb-1/platz-02', product: 'gibts-nicht' }], c)).toEqual({ kind: 'object', key: 'regal/korb-1' });
    expect(resolveTarget([{ id: 'umgebung/strasse' }], c)).toBeNull();
    expect(resolveTarget([{ id: '../x' }, { id: 7 }], c)).toBeNull();
  });

  it('a grouped object is its group while far away', () => {
    const c = cat();
    const t = { kind: 'object' as const, key: 'regal/korb-1' };
    expect(groupTarget(t, GROUP_NEAR_M + 1, c)).toEqual({ kind: 'object', key: 'regal' });
    expect(groupTarget(t, GROUP_NEAR_M - 0.5, c)).toBe(t);
    const p = { kind: 'product' as const, key: 's', product: 'testbrot' };
    expect(groupTarget(p, 99, c)).toBe(p);
  });

  it('enclosing boxes (rooms, facades) are not targets', () => {
    expect(isEnclosing(7, 2.3, 5)).toBe(true);
    expect(isEnclosing(5, 1.2, 0.8)).toBe(false); // a long counter
    expect(isEnclosing(4, 2.2, 0.5)).toBe(false); // a tall shelf
    expect(isEnclosing(14, 0.2, 1)).toBe(true);
  });
});

describe('zone catalogue: card text', () => {
  it('formats prices de-DE', () => {
    expect(formatPriceEur(1.2)).toBe('1,20 €');
    expect(formatPriceEur(0.7)).toBe('0,70 €');
    expect(formatPriceEur(45)).toBe('45,00 €');
    expect(formatPriceEur(1234.5)).toBe('1.234,50 €');
    expect(formatPriceEur(0.1 + 0.2)).toBe('0,30 €');
  });
  it('sale units, categories, sentences', () => {
    expect(saleUnitDe('Laib')).toBe('pro Laib');
    expect(saleUnitDe('1/4')).toBe('pro Viertel');
    expect(saleUnitDe('ganze Torte')).toBe('ganze Torte');
    expect(saleUnitDe(null)).toBe('');
    expect(categoryDe('broetchen')).toBe('Brötchen');
    expect(categoryDe('neu')).toBe('Neu');
    expect(firstSentences('Eins. Zwei! Drei? Vier.', 2)).toBe('Eins. Zwei!');
    expect(firstSentences('Nur einer', 3)).toBe('Nur einer');
  });
  it('cards: products with chip + price, objects with ≤ 3 sentences', () => {
    const c = cat();
    expect(cardFor({ kind: 'product', key: 'regal/korb-1/platz-01', product: 'testbrot' }, c)).toEqual({
      key: 'regal/korb-1/platz-01',
      discovery: 'testbrot',
      title: 'Testbrot 500g',
      text: 'Kräftig & saftig. Ein Brot zum Testen.',
      chip: 'Brot',
      price: '3,40 €',
      unit: 'pro Laib',
    });
    expect(cardFor({ kind: 'product', key: 's', product: 'testweck' }, c)!.text).toBe('Ein Brötchen. Knusprig.');
    expect(cardFor({ kind: 'product', key: 's', product: 'torte' }, c)!.unit).toBe('ganze Torte');
    expect(cardFor({ kind: 'object', key: 'theke' }, c)).toEqual({ key: 'theke', discovery: 'theke', title: 'Testtheke', text: 'Hier wird bedient. Vorne ist Glas. Oben ist Stein.' });
    expect(cardFor({ kind: 'object', key: 'nope' }, c)).toBeNull();
  });
});

describe('zone catalogue: discovery store (this device only)', () => {
  it('counts only discoverable ids, persists, resets', () => {
    const kv = new MemKV();
    const s = new DiscoveryStore(kv, 'z', ['a', 'b', 'c']);
    expect([s.found, s.total]).toEqual([0, 3]);
    expect(s.mark('a')).toBe(true);
    expect(s.mark('a')).toBe(false);
    expect(s.mark('nicht-gezaehlt')).toBe(false);
    expect(s.found).toBe(1);
    const again = new DiscoveryStore(kv, 'z', ['a', 'b']);
    expect([again.found, again.total]).toEqual([1, 2]);
    expect(new DiscoveryStore(kv, 'andere-zone', ['a']).found).toBe(0);
    again.reset();
    expect(kv.getItem(discoveryStorageKey('z'))).toBeNull();
    expect(new DiscoveryStore(kv, 'z', ['a']).found).toBe(0);
  });
  it('survives blocked storage and broken JSON', () => {
    const boom: DiscoveryKV = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    const s = new DiscoveryStore(boom, 'z', ['a']);
    expect(s.mark('a')).toBe(true);
    expect(s.found).toBe(1);
    s.reset();
    expect(s.found).toBe(0);
    const kv = new MemKV();
    kv.setItem(discoveryStorageKey('z'), '{kaputt');
    expect(new DiscoveryStore(kv, 'z', ['a']).found).toBe(0);
    expect(new DiscoveryStore(null, 'z', ['a']).mark('a')).toBe(true);
  });
  it('a settings reset keeps the progress', () => {
    expect(isResettableKey(discoveryStorageKey('baeckerei-heusser'))).toBe(false);
  });
});

/** Synthetic room: a counter (two parts), a basket with a product slot, a wall, glass in front of the slot. */
function scene() {
  const root = new Group();
  const box = (id: Record<string, unknown>, w: number, h: number, d: number, x: number, y: number, z: number, opts: { transparent?: boolean } = {}) => {
    const m = new Mesh(new BoxGeometry(w, h, d), new MeshBasicMaterial({ transparent: !!opts.transparent, opacity: opts.transparent ? 0.3 : 1 }));
    m.position.set(x, y + h / 2, z);
    m.userData = id;
    root.add(m);
    return m;
  };
  const sockel = box({ id: 'theke/sockel' }, 3, 1, 0.6, 0, 0, -3);
  // multi-primitive node: a group with extras, child mesh without
  const vit = new Group();
  vit.userData = { id: 'theke/vitrine' };
  const vitMesh = new Mesh(new BoxGeometry(1, 0.3, 0.5), new MeshBasicMaterial());
  vitMesh.position.set(0, 1.15, -3);
  vit.add(vitMesh);
  root.add(vit);
  const korb = box({ id: 'regal/korb-1' }, 0.5, 0.2, 0.4, 3, 1, -3);
  const brot = box({ id: 'regal/korb-1/platz-01', product: 'testbrot', count: 3 }, 0.2, 0.15, 0.2, 3, 1.2, -3);
  box({ id: 'glas' }, 1, 1, 0.02, 3, 0.8, -2.5, { transparent: true });
  box({ id: 'raum/wand' }, 8, 2.5, 0.1, 0, 0, -6); // wall behind
  box({ id: 'raum/boden' }, 8, 0.02, 8, 0, -0.02, -2); // room: wall + floor = enclosing
  box({ id: 'versteckt' }, 0.3, 0.3, 0.3, -2, 0.5, -6.5); // behind the wall
  root.updateMatrixWorld(true);
  return { root, sockel, vitMesh, korb, brot };
}

const rayTo = (from: Vector3, to: Vector3) => new Ray(from.clone(), to.clone().sub(from).normalize());

describe('twin picking (merged BVH)', () => {
  const c = cat();
  c.objects.set('versteckt', { name_de: 'V', info_de: 'hinter der Wand' });
  const s = scene();
  const t = new TwinTargets(c);
  t.index(s.root);

  it('indexes targets, skips enclosing ones', () => {
    expect(t.keys().sort()).toEqual(['regal/korb-1', 'regal/korb-1/platz-01', 'theke', 'theke/vitrine', 'versteckt']);
  });
  it('picks the product through the glass, the counter by its parts, and groups from afar', () => {
    const eye = new Vector3(3, 1.6, -1.5);
    expect(t.pick(rayTo(eye, new Vector3(3, 1.27, -3)))!.target).toEqual({ kind: 'product', key: 'regal/korb-1/platz-01', product: 'testbrot' });
    expect(t.pick(rayTo(new Vector3(0, 1.6, 0), new Vector3(0, 0.5, -2.7)))!.target).toEqual({ kind: 'object', key: 'theke' });
    // vitrine from 3 m → its group, the counter; from 1.5 m → itself
    expect(t.pick(rayTo(new Vector3(0, 1.15, -0.2), new Vector3(0, 1.15, -3)))!.target.key).toBe('theke');
    expect(t.pick(rayTo(new Vector3(0, 1.15, -1.2), new Vector3(0, 1.15, -3)))!.target.key).toBe('theke/vitrine');
    // basket edge from afar → the shelf group
    expect(t.pick(rayTo(new Vector3(3.2, 1.6, 1), new Vector3(3.2, 1.1, -2.8)))!.target.key).toBe('regal');
  });
  it('walls block, floors are not targets, far picks are ignored', () => {
    expect(t.pick(rayTo(new Vector3(-2, 0.65, 0), new Vector3(-2, 0.65, -6.5)))).toBeNull();
    expect(t.pick(rayTo(new Vector3(1.5, 1.6, 0), new Vector3(1.5, 0, -1)))).toBeNull();
    expect(t.pick(rayTo(new Vector3(0, 1.6, 0), new Vector3(0, 0.5, -2.7)), 1)).toBeNull();
  });
  it('look(): a group highlights all its members', () => {
    expect(t.look({ kind: 'object', key: 'theke' })!.meshes).toContain(s.sockel);
    expect(t.look({ kind: 'object', key: 'theke/vitrine' })!.meshes).toEqual([s.vitMesh]);
    expect(t.look({ kind: 'object', key: 'regal' })!.meshes).toEqual([s.korb]);
    expect(t.missing()).toEqual(['testweck']);
  });

  it('highlight: 2 % lift about the foot, outline + rim overlays, restored on clear', () => {
    const r = { getDrawingBufferSize: (v: Vector2) => v.set(800, 600), getPixelRatio: () => 2 } as unknown as WebGLRenderer;
    const h = new TwinHighlight(r);
    const look = t.look({ kind: 'product', key: 'regal/korb-1/platz-01', product: 'testbrot' })!;
    const before = new Box3().setFromObject(s.brot);
    h.set('regal/korb-1/platz-01', look);
    for (let i = 0; i < 30; i++) h.update(0.05);
    s.root.updateMatrixWorld(true);
    expect(s.brot.children.filter((o) => o.visible)).toHaveLength(3);
    const lifted = new Box3().setFromObject(s.brot.children.length ? s.brot : s.brot, false);
    const geomBox = new Box3().copy(s.brot.geometry.boundingBox!).applyMatrix4(s.brot.matrixWorld);
    expect(geomBox.min.y).toBeCloseTo(before.min.y, 6);
    expect(geomBox.max.y - geomBox.min.y).toBeCloseTo((before.max.y - before.min.y) * (1 + LIFT), 6);
    expect(lifted.isEmpty()).toBe(false);
    expect(h.outline.uniforms.uWidth!.value).toBe(6);
    expect(h.ink.uniforms.uWidth!.value).toBe(9);
    h.set(null, null);
    s.root.updateMatrixWorld(true);
    const after = new Box3().copy(s.brot.geometry.boundingBox!).applyMatrix4(s.brot.matrixWorld);
    expect(after.max.y).toBeCloseTo(before.max.y, 6);
    expect(s.brot.children.every((o) => !o.visible)).toBe(true);
    // picks ignore the overlays after a reindex
    t.index(s.root);
    expect(t.keys()).toContain('regal/korb-1/platz-01');
  });
});
