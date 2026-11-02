/**
 * Runtime validator for the catalogue (pure TS, no JSON schema).
 *
 * mode 'v1-compatible': accepts model/catalogue.json v1 as written (free-text roof types,
 *                       empty roof objects for unplaced buildings, CW rings as warnings).
 * mode 'v2'           : the stricter shape that upgradeV1() produces and generators rely on.
 * Consistency checks (eaves = base + storeys, ridge reproducible) are warnings in both modes.
 */
import { gridConvergenceDeg } from './frame.ts';
import { signedArea } from './layout/geom.ts';
import { roofSection } from './layout/roof.ts';
import { ROOF_TYPES, SIDE_NAMES } from './spec.ts';

export type ValidationMode = 'v1-compatible' | 'v2';

export interface Issue {
  level: 'error' | 'warning';
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: Issue[];
  warnings: Issue[];
}

const CLASSES = ['CDL', 'WING2', 'RANGE1', 'PAV', 'STABLE', 'RIDE', 'ORANG', 'FARM', 'FARM_GROUP', 'GARD', 'WALL', '?'];
const CONFIDENCE = ['high', 'med', 'low'];
const PLACEMENT = ['lidar', 'lidar+hms', 'map+lidar', 'map', 'existing', 'relative', 'hypothetical', 'unplaced'];
const INTERIOR = ['detailed', 'simple', 'none'];
const STOREY_KINDS = ['plinth', 'basement', 'floor', 'mezzanine', 'kneewall', 'wall', 'mound'];
const TERRAIN_KINDS = ['court', 'terrace', 'scarp', 'avenue', 'rondell', 'pond', 'island', 'dam', 'cascade', 'moat', 'enclosure', 'well', 'wall', 'parterre', 'path'];
const OPENING_KINDS = ['window', 'porte_fenetre', 'portal', 'durchfahrt', 'door', 'double_door', 'jib_door', 'carriage_gate', 'passage', 'oculus', 'dormer', 'cellar_window', 'stall_window', 'blind'];

/** Plausible EPSG:25832 window around Homburg (generous). */
const E_RANGE: [number, number] = [370000, 395000];
const N_RANGE: [number, number] = [5455000, 5475000];
const H_RANGE: [number, number] = [150, 500];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';

export function validateSite(raw: unknown, mode: ValidationMode = 'v2'): ValidationResult {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const err = (path: string, message: string) => errors.push({ level: 'error', path, message });
  const warn = (path: string, message: string) => warnings.push({ level: 'warning', path, message });
  const strict = mode === 'v2';

  if (!isObj(raw)) {
    err('$', 'catalogue must be an object');
    return { ok: false, errors, warnings };
  }
  if (raw.version !== 1 && raw.version !== 2) err('$.version', 'must be 1 or 2');
  if (strict && raw.version !== 2) err('$.version', "mode 'v2' needs version 2 (run upgradeV1)");
  if (raw.crs !== 'EPSG:25832') err('$.crs', "must be 'EPSG:25832'");
  if (raw.height_datum !== 'DHHN2016') err('$.height_datum', "must be 'DHHN2016'");
  if (!isObj(raw.origin) || !isNum(raw.origin.E0) || !isNum(raw.origin.N0)) err('$.origin', 'needs numeric E0, N0');
  else if (raw.origin.E0 !== 381000 || raw.origin.N0 !== 5465000) warn('$.origin', 'differs from the karlsberg AOI origin 381000/5465000');

  const pg = raw.palace_grid;
  if (!isObj(pg) || !isEN(pg.origin_EN) || !isNum(pg.u_azimuth_grid_deg)) err('$.palace_grid', 'needs origin_EN [E,N] and u_azimuth_grid_deg');
  else {
    if (isNum(pg.u_azimuth_true_deg) && isNum(pg.grid_convergence_deg)) {
      const d = pg.u_azimuth_grid_deg + pg.grid_convergence_deg - pg.u_azimuth_true_deg;
      if (Math.abs(d) > 0.1) warn('$.palace_grid', `true azimuth != grid + convergence (off by ${d.toFixed(2)}°)`);
    }
    if (isNum(pg.grid_convergence_deg)) {
      const [E, N] = pg.origin_EN as [number, number];
      const g = gridConvergenceDeg(E, N);
      if (Math.abs(g - pg.grid_convergence_deg) > 0.05) warn('$.palace_grid.grid_convergence_deg', `computed ${g.toFixed(3)}°`);
    }
  }
  if (!isObj(raw.defaults)) err('$.defaults', 'must be an object');

  // ---- buildings ----
  const ids = new Set<string>();
  if (!Array.isArray(raw.buildings)) err('$.buildings', 'must be an array');
  else
    raw.buildings.forEach((b, i) => {
      const p = `$.buildings[${i}]`;
      if (!isObj(b)) return err(p, 'must be an object');
      const id = isStr(b.id) ? b.id : `#${i}`;
      const P = `${p}(${id})`;
      if (!isStr(b.id) || !b.id) err(P + '.id', 'missing');
      else if (ids.has(b.id)) err(P + '.id', 'duplicate id');
      else ids.add(b.id);
      for (const k of ['name_de', 'function', 'built']) if (!isStr(b[k])) err(`${P}.${k}`, 'must be a string');
      if (!CLASSES.includes(b.cls as string)) err(P + '.cls', `unknown class ${String(b.cls)}`);
      if (!CONFIDENCE.includes(b.confidence as string)) err(P + '.confidence', 'must be high|med|low');
      if (!PLACEMENT.includes(b.placement as string)) err(P + '.placement', `unknown placement ${String(b.placement)}`);
      if (!INTERIOR.includes(b.interior as string)) err(P + '.interior', 'must be detailed|simple|none');
      if (!isNum(b.priority)) err(P + '.priority', 'must be a number');
      if (!Array.isArray(b.storeys)) err(P + '.storeys', 'must be an array');
      if (!isObj(b.roof)) err(P + '.roof', 'must be an object');
      if (!isObj(b.facade)) err(P + '.facade', 'must be an object');
      if (b.sources !== undefined && (!Array.isArray(b.sources) || !b.sources.every(isStr))) err(P + '.sources', 'must be string[]');

      const unplaced = b.placement === 'unplaced';
      // footprint / line
      if (b.footprint !== null) {
        if (!Array.isArray(b.footprint) || b.footprint.length < 4 || !b.footprint.every(isEN)) err(P + '.footprint', 'must be null or a closed ring of >= 4 [E,N]');
        else {
          const ring = b.footprint as [number, number][];
          const f = ring[0];
          const l = ring[ring.length - 1];
          if (f[0] !== l[0] || f[1] !== l[1]) err(P + '.footprint', 'ring not closed');
          if (!ring.every(inBounds)) err(P + '.footprint', 'coordinates outside the plausible EPSG:25832 window');
          const A = signedArea(ring);
          if (A === 0) err(P + '.footprint', 'zero area');
          else if (A < 0) (strict ? err : warn)(P + '.footprint', 'ring is clockwise (convention: CCW)');
        }
      } else if (!unplaced && !(Array.isArray(b.line) && b.line.length >= 2 && b.line.every(isEN))) {
        err(P + '.footprint', 'placed building needs a footprint or a line');
      }
      if (b.line !== undefined && (!Array.isArray(b.line) || !b.line.every(isEN) || !b.line.every(inBounds))) err(P + '.line', 'must be [E,N][] in bounds');

      // heights
      if (b.base_h === null) {
        if (!unplaced) err(P + '.base_h', 'null only allowed for unplaced buildings');
      } else if (!isNum(b.base_h) || b.base_h < H_RANGE[0] || b.base_h > H_RANGE[1]) err(P + '.base_h', 'must be a height in m DHHN2016');
      if (b.ground_dtm !== null && b.ground_dtm !== undefined) {
        const g = b.ground_dtm;
        if (!isObj(g) || !isNum(g.min) || !isNum(g.median) || !isNum(g.max)) err(P + '.ground_dtm', 'needs min/median/max');
        else if (!(g.min <= g.median && g.median <= g.max)) err(P + '.ground_dtm', 'min <= median <= max violated');
      }

      // storeys
      let sum = 0;
      if (Array.isArray(b.storeys))
        b.storeys.forEach((s, j) => {
          const sp = `${P}.storeys[${j}]`;
          if (!isObj(s) || !isStr(s.name) || !isNum(s.height) || !isStr(s.tag)) return err(sp, 'needs name, height, tag');
          if (s.height <= 0 || s.height > 20) err(sp + '.height', 'out of range (0, 20] m');
          sum += s.height;
          if (s.kind !== undefined && !STOREY_KINDS.includes(s.kind as string)) err(sp + '.kind', `unknown kind ${String(s.kind)}`);
          if (strict && s.kind === undefined) err(sp + '.kind', 'required in v2');
        });

      // roof
      if (isObj(b.roof)) {
        const r = b.roof;
        const t = r.type;
        if (t === undefined) {
          if (strict || !unplaced) (strict ? err : warn)(P + '.roof.type', 'missing');
        } else if (!isStr(t)) err(P + '.roof.type', 'must be a string');
        else if (!(ROOF_TYPES as readonly string[]).includes(t)) {
          if (strict || !normaliseRoofTypeLoose(t)) err(P + '.roof.type', `unknown roof type '${t}'`);
          else warn(P + '.roof.type', `v1 free-text roof type '${t}' (normalised by upgradeV1)`);
        }
        for (const k of ['pitch_lower', 'pitch_upper']) {
          if (r[k] !== undefined && (!isNum(r[k]) || (r[k] as number) < 0 || (r[k] as number) > 89)) err(`${P}.roof.${k}`, 'must be 0..89 deg');
        }
        for (const k of ['eaves_h', 'ridge_h', 'depth_m']) if (r[k] !== undefined && !isNum(r[k])) err(`${P}.roof.${k}`, 'must be a number');
        if (isNum(b.base_h) && isNum(r.eaves_h) && Array.isArray(b.storeys) && b.storeys.length) {
          const e = b.base_h + sum;
          if (Math.abs(e - r.eaves_h) > 0.05) warn(P + '.roof.eaves_h', `${r.eaves_h} != base_h + Σ storeys = ${e.toFixed(2)}`);
        }
        const rt = isStr(t) ? normaliseRoofTypeLoose(t) : null;
        if (rt && isNum(r.ridge_h) && isNum(r.eaves_h) && isNum(r.depth_m)) {
          const sec = roofSection({
            type: rt,
            depth: r.depth_m,
            eaves_h: r.eaves_h,
            pitch_lower: r.pitch_lower as number | undefined,
            pitch_upper: r.pitch_upper as number | undefined,
            break_ratio: isNum(r.break_ratio) ? r.break_ratio : undefined,
            dome_rise_ratio: isNum(r.dome_rise_ratio) ? r.dome_rise_ratio : undefined,
            matchRidge: false,
          });
          if (Math.abs(sec.ridge_h - r.ridge_h) > 0.1)
            warn(P + '.roof.ridge_h', `${r.ridge_h} not reproduced by the default ${rt} rule (${sec.ridge_h.toFixed(2)}); layout solves to match`);
        }
      }

      // facade (v2 structure)
      if (isObj(b.facade)) {
        const f = b.facade;
        if (f.sides !== undefined) {
          if (!isObj(f.sides)) err(P + '.facade.sides', 'must be an object');
          else
            for (const [k, v] of Object.entries(f.sides)) {
              if (!(SIDE_NAMES as readonly string[]).includes(k)) err(`${P}.facade.sides.${k}`, 'unknown side');
              if (!isObj(v) || !Number.isInteger(v.axes) || (v.axes as number) < 0) err(`${P}.facade.sides.${k}.axes`, 'must be an integer >= 0');
              else if (Array.isArray(v.groups) && (v.groups as number[]).reduce((s, g) => s + g, 0) !== v.axes) err(`${P}.facade.sides.${k}.groups`, 'groups must sum to axes');
            }
        }
        if (f.risalits !== undefined) {
          if (!Array.isArray(f.risalits)) err(P + '.facade.risalits', 'must be an array');
          else
            f.risalits.forEach((r, j) => {
              if (!isObj(r) || !(SIDE_NAMES as readonly string[]).includes(r.side as string) || !Number.isInteger(r.first_axis) || !Number.isInteger(r.axis_count))
                err(`${P}.facade.risalits[${j}]`, 'needs side, first_axis, axis_count');
            });
        }
        if (f.portals !== undefined) {
          if (!Array.isArray(f.portals)) err(P + '.facade.portals', 'must be an array');
          else
            f.portals.forEach((q, j) => {
              if (!isObj(q) || !(SIDE_NAMES as readonly string[]).includes(q.side as string) || !(q.axis === 'centre' || Number.isInteger(q.axis)))
                err(`${P}.facade.portals[${j}]`, 'needs side and axis (int | "centre")');
            });
        }
      }

      // interiors
      const nStoreys = Array.isArray(b.storeys) ? b.storeys.length : 0;
      const roomIds = new Set<string>();
      if (b.rooms !== undefined) {
        if (!Array.isArray(b.rooms)) err(P + '.rooms', 'must be an array');
        else
          b.rooms.forEach((r, j) => {
            const rp = `${P}.rooms[${j}]`;
            if (!isObj(r) || !isStr(r.id) || !isStr(r.name_de) || !isStr(r.tag)) return err(rp, 'needs id, name_de, tag');
            if (roomIds.has(r.id)) err(rp + '.id', 'duplicate room id');
            roomIds.add(r.id);
            if (!Number.isInteger(r.storey) || (r.storey as number) < 0 || (r.storey as number) >= nStoreys) err(rp + '.storey', 'index out of range');
            if (!Array.isArray(r.polygon) || r.polygon.length < 3 || !r.polygon.every(isEN)) err(rp + '.polygon', 'needs >= 3 [s,t] points');
          });
      }
      if (b.openings !== undefined) {
        if (!Array.isArray(b.openings)) err(P + '.openings', 'must be an array');
        else
          b.openings.forEach((o, j) => {
            const op = `${P}.openings[${j}]`;
            if (!isObj(o) || !OPENING_KINDS.includes(o.kind as string)) return err(op + '.kind', 'unknown opening kind');
            for (const k of ['a', 'width', 'height', 'sill']) if (!isNum(o[k])) err(`${op}.${k}`, 'must be a number');
            if (!Number.isInteger(o.storey) || (o.storey as number) < 0 || (o.storey as number) >= nStoreys) err(op + '.storey', 'index out of range');
            const w = o.wall;
            if (!isObj(w)) return err(op + '.wall', 'missing');
            if (w.kind === 'room' && !roomIds.has(w.room as string)) err(op + '.wall.room', `unknown room ${String(w.room)}`);
            else if (w.kind === 'side' && !(SIDE_NAMES as readonly string[]).includes(w.side as string)) err(op + '.wall.side', 'unknown side');
            else if (w.kind === 'segment' && !(isEN(w.p0) && isEN(w.p1))) err(op + '.wall', 'segment needs p0, p1');
            else if (!['room', 'side', 'segment'].includes(w.kind as string)) err(op + '.wall.kind', 'must be side|room|segment');
          });
      }
      if (b.stairs !== undefined && !Array.isArray(b.stairs)) err(P + '.stairs', 'must be an array');
      if (b.court_toward !== undefined && !(isEN(b.court_toward) || isStr(b.court_toward))) err(P + '.court_toward', 'must be [E,N] or a feature id');
    });

  // ---- terrain features ----
  const fids = new Set<string>();
  if (!Array.isArray(raw.terrain_features)) err('$.terrain_features', 'must be an array');
  else
    raw.terrain_features.forEach((t, i) => {
      const p = `$.terrain_features[${i}]`;
      if (!isObj(t)) return err(p, 'must be an object');
      const P = `${p}(${String(t.id)})`;
      if (!isStr(t.id)) err(P + '.id', 'missing');
      else if (fids.has(t.id)) err(P + '.id', 'duplicate id');
      else fids.add(t.id);
      if (!isStr(t.name)) err(P + '.name', 'must be a string');
      if (!TERRAIN_KINDS.includes(t.kind as string)) (strict ? err : warn)(P + '.kind', `unknown kind ${String(t.kind)}`);
      if (!CONFIDENCE.includes(t.confidence as string)) err(P + '.confidence', 'must be high|med|low');
      const g = t.geometry;
      if (!isObj(g)) return err(P + '.geometry', 'missing');
      const c = g.coordinates;
      switch (g.type) {
        case 'Polygon':
          if (!Array.isArray(c) || !c.length || !(c as unknown[]).every((r) => Array.isArray(r) && r.length >= 4 && r.every(isEN))) err(P + '.geometry', 'bad Polygon');
          break;
        case 'LineString':
        case 'MultiPoint':
          if (!Array.isArray(c) || c.length < (g.type === 'LineString' ? 2 : 1) || !c.every(isEN)) err(P + '.geometry', `bad ${g.type}`);
          break;
        case 'Point':
          if (!isEN(c)) err(P + '.geometry', 'bad Point');
          break;
        default:
          err(P + '.geometry.type', `unsupported ${String(g.type)}`);
      }
      for (const k of ['level', 'top', 'foot', 'width', 'water_level', 'crest']) if (t[k] !== undefined && !isNum(t[k])) err(`${P}.${k}`, 'must be a number');
      if (t.trees !== undefined) {
        const tr = t.trees;
        if (!isObj(tr) || !isStr(tr.species) || !isNum(tr.rows) || !isNum(tr.spacing)) err(P + '.trees', 'needs species, rows, spacing');
      }
    });

  return { ok: errors.length === 0, errors, warnings };
}

function isEN(v: unknown): v is [number, number] {
  return Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1]);
}

function inBounds(p: [number, number]): boolean {
  return p[0] >= E_RANGE[0] && p[0] <= E_RANGE[1] && p[1] >= N_RANGE[0] && p[1] <= N_RANGE[1];
}

/** v1 free-text roof type -> RoofType, or null if unknown. */
export function normaliseRoofTypeLoose(t: string): (typeof ROOF_TYPES)[number] | null {
  const s = t.trim().toLowerCase();
  if ((ROOF_TYPES as readonly string[]).includes(s)) return s as (typeof ROOF_TYPES)[number];
  if (s.startsWith('none')) return 'none';
  if (s.includes('mound')) return 'mound';
  if (s.includes('mansard')) return 'mansard';
  if (s.includes('dome') || s.includes('kuppel')) return 'dome';
  if (s.includes('hip') || s.includes('walm')) return 'hip';
  if (s.includes('gable') || s.includes('sattel')) return 'gable';
  if (s.includes('cone')) return 'cone';
  if (s.includes('pavilion') || s.includes('zelt')) return 'pavilion';
  if (s.includes('flat')) return 'flat';
  return null;
}
