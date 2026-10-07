---
node_type: competitor-read
generated_at: 2026-10-07T12:47:51.352Z
generated_from: 1e55f1483
---

# Read Competitor

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `competitor-read`
**Category:** input
**Credit cost:** `0` at list price — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's charged figure.
**Inputs (target handles):** (none)
**Outputs (source handles):** `json`, `text`

**Required data fields:**
- `label: string`
- `competitorId: string`
- `platform: SocialPlatform | "all"`
- `role: CompetitorReadRole`
- `period: SocialReadPeriod`
- `windowAmount: number`
- `windowUnit: CollectionReadWindowUnit`
- `limit: number`
- `order: CollectionReadOrder`

**Optional data fields:**
- `competitorName?: string`
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
  "label": "Read Competitor",
  "competitorId": "",
  "platform": "all",
  "role": "all",
  "period": "window",
  "windowAmount": 7,
  "windowUnit": "days",
  "limit": 20,
  "order": "newest"
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

Feed a tracked brand's posts into a workflow: what a competitor published this week, posts about the brand for a sentiment summary, a daily brief after the brand's scan. `competitorId` is the brand's id (MCP `list_competitors`). It emits the Social Search post shape on `json` (plus `role`: `own`, `about` or `market`) and their digest on `text`. Filter with `platform` (or `all`) and `role` (`own`, `about`, `all`); the period is `period: "window"` with `windowAmount` + `windowUnit`, or `period: "day"` with `day` (YYYY-MM-DD) and `timezone` (IANA).

<!-- AUTO-GEN:START mcp-call -->
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

- It reads what the brand's scans already found: a day no scan covered has no posts, and a scan reads up to 20 posts per account. Run `scan_competitor` (priced) first when the latest scan is older than the period.
- It reads by the day each post was PUBLISHED; a post with no date counts on the day the first scan saw it.
- The period is held to how long the plan keeps scans (one to twelve months).
- Nodaro Cloud only: other servers answer 503 `not_available`.
- Only the workflow's owner can run it: a run of someone else's workflow (a published app, a shared workflow, a component) answers 403 `owner_only`.
- `role: "all"` is every post the scans found, the market posts a scan reads beside the brand's included.

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "competitor-read-1",
  "type": "competitor-read",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Read Competitor",
    "competitorId": "",
    "platform": "all",
    "role": "all",
    "period": "window",
    "windowAmount": 7,
    "windowUnit": "days",
    "limit": 20,
    "order": "newest"
  }
}
```
<!-- AUTO-GEN:END examples -->
