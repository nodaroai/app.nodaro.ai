# Text to Dialogue
> Generate multi-speaker dialogue audio where each line is spoken by a different voice.

## Overview

The Text to Dialogue node voices a script as a single audio file containing multiple speakers, on one of two ElevenLabs dialogue models called through the direct ElevenLabs API — **ElevenLabs Dialogue v3** (the default) or **ElevenLabs Dialogue v4** — or on one of Google's four Gemini speech models, which voice one or two speakers (see [Gemini models](#gemini-models)). Each line of dialogue is assigned a voice, and the output is a cohesive conversational audio track. This is ideal for creating conversations, interviews, or any scenario requiring distinct speakers without manually generating and stitching individual TTS clips.

## Models

| Model | `provider` value | Stability | Similarity | Notes |
|-------|------------------|-----------|------------|-------|
| ElevenLabs Dialogue v3 | `elevenlabs-dialogue` (default) | Three steps: `0`, `0.5`, `1` | — | Expressive; supports `[audio tags]`. The model every node ran on before the model field existed |
| ElevenLabs Dialogue v4 | `elevenlabs-dialogue-v4` | Any value from `0` to `1` | `0`–`1` | Newest; supports `[audio tags]`, stability and similarity |
| Gemini 3.8 Flash-Lite | `gemini-3-8-flash-lite-tts` | — | — | The cheapest; two named voices, `<tone tags>`, a style per line, filler words |
| Gemini 3.8 Flash | `gemini-3-8-flash-tts` | — | — | The larger 3.8 model; the same voices, tags, line styles and filler words |
| Gemini 3.1 Flash | `gemini-3-1-flash-tts` | — | — | Two named voices, `[audio tags]`, each voice's style, pace, accent and audio profile |
| Gemini 2.5 Pro | `gemini-2-5-pro-tts` | — | — | The same voices and controls as 3.1 Flash, from the Pro model |

v3 stays the default everywhere: a new node, a request that omits `provider`, the `generate_dialogue` MCP tool and the SDK all run v3 dialogue unless you choose another model. The two ElevenLabs models offer the same 46 languages; on a Gemini model the language follows the text.

## Limits

| Limit | Dialogue v3 | Dialogue v4 | Gemini (each) |
|-------|-------------|-------------|---------------|
| Total text across all lines | 5,000 characters (≤2,000 recommended for best quality) | 10,000 characters (≤2,000 recommended for best quality) | 10,000 characters |
| Unique voices per generation | 10 (reusing a voice across lines does not count extra) | 10 | 2 |

Dialogue v4's cap is twice v3 dialogue's: a 10,000-character v4 dialogue was voiced whole in a live check on 2026-10-06, well inside the platform's time limit, and the cap was raised to that number. v3 dialogue stays at 5,000. A script over the chosen model's cap is refused before anything is charged; the editor's counter shows the cap of the model the node is set to.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Model | `select: elevenlabs-dialogue, elevenlabs-dialogue-v4, gemini-3-8-flash-lite-tts, gemini-3-8-flash-tts, gemini-3-1-flash-tts, gemini-2-5-pro-tts` | `elevenlabs-dialogue` | The dialogue model. Switching to v3 snaps a stability that is not one of its three steps to the nearest step and clears Similarity (v3 does not take it); switching to v4 keeps every value. Switching to or from a Gemini model moves each line's voice (see [Gemini models](#gemini-models)) |
| Dialogue Lines | `DialogueLine[]` | `[{ text: "", voice: "Sarah" }]` | Array of dialogue entries, each with text content and a voice selection. Add or remove lines as needed |
| Stability | `number` | `0.5` | Voice consistency across the dialogue. 0 = most expressive, 1 = most consistent. **Dialogue v3:** a dropdown of exactly `0`, `0.5`, `1` (the API refuses any other value for v3). **Dialogue v4:** a 0–1 slider, any value |
| Similarity | `number` 0–1 (Dialogue v4 only) | `0.75` | How closely each line keeps its voice's character. Shown only on Dialogue v4; v3 ignores it and the platform never sends it to v3 |
| Language | `string` | `""` (auto-detect) | Target language code, or empty for automatic detection. Uses the full language list (`ALL_LANGUAGES`) |
| Seed | `number` (optional) | random | Deterministic sampling (integer 0–4294967295). Same seed + same script + same settings reproduces the output |
| Text Normalization | `select: auto, on, off` | `auto` | Whether numbers, dates, and abbreviations are spelled out so they are spoken naturally |
| Speakers | `{ voice, styleDirection?, pace?, accent?, audioProfile? }[]` | none | Gemini 3.1 Flash and 2.5 Pro: each voice's speaking style (`Vocal Smile`, `Newscaster`, `Whisper`, `Empathetic`, `Promo/Hype`, `Deadpan`), pace (`Natural`, `Rapid Fire`, `The Drift`, `Staccato`), accent and audio profile (who is speaking, in words, up to 1,000 characters), keyed by the voice. Not spoken, not billed |
| Filler words | `boolean` | off | Gemini 3.8 Flash-Lite and 3.8 Flash, with exactly two voices: the model adds natural filler words between the speakers |
| File | `select: mp3_44100_128, mp3_44100_192, wav_24000` | `mp3_44100_128` | Gemini models: the audio file, at the same credits — MP3 at 128 or 192 kbps, encoded from the model's WAV, or that WAV as rendered (24 kHz, mono, 16-bit). The ElevenLabs dialogue models deliver the 128 kbps MP3 only, so the choice is not shown for them, and switching to one clears it |

### DialogueLine Fields

| Field | Type | Description |
|-------|------|-------------|
| id | `string` | Unique identifier for the line |
| text | `string` | The spoken text for this line |
| voice | `string` | Voice ID for this line's speaker |
| voiceLabel | `string` (optional) | Display name of the selected voice |
| styleDirection | `string` (optional) | Gemini 3.8 Flash-Lite and 3.8 Flash: how this line is spoken, in words, up to 1,000 characters ("tired, slow, barely awake"). Not spoken, not billed |

## Credits

> Length-based pricing is on at `app.nodaro.ai` and `next.app.nodaro.ai` (since 2026-10-08). A Cloud-edition install that leaves `SPEECH_LENGTH_PRICING_ENABLED` off instead charges a flat 28 credits<!-- credits: elevenlabs-dialogue --> per dialogue, whatever its length and whichever model runs it.

A dialogue is priced on the total characters across its lines as they are sent (on Gemini 3.8, after each line's tags are rewritten to its own or removed), in **units of 100 characters, every started unit counting, with a minimum of 8 units per request**: `credits = ceil(max(8, ceil(total characters / 100)) × credits per unit)` — the request's total rounded up to a whole credit. Each model prices on its own row:

| Model | Credit identifier | Credits per started 100 characters | Flat price (length pricing off) |
|-------|-------------------|------------------------------------|----------------------------------|
| ElevenLabs Dialogue v3 | `elevenlabs-dialogue` | 4.4<!-- credits-rate: elevenlabs-dialogue:per-100-chars --> | 28<!-- credits: elevenlabs-dialogue --> per request |
| ElevenLabs Dialogue v4 | `elevenlabs-dialogue-v4` | 4.4<!-- credits-rate: elevenlabs-dialogue-v4:per-100-chars --> | 28<!-- credits: elevenlabs-dialogue-v4 --> per request |

A Gemini model prices a dialogue at the same rate per character as one speaker on Text to Speech — its own row, quoted per 1,000 characters on the same count, so a request costs its started hundreds × the rate ÷ 10, rounded up to a whole credit. Line styles and speaker directions are not counted:

| Model | Credits per 1,000 characters | Minimum per request |
|-------|------------------------------|---------------------|
| Gemini 3.8 Flash-Lite | 4.4<!-- credits-rate: gemini-3-8-flash-lite-tts:per-1k-chars --> | 5<!-- credits: gemini-3-8-flash-lite-tts:per-100-chars:8u --> |
| Gemini 3.8 Flash | 6.6<!-- credits-rate: gemini-3-8-flash-tts:per-1k-chars --> | 6<!-- credits: gemini-3-8-flash-tts:per-100-chars:8u --> |
| Gemini 3.1 Flash | 14.3<!-- credits-rate: gemini-3-1-flash-tts:per-1k-chars --> | 13<!-- credits: gemini-3-1-flash-tts:per-100-chars:8u --> |
| Gemini 2.5 Pro | 17.6<!-- credits-rate: gemini-2-5-pro-tts:per-1k-chars --> | 15<!-- credits: gemini-2-5-pro-tts:per-100-chars:8u --> |

These rates are provisional: they are to be checked against real runs and may change. A 2,000-character two-voice script on Gemini 3.1 Flash → 20 started hundreds → **29 credits**<!-- credits: gemini-3-1-flash-tts:per-100-chars:20u -->.

Worked examples, on either ElevenLabs model: **100 characters** (any script up to 800) → **36 credits**<!-- credits: elevenlabs-dialogue:per-100-chars@8 -->; **1,000 characters** → **44 credits**<!-- credits: elevenlabs-dialogue:per-100-chars@10 -->; **5,000 characters** (Dialogue v3's cap) → **220 credits**<!-- credits: elevenlabs-dialogue:per-100-chars@50 -->; on Dialogue v4 only, **10,000 characters** (Dialogue v4's cap) → **440 credits**<!-- credits: elevenlabs-dialogue-v4:per-100-chars@100 -->. A script over the chosen model's cap is refused before anything is charged, on the API and in a workflow alike. The editor's estimate, a published app's advertised price and the credits reserved when the node runs all read the same rows.

The timings add nothing to the price. Both ElevenLabs models return their timings at the same character cost as the plain render (measured 2026-10-06), so every ElevenLabs dialogue run carries them and there is no switch to turn them off. A Gemini dialogue returns no timings.

## Gemini models

Google's Gemini speech models voice a dialogue of one or two speakers, beside the ElevenLabs dialogue models; ElevenLabs Dialogue v3 stays the default.

- **Two voices, each of the model's own.** A script uses one or two distinct voices, each from the model's own list (the same lists as on [Text to Speech](text-to-speech.md#gemini-models): 70 voices on 3.8, 30 on 3.1 Flash and 2.5 Pro). A third voice, or a voice not on the model's list, is refused with a 400 before anything is charged. In the panel each line picks from the model's list. Switching the node to a Gemini model keeps each voice the model speaks and moves every other one onto a voice of the model's that the script does not use yet (its default first), so two speakers stay two. Switching back to an ElevenLabs model clears each Gemini voice, and a run asks you to choose a voice for every line. The same move applies wherever the model is chosen apart from the voices: a published app's Model card, or a field mapping onto the model. On an ElevenLabs model a moved voice runs the deployment's default voice.
- **Direction.** On 3.8 Flash-Lite and 3.8 Flash each line can carry its own style in words, and with exactly two voices **Filler words** lets the model add natural "um"s and "you know"s between them. On 3.1 Flash and 2.5 Pro each voice takes a speaking style, a pace, an accent and an audio profile.
- **Tags.** On 3.8 each line's `[square]` tags are rewritten to its own `<angle>` tags or removed, as on Text to Speech; 3.1 Flash and 2.5 Pro take `[square]` tags as written. The 10,000-character total is measured after that rewrite.
- **No ElevenLabs settings.** Stability, Similarity, Language, Seed and Text Normalization are ElevenLabs' and are hidden on a Gemini model.
- **The file.** MP3 (the default, 128 or 192 kbps) or the WAV as rendered, as on Text to Speech, at the same credits.
- **A one-off clone (3.8 Flash).** One speaker (or both) can speak in a person's own voice, cloned for this request alone and not saved. A line names any label as its voice, and a `speakers` entry for that label carries `replica: { sourceAudioUrl, consentAudioUrl, consent: true }`: the two recordings and the caller's consent, with the same rules and checks as on [Text to Speech](text-to-speech.md#a-one-off-clone-of-your-own-voice-gemini-38-flash). No extra charge. A clone on any other model, 3.8 Flash-Lite included, is refused. In the editor, the panel's **Cloned voices** block adds a cloned speaker on 3.8 Flash: a label (which the lines then pick as their voice), its two uploads (ordinary uploads, kept in your library), and its own consent box, which must be ticked before the node runs. A deployment that withholds the Voice Clone node refuses them.
- **Voice limits by gender.** A deployment that limits voices by gender refuses the Gemini models whole for now, because their voices' genders are not recorded.

## API

`POST /v1/text-to-dialogue` takes the node's fields: `dialogue` (`[{ text, voice, styleDirection? }]`, in speaking order), optional `provider` (`elevenlabs-dialogue`, the default, `elevenlabs-dialogue-v4`, or a Gemini model), `stability`, `similarityBoost`, `languageCode`, `seed` and `applyTextNormalization`, and on a Gemini model `speakers`, `fillerWords` and `outputFormat` (`mp3_44100_128`, the default, `mp3_44100_192` or `wav_24000`). A field the chosen model does not take is not sent; an `outputFormat` other than the default on an ElevenLabs dialogue model is refused with a 400, as is a `speakers` list that is malformed or names one voice twice (on any model; before this release ElevenLabs dialogue dropped such fields silently). A `stability` Dialogue v3 does not take is refused with `Stability must be 0, 0.5, or 1`; a script over the chosen model's total cap is refused with the cap. The same choice is available as `model` on the `generate_dialogue` MCP tool, `provider` on the SDK's `voices.textToDialogue` and `--model` on `nodaro voice dialogue`.

## Inputs & Outputs

- **Input**: `in` -- optional upstream connection (not typically used; dialogue is configured directly in the panel)
- **Output**: `audio` -- single audio file containing all dialogue lines spoken in sequence (URL)
- **Output**: `json` -- the dialogue's timings as a Transcript: one `segments[]` entry per line (`startMs`, `endMs`, `text`, `speaker` = that line's voice) and `words[]` with per-word `startMs` / `endMs` / `speaker`. Filled on both Dialogue v3 and Dialogue v4 — every dialogue run returns its timings. Over the API the same Transcript is `output_data.transcript` on the finished job. It connects to Transcript inputs and is refused at an `edl` input (an edit list) such as Apply EDL's or Camera Switch's.

## Best Practices

- Assign distinct voices to each speaker to make the conversation easy to follow. Use the Voice Browser to preview voices before assigning them.
- Keep individual lines at a natural conversational length -- avoid putting entire paragraphs into a single dialogue entry.
- Use Stability at 0.5 for natural-sounding conversation. Lower it for more dramatic or emotional dialogue, raise it for formal or narration-like delivery. On Dialogue v4 you can pick any value in between.
- The total limit (5,000 characters on Dialogue v3, 10,000 on Dialogue v4) applies across all lines combined. Plan longer dialogues by splitting them across multiple Text to Dialogue nodes if needed.

### Captions without a second transcription

Wire the node's `json` output into [Add Captions](../processing-video/add-captions.md)' `Transcript` input. Add Captions then reads the dialogue's own words and skips its transcription step — and its charge for it — so the captions are timed by the model that spoke the lines, with each line's voice as the speaker. A `json` with nothing in it (Dialogue v3) leaves Add Captions transcribing the track as before. `[audio tags]` in the lines (including multi-word ones such as `[clears throat]`) are never turned into caption words.

Worked example: a two-voice, 1,200-character dialogue run costs 53 credits<!-- credits: elevenlabs-dialogue:per-100-chars@12 --> on either model, and the Add Captions node downstream spends nothing on transcription — it reads the dialogue's own `json`.

## Common Use Cases

- Creating podcast-style conversations between two or more speakers
- Generating interview audio with distinct host and guest voices
- Producing dialogue tracks for animated videos or explainers
- Building conversational demos or audio prototypes
- Creating audiobook dialogue scenes with character voices

## Tips

- Each dialogue line can use ANY voice — premade names, Voice Library voices, and your own clones all work, in any mix. There is no curated dialogue-only voice subset.
- Line text supports `[audio tags]` like `[laughs]`, `[whispers]`, `[sighs]` for emotion and pacing on both models, same as ElevenLabs v3 and v4 Text to Speech.
- The output is a single continuous audio file, not separate clips per line — the `json` output tells you where each line starts and ends. If you need individual clips, use separate Text to Speech nodes instead.
- Language auto-detection works well for monolingual dialogues. For multilingual conversations, explicitly set the language to the primary language being used.
- Stability is a three-step dropdown on Dialogue v3 and a 0–1 slider on Dialogue v4; Similarity appears only on Dialogue v4. Its effect on v4 dialogue is documented by the provider; the platform forwards it as given.
