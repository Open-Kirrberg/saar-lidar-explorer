/**
 * Time slice (KB-I03, research/11 §6.1, skill source-to-model §3.6): which catalogue objects stood in the scene year.
 *
 * `epoch: { from?, to? }` on a Building or TerrainFeature gives the years it stood (`to` inclusive, open ends allowed).
 * The default scene is summer 1789. Every consumer (exterior, interior, site, plans, glb and explorer exports)
 * filters with `inEpoch` / `inScene`, so an ephemeral 1785 fair building or a feature built after 1789 never renders in
 * the 1789 state but stays in the catalogue as a documented alternative for another date.
 *
 * Not the viewer's terrain switch `state.epoch` ('1789' | '2025'), which only picks the ground model.
 * Pure: no three.js.
 */
import type { Epoch } from '../spec.ts';

/** Default scene year: the model shows summer 1789 (catalogue `defaults.time_slice`). */
export const SCENE_YEAR = 1789;

/** True when an object with this epoch stood in `year`. No epoch = always. */
export function inEpoch(epoch: Epoch | undefined | null, year: number = SCENE_YEAR): boolean {
  if (!epoch) return true;
  if (typeof epoch.from === 'number' && year < epoch.from) return false;
  if (typeof epoch.to === 'number' && year > epoch.to) return false;
  return true;
}

/** The items that stood in `year` (buildings or terrain features). */
export function inScene<T extends { epoch?: Epoch }>(items: readonly T[], year: number = SCENE_YEAR): T[] {
  return items.filter((x) => inEpoch(x.epoch, year));
}

/** Problems with an epoch value (validate.ts): non-integer years or from > to. Empty when fine. */
export function epochIssues(epoch: unknown): string[] {
  if (epoch === undefined) return [];
  if (typeof epoch !== 'object' || epoch === null || Array.isArray(epoch)) return ['must be an object {from?, to?}'];
  const e = epoch as Record<string, unknown>;
  const out: string[] = [];
  for (const k of ['from', 'to']) {
    const v = e[k];
    if (v !== undefined && !(typeof v === 'number' && Number.isInteger(v) && v >= 1000 && v <= 2100)) out.push(`${k} must be an integer year`);
  }
  for (const k of Object.keys(e)) if (k !== 'from' && k !== 'to') out.push(`unknown key ${k}`);
  if (typeof e.from === 'number' && typeof e.to === 'number' && e.from > e.to) out.push('from > to');
  return out;
}
