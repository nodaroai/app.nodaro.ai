---
node_type: sticky-note
generated_at: 2026-05-18T13:23:37.813Z
generated_from: cb1e786d
---

# Sticky Note

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `sticky-note`
**Category:** utility
**Credit cost:** 0
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

**Default data:**
```json
{
  "label": "Sticky Note",
  "text": "I'm a note\nDouble click to customize",
  "color": "#2d2d44",
  "textColor": "#ffffff",
  "width": 840,
  "height": 540,
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
    "text": "I'm a note\nDouble click to customize",
    "color": "#2d2d44",
    "textColor": "#ffffff",
    "width": 840,
    "height": 540,
    "fontSize": "base",
    "bold": false,
    "italic": false,
    "alignment": "left"
  }
}
```
<!-- AUTO-GEN:END examples -->
