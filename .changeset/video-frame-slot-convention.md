---
"@nodaro/shared": minor
"@nodaro/prompts": minor
---

One frame-slot convention for every video model whose frames share its reference-image list: the caller's own reference images come first, in order, so an image token N always means their Nth reference; a wired start (and end) frame is appended after them and bound in the prompt as the opening (closing) frame in the provider's own syntax; at the image cap the frames are kept and trailing caller references are dropped.

`@nodaro/shared`:

- New exports `videoProviderAppendsFrames()` (the model puts its frames after the caller's references in one image list), `videoProviderRefModeFrameSeats()` (how many image seats a reference run's frames take: the start frame, plus the end frame where the model takes one) and `videoProviderReferenceSyntax()` / `VideoReferenceSyntax` (`"@image_N"` | `"@image(n)"` | `"[Image N]"`), plus `VIDEO_PROVIDERS_WITH_SEPARATE_FRAME_CHANNEL`. A client that budgets or cites references by ordinal (the cloud plugins) can derive from these instead of a hand-kept list.
- New optional catalog field `referenceSyntax`, declared on Grok Imagine 1 (`@image(n)`) and HappyHorse Ref2V (`[Image N]`).

`@nodaro/prompts`:

- New `placeFramesAfterReferences()` — the one implementation of the convention, used by the Seedance 2 resolver (byte-identical output) and by the Gemini Omni, VEO and Grok / HappyHorse assemblies.
- New `imageBindingFor(syntax)`; `identityRefsSentence()` takes an optional ordinal renderer.
