/**
 * Fly-to that keeps working while terrain streams (F9). The DroneController aims at the ground it
 * knows when the flight starts (the coarse level, or the fallback height when nothing is loaded
 * there). While flying, if the target ground was unknown and becomes known, the flight is
 * re-aimed; on arrival, if finer data moved the ground by more than the tolerance, a short
 * correction flight follows (at most `maxRefine` times).
 */
import type { DroneController, FlyToOptions } from '../controls/DroneController';
import { utmToWorld } from '../geo';
import type { Origin } from '../geo';
import { needsRefine } from './streaming';

interface GroundSource {
  surfaceY(x: number, z: number): number;
}

export function createRefinedFlyTo(
  controller: DroneController,
  ground: GroundSource,
  origin: Origin,
  maxRefine = 3,
): (E: number, N: number, opts?: FlyToOptions) => Promise<boolean> {
  let generation = 0;
  return (E, N, opts = {}) => {
    const my = ++generation;
    const { x, z } = utmToWorld(E, N, origin);
    const agl = opts.y !== undefined ? 0 : (opts.agl ?? 120);
    let g0 = ground.surfaceY(x, z);
    let refinements = 0;
    let flight = 0;

    return new Promise<boolean>((resolve) => {
      let stopWatch = () => {};
      const finish = (ok: boolean) => {
        stopWatch();
        resolve(ok);
      };
      const launch = (extra: FlyToOptions = {}) => {
        const id = ++flight;
        g0 = ground.surfaceY(x, z);
        void controller.flyTo(E, N, { ...opts, ...extra }).then((ok) => {
          if (id !== flight) return; // superseded by our own re-aim
          if (!ok || my !== generation) return finish(false); // user input or a newer fly-to
          const g = ground.surfaceY(x, z);
          if (opts.y === undefined && refinements < maxRefine && needsRefine(g0, g, agl)) {
            refinements++;
            launch({ duration: 0.8 });
          } else finish(true);
        });
      };
      // While flying: re-aim once the unknown target ground becomes known.
      const watch = () => {
        if (my !== generation || !controller.flying) return;
        if (opts.y === undefined && !Number.isFinite(g0) && refinements < maxRefine && needsRefine(g0, ground.surfaceY(x, z), agl)) {
          refinements++;
          launch();
        }
      };
      let raf = 0;
      const loop = () => {
        watch();
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
      window.addEventListener('sle:step', watch); // hidden tabs: window.sle.step() drives frames
      stopWatch = () => {
        cancelAnimationFrame(raf);
        window.removeEventListener('sle:step', watch);
      };
      launch();
    });
  };
}
