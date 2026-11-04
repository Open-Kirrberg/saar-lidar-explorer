/**
 * Build model/catalogue.json (v2) from model/catalogue.v1.json + research inputs.
 *
 *   pnpm exec tsx scripts/catalogue-v2/build.ts            # pass 1 (geometry)
 *   cd ../../pipeline && uv run python -I ../zones/schloss-karlsberg/scripts/catalogue-v2/sample_dtm.py
 *   pnpm exec tsx scripts/catalogue-v2/build.ts            # pass 2 (DTM levels, ground stats)
 *
 * The build is deterministic; it fails on strict-v2 validation errors, programme check
 * failures and footprint overlaps in the palace core.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateSite } from '../../model/src/validate.ts';
import { checkProgramme, footprintOverlaps } from './checks.ts';
import { ROOT } from './common.ts';
import { buildV2 } from './pipeline.ts';
import { PROGRAMMES } from './programme.ts';

const { spec, dtmUsed, dtmMissing } = buildV2();

const v = validateSite(spec, 'v2');
const issues = PROGRAMMES.flatMap((p) => checkProgramme(spec, spec.buildings.find((b) => b.id === p.id)!));
const overlaps = footprintOverlaps(spec);

writeFileSync(resolve(ROOT, 'model/catalogue.json'), JSON.stringify(spec, null, 1) + '\n');

const rooms = spec.buildings.reduce((s, b) => s + (b.rooms?.length ?? 0), 0);
const openings = spec.buildings.reduce((s, b) => s + (b.openings?.length ?? 0), 0);
const stairs = spec.buildings.reduce((s, b) => s + (b.stairs?.length ?? 0), 0);
console.log(
  `catalogue v2: ${spec.buildings.length} buildings (${spec.buildings.filter((b) => b.placement !== 'unplaced').length} placed), ${spec.terrain_features.length} terrain features, ${rooms} rooms, ${openings} interior openings, ${stairs} stairs`,
);
console.log(`DTM samples used: ${dtmUsed}; geometry without samples: ${dtmMissing.length ? dtmMissing.join(', ') : 'none'}`);
console.log(`validation v2: ${v.errors.length} errors, ${v.warnings.length} warnings`);
for (const e of v.errors) console.log(`  ERROR ${e.path}: ${e.message}`);
for (const w of v.warnings) console.log(`  warn  ${w.path}: ${w.message}`);
console.log(`programme checks: ${issues.length} issues`);
for (const i of issues) console.log(`  ${i.building}: ${i.message}`);
console.log(`footprint overlaps > 0.5 m²: ${overlaps.length}`);
for (const o of overlaps) console.log(`  ${o.a} x ${o.b}: ${o.area} m²`);
if (!v.ok || issues.length) process.exitCode = 1;
