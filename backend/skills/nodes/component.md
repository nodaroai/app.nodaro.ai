---
node_type: component
generated_at: 2026-06-04T12:41:29.367Z
generated_from: 9bf1388db
---

# Component

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `component`
**Category:** utility
**Credit cost:** 0
**Inputs (target handles):** `in`
**Outputs (source handles):** `out`

**Required data fields:**
- `label: string`
- `appSlug: string`
- `appVersionId: string`
- `pinnedVersion: number`
- `componentMetadata: ComponentMetadata`
- `exposedSettings: Record<string, unknown>`
- `creatorName: string`
- `creatorId: string`
- `estimatedCredits: number`
- `executionStatus: "idle" | "running" | "completed" | "failed"`

**Optional data fields:**
- `outputResults?: Record<string, string>`
- `errorMessage?: string`
- `generatedResults?: GeneratedResult[]`
- `activeResultIndex?: number`

**Default data:**
```json
{
  "label": "Component",
  "appSlug": "",
  "appVersionId": "",
  "pinnedVersion": 0,
  "componentMetadata": {
    "inputs": [],
    "outputs": [],
    "exposedSettings": []
  },
  "exposedSettings": {},
  "creatorName": "",
  "creatorId": "",
  "estimatedCredits": 0,
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
  "id": "component-1",
  "type": "component",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Component",
    "appSlug": "",
    "appVersionId": "",
    "pinnedVersion": 0,
    "componentMetadata": {
      "inputs": [],
      "outputs": [],
      "exposedSettings": []
    },
    "exposedSettings": {},
    "creatorName": "",
    "creatorId": "",
    "estimatedCredits": 0,
    "executionStatus": "idle"
  }
}
```
<!-- AUTO-GEN:END examples -->
