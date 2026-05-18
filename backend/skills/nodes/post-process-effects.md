---
node_type: post-process-effects
generated_at: 2026-05-18T13:23:37.307Z
generated_from: cb1e786d
---

# Post-Process Effects

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `post-process-effects`
**Category:** parameter
**Credit cost:** 0
**Inputs (target handles):** `in`
**Outputs (source handles):** `out`

**Required data fields:**
- `label: string`
- `postProcess: string | ReadonlyArray<string> | undefined`

**Optional data fields:**
- `preText?: string`
- `postText?: string`

**Default data:**
```json
{
  "label": "Post-Process Effects",
  "postProcess": "vignette-soft"
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
  "id": "post-process-effects-1",
  "type": "post-process-effects",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Post-Process Effects",
    "postProcess": "vignette-soft"
  }
}
```
<!-- AUTO-GEN:END examples -->
