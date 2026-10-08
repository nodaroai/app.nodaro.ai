---
node_type: content-ideas
generated_at: 2026-10-08T09:21:52.553Z
generated_from: cdb16c72b
---

# Content Ideas

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `content-ideas`
**Category:** ai
**Credit cost:** `10-250` at list price — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's charged figure.
**Inputs (target handles):** `recipes`, `field-brand`
**Outputs (source handles):** `ideas`

**Required data fields:**
- `label: string`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `brand?: string`
- `count?: number`
- `language?: string`
- `llmModel?: string`
- `reasoningEffort?: LlmReasoningEffort`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `currentJobId?: string`
- `currentJobProgress?: number`
- `generatedJson?: ContentIdeaView[]`
- `ideaBriefs?: string[]`
- `generatedText?: string`
- `runWarnings?: string[]`
- `useBrandLessons?: boolean`
- `brandLessons?: { brand: string; lessons: number; record?: number }`

**Default data:**
```json
{
  "label": "Content Ideas",
  "llmModel": "gemini-3.6-flash",
  "brand": "",
  "count": 5,
  "language": "",
  "fieldMappings": {},
  "executionStatus": "idle"
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

Turn one or more content recipes plus a brand profile into concrete post ideas: a title, the hook (first line, first shot, on-screen text), a format, timed beats, a short shot list, a CTA, why it fits the brand, and which post inspired it. Cloud-only.

Wire every Content Recipe into `recipes` (several nodes, or one recipe node that ran once per post — all of them fold into ONE run). Put the brand in `brand` (product, audience, tone, things the brand never does), or wire a Text node into `field-brand`. `count` is 1–10 (default 5); `language` is free text (e.g. "Hebrew"), empty = the brand text's language.

The output is a LIST: the node after it (typically Generate Script) runs once per idea, on the server too. Each item is a complete creative brief.

`useBrandLessons` (on unless `false`) leans the ideas on what has worked for the user's own brand: the lessons of their tracked brand marked "this is my brand" in Competitors (what its best posts share — length, format, hook, hashtag, sound — measured on its own posts; MCP `competitor_lessons`). It also leans on the user's track record on the cards they marked done (which kinds of advice worked for them; MCP `competitor_tried`). Nothing changes without an own brand with enough posts or results; the price is the same. The run's output names the brand it read and how many lessons and record families went in (`brandLessons`).

<!-- AUTO-GEN:START mcp-call -->
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

- Adapt-never-copy is enforced structurally: the model never sees the source's verbatim words, so ideas borrow the format, hook mechanic, beat order and pacing, not the lines.
- Charged per batch of up to five ideas: 6–10 ideas cost two batches.
- `{Content Ideas}` in another node's text resolves to the digest of ALL ideas, not the current one — wire the node instead and let the fan-out deliver one brief per run.

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "content-ideas-1",
  "type": "content-ideas",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Content Ideas",
    "llmModel": "gemini-3.6-flash",
    "brand": "",
    "count": 5,
    "language": "",
    "fieldMappings": {},
    "executionStatus": "idle"
  }
}
```
<!-- AUTO-GEN:END examples -->
