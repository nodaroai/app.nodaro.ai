# X Post
> Post text, images, and video to X (Twitter).

## Overview
The X Post node publishes content from your workflow directly to a connected X (formerly Twitter) account. It supports text posts with optional image or video attachments. OAuth authentication with PKCE is required via the Integrations page before use.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Action | enum | `"post-tweet"` | Publishing action. Default: `post-tweet`. |
| Caption | string | `""` | Post text content. Maximum 280 characters. |
| Connection | selector | none | Connected X account (configured in Integrations). |

### Content Specifications

| Content Type | Dimensions | Max Duration | Text Limit |
|-------------|-----------|-------------|------------|
| Image Landscape | 1200 x 675 | n/a (image) | 280 chars |
| Image Square | 1080 x 1080 | n/a (image) | 280 chars |
| Video | 1920 x 1080 | 140s | 280 chars |

## Inputs & Outputs

**Inputs:**
- `in` -- Text, image, or video content to publish.

**Outputs:**
None. This is a terminal output node.
## Best Practices
- Keep captions concise -- the 280-character limit is strictly enforced by the platform.
- Use high-contrast images that are legible at small sizes in the X feed.
- Keep videos under 140 seconds for optimal playback.
- Connect your X account on the Integrations page before adding this node.

## Common Use Cases
- Sharing AI-generated images or short videos on X.
- Automating content distribution to X as part of a multi-platform workflow.
- Publishing workflow outputs on a schedule using trigger nodes.

## Tips
- X uses OAuth 2.0 with PKCE for authentication, which is handled automatically during the connection flow.
- The 280-character limit applies to the caption only; media attachments do not count toward this limit.
- OAuth tokens are encrypted at rest using AES-256-GCM.
- One X account can be connected per user.
- For threads or longer content, use the Generate Text node to generate concise summaries that fit within the character limit.
