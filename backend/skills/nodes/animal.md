---
node_type: animal
generated_at: 2026-06-23T16:51:38.178Z
generated_from: 52fc7de9b
---

# Animal

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `animal`
**Category:** parameter
**Credit cost:** 0
**Inputs (target handles):** `in`
**Outputs (source handles):** `out`

**Required data fields:**
- `label: string`
- `animal: string`

**Optional data fields:**
- `preText?: string`
- `postText?: string`

**Valid values:** call `get_picker_catalog("animal")` (MCP) or `GET /v1/picker-catalogs/animal` for the catalog of valid ids.

**Default data:**
```json
{
  "label": "Animal",
  "animal": "dog-golden-retriever"
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
  "id": "animal-1",
  "type": "animal",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Animal",
    "animal": "dog-golden-retriever"
  }
}
```
<!-- AUTO-GEN:END examples -->
