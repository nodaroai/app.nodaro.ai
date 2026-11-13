# Transcribe
> Convert spoken audio to text with optional speaker diarization and audio event tagging, or translate it.

## Overview

The Transcribe node converts audio into a text transcript. Four engines are available, and the same four are accepted **everywhere** — the editor's picker, `POST /v1/transcribe`, the SDK, the CLI and the MCP `transcribe` tool: ElevenLabs Speech-to-Text (`elevenlabs-stt`, the node's default), Incredibly Fast Whisper (`incredibly-fast-whisper`), Whisper (`whisper`) and NVIDIA's Nemotron 3.5 Transcribe (`nemotron-3-5-transcribe`). They differ in one capability that matters downstream — **word timings**; see [Word timestamps: which engine can do it](#word-timestamps-which-engine-can-do-it). The node supports automatic language detection or explicit language selection, speaker diarization (identifying who said what), and audio event tagging (labeling non-speech sounds like music, laughter, or applause). On Nemotron 3.5 Transcribe it can also **translate** the speech instead of transcribing it — see [Translating](#translating-nemotron-35-transcribe).

The node has two output handles: a **`text`** handle carrying the plain transcript, and a **`json`** handle carrying a normalized **Transcript** object with word- and segment-level timings. The `json` handle is the structured form the caption and editing nodes consume; the `text` handle is unchanged from earlier versions, so existing wires keep working.

On a self-hosted install the chosen engine runs on your own key (`ELEVENLABS_API_KEY` for ElevenLabs STT, `REPLICATE_API_TOKEN` for the Whisper engines, `KIE_API_KEY` for Nemotron 3.5 Transcribe). With no key for the chosen engine and a connected nodaro.ai account, the transcription runs through the connection instead; with neither, the node fails with a message naming the key to add.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Provider | `TranscribeProvider` | `"elevenlabs-stt"` | Transcription engine — `elevenlabs-stt`, `incredibly-fast-whisper`, `whisper`, or `nemotron-3-5-transcribe`. `elevenlabs-stt` always returns **word timestamps**, `incredibly-fast-whisper` and `nemotron-3-5-transcribe` only when they are requested, `whisper` never — see [below](#word-timestamps-which-engine-can-do-it) |
| Language | `string` | `"auto"` | Language code for the audio, or "auto" for automatic detection. Supports 20+ languages. Not used by Nemotron 3.5 Transcribe, which always detects the spoken language itself (40 languages), so the panel shows no picker for it |
| Translate to | `string` | — (transcribe) | Nemotron 3.5 Transcribe only: translate the speech into this language instead of transcribing it — see [Translating](#translating-nemotron-35-transcribe). Saved as `targetLanguage` |
| Speaker Diarization | `boolean` | `false` | When enabled, identifies and labels different speakers in the transcript |
| Tag Audio Events | `boolean` | `false` | When enabled, annotates non-speech audio events (music, laughter, applause, etc.) in the transcript |

## Inputs & Outputs

- **Input**: `audio` -- audio file to transcribe. To transcribe a video from a link to where it is, connect a Video URL node: it asks for the content rights declaration and fetches the sound, and the node transcribes that track. A link to where a video is given to the node any other way stops a run in the editor, which says so.
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
| `nemotron-3-5-transcribe` | ✓ on request | Only when `wordTimestamps: true` is sent; each word then carries its `speaker` (`speaker_0`, `speaker_1`, …). Never with a translation (`targetLanguage`): the pair is a `400`, nothing charged |

`whisper` cannot produce word timings under any setting. Asking it for them used
to return an empty word list from a job that reported success; an explicit
request is now **refused** instead, and an *inferred* one is simply not made.

**Where the engines are selectable — everywhere:**

| Surface | How | Engines |
|---------|-----|---------|
| Canvas | The Transcribe node's **Provider** picker | all four |
| REST | `POST /v1/transcribe` → `provider` | all four |
| SDK | `client.audio.transcribe({ provider })` | all four |
| CLI | `nodaro audio transcribe --provider <engine>` | all four |
| MCP `transcribe` tool | `model` | all four (`elevenlabs-stt` when none is named) |
| Add Captions | `transcribe_provider` — on `POST /v1/add-captions`, in the MCP `add_captions` tool, the SDK/CLI, and in its node data | `elevenlabs-stt`, `incredibly-fast-whisper` (its default) and `whisper` — not Nemotron 3.5 Transcribe, whose per-minute price is not part of Add Captions' own. Transcribe on a Transcribe node and wire its `json` in instead. See [Add Captions](../processing-video/add-captions.md#the-auto-transcribe-engine-transcribe_provider) |

**Over `POST /v1/transcribe`,** `provider` accepts `elevenlabs-stt`,
`incredibly-fast-whisper`, `whisper` or `nemotron-3-5-transcribe`.

- An engine name outside that list is a `400 validation_error` on
  **`provider`**.
- `wordTimestamps: true` on `whisper` is a `400 validation_error` on
  **`wordTimestamps`**, naming the engines to set instead
  (`incredibly-fast-whisper`, `elevenlabs-stt` or `nemotron-3-5-transcribe`).
- `targetLanguage` on any engine but `nemotron-3-5-transcribe`, a language it
  does not translate into, or `targetLanguage` together with
  `wordTimestamps: true`, is a `400 validation_error` on **`targetLanguage`**.
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

- The MCP `transcribe` tool runs `elevenlabs-stt` unless its `model` names
  another engine, so with no `model` its result always carries
  `output_data.json.words`.
- A **Transcribe node** runs whatever `provider` its node data carries; a node
  with no `provider` at all runs `elevenlabs-stt` (the node default — *not* the
  REST route's legacy fallback).
- A run with the `json` handle connected asks for word timings automatically —
  but only when the node's engine can deliver them and the node is not set to
  translate. On `whisper` the request is simply not made: the run completes with
  a segments-only transcript whose `words` list is empty, exactly as it did
  before word timings existed. Pick `elevenlabs-stt` (the default),
  `incredibly-fast-whisper` or `nemotron-3-5-transcribe` when you need the
  word timings.
- If an engine that *should* deliver word timings returns none — or returns
  sentence-level timings where word-level was requested — for audio that clearly
  has speech, the job fails and refunds rather than handing back timings that
  cannot do what was asked. Audio with no speech at all still succeeds with no
  words, including an audio-event-only clip that transcribes as `[music]`.

### Translating (Nemotron 3.5 Transcribe)

With **Translate to** set (`targetLanguage` over REST, the SDK and the
workflow JSON; `target_language` in the MCP `transcribe` tool; `--target-language`
in the CLI), Nemotron 3.5 Transcribe translates the speech instead of
transcribing it. Translation goes to or from English: speech in another language
into English (`en`), or English speech into Chinese, Japanese, Korean, French,
German, Spanish, Portuguese, Italian, Russian, Dutch, Polish, Czech, Slovak,
Hindi, Bulgarian, Croatian, Danish, Estonian, Finnish, Hungarian, Latvian,
Lithuanian, Romanian, Slovenian, Swedish, Thai, Ukrainian, Arabic, Greek, Hebrew
or Maltese. Translating between two other languages may work but is not
guaranteed; for the best result, translate into English.

- The `text` output (and `text` in the job's output) is the translation, and
  `language` is the target language.
- A translation carries **no word timings**, so its `json` output has an empty
  `words` list. Asking for word timings together with a translation is refused
  before anything is charged, and a translating node whose `json` feeds Add
  Captions is [refused before the run](#a-whisper-transcript-wired-into-add-captions-is-refused-before-the-run).
- Only Nemotron 3.5 Transcribe translates: `targetLanguage` on another engine is
  refused before anything is charged. Switching the node's Provider away from
  Nemotron clears its Translate to choice.
- A translation costs the same as a transcript: see [Credits](#credits).

### Nemotron 3.5 Transcribe: the file it takes

Nemotron 3.5 Transcribe takes MP3, WAV, M4A/AAC, FLAC, OGG/Opus or WEBM audio,
or an MP4/MOV video with a sound track, **up to 60 minutes and 200 MB**, at a
direct **https** link to the file on a public host. Because it is priced by the
audio's length, the file is measured **before** anything is held — on a
single-node run and in a workflow run alike — and the run is then charged for
the length the model actually decoded (see [Credits](#credits)). Refused with
nothing charged: anything but an https link to a public host, a file over 60
minutes or 200 MB, and a link to a video's page on a social platform (bring
that video's sound in first through a Video URL node, or pick another engine).
A file whose length cannot be read up front (a browser recording saved as a
stream, a fragmented MP4) is not refused: the 60-minute price is held, and the
run is charged for the length the model decoded. It detects the spoken language
itself among 40 languages. With word
timings on, each word carries a speaker; voices that sound very different
separate well, similar ones may be merged into one speaker. When its output hit
the model's length limit for the audio — which usually means it repeats itself —
the job's output carries `truncated: true`: review or discard such a result.

### A Whisper transcript wired into Add Captions is refused before the run

[Add Captions](../processing-video/add-captions.md#transcript-input) reads the
**words** of a wired transcript, and rejects a transcript that has none. A
Transcribe node on `whisper` still runs and still bills — it just hands back
phrase segments with an empty `words` list — so a workflow that wires it into
Add Captions could only fail *after* the transcription had been paid for.

That workflow is now refused **before it runs**. When a Transcribe node on a
word-incapable engine (or one set to translate) has its `json` output wired into an Add Captions
`transcript` input — **directly, or through an [Apply EDL](../processing-video/apply-edl.md)
node** (which remaps the transcript and passes it on) — the run is refused
before anything executes or bills. That includes a chain that sits **inside a
sub-workflow**, at any depth: the nested graphs are checked before the parent
run starts. The error names the Transcribe node and says what to change:

```
Captions need word timings, but the "whisper" engine does not return word timings — pick incredibly-fast-whisper or elevenlabs-stt.
```

Switch that node's Provider to `elevenlabs-stt`, `incredibly-fast-whisper` or
`nemotron-3-5-transcribe` (or clear a Nemotron node's Translate to) and the run
proceeds. Notes:

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
   Use `elevenlabs-stt`, `incredibly-fast-whisper` or `nemotron-3-5-transcribe` for
   this — a `whisper` node, or a node set to translate, wired this way is
   [refused before the run](#a-whisper-transcript-wired-into-add-captions-is-refused-before-the-run).
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

Charged **per run, by engine** — a flat amount, not metered by audio length — except Nemotron 3.5 Transcribe, which is priced by the file's length:

| Engine | Credits | Word timings |
|--------|---------|--------------|
| `elevenlabs-stt` | **25**<!-- credits: elevenlabs-stt --> | ✓ always |
| `incredibly-fast-whisper` | **44**<!-- credits: incredibly-fast-whisper --> | ✓ when requested |
| `whisper` | **44**<!-- credits: whisper --> | ✗ phrase segments only |
| `nemotron-3-5-transcribe` | per started minute of the file, below | ✓ when requested |

**Nemotron 3.5 Transcribe** is priced per **started minute** of the audio, up to 60 minutes — the same with word timings or a translation. The minutes are added up and the whole run is rounded up to a whole credit once:

| File length | Credits |
|-------------|---------|
| 0:45 | **2**<!-- credits: nemotron-3-5-transcribe:1m --> |
| 1:01 | **3**<!-- credits: nemotron-3-5-transcribe:2m --> |
| 10:00 | **9**<!-- credits: nemotron-3-5-transcribe:10m --> |
| 30:00 | **26**<!-- credits: nemotron-3-5-transcribe:30m --> |
| 60:00 | **50**<!-- credits: nemotron-3-5-transcribe:60m --> |

**The charge follows the audio's actual length.** The file is measured before the run and the price of that length is held; when the run is done it is charged for the length the model actually decoded, which can differ from what a file's header declares (some MP3s misstate their length). A shorter decoded length costs less than the hold and the rest is released; a longer one costs more, and the difference is taken from your balance. A file whose length could not be read up front holds the 60-minute price and is charged the same way. Before a run, the price shown is the length the graph knows (an upload's length, for one); when no length is known yet it is the 60-minute price.

The exact figure for your account is always `GET /v1/credits/model-cost?model=<engine>` (MCP: `list_models`; for Nemotron, `nemotron-3-5-transcribe:<minutes>m`). Nothing is reserved for a request that is refused up front — `wordTimestamps: true` on `whisper` (`400`), a translation on any other engine than Nemotron or beside word timings (`400`), a Nemotron link that is not https to a public host, or a file that is too long or too large (`400`), or a workflow whose Whisper (or translating) transcript feeds Add Captions (refused before it runs; the one exception, a chain that crosses a sub-workflow boundary, is described [above](#a-whisper-transcript-wired-into-add-captions-is-refused-before-the-run)).

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
- For word-level timestamps, connect the `json` output — it already carries per-word timings on `elevenlabs-stt` (the node's default engine), `incredibly-fast-whisper` and `nemotron-3-5-transcribe` (unless it translates); on `whisper` the timings are segment-level only. The Forced Alignment node remains available for realigning an externally supplied transcript to audio.
