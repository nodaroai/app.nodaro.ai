# Lip Sync

> Sync audio to a character's face to create a talking head video.

## Overview

The Lip Sync node takes a portrait image and an audio track (speech/voiceover) and generates a video where the character's lips move in sync with the audio. Supports optional motion prompts for head and expression movements.

It can also **dub an existing video**: HeyGen Lipsync Precision and Sync Lipsync 2 Pro take a source video plus a replacement audio track and re-animate the lips to match the new speech, billed per second of output.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Provider | Select | kling-avatar | AI model for lip sync |
| Resolution | Select | 720p | Output resolution: 480p or 720p (KIE providers only) |
| Motion Prompt | Textarea | — | Optional: describe head/expression motions (KIE providers only) |

### HeyGen Lipsync Precision options

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Dynamic Duration | Toggle | On | Adjust the output length to match the new audio |
| Remove Music Track | Toggle | Off | Strip background music from the source video |
| Speech Enhancement | Toggle | Off | Improve speech clarity in the output |

### Sync Lipsync 2 Pro options

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Sync Mode | Select | loop | Behavior when audio/video durations differ: `loop`, `bounce`, `cut_off`, `silence`, `remap` |
| Temperature | Slider 0–1 | 0.5 | How expressive the lip sync can be |
| Active Speaker Detection | Toggle | Off | Lip-sync whoever is speaking in the clip |

## Inputs & Outputs

**Inputs:**
- Portrait Image (required for most providers) — clear face photo
- Video (required for HeyGen Lipsync Precision and Sync Lipsync 2 Pro) — the source clip to dub
- Audio (required) — speech or voiceover track

**Outputs:**
- Lip-synced video

> HeyGen Lipsync Precision and Sync Lipsync 2 Pro replace the audio on a **video** input (not a portrait image).

## Audio Length Limits

| Provider | Max input audio |
|----------|-----------------|
| `kling-avatar` (Standard) | 5 minutes |
| `kling-avatar-pro` (Pro) | 5 minutes |
| `infinitalk` | 15 seconds |
| `heygen-lipsync-precision` | 5 minutes* |
| `lipsync-2-pro` | 5 minutes* |

For the KIE providers (`kling-avatar(-pro)`, `infinitalk`), audio longer than the cap is auto-trimmed before the upstream call. Long-audio runs on `kling-avatar(-pro)` can take tens of minutes — the editor polls for up to ~1 hour before timing out.

\* For HeyGen Lipsync Precision and Sync Lipsync 2 Pro the 5-minute figure is the **per-second credit-reservation ceiling**, not a hard trim — longer clips reserve at the 5-minute tier.

## Credit Cost

Kling AI Avatar bills per-second. Credit reservation buckets to the next supported tier; any reserved credits beyond the actual cost are refunded once the job completes.

| Provider | Per-second | 15s | 30s | 1min | 2min | 5min |
|----------|-----------:|----:|----:|-----:|-----:|-----:|
| `kling-avatar` (720p) | 2 CR/s | 30 | 60 | 120 | 240 | 600 |
| `kling-avatar-pro` (1080p) | 4 CR/s | 60 | 120 | 240 | 480 | 1,200 |

HeyGen Lipsync Precision and Sync Lipsync 2 Pro also bill per second of output (priced at cost), bucketed to the same 15s / 30s / 1min / 2min / 5min tiers:

| Provider | Provider cost | 15s | 30s | 1min | 2min | 5min |
|----------|--------------:|----:|----:|-----:|-----:|-----:|
| `heygen-lipsync-precision` | $0.0667/s | 51 | 101 | 201 | 401 | 1,001 |
| `lipsync-2-pro` | $0.08325/s | 63 | 125 | 250 | 500 | 1,249 |

The credit chip updates once the audio is wired (the node probes its duration). When the duration is unknown, the 5-minute tier is reserved.

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
