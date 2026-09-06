---
node_type: voice-changer-pro
generated_at: 2026-08-31T00:09:26.390Z
generated_from: 5fe66b0ff
---

# Voice Changer Pro

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `voice-changer-pro`
**Category:** ai
**Credit cost:** 4
**Inputs (target handles):** `audio`, `video`
**Outputs (source handles):** `audio`, `video`

**Required data fields:**
- `label: string`
- `orderedVoices: Array<{
    voiceId: string
    voiceLabel: string
    voiceType: "premade" | "custom" | "library"
    /** Which lane converts this speaker: "sts" (default — speech-to-speech
     *  recast) | "v3" (Re-speak: the performance is regenerated from the
     *  transcript with eleven_v3; stability 0/0.5/1 only;
     *  similarityBoost/style/useSpeakerBoost are ignored). */
    engine?: "sts" | "v3"
    stability?: number
    similarityBoost?: number
    style?: number
    useSpeakerBoost?: boolean
    /** How this voice's output level is set. "match" (default) keeps the
     *  source speaker's loudness, "normalize" levels it to a target, "manual"
     *  applies the `volume` percentage below. */
    volumeMode?: "match" | "normalize" | "manual"
    /** Output volume as a percentage (100 = unchanged). Only applied when
     *  volumeMode === "manual". */
    volume?: number
    /** Per-voice generation seed for reproducible recasts. Integer in
     *  [0, 4294967295]. Omitted ⇒ random (the backend default). */
    seed?: number
  } | null>`
- `preserveBackground: boolean`
- `removeBackgroundNoise: boolean`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `model?: VoiceChangerModel`
- `musicVolumeMode?: "match" | "normalize" | "manual"`
- `musicVolume?: number`
- `separationQuality?: "fast" | "best"`
- `voiceFx?: {
    preset: AudioFxPreset
    /** Reverb wet/dry mix (0–100). Only for reverb presets. */
    wetDryMix?: number
    /** Echo/custom delay in ms (20–2000). */
    delayMs?: number
    /** Echo/custom decay (0–1). */
    decay?: number
  }`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedAudioUrl?: string`
- `generatedVideoUrl?: string`
- `generatedResults?: GeneratedResult[]`
- `activeResultIndex?: number`
- `currentJobId?: string`
- `currentJobProgress?: number`

**Default data:**
```json
{
  "label": "Voice Changer Pro",
  "orderedVoices": [],
  "model": "eleven_multilingual_sts_v2",
  "preserveBackground": true,
  "removeBackgroundNoise": false,
  "fieldMappings": {},
  "executionStatus": "idle",
  "generatedResults": [],
  "activeResultIndex": 0
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

Detect each speaker in an audio or video clip and recast each one to a different target voice (`voice_changer_pro` over MCP; cloud-only).

### Field semantics

- **`ordered_voices`** — first-appearance order: speaker 1 → voices[0], speaker 2 → voices[1], … Unmapped speakers keep their original voice; a `null` entry is a keep-slot (that speaker keeps their voice while later speakers are still recast). At least one entry must be non-null.
- Each entry is EITHER a bare voice id OR an object with per-voice settings — `{ voiceId, engine, stability, similarityBoost, style, useSpeakerBoost, seed, volumeMode, volume }`. `engine`: `sts` (default, speech-to-speech recast) or `v3` (re-speak: the performance is regenerated from the transcript with eleven_v3; stability 0/0.5/1 only; similarityBoost/style/useSpeakerBoost ignored; needs transcript text). `volumeMode` `match` (default) keeps the original speaker's loudness, `normalize` applies loudnorm, `manual` uses `volume` (0–200 %). A per-voice `seed` (0–4294967295) makes that speaker's recast reproducible.
- **Source** — ONE of `audio_url` / `audio_asset_id` (audio → audio) or `video_url` / `video_asset_id` (recast the voices in a full clip: demux, recast, remux).
- **Background** — voice and music are ALWAYS separated first; `preserve_background` (default true) controls whether the music/SFX bed is mixed back under the new voices; `music_volume_mode` sets its level (`match` keeps the original, `normalize` loudnorms, `manual` uses `music_volume` 0–200 %).
- **`voice_fx`** — reverb/echo applied to the COMBINED recast voices BEFORE the background is mixed back (the effect sits on the voices, not the music bed).
- **Voice ids** — the same naming as `generate_speech`: a premade voice NAME (Rachel, Aria, Roger, …) or an ElevenLabs UUID for a custom clone.

<!-- AUTO-GEN:START mcp-call -->
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

(Add prose here.)

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "voice-changer-pro-1",
  "type": "voice-changer-pro",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Voice Changer Pro",
    "orderedVoices": [],
    "model": "eleven_multilingual_sts_v2",
    "preserveBackground": true,
    "removeBackgroundNoise": false,
    "fieldMappings": {},
    "executionStatus": "idle",
    "generatedResults": [],
    "activeResultIndex": 0
  }
}
```
<!-- AUTO-GEN:END examples -->
