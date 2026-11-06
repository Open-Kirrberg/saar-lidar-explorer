# 🎮 Saar LiDAR Explorer — PRD

> **Status:** v1.4 public ([live](https://open-kirrberg.github.io/saar-lidar-explorer/)) · v1.5 on `main` (F22 private) · **next: v2 "game shell"** · Updated 2026-11-04
> **Rules:** ≤ 150 lines. *Why* lives in [ADRs](docs/adr/README.md), *what shipped* in [CHANGELOG.md](CHANGELOG.md), *how* in the module READMEs. Pre-v2 history: [docs/history/prd-v1.md](docs/history/prd-v1.md).

## 🌍 Vision

Explore your home area like a game: fly or walk over the **real** Kirrberg, Homburg and Karlsberg, enter detailed places like dungeons, and learn to spot relicts under the forest the way you learn a profession in a game. Relict finding is the first real activity, and it always stays a hypothesis: **„Schauen, nicht graben“**.

| Layer | What | ADR |
|---|---|---|
| 🌍 **Overworld** | The land today (2025): streamed LiDAR terrain, aerial-photo ground, one real tree per CHM crown, LoD2 houses, OSM paths; game minimap with the player and view cone | [0015](docs/adr/0015-overworld-zones-portals.md) [0017](docs/adr/0017-real-trees-from-chm.md) |
| 🏰 **Zones** | Detailed places behind a portal and a loading screen: Schloss Karlsberg **1789** (reconstructed), Bäckerei Heusser (built twin: clickable shop and products, *Morgens* / *Feierabend*, a short guided tour) | [0016](docs/adr/0016-zone-kinds-zone-contract.md) [0042](docs/adr/0042-baeckerei-heusser-built-twin.md) [0046](docs/adr/0046-built-twin-tour-fills-routes.md) |
| 🔍 **Relikt-Blick** | A lens that fades the trees, shows the relief and makes candidates glow | [0018](docs/adr/0018-game-look-relikt-blick-lens.md) |

**Focus area** (no expansion before v5, [0014](docs/adr/0014-audience-scope-devices.md)): Schloss Karlsberg (≈ 49.335 N, 7.379 E, straddles SL/RLP) · Kirrberg incl. Merburg · Homburg incl. Schlossberg.

## 🎯 Goals (v2)

1. 🎮 **Feels like a game.** The 3D view owns the screen; clear HUD; minimap with player + view cone; fly/walk with speed.
2. 🌲 **The real place.** Real trees and houses; the overworld and the zones share the same trees.
3. 🧹 **Simple by default.** About 8 controls for new users; more behind *Entdecker* and *Labor* ([0019](docs/adr/0019-feature-tiers.md)).
4. 🏭 **Zones are cheap to make.** One zone contract, two kinds; captured zones from video via an automated pipeline.
5. 🔍 **Simple relict finding.** Lens, glow, *Merken* with a note. Never on-site guidance ([0021](docs/adr/0021-quests-virtual-only.md)).
6. 📱 **Desktop = phone.** Web richer, phone simpler; 30 fps on the low-end proxy, 60 fps on a Pixel 9 ([0028](docs/adr/0028-phone-proxy-headroom.md)).

## 🚫 Non-goals (v2)

- Expanding beyond the `overall` AOI (→ v5).
- Quests and professions (→ v3), multiplayer (→ v4).
- On-site guidance (own position next to candidates, "go there") until a heritage partner agrees (Q-32).
- Accounts and backends ([0022](docs/adr/0022-local-first-no-accounts.md)).
- Photorealism in the overworld. Zones carry the detail.

## 👥 Users & use cases

**Kirrberg public**, on desktop and phone. *Labor* serves the expert (relief lab, review, reports).

| # | Use case | Tier |
|---|---|---|
| U1 | Open the link on the phone, fly from Kirrberg to the castle, enter through the portal, walk into the Festsaal | 🟢 |
| U2 | Put on *Relikt-Blick* over the forest, see a glowing candidate, *Merken* it with a note | 🟢 |
| U3 | Walk through Bäckerei Heusser | 🟢 |
| U4 | Compare a linear feature with the 1840 map, or check whether an OSM path covers it | 🟡 |
| U5 | Review candidates, measure a profile, export markers, write a report for the LDA | 🔴 |
| U6 (v4) | Follow a friend's avatar and inspect a site together | — |

## 🧹 Features by tier

Full table and the remove / freeze list: [0019](docs/adr/0019-feature-tiers.md) · [0020](docs/adr/0020-remove-move-out-freeze.md).

| Tier | Gist |
|---|---|
| 🟢 Standard | Fly/walk · game minimap · nearest places · paths · houses · aerial ground · CHM trees · share + QR · keybind dialog · Relikt-Blick · *Merken* · tutorial · disclaimer banner · castle zone (Kino look, Rundflug, ≈ 8 highlights) |
| 🟡 Entdecker | Exaggeration · quality · Flurstücke 2D · lens variants · *Zeitreise* 1840 / 1935 · castle time of day, photo mode, *Gewissheit* |
| 🔴 Labor | Full HUD · relief lab · F15 review · marker list + GeoJSON · measuring · F18 report · castle *Dokumentation* |
| 🧊 Freeze | *Mein Standort* · point cloud · castle festivals · plan sheets / glTF |
| 🗑️ / 📦 | AOI switcher, HUD shortcut list, debug panel (dev only), tree collision, 3D parcels, castle 2025 switch, many castle toggles · F21 print → own tool · F22 craters → private repo |

**v2 is done when:** the new shell runs on desktop and phone, CHM trees are in the overworld, the castle (#1) and the bakery (#2) are behind portals, and simple relict finding works, all measured on the phone proxy ([0028](docs/adr/0028-phone-proxy-headroom.md)).

## 🗺️ Roadmap

| Version | Content | ADRs |
|---|---|---|
| ✅ v1 | Relict-discovery tool: relief lab, minimap, markers, detection, castle viewer, mobile, print, public release | [CHANGELOG](CHANGELOG.md) |
| 🚧 **v2** | Game shell (tiers, HUD, minimap), CHM trees, zone contract + portal, castle + bakery zones, simple relict finding | [0014](docs/adr/0014-audience-scope-devices.md)–[0020](docs/adr/0020-remove-move-out-freeze.md), [0024](docs/adr/0024-rebuild-shell-keep-core.md) |
| v3 | Quests and professions (relicts first, later e.g. tree planting), virtual only; castle festivals as events | [0021](docs/adr/0021-quests-virtual-only.md) |
| v4 | Multiplayer via Trystero: see and follow peers | [0023](docs/adr/0023-multiplayer-trystero-v4.md) |
| v5 | Scale: more zones in the area, then the whole Saarland + RLP | Q-34 |

Item-level backlog: [`.claude/skills/sle-roadmap/references/roadmap.md`](.claude/skills/sle-roadmap/references/roadmap.md).

## ❓ Open questions

Decisions with options → `Proposed` ADRs (none open). Still open:

| Q | Question | Blocks | Lean |
|---|---|---|---|
| Q-32 | 🤝 Heritage partner (LDA Saarland, Heimatverein Kirrberg, Saarforst): who talks to them, when? | v3 on-site, *Mein Standort*, F18 outside Labor | Nobody owns it yet |
| Q-34 | ☁️ v5 hosting: ≈ 22 000 km² ≈ 650 GB, beyond GitHub Pages | v5 | Contracts must not assume one small AOI |
| Q-35 | 🏷️ Product name for the public | — | Rename later |
| Q-15 | 🔍 F15 precision unknown (recall 8/18 at 30 m on `overall`) | Glow quality in the lens | Review a few hundred candidates in Labor, then tune |
| Q-37 | 🥖 Bäckerei Heusser twin ([ADR 0042](docs/adr/0042-baeckerei-heusser-built-twin.md)): zone `kind`/`evidence` for a built, measured twin; may prices be shown? | First built twin package | Additive contract change; prices only with the owners' yes |

🧊 Parked v1 questions (Q-6 … Q-31): [PRD v1 §8](docs/history/prd-v1.md#8-open-questions).

## ⚠️ Risks

| Risk | Mitigation |
|---|---|
| 🏺 Gamified relict finding sends people onto monuments, Natura 2000 or UXO sites | Quests virtual only, *Mein Standort* frozen, no "go there" ([0021](docs/adr/0021-quests-virtual-only.md)) |
| ⚖️ Public candidates attract looting | Hypothesis labels, disclaimer, user data private ([0008](docs/adr/0008-hypotheses-schauen-nicht-graben.md), [0009](docs/adr/0009-candidates-public-user-data-private.md)) |
| 💣 UXO data leaks | Two guards, then a private repo ([0010](docs/adr/0010-craters-never-public.md)) |
| 🐢 CHM trees + game look too heavy for the phone | Reference phone from day one; instanced LOD; quality auto |
| 🏭 Zones stay hand-made and slow | Zone contract + automated capture pipeline ([0016](docs/adr/0016-zone-kinds-zone-contract.md)) |
| 🗻 Resampling fakes or hides relicts | Terrarium on the native grid ([0003](docs/adr/0003-terrarium-heights-native-grid.md)) |
| ©️ Licence breach by collapsing attribution | Check before shipping ([0026](docs/adr/0026-collapsed-attribution.md)) |
