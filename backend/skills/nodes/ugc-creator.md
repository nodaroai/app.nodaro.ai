---
node_type: ugc-creator
generated_at: 2026-10-14T00:02:34.342Z
generated_from: b83a9467d
---

# UGC Creator

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `ugc-creator`
**Category:** ai
**Credit cost:** `0` charged on Nodaro Cloud — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's figure live.
**Inputs (target handles):** `photo`, `category`, `pickers`
**Outputs (source handles):** `creator`, `image`

**Required data fields:**
- `label: string`
- `source: "sampled" | "photo"`
- `gender: "woman" | "man"`
- `keepResult: boolean`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `photoUrl?: string`
- `categoryOverride?: string`
- `seed?: number`
- `result?: Record<string, unknown>`
- `ugcOutputs?: Record<string, string>`
- `candidates?: UgcCreatorCandidate[]`
- `optionFailed?: boolean`
- `generatedImageUrl?: string`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `currentJobId?: string`
- `currentJobProgress?: number`

**Default data:**
```json
{
  "label": "UGC Creator",
  "source": "sampled",
  "gender": "woman",
  "keepResult": false,
  "fieldMappings": {}
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
  "id": "ugc-creator-1",
  "type": "ugc-creator",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "UGC Creator",
    "source": "sampled",
    "gender": "woman",
    "keepResult": false,
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
