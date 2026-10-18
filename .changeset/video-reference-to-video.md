---
"@nodaro/shared": minor
---

References-only video runs are decided by a catalog capability.

- A new catalog feature, `reference-to-video`: the model's provider runs from reference images alone, with no start frame. Declared on every video model whose provider contract accepts that — the Seedance 2 family, MiniMax H3, Wan 3.0 / Prime, Gemini Omni / Flash, VEO 3.1 Fast / Lite, Grok Imagine 1 (`grok-i2v`), HappyHorse Ref2V and Vidu Q4 — and requires `reference-image`.
- New export `videoProviderRunsFromReferences()`.
- `resolveVideoModeForInputs` now sends a references-only run on a single-id model with no text-to-video mode that declares the feature (HappyHorse Ref2V, Vidu Q4) to `image-to-video`, so it is no longer refused as "image required" by any surface that resolves through it. Every other model resolves exactly as before, and a run with nothing wired still resolves to the gated text-to-video lane.
