# Trim Audio

> Extract a section of audio or extract audio from video.

## Overview

The Trim Audio node extracts a time range from an audio file or extracts the audio track from a video. Supports output in MP3, WAV, or AAC formats. Optionally outputs a silent version of the source video.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Audio Format | Select | MP3 | Output format: MP3, WAV, AAC |
| Output Silent Video | Boolean | false | Also output a muted copy of the source video |
| Start Time | Number | — | Start position in seconds (optional) |
| End Time | Number | — | End position in seconds (optional) |

## Inputs & Outputs

**Inputs:** Audio or Video (required)

**Outputs:**
- Trimmed audio file
- Silent video (if enabled)

## Credit Cost

0 credits — FFmpeg processing, always free.

## Best Practices

- Use WAV for highest quality when feeding into AI nodes (voice cloning, forced alignment)
- Use MP3 for smaller file sizes when quality isn't critical
- Leave start/end empty to extract the full audio track from a video

## Common Use Cases

- Extract a specific section of a podcast or music track
- Pull the audio track from a video for transcription
- Isolate a voice segment for voice cloning or processing
- Get audio from uploaded video for dubbing or remix

## Tips

- "Output Silent Video" is useful when you want to process audio separately and re-merge later
- When both start and end are omitted, the full audio is extracted
