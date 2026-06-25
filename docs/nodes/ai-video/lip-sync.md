# Lip Sync

> Sync audio to a character's face to create a talking head video.

## Overview

The Lip Sync node takes a portrait image and an audio track (speech/voiceover) and generates a video where the character's lips move in sync with the audio. Supports optional motion prompts for head and expression movements.

It can also **dub an existing video**: HeyGen Lipsync Precision, Sync Lipsync 2 Pro, Sync Lipsync v3, and Volcengine Lip Sync take a source video plus a replacement audio track and re-animate the lips to match the new speech, billed per second of output. Volcengine is the cheapest modern dubbing option and the only one with multi-speaker scene detection + speaker ID (basic mode).

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Provider | Select | kling-avatar | AI model for lip sync |
| Resolution | Select | 720p | Output resolution: 480p/720p (most KIE providers); OmniHuman 1.5 is 720p/1080p (default 1080p); only the full `seedance-2` adds **4K** (`seedance-2-fast` up to 1080p, `seedance-2-mini` 480p/720p) |
| Motion Prompt | Textarea | — | Optional: describe head/expression motions (KIE providers only) |

### OmniHuman 1.5 options

`omnihuman-1-5` is ByteDance's premium **prompt-directed** talking avatar (image + audio → performing avatar). It animates people, pets, or anime at any aspect ratio, and uses the motion prompt to direct the performance.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Motion Prompt | Textarea | — | Directs the performance (e.g. "sing confidently into a microphone") |
| Resolution | Select | 1080p | 720p or 1080p (no 480p) |
| Fast Mode | Toggle | Off | Trade some quality for faster generation (`pe_fast_mode`) |
| Seed | Number | -1 | Reproducibility — same seed + inputs → near-identical result. -1 = random |

### Seedance 2 (image + audio avatar)

`seedance-2`, `seedance-2-fast`, and `seedance-2-mini` are also offered on the lip-sync surface. They are ByteDance's multimodal video models, which do native phoneme-level lip sync in 8+ languages when fed an audio track alongside a portrait — routed through the image-to-video provider with the audio passed as `reference_audio_urls` (not the dedicated lip-sync flow). The full `seedance-2` accepts **1080p and 4K** output; `seedance-2-fast` goes up to 1080p and `seedance-2-mini` is 480p/720p. Full controls, durations, and per-second pricing live on the [Generate Video](./generate-video.md) page (e.g. 4K 8s = 416 cr, 1080p 8s = 204 cr). `seedance-2-fast` requires each reference audio clip to be ≤ 15.2 s.

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

### Sync Lipsync v3 options

`sync-lipsync-v3` is the fal.ai-hosted sync.so v3 model. It exposes only the sync-mode lever.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Sync Mode | Select | loop | Behavior when audio/video durations differ: `loop`, `bounce`, `cut_off`, `silence`, `remap` |

### Volcengine Lip Sync options

`volcengine-lipsync` is the KIE-hosted Volcengine video-to-video dubbing model. It re-syncs an existing clip's lips to a new vocal track and is the cheapest modern dubbing option (2 CR/s). Output length follows the audio (the source video is trimmed if longer, looped if shorter).

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Mode | Select | lite | `lite` = single-person frontal, faster · `basic` = complex scenes, enables multi-speaker scene detection + speaker ID |
| Separate vocals | Toggle | Off | Strip background noise from the driving audio |
| Scene detection + speaker ID | Toggle | Off | **Basic mode only** — segment scene cuts and identify who is speaking (multi-speaker clips) |
| Loop video if audio is longer | Toggle | On | **Lite mode only** — loop the source video when the audio runs longer than it |
| Reverse loop | Toggle | Off | **Lite mode only** — ping-pong the loop (requires looping to be on) |
| Template start time | Number (s) | 0 | Where in the source video to start driving the lips (advanced) |

## Inputs & Outputs

**Inputs:**
- Portrait Image (required for most providers) — clear face photo
- Video (required for HeyGen Lipsync Precision, Sync Lipsync 2 Pro, Sync Lipsync v3, and Volcengine Lip Sync) — the source clip to dub
- Audio (required) — speech or voiceover track

**Outputs:**
- Lip-synced video

> HeyGen Lipsync Precision, Sync Lipsync 2 Pro, Sync Lipsync v3, and Volcengine Lip Sync replace the audio on a **video** input (not a portrait image).

## Audio Length Limits

| Provider | Max input audio |
|----------|-----------------|
| `kling-avatar` (Standard) | 5 minutes |
| `kling-avatar-pro` (Pro) | 5 minutes |
| `infinitalk` | 15 seconds |
| `omnihuman-1-5` | 60 seconds |
| `heygen-lipsync-precision` | 5 minutes* |
| `lipsync-2-pro` | 5 minutes* |
| `sync-lipsync-v3` | 5 minutes* |
| `volcengine-lipsync` | 5 minutes |

For the KIE providers (`kling-avatar(-pro)`, `infinitalk`, `volcengine-lipsync`), audio longer than the cap is auto-trimmed before the upstream call. Long-audio runs on `kling-avatar(-pro)` and `volcengine-lipsync` can take tens of minutes — the editor polls for up to ~1 hour before timing out.

\* For HeyGen Lipsync Precision, Sync Lipsync 2 Pro, and Sync Lipsync v3 the 5-minute figure is the **per-second credit-reservation ceiling**, not a hard trim — longer clips reserve at the 5-minute tier.

## Credit Cost

Kling AI Avatar and OmniHuman 1.5 bill per-second. Credit reservation buckets to the next supported tier; any reserved credits beyond the actual cost are refunded once the job completes.

| Provider | Per-second | 15s | 30s | 1min | 2min | 5min |
|----------|-----------:|----:|----:|-----:|-----:|-----:|
| `kling-avatar` (720p) | 2 CR/s | 30 | 60 | 120 | 240 | 600 |
| `kling-avatar-pro` (1080p) | 4 CR/s | 60 | 120 | 240 | 480 | 1,200 |
| `omnihuman-1-5` (720p/1080p) | ~6.75 CR/s | 102 | 203 | 405 | — | — |

`omnihuman-1-5` is capped at 60s of audio (longer is auto-trimmed), so only the 15s / 30s / 60s tiers apply. Resolution (720p vs 1080p) does not change the price.

HeyGen Lipsync Precision, Sync Lipsync 2 Pro, and Sync Lipsync v3 also bill per second of output (priced at cost), bucketed to the same 15s / 30s / 1min / 2min / 5min tiers:

| Provider | Provider cost | 15s | 30s | 1min | 2min | 5min |
|----------|--------------:|----:|----:|-----:|-----:|-----:|
| `volcengine-lipsync` | $0.04/s ($2.40/min) | 30 | 60 | 120 | 240 | 600 |
| `heygen-lipsync-precision` | $0.0667/s | 51 | 101 | 201 | 401 | 1,001 |
| `lipsync-2-pro` | $0.08325/s | 63 | 125 | 250 | 500 | 1,249 |
| `sync-lipsync-v3` | $0.13333/s ($8/min) | 100 | 200 | 400 | 800 | 2,000 |

The credit chip updates once the audio is wired (the node probes its duration). When the duration is unknown, the 5-minute tier is reserved.

> **Supply `audioDurationSec` for accurate pricing.** When calling `sync-lipsync-v3` or `volcengine-lipsync` via API/SDK, pass the output duration in seconds so the reservation buckets to the correct tier. If it is absent, the request is billed at the **5-minute ceiling** (sync-lipsync-v3: 2,000 CR; volcengine-lipsync: 600 CR) with **no refund** — these per-second models commit the reserved bucket verbatim. The editor probes the duration automatically once the audio is wired.

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
