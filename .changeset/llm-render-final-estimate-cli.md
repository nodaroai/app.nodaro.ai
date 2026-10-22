---
"@nodaro/cli": patch
---

`nodaro workflows render-final --estimate` prints the estimate as `~N` when the run executes an LLM node (the quote's `estimatedCreditsIsEstimate`), which is charged its actual usage.
