# Voice Changer
> Transform the voice in an audio recording to sound like a different speaker while preserving the original emotion and delivery.

## Overview

The Voice Changer node uses ElevenLabs Speech-to-Speech to re-voice audio input. It takes an existing audio recording and converts it to sound like a chosen target voice, while retaining the original pacing, intonation, and emotional delivery. This is useful for re-voicing content without re-recording, or for applying a consistent voice identity to varied source recordings.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Voice | `string` | `""` | Target voice to apply. Selectable via VoiceBrowser (premade, custom, or library) |
| Voice Type | `"premade" \| "custom" \| "library"` | `"premade"` | Source of the selected target voice |
| Stability | `number` (0-1) | `0.5` | Voice consistency. Lower = more expressive, higher = more uniform |
| Similarity Boost | `number` (0-1) | `0.75` | How closely the output matches the target voice timbre |
| Remove Background Noise | `boolean` | `false` | Pre-process input to remove background noise before voice conversion |

## Inputs & Outputs

- **Input**: `in` -- source audio file containing the voice to be transformed
- **Output**: `audio` -- transformed audio file with the target voice applied (URL)

## Credit Cost

4 credits per transformation (`elevenlabs-voice-changer`).

## Best Practices

- Start with Stability at 0.5 and Similarity Boost at 0.75, then adjust based on results. Higher similarity produces more accurate voice matching but can reduce naturalness.
- Enable Remove Background Noise if the source audio has ambient sounds -- this improves voice conversion quality significantly.
- Use clean, well-recorded source audio for best results. The model preserves delivery characteristics from the input, so poor input quality carries through.
- For dramatic voice changes (e.g., male to female), allow for some loss of nuance -- the further the source and target voices differ, the more processing artifacts may appear.

## Common Use Cases

- Re-voicing content to match a brand voice or character
- Anonymizing speakers in recordings while keeping natural delivery
- Converting rough scratch tracks to polished voiceover
- Applying a consistent narrator voice across recordings from different speakers
- Creating character voices from a single actor's performance

## Tips

- The emotion and pacing of the original recording are preserved in the output -- this is Speech-to-Speech, not Text-to-Speech. The input performance matters.
- Custom cloned voices (created via the Voice Clone node) can be used as the target voice for personalized re-voicing.
- If the output sounds robotic or unnatural, try lowering the Similarity Boost to give the model more freedom.
- The Remove Background Noise option applies the same isolation technology as the Voice Extractor node, but as a built-in preprocessing step.
- This node works with any audio input -- it does not need to come from a TTS node. Microphone recordings, podcast clips, and video audio tracks all work.
