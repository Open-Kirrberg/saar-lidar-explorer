# 0054 · 📝 Licences of community content in place repos

- **Status:** Accepted · 2026-11-08 (plan D5, proposed in the plan and not contradicted; accepted under the autonomous-roadmap rule)
- **Origin:** [plan „Orte skalieren“](../plans/orte-skalieren.md) §7, §10 D5 · builds on [0013](0013-attribution-every-source.md)

## Context
Place repos collect points, stories, photos and action reports from many people. Everything is published on GitHub Pages and shown in a public app, so every item needs a licence that allows that, a clear attribution and compatibility with the open sources it builds on (OSM is ODbL).

## Decision
- **Text and images:** CC BY 4.0 by default, CC BY-SA 4.0 allowed per item; own photos only. Every item carries its licence and author (GitHub handle or a chosen name, nothing more).
- **Data contributions** (points, lines, action areas): CC0 1.0; data derived from OpenStreetMap stays ODbL and is marked as such.
- CI rejects items without an allowed licence field; a maintainer reviews every pull request (R6, R7).
- The app shows each item's author and licence in the „© Quellen“ dialog or on the item card ([0026](0026-collapsed-attribution.md)).

## Consequences
- ✅ Content can be shown, mirrored and reused by other projects without asking again.
- ⚠️ Material under other licences (newspaper photos, archive scans) cannot be accepted unless its licence is one of the above or explicitly cleared by a maintainer.
