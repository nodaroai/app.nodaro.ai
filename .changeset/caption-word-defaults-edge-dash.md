---
"@nodaro/shared": minor
---

`styleCaptionPlan` returns its segments as the add-captions segment schema parses them, so a caption plan's word entries carry `timestampMs` / `confidence` (null) exactly as a route request would. New `isBareDashToken` / `trimEdgeDashTokens`: the rule that a caption line never starts or ends on a lone dash token.
