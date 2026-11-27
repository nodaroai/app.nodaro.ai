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
- `in` -- Text, image, or video content to publish (depending on selected action). When the action posts media, a text wire whose whole value is one link to an image or video file (ending in `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, `.mp4`, `.mov` or `.webm`) is published as that medium, not as the caption; with `post-text`, and for a page link, it stays the text.

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
- Facebook refuses photos of 10 MB or more. A photo larger than 8 MB (a 2K PNG, for example) is converted to a JPEG at quality 90 and its full size before it is posted, and scaled down, keeping its shape, only if it is still larger than 8 MB. Transparent areas become white. Smaller photos are posted unchanged.
- When Facebook refuses a post (a file it cannot read, a missing permission), the node fails with Facebook's own message, and nothing was posted. The node says the post may have been published only when the connection to Facebook was lost or timed out, or Facebook answered with a server error, after the post was sent. Check the Page before running it again.
- OAuth tokens are encrypted at rest using AES-256-GCM.
- One Facebook account can be connected per user.
- The `post-story` action creates ephemeral content that disappears after 24 hours.
