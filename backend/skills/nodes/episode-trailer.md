---
node_type: episode-trailer
generated_at: 2026-10-17T22:16:42.454Z
generated_from: 085c48b9e
---

# Trailer

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `episode-trailer`
**Category:** processing
**Credit cost:** `per-minute` charged on Nodaro Cloud — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's figure live.
**Inputs (target handles):** `media`, `introCard`
**Outputs (source handles):** `media`, `json`

**Required data fields:**
- `label: string`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `formats?: Array<"9:16" | "1:1" | "4:5" | "16:9">`
- `reviewBeforeRender?: boolean`
- `planTier?: "economy" | "standard" | "premium"`
- `instructions?: string`
- `styleGuide?: string`
- `useCaseJobId?: string`
- `useCaseExecutionId?: string`
- `useCaseContinue?: { mode: "from-failed" | "render-final"; jobId: string }`
- `generatedJson?: unknown`
- `editedEdl?: unknown`
- `generatedTranscript?: unknown`
- `generatedVideoUrl?: string`
- `generatedResults?: readonly GeneratedResult[]`
- `activeResultIndex?: number`
- `failedFormats?: readonly string[]`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `currentJobProgress?: number`

**Default data:**
```json
{
  "label": "Trailer",
  "formats": [
    "9:16",
    "1:1",
    "4:5"
  ],
  "reviewBeforeRender": false,
  "planTier": "standard",
  "instructions": "",
  "fieldMappings": {},
  "executionStatus": "idle"
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

Cut a 20–40 second trailer of one podcast or interview recording and deliver it in each chosen social format, in a single node: it runs Transcribe (`elevenlabs-stt`, speakers labelled, word timings), Edit Plan in Trailer mode (the recording's strongest moments), Apply EDL, Combine Videos when an intro card is wired into `introCard` (the card first), and one Social Media Format per entry of `formats` (`"9:16"`, `"1:1"`, `"4:5"`, `"16:9"`; default the first three; every format padded, never cropped). Wire the recording into `media` — one video file with sound, up to 3 hours; an audio-only recording is refused. The trailers come out on `media` (a list, one per format in format order: an Each wire runs the next node once per format, a Last wire reads the first) and the edit (an EDL, review edits applied) on `json`.

Reach for the individual nodes instead (the Trailer + Formats template: Edit Plan in Trailer mode → Apply EDL → Social Media Format per format) for several cameras, a hand-edited EDL, or a step this node does not expose.

**Priced as its steps at their own rates plus a per-run fee of 11 credits**<!-- credits: use-case-fee:episode-trailer --> (credit id `use-case-fee:episode-trailer`). The estimate prices the render at 40 seconds (one minute of Apply EDL) and Combine Videos on 40 s plus the card's probed length; a reviewed Render final is quoted at the edited cut's real length, and the charge follows the rendered length. A 60-minute video with the default three formats is estimated at 399<!-- credits: elevenlabs-stt + edit-plan:trailer:standard:60m + apply-edl@1 + 3*social-media-format + use-case-fee:episode-trailer -->: 25<!-- credits: elevenlabs-stt --> (Transcribe) + 286<!-- credits: edit-plan:trailer:standard:60m --> (Edit Plan, standard) + 11<!-- credits: apply-edl@1 --> (Apply EDL, final) + 66<!-- credits: 3*social-media-format --> (three Social Media Formats) + 11<!-- credits: use-case-fee:episode-trailer --> (fee). `POST /v1/episode-trailer/estimate` quotes a request before it runs.

<!-- AUTO-GEN:START mcp-call -->
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

- **`reviewBeforeRender: true` stops at a preview.** The render runs at its preview rate and the intro card and the formats are NOT made; the run completes with the preview on `media` (`quality: "proxy"`, `formats: []`). Finish it with Render final — `POST /v1/episode-trailer/continue` `{ jobId, mode: "render-final", editedEdl? }` on the run's wrapper job: no fee, the settings the preview was made with, the edit applied by its basis; it renders at full quality, adds the card and makes every format. A second Render final with a CHANGED edit runs and is charged again (no fee); the same edit again is refused, and two at once never run.
- **Every format is tried.** A format that cannot be rendered is not charged and is named on `output_data.failedFormats` (the node says "Could not render: 1:1"); the run completes with the others and keeps its fee, so it has no Continue (`409 continuation_not_failed`). To get the missing format without a fee, render the run's `json` yourself (Apply EDL, then Combine Videos with the card first when one was used, then Social Media Format with `method: "pad"`); a new run with only that format charges every step and the fee again, and may cut a different trailer. A run with no format rendered fails and its fee is refunded.
- **Continue after a failure** (`mode: "from-failed"`) runs only the steps the failed run did not complete, on that run's stored snapshot; the completed steps are handed on, never run or billed again, and the fee is held again (the failed run's was refunded).
- **Not once per list item.** Fed by a List, the node is refused `use_case_list_driven` before any run starts ("Trailer takes one recording. Use a separate workflow run for each recording."), whatever `reviewBeforeRender` says — its own result is already a list.
- **Intro card: 15 seconds at most.** A longer card is refused `intro_card_too_long` and one that cannot be read as a video `intro_card_unreadable`, before anything is charged. Make it the recording's size and shape, or one of the two is letterboxed.
- **Nobody to review → refused.** Inside a workflow or app run started from the API, an API token, MCP's `run_workflow` or a trigger, a node with `reviewBeforeRender: true` is refused `preview_review_required`. Set it to `false` for unattended runs. A direct `POST /v1/episode-trailer` call (and MCP `make_trailer`) reviews its own run and is accepted.
- **Self-hosted installs need the nodaro.ai connection.** Unconnected, the node is omitted from `GET /v1/nodes` and a run is refused `503 nodaro_connection_required` before any job or credit hold exists.
- **Idempotency.** Send an `Idempotency-Key` header: a retry answers the same `jobId` with `deduped: true` and starts nothing.

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "episode-trailer-1",
  "type": "episode-trailer",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Trailer",
    "formats": [
      "9:16",
      "1:1",
      "4:5"
    ],
    "reviewBeforeRender": false,
    "planTier": "standard",
    "instructions": "",
    "fieldMappings": {},
    "executionStatus": "idle"
  }
}
```
<!-- AUTO-GEN:END examples -->
