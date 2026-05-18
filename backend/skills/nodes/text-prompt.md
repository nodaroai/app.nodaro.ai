---
node_type: text-prompt
generated_at: 2026-05-18T13:23:36.988Z
generated_from: cb1e786d
---

# text-prompt

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `text-prompt`
**Category:** input
**Credit cost:** 0
**Inputs (target handles):** `in`
**Outputs (source handles):** `prompt`

**Required data fields:**
- `label: string`
- `text: string`
- `variables: Record<string, string>`

**Optional data fields:**
- `color?: string`
- `textStyle?: string`
- `bold?: boolean`
- `italic?: boolean`
- `outputTarget?: "text" | "voice" | "lyrics"`
- `alignment?: string`
- `width?: number`
- `height?: number`

**Default data:**
```json
{
  "label": "Text Prompt",
  "text": "",
  "variables": {}
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

Display the approved script, a story brief, narration, or any human-readable text on the canvas. The text propagates downstream as a string output via the `prompt` handle.

## Common gotchas

- This is a pure display node — it has no `executionStatus` or `generated*Url` fields.
- The output handle is `prompt`, not `text`. When wiring to a downstream consumer (e.g., a `generate-image` node), use `sourceHandle: "prompt"`.

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "text-prompt-1",
  "type": "text-prompt",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Text Prompt",
    "text": "",
    "variables": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
