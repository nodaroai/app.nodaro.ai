---
"@nodaro/sdk": minor
---

Voice Changer Pro interactive flow on `client.voices`: adds `analyze()` (detect speakers without recasting — `POST /v1/voice-changer-pro/analyze`), extends `recast()` with `output: "video" | "stems"` and `analysis` (pass a prior analyze result to skip re-detection), and adds `exportMix()` (render a mixed set of stems into the final video — `POST /v1/voice-changer-pro/export`). New exported types: `VcpAnalyzeInput`, `VcpAnalysis`, `VcpAnalysisSpeaker`, `VcpExportInput`, `VcpExportTrack`. Together these let any SDK consumer build a full VCP editor (detect → pick a voice per speaker → mix tracks → export), not just the one-shot recast.
