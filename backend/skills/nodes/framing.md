---
node_type: framing
generated_at: 2026-10-08T22:50:03.193Z
generated_from: ae4e7e3d0
---

# Framing

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `framing`
**Category:** parameter
**Credit cost:** none declared — an input / parameter / trigger node runs no job; otherwise the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`).
**Inputs (target handles):** `in`, `picker-json`
**Outputs (source handles):** `out`

**Required data fields:**
- `label: string`

**Optional data fields:**
- `shotSize?: string`
- `angle?: string`
- `coverage?: string`
- `composition?: string | ReadonlyArray<string>`
- `vantage?: string`
- `maxItemsPerRow?: number`
- `preText?: string`
- `postText?: string`
- `applyMode?: PickerApplyMode`
- `autoApplyInjected?: boolean`
- `lastAppliedPickerJson?: Record<string, unknown>`
- `lastAppliedPickerRunId?: string`
- `hintMode?: "full" | "compact"`

**Valid values:** call `get_picker_catalog("framing")` (MCP) or `GET /v1/picker-catalogs/framing` for the catalog of valid ids.

**Default data:**
```json
{
  "label": "Framing",
  "shotSize": "wide-shot"
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
  "id": "framing-1",
  "type": "framing",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Framing",
    "shotSize": "wide-shot"
  }
}
```
<!-- AUTO-GEN:END examples -->
