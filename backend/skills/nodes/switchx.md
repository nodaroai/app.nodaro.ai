---
node_type: switchx
generated_at: 2026-08-29T19:08:21.144Z
generated_from: 7dbf4818b
---

# Relight & Switch

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `switchx`
**Category:** ai
**Credit cost:** 36
**Inputs (target handles):** `video`, `image`, `mask`, `mask-video`, `prompt`
**Outputs (source handles):** `video`

**Required data fields:**
- `label: string`
- `prompt: string`
- `provider: "beeble-switchx"`
- `alphaMode: "auto" | "fill" | "select" | "custom"`
- `maxResolution: 720 | 1080`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `promptPrefix?: string`
- `promptSuffix?: string`
- `referenceImageUrl?: string`
- `maskUrl?: string`
- `alphaKeyframeIndex?: number`
- `seed?: number`
- `repeatCount?: number`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedVideoUrl?: string`
- `generatedResults?: GeneratedResult[]`
- `activeResultIndex?: number`
- `currentJobId?: string`
- `currentJobProgress?: number`
- `connectedImageOrder?: readonly string[]`
- `referenceOrder?: readonly string[]`
- `suppressedCanonicalCharacterIds?: readonly string[]`
- `suppressedCanonicalLocationIds?: readonly string[]`
- `extraRefs?: readonly ExtraRef[]`
- `videoPlayState?: "loop" | "paused" | "stopped"`
- `pausedAtTime?: number`

**Default data:**
```json
{
  "label": "Relight & Switch",
  "provider": "beeble-switchx",
  "alphaMode": "auto",
  "prompt": "",
  "maxResolution": 1080,
  "fieldMappings": {}
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
  "id": "switchx-1",
  "type": "switchx",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Relight & Switch",
    "provider": "beeble-switchx",
    "alphaMode": "auto",
    "prompt": "",
    "maxResolution": 1080,
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
