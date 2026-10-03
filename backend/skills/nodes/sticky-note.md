---
node_type: sticky-note
generated_at: 2026-09-27T12:51:25.311Z
generated_from: c607aa02c
---

# Sticky Note

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `sticky-note`
**Category:** utility
**Credit cost:** none declared — an input / parameter / trigger node runs no job; otherwise the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`).
**Inputs (target handles):** (none)
**Outputs (source handles):** (none)

**Required data fields:**
- `label: string`
- `text: string`
- `color: string`
- `textColor: string`
- `width: number`
- `height: number`
- `fontSize: "sm" | "base" | "lg" | "xl"`
- `bold: boolean`
- `italic: boolean`
- `alignment: "left" | "center" | "right"`

**Optional data fields:**
- `title?: string`

**Default data:**
```json
{
  "label": "Sticky Note",
  "title": "Note",
  "text": "",
  "color": "#26221a",
  "textColor": "#ffffff",
  "width": 320,
  "height": 200,
  "fontSize": "base",
  "bold": false,
  "italic": false,
  "alignment": "left"
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
  "id": "sticky-note-1",
  "type": "sticky-note",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Sticky Note",
    "title": "Note",
    "text": "",
    "color": "#26221a",
    "textColor": "#ffffff",
    "width": 320,
    "height": 200,
    "fontSize": "base",
    "bold": false,
    "italic": false,
    "alignment": "left"
  }
}
```
<!-- AUTO-GEN:END examples -->
