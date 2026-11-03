# 0017 · 🌲 Real trees from the CHM, shared by all worlds

- **Status:** Accepted · 2026-11-04
- **Origin:** v2 workshop · diagnosis of the "moving trees"

## Context
- Explorer: the forest is a draped DSM surface (green curtains).
- Castle: trees are seeded procedural placements whose LOD tiers (mid → close → hero) use *different seeds*. Trees jump when you move, plus wind sway.

## Decision
- **One tree per crown** from CHM local maxima: position, height and crown radius come from the data.
- A stable id per tree. All LOD levels derive from that id and **cross-fade**; there is no reseeding between tiers.
- The same tree set and the same vegetation module are used in the overworld and in the zones (outside their modelled area).
- Replaces the F5 canopy drape.

## Consequences
- ✅ "That tree is really there." Real places, no popping.
- ⚠️ New pipeline step and contract layer. Instancing budget on the reference phone.
- ➡️ Walking collides with trunks; flying does not ([0020](0020-remove-move-out-freeze.md)).
