# Voice Design
> Create a custom voice with full parameter controls and receive both an audio preview and a reusable voice ID.

## Overview

The Voice Design node provides comprehensive control over voice synthesis via the ElevenLabs Text-to-Voice Design API. Unlike Voice Remix (which uses only a text description), Voice Design exposes model selection, loudness, guidance scale, seed, and quality parameters for precise voice creation. The output includes both an audio preview and a `generatedVoiceId` that can be fed into Text to Speech nodes for ongoing use.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Voice Description | `string` (textarea) | `""` | Natural language description of the desired voice characteristics |
| Preview Text | `string` (100-1000 chars) | `""` | Text the generated voice will speak in the preview. Must be between 100 and 1000 characters |
| Model | `VoiceDesignModel` | `"eleven_ttv_v3"` | Voice generation model: `eleven_ttv_v3` (recommended) or `eleven_multilingual_ttv_v2` |
| Loudness | `number` (-1 to 1) | `0` | Output volume adjustment. Negative values produce quieter output, positive values produce louder output |
| Guidance Scale | `number` (0-100) | `5` | How strictly the model follows the voice description. Higher values are more literal, lower values are more creative |
| Seed | `number` (optional) | -- | Random seed for reproducible results. Omit for random generation |
| Quality | `number` (optional) | -- | Output quality setting (model-dependent) |
| Enhance Audio | `boolean` | `false` | Post-process the output to improve audio clarity |

## Inputs & Outputs

- **Input**: `in` -- optional upstream connection for dynamic text via field mapping
- **Outputs**:
 - `audio` -- audio preview of the designed voice speaking the preview text (URL)
 - `voiceId` -- the generated voice ID string, reusable in Text to Speech and other voice nodes
## Best Practices

- Use the `eleven_ttv_v3` model for best quality and widest language support. Fall back to `eleven_multilingual_ttv_v2` only if v3 produces unexpected results for a specific use case.
- Keep Guidance Scale at 5 for a good balance. Increase it (toward 20-30) if the voice description is precise and you want the model to follow it closely. Decrease it (toward 1-2) for more natural, less constrained output.
- Set a seed value when you find a voice you like so you can reproduce it later. Without a seed, each run generates a slightly different voice.
- The Preview Text must be 100-1000 characters. Write enough text to hear the voice across different sounds and sentence structures.
- Enable Enhance Audio for final production runs, but leave it off during rapid iteration to save processing time.

## Common Use Cases

- Creating a custom brand voice with reproducible parameters for consistent use across a project
- Designing character voices with specific acoustic properties (loudness, tone, delivery)
- Generating a reusable voice ID to use across multiple Text to Speech nodes
- Fine-tuning voice characteristics through iterative parameter adjustment
- Building a library of custom voices by saving the generated voice IDs

## Tips

- The dual output handles (`audio` and `voiceId`) are what distinguish this node from Voice Remix. The `voiceId` output can be connected to downstream Text to Speech nodes, enabling a design-once-use-many workflow.
- Loudness is relative to the model's default output level. Use it to normalize volume across different generated voices.
- The Guidance Scale behaves similarly to classifier-free guidance in image generation -- very high values can reduce quality while increasing adherence to the description.
- When providing a seed, the same seed + description + model combination should produce the same voice. Changing any parameter may produce a different voice even with the same seed.
- This node uses the ElevenLabs `POST /v1/text-to-voice/design` endpoint directly, not.
