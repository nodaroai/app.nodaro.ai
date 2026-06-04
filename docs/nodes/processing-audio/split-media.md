# Split into Chunks

> Split a video or audio file into equal-duration chunks for batch processing.

## Overview

The Split into Chunks node divides a video or audio file into a series of fixed-duration segments. Each chunk is output as a separate audio file (and, when a video is split, as a separate video clip). Use it to break long recordings into manageable pieces before transcription, translation, or per-clip generation.

## When to Use

- Split a long podcast or interview before feeding each segment to Transcribe
- Divide a long video into scene-length clips for parallel processing
- Break up an audio file into equal parts for dubbing or Voice Changer

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Chunk Duration | number (seconds) | 10 | Length of each chunk in seconds (minimum 1) |
| Audio Format | select | `mp3` | Output container for audio chunks: `MP3`, `WAV`, or `AAC` |
| Output Chunk | select (post-run) | 0 | Which chunk index to pass to downstream nodes (0-based). Visible after a successful run. |

## Inputs & Outputs

**Inputs:**
- `video-in` — a video file to split
- `audio-in` — an audio file to split

At least one input is required. Connecting both will split the audio from the video and the video independently.

**Outputs:**
- `video-out` — the selected video chunk (when a video input is connected)
- `audio-out` — the selected audio chunk

After execution, a chunk selector appears in the config panel so you can choose which chunk flows to downstream nodes.

## Pricing

2 credits per execution.

## Common Use Cases

- Batch transcription: split a 60-minute recording into 10-minute chunks, then fan-out to Transcribe nodes in parallel
- Long-form dubbing: split a video, dub each segment, then recombine with Combine Videos
- Per-scene video generation: break source footage into 5-second clips for independent transformation

## Tips

- Use a List node driven by chunk count to iterate all chunks automatically.
- The chunk selector in the config panel only affects which chunk is passed when you wire `video-out` or `audio-out` to a downstream node; all chunks are still available in the result panel for download.
- WAV output preserves lossless quality; use AAC for smaller files on mobile delivery pipelines.
