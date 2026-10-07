# Text to Dialogue
> Generate multi-speaker dialogue audio where each line is spoken by a different voice.

## Overview

The Text to Dialogue node voices a script as a single audio file containing multiple speakers, on one of two ElevenLabs dialogue models called through the direct ElevenLabs API: **ElevenLabs Dialogue v3** (the default) or **ElevenLabs Dialogue v4**. Each line of dialogue is assigned a voice, and the output is a cohesive conversational audio track. This is ideal for creating conversations, interviews, or any scenario requiring distinct speakers without manually generating and stitching individual TTS clips.

## Models

| Model | `provider` value | Stability | Similarity | Notes |
|-------|------------------|-----------|------------|-------|
| ElevenLabs Dialogue v3 | `elevenlabs-dialogue` (default) | Three steps: `0`, `0.5`, `1` | — | Expressive; supports `[audio tags]`. The model every node ran on before the model field existed |
| ElevenLabs Dialogue v4 | `elevenlabs-dialogue-v4` | Any value from `0` to `1` | `0`–`1` | Newest; supports `[audio tags]`, stability and similarity |

v3 stays the default everywhere: a new node, a request that omits `provider`, the `generate_dialogue` MCP tool and the SDK all run v3 dialogue unless you choose v4. Both models offer the same 46 languages.

## Limits

| Limit | Dialogue v3 | Dialogue v4 |
|-------|-------------|-------------|
| Total text across all lines | 5,000 characters (≤2,000 recommended for best quality) | 10,000 characters (≤2,000 recommended for best quality) |
| Unique voices per generation | 10 (reusing a voice across lines does not count extra) | 10 |

Dialogue v4's cap is twice v3 dialogue's: a 10,000-character v4 dialogue was voiced whole in a live check on 2026-10-06, well inside the platform's time limit, and the cap was raised to that number. v3 dialogue stays at 5,000. A script over the chosen model's cap is refused before anything is charged; the editor's counter shows the cap of the model the node is set to.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Model | `select: elevenlabs-dialogue, elevenlabs-dialogue-v4` | `elevenlabs-dialogue` | The dialogue model. Switching to v3 snaps a stability that is not one of its three steps to the nearest step and clears Similarity (v3 does not take it); switching to v4 keeps every value |
| Dialogue Lines | `DialogueLine[]` | `[{ text: "", voice: "Sarah" }]` | Array of dialogue entries, each with text content and a voice selection. Add or remove lines as needed |
| Stability | `number` | `0.5` | Voice consistency across the dialogue. 0 = most expressive, 1 = most consistent. **Dialogue v3:** a dropdown of exactly `0`, `0.5`, `1` (the API refuses any other value for v3). **Dialogue v4:** a 0–1 slider, any value |
| Similarity | `number` 0–1 (Dialogue v4 only) | `0.75` | How closely each line keeps its voice's character. Shown only on Dialogue v4; v3 ignores it and the platform never sends it to v3 |
| Language | `string` | `""` (auto-detect) | Target language code, or empty for automatic detection. Uses the full language list (`ALL_LANGUAGES`) |
| Seed | `number` (optional) | random | Deterministic sampling (integer 0–4294967295). Same seed + same script + same settings reproduces the output |
| Text Normalization | `select: auto, on, off` | `auto` | Whether numbers, dates, and abbreviations are spelled out so they are spoken naturally |

### DialogueLine Fields

| Field | Type | Description |
|-------|------|-------------|
| id | `string` | Unique identifier for the line |
| text | `string` | The spoken text for this line |
| voice | `string` | Voice ID for this line's speaker |
| voiceLabel | `string` (optional) | Display name of the selected voice |

## Credits

> **Rolling out.** Length-based pricing is being turned on one environment at a time (on at `next.nodaro.ai` first). Until it reaches the instance you use, a dialogue costs a flat 25 credits per request, whatever its length and whichever model runs it.

A dialogue is priced on the total characters across its lines, in **units of 100 characters, every started unit counting, with a minimum of 8 units per request**: `credits = max(8, ceil(total characters / 100)) × credits per unit`. Each model prices on its own row:

| Model | Credit identifier | Credits per started 100 characters | Flat price (length pricing off) |
|-------|-------------------|------------------------------------|----------------------------------|
| ElevenLabs Dialogue v3 | `elevenlabs-dialogue` | 4 | 25 per request |
| ElevenLabs Dialogue v4 | `elevenlabs-dialogue-v4` | 4 | 25 per request |

Worked examples, on either model: **100 characters** (any script up to 800) → **32 credits**; **1,000 characters** → **40 credits**; **5,000 characters** (Dialogue v3's cap) → **200 credits**; on Dialogue v4 only, **10,000 characters** (Dialogue v4's cap) → **400 credits**. A script over the chosen model's cap is refused before anything is charged, on the API and in a workflow alike. The editor's estimate, a published app's advertised price and the credits reserved when the node runs all read the same rows.

The timings add nothing: 25 base credits per request on either model. Both models return their timings at the same character cost as the plain render (measured 2026-10-06), so every dialogue run carries them and there is no switch to turn them off.

## API

`POST /v1/text-to-dialogue` takes the node's fields: `dialogue` (`[{ text, voice }]`, in speaking order), optional `provider` (`elevenlabs-dialogue`, the default, or `elevenlabs-dialogue-v4`), `stability`, `similarityBoost`, `languageCode`, `seed` and `applyTextNormalization`. A `stability` Dialogue v3 does not take is refused with `Stability must be 0, 0.5, or 1`; a script over the chosen model's total cap is refused with the cap. The same choice is available as `model` on the `generate_dialogue` MCP tool, `provider` on the SDK's `voices.textToDialogue` and `--model` on `nodaro voice dialogue`.

## Inputs & Outputs

- **Input**: `in` -- optional upstream connection (not typically used; dialogue is configured directly in the panel)
- **Output**: `audio` -- single audio file containing all dialogue lines spoken in sequence (URL)
- **Output**: `json` -- the dialogue's timings as a Transcript: one `segments[]` entry per line (`startMs`, `endMs`, `text`, `speaker` = that line's voice) and `words[]` with per-word `startMs` / `endMs` / `speaker`. Filled on both Dialogue v3 and Dialogue v4 — every dialogue run returns its timings. Over the API the same Transcript is `output_data.transcript` on the finished job.

## Best Practices

- Assign distinct voices to each speaker to make the conversation easy to follow. Use the Voice Browser to preview voices before assigning them.
- Keep individual lines at a natural conversational length -- avoid putting entire paragraphs into a single dialogue entry.
- Use Stability at 0.5 for natural-sounding conversation. Lower it for more dramatic or emotional dialogue, raise it for formal or narration-like delivery. On Dialogue v4 you can pick any value in between.
- The total limit (5,000 characters on Dialogue v3, 10,000 on Dialogue v4) applies across all lines combined. Plan longer dialogues by splitting them across multiple Text to Dialogue nodes if needed.

### Captions without a second transcription

Wire the node's `json` output into [Add Captions](../processing-video/add-captions.md)' `Transcript` input. Add Captions then reads the dialogue's own words and skips its transcription step — and its charge for it — so the captions are timed by the model that spoke the lines, with each line's voice as the speaker. A `json` with nothing in it (Dialogue v3) leaves Add Captions transcribing the track as before. `[audio tags]` in the lines (including multi-word ones such as `[clears throat]`) are never turned into caption words.

Worked example: a two-voice, 1,200-character dialogue run costs 25 base credits on either model, and the Add Captions node downstream spends nothing on transcription — it reads the dialogue's own `json`.

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
