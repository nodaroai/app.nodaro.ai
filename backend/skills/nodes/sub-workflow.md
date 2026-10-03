---
node_type: sub-workflow
generated_at: 2026-09-27T12:51:25.432Z
generated_from: c607aa02c
---

# Sub-Workflow

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `sub-workflow`
**Category:** utility
**Credit cost:** `0` at list price — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's charged figure.
**Inputs (target handles):** `in`
**Outputs (source handles):** `out`

**Required data fields:**
- `label: string`
- `referencedWorkflowId: string`
- `referencedWorkflowName: string`
- `selectedRouteId: string`
- `routeSnapshot: SubWorkflowRouteSnapshot | null`
- `fieldMappings: Record<string, FieldMapping>`
- `executionStatus: "idle" | "running" | "completed" | "failed"`

**Optional data fields:**
- `currentJobProgress?: number`
- `errorMessage?: string`
- `outputResults?: Record<string, string>`
- `generatedResults?: GeneratedResult[]`
- `activeResultIndex?: number`
- `subWorkflowProgress?: { currentNode: string; completed: number; total: number }`
- `viewMode?: string`

**Default data:**
```json
{
  "label": "Sub-Workflow",
  "referencedWorkflowId": "",
  "referencedWorkflowName": "",
  "selectedRouteId": "",
  "routeSnapshot": null,
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
  "id": "sub-workflow-1",
  "type": "sub-workflow",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Sub-Workflow",
    "referencedWorkflowId": "",
    "referencedWorkflowName": "",
    "selectedRouteId": "",
    "routeSnapshot": null,
    "fieldMappings": {},
    "executionStatus": "idle"
  }
}
```
<!-- AUTO-GEN:END examples -->
