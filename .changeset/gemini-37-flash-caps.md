---
"@nodaro/shared": patch
---

gemini-3.7-flash: explicit image-only modality caps. Video/audio are deliberately withheld (full caps would auto-enroll the model in `VIDEO_ANALYSIS_LLM_MODELS` and force a video-analysis tier/pricing decision that is deferred while the smart-family A/B routes it internally), so the Generate Text reference gate now reads a stated capability instead of the unknown-model fallback. Guarded by a registry test.
