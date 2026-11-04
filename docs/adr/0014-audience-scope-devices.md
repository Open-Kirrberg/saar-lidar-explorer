# 0014 · 👥 Audience: Kirrberg public · area frozen · desktop = phone

- **Status:** Superseded by 0028 (reference-phone line) · Accepted · 2026-11-04
- **Origin:** v2 workshop with Hoon · [PRD v1 §1–3](../history/prd-v1.md#1-vision)

## Context
v1 was a personal relict tool. v2 is for people from the area who are neither GIS nor archaeology experts.

## Decision
| Topic | Decision |
|---|---|
| 👥 User | The **Kirrberg public** (v1: one personal user) |
| 🗺️ Area | The `overall` AOI only (Kirrberg, Homburg, Karlsberg, 6 × 8 km). **No expansion before v5**: UI and rendering get fine-tuned first |
| 📱 Devices | Desktop and phone are **equally important**. Web is richer, the phone is simpler |
| 🎯 Reference phone | A 2021 mid-range Android at **30 fps** (lead's pick; the user had no preference) |

## Consequences
- ✅ One clear yardstick for every feature: does a neighbour get it in 10 seconds?
- ⚠️ The reference phone is not yet tested on hardware (PRD open question Q-22).
