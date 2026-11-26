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

Use to turn a video into a structured breakdown — `meta`, the clip's `look`, castable entity `slots[]`, and `scenes[]` with their shots, camera and audio — to recreate a clip shot by shot, re-shoot it with your own characters, objects and locations, or feed prompt-ready descriptions to generation nodes.

The `json` and `text` outputs carry the same breakdown; `text` is that JSON as a string, for text inputs. extract-field and json-process read `generatedJson` directly. To block the clip out in 3D, wire either output into generate-3d-scene's `prompt` input.

<!-- AUTO-GEN:START mcp-call -->
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

The price is set by the video's length and the tier, not by tokens; the model-cost lookup named in the Credit cost line quotes the run.

The breakdown is long: a clip of a few seconds already yields thousands of characters. generate-3d-scene's brief holds at most 8,000, so for a longer clip wire the video itself into generate-3d-scene's `references`: the scene runs its own analysis and reads it in full.

The `text` output is the JSON breakdown, not prose. A consumer that wants prose should take it through an LLM node first.

Needs a video: an upload, a generated video, or a link wired into `video`.

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
