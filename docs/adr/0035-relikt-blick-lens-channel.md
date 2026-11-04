# 0035 · 🔍 Relikt-Blick as a third terrain channel; the game look leaves the relief lab alone

- **Status:** Accepted · 2026-11-04
- **Origin:** V2.5 (builds [0018](0018-game-look-relikt-blick-lens.md), [0009](0009-candidates-public-user-data-private.md), [0010](0010-craters-never-public.md), [0032](0032-shell-layout-tier-registry.md))

## Context
[0018](0018-game-look-relikt-blick-lens.md) makes the aerial photo the default ground and the relief a lens. Still open: how the lens draws without disturbing the relief lab (base + overlay, store, URL hash, saved settings), what may glow, how trees and other objects join the fade, and what *Merken* stores.

## Decision
| # | Rule |
|---|---|
| 1 | **Lens = slot C** of the terrain shader (`Terrain.setLens`), mixed over base + overlay by one uniform. It streams like the overlay but never holds back finer chunks. The relief lab's channels, the store and the URL hash are not touched. |
| 2 | **Game look drives Terrain, not the store.** In Standard and Entdecker the ground is `ortho` and a lab overlay is parked. The store's `layer` keeps the lab's choice, and Labor shows it again. AOIs without `ortho` keep the old default. |
| 3 | **One transition, three channels.** A progress value runs 0 → 1 in ≈ 0.5 s. Trees fade first, then the relief blends in, then the candidates glow. Switching off plays the same curve backwards. |
| 4 | **What glows:** only public F15 candidates of the allow-listed classes ([0009](0009-candidates-public-user-data-private.md)), score ≥ 0.5, no known paths, not rejected in the local review. At most 24, the nearest to the point the camera looks at. The glow is drawn in the terrain shader (no extra draw calls). Classes outside the allow-list never glow ([0010](0010-craters-never-public.md)). |
| 5 | **Lens targets.** Anything that should vanish under the lens implements `setLensFade(0 … 1)` and registers via `window.sleLens.registerLensTarget`. `window.sleTrees` is picked up without registering. |
| 6 | ***Merken* = private marker** in the existing store with a hypothesis title („Mögliche …“), a category from the class and the user's note. There is no navigation and no own location. Tapping again edits the note; markers from F15 „bestätigen“ count as already saved. |
| 7 | **Tiers.** Standard: one toggle (key `F`) with the *Relief* variant. Entdecker adds chips in the tool row: *Senken & Wälle*, *Hangkanten* and *Zeitreise* 1840 / 1935 (if the AOI has the maps). |

## Consequences
- ✅ The relief lab behaves exactly as before, and the lens works in every tier.
- ✅ The trees (V2.4b), zone props and the old DSM canopy follow the lens without the lens knowing them.
- ⚠️ The glow adds a loop of ≤ 24 rings per terrain fragment while the lens is on. This is watched on the phone proxy ([0028](0028-phone-proxy-headroom.md)); a real phone GPU is untested.
- ⚠️ The aerial ground (decision 2) fills the terrain texture budget, so far terrain gets coarser sooner than with the relief look.
- ⚠️ A lab overlay parked in Standard comes back only within the same visit. After a reload it is off.
- ⚠️ With the lens, the phone action bar has 7 items in Standard and 8 in Entdecker and Labor. They shrink to 34–45 px wide at 360–390 px. The reference-phone pass decides whether to add a *Mehr* menu.
