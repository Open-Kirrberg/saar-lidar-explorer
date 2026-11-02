/**
 * Signatures the three parallel work packages implement (docs/architecture.md §5).
 * Implementations live in model/src/exterior, model/src/interior, model/src/site and plans/src;
 * each module exports a function that satisfies the type here:
 *
 *   // model/src/exterior/index.ts
 *   export const buildExterior: BuildExteriorFn = (b, ctx) => { ... };
 */
import type * as THREE from 'three';
import type { BuildContext, SiteBuildResult } from './context.ts';
import type { Building, SiteSpec } from './spec.ts';

/** Exterior of one building at ctx.lod, in the building group convention (footprint.ts). */
export type BuildExteriorFn = (b: Building, ctx: BuildContext) => THREE.Group;

/** Interior of one building (rooms, doors, stairs) - LOD2 only; empty group if b.interior === 'none'. */
export type BuildInteriorFn = (b: Building, ctx: BuildContext) => THREE.Group;

/** Terrain features, courts, terraces, avenues, water + walk colliders + POIs. */
export type BuildSiteFn = (spec: SiteSpec, ctx: BuildContext) => SiteBuildResult;

/** Plan documents (SVG, optional PDF) written to outDir; returns the written file paths. */
export type GeneratePlansFn = (spec: SiteSpec, outDir: string) => Promise<string[]>;
