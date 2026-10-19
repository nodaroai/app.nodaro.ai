---
node_type: clip-pack
generated_at: 2026-10-18T10:07:00.744Z
generated_from: 79c6cdc25
---

# Clip Pack

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `clip-pack`
**Category:** processing
**Credit cost:** `per-minute` charged on Nodaro Cloud — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's figure live.
**Inputs (target handles):** `media`
**Outputs (source handles):** `clips`, `json`

**Required data fields:**
- `label: string`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `count?: number`
- `targetDurationSec?: number`
- `framing?: { aspect: "16:9" | "9:16" | "1:1" | "4:5"; layout: "auto" | "single" | "side-by-side" | "stacked" | "grid" | "pip"; switchType?: string; emphasisStyle?: string } | null`
- `captions?: boolean`
- `captionStyle?: CaptionStyle`
- `reviewBeforeRender?: boolean`
- `planTier?: "economy" | "standard" | "premium"`
- `instructions?: string`
- `styleGuide?: string`
- `settingsBeforeAudio?: { framing?: ClipPackData["framing"]; captions?: boolean }`
- `useCaseJobId?: string`
- `useCaseExecutionId?: string`
- `useCaseContinue?: { mode: "from-failed" | "render-final"; jobId: string }`
- `generatedJson?: unknown`
- `editedEdl?: unknown`
- `generatedTranscript?: unknown`
- `generatedVideoUrl?: string`
- `generatedAudioUrl?: string`
- `generatedResults?: readonly GeneratedResult[]`
- `activeResultIndex?: number`
- `failedClips?: number`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `currentJobProgress?: number`

**Default data:**
```json
{
  "label": "Clip Pack",
  "count": 8,
  "targetDurationSec": 60,
  "framing": {
    "aspect": "9:16",
    "layout": "stacked",
    "switchType": "pan",
    "emphasisStyle": "scale"
  },
  "captions": true,
  "captionStyle": "karaoke",
  "reviewBeforeRender": false,
  "planTier": "standard",
  "instructions": "",
  "fieldMappings": {},
  "executionStatus": "idle"
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

Cut one podcast or interview recording into a pack of short clips in a single node: it runs Transcribe (`elevenlabs-stt`, speakers labelled, word timings), Edit Plan in Clips mode (up to `count` clips of about `targetDurationSec` seconds, each with a title and a hook), then once per clip a render (Speaker View on automatic boxes when `framing` is set — the default — or Apply EDL at the recording's shape when it is `null`) and Add Captions (`captions`, each clip on its own transcription). Wire the recording into `media` — one video or audio file, up to 3 hours, with sound; an audio recording makes audio clips (no framing, no captions). The clips come out on `clips` (a list: an Each wire runs the next node once per clip, a Last wire reads the first) and the plan's clip set (one EDL per kept clip, review edits applied) on `json`.

Reach for the individual nodes instead (the Clip Pack template: Edit Plan in Clips mode → Apply EDL → Add Captions) when you need a hand-edited plan, several cameras, or a step this node does not expose.

**Priced as its steps at their own rates plus a per-run fee of 11 credits**<!-- credits: use-case-fee:clip-pack --> (credit id `use-case-fee:clip-pack`). The estimate prices each clip at twice `targetDurationSec` and a framed render at Speaker View's complex rate; the charge follows each clip's real length and tier, and a clip that was not rendered is not charged. A 60-minute video with the default settings (8 clips of 60 s, 9:16 stacked, captions on) is estimated at 978<!-- credits: elevenlabs-stt + edit-plan:clips:standard:60m + 8*speaker-view:complex@2 + 8*add-captions:kinetic + use-case-fee:clip-pack -->: 25<!-- credits: elevenlabs-stt --> (Transcribe) + 286<!-- credits: edit-plan:clips:standard:60m --> (Edit Plan, standard) + 216<!-- credits: 8*speaker-view:complex@2 --> (8 Speaker View renders at 2 minutes each) + 440<!-- credits: 8*add-captions:kinetic --> (8 Add Captions) + 11<!-- credits: use-case-fee:clip-pack --> (fee). `POST /v1/clip-pack/estimate` quotes a request before it runs.

<!-- AUTO-GEN:START mcp-call -->
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

- **`reviewBeforeRender: true` stops at per-clip previews.** Each clip renders at its preview rate and captions are NOT added; the run completes with the previews (`quality: "proxy"`). Finish it with Render final — `POST /v1/clip-pack/continue` `{ jobId, mode: "render-final", editedEdl? }` on the run's wrapper job, where `editedEdl` is `{ v: 1, kind: "clips", basis, clips: [{ keep, hook? }] }`: only the kept clips render at Final and are captioned, no fee, with the settings the previews were made with. An `editedEdl` that drops every clip is refused `409 use_case_nothing_kept` before anything is held — keep at least one clip. A second Render final with a CHANGED edit runs and is charged again (no fee); the same edit again is refused.
- **Every clip is tried.** A clip that cannot be rendered is skipped and not charged (`output_data.failedClips` counts them); the run completes with the others and keeps its fee. A clip whose captions could not be added comes uncaptioned (`captionsFailed: true` on its row, counted in `output_data.failedCaptions`; not charged). With no clip rendered the run fails ("None of the 8 clips could be rendered: …") and its fee is refunded; a plan with no clips fails with "The plan found no clips in this recording." and its fee is refunded.
- **Continue after a failure** (`mode: "from-failed"`) runs only the steps the failed run did not complete; a run that stopped before its captions captions the clips it already rendered, without rendering them again. The fee is held again (the failed run's was refunded). A completed run (some clips kept) has no Continue (`409 continuation_not_failed`): run it again.
- **Not once per list item.** Fed by a List, the node is refused `use_case_list_driven` before any run starts ("Clip Pack takes one recording. Use a separate workflow run for each recording."), whatever `reviewBeforeRender` says.
- **Nobody to review → refused.** Inside a workflow or app run started from the API, an API token, MCP's `run_workflow` or a trigger, a node with `reviewBeforeRender: true` is refused `preview_review_required`. Set it to `false` for unattended runs. A direct `POST /v1/clip-pack` call (and MCP `make_clip_pack`) reviews its own run and is accepted.
- **Self-hosted installs need the nodaro.ai connection.** Unconnected, the node is omitted from `GET /v1/nodes` and a run is refused `503 nodaro_connection_required` before any job or credit hold exists.
- **`framing`** is `{ aspect: "16:9" | "9:16" | "1:1" | "4:5", layout, switchType?, emphasisStyle? }` or `null`; left out it is 9:16, `stacked`, `pan`, `scale`, and a route body without `layout` is `stacked`. A layout Speaker View does not draw at that aspect is snapped. Every clip is boxed alike over the episode's speakers (2–6 of them, on one camera; otherwise the clips are full frame). Video recordings only — an audio recording drops it.
- **Idempotency.** Send an `Idempotency-Key` header: a retry answers the same `jobId` with `deduped: true` and starts nothing.

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "clip-pack-1",
  "type": "clip-pack",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Clip Pack",
    "count": 8,
    "targetDurationSec": 60,
    "framing": {
      "aspect": "9:16",
      "layout": "stacked",
      "switchType": "pan",
      "emphasisStyle": "scale"
    },
    "captions": true,
    "captionStyle": "karaoke",
    "reviewBeforeRender": false,
    "planTier": "standard",
    "instructions": "",
    "fieldMappings": {},
    "executionStatus": "idle"
  }
}
```
<!-- AUTO-GEN:END examples -->
