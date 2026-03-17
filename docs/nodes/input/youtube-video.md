# Video URL

> Download video or audio from YouTube, TikTok, Instagram, Facebook, or X.

## Overview

The Video URL node imports video content from social media platforms. It auto-detects the platform from the URL, shows a thumbnail preview, and handles platform-specific download flows. YouTube videos stream directly; other platforms require a download step.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| URL | Text input | — | Video URL from supported platform |

Supported platforms: YouTube, Facebook, TikTok, Instagram, X/Twitter.

## Inputs & Outputs

**Inputs:** None (this is a source node)

**Outputs:**
- Video URL — downloaded/streaming video accessible to downstream nodes
- Metadata — title and thumbnail (when available)
## Best Practices

- YouTube videos stream directly without download — fastest option
- Non-YouTube videos require download, which shows progress (downloading → uploading → processing)
- Verify the video is publicly accessible before adding the URL

## Common Use Cases

- Import YouTube videos for processing, effects, or re-editing
- Download TikTok/Instagram content for remix or transformation
- Source reference video for Motion Transfer
- Extract frames from social media video for Image to Video

## Tips

- For audio-only extraction from YouTube, use the Reference Audio node instead
- Download status shows phases: downloading, uploading, processing — wait for completion before running the workflow
- If download fails, verify the URL is public and the platform hasn't restricted access
