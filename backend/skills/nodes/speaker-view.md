---
node_type: speaker-view
generated_at: 2026-10-08T13:45:33.617Z
generated_from: dcbc55538
---

# Speaker View

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `speaker-view`
**Category:** processing
**Credit cost:** none declared — an input / parameter / trigger node runs no job; otherwise the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`).
**Inputs (target handles):** `edl`, `transcript`
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

**Not priced yet.** Speaker View has no credit price until a later release, so it cannot be run: every run that includes the node is refused before anything starts, with "Speaker View is not priced yet", and nothing is charged. The `Credit cost: none declared` line above does NOT mean the node is free or that it runs no job. Do not put it in a workflow you expect to finish; build the workflow up to Camera Switch, or leave the node in place and run the upstream nodes on their own.

<!-- AUTO-GEN:START mcp-call -->
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

- **Every run that includes the node is refused** with "Speaker View is not priced yet" until it is priced: a Run all, a published app, an MCP `run_workflow` and a run inside a sub-workflow all stop before any node executes. Run a partial selection that leaves the node out.
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
