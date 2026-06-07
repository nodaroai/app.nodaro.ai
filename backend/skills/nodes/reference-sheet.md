---
node_type: reference-sheet
generated_at: 2026-06-07T18:49:02.121Z
generated_from: db2337ab
---

# Reference Sheet

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `reference-sheet`
**Category:** ai
**Credit cost:** 4
**Inputs (target handles):** `in`
**Outputs (source handles):** `sheet`, `panels`

**Required data fields:**
- `label: string`
- `type: SheetType`
- `skin: SheetSkin`
- `flavour: SheetFlavour`

**Optional data fields:**
- `connectedEntityKind?: EntityKind`
- `generatedResults?: GeneratedResult[]`
- `activeResultIndex?: number`
- `panelUrls?: string[]`
- `generatedImageUrl?: string`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `currentJobId?: string`
- `currentJobProgress?: number`
- `errorMessage?: string`

**Default data:**
```json
{
  "label": "Reference Sheet",
  "type": "full-reference",
  "skin": "studio",
  "flavour": {
    "outputFormat": "still",
    "withText": true,
    "showLabels": true,
    "aspect": "landscape",
    "background": "grey"
  }
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
  "id": "reference-sheet-1",
  "type": "reference-sheet",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Reference Sheet",
    "type": "full-reference",
    "skin": "studio",
    "flavour": {
      "outputFormat": "still",
      "withText": true,
      "showLabels": true,
      "aspect": "landscape",
      "background": "grey"
    }
  }
}
```
<!-- AUTO-GEN:END examples -->
