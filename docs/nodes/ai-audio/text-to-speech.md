# Text to Speech
> Convert text into natural-sounding speech using ElevenLabs or Google Gemini voice models with support for audio tags, multiple languages, and custom voices.

## Overview

The Text to Speech node generates spoken audio from text input using ElevenLabs or Google Gemini models. It supports nine providers with varying language coverage and feature sets. The default and recommended provider, ElevenLabs v4, the fast ElevenLabs v4 Turbo and the previous ElevenLabs v3 support inline audio tags for emotions, reactions, and sound effects, while the v2 models automatically strip these tags before processing. The four Gemini models (see [Gemini models](#gemini-models)) cost much less per character, speak only their own named voices, and take tone tags and a style direction of their own.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Text Source | `"connected" \| "direct"` | `"connected"` | Whether text comes from an upstream node or is entered directly in the config panel |
| Direct Text | `string` | `""` | Text to speak when Text Source is "direct" |
| Provider | `TtsProvider` | `"elevenlabs-v4"` | Voice synthesis engine (see Providers table and Default model below) |
| Voice | `string` | `"Rachel"` | Voice selection -- premade, custom (cloned), or library voice via VoiceBrowser. On a Gemini model, one of that model's own voices (default `Fola` on 3.8, `Kore` on 3.1 / 2.5) |
| Voice Type | `"premade" \| "custom" \| "library"` | `"premade"` | Source of the selected voice |
| Language | `string` | `"en"` | Target language code, or empty for auto-detect. Available languages depend on provider model (see Language Support below) |
| Stability | `number` (0-1) | voice's own | Controls voice consistency. Lower values produce more expressive but variable speech |
| Similarity Boost | `number` (0-1) | voice's own | How closely output matches the target voice timbre. v4, v4 Turbo and the v2 models only |
| Style Exaggeration | `number` (0-1) | voice's own | Amplifies the style of the original voice. v2 models only |
| Speed | `number` (0.7-1.2) | voice's own | Playback speed multiplier. v2 models only |
| Previous text | `string` | `""` | **Continuity:** the line spoken just before this clip in the finished piece. Context the model reads, not spoken. Up to 1,000 characters; a longer passage keeps its end. Used by models that stitch (see Providers) |
| Next text | `string` | `""` | **Continuity:** the line spoken just after it. Up to 1,000 characters; a longer passage keeps its start |
| Style direction | `string` | `""` | Gemini only. On 3.8 Flash-Lite and 3.8 Flash: free text, up to 1,000 characters — tone, emotion, pace ("slow and dry, like a night-shift radio host"). On 3.1 Flash and 2.5 Pro: one of `Vocal Smile`, `Newscaster`, `Whisper`, `Empathetic`, `Promo/Hype`, `Deadpan`. Not spoken, not billed |
| Pace | `string` | `""` | Gemini 3.1 Flash and 2.5 Pro: `Natural`, `Rapid Fire`, `The Drift` or `Staccato` |
| Accent | `string` | `""` | Gemini 3.1 Flash and 2.5 Pro: `Neutral`, `American (Gen)`, `American (Valley)`, `American (South)`, `British (RP)`, `British (Brixton)`, `Transatlantic` or `Australian` |
| Audio profile | `string` | `""` | Gemini 3.1 Flash and 2.5 Pro: who is speaking, in words ("a warm, unhurried narrator"), up to 1,000 characters |
| File | `select: mp3_44100_128, mp3_44100_192, wav_24000` | `mp3_44100_128` | The audio file, on every model, at the same credits: MP3 at 128 kbps (the default) or 192 kbps, or WAV at 24 kHz. A workflow run, a published app and the API deliver the same file (`outputFormat`) |
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
| `gemini-3-8-flash-lite-tts` | Gemini 3.8 Flash-Lite — the cheapest; 70 named voices, `<tone tags>`, a free-text style | Follows the text | Yes | No | 10,000 |
| `gemini-3-8-flash-tts` | Gemini 3.8 Flash — the larger 3.8 model; the same voices, tags and style | Follows the text | Yes | No | 10,000 |
| `gemini-3-1-flash-tts` | Gemini 3.1 Flash — 30 named voices, `[audio tags]`, style, pace, accent and audio profile | Follows the text | Yes | No | 10,000 |
| `gemini-2-5-pro-tts` | Gemini 2.5 Pro — the same 30 voices and controls as 3.1 Flash, from the Pro model | Follows the text | Yes | No | 10,000 |

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

### Gemini models

Google's Gemini speech models run beside ElevenLabs; ElevenLabs v4 stays the default. They cost much less per character (see Credits), and differ from the ElevenLabs models in four ways:

- **Their own named voices only.** Each model speaks its own list — no premade ElevenLabs voice, Voice Library voice or clone. 3.8 Flash-Lite and 3.8 Flash have 70 voices grouped by use (Tutor, Commercial Voiceover, Instructional, Podcast, Storyteller, Digital Assistant, Call Center, Concierge, Tech Support, Professional); 3.1 Flash and 2.5 Pro share 30 (the 3.8 list's names `Fola`, `Bodi` and the other 3.8-only voices are not among them). The panel shows the model's list in place of the Voice Browser; switching models picks the new model's default voice when the node's voice is not on its list. The same move applies wherever the model is chosen apart from the voice — a published app's Model card, a field mapping onto the model, an upstream Character's voice, a preset's voice with a model named over MCP: on a Gemini model a voice not on its list runs the model's default, and on an ElevenLabs model a Gemini voice runs the deployment's default voice. Over the API (`POST /v1/text-to-speech`), where the caller names both, a voice not on the model's list is refused with a 400 before anything is charged, and no voice runs the model's default (`Fola` on 3.8, `Kore` on 3.1 / 2.5). `GET /v1/voices?model=<id>`, the SDK's `voices.list({ model })` and MCP `list_voices { model }` list them. A deployment that limits voices by gender lists none of them and refuses the Gemini models whole for now, with or without a voice named (their genders are not recorded): a 400 over the API, and a workflow run refuses the node before anything is charged.
- **No language setting.** The language follows the text; the Language setting is hidden.
- **Tone tags in each generation's own form.** 3.8 Flash-Lite and 3.8 Flash take angle-bracket tags from a fixed list — `<laugh>`, `<sigh>`, `<gasp>`, `<whispers>`, `<shout>`, `<short pause>`, `<long pause>`, `<throat-clearing>` and others. Write the usual `[square]` tags: each one that has a 3.8 counterpart is sent as it (`[laughs]` → `<laugh>`, `[pause]` → `<short pause>`, `[clears throat]` → `<throat-clearing>`), and the rest (`[excited]`, `[sarcastic]`, sound effects) are removed — put a mood in the style direction instead. A word in angle brackets that is not one of its tags keeps the word ("Press <Enter> to go" is spoken "Press Enter to go"), and formatting tags pasted with a text (`<br>`, `<p>`, `<b>`, `<i>`, `<strong>`, `<em>`, `<u>`, `<span>`, `<div>`) are taken out with their words kept, a line break or paragraph read as a space ("Line one<br>Line <b>two</b>" is spoken "Line one Line two"). The character counter and the price count the text as it is sent. 3.1 Flash and 2.5 Pro take `[square]` tags as written.
- **Style direction.** On 3.8 a free-text description of how the line is spoken; on 3.1 Flash and 2.5 Pro a speaking style, a pace, an accent and an audio profile (see Configuration). Over the API: `styleDirection`, `pace`, `accent` and `audioProfile` on `POST /v1/text-to-speech` and in the SDK; `style_direction`, `pace`, `accent`, `audio_profile` on MCP `generate_speech`. A value the model does not take is refused with a 400 (a 3.8 style text on 3.1, a pace not in the list); a field the model does not take at all is ignored, as is a direction on an ElevenLabs model.

They do not stitch (no Continuity section) and return no timings. Up to 10,000 characters per request — on 3.8 counted after the tags are rewritten (a tag's own spelling can be longer, `[pause]` → `<short pause>`): over the API the rewritten text is cut to 10,000, and a workflow run or the MCP tool refuses text whose rewrite is longer, with the number. The audio is rendered as a 24 kHz WAV and delivered in the format asked for (`outputFormat`, default MP3 as on every model).

### A one-off clone of your own voice (Gemini 3.8 Flash)

Gemini 3.8 Flash can speak in a person's own voice, cloned for one request from two recordings, in place of a named voice. The clone is used for that request alone. Neither Google nor Nodaro saves it as a voice, and nothing appears in your voices. Saved voice cloning is still not offered on Nodaro (the clone routes answer `410 voice_cloning_retired`); this one-off clone is the only exception. It costs nothing extra: a request with a clone is priced like any other on 3.8 Flash.

- **The reference recording:** 10–30 seconds of the person speaking naturally, in a quiet room with no echo, music or second voice, in the language you will generate.
- **The consent recording:** the same person, in the same room and on the same microphone, reading: "I am the owner of this voice and I consent to Google using this voice to create a synthetic voice model." (Google also accepts this sentence in its other supported languages.) Trim the silence at the start and end. At most 30 seconds.
- **Both:** real recordings of the same adult (Google refuses AI-generated audio), WAV files (24 kHz, mono, 16-bit is best) of at most 10 MB each, each given as an https link.

In the editor, the Text to Speech panel shows **Your own voice (a one-off clone)** on 3.8 Flash. You upload the two recordings there and tick the consent box: "I confirm the voice in these recordings is my own, or that its owner, an adult, has given me consent to clone it for this generation, and that neither recording is AI-generated." The node runs a clone only once that box is ticked, in the editor and in a workflow or app run alike. Changing a recording clears the tick. **The tick is yours alone:** the server records who ticked it (`POST /v1/voice-clone/consent` issues a signed record of your consent for those two recordings). Nobody else gets your recordings or your tick: a template someone clones, an app, a component or a share link carries the clone switched on with its recordings empty, no tick and none of the node's earlier results (they speak in your voice), and whoever runs it adds their own two recordings and ticks the box themselves. A workspace collaborator who may only view the workflow sees the clone the same way (their results stay); one who may edit it reads it as stored, since their editor saves it back whole. The consent records are keyed by the install's `INTERNAL_ORCHESTRATOR_SECRET`: rotating it voids them, and each clone runs again only once its box is ticked again.

**In a published app, the recordings are the runner's own.** Publishing an app, a template or a component never ships your recordings or your tick: the clone ships switched on with its recordings empty, and a share link's viewer gets the same. The app's page asks whoever runs it (you included) for their own two WAV recordings and their own tick, with the same consent sentence; a dialogue asks once for each cloned speaker a line speaks with. A run without them is refused before anything is held or charged (the recordings are downloaded only after the app's daily limit and the runner's credits are checked, as are an app run's Retry and Render final): a `400` with the code `clone_recordings_required` (no recordings) or `clone_consent_required` (no tick of the runner's own), `clone_model_unsupported` when the model the run dispatches (an exposed Model card, a wired Character's voice) does not clone, a `403` where the deployment withholds one-off clones, and the recordings themselves are judged as on the API (https, a WAV within 10 MB, the reference 10–30 s, the consent recording at most 30 s). Over the API, an app run passes them as `inputOverrides`: on a Text to Speech node `{ "replica": { "sourceAudioUrl", "consentAudioUrl" }, "replicaConsent": <the record POST /v1/voice-clone/consent returned> }`, on a Text to Dialogue node its whole `speakers` list with each cloned speaker's `replica` and `replicaConsent`. A clone inside a sub-workflow or a component the app runs cannot take a runner's recordings, so such an app is refused (`clone_not_fillable`); so is any other run (the editor's, the API's, MCP `run_workflow`) of a workflow that runs a component holding a clone, before anything is held. It is priced like any other run: a clone costs nothing extra. The consent sentence to read is shown in the editor's language and in English, which Google always accepts. The uploads are ordinary uploads: they stay in your library until you delete them. What a run itself copies or makes from them is deleted when the run ends.

Over the API, `POST /v1/text-to-speech` takes `replica: { sourceAudioUrl, consentAudioUrl, consent: true }` with `provider: "gemini-3-8-flash-tts"`. `consent: true` is the caller's confirmation of the same sentence the editor's checkbox shows ("I confirm the voice in these recordings is my own, or that its owner, an adult, has given me consent to clone it for this generation, and that neither recording is AI-generated."); a clone without it is refused with a 400 before anything is read or charged. Both recordings are fetched and checked (a WAV, at most 10 MB, the reference 10–30 s, the consent recording at most 30 s) before anything is charged; a recording that fails a check is answered with a 400 naming the problem. The same checks run in a workflow before the node's credits are reserved. A clone on any other model, 3.8 Flash-Lite included, is refused, never dropped: another voice would speak in its place. Flash-Lite does not take one-off clones. If Google refuses the recordings (for example a consent recording that does not read the sentence, or AI-generated audio), the run fails with that reason and nothing is charged. The run's own copies of the recordings are deleted when it ends, and their links are not kept on the job; the recordings themselves stay wherever you keep them (your library, for an editor upload). MCP `generate_speech` takes `replica` (`source_audio_url`, `consent_audio_url`, `consent: true`, which the agent must ask the user for), and the SDK takes `replica` on `TextToSpeechParams`. A deployment that limits voices by gender refuses the Gemini models whole, clones included. One-off cloning is a feature a deployment offers or withholds on its own (`voice-clone-one-off`, a row in Admin → Availability, or a profile's `nodes.allow` / `nodes.deny`); a deployment that withholds the Voice Clone node withholds it too. Where it is withheld, a clone is refused on the API, in a workflow and over MCP before anything is read or charged, and the editor hides the clone section.

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

- **Gemini models**: no list — the language follows the text.
- **Multilingual v2 (29)**: English, Japanese, Chinese, German, Hindi, French, Korean, Portuguese, Italian, Spanish, Indonesian, Dutch, Turkish, Filipino, Polish, Swedish, Bulgarian, Romanian, Arabic, Czech, Greek, Finnish, Croatian, Malay, Slovak, Danish, Tamil, Ukrainian, Russian
- **Turbo v2.5 (32)**: All Multilingual v2 languages plus Hungarian, Norwegian, Vietnamese
- **v3, v4 and v4 Turbo (46)**: All Turbo v2.5 languages plus Hebrew, Thai, Bengali, Urdu, Persian, Serbian, Lithuanian, Latvian, Estonian, Georgian, Icelandic, Catalan, Afrikaans, Swahili

## Credits

> Length-based pricing is on at `app.nodaro.ai` and `next.app.nodaro.ai` (since 2026-10-08). A Cloud-edition install that leaves `SPEECH_LENGTH_PRICING_ENABLED` off instead charges the flat amount listed for the model (33 credits<!-- credits: elevenlabs-v4 --> on v4, v3 and Multilingual v2; 17<!-- credits: elevenlabs-v4-turbo --> on Turbo v2.5 and v4 Turbo), whatever the length. The editor's price badges, the workflow estimate and a published app's advertised price follow the same switch: the flat amount where length pricing is off, the length price where it is on.

A request is priced on the text actually sent — after the per-request cap is applied and, on Turbo v2.5 and Multilingual v2, after `[audio tags]` are stripped (on Gemini 3.8, after the tags are rewritten to its own or removed) — in **units of 100 characters, every started unit counting, with a minimum of 8 units per request**, the request's total rounded up to a whole credit. A Gemini model's style direction is not counted:

```
credits = ceil(max(8, ceil(characters / 100)) × unit)
```

| Model | Credits per started 100 characters (`unit`) | Minimum per request |
|-------|----------------------------------------------|---------------------|
| ElevenLabs v4, v3, Multilingual v2 | 4.4<!-- credits-rate: elevenlabs-v4:per-100-chars --> | 36<!-- credits: elevenlabs-v4:per-100-chars@8 --> |
| Turbo v2.5 (and the legacy `elevenlabs` id, which runs as Turbo) | 2.2<!-- credits-rate: elevenlabs-turbo:per-100-chars --> | 18<!-- credits: elevenlabs-turbo:per-100-chars@8 --> |
| v4 Turbo | 2.2<!-- credits-rate: elevenlabs-v4-turbo:per-100-chars --> | 18<!-- credits: elevenlabs-v4-turbo:per-100-chars@8 --> |

The Gemini models are priced per 1,000 characters on the same count — started 100 characters, at least 8 per request — so a request costs its started hundreds × the rate ÷ 10, rounded up to a whole credit:

| Model | Credits per 1,000 characters | Minimum per request |
|-------|------------------------------|---------------------|
| Gemini 3.8 Flash-Lite | 4.4<!-- credits-rate: gemini-3-8-flash-lite-tts:per-1k-chars --> | 5<!-- credits: gemini-3-8-flash-lite-tts:per-100-chars:8u --> |
| Gemini 3.8 Flash | 6.6<!-- credits-rate: gemini-3-8-flash-tts:per-1k-chars --> | 6<!-- credits: gemini-3-8-flash-tts:per-100-chars:8u --> |
| Gemini 3.1 Flash | 14.3<!-- credits-rate: gemini-3-1-flash-tts:per-1k-chars --> | 13<!-- credits: gemini-3-1-flash-tts:per-100-chars:8u --> |
| Gemini 2.5 Pro | 17.6<!-- credits-rate: gemini-2-5-pro-tts:per-1k-chars --> | 15<!-- credits: gemini-2-5-pro-tts:per-100-chars:8u --> |

These rates are provisional: they are to be checked against real runs and may change.

Worked examples:

- **100 characters on v4** → 1 started unit, below the minimum → 8 × 4.4<!-- credits-rate: elevenlabs-v4:per-100-chars --> = 35.2<!-- credits-rate: elevenlabs-v4:per-100-chars@8 -->, rounded up: **36 credits**<!-- credits: elevenlabs-v4:per-100-chars@8 --> (the same for anything up to 800 characters).
- **1,000 characters on v3** → 10 units → 10 × 4.4<!-- credits-rate: elevenlabs-v3:per-100-chars --> = **44 credits**<!-- credits: elevenlabs-v3:per-100-chars@10 -->.
- **10,000 characters on v4** (its cap) → 100 units → **440 credits**<!-- credits: elevenlabs-v4:per-100-chars@100 -->; the same text on Turbo v2.5 → 100 × 2.2<!-- credits-rate: elevenlabs-turbo:per-100-chars --> = **220 credits**<!-- credits: elevenlabs-turbo:per-100-chars@100 -->.
- **1,000 characters on Gemini 3.8 Flash-Lite** → 10 units → **5 credits**<!-- credits: gemini-3-8-flash-lite-tts:per-100-chars:10u -->; **2,050 characters on Gemini 2.5 Pro** → 21 units → **38 credits**<!-- credits: gemini-2-5-pro-tts:per-100-chars:21u -->; **10,000 characters on Gemini 3.1 Flash** (its cap) → **143 credits**<!-- credits: gemini-3-1-flash-tts:per-100-chars:100u -->.
- **2,500 characters on v4 Turbo** → 25 units → 25 × 2.2<!-- credits-rate: elevenlabs-v4-turbo:per-100-chars --> = **55 credits**<!-- credits: elevenlabs-v4-turbo:per-100-chars@25 --> (the same text on v4 → 25 × 4.4<!-- credits-rate: elevenlabs-v4:per-100-chars --> = 110<!-- credits: elevenlabs-v4:per-100-chars@25 -->).

Characters are counted as the text's length (an emoji or other character outside the Basic Multilingual Plane counts as 2). A request that names no model is priced on the model the length rule picks (above). In a workflow, text longer than the named model's cap is refused before anything is charged, with the number of characters and the cap; over the API the text is cut at the cap and priced as cut. The editor's price badge, the workflow estimate and a published app's advertised price read the same rows: a node whose text arrives from another node shows a range — from the minimum up to the model's cap — and a published app with such a node is priced at its text input's character limit when the app sets one, else at the cap.

The node's own **Text** (the text it speaks when **Text Source** is Direct) can be exposed as an input of a published app: in the app's Inputs list, expand the node, tick **Text** and, if you want a limit, fill **Maximum characters** beside it. The app then refuses a longer text before anything runs (a `400` with the code `input_too_long`), the input shows a counter against the limit, and the app's advertised price is the price of that many characters rather than the model's cap. Leave the box empty for no limit; the app is then priced at the model's cap. With **Text Source** set to Connected the exposed Text is used only when the connected text is blank.

## Inputs & Outputs

- **Input**: `in` -- text string (from Text Prompt, Generate Text, Combine Text, or any text-producing node)
- **Field mappings**: `previousText` / `nextText` can be bound to any text-producing node (Continuity).
- **Output**: `audio` -- generated speech audio file (URL)

Over the REST API and the SDK, `POST /v1/text-to-speech` also takes `withTimestamps: true`: every ElevenLabs speech model (ElevenLabs v4, v3, v4 Turbo, Turbo v2.5 and Multilingual v2) returns its timings at the same character cost as the plain render (measured 2026-10-06; v4 Turbo measured 2026-10-07), so the finished job's `output_data.transcript` carries the speech's per-word timings (`words[]` with `startMs` / `endMs`, no segments) at no extra credits. The Gemini models (Gemini 3.8 Flash-Lite, Gemini 3.8 Flash, Gemini 3.1 Flash and Gemini 2.5 Pro) return none: the flag is ignored there and no `transcript` is written. Without the flag the request is exactly the plain one and no `transcript` is written. The node itself has no timings output.

Over the REST API and the SDK, `POST /v1/text-to-speech` also takes `outputFormat` — the audio file to deliver: `mp3_44100_128` (the default, and exactly what every request delivered before the field existed), `mp3_44100_192` (a higher MP3 bitrate) or `wav_24000` (an uncompressed 24 kHz WAV). The choice changes the file only: the credits are the same, and the finished job's `audioUrl` ends in `.mp3` or `.wav` accordingly (the library records a WAV as `audio/wav`). Without the field the vendor request is byte-identical to the plain one. The node itself always delivers the default MP3. A Gemini model renders a 24 kHz WAV: `wav_24000` delivers it as rendered, and either MP3 format (the default included) is encoded from it at 44.1 kHz.

## Best Practices

- Use ElevenLabs v3, v4 or v4 Turbo for the widest language support and audio tag capabilities. v4 takes up to 10,000 characters per request, but has no Speed or Style setting, and a voice can sound noticeably different on v4 than on v3 — compare the two on your own voice before switching a finished project.
- v4 Turbo is v4's tags and levers at Turbo v2.5's credit price — the choice for tagged narration on a budget; compare it with v4 on your own voice before switching a finished project.
- For long narration on a tight budget, try a Gemini model: 3.8 Flash-Lite is the cheapest, 3.8 Flash is the larger 3.8 model, and 3.1 Flash and 2.5 Pro trade a higher price for a speaking style, pace, accent and audio profile. Pick a voice from the model's own list (3.8 groups them by use), and describe the delivery in the style direction rather than with tags it does not take.
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
