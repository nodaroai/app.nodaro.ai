---
"@nodaro/shared": patch
---

**@nodaro/shared**

- Reduce strategy registry: `ReduceStrategy` gains an optional `usesLlm` flag, set on `pick-best-llm` (the AI judge). Anything that treats "an LLM strategy" specially — such as a self-hosted install forwarding the judge to its nodaro.ai connection — reads this flag instead of matching on the strategy id, so a future LLM strategy is covered by declaring it.
