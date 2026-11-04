# 🚪 `src/zones/` — zone contract runtime (V2.6)

Pure logic for zones behind portals ([zone contract](../../../docs/zone-contract.md), [ADR 0029](../../../docs/adr/0029-zones-same-bundle-folder-layout.md)). No three.js, no DOM; the shell (V2.2) wires it.

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

Tests: `tests/zones.test.ts` (fixture zone `tests/fixtures/zones/fixture/zone.json`, inside the `fixture` AOI: enter → zone → exit restores the pose).
