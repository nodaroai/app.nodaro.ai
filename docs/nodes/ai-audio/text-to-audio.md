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

## Credit Cost

Text to Audio is priced by the length of audio you ask for: **1 credit per second**.

```
credits = ceil(duration in seconds)        (duration 0.5–30 s)
credits = 5                                (no duration set)
```

- The duration is rounded **up** to whole seconds, so 0.5 s costs the same as 1 s and 22.3 s costs the same as 23 s.
- A request that sets no duration (API or MCP `text_to_audio` without `duration`) lets the engine pick the length and is billed as **5 seconds**.
- Each length has its own price row, `elevenlabs-sfx:<n>s` (`elevenlabs-sfx:1s` … `elevenlabs-sfx:30s`). The editor's cost badge, a single-node run, a run inside a workflow, and API / MCP / SDK calls all charge the same row for the same duration, and the amount reserved when the job starts is the amount charged.

Worked examples:

| Duration | Billed as | Credits |
|----------|-----------|--------:|
| 0.5 s | 1 s | 1 |
| 3 s | 3 s | 3 |
| 6 s | 6 s | 6 |
| 10 s (node default) | 10 s | 10 |
| 22 s (built-in ambience presets) | 22 s | 22 |
| 22.3 s | 23 s | 23 |
| 30 s (maximum) | 30 s | 30 |
| not set | 5 s | 5 |

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
- Duration sets the price: you pay per second asked for (see **Credit Cost**), so ask for the length you need rather than trimming a longer clip afterwards.
- Seamless loop mode works best with continuous, ambient-style sounds rather than discrete one-shot effects.
- This node is specifically for non-speech audio. For spoken audio, use the Text to Speech node instead.
