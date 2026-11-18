---
node_type: replace-audio
generated_at: 2026-11-18T19:43:22.665Z
generated_from: d0de23eefc
---

# Replace Audio

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `replace-audio`
**Category:** processing
**Credit cost:** none declared — an input / parameter / trigger node runs no job; otherwise the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`).
**Inputs (target handles):** `in`, `music`
**Outputs (source handles):** `video-out`

**Required data fields:**
- `label: string`
- `musicSource: "input" | "prompt"`
- `musicPrompt: string`
- `mode: "keep-speech" | "replace-all"`
- `musicVolume: number`
- `speechVolume: number`
- `duckAmount: number`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `currentJobProgress?: number`
- `videoUrl?: string`
- `musicUrl?: string`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedVideoUrl?: string`
- `generatedResults?: readonly GeneratedResult[]`
- `activeResultIndex?: number`
- `currentJobId?: string`

**Default data:**
```json
{
  "label": "Replace Audio",
  "musicSource": "input",
  "musicPrompt": "",
  "mode": "keep-speech",
  "musicVolume": 80,
  "speechVolume": 100,
  "duckAmount": 70,
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
  "id": "replace-audio-1",
  "type": "replace-audio",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Replace Audio",
    "musicSource": "input",
    "musicPrompt": "",
    "mode": "keep-speech",
    "musicVolume": 80,
    "speechVolume": 100,
    "duckAmount": 70,
    "fieldMappings": {},
    "executionStatus": "idle",
    "generatedResults": [],
    "activeResultIndex": 0
  }
}
```
<!-- AUTO-GEN:END examples -->
