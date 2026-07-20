---
"@nodaro/prompts": minor
---

`resolveSeedance2Inputs` accepts an optional `prompt` and suppresses the trailing "Use @image_N as the opening (first) frame" sentence when the prompt already binds a first frame itself (new `promptBindsFirstFrame` export). Field finding: the first-frame directive only reliably steers Seedance when adjacent to the extend colon; a duplicate sentence at the end dilutes it. The frame image still rides the reference list.
