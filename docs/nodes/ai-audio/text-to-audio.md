# Text to Audio
> Generate sound effects and ambient audio from a text description using ElevenLabs SFX.

## Overview

The Text to Audio node creates sound effects, ambient sounds, and audio textures from a natural language prompt. It uses the ElevenLabs SFX model to synthesize audio that matches the description, with control over duration, looping, and how closely the output follows the prompt.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Prompt | `string` | `""` | Description of the desired sound effect (max 450 characters) |
| Duration | `number` (0.5-22) | `10` | Length of the generated audio in seconds, in 0.5s increments |
| Loop | `boolean` | `false` | When enabled, generates audio designed for seamless looping |
| Prompt Influence | `number` (0-1) | `0.3` | How strictly the output follows the prompt. Lower values allow more creative interpretation; higher values produce more literal results |

## Inputs & Outputs

- **Input**: `in` -- optional text input that can feed the prompt field via field mapping
- **Output**: `audio` -- generated sound effect audio file (URL)
## Best Practices

- Keep prompts concise and descriptive -- focus on the sound itself rather than the context (e.g., "heavy rain on a tin roof" rather than "it was a stormy night").
- Use the Loop option for background ambience that needs to play continuously (e.g., wind, rain, crowd murmur).
- Start with a low Prompt Influence (0.2-0.4) for more natural-sounding results, and increase it only if the output drifts too far from the description.
- For layered soundscapes, generate individual elements separately and combine them with the Mix Audio processing node.

## Common Use Cases

- Creating sound effects for video projects (footsteps, doors, impacts)
- Generating ambient backgrounds (forest, city, ocean)
- Producing UI/notification sounds
- Making seamless looping audio beds for podcasts or videos
- Synthesizing specific sound textures for motion graphics

## Tips

- The 450-character prompt limit encourages focused descriptions. If you need a complex soundscape, generate individual layers and mix them.
- Duration does not affect the per-generation cost -- the output length is controlled by the Duration parameter regardless.
- Seamless loop mode works best with continuous, ambient-style sounds rather than discrete one-shot effects.
- This node is specifically for non-speech audio. For spoken audio, use the Text to Speech node instead.
