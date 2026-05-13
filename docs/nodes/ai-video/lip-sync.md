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

## Audio Length Limits

| Provider | Max input audio |
|----------|-----------------|
| `kling-avatar` (Standard) | 5 minutes |
| `kling-avatar-pro` (Pro) | 5 minutes |
| `infinitalk` | 15 seconds |

Audio longer than the provider's cap is auto-trimmed before the upstream call. Long-audio runs on `kling-avatar(-pro)` can take tens of minutes — the editor polls for up to ~1 hour before timing out.

## Credit Cost

Kling AI Avatar bills per-second. Credit reservation buckets to the next supported tier; any reserved credits beyond the actual cost are refunded once the job completes.

| Provider | Per-second | 15s | 30s | 1min | 2min | 5min |
|----------|-----------:|----:|----:|-----:|-----:|-----:|
| `kling-avatar` (720p) | 2 CR/s | 30 | 60 | 120 | 240 | 600 |
| `kling-avatar-pro` (1080p) | 4 CR/s | 60 | 120 | 240 | 480 | 1,200 |

InfiniTalk and Hailuo Avatar use flat per-call pricing (see admin → Models).

## Best Practices

- Use a clear, front-facing portrait for best lip sync accuracy
- Ensure audio is clean speech without background music or noise — use Voice Extractor first if needed
- Motion prompts like "slight head nods" or "expressive eyebrows" add realism

## Common Use Cases

- Create talking head videos from a single photo
- Generate spokesperson videos for product demos
- Animate AI-generated character portraits with voiceover
- Create multilingual video versions by lip-syncing translated audio

## Tips

- Connect a Text to Speech node upstream for a fully automated text-to-talking-head pipeline
- Per-second pricing means short clips are cheap — the legacy 14s assumption no longer applies. Watch the editor's credit chip; it updates once the audio is wired.
- Portrait quality matters more than resolution — a sharp 720p face photo works better than a blurry 4K image
