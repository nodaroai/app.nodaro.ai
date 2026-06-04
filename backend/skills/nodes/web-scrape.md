---
node_type: web-scrape
generated_at: 2026-06-04T12:41:28.217Z
generated_from: 9bf1388db
---

# Web Scrape

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `web-scrape`
**Category:** input
**Credit cost:** 5
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

(Add prose here.)

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
