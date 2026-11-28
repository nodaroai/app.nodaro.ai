# Merge Video & Audio

> Combine video with one or more audio tracks.

## Overview

The Merge Video & Audio node takes a video file and one or more audio tracks and combines them into a single output. Use it to add voiceover, background music, sound effects, or any audio to video content.

## Configuration

No additional configuration required. Connect video and audio inputs.

## Inputs & Outputs

**Inputs:**
- Video (required) — source video
- Audio (required) — one or more audio tracks

**Outputs:**
- `video-out` — video with merged audio

> Both inputs must carry real media. If a connection or a field mapping feeds this node something that is not a media URL (a text output wired into the video input, for example), the run is refused **before any credits are reserved**, and the message names the node and quotes the value it got — it no longer fails mid-run as "Invalid URL". The same check covers every media node in a workflow run.
## Source file

When the video connected to this node is a generation result that kept its original file beside its playable copy (an HDR, 10-bit or HEVC video: see [Video originals and previews](../../design/video-original-and-preview.md)), the node reads that original and copies its picture into the result untouched: only the sound is encoded, so a 10-bit or HDR picture stays 10-bit or HDR. The result then keeps that file as its own original beside a browser-safe playable copy, as a generation does (an HDR original's copy is converted to SDR), and both are in the job's output (`originalVideoUrl` beside `videoUrl`). Any other video is merged as before: a picture a browser cannot play is re-encoded to H.264. If the original cannot be downloaded, the node uses the playable copy. The result is never watermarked, as before, and the price is the same either way.

## Best Practices

- Ensure audio and video durations are compatible — audio longer than video is trimmed, shorter audio leaves silence
- Use Mix Audio first if you need to layer multiple audio tracks with volume control
- Place this node after all video processing is complete

## Common Use Cases

- Add AI-generated voiceover to video
- Layer background music onto content
- Combine TTS output with generated video clips
- Add sound effects to silent AI-generated video

## Tips

- For precise audio mixing with volume control per track, use Mix Audio before this node
- If the video already has audio and you want to replace it, this node replaces the original track
