---
"@nodaro/sdk": patch
---

`RenderFinalQuote` gains `holdCredits`: what the run holds while it renders (a UGC clip at its hold), never below `estimatedCredits`. `sufficient` is checked against it, and a refused `renderFinal` names it as `InsufficientCreditsError.required`.
