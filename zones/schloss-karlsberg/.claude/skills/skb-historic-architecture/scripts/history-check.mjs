#!/usr/bin/env node
/**
 * history-check: read-only audit of the Karlsberg 1789 model against the research findings.
 *
 *   node .claude/skills/skb-historic-architecture/scripts/history-check.mjs            # report
 *   node .claude/skills/skb-historic-architecture/scripts/history-check.mjs --open     # only open items
 *   node .claude/skills/skb-historic-architecture/scripts/history-check.mjs --strict   # exit 1 on integrity failures
 *
 * Run from the zones/schloss-karlsberg/ root (or anywhere: paths resolve from this file).
 * Reads model/catalogue.json, model/src/layout/grammar.ts, model/src/context.ts and model/src/materials/index.ts.
 * Writes nothing. Three kinds of checks:
 *   INTEGRITY  evidence discipline (confidence, placement, sources, tags). Should always pass.
 *   WARN       something that is legal but often unintended; decide and say so in the tag.
 *   DELTA      a documented finding from research/09-11 that the model may not reflect yet. OPEN is not an
 *              error: it is a to-do with its reference. When you implement one, it flips to DONE by itself.
 * The deltas encode the research digest of 2026-11-02; update them when the research moves on.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const spec = JSON.parse(read('model/catalogue.json'));
const grammar = read('model/src/layout/grammar.ts');
const context = read('model/src/context.ts');
const materials = read('model/src/materials/index.ts');

const args = new Set(process.argv.slice(2));
const B = new Map(spec.buildings.map((b) => [b.id, b]));
const placed = spec.buildings.filter((b) => b.placement !== 'unplaced');
/**
 * Whether a building stands in the default 1789 scene. 'hypothetical' still counts as shown: DEFAULT_BUILD_OPTIONS
 * has showHypothetical = true (model/src/context.ts), and 'hypothetical' means "uncertain", not "another date".
 * A building is out of the 1789 state when it is unplaced/absent or carries an epoch marker. The planned field is
 * `epoch: { from?, to? }` in years, `to` inclusive (research/11 §6.1, backlog KB-I03); free-text markers such as
 * `status: 'ephemeral-1785'` (research/10 §b.2 proposal), `time_slice` or `exists` are also recognised.
 */
const inYear = (e, y) => (typeof e.from !== 'number' || y >= e.from) && (typeof e.to !== 'number' || y <= e.to);
const shownIn1789 = (b) => {
  if (!b || b.placement === 'unplaced') return false;
  for (const e of [b.epoch, b.exists]) if (e && typeof e === 'object' && !inYear(e, 1789)) return false;
  const marks = [b.status, b.epoch, b.time_slice, b.exists]
    .filter((x) => x !== undefined && typeof x !== 'object')
    .map(String)
    .join(' ');
  return !/ephemeral|1785|^false$|removed/i.test(marks);
};
const TAG_RE = /(^|[\s(\[;,])(D->|D→|D|I|N|U|HMS)(?=[\s)\],;:.]|$)/;
const hasTag = (s) => typeof s === 'string' && TAG_RE.test(s);
const PALACE_GROUP = ['KB-B01', 'KB-B02', 'KB-B03', 'KB-B04', 'KB-B05', 'KB-B06', 'KB-B07', 'KB-B10', 'KB-B11', 'KB-B12'];
const COURT_CLASSES = new Set(['CDL', 'WING2', 'RANGE1', 'ORANG', 'PAV']);
const FARM_CLASSES = new Set(['FARM', 'FARM_GROUP', 'STABLE', 'RIDE']);
const rooms = (id) => B.get(id)?.rooms ?? [];
const roomsOn = (id, storey) => rooms(id).filter((r) => r.storey === storey);
const named = (list, re) => list.filter((r) => re.test(r.name_de));
const hexEq = (a, b) => String(a ?? '').toUpperCase() === b.toUpperCase();

/** @type {{id:string, kind:'INTEGRITY'|'WARN'|'DELTA', ref:string, title:string, run:()=>{ok:boolean, detail:string}}[]} */
const checks = [
  // ------------------------------------------------------------------ integrity
  {
    id: 'E1', kind: 'INTEGRITY', ref: 'CLAUDE.md Evidence; architecture.md §3.8',
    title: 'every placed building has confidence, placement and at least one source',
    run: () => {
      const bad = placed.filter((b) => !b.confidence || !b.placement || !(b.sources ?? []).length).map((b) => b.id);
      return { ok: !bad.length, detail: bad.length ? `missing: ${bad.join(', ')}` : `${placed.length} placed buildings` };
    },
  },
  {
    id: 'E2', kind: 'INTEGRITY', ref: 'architecture.md §3.8',
    title: 'every placed building carries evidence tags (facade/roof tags, storey tags or notes)',
    run: () => {
      const bad = placed.filter((b) => ![b.facade?.tags, b.roof?.tags, b.notes, ...(b.storeys ?? []).map((s) => s.tag)].some(hasTag)).map((b) => b.id);
      return { ok: !bad.length, detail: bad.length ? `untagged: ${bad.join(', ')}` : 'all tagged' };
    },
  },
  {
    id: 'E3', kind: 'INTEGRITY', ref: 'architecture.md §4.1 Room.tag',
    title: 'every catalogue room has an evidence tag',
    run: () => {
      const bad = spec.buildings.flatMap((b) => (b.rooms ?? []).filter((r) => !hasTag(r.tag)).map((r) => r.id));
      return { ok: !bad.length, detail: bad.length ? `untagged rooms: ${bad.slice(0, 12).join(', ')}${bad.length > 12 ? ' …' : ''}` : `${spec.buildings.reduce((s, b) => s + (b.rooms?.length ?? 0), 0)} rooms tagged` };
    },
  },
  {
    id: 'E4', kind: 'WARN', ref: 'exterior/index.ts palette(); research/09 §2.5 Result',
    title: 'court-building members colour does not accidentally select red sandstone (palette maps #A…/#9…/#8… to stone.red)',
    run: () => {
      const bad = placed.filter((b) => COURT_CLASSES.has(b.cls) && /^#(A|9|8)/i.test(b.facade?.members_colour ?? '')).map((b) => `${b.id} ${b.facade.members_colour}`);
      return { ok: !bad.length, detail: bad.length ? `red members: ${bad.join(', ')} (intended?)` : 'grey members on court buildings' };
    },
  },
  // ------------------------------------------------------------------ deltas: what the 1789 state shows
  {
    id: 'H01', kind: 'DELTA', ref: 'research/10 §0.3, §b.2 (T1 pp. 386 f., T6)',
    title: 'KB-B13 Orangerie rotunda was a temporary 1785 timber-and-canvas fair building: not in the 1789 state',
    run: () => ({ ok: !shownIn1789(B.get('KB-B13')), detail: `KB-B13 placement=${B.get('KB-B13')?.placement}` }),
  },
  {
    id: 'H02', kind: 'DELTA', ref: 'research/10 §b.4 (T1 p. 387)',
    title: 'KL-B49 Hymen temple was a 1785 fireworks stage set: not in the 1789 state',
    run: () => ({ ok: !shownIn1789(B.get('KL-B49')), detail: `KL-B49 placement=${B.get('KL-B49')?.placement}` }),
  },
  {
    id: 'H03', kind: 'DELTA', ref: 'research/10 §0.2, §b.1 KB-B07 (T5, T7, R12)',
    title: 'KB-B07 is a round Ionic Tempelzimmer/Rotunde with pedimented portico, not a square pavilion',
    run: () => {
      const b = B.get('KB-B07');
      const ok = !!b && ['dome', 'cone'].includes(b.roof?.type) && /tempel|rotunde/i.test(b.name_de);
      return { ok, detail: `KB-B07 "${b?.name_de}" roof=${b?.roof?.type}` };
    },
  },
  {
    id: 'H04', kind: 'DELTA', ref: 'research/10 §b.1 KB-B06 (T5 n. 47)',
    title: 'KB-B06 gallery + end rotunda ≈ 95–97 m ("cent pas"); a Bibliothekspavillon leaves mid-gallery (KB-B06a)',
    run: () => ({ ok: B.has('KB-B06a'), detail: B.has('KB-B06a') ? 'KB-B06a present' : 'no KB-B06a; check gallery length by hand' }),
  },
  // ------------------------------------------------------------------ deltas: rooms
  {
    id: 'H05', kind: 'DELTA', ref: 'research/10 §b.1 KB-B02 (T5, R12)',
    title: 'KB-B02 EG holds no Silberkammer/Speisesaal (those belong to KB-B03 and KB-B05 OG)',
    run: () => {
      const bad = named(roomsOn('KB-B02', 1), /silber|speisesaal/i).map((r) => r.name_de);
      return { ok: !bad.length, detail: bad.length ? `KB-B02 EG: ${bad.join(', ')}` : 'clean' };
    },
  },
  {
    id: 'H06', kind: 'DELTA', ref: 'research/10 §0.4, §b.1 KB-B05 (T1 p. 338, R12 OG 24)',
    title: 'Großer Speisesaal on the upper floor of the kitchen wing KB-B05',
    run: () => {
      const hit = named(roomsOn('KB-B05', 2), /speisesaal/i);
      return { ok: hit.length > 0, detail: hit.length ? hit.map((r) => r.id).join(', ') : `KB-B05 OG: ${roomsOn('KB-B05', 2).map((r) => r.name_de).join(', ')}` };
    },
  },
  {
    id: 'H07', kind: 'DELTA', ref: 'research/10 §0.5, §b.1 KB-B04 (T5)',
    title: 'KB-B04: library (four rooms ≈ 52 m) on the EG; Naturalienkabinett + Waffensammlung on the 1st OG',
    run: () => {
      const eg = named(roomsOn('KB-B04', 1), /bibliothek/i).length > 0;
      const og = named(roomsOn('KB-B04', 2), /waffen/i).length > 0;
      return { ok: eg && og, detail: `library on EG: ${eg}; Waffensammlung on OG: ${og}` };
    },
  },
  {
    id: 'H08', kind: 'DELTA', ref: 'research/10 §b.1 KB-B03 (T5)',
    title: 'KB-B03 (Duke) OG: kleiner + großer Bildersaal (and Salon Mannlich); Silberkammer in the N wing',
    run: () => {
      const n = named(roomsOn('KB-B03', 2), /bildersaal/i).length;
      return { ok: n >= 2, detail: `${n} Bildersäle on KB-B03 OG` };
    },
  },
  {
    id: 'H09', kind: 'DELTA', ref: 'research/09 §6.2 M8, §6.5 C5; research/10 §c.2',
    title: 'Gelber Salon has a yellow silk finish (wall.silk.yellow)',
    run: () => {
      const r = spec.buildings.flatMap((b) => b.rooms ?? []).filter((x) => /gelber salon/i.test(x.name_de));
      const ok = r.length > 0 && r.every((x) => /yellow/.test(x.finish?.walls ?? ''));
      return { ok, detail: r.map((x) => `${x.id}: ${x.finish?.walls}`).join(', ') || 'no Gelber Salon' };
    },
  },
  {
    id: 'H10', kind: 'DELTA', ref: 'research/10 §b.2 KB-B11/12 (T5)',
    title: 'Komödienhaus (1783) was attached to the SOUTH Orangerie wing KB-B12, not KB-B11',
    run: () => {
      const n11 = /komödie|theater/i.test(B.get('KB-B11')?.name_de ?? '');
      const n12 = /komödie|theater/i.test(B.get('KB-B12')?.name_de ?? '');
      return { ok: !n11 && n12, detail: `KB-B11 "${B.get('KB-B11')?.name_de}" / KB-B12 "${B.get('KB-B12')?.name_de}"` };
    },
  },
  {
    id: 'H11', kind: 'DELTA', ref: 'research/10 §b.3 KB-B23 (T1 p. 365)',
    title: 'KB-B23 is the Hundezwinger ("ein Zwinger für tausend Hunde") — drop the question mark',
    run: () => ({ ok: !/\?/.test(B.get('KB-B23')?.name_de ?? '?'), detail: `"${B.get('KB-B23')?.name_de}"` }),
  },
  {
    id: 'H12', kind: 'DELTA', ref: 'research/10 §b.4 KL-B40 (T20)',
    title: 'KL-B40 Amphitheater: 19 square slate-roofed houses, not half-round cages',
    run: () => ({ ok: !/halbrund/i.test(B.get('KL-B40')?.name_de ?? ''), detail: `"${B.get('KL-B40')?.name_de}"` }),
  },
  // ------------------------------------------------------------------ deltas: exterior grammar and colours
  {
    id: 'H13', kind: 'DELTA', ref: 'research/09 §3.2, §6.5 C3 (Baunetz; HMS)',
    title: 'court-building shutters blue-grey #5F6F7A (catalogue shutter_colour)',
    run: () => {
      const court = placed.filter((b) => COURT_CLASSES.has(b.cls) && b.facade?.shutter_colour);
      const off = court.filter((b) => !hexEq(b.facade.shutter_colour, '#5F6F7A'));
      const cols = [...new Set(off.map((b) => b.facade.shutter_colour))];
      return { ok: !off.length, detail: off.length ? `${off.length}/${court.length} court buildings use ${cols.join(', ')}` : 'all blue-grey' };
    },
  },
  {
    id: 'H14', kind: 'DELTA', ref: 'research/09 §6.2 M1',
    title: 'material wood.shutter base colour blue-grey #5F6F7A',
    run: () => {
      const m = materials.match(/'wood\.shutter':\s*\{\s*color:\s*'(#[0-9A-Fa-f]{6})'/);
      return { ok: !!m && hexEq(m[1], '#5F6F7A'), detail: `wood.shutter = ${m?.[1] ?? '?'}` };
    },
  },
  {
    id: 'H15', kind: 'DELTA', ref: 'research/09 §6.2 M4, §6.5 C4',
    title: 'painted-render member material render.member (#B9B8B2) exists',
    run: () => ({ ok: /'render\.member'/.test(context), detail: /'render\.member'/.test(context) ? 'in MATERIAL_NAMES' : 'not in MATERIAL_NAMES' }),
  },
  {
    id: 'H16', kind: 'DELTA', ref: 'research/09 §3.1, §6.1 G1–G3',
    title: 'class-aware glazing table GLAZING in grammar.ts (2 panes/leaf on wings, 1 on CdL state floor)',
    run: () => ({ ok: /export const GLAZING\b/.test(grammar), detail: /export const GLAZING\b/.test(grammar) ? 'GLAZING present' : 'glazingGrid() still uses one 0.42 × 0.48 m rule (exterior/cut.ts)' }),
  },
  {
    id: 'H17', kind: 'DELTA', ref: 'research/09 §2.3, §6.1 G4, §6.5 C1',
    title: 'Fachwerk flag (0.30 m wall, 0.12–0.15 m reveals) on candidates, gallery KB-B06 first',
    run: () => {
      const f = placed.filter((b) => b.facade?.fachwerk).map((b) => b.id);
      return { ok: f.length > 0, detail: f.length ? f.join(', ') : 'no facade.fachwerk anywhere' };
    },
  },
  {
    id: 'H18', kind: 'DELTA', ref: 'research/09 §2.7, §6.3 E8 (PV 1791 colour code)',
    title: 'roof split: slate on the palace group, red tile on service/farm buildings',
    run: () => {
      const palaceTile = PALACE_GROUP.filter((id) => shownIn1789(B.get(id)) && B.get(id).roof?.cover === 'tile');
      const farmSlate = placed.filter((b) => FARM_CLASSES.has(b.cls) && b.roof?.cover === 'slate').map((b) => b.id);
      return { ok: !palaceTile.length && !farmSlate.length, detail: `palace on tile: ${palaceTile.join(', ') || '-'}; farm/stable on slate: ${farmSlate.join(', ') || '-'}` };
    },
  },
  {
    id: 'H19', kind: 'DELTA', ref: 'research/09 §6.2 M2',
    title: 'slate reads blue-grey (#4A525C) rather than neutral grey',
    run: () => {
      const m = materials.match(/'roof\.slate':\s*\{\s*color:\s*'(#[0-9A-Fa-f]{6})'/);
      return { ok: !!m && hexEq(m[1], '#4A525C'), detail: `roof.slate = ${m?.[1] ?? '?'}; defaults.slate = ${spec.defaults?.slate}` };
    },
  },
  {
    id: 'H20', kind: 'DELTA', ref: 'research/09 §6.5 C2, §1.3.6',
    title: 'facade.build_year present on palace-group buildings (drives limewash age)',
    run: () => {
      const miss = PALACE_GROUP.filter((id) => shownIn1789(B.get(id)) && B.get(id).facade?.build_year === undefined);
      return { ok: !miss.length, detail: miss.length ? `missing: ${miss.join(', ')}` : 'all set' };
    },
  },
];

let integrityFail = 0;
const rows = [];
for (const c of checks) {
  let r;
  try {
    r = c.run();
  } catch (e) {
    r = { ok: false, detail: `check crashed: ${e.message}` };
  }
  if (c.kind === 'INTEGRITY' && !r.ok) integrityFail++;
  const state = r.ok ? (c.kind === 'DELTA' ? 'DONE' : 'PASS') : { INTEGRITY: 'FAIL', WARN: 'WARN', DELTA: 'OPEN' }[c.kind];
  if (args.has('--open') && r.ok) continue;
  rows.push(`[${state}] ${c.id} ${c.title}\n        ${r.detail}\n        ref: ${c.ref}`);
}
console.log(`history-check — catalogue v${spec.version}, ${spec.buildings.length} buildings (${placed.length} placed), time slice ${spec.defaults?.time_slice ?? '?'}\n`);
console.log(rows.join('\n'));
const nDelta = checks.filter((c) => c.kind === 'DELTA').length;
const nOpen = rows.filter((r) => r.startsWith('[OPEN]')).length;
console.log(`\n${integrityFail} integrity failure(s); ${nOpen} of ${nDelta} research deltas OPEN (not yet in the model, see ref).`);
if (args.has('--strict') && integrityFail) process.exitCode = 1;
