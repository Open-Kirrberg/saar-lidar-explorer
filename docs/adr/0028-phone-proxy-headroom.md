# 0028 · 📱 Phone proxy + headroom rule instead of a reference phone

- **Status:** Accepted · 2026-11-04
- **Origin:** v2 run, settled decisions H3/H14 · supersedes the reference-phone line of [0014](0014-audience-scope-devices.md) · PRD Q-22

## Context
ADR 0014 named a 2021 mid-range Android at 30 fps as the reference phone. Nobody owns one and no new hardware is bought. Agents cannot hold a real phone, so a yardstick they can rerun is needed, plus a rule for the phones the humans do have.

## Decision
| Topic | Decision |
|---|---|
| 🧪 Low-end proxy | Chrome device emulation (390 × 844, DPR 3, touch), **4× CPU throttle** (`Emulation.setCPUThrottlingRate`), Fast-4G network. Target **30 fps**. Script: `app/scripts/perf-proxy.mjs` (`pnpm run perf`) |
| 🚀 Headroom rule | **60 fps on a Pixel 9** |
| 📱 Real devices | The user's iPhone and Huhn's Pixel 9, tested **by the humans at milestones** |
| 🤖 Agents | Measure and report the proxy only. **Never claim real-phone numbers** |

## Consequences
- ✅ Every item can be judged against the same numbers (`app/README.md` → *Performance*).
- ⚠️ The proxy throttles the CPU, not the GPU: fill rate, shader cost and GPU memory of a phone are not modelled. The synchronous per-frame cost (`step ms`) is the proxy's main signal; real-GPU limits come only from the milestone tests.
- ⚠️ rAF fps is capped by the host display's refresh rate (50/60/120 Hz); at the cap it says "no bottleneck", not "the phone reaches this".
