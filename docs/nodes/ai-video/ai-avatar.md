# AI Avatar

> Generate a talking-avatar video from a HeyGen avatar (or a raw image) + voice + script, or wired audio.

## Overview

The AI Avatar node creates a talking-head video using HeyGen. You supply either a text script (HeyGen's built-in TTS delivers the voice) or a pre-recorded audio track. Both paths produce a video of the chosen source speaking the content.

Two **source modes** control where the visual comes from:

| Source | What you provide | Notes |
|--------|-----------------|-------|
| **Avatar** (`avatarSource: avatar`, default) | A HeyGen avatar look picked from the in-node avatar picker | Animated by the Avatar IV / Avatar V engine |
| **Image** (`avatarSource: image`) | A raw image — wired into the node's Image input, pasted as a URL, or uploaded | Animates your own photo/character directly. No avatar creation or training needed, so it works without a higher HeyGen tier. The engine selector is hidden (image mode uses its own engine) |

Both source modes support the same speech modes, voice tuning, background, captions, and motion controls. Image mode is billed identically to Avatar IV (it is IV-class).

Two speech modes:

| Mode | What you provide | Voice |
|------|-----------------|-------|
| **Script + Voice** (`speechMode: text`) | A text script (up to 5,000 characters) and a voice ID picked from the in-node voice picker | HeyGen TTS, driven by the chosen voice and optional voice speed |
| **Wired Audio** (`speechMode: audio`) | An audio file wired to the `audio` input handle | Exactly as recorded — no TTS |

## Selecting an Avatar and Voice

The config panel includes two rich pickers:

- **Avatar picker** — searchable tile grid fed live from the HeyGen API. Filters: Public / Personal / Group. Preview thumbnails show how the avatar looks.
- **Voice picker** (text mode only) — searchable list of all available HeyGen voices with language and accent filters. Click the preview icon to hear a sample before selecting.

Both pickers return empty when HeyGen is not configured for the deployment; an "HeyGen API not configured" notice appears in that case.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Source | Select | `avatar` | `avatar` = HeyGen avatar look; `image` = animate a raw image |
| Speech Mode | Select | `text` | `text` = script + voice; `audio` = wired audio input |
| Avatar | Picker | — | HeyGen avatar ID (required in avatar source mode) |
| Source Image | Image input / URL / Upload | — | Source image (required in image source mode) — wire an image node into the Image input, paste a URL, or upload |
| Script | Textarea | — | Spoken text (required in text mode, max 5,000 chars) |
| Voice | Picker | — | HeyGen voice ID (required in text mode) |
| Voice Speed | Slider | 1.0 | Speaking rate, range 0.5–1.5 (text mode only) |
| Engine | Select | `avatar-iv` | `avatar-iv` = Avatar IV; `avatar-v` = Avatar V (premium). Avatar source mode only — hidden in image source mode |
| Resolution | Select | `720p` | Output resolution: `720p`, `1080p`, `4k` |
| Aspect Ratio | Select | `16:9` | `16:9` (landscape) or `9:16` (portrait / vertical) |
| Captions | Toggle | off | Burn auto-generated captions into the video |

## Inputs & Outputs

**Inputs:**
- Image (optional, required when `avatarSource = image`) — source image to animate (also settable via URL/upload in the config panel)
- Script (optional) — verbatim spoken text wired from a text producer (text mode)
- Audio (optional, required when `speechMode = audio`) — pre-recorded audio track

**Outputs:**
- Generated video URL

## Credit Pricing

Credits are metered by the **actual length** of the generated video. A hold is placed when the job starts; any unused amount is **refunded automatically** when the job completes — so you only pay for the seconds you get.

### Approximate cost

| Engine | 720p | 1080p | 4K |
|--------|-----:|------:|---:|
| Avatar IV | ~3.8 credits/sec | ~5 credits/sec | ~10 credits/sec |
| Avatar V | ~5 credits/sec | ~6.3 credits/sec | ~12.5 credits/sec |

Examples (Avatar IV, 720p): a **30-second** clip ≈ **113 credits**; a **1-minute** clip ≈ **225 credits**. Higher resolutions and Avatar V cost proportionally more. Captions add no extra cost.

> The exact credit cost is shown in the editor before you run, and the final charge always reflects the real clip length.

### Reserve & refund

- **Text mode** — the upfront hold is estimated from your script length and voice speed (slower speech reserves a bit more). You're charged for the actual generated length; the remainder is refunded.
- **Audio mode** — because the clip length isn't known until generation, a larger hold is reserved up front; again, only the real length is charged.

## Graceful Degradation

If HeyGen is not configured for the deployment:
- The avatar picker and voice picker both show empty with an explanatory notice
- Attempting to run the node returns an error: `heygen_not_configured`

## Best Practices

- Use clear, natural-language scripts under 5,000 characters for best TTS quality
- Preview voices in the picker before wiring a long script
- Start with Avatar IV 720p for drafts; upgrade to 1080p or Avatar V for final delivery
- Captions add no extra credit cost

## Common Use Cases

- Product demos with a consistent presenter avatar
- Personalized video messages at scale
- Multilingual spokesperson videos (change script language + matching HeyGen voice)
- News-style or explainer videos

## Tips

- Voice speed below 1.0 increases the estimated reserve bucket (slower speech → longer clip)
- The 9:16 aspect ratio is optimized for TikTok, Instagram Reels, and YouTube Shorts
- Wired-audio mode is useful when you want precise pacing or have a pre-recorded voiceover
- Connect a Text to Speech node upstream to build a fully scripted pipeline that bypasses HeyGen TTS costs
