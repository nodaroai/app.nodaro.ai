---
node_type: provider
generated_at: 2026-08-15T21:55:05.817Z
generated_from: 150c80ac9
---

# Provider

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `provider`
**Category:** parameter
**Credit cost:** 0
**Inputs (target handles):** `in`
**Outputs (source handles):** `provider`

**Required data fields:**
- `label: string`
- `category: "image" | "video" | "voice" | "script"`
- `provider: string`
- `model: string`

**Default data:**
```json
{
  "label": "Provider",
  "category": "image",
  "provider": "nano-banana",
  "model": ""
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
  "id": "provider-1",
  "type": "provider",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Provider",
    "category": "image",
    "provider": "nano-banana",
    "model": ""
  }
}
```
<!-- AUTO-GEN:END examples -->
