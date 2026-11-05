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
| Content rights box | Checkbox | Confirms the content rights declaration for this link; shown under the link and on the node's card |
| Extract Button | Action | Fetches metadata and extracts audio track; waits for the content rights box |

Extracting the sound fetches the link: an import of it, so it waits for the content rights box ticked for that link. The box stays ticked only for that link and only for this session, and each extraction confirms the declaration anew; a changed declaration unticks it. The node extracts as soon as the box is ticked, on its card or in the panel, so a link written into it by an assistant, an import or a template is handled the same way; Extract fetches again on request. A node saved while it was extracting (a copy of it, a reload) waits for its box again. A run never fetches the link: it reads the extracted file. An upload or a direct link to a file needs no box.

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
- Provide audio for voice-changer workflows
- Source audio for Forced Alignment (word-level timestamps)
- Extract narration from video for transcription

## Tips

- Extraction status shows: ready → extracting → complete (or failed)
- If YouTube extraction fails, try the direct URL method with an alternative source
- The audio preview player appears automatically after successful extraction
- A YouTube extraction also records the **length** of the extracted audio on the node. [Edit Plan](../processing-video/edit-plan.md) uses it for its cost estimate when this node is the master source; without it Edit Plan estimates at its largest bucket (180 minutes). A node extracted before lengths were recorded picks one up the next time you extract. Uploads and direct links do not record a length.
