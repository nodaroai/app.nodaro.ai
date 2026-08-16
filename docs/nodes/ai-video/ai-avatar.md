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
| **Wired Audio** (`speechMode: audio`) | An audio file wired to the `audio` input handle | Exactly as recorded — no TTS. Audio inputs are capped at 10 minutes (600s); longer audio is automatically trimmed to 600s (you'll see a notice on the result) |

## On the canvas

The node card itself walks you through the setup — you rarely need the settings panel for a first run. It has three looks:

| State | What the card shows |
|-------|---------------------|
| **Empty** (no avatar yet) | **Start with an avatar** — a row of featured looks (one per presenter) you can pick right on the card, a **search box** that filters the whole catalog in place (the same search as the settings panel; results scroll, five per row), a **Browse all N ›** link that opens the full catalog with gender / type / Avatar-V filters in the settings panel, and **Use an image instead** to animate your own portrait. In image mode the same spot becomes **Start with an image** — an upload zone (or wire an image into the Image input / paste a URL in settings) plus **Choose an avatar** to go back to the catalog. |
| **Configured** (avatar or image set, no video yet) | Left: the portrait with an engine badge (`AVATAR IV` / `AVATAR V`, or `SOURCE IMAGE`), the look's name and gender, and **Change avatar** (reopens the featured row with the current look highlighted; ✕ keeps it) or **Replace image**. Right: the **voice** strip (name, language · gender, a preview play button — click the voice to open the full voice picker right there, with search, language / gender filters and previews) and the **script**, editable in place with a live `chars · ~duration` estimate. When the Script input is wired, the card shows the incoming text read-only and says which node it comes from. In Wired Audio mode the right side shows the audio connection status instead of voice + script. |
| **Generated** (a video exists) | The video result with the usual hover controls (versions, fullscreen, download, copy URL, NodarCut, settings). Every *action* lives in the bottom strip: **Run** makes another version (it lands on top of the earlier ones — the versions badge counts them), and **New run** hides the results and brings the setup card back so you can start fresh (pick another look, change the voice or the text) — nothing runs; a second click on New run restores the results exactly as they were. Starting a run (from the strip) always returns to the result view. |
| **Failed** | Nothing earlier to show: the configured card stays editable and its status bar turns red with the error — retry with the strip's **Run**. An earlier version on show: it stays, a red banner over the video names the failure, and **New run** / **Run** in the strip work as above. Earlier versions are never touched by a retry. |

A **status bar** at the bottom of the card always says whether the node can run and what is still missing — `Ready to run · avatar, voice and script are set` vs `Needs a voice before it can run` — plus the engine and resolution that will render (`HeyGen Avatar IV · 720p`, or `Image animation · 720p` in image mode). The rules are the same ones the Run button enforces: text mode needs a script (typed or wired) **and** a voice; audio mode needs wired audio; avatar mode needs an avatar; image mode needs an image (uploaded, pasted or wired). A wired input counts as satisfied even before it has produced anything.

Picking a look on the card writes exactly what the settings-panel picker writes (avatar id, name, preview, Avatar V support, the look's default voice when you have not chosen one, and the aspect ratio that matches its orientation). On an install without a HeyGen key, the featured row shows the same "Add a HeyGen key or connect nodaro.ai…" notice as the pickers; a workflow authored elsewhere still shows its configured avatar and voice from the node's own data.

## Selecting an Avatar and Voice

The config panel includes two rich pickers:

- **Avatar picker** — searchable tile grid fed live from the HeyGen API. Filters: Public / Personal / Group. Preview thumbnails show how the avatar looks.
- **Voice picker** (text mode only) — searchable list of all available HeyGen voices with language and accent filters. Click the preview icon to hear a sample before selecting.

Both pickers return empty when HeyGen is not configured for the deployment; an "HeyGen API not configured" notice appears in that case.

**The catalogs load progressively.** HeyGen serves its ≈7,000 photo-avatar looks in ≈140 pages (plus ≈2,500 voices in one slow call), and a cold server cache takes about a minute and a half to fill — you never wait for that. The server starts filling at boot, answers with the pages it already has, the pickers (and the on-node quick pick) render them at once, and the counter reads `N avatars · loading more…` until the list is whole. Pick as soon as you see what you want; the rest keeps arriving behind it — and only the *new* pages cross the wire on each poll (the browser asks for what it does not have yet), so a big catalog never re-downloads. Once filled, the catalog is served from memory (and refreshed in the background when it goes stale), so later opens are instant.

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
- **Audio mode** — the hold is sized from your uploaded clip's measured length, so a short voiceover reserves only a small amount (a few seconds' worth), not a large flat block. Audio is capped at 10 minutes (600s): a longer clip is automatically trimmed to 600s and the hold is sized at that 10-minute cap. As always, you're charged only for the real generated length and any surplus is refunded.

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
