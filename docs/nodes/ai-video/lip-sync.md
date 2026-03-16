# Lip Sync

> Sync audio to a character's face to create a talking head video.

## Overview

The Lip Sync node takes a portrait image and an audio track (speech/voiceover) and generates a video where the character's lips move in sync with the audio. Supports optional motion prompts for head and expression movements.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Provider | Select | kling-avatar | AI model for lip sync |
| Resolution | Select | 720p | Output resolution: 480p or 720p |
| Motion Prompt | Textarea | — | Optional: describe head/expression motions |

## Inputs & Outputs

**Inputs:**
- Portrait Image (required) — clear face photo
- Audio (required) — speech or voiceover track

**Outputs:**
- Lip-synced video

## Credit Cost

| Provider | Credits | Notes |
|----------|---------|-------|
| kling-avatar | 28 | Standard quality |
| hailuo-avatar | 19 | — |
| infinitalk | 32 | — |
| kling-avatar-pro | 56 | Premium quality |

## Best Practices

- Use a clear, front-facing portrait for best lip sync accuracy
- Ensure audio is clean speech without background music or noise — use Voice Extractor first if needed
- Keep audio under 30 seconds for optimal results
- Motion prompts like "slight head nods" or "expressive eyebrows" add realism

## Common Use Cases

- Create talking head videos from a single photo
- Generate spokesperson videos for product demos
- Animate AI-generated character portraits with voiceover
- Create multilingual video versions by lip-syncing translated audio

## Tips

- Connect a Text to Speech node upstream for a fully automated text-to-talking-head pipeline
- Use kling-avatar (28cr) for standard quality; upgrade to kling-avatar-pro (56cr) for important deliverables
- Portrait quality matters more than resolution — a sharp 720p face photo works better than a blurry 4K image
