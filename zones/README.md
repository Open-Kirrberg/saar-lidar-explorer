# 🚪 Zones

Detailed places behind portals in the overworld ([ADR 0015](../docs/adr/0015-overworld-zones-portals.md), [0016](../docs/adr/0016-zone-kinds-zone-contract.md)). One folder per zone, named by its contract `id`; the layout is [ADR 0029](../docs/adr/0029-zones-same-bundle-folder-layout.md). Every zone produces a package per the [zone contract](../docs/zone-contract.md) (`sle-zone-v1`), checked with `cd pipeline && uv run python -I zones.py <package dir>`.

| Zone | Kind | Source | Status |
|---|---|---|---|
| [`schloss-karlsberg/`](schloss-karlsberg/README.md) | 🏛️ reconstructed (1789) | generator + authoring viewer, own pnpm package | zone packaging in V2.7 |
| `bakery` | 🎥 captured | `tools/capture/` (footage stays in the git-ignored `data/`) | V2.8 |

Generated packages go to the git-ignored `app/public/data/zones/<id>/`, never into this folder.
