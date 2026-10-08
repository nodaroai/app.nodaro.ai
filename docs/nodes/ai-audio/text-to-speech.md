# Text to Speech
> Convert text into natural-sounding speech using ElevenLabs voice models with support for audio tags, multiple languages, and custom voices.

## Overview

The Text to Speech node generates spoken audio from text input using ElevenLabs models. It supports five providers with varying language coverage and feature sets. The default and recommended provider, ElevenLabs v4, the fast ElevenLabs v4 Turbo and the previous ElevenLabs v3 support inline audio tags for emotions, reactions, and sound effects, while the v2 models automatically strip these tags before processing.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Text Source | `"connected" \| "direct"` | `"connected"` | Whether text comes from an upstream node or is entered directly in the config panel |
| Direct Text | `string` | `""` | Text to speak when Text Source is "direct" |
| Provider | `TtsProvider` | `"elevenlabs-v4"` | Voice synthesis engine (see Providers table and Default model below) |
| Voice | `string` | `"Rachel"` | Voice selection -- premade, custom (cloned), or library voice via VoiceBrowser |
| Voice Type | `"premade" \| "custom" \| "library"` | `"premade"` | Source of the selected voice |
| Language | `string` | `"en"` | Target language code, or empty for auto-detect. Available languages depend on provider model (see Language Support below) |
| Stability | `number` (0-1) | voice's own | Controls voice consistency. Lower values produce more expressive but variable speech |
| Similarity Boost | `number` (0-1) | voice's own | How closely output matches the target voice timbre. v4, v4 Turbo and the v2 models only |
| Style Exaggeration | `number` (0-1) | voice's own | Amplifies the style of the original voice. v2 models only |
| Speed | `number` (0.7-1.2) | voice's own | Playback speed multiplier. v2 models only |
| Previous text | `string` | `""` | **Continuity:** the line spoken just before this clip in the finished piece. Context the model reads, not spoken. Up to 1,000 characters; a longer passage keeps its end. Used by models that stitch (see Providers) |
| Next text | `string` | `""` | **Continuity:** the line spoken just after it. Up to 1,000 characters; a longer passage keeps its start |
| `promptPrefix` / `promptSuffix` | text | -- | Optional pre/post text wrapped around the prompt at run time (settings panel → **Pre & post text**; hidden from app users; captured by presets). See [Prompt pre & post text](../../prompt-pre-post-text.md). |

The panel shows only the settings the chosen model uses: v3 has Stability alone, v4 and v4 Turbo have Stability and Similarity Boost, and the v2 models have all four. When you choose a different model — in the panel or in the node's model dropdown — the settings the new model does not use are cleared, and a language it does not offer is reset to auto-detect.

### Voice settings & preview fidelity

When you don't touch the sliders, generation uses the **voice's own stored settings** (including speaker boost) — the same settings its preview was rendered with, so output matches what you heard in the Voice Browser. When you adjust one or more sliders, your values are merged **over** the voice's stored settings rather than resetting the others to generic defaults. In a published app the creator can expose **Stability** and **Similarity** as sliders; Similarity writes this node's Similarity Boost, so — like the field — it changes the result on v4, v4 Turbo and the v2 models; v3 ignores it.

Voice Library voices are verified per model by their creators. The Voice Browser knows each library voice's verified models: selecting a library voice while the node is set to a v2 model the voice is **not** verified for automatically snaps the provider to a verified one (your explicit choice is kept whenever the voice is verified for it; a node on v3, v4 or v4 Turbo is never changed by a voice pick). Library voices verified for ElevenLabs v4 are recommended on v4, so when such a snap happens it lands on v4, then v3, then v4 Turbo, then the cheapest v2 model the voice is verified for. A model your deployment does not offer is never the snap target; if a voice is verified only for such models, the provider is left as it is.

### Voice errors

If the selected voice no longer exists on ElevenLabs (e.g. it was removed from the Voice Library or the clone was deleted), the job **fails with a clear error** instead of silently substituting a different voice. The only exception is LLM-originated requests through the MCP `generate_speech` tool, where a hallucinated voice id falls back to the default voice (Rachel) so the agent still gets audio back — unless the request marks the voice as a `library` or `custom` voice (`voice_type`), which fails like any other missing voice.

### Settings from apps, agents and imports

In a published app, the exposed **Stability** and **Similarity** cards start at the node's own value, or at its default (`0.5` / `0.75`) when the node has none, as the config panel does. On a workflow or published-app run, including one started by an agent or the SDK, a voice setting outside its range (Stability, Similarity Boost and Style 0–1, Speed 0.7–1.2) is clamped into it, a number sent as text (`"0.4"`) counts as that number, and anything else (an empty string, a word) is ignored, so the voice's own setting applies. A request made straight to `POST /v1/text-to-speech` is still validated: a value out of range, or a number sent as text, is rejected with a 400. Running a single Text to Speech node from the editor goes through that same route, so a node holding such a value (an imported one, for example) gets the same 400 there, while a full workflow run clamps an out-of-range value and counts a number sent as text as that number, as above.

### Continuity across clips

When a voice-over is produced one clip at a time — one per shot, one per scene, one per block of a narrated video — each clip restarts its intonation at the cut. A model that stitches takes the neighbouring lines as context: set **Previous text** to what is spoken just before this clip and **Next text** to what follows, and the clip picks up where the previous one left off and leads into the next. The context is not spoken and does not change the length of the clip.

The panel shows the **Continuity** section (collapsed) only for a model that stitches; switching the node to one that does not clears both fields. Both are mappable — wire a Text node that holds the previous shot's line — and both can be exposed as text inputs of a published app. Over the API: `previousText` / `nextText` on `POST /v1/text-to-speech`, `previous_text` / `next_text` on the MCP `generate_speech` tool, `previousText` / `nextText` in the SDK's `nodes.run("text-to-speech", …)`. For a model that stitches, the route rejects a value over 1,000 characters (counted after trimming surrounding whitespace); a workflow run and a single-node Run in the editor trim it instead (the end of a previous text, the start of a next text), as a workflow run does for a voice setting out of range. A model that does not stitch never sends these fields, so the route accepts and ignores them. Audio tags in the context follow the same rule as in the text (stripped for a model that does not perform them).

Credits do not change: a request with context costs what it costs without.

### Providers

| Provider | Model | Languages | Audio Tags | Continuity | Per-request character cap |
|----------|-------|-----------|------------|------------|----------------------------|
| `elevenlabs-v4` | ElevenLabs v4 (default, recommended) | 46 | Yes | **Yes** | 10,000 |
| `elevenlabs-v3` | ElevenLabs v3 | 46 | Yes | No | 5,000 |
| `elevenlabs-v4-turbo` | ElevenLabs v4 Turbo — the faster, cheaper v4 at lower fidelity; prefer v4 when quality matters | 46 | Yes | **Yes** | 10,000 |
| `elevenlabs-turbo` | Turbo v2.5 | 32 | No (stripped) | **Yes** | 40,000 |
| `elevenlabs-multilingual` | Multilingual v2 | 29 | No (stripped) | **Yes** | 10,000 |

Over the API and the SDK, text past a provider's cap is clamped, not rejected.
The editor's config panel warns before that point (warn-don't-block). The MCP
`generate_speech` tool instead refuses text it would have to cut, so an agent's
script is never cut silently. It takes at most 10,000 characters of text on any
model, so turbo's 40,000 cap is not reachable through MCP; within that, it
refuses text over the chosen model's own cap (v3: 5,000) and says how many
characters that model takes. Its default model is v4, which takes the tool's full
10,000 characters. A request or node that names no model gets a length-aware
default (see **Default model** below), so long text is never cut to v4's tighter
cap just because no model was named. An explicitly-set `provider` is always
respected as-is; the legacy id `elevenlabs` runs, and is billed, as
`elevenlabs-turbo`.

### Default model

ElevenLabs v4 is the default speech model, with one length rule. When no model is named, text of **up to 10,000 characters** (v4's cap) runs on v4, and **longer text runs on Turbo v2.5** (`elevenlabs-turbo`, cap 40,000). Either way the request is billed for the model it runs on. The length counted is the text actually sent, including any pre and post text. The same rule applies in every run lane: a single node run from the editor, a full workflow or app run, `POST /v1/text-to-speech` and the SDK, and the generative pipeline's narration.

Where no model is named:

- a **new** Text to Speech node starts on v4 (stored on the node, so the length rule does not apply to it), unless a default the administrator set for the node, or the model of the last Text to Speech node you edited in this browser (the editor remembers it), says otherwise;
- a node that stores **no** model follows the length rule. Its credit badge, model dropdown and length counter show v4 whatever the length of its text, but text over 10,000 characters still runs, and is billed, on Turbo;
- `POST /v1/text-to-speech` and the SDK, when the request names no model, follow the length rule;
- the MCP `generate_speech` tool, when the request names no model, runs on v4. It takes at most 10,000 characters and refuses longer text (for example after a preset's pre and post text) with the number, rather than switching model;
- the narration of the generative pipeline follows the length rule; the Video Director's voice-over names v4.

A node that stores a model keeps it: a node saved on v3 still runs on v3, and v3 stays selectable everywhere. v4 costs the same credits per request as v3, so a request that used to default to v3 costs the same. One band of requests changes price: a REST or SDK request that names no model and sends 5,001 to 10,000 characters used to fall back to turbo, and now runs (and is billed) on v4. A voice can sound noticeably different on v4 than on v3, and often comes out quieter: integrations that name no model hear the new model from the switch on — name `elevenlabs-v3` to keep the old voice. Voice Design and the Text to Dialogue node have their own models and are unchanged.

### Language Support

- **Multilingual v2 (29)**: English, Japanese, Chinese, German, Hindi, French, Korean, Portuguese, Italian, Spanish, Indonesian, Dutch, Turkish, Filipino, Polish, Swedish, Bulgarian, Romanian, Arabic, Czech, Greek, Finnish, Croatian, Malay, Slovak, Danish, Tamil, Ukrainian, Russian
- **Turbo v2.5 (32)**: All Multilingual v2 languages plus Hungarian, Norwegian, Vietnamese
- **v3, v4 and v4 Turbo (46)**: All Turbo v2.5 languages plus Hebrew, Thai, Bengali, Urdu, Persian, Serbian, Lithuanian, Latvian, Estonian, Georgian, Icelandic, Catalan, Afrikaans, Swahili

## Credits

> Length-based pricing is on at `app.nodaro.ai` and `next.nodaro.ai` (since 2026-10-08). A Cloud-edition install that leaves `SPEECH_LENGTH_PRICING_ENABLED` off instead charges the flat amount listed for the model (30 credits on v4, v3 and Multilingual v2; 15 on Turbo v2.5 and v4 Turbo), whatever the length. The editor's price badges, the workflow estimate and a published app's advertised price follow the same switch: the flat amount where length pricing is off, the length price where it is on.

A request is priced on the text actually sent — after the per-request cap is applied and, on Turbo v2.5 and Multilingual v2, after `[audio tags]` are stripped — in **units of 100 characters, every started unit counting, with a minimum of 8 units per request**:

```
credits = max(8, ceil(characters / 100)) × unit
```

| Model | Credits per started 100 characters (`unit`) | Minimum per request |
|-------|----------------------------------------------|---------------------|
| ElevenLabs v4, v3, Multilingual v2 | 4 | 32 |
| Turbo v2.5 (and the legacy `elevenlabs` id, which runs as Turbo) | 2 | 16 |
| v4 Turbo | 2 | 16 |

Worked examples:

- **100 characters on v4** → 1 started unit, below the minimum → 8 × 4 = **32 credits** (the same for anything up to 800 characters).
- **1,000 characters on v3** → 10 units → 10 × 4 = **40 credits**.
- **10,000 characters on v4** (its cap) → 100 units → **400 credits**; the same text on Turbo v2.5 → 100 × 2 = **200 credits**.
- **2,500 characters on v4 Turbo** → 25 units → 25 × 2 = **50 credits** (the same text on v4 → 25 × 4 = 100).

Characters are counted as the text's length (an emoji or other character outside the Basic Multilingual Plane counts as 2). A request that names no model is priced on the model the length rule picks (above). In a workflow, text longer than the named model's cap is refused before anything is charged, with the number of characters and the cap; over the API the text is cut at the cap and priced as cut. The editor's price badge, the workflow estimate and a published app's advertised price read the same rows: a node whose text arrives from another node shows a range — from the minimum up to the model's cap — and a published app with such a node is priced at its text input's character limit when the app sets one, else at the cap.

The node's own **Text** (the text it speaks when **Text Source** is Direct) can be exposed as an input of a published app: in the app's Inputs list, expand the node, tick **Text** and, if you want a limit, fill **Maximum characters** beside it. The app then refuses a longer text before anything runs (a `400` with the code `input_too_long`), the input shows a counter against the limit, and the app's advertised price is the price of that many characters rather than the model's cap. Leave the box empty for no limit; the app is then priced at the model's cap. With **Text Source** set to Connected the exposed Text is used only when the connected text is blank.

## Inputs & Outputs

- **Input**: `in` -- text string (from Text Prompt, Generate Text, Combine Text, or any text-producing node)
- **Field mappings**: `previousText` / `nextText` can be bound to any text-producing node (Continuity).
- **Output**: `audio` -- generated speech audio file (URL)

Over the REST API and the SDK, `POST /v1/text-to-speech` also takes `withTimestamps: true`: every speech model (ElevenLabs v3, v4, v4 Turbo, Turbo v2.5 and Multilingual v2) returns its timings at the same character cost as the plain render (measured 2026-10-06; v4 Turbo measured 2026-10-07), so the finished job's `output_data.transcript` carries the speech's per-word timings (`words[]` with `startMs` / `endMs`, no segments) at no extra credits. Without the flag the request is exactly the plain one and no `transcript` is written. The node itself has no timings output.

## Best Practices

- Use ElevenLabs v3, v4 or v4 Turbo for the widest language support and audio tag capabilities. v4 takes up to 10,000 characters per request, but has no Speed or Style setting, and a voice can sound noticeably different on v4 than on v3 — compare the two on your own voice before switching a finished project.
- v4 Turbo is v4's tags and levers at Turbo v2.5's credit price — the choice for tagged narration on a budget; compare it with v4 on your own voice before switching a finished project.
- Keep Stability around 0.5 for a balance between expressiveness and consistency. Push toward 1.0 for narration that needs to sound uniform.
- When using audio tags with v3, v4 or v4 Turbo, place them inline in the text at the point where the effect should occur (e.g., `"I can't believe it [laughs] that's amazing"`).
- Custom voices you already own appear under the "My Voices" tab in the Voice Browser; for a new custom voice use [Voice Design](./voice-design.md).
- Avoid mixing audio tags into text that will be sent to v2 models -- the tags are stripped automatically, but the resulting text may read awkwardly.

## Common Use Cases

- Generating voiceover narration for video projects
- Creating character dialogue for animations or explainer videos
- Producing podcast-style audio from written scripts
- Adding multilingual voiceovers for localized content
- Creating expressive speech with embedded emotions and sound effects (v3, v4 and v4 Turbo)

## Tips

- The Voice Browser dialog provides search, filtering by gender/accent/age/language, and audio previews to help select the right premade voice.
- Audio tags supported by v3, v4 and v4 Turbo include emotions (`[excited]`, `[sad]`, `[angry]`), reactions (`[laughs]`, `[sighs]`, `[gasps]`), delivery styles (`[whispers]`, `[shouting]`), pacing (`[pause]`, `[long pause]`), tone (`[cheerfully]`, `[deadpan]`), and sound effects (`[applause]`, `[thunder]`).
- v2 models support SSML break tags (e.g., `<break time="1.0s" />`) for inserting pauses.
- Setting Language to auto-detect works well for most cases, but explicitly selecting a language can improve pronunciation accuracy for non-English text.
- Custom voices always route through the direct ElevenLabs API.
