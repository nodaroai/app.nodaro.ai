---
node_type: voice-delivery
generated_at: 2026-05-18T13:23:37.199Z
generated_from: cb1e786d
---

# Voice Delivery

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `voice-delivery`
**Category:** parameter
**Credit cost:** 0
**Inputs (target handles):** `in`
**Outputs (source handles):** `out`

**Required data fields:**
- `label: string`

**Optional data fields:**
- `preText?: string`
- `postText?: string`
- `pace?: string`
- `emotion?: string`
- `archetype?: string`

**Default data:**
```json
{
  "label": "Voice Delivery"
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
  "id": "voice-delivery-1",
  "type": "voice-delivery",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Voice Delivery"
  }
}
```
<!-- AUTO-GEN:END examples -->
