---
node_type: instrumentation
generated_at: 2026-05-24T21:59:30.535Z
generated_from: 5d3f8b39
---

# Instrumentation

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `instrumentation`
**Category:** parameter
**Credit cost:** 0
**Inputs (target handles):** `in`
**Outputs (source handles):** `out`

**Required data fields:**
- `label: string`

**Optional data fields:**
- `preText?: string`
- `postText?: string`
- `instruments?: string[]`
- `production?: string`
- `vocalPresence?: string | ReadonlyArray<string>`
- `singingStyle?: string | ReadonlyArray<string>`

**Default data:**
```json
{
  "label": "Instrumentation",
  "instruments": []
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
  "id": "instrumentation-1",
  "type": "instrumentation",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Instrumentation",
    "instruments": []
  }
}
```
<!-- AUTO-GEN:END examples -->
