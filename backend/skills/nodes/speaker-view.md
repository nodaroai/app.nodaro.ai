---
node_type: speaker-view
generated_at: 2026-10-14T00:02:33.923Z
generated_from: b83a9467d
---

# Speaker View

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `speaker-view`
**Category:** processing
**Credit cost:** `per-minute` charged on Nodaro Cloud — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's figure live.
**Inputs (target handles):** `edl`, `video`, `transcript`, `tracks`
**Outputs (source handles):** `video`, `json`, `transcript`

**Required data fields:**
- `label: string`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `currentJobProgress?: number`
- `quality?: "proxy" | "final"`
- `targetAspect?: "16:9" | "9:16" | "1:1" | "4:5"`
- `layout?: "auto" | "single" | "side-by-side" | "stacked" | "grid" | "pip"`
- `switchType?: string`
- `switchDurationMs?: number`
- `emphasisStyle?: string`
- `emphasisDurationMs?: number`
- `accentColor?: string`
- `speakerRegions?: Array<{ source: string; speaker: string; region: { x: number; y: number; w: number; h: number } }>`
- `defaultRegionKeys?: string[]`
- `motion?: "static" | "glide"`
- `requireFaces?: boolean`
- `edl?: unknown`
- `transcript?: unknown`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedVideoUrl?: string`
- `generatedJson?: unknown`
- `generatedTranscript?: unknown`
- `generatedResults?: readonly GeneratedResult[]`
- `activeResultIndex?: number`

**Default data:**
```json
{
  "label": "Speaker View",
  "quality": "final",
  "fieldMappings": {}
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

Turn an edit (Edit Plan's or Camera Switch's EDL) into a finished video that follows who is speaking: wire the EDL into `edl` and, for the speaker turns, a diarized transcript into `transcript`. Its `json` output is an EDL, never a transcript.

**Priced per output minute, in two tiers** (rounded up to the next minute). A preview (`quality: "proxy"`) is charged 2.2<!-- credits-rate: speaker-view:proxy --> credits a minute and a final 11<!-- credits-rate: speaker-view --> while every segment shows at most two speakers and nothing zooms; three to six speakers on screen on any segment, or any zoom, 3.3<!-- credits-rate: speaker-view:complex:proxy --> and 13.2<!-- credits-rate: speaker-view:complex -->; a run's total is rounded up to a whole credit. The ids are `speaker-view`, `speaker-view:proxy`, `speaker-view:complex` and `speaker-view:complex:proxy`; `GET /v1/credits/model-cost?model=<id>` gives each one's live rate. The credits are reserved on the edit's length when the render starts and charged on the rendered cut's minutes, never more than was reserved.

<!-- AUTO-GEN:START mcp-call -->
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

- **Side by side, Stacked and Picture-in-picture take two speakers.** Over three or more they are drawn as a Grid and priced in the second tier (3 / 12 a minute). An estimate made before the edit is known — or over an edit that names no speakers while its transcript is wired in — cannot count the speakers, so it quotes the second tier for every layout except Single.
- Per-speaker framing (`speakerRegions`) is written in the node's JSON only; the editor control for it arrives later.
- A layout the aspect or the speaker count rules out is snapped at run time (Side by side and Stacked swap, else Grid, else Single); a node written without a `targetAspect` is judged against the edit's own aspect, not 16:9.

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "speaker-view-1",
  "type": "speaker-view",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Speaker View",
    "quality": "final",
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
