# 🚪 Zones

Detailed places behind portals in the overworld ([ADR 0015](../docs/adr/0015-overworld-zones-portals.md), [0016](../docs/adr/0016-zone-kinds-zone-contract.md)). One folder per zone, named by its contract `id`; the layout is [ADR 0029](../docs/adr/0029-zones-same-bundle-folder-layout.md). Every zone produces a package per the [zone contract](../docs/zone-contract.md) (`sle-zone-v1`), checked with `cd pipeline && uv run python -I zones.py <package dir>`.

| Zone | Kind | Source | Status |
|---|---|---|---|
| [`schloss-karlsberg/`](schloss-karlsberg/README.md) | 🏛️ reconstructed (1789) | generator + authoring viewer, own pnpm package | ✅ zone #1 (V2.7), waves 0–11; zone package cleared for the public release ([ADR 0048](../docs/adr/0048-castle-zone-public.md)) |
| [`baeckerei-heusser/`](baeckerei-heusser/README.md) | 🥖 built digital twin ([ADR 0042](../docs/adr/0042-baeckerei-heusser-built-twin.md)); the 🎥 capture from `tools/capture/` is the reference (footage stays in the git-ignored `data/`) | catalogue, style, plan, skills in the folder | ✅ zone #2, built twin: rounds 1–6 + waves A/B, public since 2026-11-06 |

Generated packages go to the git-ignored `app/public/data/zones/<id>/`, never into this folder. A package reaches the public data only when it is listed in `RELEASE_ZONES` and cleared in `PUBLIC_ZONE_POLICY` (`scripts/release/`, [RELEASING.md §2](../scripts/release/RELEASING.md#2-export-the-data)): the castle with its exact module files (terrain + CC0 textures), the bakery with `built/` only.
