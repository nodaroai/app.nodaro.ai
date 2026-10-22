---
"@nodaro/sdk": patch
---

`RenderFinalQuote.estimatedCreditsIsEstimate?: true` (`workflows.estimateRenderFinal()`): present when the quoted run executes an LLM node, which is charged its actual usage after the run — show the figure `~N`. The prompt helper's `advancedMode` documentation now states how a direct-lane call is billed per model (its actual usage at the vendor's direct rate), and the one-rung bump only where the server prices LLM calls by tier.
