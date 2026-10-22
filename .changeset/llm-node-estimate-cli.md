---
"@nodaro/cli": patch
---

`nodaro nodes list` (and the node picker) show a metered LLM node's credit figure as `~N`: its default model's typical-call estimate, charged its actual usage after the run. A node whose default model has no price yet shows `unpriced`.
