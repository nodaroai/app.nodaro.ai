# Voice Changer
> Replace the voice in an audio recording — or in a whole talking video — with a different voice, preserving the original emotion, cadence, and timing.

## Overview

The Voice Changer node uses ElevenLabs Speech-to-Speech to re-voice media. It comes in two modes, chosen automatically by what you wire into it:

- **Audio mode** — wire **audio** in, get re-voiced **audio** out. The classic speech-to-speech path.
- **Video mode** — wire a **video** in, get the **video back with a new voice** (plus the new audio track on a separate handle). The node demuxes the audio from the clip, runs speech-to-speech, and remuxes the new voice onto the original video for you — no separate extract-audio / merge-video nodes needed.

In both cases the target voice's identity is applied while the original pacing, intonation, and emotional delivery are preserved.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Voice | `string` | `""` | Target voice to apply. Selectable via VoiceBrowser (premade, custom, or library) |
| Voice Type | `"premade" \| "custom" \| "library"` | `"premade"` | Source of the selected target voice |
| Stability | `number` (0-1) | `0.5` | Voice consistency. Lower = more expressive, higher = more uniform |
| Similarity Boost | `number` (0-1) | `0.75` | How closely the output matches the target voice timbre |
| Remove Background Noise | `boolean` | `false` | **Off** keeps the music / SFX bed under the new voice. **On** removes background and yields a clean, voice-only result. |

## Inputs & Outputs

- **Inputs:**
  - `audio` — source audio whose voice will be replaced (audio mode).
  - `video` — source video to revoice (video mode). **When both `audio` and `video` are wired, video wins and the audio input is ignored.**
- **Outputs:**
  - `audio` — the re-voiced audio track (always produced; in video mode this is the new dialogue track).
  - `video` — the re-voiced video. **Disabled until a video input is wired** (audio mode produces no video).

## Video Mode

Wire any talking video (a generated clip, an uploaded file, a lip-synced shot) into the **video** input and the node will:

1. Extract the audio track from the clip.
2. Re-voice it with your selected voice (speech-to-speech).
3. Remux the new voice onto the original video and return it — plus the new audio track on the `audio` output handle.

This collapses what used to be a four-node chain (generate video → extract audio → voice changer → merge audio+video) into a single node and a single result.

**Requires an audio track.** Most text-to-video / image-to-video models output *silent* video — only models that generate sound (e.g. Veo 3, Kling) produce a usable track. If you feed in a silent clip, the node fails fast with: *"This video has no audio track to revoice."* Use a clip with spoken audio, or feed audio directly.

**Keeping the music bed.** Leave **Remove Background Noise** off to keep any music or sound effects baked into the clip's audio under the new voice. Turn it on for a clean, voice-only result.

## Best Practices

- Start with Stability at 0.5 and Similarity Boost at 0.75, then adjust based on results. Higher similarity produces more accurate voice matching but can reduce naturalness.
- For video mode, prefer source clips whose audio is mostly speech. Heavy music under the dialogue can bleed into the conversion — turn on Remove Background Noise if you want a clean voice and don't need the original bed.
- Use clean, well-recorded source audio for best results. The model preserves delivery characteristics from the input, so poor input quality carries through.
- For dramatic voice changes (e.g., male to female), allow for some loss of nuance -- the further the source and target voices differ, the more processing artifacts may appear.

## Common Use Cases

- Re-dubbing a talking-head or lip-synced video with a different voice in one step
- Re-voicing content to match a brand voice or character
- Anonymizing speakers in recordings while keeping natural delivery
- Converting rough scratch tracks to polished voiceover
- Applying a consistent narrator voice across recordings from different speakers

## Tips

- The emotion and pacing of the original are preserved in the output -- this is Speech-to-Speech, not Text-to-Speech. The input performance matters.
- Custom cloned voices (created via the Voice Clone node) can be used as the target voice for personalized re-voicing.
- If the output sounds robotic or unnatural, try lowering the Similarity Boost to give the model more freedom.
- In video mode, both the revoiced **video** and the revoiced **audio** are available as outputs — wire whichever the rest of your workflow needs.
- This node works with any media input -- it does not need to come from another Nodaro node. Uploaded clips and externally hosted URLs both work.
