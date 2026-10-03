---
node_type: transcribe
generated_at: 2026-09-27T12:51:23.645Z
generated_from: c607aa02c
---

# Transcribe

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `transcribe`
**Category:** ai
**Credit cost:** `22-40` at list price — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's charged figure.
**Inputs (target handles):** `audio`
**Outputs (source handles):** `json`, `text`

**Required data fields:**
- `label: string`
- `provider: TranscribeProvider`
- `language: string`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `diarize?: boolean`
- `tagAudioEvents?: boolean`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `currentJobProgress?: number`
- `errorMessage?: string`
- `generatedText?: string`
- `generatedResults?: Array<{ text: string; language: string; jobId: string; timestamp: string; transcript?: Transcript }>`
- `generatedJson?: Transcript`
- `activeResultIndex?: number`
- `wordTimestamps?: boolean`

**Default data:**
```json
{
  "label": "Transcribe",
  "provider": "elevenlabs-stt",
  "language": "auto",
  "fieldMappings": {}
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

Speech to text WITH timings (`transcribe` over MCP): the transcript of an audio or video file, plus a start/end for every word. It is the timing source for everything downstream that is word-timed — `add_captions` `captions[]`, `plan_edit`, `apply_edl` — and the way to get a clip's words before you correct them. A plain media URL works for audio and video alike; a YouTube / TikTok / Instagram / X page URL has its audio extracted first.

MCP arguments are snake_case (`audio_url`, `tag_audio_events`, `word_timestamps`); REST and the SDK spell the same fields camelCase (`audioUrl`, `tagAudioEvents`, `wordTimestamps`). The OUTPUT keys below are identical on every surface.

### Engines — which one gives word timings

Three engines are accepted, and the difference that matters is whether they time individual WORDS:

| Engine | Word timings | Notes |
|--------|--------------|-------|
| `elevenlabs-stt` (ElevenLabs Scribe) | **yes** | The canvas node's default and what the MCP `transcribe` tool ALWAYS runs. The only engine with `diarize` and `tag_audio_events`. |
| `incredibly-fast-whisper` | **yes** — ONLY when `wordTimestamps: true` is sent | Without the flag it returns phrase `segments` (in SECONDS) and `json.words: []`, and the job still succeeds and is charged. No diarization, no audio-event tags. |
| `whisper` | **no** | Text plus sentence `segments` (in SECONDS) and `json.words: []`, whatever is asked. The lane REST falls back to when `provider` is omitted — see the gotcha below. |

The flag means something different on each engine. `elevenlabs-stt` ALWAYS returns per-word timings: `word_timestamps` is kept for compatibility and changes nothing there. `incredibly-fast-whisper` returns them ONLY when `wordTimestamps: true` is sent — it is the flag that switches the model to word granularity, so omit it and you get phrase chunks and `words: []`. `whisper` NEVER returns them: asking it for `wordTimestamps: true` is a 400 before any credit is reserved, and the message names the engines that can answer.

In a workflow you do not set the flag yourself: a `transcribe` node whose `json` output is wired asks for word timings automatically whenever its engine can deliver them.

**A word-less transcript that feeds captions is refused before the workflow runs.** A `transcribe` node on `whisper` whose `json` output reaches an `add-captions` `transcript` input — directly or through an `apply-edl` in between — cannot produce the word timings the caption render exists to consume, so the run is refused before anything executes or bills, rather than at the caption node after the transcription has already been paid for. That covers a chain that sits inside a sub-workflow too, at any depth. The ONE case the check cannot see is a chain that CROSSES a sub-workflow boundary — `transcribe` on one side, `add-captions` on the other: that one is refused at the `add-captions` node, after the transcription has run. The fix is the node's own `provider`: pick `elevenlabs-stt` or `incredibly-fast-whisper`.

### Reading the result

Wait for the job, then read its output — `outputData` on `get_job` / `wait_for_job`, `output_data` on the REST job:

| Key | What it is | Unit |
|-----|------------|------|
| `text` | The whole transcript as one string | — |
| `language` | Detected (or requested) language code | — |
| `words` | Caption-shaped words `{ text, startMs, endMs, speaker? }` — omitted when no word was heard, and when the engine was not asked for word timings (see the engines table) | **ms** |
| `json` | The normalized Transcript `{ version, language, words[], segments? }` — always present, `json.words` carries the same words | **ms** |
| `segments` | Sentence segments `{ start, end, text }` — the two whisper lanes only; `elevenlabs-stt` emits none | **SECONDS** |

Which one to hand on:

- **`add_captions`** → `words` (or `json.words`) straight into `captions[]`, with `auto_transcribe: false`. Correct the `text` values first if the on-screen words must be exact.
- **`plan_edit` / `apply_edl`** → the whole `json` object as `transcript`. On the canvas that is the `json` output handle; the `text` handle carries the plain string.

<!-- AUTO-GEN:START mcp-call -->
**MCP tool:** `transcribe`

**Input parameters:**
- `audio_url`
- `audio_asset_id`
- `language`
- `diarize`
- `tag_audio_events`
- `word_timestamps`
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

- **Seconds vs ms.** `words` and everything inside `json` are integer MILLISECONDS. A top-level `segments` array, when there is one, is in SECONDS. Never mix the two clocks; for anything timed, read `json`.
- **REST: always send `provider`.** An OMITTED `provider` is NOT the same as the node's default — the route falls back to the legacy `whisper` lane (the id it has always reserved credits on), so the job succeeds with `text` and `segments` while `json.words` is `[]`: the "transcribe gave me no words" failure. Naming `whisper` explicitly does the same thing; the enum accepts it. Send `elevenlabs-stt`, or `incredibly-fast-whisper` WITH `wordTimestamps: true`, whenever anything downstream is word-timed — naming `incredibly-fast-whisper` alone is not enough, it returns word timings only when asked. The MCP tool and the canvas node already send the engine, so they are not affected.
- **`diarize` / `tag_audio_events` are `elevenlabs-stt` only.** Diarized words carry `speaker` (`speaker_0`, `speaker_1`, …). Audio-event tags such as `[laughter]` or `[music]` appear in `text` only — they are never entries in `words`, so a music-only clip legitimately returns `json.words: []`.
- **Speech-to-text mishears names.** Brand names, product names and unusual spellings come back wrong (or split in two). Correct the `text` of the affected entries and KEEP their `startMs` / `endMs` — the timing is right even when the spelling is not. Merging two entries into one word: keep the first `startMs` and the last `endMs`.
- **Word `text` carries its delimiter.** Every word after the first starts with ONE space (`"Nodaro"`, `" makes"`, `" videos"`). Keep it when you edit a word — it is what `transcribe` returns and what `add_captions` expects. A bare word still renders correctly: every kinetic style, `tiktok-words` included, canonicalises the delimiter before rendering.
- **`language`** is a short BCP-47 code (`en`, `es`, `he`, max 10 characters); omit it, or pass `auto`, to auto-detect.
- **`audio_asset_id` takes an audio OR a video job id / upload** — a video's speech is transcribed straight from the video, so to caption a generated clip pass that clip's job id (or its URL as `audio_url`). An image id is refused.

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "transcribe-1",
  "type": "transcribe",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Transcribe",
    "provider": "elevenlabs-stt",
    "language": "auto",
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
