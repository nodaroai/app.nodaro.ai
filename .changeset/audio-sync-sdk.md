---
"@nodaro/sdk": minor
---

Add `client.edit.audioSync({ sources, reference? })` (`POST /v1/audio-sync`): measure how far apart the clocks of 2–6 recordings of one conversation are, from their sound. The finished job's `output_data.json` is an `AudioSyncResult` — `{ version, reference, offsets: [{ sourceId, offsetMs, confidence, driftMsPerHour }], notes }`, with `referenceMs = sourceMs + offsetMs`. New types: `AudioSyncInput`, `AudioSyncSource`, `AudioSyncOffset`, `AudioSyncResult`.
