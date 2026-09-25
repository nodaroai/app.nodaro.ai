---
node_type: audio-sync
generated_at: 2026-09-24T23:16:51.398Z
generated_from: 27e765525
---

# Audio Sync

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `audio-sync`
**Category:** processing
**Credit cost:** `10-50` per `GET /v1/nodes` — the live price is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`).
**Inputs (target handles):** `sources`
**Outputs (source handles):** `json`

**Required data fields:**
- `label: string`

**Optional data fields:**
- `reference?: string`
- `sourceOrder?: string[]`
- `fieldMappings?: Record<string, unknown>`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `currentJobId?: string`
- `currentJobProgress?: number`
- `generatedJson?: unknown`

**Default data:**
```json
{
  "label": "Audio Sync",
  "fieldMappings": {}
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

Several recordings of ONE conversation (a camera per guest, a wide shot, a master mic) that started at different moments: this node measures each one's clock offset against a reference, from the sound, so a multicam edit lines up without typed offsets. Keyless on every edition. The result (`json` handle, also `output_data.json`) is `{ version, reference, offsets: [{ sourceId, offsetMs, confidence, driftMsPerHour }], notes }` with `referenceMs = sourceMs + offsetMs` — with the master as the reference, each `offsetMs` is that source's `EdlSource.offsetMs`.

<!-- AUTO-GEN:START mcp-call -->
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

- Wire EVERY recording (audio or video producer) into the one `sources` target handle — 2 to 6 of them. Fewer or more refuses the run before any credits are reserved.
- A recording's id is its upstream NODE id: `offsets[].sourceId`, and `reference` when you set it, are node ids. A `reference` whose node is no longer wired falls back to the first source.
- `sourceOrder` (node ids) orders the recordings; the first one is the default reference.
- Low confidence and clock drift are reported in `notes`, never corrected. Priced 10 × (sources − 1) credits.

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "audio-sync-1",
  "type": "audio-sync",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Audio Sync",
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
