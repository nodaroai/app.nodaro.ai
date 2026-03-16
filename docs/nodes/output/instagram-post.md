# Instagram Post
> Publish images, reels, stories, and carousels directly to Instagram.

## Overview
The Instagram Post node publishes content from your workflow directly to a connected Instagram account. It supports multiple content formats including feed images, reels, stories, and carousels. OAuth authentication is required via the Integrations page before use.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Action | enum | `"post-image"` | Publishing action. Options: `post-image`, `post-reel`, `post-story`, `post-carousel`. |
| Caption | string | `""` | Post caption text. Maximum 2,200 characters. |
| Connection | selector | none | Connected Instagram account (configured in Integrations). |

### Content Specifications

| Content Type | Dimensions | Max Duration | Text Limit |
|-------------|-----------|-------------|------------|
| Feed Square | 1080 x 1080 | 60s | 2,200 chars |
| Feed Portrait | 1080 x 1350 | 60s | 2,200 chars |
| Feed Landscape | 1080 x 566 | 60s | 2,200 chars |
| Story / Reel | 1080 x 1920 | 180s | 2,200 chars |

## Inputs & Outputs

**Inputs:**
- `in` -- Image or video content to publish.

**Outputs:**
None. This is a terminal output node.

## Credit Cost
1 credit per post.

## Best Practices
- Connect your Instagram account on the Integrations page before adding this node.
- Match your upstream content dimensions to Instagram's recommended specs for the chosen action.
- Keep captions under 2,200 characters. Include relevant hashtags for discoverability.
- Use 9:16 aspect ratio for reels and stories, 1:1 for feed squares.

## Common Use Cases
- Automatically posting AI-generated images to an Instagram feed.
- Publishing rendered video as Instagram Reels.
- Scheduling carousel posts from a batch image generation workflow.
- Distributing content across multiple platforms by combining with other social output nodes.

## Tips
- The Instagram API requires a connected Business or Creator account. Personal accounts are not supported.
- OAuth tokens are encrypted at rest using AES-256-GCM.
- One Instagram account can be connected per user. Reconnect on the Integrations page if the token expires.
- The `platformPostUrl` field is populated after successful publication, providing a direct link to the posted content.
