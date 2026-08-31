# Dubbing
> Translate spoken audio — or a whole video — into another language while preserving each speaker's voice and identity.

## Overview

The Dubbing node uses ElevenLabs Dubbing to translate media from one language to another, preserving each speaker's voice characteristics. It is dual-mode:

- **Audio in → dubbed audio out** (the classic mode).
- **Video in → dubbed VIDEO out**, plus the dubbed audio track on the audio output handle. The dubbed clip keeps the original visuals with the translated dialogue.
- **Source link** — instead of wiring an input, paste a public link (YouTube, TikTok, or a direct media URL) in the panel. ElevenLabs fetches the link itself; the file never passes through Nodaro's servers. The result mode (audio/video) follows what the link points at.

The process is asynchronous — the node submits the dubbing job, polls for completion, and returns the translated media when ready. Long sources are delivered by the platform's background recovery lane; the job completes even if it outlives the initial polling window.

## Limits & Pricing

| | |
|---|---|
| Maximum dubbed span | **30 minutes** — for longer sources, set a Start/End window to dub part of the file |
| Maximum uploaded file size | 500 MB (source links are exempt — ElevenLabs fetches those directly) |
| Price | **40 credits per minute** of the dubbed span, minimum 1 minute |

The dubbed span is the Start/End window when set, otherwise the whole source. When the duration cannot be determined up front (source links, probe failures), a 2-minute reserve (80 credits) is held and the real duration is verified against the 30-minute cap once ElevenLabs probes the media.

**Worked examples** (matching the platform's pricing tests):
- A 60-second clip → 1 minute → **40 credits**.
- A typical 2-minute clip → **80 credits** (exactly the old flat price).
- A 10-minute video → **400 credits**.
- A 45-minute video with a window of 0:00–10:00 → the window is the span → **400 credits** (without the window the request is rejected at 30+ minutes).

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Target Language | `string` | `"es"` | Language code for the desired output language (required) |
| Source Language | `string` (optional) | auto-detect | Language code of the input audio. Leave empty for automatic detection |
| Source Link | `string` (optional) | — | Public YouTube/TikTok/direct URL — ElevenLabs fetches it directly. Overrides any wired input |
| Start / End (sec) | `number` (optional) | whole source | Dub only this window of the source |
| Number of Speakers | `number` (0-20, optional) | 0 = auto | Number of distinct speakers in the input; 0 or empty = auto-detect |
| Native voice | `boolean` | `false` | By default the dub **clones the original speaker** — they speak the target language with their own voice and accent. Enable to use a similar **native-sounding Voice Library voice** instead (clean target-language accent) |
| Drop background audio | `boolean` | `false` | Remove background audio from the final dub — improves quality for speech-only sources (speeches, monologues, voiceovers) |
| Keep source resolution | `boolean` | `false` | Render video dubs at the source's original resolution (slower) |
| Profanity filter | `boolean` | `false` | Apply ElevenLabs' profanity filter to the dubbed speech |
| Target Accent | `string` (optional) | — | Experimental: steer the dubbed voices toward an accent |

### Voice cloning vs native voice

The default mode preserves speaker identity: a Hebrew speaker dubbed to English sounds like *the same person speaking English*, including their accent. If you want the dub to sound like a native target-language speaker instead, enable **Native voice** — ElevenLabs then picks a similar voice from its Voice Library. Note: library voices used this way count toward the workspace's custom-voice slots; if no slots are free the dub fails with an error.

## Inputs & Outputs

- **Inputs**: `audio` — source audio to dub; `video` — source video to dub (video wins when both are wired; a Source Link overrides both)
- **Outputs**: `audio` — the dubbed audio track (URL; always produced); `video` — the dubbed video (URL; video mode only)

The mode is decided by the **media**, not the slot: an audio-only file wired into the video input is dubbed as audio; a video wired into the audio input is treated as a request for audio.

## Best Practices

- Explicitly set the source language when you know it — auto-detection is reliable but specifying it avoids edge cases with accented or mixed-language speech.
- Specify the number of speakers if the input has multiple voices. Auto-detection works but can occasionally merge or split speakers incorrectly.
- Use clean source audio without heavy background music. The model handles moderate background noise, but music overlapping speech degrades quality.
- For sources longer than 30 minutes, dub in windows (Start/End) — each window is its own run and its own per-minute charge.
- Test with shorter clips (or a short window) first before dubbing long media to verify the target language quality meets expectations.

## Common Use Cases

- Localizing podcast episodes or full videos for international audiences
- Dubbing a YouTube/TikTok link into another language without downloading it first
- Creating multilingual versions of training or educational content
- Dubbing interview audio for cross-language content repurposing
- Translating voiceover tracks for marketing videos
