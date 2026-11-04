# 🚪 `src/zones/` — zone contract runtime (V2.6)

Pure logic for zones behind portals ([zone contract](../../../docs/zone-contract.md), [ADR 0029](../../../docs/adr/0029-zones-same-bundle-folder-layout.md)). No three.js, no DOM; `runtime/` (V2.6b) wires it into the shell.

| File | What |
|---|---|
| `contract.ts` | `parseZoneManifest` (tolerant, app rule), `validateZoneStrict` + `budgetViolations` (producer rule, twin of `pipeline/zones.py`), `parseZoneIndex`, `loadZones(fetchJson, aoiBboxEN)` |
| `geometry.ts` | Footprint rings: normalise (CCW, no closing vertex), simple-polygon check, point-in-ring, bbox |
| `portal.ts` | `updatePortalFocus` (offer *Betreten* within `radius_m`, keep it to `radius_m · 1.1`), `fallbackExitPose`, `pickLod` |
| `session.ts` | `zoneSession(state, event)`: overworld → loading → zone → overworld; saves the overworld pose (+ opaque snapshot) on enter, hands it back as `restorePose` on exit, cancel or load failure |

**Shell wiring (sketch):**
```ts
focus = updatePortalFocus(focus, zones, cam.E, cam.N);          // every frame / on move → show focus.label_de
s = zoneSession(s, { type: 'enter', zone, portalId, pose: cam.pose(), snapshot: layers });
// loading screen: zone.name_de, zone.summary_de, zone.attribution, zone.evidence.disclaimer_de
s = zoneSession(s, { type: 'loaded', zoneId });                 // mount runtime (gltf | module), camera = s.spawn
s = zoneSession(s, { type: 'exit' });                           // unmount, cam.setPose(s.restorePose), then 'restored'
```

## 🎮 `runtime/` — portals, loading screen, enter / leave (V2.6b)

| File | What |
|---|---|
| `api.ts` | **Runtime API** types: `ZoneModule`, `ZoneMountContext`, `ZoneHandle` (contract → *Runtime API*) |
| `modules.ts` | `ZONE_MODULES` registry: name → lazy `import()`; one line per zone module |
| `flow.ts` | `createZoneFlow` (pure, ports injected): enter → loading → mount → zone → exit/cancel/fail → restore; `createPortalPrompter` |
| `overworld.ts` | Pose capture / bit-exact restore of the drone rig (re-derived from E/N/h if the exaggeration changed) |
| `marker.ts` | 3D portal marker: ring + beam + gate, y = displayed ground (exaggeration-safe), scales with distance |
| `feature.ts` | Standard feature `zone-portals`: loads zones, markers + labels, prompt (E), loading screen, *Verlassen* chrome, `zonePortals()` |
| `builtin.ts` · `testRoom.ts` · `collide.ts` | 🧪 built-in *Testraum* (dev, `?aoi=fixture`, `?testraum`): procedural hut, walk collision |
| `zones.css` | Loading info, zone chrome; hides the overworld shell while `#app.sle-zone-active` |
| `sharedTrees.ts` | `overworldTreeSource(manifest, baseUrl)` → `ctx.trees.treesIn(bboxEN)`: today's CHM trees (AOI `trees` layer, chunk by chunk, failed chunks skipped) for zones with preset `trees: "shared"` (V2.7) |

**🏰 Castle (V2.7, [ADR 0033](../../../docs/adr/0033-castle-module-zone.md)):** `modules.ts` maps `schloss-karlsberg` to `zones/schloss-karlsberg/viewer/src/zone/entry.ts`. Vite and tsconfig alias `@model` to the castle's `model/src`, dedupe `three` and allow `zones/` in `server.fs.allow`; `three-mesh-bvh` (castle colliders) is an app dependency. The castle has `hostChrome: false` (own HUD, M = Verlassen). `feature.ts` forwards the shell tier (`setTier`) and passes no `quality` (the castle picks `auto`). The castle's hooks are at `sle.zones.flow.handle().hooks` (`goto`, `step`, `inView`, …).

```text
 E / „Betreten“ ─▶ freeze overworld · save pose ─▶ loading (import() 0–10 %, mountZone 10–100 %) ─▶ zone owns frames
                      ▲                               │ Abbrechen / Esc / error                       │ Verlassen / Esc / frame error
                      └──── restore pose exactly ◀────┴───────────────────────────────────────────────┘
```

**Perf:** `pnpm run perf:zone` (`scripts/perf-zone.mjs`, headless, needs a running preview with zone data; `--profile` adds a CPU profile of the goto) runs the phone proxy and desktop through enter → Rundflug → spawn → „Gehe zu“ Festsaal → walk → exit. JSON + shots go to `docs/shots/`.

Tests: `tests/zones.test.ts` (fixture zone `tests/fixtures/zones/fixture/zone.json`, inside the `fixture` AOI: enter → zone → exit restores the pose). `tests/zoneRuntime.test.ts`: flow round trip, cancel / error paths, prompt hysteresis, rig restore, Testraum walls. `tests/zones-castle.test.ts`: the committed castle `zone.json` against the strict validator (triangle waiver only). `tests/zones-shared-trees.test.ts`: the tree source.
