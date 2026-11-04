/**
 * Plan generator (plans work package): generatePlans(spec, outDir) writes one SVG per sheet and
 * returns the written paths. PDF/PNG export lives in export.ts (driven by main.ts).
 * Inputs are only the catalogue (SiteSpec) and the shared pure layout (model/src/layout), so
 * the plans and the 3D model cannot disagree.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GeneratePlansFn } from '../../model/src/api.ts';
import { makeLayoutFn } from '../../model/src/context.ts';
import type { SiteSpec } from '../../model/src/spec.ts';
import type { Sheet } from './sheet.ts';
import { ansichtRequests, ansichtSheet } from './sheets/ansicht.ts';
import { grundrissSheet, planRequests } from './sheets/grundriss.ts';
import { lageplanRequests, lageplanSheet } from './sheets/lageplan.ts';
import { schnittRequests, schnittSheet } from './sheets/schnitt.ts';

export interface SheetEntry {
  id: string;
  file: string;
  title: string;
  build: () => Sheet;
}

/** All sheets in order (lazy builders), with stable file names. */
export function sheetList(spec: SiteSpec): SheetEntry[] {
  const layoutOf = makeLayoutFn(spec);
  const out: SheetEntry[] = [];
  for (const r of lageplanRequests()) out.push({ id: r.sheetNo, file: `${r.sheetNo}_${r.slug}`, title: r.title, build: () => lageplanSheet(spec, layoutOf, r) });
  for (const r of planRequests(spec)) {
    const b = spec.buildings.find((x) => x.id === r.building)!;
    const st = r.kind === 'mansard' ? 'DG' : r.kind === 'cellar' ? 'KG' : `G${r.storey}`;
    out.push({ id: r.sheetNo, file: `${r.sheetNo}_Grundriss_${b.id}_${st}`, title: `Grundriss ${b.id} ${st}`, build: () => grundrissSheet(spec, layoutOf, r) });
  }
  for (const r of ansichtRequests()) out.push({ id: r.sheetNo, file: `${r.sheetNo}_${r.slug}`, title: r.title, build: () => ansichtSheet(spec, layoutOf, r) });
  for (const r of schnittRequests()) out.push({ id: r.sheetNo, file: `${r.sheetNo}_${r.slug}`, title: r.title, build: () => schnittSheet(spec, layoutOf, r) });
  return out;
}

export const generatePlans: GeneratePlansFn = async (spec, outDir) => {
  mkdirSync(outDir, { recursive: true });
  const written: string[] = [];
  for (const s of sheetList(spec)) {
    const p = join(outDir, `${s.file}.svg`);
    writeFileSync(p, s.build().toSVG());
    written.push(p);
  }
  return written;
};
