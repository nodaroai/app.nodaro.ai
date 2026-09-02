---
"@nodaro/shared": minor
---

`stripDerivedAnalysisFields(json)` — a video analysis with its server-derived fields removed (top-level `warnings` / `variationFolds`; per-scene `visualResolved` / `slotRefs` / `oversized`; `refImageUrl` kept): the compact form an LLM is handed when the analysis is the brief. One strip list for the async structured-draft worker (`POST /v1/llm/structured/jobs` with `videoUrl`) and the Nodaro Studio job-id loader.
