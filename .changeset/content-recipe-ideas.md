---
"@nodaro/shared": minor
---

Two new Cloud nodes: Content Recipe (why a post worked, as a reusable recipe) and Content Ideas (recipes plus a brand in, post ideas out, one brief per idea).

- Pricing vocabulary, so every surface quotes and bills the same id: `contentRecipeCreditId(llmModel?, reasoningEffort?)` and `contentIdeasCreditId(count, llmModel?, reasoningEffort?)`, with `CONTENT_RECIPE_IDEAS_CREDIT_IDS`. Content Ideas is charged per batch of up to five ideas: 1–5 ideas bill `content-ideas[:economy|:premium]`, 6–10 bill `content-ideas:10[:economy|:premium]`. `clampContentIdeasCount` (1–10, default 5) and the request limits (`CONTENT_RECIPE_SOURCE_MAX`, `CONTENT_IDEAS_MAX_RECIPE_INPUTS`, `CONTENT_IDEAS_BRAND_MAX`, `CONTENT_IDEAS_LANGUAGE_MAX`) are exported beside them.
- `LlmFeature` gains `content-recipe` and `content-ideas` (both default to `gemini-3.6-flash`).
- Fan-in is decided per edge: `FAN_IN_TARGETS` names the nodes that fold everything wired into them and on which handles (`reduce` on every handle, `content-ideas` on `recipes` only), read through `isFanInNodeType` and `isFanInEdge`. `FAN_OUT_EACH_TYPES` lists `content-ideas`: the node after it runs once per idea.
- `videoLinkPageUrl(data)` returns the page link a Video URL node was given, never its downloaded file.
- `EXECUTION_DATA_KEYS` lists `ideaBriefs` and `runWarnings`, the results these nodes write: never captured in a preset or a template export, and a run that writes them is not recorded in undo history.
- `NODE_MAPPABLE_FIELDS` lists `focus` for `content-recipe` and `brand` / `language` for `content-ideas`.
