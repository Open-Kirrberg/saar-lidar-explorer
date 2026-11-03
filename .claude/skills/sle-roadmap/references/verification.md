# Verification playbook

"Done" means: tests + build green, the feature seen working in a browser, geospatial numbers spot-checked, and an honest list of what was *not* verified.

## 1. Automated gate

```bash
.claude/skills/sle-roadmap/scripts/verify.sh
```

- `pnpm run build` runs `tsc --noEmit` first, so type errors fail the build.
- New pure logic (geometry, encodings, parsing, detection scoring) gets unit tests — vitest in `app/tests/`, pytest in `pipeline/tests/`. Rendering/UI code is verified in the browser instead.
- Pipeline changes: re-run the affected steps (`cd pipeline && ./run.sh <aoi> build xyz`) and the contract tests.

## 2. Browser check

Start (or reuse) a dev server for this repo on a fixed port — check first that the port isn't owned by another project (`lsof -nP -iTCP:<port> -sTCP:LISTEN`, then the PID's cwd):

```bash
cd app && pnpm dev --port 5240 --strictPort    # run in background
```

With claude-in-chrome: open a **new** tab (tabs_create), navigate, wait for `sle:ready`.

**Hidden-tab caveat.** Automated Chrome tabs frequently report `document.visibilityState === 'hidden'`; rAF is then paused, so nothing animates and any `await new Promise(requestAnimationFrame)` hangs the JS tool (45 s timeout). Never wait on rAF. Drive frames synchronously instead:

```js
// wait for the app
await new Promise(r => window.sle ? r() : addEventListener('sle:ready', r, { once: true }));
const s = window.sle;
await s.flyTo(382198, 5466099, { agl: 60, pitch: -30, duration: 0 }); // may resolve only after frames run
s.step(120);                     // 120 frames à 1/60 s: controller, LOD, render, store sync
```

If `flyTo` with a duration doesn't resolve, start it without awaiting, then `s.step(n)`. `step()` also fires a `sle:step` event so rAF-driven overlays (CSS2D labels in `Labels3D`) refresh; if you add another overlay with its own rAF loop, make it listen to `sle:step` too.

Then screenshot (`computer` → screenshot) and **look at the image** — check the feature is visible, aligned with terrain at exaggeration 1× and 3×, no console errors (`read_console_messages` with `onlyErrors`). Save shots to the git-ignored `docs/shots/<feature>-*.jpg`; commit one to `docs/screenshots/` only if a README or ADR links it.

Close the tabs you opened when done.

**What automation can't verify:** real pointer-lock flight feel, true rAF frame pacing, gamepad. Say so in the report and ask the user to try it.

## 3. Performance

Measure on the real AOI, not the fixture. With rAF paused, time synchronous frames and force GPU completion:

```js
const s = window.sle, gl = s.renderer.getContext(), px = new Uint8Array(4);
const t0 = performance.now();
for (let i = 0; i < 60; i++) { s.step(1); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
(performance.now() - t0) / 60   // ms per frame; budget 16.7 ms on an M5 Pro, aim < 8 ms
```

Test a worst case (low oblique view over the biggest chunk count, forest/overlays on). Record numbers in the commit message and the module README (CHANGELOG.md gets one line). Also log `renderer.info.render.triangles`, `renderer.info.memory`.

## 4. Geospatial spot checks (do at least one per data-touching change)

- **Heights:** `window.sle.terrain.heightAt(x, z)` at a known point vs. the source GeoTIFF value (read with rasterio in `pipeline/`: `uv run python -I -c "..."`). Expect < 5 mm difference (Terrarium) at cell centres.
- **Positions:** a POI or OSM node must sit on the matching relief feature at 1× and 5× exaggeration; Leaflet overlay vs. OSM basemap at z18 must line up (< 1 m).
- **Vectors from services:** compare a parcel boundary / OSM path with the relief (paths follow hollow ways, parcel lines follow field edges).
- **Round trips:** WGS84 ⇄ UTM ⇄ world within 1 cm; marker export → import identical.

## 5. Report template (to the user)

- Shipped: … (feature IDs)
- Verified: tests (n passed), build, browser (what you saw), numbers (fps/sizes/timings)
- Not verified: …
- Try it: URL, keys
- Next: …
