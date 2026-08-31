---
"@nodaro/prompts": minor
---

Truncation ordering: over a provider's image-prompt cap, `assembleImageInput` now sheds its own direction-folded hint clauses — from the END of the fold order — instead of letting `buildImagePrompt`'s order-blind tail clamp decide. Reference directives and the role phrases that bind them, `@`-mention-resolved text, the user's prose, the `structured` fragment and the appended `Style:`/`Avoid:` lines all outrank a hint and now survive a maximal `direction` on a low-cap model (seedream = 3000 chars); the tail clamp remains the last resort for a body that overflows with zero hints left. Under-cap assemblies are byte-identical — the first pass folds every hint, so shedding only ever runs on an over-cap prompt, and a caller with no `direction`/`structured` still takes the exact no-op path. New export `buildImagePromptWithOverflow` returns `buildImagePrompt`'s byte-identical result plus `overflowChars`, the number of characters the cap forced off the tail.
