---
node_type: tighten-episode
generated_at: 2026-10-20T01:40:23.684Z
generated_from: 5334e3a6d
---

# Tighten Episode

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `tighten-episode`
**Category:** processing
**Credit cost:** `per-minute` charged on Nodaro Cloud — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's figure live.
**Inputs (target handles):** `media`, `music`, `masterAudio`
**Outputs (source handles):** `media`, `json`

**Required data fields:**
- `label: string`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `mediaOrder?: string[]`
- `cameras?: UseCaseCamerasInput`
- `output?: "video" | "audio"`
- `framing?: { aspect: "16:9" | "9:16" | "1:1" | "4:5"; layout: "auto" | "single" | "side-by-side" | "stacked" | "grid" | "pip" } | null`
- `framingSource?: "auto" | "static" | "tracking"`
- `captions?: boolean`
- `captionStyle?: CaptionStyle`
- `reviewBeforeRender?: boolean`
- `planTier?: "economy" | "standard" | "premium"`
- `instructions?: string`
- `styleGuide?: string`
- `musicDuckAmount?: number`
- `settingsBeforeAudio?: { output?: "video" | "audio"; captions?: boolean }`
- `useCaseJobId?: string`
- `useCaseExecutionId?: string`
- `useCaseContinue?: { mode: "from-failed" | "render-final"; jobId: string }`
- `generatedJson?: unknown`
- `editedEdl?: unknown`
- `generatedTranscript?: unknown`
- `generatedVideoUrl?: string`
- `generatedAudioUrl?: string`
- `generatedResults?: readonly GeneratedResult[]`
- `useCaseCameras?: UseCaseCamerasReport`
- `activeResultIndex?: number`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `currentJobProgress?: number`

**Default data:**
```json
{
  "label": "Tighten Episode",
  "output": "video",
  "captions": true,
  "captionStyle": "word-highlight",
  "reviewBeforeRender": false,
  "planTier": "standard",
  "framingSource": "auto",
  "instructions": "",
  "fieldMappings": {},
  "executionStatus": "idle"
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

Tighten one podcast or interview recording in a single node: it runs Transcribe (`elevenlabs-stt`, speakers labelled, word timings), Silence Detect, Edit Plan in Tighten mode and a render (Apply EDL, or Speaker View when `framing` is set), plus Add Captions (`captions`, video episodes) and a music bed (Mix Audio ducked under the voice, ending when the voice ends, then Merge Video & Audio on a video episode) when a track is wired into `music`. Wire the recording into `media` — one video or audio file, up to 3 hours, with sound; an audio recording always makes an audio episode (no captions, no framing). The episode comes out on `media` (video, or audio for an audio episode) and the edit plan (an EDL, review edits applied) on `json`.

Several cameras of one conversation are this node too: wire each camera into `media` (Recordings, 1–6 in order, `mediaOrder`) and the mixer track into `masterAudio` (Master audio), with `cameras` (`wide`, `synced`, `speakerCameras`); the run lines them up, works out who is on which camera (Speaker Map) and cuts to whoever is talking. Several recordings or a Master audio need Speaker Map, not yet enabled on nodaro.ai: until then a run reads the first recording only, and a direct request with several is refused `403 node_not_available`.

Reach for the individual nodes instead (Edit Plan → Camera Switch → Apply EDL / Speaker View) for a hand-edited EDL or switch, clips, chapters or a trailer.

**Priced as its steps at their own rates plus a per-run fee of 11 credits**<!-- credits: use-case-fee:tighten-episode --> (credit id `use-case-fee:tighten-episode`). The estimate prices the render at the recording's full length (unknown length: the 180-minute ceiling) and a framed render at Speaker View's complex rate; the charge follows the rendered minutes. A 60-minute video with the default settings (captions on, no music, no framing) is estimated at 1026<!-- credits: elevenlabs-stt + silence-detect + edit-plan:tighten:standard:per-minute@60 + apply-edl@60 + add-captions:kinetic + use-case-fee:tighten-episode -->: 25<!-- credits: elevenlabs-stt --> (Transcribe) + 11<!-- credits: silence-detect --> (Silence Detect) + 264<!-- credits: edit-plan:tighten:standard:per-minute@60 --> (Edit Plan, standard) + 660<!-- credits: apply-edl@60 --> (Apply EDL, final) + 55<!-- credits: add-captions:kinetic --> (Add Captions) + 11<!-- credits: use-case-fee:tighten-episode --> (fee). `POST /v1/tighten-episode/estimate` quotes a request before it runs.

<!-- AUTO-GEN:START mcp-call -->
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

- **`reviewBeforeRender: true` stops at a preview.** The render runs at its preview rate and captions / the music bed are NOT added; the run completes with the preview on `media` (`quality: "proxy"`). Finish it with Render final — `POST /v1/tighten-episode/continue` `{ jobId, mode: "render-final", editedEdl? }` on the run's wrapper job: no fee, the settings the preview was made with (never the node's later ones), the edit applied by its basis. A second Render final of the same preview with a CHANGED edit runs and is charged again (no fee); the same edit again is refused, and two at once never run.
- **Nobody to review → refused.** Inside a workflow or app run started from the API, an API token, MCP or a trigger (anything but the editor or an app's own page), a node with `reviewBeforeRender: true` is refused `409 preview_review_required`. Set it to `false` for unattended runs. A direct `POST /v1/tighten-episode` call reviews its own run and is accepted.
- **Continue after a failure** (`mode: "from-failed"`) runs only the steps the failed run did not complete, on that run's stored snapshot; the completed steps are handed on, never run or billed again, and the fee is held again (the failed run's was refunded). Answers to handle: `409 continuation_settling` (retry shortly), `409 continuation_superseded` / `409 already_running` (continue or wait on the `jobId` in the answer), `409 continuation_not_failed`.
- **A node fed by a List runs once per item, each with its own fee**, and has no Continue or Render final — run it again.
- **Self-hosted installs need the nodaro.ai connection.** Unconnected, the node is omitted from `GET /v1/nodes` and a run is refused `503 nodaro_connection_required` before any job or credit hold exists.
- **`framing`** is `{ aspect: "16:9" | "9:16" | "1:1" | "4:5", layout }` or `null`; a layout Speaker View does not draw at that aspect is snapped (as the render snaps it). Video episodes only — an audio recording drops it.
- **Idempotency.** Send an `Idempotency-Key` header: a retry answers the same `jobId` with `deduped: true` and starts nothing.

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "tighten-episode-1",
  "type": "tighten-episode",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Tighten Episode",
    "output": "video",
    "captions": true,
    "captionStyle": "word-highlight",
    "reviewBeforeRender": false,
    "planTier": "standard",
    "framingSource": "auto",
    "instructions": "",
    "fieldMappings": {},
    "executionStatus": "idle"
  }
}
```
<!-- AUTO-GEN:END examples -->
