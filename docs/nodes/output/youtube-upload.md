# YouTube Upload
> Upload videos and Shorts to YouTube with full metadata control.

## Overview
The YouTube Upload node uploads video content from your workflow to a connected YouTube channel. It supports both standard video uploads and YouTube Shorts, with full control over title, description, tags, and privacy settings. OAuth authentication is required via the Integrations page before use.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Action | enum | `"upload-video"` | Upload type. Options: `upload-video`, `upload-short`. |
| Title | string | `""` | Video title. Maximum 100 characters. |
| Description | string | `""` | Video description. Maximum 5,000 characters. |
| Tags | string[] | `[]` | Video tags for search and discovery. |
| Privacy | enum | `"private"` | Visibility setting. Options: `private`, `unlisted`, `public`. |
| Caption | string | `""` | Additional caption text. Maximum 5,000 characters. |
| Connection | selector | none | Connected YouTube account (configured in Integrations). |

### Content Specifications

| Content Type | Dimensions | Max Duration | Text Limit |
|-------------|-----------|-------------|------------|
| Short | 1080 x 1920 | 180s (3 min) | 5,000 chars |

## Inputs & Outputs

**Inputs:**
- `in` -- Video content to upload.

**Outputs:**
None. This is a terminal output node.
## Best Practices
- Start with `private` privacy and change to `public` after reviewing the uploaded content on YouTube.
- Write descriptive titles under 100 characters and use the description field for detailed content.
- Add relevant tags to improve discoverability in YouTube search.
- Use `upload-short` for vertical content under 60 seconds intended for the Shorts feed.

## Common Use Cases
- Uploading rendered long-form video content to a YouTube channel.
- Publishing AI-generated Shorts from vertical video workflows.
- Scheduling automated uploads from trigger-driven workflows.
- Distributing content across YouTube alongside other social platforms.

## Tips
- Videos upload as `private` by default. This is a safety measure to prevent accidental public publication.
- YouTube Shorts should be vertical (9:16) and under 60 seconds for optimal placement in the Shorts feed, though the API accepts up to 180 seconds.
- OAuth tokens are encrypted at rest using AES-256-GCM.
- The upload process is asynchronous. The node polls for completion before marking as done.
- One YouTube account can be connected per user.
