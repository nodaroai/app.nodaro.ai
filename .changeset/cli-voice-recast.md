---
"@nodaro/cli": minor
---

Add `nodaro voice recast` (alias `voice pro`) — multi-speaker Voice Changer Pro from the CLI. `--voices` maps speakers in detection order (`--voices Rachel,keep,Aria`); the literal `keep` is a keep-slot — that speaker's original voice is kept (sent as a `null` entry, SDK ≥ 1.2.0). `--voices-json` accepts the raw SDK array (per-voice settings objects and `null` keep-slots), plus flags for model, background preservation, separation quality, music volume, noise removal, voice FX, and `--watch` polling.
