# Transcribe
> Convert spoken audio to text with optional speaker diarization and audio event tagging.

## Overview

The Transcribe node converts audio into a text transcript. Three engines are available, and the same three are accepted **everywhere** — the editor's picker, `POST /v1/transcribe`, the SDK and the CLI: ElevenLabs Speech-to-Text (`elevenlabs-stt`, the node's default), Incredibly Fast Whisper (`incredibly-fast-whisper`) and Whisper (`whisper`). They differ in one capability that matters downstream — **word timings**; see [Word timestamps: which engine can do it](#word-timestamps-which-engine-can-do-it). The node supports automatic language detection or explicit language selection, speaker diarization (identifying who said what), and audio event tagging (labeling non-speech sounds like music, laughter, or applause).

The node has two output handles: a **`text`** handle carrying the plain transcript, and a **`json`** handle carrying a normalized **Transcript** object with word- and segment-level timings. The `json` handle is the structured form the caption and editing nodes consume; the `text` handle is unchanged from earlier versions, so existing wires keep working.

On a self-hosted install the chosen engine runs on your own key (`ELEVENLABS_API_KEY` for ElevenLabs STT, `REPLICATE_API_TOKEN` for the Whisper engines). With no key for the chosen engine and a connected nodaro.ai account, the transcription runs through the connection instead; with neither, the node fails with a message naming the key to add.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Provider | `TranscribeProvider` | `"elevenlabs-stt"` | Transcription engine — `elevenlabs-stt`, `incredibly-fast-whisper`, or `whisper`. `elevenlabs-stt` always returns **word timestamps**, `incredibly-fast-whisper` only when they are requested, `whisper` never — see [below](#word-timestamps-which-engine-can-do-it) |
| Language | `string` | `"auto"` | Language code for the audio, or "auto" for automatic detection. Supports 20+ languages |
| Speaker Diarization | `boolean` | `false` | When enabled, identifies and labels different speakers in the transcript |
| Tag Audio Events | `boolean` | `false` | When enabled, annotates non-speech audio events (music, laughter, applause, etc.) in the transcript |

## Inputs & Outputs

- **Input**: `audio` -- audio file to transcribe
- **Output**: `text` -- full transcript text string
- **Output**: `json` -- a normalized `Transcript` object (word/segment timings)

### The `json` output: `Transcript`

The `json` handle emits a `Transcript` — the shared, versioned shape the caption and editing nodes read:

```ts
Transcript {
  version: 1
  sourceId?: string        // set when the transcript is bound to an editing source
  language?: string
  words: Array<{
    text: string
    startMs: number        // milliseconds
    endMs: number          // milliseconds
    speaker?: string       // present on diarized runs
    confidence?: number
  }>
  segments?: Array<{
    startMs: number
    endMs: number
    text: string
    speaker?: string
  }>
}
```

All timings are integer **milliseconds**. `words` is populated whenever word-level timing is available — always for the default ElevenLabs engine (it is word-level), and for `incredibly-fast-whisper` when the `json` handle is connected (the node then requests word timestamps automatically). `segments` carries the coarser sentence/chunk breakdown when the engine provides one.

### Word timestamps: which engine can do it

| Engine | Word timings | Notes |
|--------|--------------|-------|
| `elevenlabs-stt` (default) | ✓ always | Word-level by design — the `wordTimestamps` flag changes nothing |
| `incredibly-fast-whisper` | ✓ on request | Only when `wordTimestamps: true` is sent — that switches the model to word-granularity timestamps. Without it the job still succeeds, with phrase chunks and an empty `words` list |
| `whisper` | ✗ | Phrase segments only — `openai/whisper` has no word-timestamps input at all. `wordTimestamps: true` on this engine is a `400`, nothing charged |

`whisper` cannot produce word timings under any setting. Asking it for them used
to return an empty word list from a job that reported success; an explicit
request is now **refused** instead, and an *inferred* one is simply not made.

**Where the engines are selectable — everywhere:**

| Surface | How | Engines |
|---------|-----|---------|
| Canvas | The Transcribe node's **Provider** picker | all three |
| REST | `POST /v1/transcribe` → `provider` | all three |
| SDK | `client.audio.transcribe({ provider })` | all three |
| CLI | `nodaro audio transcribe --provider <engine>` | all three |
| Add Captions | `transcribe_provider` — on `POST /v1/add-captions`, in the MCP `add_captions` tool, the SDK/CLI, and in its node data | all three (`incredibly-fast-whisper` is its default). See [Add Captions](../processing-video/add-captions.md#the-auto-transcribe-engine-transcribe_provider) |
| MCP `transcribe` tool | — (no engine argument) | always `elevenlabs-stt` |

**Over `POST /v1/transcribe`,** `provider` accepts `elevenlabs-stt`,
`incredibly-fast-whisper` or `whisper`.

- An engine name outside that list is a `400 validation_error` on
  **`provider`**.
- `wordTimestamps: true` on `whisper` is a `400 validation_error` on
  **`wordTimestamps`**, naming the engines to set instead
  (`elevenlabs-stt` or `incredibly-fast-whisper`).
- `incredibly-fast-whisper` returns word timings **only** when
  `wordTimestamps: true` is sent. Naming the engine alone is not enough: without
  the flag the job succeeds and is charged, and returns phrase `segments` with
  `json.words: []`.
- **Omitting `provider`** still falls back to the legacy `whisper` lane — kept
  so an existing caller keeps running (and paying for) the engine it always
  did. So `wordTimestamps: true` with no `provider` earns the same `400`; pass
  `provider: "elevenlabs-stt"` and the same call succeeds. Name the engine
  explicitly whenever you need word timings, `diarize` or `tagAudioEvents`.
- Either rejection lands before the job is created, so nothing is charged. The
  engine is never silently swapped — that would change what you pay for without
  asking.

**What happens on a run:**

- The MCP `transcribe` tool always runs `elevenlabs-stt`, so its result always
  carries `output_data.json.words`.
- A **Transcribe node** runs whatever `provider` its node data carries; a node
  with no `provider` at all runs `elevenlabs-stt` (the node default — *not* the
  REST route's legacy fallback).
- A run with the `json` handle connected asks for word timings automatically —
  but only when the node's engine can deliver them. On `whisper` the request is
  simply not made: the run completes with a segments-only transcript whose
  `words` list is empty, exactly as it did before word timings existed. Pick
  `elevenlabs-stt` (the default) or `incredibly-fast-whisper` when you need the
  word timings.
- If an engine that *should* deliver word timings returns none — or returns
  sentence-level timings where word-level was requested — for audio that clearly
  has speech, the job fails and refunds rather than handing back timings that
  cannot do what was asked. Audio with no speech at all still succeeds with no
  words, including an audio-event-only clip that transcribes as `[music]`.

### A Whisper transcript wired into Add Captions is refused before the run

[Add Captions](../processing-video/add-captions.md#transcript-input) reads the
**words** of a wired transcript, and rejects a transcript that has none. A
Transcribe node on `whisper` still runs and still bills — it just hands back
phrase segments with an empty `words` list — so a workflow that wires it into
Add Captions could only fail *after* the transcription had been paid for.

That workflow is now refused **before it runs**. When a Transcribe node on a
word-incapable engine has its `json` output wired into an Add Captions
`transcript` input — **directly, or through an [Apply EDL](../processing-video/apply-edl.md)
node** (which remaps the transcript and passes it on) — the run is refused
before anything executes or bills. That includes a chain that sits **inside a
sub-workflow**, at any depth: the nested graphs are checked before the parent
run starts. The error names the Transcribe node and says what to change:

```
Captions need word timings, but the "whisper" engine does not return word timings — pick incredibly-fast-whisper or elevenlabs-stt.
```

Switch that node's Provider to `elevenlabs-stt` or `incredibly-fast-whisper` and
the run proceeds. Notes:

- The check is on the **graph**, and it runs both in the editor and on the
  server, so it covers a run started from the canvas as well as one started
  through the API or MCP. The Transcribe node's config panel shows the same
  message next to the Provider picker as soon as the wire exists, so you can fix
  it before pressing Run.
- It looks only at the nodes the run will actually execute: running the
  Transcribe node on its own is never blocked.
- It applies whatever the Add Captions style is — a wired transcript must carry
  words even for `subtitle`. (Add Captions' *own* auto-transcription is
  different: there a `subtitle` is happy with Whisper's phrase timing. See
  [the auto-transcribe engine](../processing-video/add-captions.md#the-auto-transcribe-engine-transcribe_provider).)
- Skipped nodes are ignored, on both ends of the wire.
- A Whisper node whose `json` output goes anywhere else is untouched, and so is
  its `text` output: only the transcript → captions chain needs words.
- The **one** case the check cannot see is a chain that **crosses a sub-workflow
  boundary** — the Transcribe node on one side, Add Captions on the other. That
  run is refused at the Add Captions node ("transcript has no words"), **after**
  the transcription has run and been billed.

### Composing into burned-in captions

The node feeds Add Captions two ways:

1. **Wire the `json` handle into Add Captions.** The node requests word timings
   automatically, and Add Captions renders them as word-aligned kinetic captions.
   Use `elevenlabs-stt` or `incredibly-fast-whisper` for this — a `whisper` node
   wired this way is [refused before the run](#a-whisper-transcript-wired-into-add-captions-is-refused-before-the-run).
2. **Pass the words through the API.** A finished transcribe job's
   `output_data.words` is already the caption shape (`text`, `startMs`, `endMs`)
   — hand it straight to `POST /v1/add-captions` as `captions[]`:

   ```
   POST /v1/transcribe   { audioUrl, provider: "elevenlabs-stt", wordTimestamps: true }
     → poll GET /v1/jobs/:id → output_data.words
   POST /v1/add-captions { videoUrl, style: "word-highlight", captions: <those words> }
   ```

   Supplying `captions[]` also means Add Captions runs no transcription of its
   own, so nothing is transcribed (or billed) twice.

### Text output details

The `text` handle and `{Label}` references resolve the plain transcript, exactly as before:

| Field | Type | Description |
|-------|------|-------------|
| generatedText | `string` | The full transcript as plain text |
| generatedResults | `array` | Array of result objects, each containing `text`, `language`, `jobId`, `timestamp`, and the per-result `transcript` |

When Speaker Diarization is enabled, the transcript includes speaker labels (e.g., "Speaker 1:", "Speaker 2:") before each segment, and each word in the `Transcript` carries its `speaker`.

When Tag Audio Events is enabled, non-speech sounds are annotated inline (e.g., "[music]", "[laughter]").
## Credits

Charged **per run, by engine** — a flat amount, not metered by audio length:

| Engine | Credits | Word timings |
|--------|---------|--------------|
| `elevenlabs-stt` | **25**<!-- credits: elevenlabs-stt --> | ✓ always |
| `incredibly-fast-whisper` | **44**<!-- credits: incredibly-fast-whisper --> | ✓ when requested |
| `whisper` | **44**<!-- credits: whisper --> | ✗ phrase segments only |

The exact figure for your account is always `GET /v1/credits/model-cost?model=<engine>` (MCP: `list_models`). Nothing is reserved for a request that is refused up front — `wordTimestamps: true` on `whisper` (`400`), or a workflow whose Whisper transcript feeds Add Captions (refused before it runs; the one exception, a chain that crosses a sub-workflow boundary, is described [above](#a-whisper-transcript-wired-into-add-captions-is-refused-before-the-run)).

## Best Practices

- Use auto-detect for language unless you know the audio is in a specific language. Explicit language selection can improve accuracy for languages that sound similar.
- Enable Speaker Diarization when the audio contains multiple speakers (interviews, meetings, podcasts) to get labeled segments.
- Enable Tag Audio Events when the audio context matters (e.g., transcribing a video where background sounds are relevant to understanding).
- For best accuracy, use clean audio. Consider running the Voice Extractor node upstream if the source has significant background noise.
- Shorter audio segments transcribe more reliably. For very long audio, consider splitting into segments first.

## Common Use Cases

- Transcribing interview or podcast audio for written content
- Generating subtitles and captions from video audio tracks
- Converting voice memos or meeting recordings to text
- Creating searchable text archives from audio libraries
- Feeding transcripts into downstream AI nodes for summarization or analysis

## Tips

- The `text` output connects to any text-consuming node. Common downstream connections include Generate Text (for summarization), Combine Text (for assembly), and Add Captions (for subtitle generation).
- The `json` output connects to nodes that read a structured `Transcript` — for example Add Captions (for word-aligned subtitles) and the editing nodes. Because it carries per-word timings, it does not need a separate alignment pass.
- Speaker diarization and audio event tagging are independent options -- you can enable one, both, or neither.
- The transcription is processed asynchronously via the backend worker queue. Progress is shown in the node during execution.
- Language auto-detection works across the full set of supported languages. The explicit language dropdown provides 20+ language options matching the ElevenLabs STT model's capabilities.
- For word-level timestamps, connect the `json` output — it already carries per-word timings on `elevenlabs-stt` (the node's default engine) and on `incredibly-fast-whisper`; on `whisper` the timings are segment-level only. The Forced Alignment node remains available for realigning an externally supplied transcript to audio.
