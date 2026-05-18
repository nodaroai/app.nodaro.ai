---
node_type: text-prompt
generated_at: 2026-05-18T00:00:00Z
generated_from: hand-written
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
- `variables: Record<string, string>` (empty object is fine)

**No `fieldMappings` on this type.**

**Default data:**
```json
{ "label": "Text Prompt", "text": "", "variables": {} }
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
  "id": "script-1",
  "type": "text-prompt",
  "position": { "x": 0, "y": 0 },
  "data": {
    "label": "Script",
    "text": "INT. SPACESHIP - NIGHT\n\nHero suits up in the cockpit...",
    "variables": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
