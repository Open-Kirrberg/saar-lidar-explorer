/**
 * V2.9 first-flight tutorial (ADR 0038): pure step machine + German texts. The UI (Tutorial.ts) feeds a
 * snapshot every frame; a step completes on its own when the user did the action. No DOM, no three.js.
 *
 *   look ─► fly ─► find ─► approach ─► enter ─► done
 *     └──────── near the castle (any step) ───────┘   inside the castle zone (any step) ─► done
 */

export type StepId = 'look' | 'fly' | 'find' | 'approach' | 'enter' | 'done';

/** Steps shown with a number (done is the closing card). */
export const STEPS: readonly Exclude<StepId, 'done'>[] = ['look', 'fly', 'find', 'approach', 'enter'];

export interface Pose {
  E: number;
  N: number;
  heading: number;
  pitch: number;
}

/** What the tutorial sees each tick (all from what the user can see or did). */
export interface Snapshot extends Pose {
  /** „Orte“ drawer open. */
  placesOpen: boolean;
  /** Minimap enlarged to full screen. */
  mapOpen: boolean;
  /** The castle's „Betreten“ prompt is on screen (zone portal or the v1 „Schloss betreten“ button). */
  enterOffered: boolean;
  /** Loading or inside the castle zone. */
  inCastle: boolean;
}

/** Where the castle is. `portal` = a real zone portal (V2.7); `site` = the palace ruins (no zone yet). */
export interface Target {
  E: number;
  N: number;
  radius_m: number;
  kind: 'portal' | 'site';
  /** Target inside the loaded AOI (else the tutorial ends after flying). */
  inAoi: boolean;
}

export interface TutState {
  step: StepId;
  /** Pose when the current step began (look/fly measure from here). */
  ref: Pose;
  /** How the tutorial ended (for the closing card). */
  end?: 'entered' | 'arrived' | 'flown';
}

/** Thresholds (tuned in the walkthrough, app/README „Tutorial“). */
export const LOOK_DEG = 20;
export const LOOK_PITCH_DEG = 8;
export const LOOK_MOVE_M = 40;
export const FLY_M = 120;
/** „Finden“ also counts once the user is this close (they found it on their own). */
export const FIND_NEAR_M = 1200;

export const angleDiff = (a: number, b: number): number => {
  const d = (((a - b) % 360) + 540) % 360 - 180;
  return Math.abs(d);
};
export const dist = (a: { E: number; N: number }, b: { E: number; N: number }): number => Math.hypot(a.E - b.E, a.N - b.N);

const pose = (s: Pose): Pose => ({ E: s.E, N: s.N, heading: s.heading, pitch: s.pitch });

export function start(s: Pose): TutState {
  return { step: 'look', ref: pose(s) };
}

const to = (step: StepId, s: Pose, end?: TutState['end']): TutState => (end ? { step, ref: pose(s), end } : { step, ref: pose(s) });

/** One tick: returns the same object when nothing changed. */
export function advance(st: TutState, s: Snapshot, target: Target | null): TutState {
  if (st.step === 'done') return st;
  if (s.inCastle) return to('done', s, 'entered');
  const castle = target && target.inAoi ? target : null;
  const near = !!castle && dist(s, castle) <= castle.radius_m;
  if (near && st.step !== 'enter') return to('enter', s);
  switch (st.step) {
    case 'look': {
      const looked = angleDiff(s.heading, st.ref.heading) >= LOOK_DEG || Math.abs(s.pitch - st.ref.pitch) >= LOOK_PITCH_DEG;
      return looked || dist(s, st.ref) >= LOOK_MOVE_M ? to('fly', s) : st;
    }
    case 'fly':
      if (dist(s, st.ref) < FLY_M) return st;
      return castle ? to('find', s) : to('done', s, 'flown');
    case 'find':
      if (!castle) return to('done', s, 'flown');
      return s.placesOpen || s.mapOpen || dist(s, castle) <= FIND_NEAR_M ? to('approach', s) : st;
    case 'approach':
      return st; // completes via `near`
    case 'enter':
      // Left the radius again before entering: back to „hinfliegen“.
      if (castle && dist(s, castle) > castle.radius_m * 1.6) return to('approach', s);
      return st;
  }
}

/** „Überspringen“: the next step (the last one ends the tutorial). */
export function skip(st: TutState, s: Pose, target: Target | null): TutState {
  const i = STEPS.indexOf(st.step as (typeof STEPS)[number]);
  const castle = target && target.inAoi;
  if (i < 0 || i === STEPS.length - 1 || (!castle && st.step === 'fly')) return to('done', s, st.step === 'enter' ? 'arrived' : 'flown');
  return to(STEPS[i + 1], s);
}

/** Steps the user will see (without a castle in the AOI: only look + fly). */
export const visibleSteps = (target: Target | null): readonly StepId[] => (target?.inAoi ? STEPS : STEPS.slice(0, 2));

// ---- texts (German UI) ---------------------------------------------------------------------------------

export interface StepText {
  icon: string;
  title: string;
  body: string;
  /** Shell anchors to highlight. */
  anchors: Array<'places' | 'minimap' | 'move-mode' | 'speed' | 'keys'>;
}

export interface TextEnv {
  touch: boolean;
  target: Target | null;
  /** The „Betreten“ prompt is on screen right now. */
  enterOffered: boolean;
}

export const CASTLE_NAME = 'Schloss Karlsberg';
/** Exact *Orte* entry the „finden“ step names. */
export const CASTLE_POI = 'Schloss Karlsberg – Hauptschloss';

export function stepText(st: TutState, env: TextEnv): StepText {
  const portal = env.target?.kind === 'portal';
  switch (st.step) {
    case 'look':
      return {
        icon: '👀',
        title: 'Schau dich um',
        body: env.touch
          ? 'Wisch mit einem Finger über das Gelände. Mit zwei Fingern drehst und zoomst du.'
          : 'Zieh mit der Maus über das Bild oder drück ← →.',
        anchors: [],
      };
    case 'fly':
      return {
        icon: '🕊️',
        title: 'Flieg los',
        body: env.touch
          ? 'Wisch weiter in eine Richtung – du gleitest über Wald und Wiesen.'
          : 'Halte W oder ↑ gedrückt. Mit + und − wirst du schneller oder langsamer.',
        anchors: env.touch ? [] : ['speed'],
      };
    case 'find':
      return {
        icon: '🗺️',
        title: `Finde ${CASTLE_NAME}`,
        body: portal
          ? `Tippe auf „Orte“ und dann auf „${CASTLE_POI}“ – oder auf der Karte oben rechts auf das Tor.`
          : `Tippe auf „Orte“ und dann auf „${CASTLE_POI}“.`,
        anchors: portal ? ['places', 'minimap'] : ['places'],
      };
    case 'approach':
      return {
        icon: '🏰',
        title: 'Flieg zum Schloss',
        body: portal
          ? `Tippe in „Orte“ auf „${CASTLE_POI}“ oder auf das Tor in der Karte. Am Tor erscheint „Betreten“.`
          : `Tippe in „Orte“ auf „${CASTLE_POI}“ – die Kamera fliegt hin.`,
        anchors: ['places'],
      };
    case 'enter':
      if (env.enterOffered)
        return {
          icon: '🚪',
          title: 'Tritt ein',
          body: env.touch ? 'Tippe unten auf „Betreten“.' : 'Klick unten auf „Betreten“ oder drück E.',
          anchors: [],
        };
      return portal
        ? { icon: '🚪', title: 'Fast da', body: 'Flieg noch etwas näher ans Tor – dann erscheint „Betreten“.', anchors: [] }
        : {
            icon: '🏰',
            title: `Du bist am ${CASTLE_NAME}`,
            body: 'Hier stand bis 1793 das Schloss von Herzog Karl II. August. Im Wald zeichnen sich noch Mauern und Gräben ab – schau dich in Ruhe um.',
            anchors: [],
          };
    case 'done':
      return {
        icon: st.end === 'flown' ? '🎉' : '🏰',
        title: st.end === 'entered' ? 'Willkommen im Schloss!' : 'Geschafft!',
        body:
          'Alles Hervorgehobene sind Hypothesen aus Geländedaten. Schauen, nicht graben – Bodendenkmäler sind geschützt. ' +
          (env.touch ? 'Hilfe zur Steuerung: Taste „?“ oben rechts.' : 'Alle Tasten: ? oder „Steuerung“ oben rechts.'),
        anchors: [],
      };
  }
}
