# 0038 · 🧭 First-flight tutorial: five self-completing steps to the castle

- **Status:** Accepted · 2026-11-04
- **Origin:** V2.9 (story U1 in [PRD](../../PRD.md); builds [0019](0019-feature-tiers.md), [0032](0032-shell-layout-tier-registry.md), [0037](0037-zone-runtime-host.md))

## Context
V2.2 removed the v1 intro overlay ([0032](0032-shell-layout-tier-registry.md)). A first-time visitor lands in a forest view and has to work out how to move and where the castle is. Acceptance: a new user reaches the castle without help. Nobody can run a hallway test with people for every change.

## Decision
| # | Rule |
|---|---|
| 1 | **🟢 Standard feature `tutorial`** (`app/src/tutorial/`). It is one small **non-modal card** in `shell.slots.tutorial`: top centre on desktop, below the minimap and system buttons on screens ≤ 900 px. The flight stays fully usable while it shows. |
| 2 | **Five steps, one action each, each completes on its own:** 👀 *Schau dich um* (turn ≥ 20°, tilt ≥ 8° or move ≥ 40 m) → 🕊️ *Flieg los* (≥ 120 m) → 🗺️ *Finde Schloss Karlsberg* (open *Orte* or the full map, or come within 1.2 km) → 🏰 *Flieg zum Schloss* (inside the portal radius) → 🚪 *Tritt ein* (castle zone loading or entered) → closing card. Reaching the castle radius from **any** step jumps to *Tritt ein*. The texts differ for touch and keyboard. The step machine is pure (`steps.ts`, unit-tested). |
| 3 | **The route uses only controls a visitor has:** *Orte* → „Schloss Karlsberg – Hauptschloss“ (flies there), or the door icon on the minimap. The current step's shell control pulses (`shell.anchor`). There is no „take me there“ shortcut in the tutorial. Finding the place is part of learning the app. |
| 4 | **Target = the castle portal** (`zonePortals()`, `zoneId === 'schloss-karlsberg'`). Without one (before V2.7), the target is the palace ruins (public POI) with a 250 m radius. The last step then shows an arrival card (with „Schloss betreten“ if the Entdecker reconstruction button is on screen). If the target lies outside the AOI, only steps 1–2 show. |
| 5 | **Every step has „Überspringen“, and × ends the tutorial.** It shows **once per profile**: × , the closing card, or reaching the castle radius calls `markTutorialDone()`. Restart: „Einführung starten“ in *Steuerung* (`shell.setTutorialStart`) and in *Einstellungen*. `?notutorial` suppresses it for one visit. |
| 6 | **Tone and ethics:** short German *du* sentences. The closing card repeats „Hypothesen … Schauen, nicht graben“. Nothing points to the real place, the visitor's location or digging. *Mein Standort* stays frozen. |
| 7 | **Motion:** the card fade-in and the anchor pulse switch off under `prefers-reduced-motion`. Text changes go through an `aria-live="polite"` region. The card never takes focus, so flight keys keep working. |
| 8 | **The v1 tour stays in 🟡 Entdecker as it is.** It is a guided sightseeing flight with `flyTo` between stops, which is the opposite of teaching controls. Folding it in would make the tutorial longer than five steps. |
| 9 | **H8 replaces the hallway test:** `pnpm run first-run` (`app/scripts/first-run.mjs`) runs headless Chrome with a fresh profile at 390 × 844 (touch) and 1440 × 900. It reads only the card, does what the card says with real input (drag, keys, swipe, tap/click, browser hit-tested), and never calls `flyTo` or zone APIs. **Pass** = the castle's „Betreten“ prompt is on screen or the zone is entered. Before V2.7, the arrival card is the accepted fallback. |

## Consequences
- ✅ New visitors get a guided path to the castle in about 4–5 actions. The test runs in CI-like conditions without a person.
- ✅ The tutorial doesn't depend on V2.7 internals: it only uses the portal list and the prompt on screen.
- ⚠️ A scripted walkthrough checks that the path works, not that people understand it. Real hallway tests are still worth doing.
- ⚠️ The thresholds are guesses tuned by the script. Real touch feel on a phone has not been tested.
