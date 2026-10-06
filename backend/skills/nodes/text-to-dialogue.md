---
node_type: text-to-dialogue
generated_at: 2026-10-06T07:11:47.408Z
generated_from: dc25afa28
---

# Text to Dialogue

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `text-to-dialogue`
**Category:** ai
**Credit cost:** `25` at list price — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's charged figure.
**Inputs (target handles):** `prompt`
**Outputs (source handles):** `audio`

**Required data fields:**
- `label: string`
- `dialogue: DialogueLine[]`
- `stability: number`
- `languageCode: string`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `provider?: DialogueProvider`
- `similarityBoost?: number`
- `seed?: number`
- `applyTextNormalization?: "auto" | "on" | "off"`
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
  "provider": "elevenlabs-dialogue",
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
    "provider": "elevenlabs-dialogue",
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
