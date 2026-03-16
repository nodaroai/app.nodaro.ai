# TikTok Post
> Publish video content directly to TikTok.

## Overview
The TikTok Post node publishes video content from your workflow directly to a connected TikTok account. It handles the upload and posting process through TikTok's API. OAuth authentication is required via the Integrations page before use.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Action | enum | `"post-video"` | Publishing action. Currently: `post-video`. |
| Caption | string | `""` | Post caption text. Maximum 4,000 characters. |
| Connection | selector | none | Connected TikTok account (configured in Integrations). |

### Content Specifications

| Content Type | Dimensions | Max Duration | Text Limit |
|-------------|-----------|-------------|------------|
| Video | 1080 x 1920 | 600s (10 min) | 4,000 chars |

## Inputs & Outputs

**Inputs:**
- `in` -- Video content to publish.

**Outputs:**
None. This is a terminal output node.

## Credit Cost
1 credit per post.

## Best Practices
- Connect your TikTok account on the Integrations page before adding this node.
- Use 9:16 vertical video format (1080x1920) for optimal TikTok display.
- Keep videos under 10 minutes. Shorter content (15--60 seconds) typically performs better on the platform.
- Include relevant hashtags in the caption for discoverability.

## Common Use Cases
- Automatically publishing AI-generated short-form video content.
- Distributing rendered video to TikTok as part of a multi-platform workflow.
- Posting workflow outputs on a schedule using trigger nodes.

## Tips
- TikTok's API processes uploads asynchronously. The node waits for confirmation before marking as complete.
- OAuth tokens are encrypted at rest using AES-256-GCM.
- One TikTok account can be connected per user.
- Combine with other social output nodes (Instagram, YouTube, etc.) to publish the same content across platforms simultaneously.
