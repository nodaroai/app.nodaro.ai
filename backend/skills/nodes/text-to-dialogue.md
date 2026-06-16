---
node_type: text-to-dialogue
generated_at: 2026-06-16T08:22:28.417Z
generated_from: 877dfa01a
---

# Text to Dialogue

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `text-to-dialogue`
**Category:** ai
**Credit cost:** 4
**Inputs (target handles):** `prompt`
**Outputs (source handles):** `audio`

**Required data fields:**
- `label: string`
- `dialogue: DialogueLine[]`
- `stability: number`
- `languageCode: string`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedAudioUrl?: string`
- `generatedResults?: GeneratedResult[]`
- `activeResultIndex?: number`
- `currentJobId?: string`
- `currentJobProgress?: number`

**Default data:**
```json
{
  "label": "Text to Dialogue",
  "dialogue": [
    {
      "id": "1",
      "text": "",
      "voice": "Sarah"
    }
  ],
  "stability": 0.5,
  "languageCode": "",
  "fieldMappings": {},
  "executionStatus": "idle",
  "generatedResults": [],
  "activeResultIndex": 0
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
  "id": "text-to-dialogue-1",
  "type": "text-to-dialogue",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Text to Dialogue",
    "dialogue": [
      {
        "id": "1",
        "text": "",
        "voice": "Sarah"
      }
    ],
    "stability": 0.5,
    "languageCode": "",
    "fieldMappings": {},
    "executionStatus": "idle",
    "generatedResults": [],
    "activeResultIndex": 0
  }
}
```
<!-- AUTO-GEN:END examples -->
