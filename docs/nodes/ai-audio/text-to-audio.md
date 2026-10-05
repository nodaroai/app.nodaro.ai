# Text to Audio
> Generate sound effects and ambient audio from a text description using ElevenLabs SFX.

## Overview

The Text to Audio node creates sound effects, ambient sounds, and audio textures from a natural language prompt. It uses the ElevenLabs SFX model to synthesize audio that matches the description, with control over duration, looping, and how closely the output follows the prompt.

## Engine

| Provider id | Engine | Default |
|-------------|--------|---------|
| `elevenlabs-sfx` | ElevenLabs Sound Effects v2 (`eleven_text_to_sound_v2`) | Yes — used whenever a node, API call or MCP `text_to_audio` call names no provider |

`elevenlabs-sfx` is the only engine offered, and a request without a `provider` runs it. Saved workflows, presets and API calls that already send `elevenlabs-sfx` keep working unchanged.

On a self-hosted install the engine needs `ELEVENLABS_API_KEY` (Install health → Provider keys). Without the key, an install connected to nodaro.ai runs the sound effect through that connection; an install with neither fails the job with a message naming the missing key.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Provider | `string` | `elevenlabs-sfx` | The sound-effect engine (see **Engine** above) |
| Prompt | `string` | `""` | Description of the desired sound effect (max 450 characters) |
| Duration | `number` (0.5-22) | `10` | Length of the generated audio in seconds, in 0.5s increments. The API and MCP accept 0.5–30; leave it out there and the engine picks a length from the prompt |
| Loop | `boolean` | `false` | When enabled, generates audio designed for seamless looping |
| Prompt Influence | `number` (0-1) | `0.3` | How strictly the output follows the prompt. Lower values allow more creative interpretation; higher values produce more literal results |
| `promptPrefix` / `promptSuffix` | text | -- | Optional pre/post text wrapped around the prompt at run time (settings panel → **Pre & post text**; hidden from app users; captured by presets). See [Prompt pre & post text](../../prompt-pre-post-text.md). |

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
