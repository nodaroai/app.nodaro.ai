# Reference Audio

> Extract audio from YouTube videos or provide audio via upload/URL.

## Overview

The Reference Audio node provides audio from multiple sources: extract from a YouTube URL, upload a file directly, or enter a direct URL. Includes audio preview playback after successful extraction or upload.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Source | Select | youtube | Source type: YouTube, Upload File, Direct URL |

### Source: YouTube
| Field | Type | Description |
|-------|------|-------------|
| YouTube URL | Text input | Video URL to extract audio from |
| Extract Button | Action | Fetches metadata and extracts audio track |

### Source: Upload File
| Field | Type | Description |
|-------|------|-------------|
| File Input | File upload | Accepts: MP3, WAV, M4A, AAC |

### Source: Direct URL
| Field | Type | Description |
|-------|------|-------------|
| Audio URL | Text input | Direct link to audio file |

## Inputs & Outputs

**Inputs:** None (this is a source node)

**Outputs:**
- Audio URL — extracted or provided audio
## Best Practices

- YouTube extraction includes metadata fetching — verify the correct video before extracting
- Use WAV uploads for highest quality when file size isn't a concern
- Audio preview lets you verify the correct content before running the workflow

## Common Use Cases

- Extract background music from YouTube for reference or dubbing
- Provide audio for voice cloning workflows
- Source audio for Forced Alignment (word-level timestamps)
- Extract narration from video for transcription

## Tips

- Extraction status shows: ready → extracting → complete (or failed)
- If YouTube extraction fails, try the direct URL method with an alternative source
- The audio preview player appears automatically after successful extraction
