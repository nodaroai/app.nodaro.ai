---
node_type: text-to-audio
generated_at: 2026-10-24T23:37:38.193Z
generated_from: db68a9ee4
---

# Text to Audio

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `text-to-audio`
**Category:** ai
**Credit cost:** `2-33` charged on Nodaro Cloud — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's figure live.
**Inputs (target handles):** `prompt`, `audio-style`
**Outputs (source handles):** `audio`

**Required data fields:**
- `label: string`
- `prompt: string`
- `provider: TextToAudioProvider`
- `duration: number`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `promptPrefix?: string`
- `promptSuffix?: string`
- `currentJobProgress?: number`
- `loop?: boolean`
- `promptInfluence?: number`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedAudioUrl?: string`
- `generatedResults?: GeneratedResult[]`
- `activeResultIndex?: number`

**Default data:**
```json
{
  "label": "Text to Audio",
  "prompt": "",
  "provider": "elevenlabs-sfx",
  "duration": 10,
  "fieldMappings": {}
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

(Add prose here. Auto-gen will preserve it across regenerations.)

<!-- AUTO-GEN:START mcp-call -->
**MCP tool:** `text_to_audio`

**Input parameters:**
- `prompt`
- `presetId`
- `duration`
- `loop`
- `prompt_influence`
- `user_request`
- `flow_id`
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

(Add prose here.)

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "text-to-audio-1",
  "type": "text-to-audio",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Text to Audio",
    "prompt": "",
    "provider": "elevenlabs-sfx",
    "duration": 10,
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
