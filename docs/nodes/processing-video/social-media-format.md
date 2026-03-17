# Social Media Format

> Auto-format video for specific platform specifications.

## Overview

The Social Media Format node prepares video for a specific social media platform by applying the correct dimensions, duration limits, and providing a caption field with platform-specific character limits. Includes a live preview widget showing how the content will appear.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Platform | Select | instagram | Target platform |
| Content Type | Select | — | Platform-specific format (video, feed, story, etc.) |
| Resize Method | Select | crop | How to fit: crop, pad, stretch |
| Pad Color | Color picker | #000000 | Background for padding |
| Caption | Textarea | — | Post text with character counter and limit warning |

### Platform Specs

| Platform | Types | Max Caption |
|----------|-------|-------------|
| Instagram | Video, Feed, Story, Carousel | 2,200 chars |
| TikTok | Video | 2,200 chars |
| YouTube | Video, Short | 5,000 chars |
| LinkedIn | Video, Image, Text | 3,000 chars |
| X | Tweet | 280 chars |
| Facebook | Video, Image, Story, Text | 63,206 chars |

The config panel displays exact dimensions, aspect ratio, and maximum duration for each platform/type combination.

## Inputs & Outputs

**Inputs:** Video (required)
**Outputs:** Formatted video + caption text
## Best Practices

- Select the platform and content type first — specs display updates automatically
- Keep an eye on the character counter for caption limits
- Use "crop" resize method for cleanest results on most platforms

## Common Use Cases

- Prepare a single video for multiple platform formats
- Auto-apply correct dimensions for Instagram Reels vs. YouTube Shorts
- Add platform-appropriate captions before publishing

## Tips

- Connect to a social media output node (Instagram Post, TikTok Post, etc.) for automated publishing
- The live preview widget shows approximately how the content will appear on the platform
- For simple resizing without captions, use the Resize Video node instead
