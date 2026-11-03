# 0009 · 🔓 Candidates public; markers, reviews and location private

- **Status:** Accepted · 2026-11-02
- **Origin:** [PRD v1 §9](../history/prd-v1.md#9-decisions-log) (user decision, against the lead's recommendation)

## Context
The full explorer goes online ([0012](0012-github-pages-release.md)). Relict candidates (F15) can attract looters.

## Decision
| Data | Visibility |
|---|---|
| F15 *relict* candidates (`overall` AOI) | 🌍 Public, labelled as unchecked hypotheses with reasons and scores |
| User markers, notes, reviews, measurements, settings | 🔒 Browser localStorage only; exports are downloads |
| Own position (*Mein Standort*) | 🔒 Memory only, never stored or sent |
| URL hash / share link | Camera and view only, never markers or candidates |

## Consequences
- ⚠️ Looting risk accepted; mitigations in [0008](0008-hypotheses-schauen-nicht-graben.md) and [0021](0021-quests-virtual-only.md).
- ➡️ UXO classes are the exception ([0010](0010-craters-never-public.md)).
