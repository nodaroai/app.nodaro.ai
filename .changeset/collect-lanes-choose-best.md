---
"@nodaro/shared": minor
"@nodaro/sdk": patch
---

**@nodaro/shared**

- `resolveEffectiveSourceType` now also remaps aggregate lane handles: a wire leaving `collect` / `group` on `out-image` / `out-video` / `out-audio` / `out-text` resolves to the plain producer of that lane's type (`upload-image` / `upload-video` / `upload-audio` / `list`), so lane pips connect to typed inputs exactly like the equivalent upload node. New export `AGGREGATE_LANE_SOURCE_TYPES`.
- New `computeAggregateLanes(nodeId, wiredTypes, buckets, edges)` in the group-aggregation module — the lane set an aggregate node exposes (wired-input types ∪ bucket contents ∪ lanes referenced by outgoing edges).
- Reduce strategy registry ("Choose Best"): labels/descriptions rewritten in plain language (`AI picks the best`, `Join into one text`, `First that has content`, `Count them`, `Most common answer`, `Merge JSON objects`); the `pick-best-llm` config schema gains optional `llmModel` (the judge model id from the LLM registry).
- New `LlmFeature` `"pick-best-llm"` with an entry in `LLM_FEATURE_DEFAULTS`. Its credit identifiers tier by the judge model like every other LLM feature (`reduce:pick-best-llm[:economy|:premium]`).

**@nodaro/sdk**

- `client.reduce` docs: `pick-best-llm` accepts `strategyConfig.llmModel` (judge model; omitted = default; its tier sets the credit price).
