---
node_type: collection-write
generated_at: 2026-10-08T20:04:10.344Z
generated_from: 204462824
---

# Save to Collection

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `collection-write`
**Category:** output
**Credit cost:** `0` at list price — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's charged figure.
**Inputs (target handles):** `in`, `image`, `video`
**Outputs (source handles):** `json`

**Required data fields:**
- `label: string`
- `collectionId: string`
- `title: string`
- `text: string`
- `link: string`
- `dedupeKey: string`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `collectionName?: string`
- `markSourceUsed?: boolean`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `currentJobId?: string`
- `generatedJson?: CollectionRecord`
- `generatedText?: string`
- `lastOutcome?: CollectionWriteOutcome`
- `lastEvicted?: number`

**Default data:**
```json
{
  "label": "Save to Collection",
  "collectionId": "",
  "title": "",
  "text": "",
  "link": "",
  "dedupeKey": "",
  "fieldMappings": {},
  "markSourceUsed": false
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
  "id": "collection-write-1",
  "type": "collection-write",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Save to Collection",
    "collectionId": "",
    "title": "",
    "text": "",
    "link": "",
    "dedupeKey": "",
    "fieldMappings": {},
    "markSourceUsed": false
  }
}
```
<!-- AUTO-GEN:END examples -->
