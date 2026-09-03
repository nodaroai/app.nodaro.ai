---
"@nodaro/shared": minor
---

`ModelCatalogEntry` gains an optional `safetyFilter: { stochastic: true; fallback?: string }` flag for models whose provider safety filter is known to be non-deterministic — a benign prompt can trip it once and pass on an identical retry. `gpt-image-2` now declares it with `fallback: "nano-banana-pro"`.

New `safetyRetryPolicy(modelId)` reads the flag and returns `{ maxAttempts: 2, fallback }` for a flagged model (fallback omitted unless it resolves to a real catalog entry) and `{ maxAttempts: 1 }` for everything else, including unknown ids. A catalog-wide guard test requires every declared `fallback` to point at an entry that actually covers the flagged model: it must produce an image, support every mode the flagged model supports, and accept a reference image.
