---
node_type: video-analysis
generated_at: 2026-11-13T09:58:02.667Z
generated_from: b46bdac042
---

# Video Analysis

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `video-analysis`
**Category:** processing
**Credit cost:** `200-2307` charged on Nodaro Cloud — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's figure live.
**Inputs (target handles):** `video`
**Outputs (source handles):** `json`, `text`

**Required data fields:**
- `label: string`

**Optional data fields:**
- `promptPrefix?: string`
- `promptSuffix?: string`
- `videoUrl?: string`
- `youtubeUrl?: string`
- `probedYoutube?: { url: string; durationSec: number }`
- `probedVideo?: ProbedVideoInfo`
- `llmModel?: string`
- `reasoningEffort?: LlmReasoningEffort`
- `advancedMode?: boolean`
- `temperature?: number`
- `maxTokens?: number`
- `selectionMode?: "choose" | "combine"`
- `variations?: boolean`
- `translateSpeechToEnglish?: boolean`
- `translateOnScreenTextToEnglish?: boolean`
- `analysisFocus?: string`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `currentJobId?: string`
- `currentJobProgress?: number`
- `generatedJson?: VideoAnalysisResult`

**Default data:**
```json
{
  "label": "Video Analysis",
  "analysisFocus": "",
  "executionStatus": "idle"
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
  "id": "video-analysis-1",
  "type": "video-analysis",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Video Analysis",
    "analysisFocus": "",
    "executionStatus": "idle"
  }
}
```
<!-- AUTO-GEN:END examples -->
