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
- Video with merged audio

## Credit Cost

0 credits — FFmpeg processing, always free.

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
