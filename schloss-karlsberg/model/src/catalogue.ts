/**
 * Catalogue loading: v1 (model/catalogue.json as researched) -> v2 (SiteSpec used by all
 * generators). Pure; the upgrade is deterministic and keeps every v1 field.
 *
 * What upgradeV1() adds (each derived value is tagged "I (upgradeV1: ...)"):
 *  - roof.type normalised to RoofType ('earth mound' -> 'mound', 'none (...)' -> 'none'),
 *    roof {} -> {type:'none'}, roof.cover from the material text
 *  - storeys[].kind from the storey name (layout/storeys.ts inferStoreyKind)
 *  - footprints forced CCW
 *  - court_toward for the palace-core buildings (COURT_TOWARD below)
 *  - facade.sides (axes per side) from axes / axes_court_west / axes_garden_east, groups from rhythm
 *  - facade.risalits from rhythm groups; roof.raised from roof.centre ("7-axis centre ...")
 *  - facade.portals from the v1 portal text (a small set of explicit rules, see PORTAL_RULES)
 *  - shutter_type, members_colour, plinth_colour from free text
 * Anything the rules cannot read stays free text for a human to structure in catalogue v2.
 */
import type { Building, EN, Facade, PortalSpec, Roof, RoofCover, SideName, SiteSpec, Storey } from './spec.ts';
import { buildingFrame, sideFacing } from './layout/footprint.ts';
import { centroid, ensureCCW } from './layout/geom.ts';
import { centreAxes, parseRhythm, risalitsFromGroups } from './layout/facade.ts';
import { resolveCourtToward } from './layout/site.ts';
import { inferStoreyKind } from './layout/storeys.ts';
import { normaliseRoofTypeLoose, validateSite, type Issue } from './validate.ts';

/**
 * Which court/forecourt the "court" side of a building faces (I, from research/05 §a-b and the
 * HMS reading in research/06 §1). Buildings not listed face the palace grid origin (Ehrenhof).
 */
export const COURT_TOWARD: Record<string, string> = {
  'KB-B01': 'TF-01', // CdL: court face W to the Ehrenhof, garden face E to avenue KB-12
  'KB-B02': 'TF-01', // south arm
  'KB-B03': 'TF-01', // north arm
  'KB-B04': 'TF-02', // Sammlungsfluegel: court face E to the Kuechenhof
  'KB-B05': 'TF-02', // Kuechenbau
  'KB-B06': 'TF-02', // gallery: windows on the court (south) side
  'KB-B10': 'TF-06', // Orangerie faces the parterre (E)
  'KB-B11': 'TF-06',
  'KB-B12': 'TF-06',
  'KB-B13': 'TF-06',
  'KB-B20': 'TF-05', // Marstall ranges frame the riding court / north terrace
  'KB-B21': 'TF-05',
  'KB-B22': 'TF-05',
  'KB-B24': 'TF-10', // Jaegerhaus, Lazarett, Brauerei line the N-S avenue
  'KB-B25': 'TF-10',
  'KB-B26': 'TF-10',
};

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export function roofCoverFromText(material: string | undefined, type: string): RoofCover | undefined {
  if (type === 'none') return 'none';
  if (type === 'mound') return 'earth';
  if (!material) return undefined;
  const m = material.toLowerCase();
  const hits: [RoofCover, number][] = (
    [
      ['slate', m.search(/slate|schiefer/)],
      ['tile', m.search(/tile|ziegel|biberschwanz/)],
      ['lead', m.search(/lead|blei/)],
      ['copper', m.search(/copper|kupfer/)],
      ['thatch', m.search(/thatch|bark|reed|stroh/)],
    ] as [RoofCover, number][]
  ).filter(([, i]) => i >= 0);
  hits.sort((a, b) => a[1] - b[1]);
  return hits[0]?.[0];
}

function firstHex(text: string | undefined): string | undefined {
  return text?.match(/#[0-9A-Fa-f]{6}/)?.[0];
}

function shutterType(text: string | undefined): Facade['shutter_type'] {
  if (!text) return undefined;
  const t = text.toLowerCase();
  const cands: [NonNullable<Facade['shutter_type']>, number][] = (
    [
      ['louvred', t.search(/louvr|jalousie/)],
      ['plank', t.search(/plank|brett/)],
      ['inside', t.search(/inside/)],
    ] as [NonNullable<Facade['shutter_type']>, number][]
  ).filter(([, i]) => i >= 0);
  // "inside shutters on state floor; louvred on EG" -> the facade shows louvred shutters
  const louvred = cands.find(([k]) => k === 'louvred');
  if (louvred && cands.some(([k]) => k === 'inside')) return 'louvred';
  cands.sort((a, b) => a[1] - b[1]);
  return cands[0]?.[0];
}

const COMPASS: Record<string, number> = { north: 0, east: 90, south: 180, west: 270 };

/**
 * v1 portal text -> structured portals. Explicit, small rules; everything tagged I.
 * Sides are resolved geometrically (compass words -> side whose normal is closest).
 */
function portalsFromText(b: Building, spec: SiteSpec): PortalSpec[] {
  const text = b.facade.portal;
  if (!text || !b.footprint) return [];
  const frame = buildingFrame(b.footprint, { courtToward: resolveCourtToward(spec, b.court_toward, centroid(b.footprint) as EN) });
  const t = text.toLowerCase();
  const tagBase = `I (upgradeV1 from portal text: "${text.slice(0, 60)}${text.length > 60 ? '…' : ''}")`;
  const tag = /hms/.test(t) ? `${tagBase}; HMS` : tagBase;
  const out: PortalSpec[] = [];
  const firstFloor = b.storeys.findIndex((s) => {
    const k = inferStoreyKind(s);
    return k === 'floor' || k === 'basement';
  });
  const floors = b.storeys.map((s, i) => [inferStoreyKind(s), i] as const).filter(([k]) => k === 'floor').map(([, i]) => i);

  if (/durchfahrt|gate passage/.test(t)) {
    out.push({ side: 'court', axis: 'centre', kind: 'durchfahrt', tag });
    out.push({ side: 'garden', axis: 'centre', kind: 'durchfahrt', tag });
  }
  const steps = t.match(/(\d+)\s*-\s*(\d+)\s*steps/);
  if (/court side: central door/.test(t)) {
    out.push({ side: 'court', axis: 'centre', kind: 'portal', steps: steps ? Number(steps[2]) : undefined, tag });
  }
  const pf = t.match(/(\d+)\s*portes-fen/);
  if (pf && /garden/.test(t)) {
    // research/05 §e.1: Beletage salon with portes-fenetres to a balcony
    out.push({ side: 'garden', axis: 'centre', kind: 'porte_fenetre', span_axes: Number(pf[1]), storey: floors[1] ?? floors[0], tag: `${tag}; storey per research/05 §e.1` });
  }
  if (/axis passage/.test(t)) {
    out.push({ side: 'garden', axis: 'centre', kind: 'door', storey: firstFloor, tag: `${tag}; garden door of the through-going vestibule (05 §e.1)` });
  }
  const gate = t.match(/gate on the (north|east|south|west)/);
  if (gate) out.push({ side: sideFacing(frame, COMPASS[gate[1]]), axis: 'centre', kind: 'carriage_gate', tag });
  if (/doors? (to|from) .*kuechenhof/.test(t)) out.push({ side: 'court', axis: 'centre', kind: 'door', tag });
  if (/central and end portals/.test(t)) {
    out.push({ side: 'court', axis: 'centre', kind: 'carriage_gate', tag });
    out.push({ side: 'end_a', axis: 'centre', kind: 'carriage_gate', tag });
    out.push({ side: 'end_b', axis: 'centre', kind: 'carriage_gate', tag });
  }
  const endPortal = t.match(/end portal(?:\s+([\d.]+)\s*x\s*([\d.]+)\s*m)?/);
  if (endPortal && !/central and end portals/.test(t)) {
    // the end nearer to the palace (Ehrenhof centre)
    const o = spec.palace_grid.origin_EN;
    const d = (s: SideName) => {
      const sd = frame.sides[s];
      const m: EN = [(sd.p0EN[0] + sd.p1EN[0]) / 2, (sd.p0EN[1] + sd.p1EN[1]) / 2];
      return Math.hypot(m[0] - o[0], m[1] - o[1]);
    };
    const side: SideName = d('end_a') <= d('end_b') ? 'end_a' : 'end_b';
    out.push({
      side,
      axis: 'centre',
      kind: 'carriage_gate',
      width: endPortal[1] ? Number(endPortal[1]) : undefined,
      height: endPortal[2] ? Number(endPortal[2]) : undefined,
      tag: `${tag}; end nearer the palace`,
    });
  }
  return out;
}

function upgradeRoof(r: Roof | Record<string, never>): Roof {
  const raw = r as Partial<Roof> & { type?: string };
  const typeText = raw.type ?? 'none';
  const type = normaliseRoofTypeLoose(typeText) ?? 'none';
  const out: Roof = { ...(raw as Roof), type };
  if (typeText !== type) out.note = [raw.note, `v1 type: ${typeText}`].filter(Boolean).join('; ');
  out.cover = raw.cover ?? roofCoverFromText(raw.material, type);
  return out;
}

export function upgradeBuilding(b0: Building, spec: SiteSpec): Building {
  const b = clone(b0);
  b.roof = upgradeRoof(b.roof);
  b.storeys = b.storeys.map((s): Storey => ({ ...s, kind: inferStoreyKind(s) }));
  if (b.footprint) b.footprint = ensureCCW(b.footprint);
  if (b.court_toward === undefined && COURT_TOWARD[b.id]) b.court_toward = COURT_TOWARD[b.id];

  const f = b.facade;
  const groups = parseRhythm(f.rhythm);
  if (!f.sides && (f.axes !== undefined || f.axes_court_west !== undefined || f.axes_garden_east !== undefined)) {
    const sides: NonNullable<Facade['sides']> = {};
    const court = f.axes_court_west ?? f.axes;
    const garden = f.axes_garden_east ?? f.axes;
    const tag = f.axis_tags ?? f.tags;
    if (court !== undefined) sides.court = { axes: court, spacing: f.axis_spacing, tag };
    if (garden !== undefined) sides.garden = { axes: garden, spacing: f.axis_spacing, tag };
    if (groups) {
      const total = groups.reduce((s, g) => s + g, 0);
      for (const s of ['garden', 'court'] as const) if (sides[s]?.axes === total) sides[s]!.groups = groups;
    }
    f.sides = sides;
  }
  if (!f.risalits && f.sides) {
    const rs = (['garden', 'court'] as const).flatMap((s) => (f.sides?.[s]?.groups ? risalitsFromGroups(s, f.sides[s]!.groups!) : []));
    if (/central risalit/i.test(f.portal ?? '') && !rs.some((r) => r.kind === 'centre' && r.side === 'court') && f.sides.court) {
      const n = f.sides.court.axes;
      const c = centreAxes(n);
      const count = n % 2 === 1 ? 3 : 2;
      rs.push({ side: 'court', first_axis: Math.max(0, c[0] - (count === 3 ? 1 : 0)), axis_count: count, kind: 'centre', pediment: /pediment/i.test(f.portal ?? ''), tag: 'I (upgradeV1 from portal text)' });
    }
    if (rs.length) f.risalits = rs;
  }
  if (!b.roof.raised && b.roof.centre && groups && groups.length === 3) {
    const m = b.roof.centre.match(/(\d+)-axis centre/);
    if (m && Number(m[1]) === groups[1]) {
      b.roof.raised = [
        {
          side: 'garden',
          first_axis: groups[0],
          axis_count: groups[1],
          extra_h: 1.5,
          type: b.roof.type,
          turret: /dachreiter|spire|turret/i.test(b.roof.centre) ? { kind: 'dachreiter', tag: 'HMS (needle spire)' } : undefined,
          tag: 'I (upgradeV1 from roof.centre); raised amount 1.5 m U',
        },
      ];
    }
  }
  if (!f.portals) {
    const ps = portalsFromText(b, spec);
    if (ps.length) f.portals = ps;
  }
  f.shutter_type ??= shutterType(f.shutters);
  f.members_colour ??= firstHex(f.dressings);
  f.plinth_colour ??= f.dressings?.match(/plinth\s*(#[0-9A-Fa-f]{6})/i)?.[1] ?? (b.cls !== 'GARD' && b.cls !== 'WALL' ? (spec.defaults.plinth as string | undefined) : undefined);
  return b;
}

/** v1 catalogue -> v2 SiteSpec (deep copy; the input is not modified). */
export function upgradeV1(v1: SiteSpec): SiteSpec {
  if (v1.version === 2) return clone(v1);
  const spec = clone(v1);
  spec.buildings = spec.buildings.map((b) => upgradeBuilding(b, spec));
  spec.version = 2;
  spec.status = `${v1.status ?? ''} | upgraded to v2 in memory by upgradeV1()`;
  return spec;
}

export class CatalogueError extends Error {
  constructor(
    message: string,
    readonly issues: Issue[],
  ) {
    super(`${message}\n${issues.map((i) => `  ${i.path}: ${i.message}`).join('\n')}`);
  }
}

/** Validate (v1-compatible or v2), upgrade to v2, validate v2. Throws CatalogueError on errors. */
export function loadSite(raw: unknown): { spec: SiteSpec; warnings: Issue[] } {
  const version = (raw as { version?: unknown })?.version;
  const first = validateSite(raw, version === 2 ? 'v2' : 'v1-compatible');
  if (!first.ok) throw new CatalogueError('catalogue invalid', first.errors);
  const spec = upgradeV1(raw as SiteSpec);
  const second = validateSite(spec, 'v2');
  if (!second.ok) throw new CatalogueError('upgraded catalogue invalid', second.errors);
  return { spec, warnings: [...first.warnings, ...second.warnings] };
}
