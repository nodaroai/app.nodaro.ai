# Voice Remix
> Generate a voice from a natural language description and hear it speak preview text.

## Overview

The Voice Remix node uses ElevenLabs Text-to-Voice to create a new voice based on a written description of the desired vocal characteristics. You describe what the voice should sound like in plain language, provide preview text for it to speak, and the node generates an audio preview with those characteristics. This is useful for rapid voice prototyping without needing reference audio.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Voice Description | `string` (textarea) | `""` | Natural language description of the desired voice (e.g., "A warm, deep male voice with a slight British accent and calm delivery") |
| Preview Text | `string` (textarea) | `""` | The text the generated voice will speak in the preview output |

## Inputs & Outputs

- **Input**: `in` -- optional upstream connection for dynamic text input via field mapping
- **Output**: `audio` -- audio preview of the described voice speaking the preview text (URL)
## Best Practices

- Be specific in your voice description -- include age range, gender, accent, tone, pacing, and emotional quality for more accurate results.
- Use preview text that is representative of the final content. A sentence or two of natural speech works better than isolated words.
- Iterate on the description if the first result does not match expectations. Small wording changes can produce meaningfully different voices.
- This node is best used for exploration and prototyping. For production use, consider Voice Design for more precise control.

## Common Use Cases

- Rapidly prototyping voice styles for a project before committing to a specific voice
- Exploring different vocal characteristics without needing reference recordings
- Creating unique character voices from written descriptions
- Generating voice samples for client approval before full production
- Brainstorming narrator styles for audiobook or video projects

## Tips

- The output is an audio preview only -- it does not produce a reusable voice ID. For a persistent voice you can reuse across TTS nodes, use the Voice Design node instead (which outputs both audio and a `generatedVoiceId`).
- Voice descriptions work best when they reference concrete qualities rather than abstract ones. "Gravelly baritone, speaks slowly, sounds like a late-night radio host" is more effective than "cool and interesting voice."
- The node calls ElevenLabs `POST /v1/text-to-voice/create-previews` under the hood, which may return slightly different results on each run even with the same description.
- Combine with Voice Changer to apply the previewed voice style to existing recordings once you find a voice you like.
