# Facebook Post
> Post text, images, video, and stories to Facebook.

## Overview
The Facebook Post node publishes content from your workflow directly to a connected Facebook account. It supports text-only posts, image posts, video posts, and stories. OAuth authentication is required via the Integrations page before use.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Action | enum | `"post-image"` | Publishing action. Options: `post-text`, `post-image`, `post-video`, `post-story`. |
| Caption | string | `""` | Post text content. Maximum 63,206 characters. |
| Connection | selector | none | Connected Facebook account (configured in Integrations). |

### Content Specifications

| Content Type | Dimensions | Max Duration | Text Limit |
|-------------|-----------|-------------|------------|
| Feed Portrait | 1080 x 1350 | n/a (image) | 63,206 chars |
| Reel | 1080 x 1920 | 90s | 63,206 chars |

## Inputs & Outputs

**Inputs:**
- `in` -- Text, image, or video content to publish (depending on selected action).

**Outputs:**
None. This is a terminal output node.
## Best Practices
- Use `post-story` for ephemeral 24-hour content and `post-image`/`post-video` for permanent feed posts.
- Facebook supports very long captions (63,206 characters), but shorter, focused text performs better.
- Use portrait format (1080x1350) for feed images and vertical (1080x1920) for reels and stories.
- Connect your Facebook account on the Integrations page before use.

## Common Use Cases
- Publishing AI-generated content to a Facebook page or profile.
- Sharing video content as Facebook Reels.
- Posting stories for time-limited promotions or announcements.
- Cross-posting workflow outputs alongside other social platforms.

## Tips
- Facebook has the most generous text limit of all supported platforms (63,206 characters).
- Reels are capped at 90 seconds. For longer video content, use the standard `post-video` action.
- OAuth tokens are encrypted at rest using AES-256-GCM.
- One Facebook account can be connected per user.
- The `post-story` action creates ephemeral content that disappears after 24 hours.
