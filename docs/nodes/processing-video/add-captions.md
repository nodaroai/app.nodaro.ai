# Add Captions

> Generate and overlay captions on video.

## Overview

The Add Captions node automatically generates captions from video audio and overlays them on the video. Choose between subtitle, word-highlight, or karaoke styles with customizable position, font size, and color.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Style | Select | subtitle | Caption display style |
| Position | Select | bottom | Where captions appear |
| Font Size | Number | 24 | Text size in pixels (8-72) |
| Color | Color picker | #FFFFFF | Caption text color |

### Caption Styles

- **subtitle** — Standard subtitle appearance
- **word-highlight** — Highlights the current word being spoken
- **karaoke** — Karaoke-style progressive highlighting

### Position Options

- **bottom** — Lower third of the frame (most common)
- **top** — Upper portion of the frame
- **center** — Middle of the frame

## Inputs & Outputs

**Inputs:** Video with audio (required)
**Outputs:** Video with burned-in captions
## Best Practices

- Use "subtitle" style for professional content
- Use "word-highlight" for social media content (increases engagement)
- Place captions at the bottom for landscape video, center for portrait/social
- Choose a font size appropriate for the output resolution (larger for 480p, standard for 1080p)

## Common Use Cases

- Add subtitles to talking head or narration videos
- Create engaging social media videos with word-by-word highlights
- Add accessibility captions to any video content
- Generate karaoke-style lyrics over music videos

## Tips

- Captions are auto-generated from the video's audio track — ensure audio is clear
- For more precise captions, use Transcribe first, edit the text, then use Forced Alignment
- White text with a dark video background is most readable; use colored text for light backgrounds
