---
node_type: audio-separation
generated_at: 2026-06-19T13:33:55.692Z
generated_from: 9cc2f45ee
---

# Audio Separation

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `audio-separation`
**Category:** ai
**Credit cost:** 8
**Inputs (target handles):** `audio`
**Outputs (source handles):** `audio`

**Required data fields:**
- `label: string`
- `mode: "vocal_instrumental" | "stems"`
- `quality: "auto" | "fast" | "best"`

**Optional data fields:**
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedAudioUrl?: string`
- `generatedResults?: GeneratedResult[]`
- `activeResultIndex?: number`
- `vocalUrl?: string`
- `instrumentalUrl?: string`
- `drumsUrl?: string`
- `bassUrl?: string`
- `otherUrl?: string`
- `guitarUrl?: string`
- `pianoUrl?: string`
- `currentJobId?: string`
- `currentJobProgress?: number`
- `fieldMappings?: FieldMappings`

**Default data:**
```json
{
  "label": "Audio Separation",
  "mode": "vocal_instrumental",
  "quality": "auto",
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
  "id": "audio-separation-1",
  "type": "audio-separation",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Audio Separation",
    "mode": "vocal_instrumental",
    "quality": "auto",
    "fieldMappings": {},
    "executionStatus": "idle",
    "generatedResults": [],
    "activeResultIndex": 0
  }
}
```
<!-- AUTO-GEN:END examples -->
