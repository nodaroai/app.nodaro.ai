---
node_type: edit-plan
generated_at: 2026-09-27T12:51:23.919Z
generated_from: c607aa02c
---

# Edit Plan

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `edit-plan`
**Category:** processing
**Credit cost:** `30-1480` at list price — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's charged figure.
**Inputs (target handles):** `transcript`, `silence`, `sources`
**Outputs (source handles):** `edl`

**Required data fields:**
- `label: string`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `promptPrefix?: string`
- `promptSuffix?: string`
- `mode?: "tighten" | "clips" | "chapters"`
- `planTier?: "economy" | "standard" | "premium"`
- `sourceConfig?: Record<string, EditPlanSourceConfig>`
- `sourceOrder?: string[]`
- `instructions?: string`
- `styleGuide?: string`
- `count?: number`
- `targetDurationSec?: number`
- `targetAspect?: "16:9" | "9:16" | "1:1" | "4:5"`
- `platform?: string`
- `transcript?: unknown`
- `silence?: unknown`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `currentJobId?: string`
- `currentJobProgress?: number`
- `generatedJson?: unknown`

**Default data:**
```json
{
  "label": "Edit Plan",
  "mode": "tighten",
  "planTier": "standard",
  "instructions": "",
  "fieldMappings": {},
  "executionStatus": "idle"
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
  "id": "edit-plan-1",
  "type": "edit-plan",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Edit Plan",
    "mode": "tighten",
    "planTier": "standard",
    "instructions": "",
    "fieldMappings": {},
    "executionStatus": "idle"
  }
}
```
<!-- AUTO-GEN:END examples -->
