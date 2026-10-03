---
node_type: web-scrape
generated_at: 2026-09-27T12:51:22.300Z
generated_from: c607aa02c
---

# Web Scrape

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `web-scrape`
**Category:** input
**Credit cost:** `20` at list price — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's charged figure.
**Inputs (target handles):** `in`
**Outputs (source handles):** `json`

**Required data fields:**
- `label: string`

**Optional data fields:**
- `actor?: ScraperActorId`
- `url?: string`
- `mode?: "page" | "site"`
- `query?: string`
- `maxResults?: number`
- `countryCode?: string`
- `target?: string`
- `resultsLimit?: number`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedJson?: unknown`
- `lastRunOutcome?: "success" | "empty" | "failed"`
- `lastRunAt?: number`
- `lastRunCount?: number`
- `lastRunStartedAt?: number`
- `lastRunFingerprint?: string`
- `lastGoodAt?: number`
- `lastGoodCount?: number`

**Default data:**
```json
{
  "label": "Web Scrape",
  "actor": "google-search",
  "query": ""
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

(Add prose here. Auto-gen will preserve it across regenerations.)

<!-- AUTO-GEN:START mcp-call -->
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

- **A site crawl runs for minutes.** `mode: "site"` follows up to 20 pages and
  a real run measured ~250 s — past the ~100 s HTTP edge timeout. The workflow
  runner and the editor handle this on their own. A direct API caller should
  send `respondAsync: true`: the route then answers `{ jobId, status: "pending" }`
  at once and finishes server-side, and the pages are read from the completed
  job's `output_data.json` (poll `GET /v1/jobs/:id`). Without the flag the
  request is held open until the scrape is done and the result comes back in
  the response body — fine for a single page, a search or a feed, and cut off
  at the edge for a long crawl even though the job completes and is charged.

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "web-scrape-1",
  "type": "web-scrape",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Web Scrape",
    "actor": "google-search",
    "query": ""
  }
}
```
<!-- AUTO-GEN:END examples -->
