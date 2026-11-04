/**
 * Zone entry of Schloss Karlsberg (V2.7, ADR 0029): the explorer lazy-imports this module and mounts the castle on its
 * shared renderer (zone contract „Runtime API“, ADR 0037). `mountZone` loads the zone package below `ctx.baseUrl` and resolves once the castle can be entered.
 */
import { createCastle } from '../castle.ts';
import type { ZoneHandle, ZoneMountContext } from './api.ts';

export type { ZoneHandle, ZoneMountContext, ZonePose, ZoneQuality, ZoneSharedTree, ZoneTier, ZoneTreeSource } from './api.ts';

/** The castle draws its own HUD with „Verlassen“, title, Gewissheit and attribution (zone contract, Runtime API). */
export const hostChrome = false;

export async function mountZone(ctx: ZoneMountContext): Promise<ZoneHandle> {
  return createCastle(ctx);
}
