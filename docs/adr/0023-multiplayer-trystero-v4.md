# 0023 · 👯 Multiplayer via Trystero in v4

- **Status:** Accepted · 2026-11-04
- **Origin:** v2 workshop

## Context
The use case is "following each other around and inspecting the world together". There is no server and no accounts ([0022](0022-local-first-no-accounts.md)).

## Decision
- **v4, after the UI cleanup:** Trystero (P2P WebRTC over public signalling relays).
- Peers share only their **virtual** camera or avatar pose. Never GPS, markers or reviews.
- Avatars show in the world and on the minimap, with *Folgen*.

## Consequences
- ✅ Light, serverless, fits Pages.
- ⚠️ Signalling relays are new third-party hosts (privacy dialog, [0022](0022-local-first-no-accounts.md)). Room links must not be guessable.
