---
node_type: split-media
generated_at: 2026-10-12T21:28:42.227Z
generated_from: cd7cbea75
---

# Split Media

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `split-media`
**Category:** processing
**Credit cost:** `20` at list price — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's charged figure.
**Inputs (target handles):** `video`, `audio`
**Outputs (source handles):** `video`, `audio`

**Required data fields:**
- `label: string`
- `chunkDuration: number`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `currentJobProgress?: number`
- `minPartDuration?: number`
- `audioFormat?: "mp3" | "wav" | "aac"`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedVideoUrls?: string[]`
- `generatedAudioUrls?: string[]`
- `selectedAudioChunks?: number[]`
- `selectedVideoChunks?: number[]`
- `outputChunkIndex?: number`
- `generatedResults?: readonly GeneratedResult[]`
- `activeResultIndex?: number`
- `currentJobId?: string`

**Default data:**
```json
{
  "label": "Split into Chunks",
  "chunkDuration": 10,
  "minPartDuration": 4,
  "audioFormat": "mp3",
  "fieldMappings": {}
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

Cut a long video or audio file into consecutive parts so the next node runs once per part — transcribe, dub, caption or upscale a long recording piece by piece. Every part is at most `chunkDuration` seconds and at least `minPartDuration` (default 4, never above `chunkDuration`); a short leftover is evened out with the parts before it. Video is cut on whole frames (each part's sound ends at most ~21 ms before its picture, never after); audio-only parts are sample-exact in mp3/wav and on whole AAC frames in aac. Sources up to 3 hours. Wire a `video` input, an `audio` input, or both (each is split on its own; the `video` / `audio` outputs carry their parts). Outside a workflow, the `split_media` tool does the same in one call.

<!-- AUTO-GEN:START mcp-call -->
**MCP tool:** `split_media`

**Input parameters:**
- `video_url`
- `video_asset_id`
- `audio_url`
- `audio_asset_id`
- `chunk_duration`
- `min_part_duration`
- `audio_format`
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

- **Set `"outputMode": "each"` on the outgoing edge's `data` to fan out.** An edge from this node with no `outputMode` passes ONE part — the one `outputChunkIndex` names (0-based, the first by default) — not every part. The editor sets Each on a wire drawn by hand; workflow JSON written via `update_workflow_json` / the API must set it itself.
- `minPartDuration` above `chunkDuration` is rejected. At most 200 parts per input: a source that needs more, is shorter than the minimum, or cannot be cut into parts between the two lengths fails with a message naming the fix.
- One run of this node is priced the same whatever the number of parts; nodes after it on an Each edge are charged once per part they run for.

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "split-media-1",
  "type": "split-media",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Split into Chunks",
    "chunkDuration": 10,
    "minPartDuration": 4,
    "audioFormat": "mp3",
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
