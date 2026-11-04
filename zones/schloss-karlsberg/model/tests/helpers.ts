import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { SiteSpec } from '../src/spec.ts';

export const ROOT = resolve(import.meta.dirname, '..', '..');

/**
 * Fresh parse of the frozen catalogue v1 (model/catalogue.v1.json) for each call.
 * The core tests exercise upgradeV1() and the default rules against this fixture; it never changes.
 */
export function readCatalogueV1(): SiteSpec {
  return JSON.parse(readFileSync(resolve(ROOT, 'model/catalogue.v1.json'), 'utf8')) as SiteSpec;
}

/** Fresh parse of the live catalogue (model/catalogue.json, v2 since 2026-11-01). */
export function readCatalogue(): SiteSpec {
  return JSON.parse(readFileSync(resolve(ROOT, 'model/catalogue.json'), 'utf8')) as SiteSpec;
}
