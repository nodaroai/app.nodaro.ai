# Voice Changer Pro
> Replace each speaker's voice independently in a multi-speaker recording — or in a whole talking video — preserving the original emotion, cadence, and timing for every speaker.

## Overview

The Voice Changer Pro node uses ElevenLabs Speech-to-Speech to re-voice multi-speaker media. It detects each speaker in the recording by first-appearance order, then applies your ordered list of target voices — voice 1 recasts speaker 1, voice 2 recasts speaker 2, and so on. Speakers without a mapped voice pass through unchanged.

Like Voice Changer, it operates in two modes, chosen automatically by what you wire in:

- **Audio mode** — wire **audio** in, get re-voiced **audio** out. Each detected speaker is independently revoiced with the corresponding target voice.
- **Video mode** — wire a **video** in, get the **video back with new voices** (plus the new audio track on a separate handle). The node demuxes the audio, runs per-speaker speech-to-speech, and remuxes the result onto the original video — no separate extract-audio / merge-video nodes needed.

In both cases the target voices' identities are applied while the original pacing, intonation, and emotional delivery are preserved.

**How separation works.** Voice and music are **always separated first** — before recasting, the source is split into an isolated vocal stem and a music/SFX stem. **Preserve Background** does not control *whether* the split happens — only whether the music/instrumental stem is mixed back in under the new voices afterward.

**Cloud edition only.** Voice Changer Pro requires a Cloud subscription.

## Configuration

### Node-level settings

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Ordered Voices | `Array<string \| VoiceChangerProVoice \| null>` (1–8) | `[]` | Ordered list of target voices. Voice N recasts the N-th detected speaker (first-appearance order). Speakers without a mapped voice pass through unchanged. Each entry is either a bare voice id (premade name or ElevenLabs UUID), an object with per-voice settings (see below), or `null` — a **keep-slot** that keeps that speaker's original voice while later speakers are still recast. At least one entry must be a real voice. Selectable via VoiceBrowser (premade, custom, or library); add a keep-slot with the **Keep original** button, or convert any row in place. |
| Model | `"eleven_english_sts_v2" \| "eleven_multilingual_sts_v2"` | `"eleven_multilingual_sts_v2"` | ElevenLabs speech-to-speech model. **Multilingual v2** covers 29 languages and is ElevenLabs' recommended model — including for English source audio, where it often outperforms the English-only model. **English v2** remains selectable. |
| Preserve Background | `boolean` | `true` | **On** mixes the separated music / SFX stem back in under the new voices. **Off** drops it for clean, voice-only results. (The voice is always split out first regardless of this setting.) |
| Separation Quality | `"fast" \| "best"` | `"fast"` | Quality of the voice/music separation. **Fast** is quicker and preserves more of the voice. **Best** gives finer voice/music separation. |
| Music Volume | `"match" \| "normalize" \| "manual"` (+ `musicVolume` %) | `"match"` | Level of the **preserved background** music / SFX in the final mix — only applies when **Preserve Background** is on. **match** (default) keeps the original level; **normalize** applies loudness normalization; **manual** sets the level to `musicVolume`% (0–200, default 100). |
| Remove Background Noise | `boolean` | `false` | **On** denoises the result for a cleaner voice-only output. **Off** leaves the recast as-is. |

### Per-voice settings (`VoiceChangerProVoice`)

Each entry in **Ordered Voices** may be an object that pins per-speaker ElevenLabs speech-to-speech settings and loudness behavior. All fields except `voiceId` are optional — omit them to use the model defaults.
(A `null` keep-slot has no per-voice settings — there is nothing to configure for a kept voice.)

| Field | Type | Range | Default | Description |
|-------|------|-------|---------|-------------|
| `voiceId` | `string` | — | *(required)* | Target voice — premade name (`Rachel`, `Aria`, …) or an ElevenLabs UUID for a custom clone. |
| `stability` | `number` | 0–1 | model default | Higher = steadier and more consistent; lower = more expressive and variable. |
| `similarityBoost` | `number` | 0–1 | model default | How closely the output hugs the target voice's timbre. |
| `style` | `number` | 0–1 | `0` | Style exaggeration. `>0` amplifies delivery at the cost of latency / stability. |
| `useSpeakerBoost` | `boolean` | — | `false` | Sharpens fidelity to the target speaker. |
| `seed` | `number` (int) | 0–4294967295 | random | Deterministic speech-to-speech seed for this speaker. The same source + settings + seed recast this speaker identically across runs. Omit for a random seed each run. |
| `volumeMode` | `"match" \| "normalize" \| "manual"` | — | `"match"` | Loudness handling for this recast voice. **match** matches the original speaker's loudness; **normalize** applies loudness normalization; **manual** uses `volume`. |
| `volume` | `number` | 0–200 | `100` | Manual output volume as a percentage. Consulted only when `volumeMode` is `"manual"`. |

### Voice FX (`voiceFx`)

An optional node-level reverb/echo applied to the **combined** recast voices **before** the background is mixed back in — so the effect sits on the voices only, never on the music/SFX bed. Omit `voiceFx` entirely for no effect.

| Field | Type | Range | Default | Description |
|-------|------|-------|---------|-------------|
| `preset` | `AudioFxPreset` | — | *(required)* | Effect preset. Reverb spaces: `room`, `bathroom`, `car`, `hall`, `concert-hall`, `church`, `cave`, `arena`, `outdoor`. Character: `telephone`, `megaphone`, `echo`, `custom`. |
| `wetDryMix` | `number` | 0–100 | preset default | Reverb wet/dry mix as a percentage — higher = wetter (more reverb). Applies to the **reverb** presets. |
| `delayMs` | `number` | 20–2000 | preset default | Echo delay in milliseconds. Used by the `echo` / `custom` presets. |
| `decay` | `number` | 0–1 | preset default | Echo decay / feedback — higher = more repeats. Used by the `echo` / `custom` presets. |

The reverb presets use `wetDryMix`; the `echo` and `custom` presets use `delayMs` + `decay`. Because the effect is applied before the background remix, leaving **Preserve Background** on keeps a dry music bed under reverberant/echoed voices.

## Inputs & Outputs

- **Inputs:**
  - `audio` — source audio whose speakers will be recast (audio mode).
  - `video` — source video to revoice (video mode). **When both `audio` and `video` are wired, video wins and the audio input is ignored.**
- **Outputs:**
  - `audio` — the re-voiced audio track (always produced; in video mode this is the new dialogue track).
  - `video` — the re-voiced video. **Disabled until a video input is wired** (audio mode produces no video).

## Credit Pricing

| Voices mapped | Credits |
|---------------|---------|
| 1 speaker | 4 |
| 2 speakers | 8 |
| 3 speakers | 12 |
| N speakers | 4 × N |

Credit cost is **4 credits per mapped speaker** (per recast pass). Unmapped speakers (those beyond the length of your Ordered Voices list) are passed through without charge.

Keep-slots are free: a `null` entry reserves and charges nothing — credits count only the **recast** (non-null) entries.

> **Note (workflow execution):** When running via the workflow orchestrator (server-side), the orchestrator reserves a flat **4 credits** at job creation time and the worker commits the actual `4 × mappedCount` on completion. For single-speaker workflows there is no under-reserve. For multi-speaker runs the orchestrator may temporarily reserve fewer credits than the worker commits — the final charge is always correct. Single-node runs (clicking Run on the canvas) reserve the correct dynamic amount up front.

## Video Mode

Wire any talking video into the **video** input and the node will:

1. Extract the audio track from the clip.
2. Detect each speaker by first-appearance order.
3. Re-voice each speaker with the corresponding target voice (speech-to-speech).
4. Remux the new voices onto the original video and return it — plus the new audio track on the `audio` output handle.

**Requires an audio track.** Most text-to-video / image-to-video models output *silent* video. If you feed in a silent clip, the node fails fast. Use a clip with spoken audio, or feed audio directly.

**Keeping the background.** Leave **Preserve Background** on (default) to keep any music or sound effects baked into the clip's audio under the new voices. Turn it off for clean, voice-only results.

## Best Practices

- Order your voices carefully — the mapping is positional (first-appearance speaker order). If you are unsure of speaker order, run the clip through a transcription node first to inspect the ordering.
- Leave **Model** on Multilingual v2 (the default) — ElevenLabs recommends it even for English source audio, and it's required for non-English audio. Switch to English v2 only if you want to compare results.
- Use **Preserve Background** on (default) to keep background music or SFX in place. Turn it off only when you want a clean, voice-only output.
- If the music bleeds into the recast or the voice sounds thin, switch **Separation Quality** to **Best** for a cleaner voice/music split. Leave it on **Fast** when speed matters or the voice is already coming through clearly.
- Tune per-voice **stability** / **similarityBoost** / **style** individually per speaker — each entry in Ordered Voices takes its own settings, so you can stabilize one speaker while keeping another expressive.
- Use a per-voice **volumeMode** (`match` / `normalize` / `manual`) to balance loudness across recast speakers — `match` mirrors the original speaker, `manual` lets you dial in an exact percentage.
- You can map fewer voices than speakers: only the listed speakers are revoiced; the rest pass through in the original voice.
- Use keep-slots (**Keep original**) to recast only some speakers — e.g. voices `[Rachel, (keep), Aria]` recast speakers 1 and 3 while speaker 2 keeps their original voice. Keep-slots don't cost credits.
- Custom cloned voices (created via the Voice Clone node) work as target voices for personalized per-speaker recast.

## Common Use Cases

- Re-dubbing a multi-character dialogue video with different voices in one step
- Replacing all speakers in a podcast or interview recording with anonymized voices
- Casting a scene with specific character voices while preserving the original performance
- Converting rough multi-speaker scratch tracks to polished voiceover
- Building multi-lingual versions of scripted content with matched character voices
- Recasting only selected speakers in a panel or interview while the host keeps their original voice (keep-slots)

## Tips

- The emotion and pacing of the original speakers are preserved — this is Speech-to-Speech, not Text-to-Speech. The input performance matters for each speaker.
- If the output sounds robotic on a particular speaker, try lowering that voice's `similarityBoost` or `stability` (each voice is configured independently), or switch to a voice with a closer timbre to the source.
- In video mode, both the revoiced **video** and the revoiced **audio** are available as outputs — wire whichever the rest of your workflow needs.
- This node works with any media input — it does not need to come from another Nodaro node. Uploaded clips and externally hosted URLs both work.
