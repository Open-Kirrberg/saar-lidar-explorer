# 0050 · 🏅 Orte im Vergleich: medal table instead of a weighted total score

- **Status:** Accepted · 2026-11-08
- **Origin:** user request 2026-11-08 („full view of the leaderboards, comparable, so people bring their place to the top“) · [plan „Orte im Vergleich“](../plans/orte-im-vergleich.md) §5 „Vollansicht“

## Context
The full view (*Alle Ranglisten*) shows all disciplines at once, and people ask „who is best overall?“. A total score needs weights: is 1 percentage point less sealed area worth more or less than one tree per inhabitant? Any weighting is a value judgement we cannot defend, it would invite tuning the weights until a place wins, and it would hide what a place is good at. Disciplines also differ in quality: ☀️ PV is a municipality value shared by several Gemarkungen, 🦋 *Artenvielfalt* depends on who observes where.

## Decision
- **No weighted total score.** The overall view is an olympic **Medaillenspiegel**: count 🥇/🥈/🥉 per place over the ranked *place-scope* ready disciplines, sort by gold, then silver, then bronze, then name; equal counts share the position. The overlay says in one line why there is no total.
- **Same ranking rule as the boards** (`rankBoard`): tied values share a medal, incomplete places and places without data (suppressed, `few_records`) get none.
- **☀️ PV does not count** (municipality scope: one value for several places). **🦋 Artenvielfalt counts**, with a footnote that it is a rough hint: reporting more observations is itself a community action we want to encourage.
- **Stadt/Dorf filter re-ranks within the class** (table and medal table), so villages compete with villages; municipality values keep their own ranking.
- **„So kommt <Ort> nach oben“** converts the gap to the next-better rank into whole-Gemarkung (PV: Gemeinde) amounts only — m² to unseal, m² of green or crown, trees to plant, kWp — never per parcel, building or owner ([0049](0049-orte-im-vergleich-places-only.md)); RLP places carry the *andere Befliegung* note.

## Consequences
- ✅ No arbitrary weights to argue about; every place can see where it already wins and what the next step would take.
- ✅ Pure logic in `app/src/places/compare.ts`, tested in `app/tests/places-compare.test.ts`.
- ⚠️ With few disciplines, medal counts tie often; ties are shown as shared positions, not broken by a hidden rule.
- ⏳ When 📈 *Größter Fortschritt* becomes ready it counts like any other place discipline.
