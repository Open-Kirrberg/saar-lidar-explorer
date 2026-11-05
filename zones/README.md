# 🚪 Zones

Detailed places behind portals in the overworld ([ADR 0015](../docs/adr/0015-overworld-zones-portals.md), [0016](../docs/adr/0016-zone-kinds-zone-contract.md)). One folder per zone, named by its contract `id`; the layout is [ADR 0029](../docs/adr/0029-zones-same-bundle-folder-layout.md). Every zone produces a package per the [zone contract](../docs/zone-contract.md) (`sle-zone-v1`), checked with `cd pipeline && uv run python -I zones.py <package dir>`.

| Zone | Kind | Source | Status |
|---|---|---|---|
| [`schloss-karlsberg/`](schloss-karlsberg/README.md) | 🏛️ reconstructed (1789) | generator + authoring viewer, own pnpm package | zone packaging in V2.7 |
| [`baeckerei-heusser/`](baeckerei-heusser/README.md) | 🥖 built digital twin ([ADR 0042](../docs/adr/0042-baeckerei-heusser-built-twin.md)); the 🎥 capture from `tools/capture/` is the reference (footage stays in the git-ignored `data/`) | catalogue, style, plan, skills in the folder | capture live since V2.8 (id was `bakery`); twin round 1 = foundation |

Generated packages go to the git-ignored `app/public/data/zones/<id>/`, never into this folder.
