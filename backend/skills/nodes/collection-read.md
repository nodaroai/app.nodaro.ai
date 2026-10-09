---
node_type: collection-read
generated_at: 2026-10-08T20:04:10.303Z
generated_from: 204462824
---

# Read Collection

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `collection-read`
**Category:** input
**Credit cost:** `0` at list price — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's charged figure.
**Inputs (target handles):** (none)
**Outputs (source handles):** `json`, `text`

**Required data fields:**
- `label: string`
- `collectionId: string`
- `windowAmount: number`
- `windowUnit: CollectionReadWindowUnit`
- `limit: number`
- `order: CollectionReadOrder`
- `textFormat: CollectionDigestFormat`

**Optional data fields:**
- `collectionName?: string`
- `usage?: CollectionUsage`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `currentJobId?: string`
- `currentJobProgress?: number`
- `generatedJson?: CollectionRecord[]`
- `generatedText?: string`

**Default data:**
```json
{
  "label": "Read Collection",
  "collectionId": "",
  "windowAmount": 24,
  "windowUnit": "hours",
  "limit": 50,
  "order": "newest",
  "textFormat": "headlines",
  "usage": "all"
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
  "id": "collection-read-1",
  "type": "collection-read",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Read Collection",
    "collectionId": "",
    "windowAmount": 24,
    "windowUnit": "hours",
    "limit": 50,
    "order": "newest",
    "textFormat": "headlines",
    "usage": "all"
  }
}
```
<!-- AUTO-GEN:END examples -->
