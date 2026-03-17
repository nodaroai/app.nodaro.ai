# Text to Dialogue
> Generate multi-speaker dialogue audio where each line is spoken by a different voice.

## Overview

The Text to Dialogue node uses ElevenLabs Dialogue V3 to produce a single audio file containing multiple speakers. Each line of dialogue is assigned a different voice, and the output is a cohesive conversational audio track. This is ideal for creating conversations, interviews, or any scenario requiring distinct speakers without manually generating and stitching individual TTS clips.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Dialogue Lines | `DialogueLine[]` | `[{ text: "", voice: "Sarah" }]` | Array of dialogue entries, each with text content and a voice selection. Add or remove lines as needed |
| Stability | `number` (select: 0, 0.5, 1.0) | `0.5` | Voice consistency across the dialogue. 0 = most expressive, 1.0 = most consistent |
| Language | `string` | `""` (auto-detect) | Target language code, or empty for automatic detection. Uses the full language list (`ALL_LANGUAGES`) |

### DialogueLine Fields

| Field | Type | Description |
|-------|------|-------------|
| id | `string` | Unique identifier for the line |
| text | `string` | The spoken text for this line |
| voice | `string` | Voice ID for this line's speaker |
| voiceLabel | `string` (optional) | Display name of the selected voice |

## Inputs & Outputs

- **Input**: `in` -- optional upstream connection (not typically used; dialogue is configured directly in the panel)
- **Output**: `audio` -- single audio file containing all dialogue lines spoken in sequence (URL)
## Best Practices

- Assign distinct voices to each speaker to make the conversation easy to follow. Use the Voice Browser to preview voices before assigning them.
- Keep individual lines at a natural conversational length -- avoid putting entire paragraphs into a single dialogue entry.
- Use Stability at 0.5 for natural-sounding conversation. Lower it for more dramatic or emotional dialogue, raise it for formal or narration-like delivery.
- The 5000-character total limit applies across all lines combined. Plan longer dialogues by splitting them across multiple Text to Dialogue nodes if needed.

## Common Use Cases

- Creating podcast-style conversations between two or more speakers
- Generating interview audio with distinct host and guest voices
- Producing dialogue tracks for animated videos or explainers
- Building conversational demos or audio prototypes
- Creating audiobook dialogue scenes with character voices

## Tips

- Each dialogue line can use a different voice from the full ElevenLabs voice library, including premade and custom voices.
- The voices are selected from a curated set of 20 dialogue-compatible voices (`DIALOGUE_VOICE_IDS`), ensuring high quality multi-speaker output.
- The output is a single continuous audio file, not separate clips per line. If you need individual clips, use separate Text to Speech nodes instead.
- Language auto-detection works well for monolingual dialogues. For multilingual conversations, explicitly set the language to the primary language being used.
- Stability is presented as a dropdown (0, 0.5, 1.0) rather than a continuous slider, matching the three modes that produce the best results with the Dialogue V3 model.
