# LinkedIn Post
> Post text, images, and video to LinkedIn.

## Overview
The LinkedIn Post node publishes content from your workflow directly to a connected LinkedIn account. It supports text-only posts, image posts, and video posts. OAuth authentication is required via the Integrations page before use.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Action | enum | `"post-image"` | Publishing action. Options: `post-text`, `post-image`, `post-video`. |
| Caption | string | `""` | Post text content. Maximum 3,000 characters. |
| Connection | selector | none | Connected LinkedIn account (configured in Integrations). |

### Content Specifications

| Content Type | Dimensions | Max Duration | Text Limit |
|-------------|-----------|-------------|------------|
| Image Landscape | 1200 x 627 | n/a (image) | 3,000 chars |
| Image Square | 1080 x 1080 | n/a (image) | 3,000 chars |
| Video | 1920 x 1080 | 600s (10 min) | 3,000 chars |

## Inputs & Outputs

**Inputs:**
- `in` -- Text, image, or video content to publish (depending on selected action).

**Outputs:**
None. This is a terminal output node.

## Credit Cost
1 credit per post.

## Best Practices
- Use `post-text` for text-only updates and `post-image` or `post-video` when media is available.
- Keep captions professional and under 3,000 characters.
- Use landscape format (1200x627) for images, as it displays best in the LinkedIn feed.
- Connect your LinkedIn account on the Integrations page before use.

## Common Use Cases
- Sharing AI-generated content or insights on LinkedIn.
- Publishing video content to a professional audience.
- Automating thought-leadership content distribution.
- Cross-posting workflow outputs alongside other social platforms.

## Tips
- LinkedIn supports three distinct actions (text, image, video), unlike platforms that combine media types.
- OAuth tokens are encrypted at rest using AES-256-GCM.
- One LinkedIn account can be connected per user.
- For best engagement, pair media posts with compelling caption text rather than relying on the visual alone.
