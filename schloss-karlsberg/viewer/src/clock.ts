/**
 * Review clock (KB-I64, wave-6 review: shots differed run to run). Pure: no three.js, no DOM.
 *
 * Every animation in the viewer (water ripples and jet spray `waterTime`, foliage wind, leaf-card fades, the Rundflug)
 * advances only by the `dt` handed to `frame(dt)`. The rAF loop hands it wall-clock time, so a review driver that
 * places the camera, waits and captures got a different number of wall-clock frames (and different `dt`s) each run.
 *
 * While a test hook drives the frames (`skb.step`, `skb.goto`, `skb.pose`, `skb.tour`), the clock is **driven**: the
 * rAF loop draws nothing and advances nothing, so the canvas keeps exactly the frame the hook rendered. The first real
 * user input (pointer, key, wheel, touch) hands the clock back to the rAF loop.
 */
export class ReviewClock {
  /** true while test hooks own the frames */
  driven = false;

  /** A test hook advanced or placed the view. */
  hook(): void {
    this.driven = true;
  }

  /** A real user input: wall-clock frames resume. */
  input(): void {
    this.driven = false;
  }

  /** Should the rAF loop render a frame now? */
  wallFrame(): boolean {
    return !this.driven;
  }
}

/** Advance an animation clock by dt seconds, wrapped at `period` (default one hour, keeps float precision). */
export function advanceClock(t: number, dt: number, period = 3600): number {
  if (!(dt > 0)) return t;
  return (t + dt) % period;
}
