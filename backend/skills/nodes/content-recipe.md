---
node_type: content-recipe
generated_at: 2026-10-01T22:35:58.583Z
generated_from: 9efb4473c
---

# Content Recipe

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `content-recipe`
**Category:** ai
**Credit cost:** `5-35` at list price — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's charged figure.
**Inputs (target handles):** `in`, `link`
**Outputs (source handles):** `json`, `text`

**Required data fields:**
- `label: string`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `llmModel?: string`
- `reasoningEffort?: LlmReasoningEffort`
- `focus?: string`
- `sourceUrl?: string`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `currentJobId?: string`
- `currentJobProgress?: number`
- `generatedJson?: ContentRecipeView`
- `generatedText?: string`
- `runWarnings?: string[]`

**Default data:**
```json
{
  "label": "Content Recipe",
  "llmModel": "gemini-3.6-flash",
  "focus": "",
  "sourceUrl": "",
  "fieldMappings": {},
  "executionStatus": "idle"
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

Explain why a social post worked, as a reusable recipe: the hook (what is said, written and seen in the first ~3 seconds and why it stops the scroll), one format label from a fixed list with a confidence, the timed beats, 2–4 reasons it works, the call to action, the sound and the pace. Cloud-only.

Wire the material into `in`: a **Video Analysis** result is best (timings, verbatim speech and on-screen text); a scraped post (Instagram / Meta Ads item) or plain text (a caption, a transcript) also works. Wire the **Video URL** node into `link` so the recipe keeps the post's own link — the resolver reads the node's page link, never its downloaded file. Outputs: `json` (the recipe object, `version: 1`) and `text` (the readable recipe — what Content Ideas reads).

Typical chain: Video URL → Video Analysis → **Content Recipe** → Content Ideas → Generate Script.

<!-- AUTO-GEN:START mcp-call -->
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

- One post per run. Given a list of posts it reads the first and says so in the node's warnings — set the wire to "Each" to get one recipe per post (then wire that node into Content Ideas' `recipes`; Content Ideas folds every run's recipe).
- The analysis is the expensive step; the recipe itself is one structured model call priced by the model's tier (economy by default).
- Labels (format, hook types, beat purposes, reasons, CTA, sound) are English ids from fixed lists; descriptions are English; quotes keep the post's language.

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "content-recipe-1",
  "type": "content-recipe",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Content Recipe",
    "llmModel": "gemini-3.6-flash",
    "focus": "",
    "sourceUrl": "",
    "fieldMappings": {},
    "executionStatus": "idle"
  }
}
```
<!-- AUTO-GEN:END examples -->
