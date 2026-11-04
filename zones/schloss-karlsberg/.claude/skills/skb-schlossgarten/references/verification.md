# Verifying garden and landscape work

Garden work is done only when every step below has passed or has been honestly reported as not run. Run commands from
`zones/schloss-karlsberg/`.

## 1. Gates

```bash
pnpm run test                       # vitest over model/tests, plans/tests, viewer/tests
pnpm run build                      # tsc --noEmit + vite build
pnpm exec tsx scripts/catalogue-v2/build.ts   # if the catalogue builder changed; must be deterministic (git diff shows only intended changes)
.claude/skills/skb-improve/scripts/verify.sh catalogue export   # reproducibility + light-layer round trip into a temp dir
cd ../../pipeline && uv run python -I ../zones/schloss-karlsberg/scripts/prepare-terrain.py   # if ground classes / levels / landcover changed
pnpm run plans --only LP-00 --only LP-01 --no-pdf   # if features or avenues changed: LP sheets still render
```

`prepare-terrain.py` prints the ground-class pixel counts (`ground {meadow: …, forest: …}`). Report forest before and
after. For S1 the forest count must drop sharply near the core, and the meadow, field and hay counts must appear.

## 2. Pure tests to add (research/11 §6.5)

- `speciesFor('Castanea sativa (D: Esskastanien)').key === 'castanea'`. A bare `kastanie` warns.
- `clumpPlants` is deterministic for a seed, keeps plants inside the clump radius, and holds species shares within ±5 %.
- `walkRibbon` has no self-intersection for the S2 loop, and its width matches.
- `parterreAnglaise` keeps panels inside the polygon, and the sentier and plate-bande widths match `GARDEN`.
- The epoch filter shows the stag basin in 1789 and hides it in 1791. The round pavilion is at the CdL in 1789 and in the
  Karlslust in 1792.
- Validation accepts each new `TerrainKind` or field and rejects malformed ones (`model/tests/spec-validate.test.ts`).
- Numeric checks: the basin centre lies at v = 0 ± 0.5 m in `gridFrame(spec.palace_grid)`. No tree position falls inside a
  court, terrace or building footprint (`pointInPolygon`). Avenue trees stay within `row_distance/2 + jitter` of the line.

## 3. Browser shots (before and after, same poses, same hour)

The viewer dev server must run (`pnpm run dev` → http://localhost:5260/). Check first that 5260 is not owned by another
process (`lsof -i :5260`). If it is already running, reuse it and leave it running. Then:

For a backlog item, the acceptance shots come from the backlog driver (its poses 01–15 are what the item lists):

```bash
node .claude/skills/skb-improve/scripts/shots.mjs --out <scratchpad>/KB-Ixx-before --poses 01,02,04,15 --bench
```

Add garden-specific views and vegetation stats with this skill's script. Its ids are a separate namespace (its
`03-herzogsgarten-eye` is not the backlog's `03-ehrenhof-eye`), so never cite them as backlog poses:

```bash
node .claude/skills/skb-schlossgarten/scripts/garden-shots.mjs --out <scratchpad>/<topic>-before --bench
#   … make the change (Vite hot-reloads; terrain changes need prepare-terrain + reload) …
node .claude/skills/skb-schlossgarten/scripts/garden-shots.mjs --out <scratchpad>/<topic>-after --bench
```

The script drives headless Chrome (`$CHROME_BIN` or the macOS default) over CDP with `window.skb` only. It sets epoch 1789
and the hour (`--hour`, default 10.5), hides `#panel`, advances frames with `skb.step(6)` (automated tabs pause rAF),
and writes 8 poses plus `stats.json`:

| Pose | What it judges |
|---|---|
| `01-aerial-west`, `02-aerial-east` | the whole read: open ridge vs forest clearing (S1), garden behind the palace |
| `03-herzogsgarten-eye` | eye level about 85 m E of the garden front looking back: parterre vs lawn garden, basin (S2, S3) |
| `04-herzogsgarten-low` | low aerial from the E: belt walk, clumps, forest belts |
| `05-orangerie-terrace` | aerial from the SW: the Orangerie slope, TF-15, TF-08 |
| `06-paradestrasse` | eye level in the TF-10 avenue looking N: tree age, spacing, stakes |
| `07-karlslust` | the valley: ponds, cascade, follies |
| `08-forest-edge-west` | the W slope from 70 m: hay meadow vs forest, the forest edge |

Use `--only 03-herzogsgarten-eye,06-paradestrasse` for a quick loop, and `--hour 7` or `--hour 17.5` for hero light (the
garden front faces E: about 07:00, sun 25° from 85°; the court front faces W: about 17:30, visual-audit §2 sun table).
Keep the default hour for before/after pairs unless the change is about light.

**Look at the images yourself** (Read the JPGs) before claiming anything, and compare them pairwise. Keep full sets in
the scratchpad and commit only 2–4 representative pairs to `docs/shots/<KB-Ixx or topic>/` (JPG at quality 85 is
about 0.2–0.35 MB per shot), as the backlog workflow does.

If you need a pose the script lacks, add it to `POSES` in the script, with an eye and target in palace-grid (u, v) and
heights above the ground, rather than taking one-off shots. Then the next agent can reproduce it.

## 4. Vegetation stats in the console

The script stores this in `stats.json` as `vegetation`. To run it by hand in the page console:

```js
(() => {
  const out = {};
  skb.scene.traverse((o) => {
    if (!o.isInstancedMesh) return;
    const key = o.name.split('/').slice(0, 3).join('/');
    const tris = (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
    const r = (out[key] ??= { meshes: 0, instances: 0, tris: 0, maxBoundingRadius: 0 });
    r.meshes++; r.instances += o.count; r.tris += tris * o.count;
    r.maxBoundingRadius = Math.max(r.maxBoundingRadius, Math.round(o.boundingSphere?.radius ?? 0));
  });
  return out;
})()
```

Toggle a group to measure its cost: `skb.scene.getObjectByName('forest').visible = false; skb.step(2); await skb.gpuBench(20, [1920, 1080])`.
The baseline numbers are in `performance.md`.

## 5. Other checks

- **Walk mode:** `skb.goto('<entrance POI id>')` near the garden, then `skb.step(120)`. New hedges, benches and basin
  copings must not trap the walker or block entrances. Garden geometry with `userData.collider = true` joins the walk
  colliders (see `buildFeatures`: everything except meshes named `water` or `grass`).
- **Explorer layer:** if you added **stone** site meshes, run `pnpm run export:explorer`, which needs
  `viewer/public/terrain/`. Report the node count and triangle delta it prints. The explorer itself is another agent's
  work: don't open or edit `../../app`.
- **Console:** no new warnings from `[features]` or `[site]` in the dev console.
- **Hypothesis toggles:** with `lowConfidence` set to `hide` (`skb.set('lowConfidence', 'hide')`), low-confidence
  buildings disappear. `showHypothetical` defaults to true, so `placement: 'hypothetical'` alone hides nothing.
  Features gain this behaviour only when you implement a `placement` or `confidence` filter for them. State which
  applies.

## 6. Report

In under 300 words, report:
- what changed, with the S ids;
- the test and build results;
- the shots, as before/after paths;
- triangles, calls and GPU ms before and after (the same run);
- the ground-class counts;
- what was **not** verified (live flight feel, real windowed frame pacing, weaker GPUs, prepare-terrain if `../../data` was
  missing);
- any open evidence questions, with research/11 §8 numbers.
