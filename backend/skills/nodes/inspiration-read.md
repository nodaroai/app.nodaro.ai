---
node_type: inspiration-read
generated_at: 2026-10-07T12:47:51.335Z
generated_from: 1e55f1483
---

# Read Inspiration

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `inspiration-read`
**Category:** input
**Credit cost:** `0` at list price — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's charged figure.
**Inputs (target handles):** (none)
**Outputs (source handles):** `json`, `text`

**Required data fields:**
- `label: string`
- `platform: SocialPlatform | "all"`
- `tag: string`
- `period: SocialReadPeriod`
- `windowAmount: number`
- `windowUnit: CollectionReadWindowUnit`
- `limit: number`
- `order: CollectionReadOrder`

**Optional data fields:**
- `day?: string`
- `timezone?: string`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `currentJobId?: string`
- `currentJobProgress?: number`
- `generatedJson?: SocialPost[]`
- `generatedText?: string`

**Default data:**
```json
{
  "label": "Read Inspiration",
  "platform": "all",
  "tag": "",
  "period": "window",
  "windowAmount": 7,
  "windowUnit": "days",
  "limit": 20,
  "order": "newest"
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

Feed the posts a person saved to their Inspiration library into a workflow: a writer that imitates saved hooks, a weekly digest of saved posts, a Save to Collection that files them. It emits the Social Search post shape on `json` (plus `savedAt`, `note`, `tags`) and their digest on `text`. Pick `platform` (or `all`), an optional `tag`, and a period: `period: "window"` with `windowAmount` + `windowUnit`, or `period: "day"` with `day` (YYYY-MM-DD) and `timezone` (IANA).

<!-- AUTO-GEN:START mcp-call -->
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

- It reads by the day each post was SAVED, not published.
- `day` is read only in day mode; give its `timezone`, or the day is read in UTC.
- An empty period emits nothing on both outputs, so the text nodes behind it are skipped (the run ends nothing-new).
- Only the workflow's owner can run it: a run of someone else's workflow (a published app, a shared workflow, a component) answers 403 `owner_only`.

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "inspiration-read-1",
  "type": "inspiration-read",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Read Inspiration",
    "platform": "all",
    "tag": "",
    "period": "window",
    "windowAmount": 7,
    "windowUnit": "days",
    "limit": 20,
    "order": "newest"
  }
}
```
<!-- AUTO-GEN:END examples -->
