---
node_type: voice-changer-pro
generated_at: 2026-06-22T12:36:45.146Z
generated_from: 41c5c5bde
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
  }>`
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
  "model": "eleven_english_sts_v2",
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

(Add prose here. Auto-gen will preserve it across regenerations.)

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
    "model": "eleven_english_sts_v2",
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
