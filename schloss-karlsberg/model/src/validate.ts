/**
 * Runtime validator for the catalogue (pure TS, no JSON schema).
 *
 * mode 'v1-compatible': accepts model/catalogue.json v1 as written (free-text roof types,
 *                       empty roof objects for unplaced buildings, CW rings as warnings).
 * mode 'v2'           : the stricter shape that upgradeV1() produces and generators rely on.
 * Consistency checks (eaves = base + storeys, ridge reproducible) are warnings in both modes.
 */
import { gridConvergenceDeg } from './frame.ts';
import { epochIssues } from './layout/epoch.ts';
import { signedArea } from './layout/geom.ts';
import { roofSection } from './layout/roof.ts';
import { FOLLY_KINDS, LANDCOVER_COVERS, parseEvidenceTags, ROOF_TYPES, SIDE_NAMES } from './spec.ts';

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
const TERRAIN_KINDS = ['court', 'terrace', 'scarp', 'avenue', 'rondell', 'pond', 'island', 'dam', 'cascade', 'moat', 'enclosure', 'well', 'wall', 'parterre', 'path', 'lawn', 'clump', 'furniture', 'beds', 'fence'];
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
        if (r.dome_tiers !== undefined && (!Number.isInteger(r.dome_tiers) || (r.dome_tiers as number) < 1 || (r.dome_tiers as number) > 2)) err(P + '.roof.dome_tiers', 'must be 1 or 2');
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
            dome_tiers: isNum(r.dome_tiers) ? r.dome_tiers : undefined,
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
              // wave-8 review fix (KB-I72): continuous balcony across the portes-fenêtres of one entry
              else if (q.balcony_run !== undefined && (!isObj(q.balcony_run) || q.kind !== 'porte_fenetre' || (q.balcony_run.depth !== undefined && !(isNum(q.balcony_run.depth) && (q.balcony_run.depth as number) > 0))))
                err(`${P}.facade.portals[${j}].balcony_run`, "only on a 'porte_fenetre' entry; depth > 0 if given");
              // wave 10 (audit #8): glazed French door
              else if (q.glazed !== undefined && (typeof q.glazed !== 'boolean' || q.kind !== 'door')) err(`${P}.facade.portals[${j}].glazed`, "boolean, only on a 'door' entry");
            });
        }
        if (f.glasshouse !== undefined && !isObj(f.glasshouse)) err(P + '.facade.glasshouse', 'must be an object');
        // KB-I21 / KB-I28 / KB-I29 (wave 6, architecture)
        const nSt = Array.isArray(b.storeys) ? b.storeys.length : 0;
        const storeyList = (v: unknown) => Array.isArray(v) && v.every((x) => Number.isInteger(x) && (x as number) >= 0 && (x as number) < nSt);
        if (f.joinery_colour !== undefined && !(isStr(f.joinery_colour) && /^#[0-9A-Fa-f]{6}$/.test(f.joinery_colour))) err(P + '.facade.joinery_colour', 'must be #RRGGBB');
        if (f.shutters_omit_storeys !== undefined && !storeyList(f.shutters_omit_storeys)) err(P + '.facade.shutters_omit_storeys', 'must be storey indices');
        // wave-6 review fix: per-storey window kind of a side
        if (isObj(f.sides))
          for (const [k, v] of Object.entries(f.sides))
            if (isObj(v) && v.window_kind_storeys !== undefined && !storeyList(v.window_kind_storeys)) err(`${P}.facade.sides.${k}.window_kind_storeys`, 'must be storey indices');
        if (f.fachwerk !== undefined) {
          if (!isObj(f.fachwerk) || !isStr(f.fachwerk.tag)) err(P + '.facade.fachwerk', 'needs a tag');
          else if (f.fachwerk.storeys !== undefined && !storeyList(f.fachwerk.storeys)) err(P + '.facade.fachwerk.storeys', 'must be storey indices');
        }
        if (f.menagerie !== undefined) {
          const me = f.menagerie;
          const mp = P + '.facade.menagerie';
          if (!isObj(me) || !['ring', 'rows', 'island', 'open_pavilion'].includes(me.kind as string) || !isStr(me.tag)) err(mp, "needs kind 'ring' | 'rows' | 'island' | 'open_pavilion' and a tag");
          else if (me.kind === 'island' && (!isObj(me.island) || !isNum(me.island.size) || (me.island.size as number) <= 0 || !isNum(me.island.top_h))) err(mp + '.island', 'needs size > 0 and top_h');
          else if (me.kind === 'ring' && (!isObj(me.ring) || !isEN(me.ring.centre) || !isNum(me.ring.radius) || !Number.isInteger(me.ring.houses) || (me.ring.houses as number) < 3)) err(mp + '.ring', 'needs centre [E,N], radius, houses (int >= 3)');
          else if (me.kind === 'rows' && (!Array.isArray(me.rows) || !me.rows.length || !me.rows.every((r) => isObj(r) && isEN(r.p0) && isEN(r.p1) && Number.isInteger(r.houses) && (r.houses as number) >= 1))) err(mp + '.rows', 'needs rows of {p0, p1, houses}');
          if (isObj(me) && me.channel !== undefined && (!Array.isArray(me.channel) || me.channel.length < 2 || !me.channel.every(isEN))) err(mp + '.channel', 'needs >= 2 [E,N]');
        }
        // KB-I31 / KB-I39 / KB-I30: follies (exterior/folly.ts); a hypothesis by definition
        if (f.folly !== undefined) {
          const fo = f.folly;
          const fp = P + '.facade.folly';
          if (!isObj(fo) || !(FOLLY_KINDS as readonly string[]).includes(fo.kind as string)) err(fp, `needs kind ${FOLLY_KINDS.join(' | ')}`);
          else {
            if (fo.gate_width !== undefined && !(isNum(fo.gate_width) && (fo.gate_width as number) >= 0)) err(fp + '.gate_width', 'must be a number >= 0');
            if (b.confidence !== 'low' || b.placement !== 'hypothetical') warn(fp, "a folly should be placement 'hypothetical' with confidence low");
          }
        }
        // KB-I24: round temple pavilion
        if (f.rotunda !== undefined) {
          const ro = f.rotunda;
          const rp = P + '.facade.rotunda';
          if (!isObj(ro)) err(rp, 'must be an object');
          else {
            if (!['ionic', 'doric', 'tuscan'].includes(ro.order as string)) err(rp + '.order', 'must be ionic|doric|tuscan');
            if (!isNum(ro.axis_azimuth)) err(rp + '.axis_azimuth', 'must be a number (grid deg)');
            if (!Array.isArray(ro.bays) || ro.bays.length < 4 || !ro.bays.every((k) => ['door', 'niche', 'link'].includes(k as string))) err(rp + '.bays', 'needs >= 4 bays of door|niche|link');
            if (ro.portico !== undefined && (!isObj(ro.portico) || !Number.isInteger(ro.portico.columns) || (ro.portico.columns as number) < 2 || !isNum(ro.portico.width) || !isNum(ro.portico.depth) || !Number.isInteger(ro.portico.steps)))
              err(rp + '.portico', 'needs columns (int >= 2), width, depth, steps (int)');
            if (ro.colonnade !== undefined && (!isObj(ro.colonnade) || !isNum(ro.colonnade.length) || !isNum(ro.colonnade.width) || !Number.isInteger(ro.colonnade.columns_per_side) || !isNum(ro.colonnade.floor_h) || !isNum(ro.colonnade.eaves_h)))
              err(rp + '.colonnade', 'needs length, width, columns_per_side (int), floor_h, eaves_h');
          }
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
            // KB-I26/I27: optional silk hue and damask border colour
            if (isObj(r.finish)) for (const k of ['colour', 'border']) if (r.finish[k] !== undefined && !(isStr(r.finish[k]) && /^#[0-9A-Fa-f]{6}$/.test(r.finish[k] as string))) err(`${rp}.finish.${k}`, 'must be #RRGGBB');
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
      for (const m of epochIssues(b.epoch)) err(P + '.epoch', m);
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
      for (const m of epochIssues(t.epoch)) err(P + '.epoch', m);
      // KB-I12/I13 garden fields
      for (const k of ['radius', 'fountain_h']) if (t[k] !== undefined && !(isNum(t[k]) && (t[k] as number) > 0)) err(`${P}.${k}`, 'must be a positive number');
      if (t.placement !== undefined && t.placement !== 'hypothetical') err(P + '.placement', "only 'hypothetical'");
      if (t.mix !== undefined) {
        const mx = t.mix;
        if (!Array.isArray(mx) || !mx.length || !mx.every((e) => isObj(e) && isStr(e.species) && isNum(e.share) && e.share > 0)) err(P + '.mix', 'needs [{species, share > 0}]');
        else if (Math.abs(mx.reduce((a, e) => a + (e as { share: number }).share, 0) - 1) > 0.01) err(P + '.mix', 'shares must sum to 1');
      }
      if (t.kind === 'clump' && g.type === 'Point' && !isNum(t.radius)) err(P + '.radius', 'a Point clump needs a radius');
      if (t.coping !== undefined && !(isObj(t.coping) && isNum(t.coping.width) && isNum(t.coping.height))) err(P + '.coping', 'needs width, height');
      // KB-I33/I34/I36 garden detail fields (wave 5)
      if (t.items !== undefined) {
        const it = t.items;
        if (!Array.isArray(it) || !it.length || !it.every((e) => isObj(e) && (e.type === 'bench' || e.type === 'herm') && isEN(e.at) && isNum(e.facing))) err(P + '.items', "needs [{type: 'bench'|'herm', at: [E,N], facing: deg}]");
      }
      if (t.kind === 'furniture' && t.items === undefined) err(P + '.items', 'a furniture feature needs items');
      if (t.parterre !== undefined) {
        const pt = t.parterre;
        if (!isObj(pt) || pt.type !== 'angloise' || !Array.isArray(pt.panels) || pt.panels.length !== 2 || !pt.panels.every((n) => Number.isInteger(n) && (n as number) >= 1)) err(P + '.parterre', "needs {type: 'angloise', panels: [nu, nv] >= 1}");
        if (g.type !== 'Polygon') err(P + '.parterre', 'needs a Polygon geometry');
      }
      if (t.fence !== undefined) {
        const fc = t.fence;
        if (!isObj(fc) || fc.type !== 'treillage' || !isNum(fc.height) || !isNum(fc.portal_height) || !Array.isArray(fc.portals) || !fc.portals.every(isEN)) err(P + '.fence', "needs {type: 'treillage', height, portal_height, portals: [E,N][]}");
      }
      if (t.beds !== undefined) {
        const bd = t.beds;
        const lines = (x: unknown) => x === undefined || (Array.isArray(x) && x.every((l) => Array.isArray(l) && l.length === 2 && l.every(isEN)));
        if (!isObj(bd) || !Array.isArray(bd.quarters) || bd.quarters.length !== 2 || !bd.quarters.every((n) => Number.isInteger(n) && (n as number) >= 1) || !lines(bd.frame_rows) || !lines(bd.espaliers)) err(P + '.beds', 'needs {quarters: [nu, nv], frame_rows?, espaliers?: 2-point lines}');
      }
      if (t.kind === 'beds' && (t.beds === undefined || g.type !== 'Polygon')) err(P + '.beds', 'a beds feature needs a Polygon and beds');
      // KB-I68 fence features
      if (t.fence_line !== undefined) {
        const fl = t.fence_line;
        if (!isObj(fl) || (fl.type !== 'post_rail' && fl.type !== 'barriere') || !(isNum(fl.height) && (fl.height as number) > 0) || (fl.post_spacing !== undefined && !(isNum(fl.post_spacing) && (fl.post_spacing as number) > 0)) || (fl.rails !== undefined && !(Number.isInteger(fl.rails) && (fl.rails as number) >= 1)))
          err(P + '.fence_line', "needs {type: 'post_rail'|'barriere', height > 0, post_spacing? > 0, rails? >= 1}");
      }
      if (t.kind === 'fence') {
        if (t.fence_line === undefined || g.type !== 'LineString') err(P + '.fence_line', 'a fence feature needs a LineString and fence_line');
        else if (isObj(t.fence_line) && t.fence_line.type === 'barriere' && Array.isArray(c) && c.length !== 2) err(P + '.geometry', 'a barriere needs a 2-point line');
      }
    });

  // ---- land cover (KB-I09; optional top-level list, see LandcoverArea) ----
  if (raw.landcover !== undefined) {
    if (!Array.isArray(raw.landcover)) err('$.landcover', 'must be an array');
    else {
      const lids = new Set<string>();
      raw.landcover.forEach((a, i) => {
        const p = `$.landcover[${i}]`;
        if (!isObj(a)) return err(p, 'must be an object');
        const P = `${p}(${String(a.id)})`;
        if (!isStr(a.id) || !/^LC-\d+$/.test(a.id)) err(P + '.id', "must be 'LC-nn'");
        else if (lids.has(a.id)) err(P + '.id', 'duplicate id');
        else lids.add(a.id);
        if (!(LANDCOVER_COVERS as readonly string[]).includes(a.cover as string)) err(P + '.cover', `unknown cover ${String(a.cover)}`);
        if (!isStr(a.name_de) || !a.name_de.trim()) err(P + '.name_de', 'must be a non-empty string');
        if (!CONFIDENCE.includes(a.confidence as string)) err(P + '.confidence', 'must be high|med|low');
        if (!isStr(a.tag) || !parseEvidenceTags(a.tag).length) err(P + '.tag', 'needs evidence tags (D, D->, I, N, U, HMS)');
        const g = a.geometry;
        const r = isObj(g) && g.type === 'Polygon' && Array.isArray(g.coordinates) && g.coordinates.length === 1 ? g.coordinates[0] : null;
        if (!Array.isArray(r) || r.length < 4 || !r.every(isEN)) err(P + '.geometry', 'needs a Polygon with one ring of >= 4 [E,N] points');
        else {
          const f = r[0] as [number, number];
          const l = r[r.length - 1] as [number, number];
          if (f[0] !== l[0] || f[1] !== l[1]) err(P + '.geometry', 'ring must be closed');
          else if (signedArea(r as [number, number][]) <= 0) err(P + '.geometry', 'ring must be counter-clockwise');
          if (!(r as [number, number][]).every(inBounds)) err(P + '.geometry', 'outside the EPSG:25832 window');
        }
        if (a.min_slope !== undefined && !(isNum(a.min_slope) && a.min_slope > 0 && a.min_slope <= 2)) err(P + '.min_slope', 'must be in (0, 2] (rise / run)');
        if (a.mix !== undefined) {
          const mx = a.mix;
          if (a.cover !== 'forest') warn(P + '.mix', 'mix only applies to forest');
          if (!Array.isArray(mx) || !mx.length || !mx.every((e) => isObj(e) && isStr(e.species) && isNum(e.share) && e.share > 0)) err(P + '.mix', 'needs [{species, share > 0}]');
          else if (Math.abs(mx.reduce((s, e) => s + (e as { share: number }).share, 0) - 1) > 0.01) err(P + '.mix', 'shares must sum to 1');
        }
        for (const m of epochIssues(a.epoch)) err(P + '.epoch', m);
      });
    }
  }

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
