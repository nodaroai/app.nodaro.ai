# Aspect Ratio
> Set the aspect ratio of connected video generation nodes.

## Overview

The Aspect Ratio parameter node provides a standardized aspect ratio value that can be wired into downstream generation nodes. It supports the five most common aspect ratios used in content creation. Wired into a video generation node's **Settings** input, it overrides that node's own aspect ratio, enabling centralized control across multiple nodes in a workflow.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Ratio | select | `"16:9"` | Target aspect ratio. Options: `16:9` (landscape), `9:16` (portrait), `1:1` (square), `4:3`, `4:5` |

## Inputs & Outputs

**Inputs:**
- `in` -- optional upstream input (rarely used; Aspect Ratio is typically a root parameter node)

**Outputs:**
- `ratio` -- aspect ratio string (e.g., `"16:9"`). Connect it to the **Settings** input of [Generate Video](../ai-video/generate-video.md#settings-input) or [Generate Video Pro](../ai-video/generate-video-pro.md); it replaces the node's own aspect ratio at run time. Generate Image takes its aspect ratio from its own settings.
## Supported Providers

Not applicable. This is a data-passing parameter node with no AI provider.

## Best Practices

- Use 16:9 for YouTube, desktop, and widescreen content.
- Use 9:16 for Instagram Reels, TikTok, YouTube Shorts, and other vertical mobile-first formats.
- Use 1:1 for Instagram feed posts and square social media content.
- Use 4:5 for Instagram feed posts that maximize vertical space within the feed.
- Use one Aspect Ratio node connected to all generation nodes to ensure consistent dimensions across a multi-node workflow.

## Common Use Cases

- Ensuring all generated images in a storyboard share the same aspect ratio for consistent video composition.
- Quickly switching an entire workflow between landscape (16:9) and portrait (9:16) for multi-platform publishing.
- Parameterizing template workflows so users select their target platform format upfront.

## Tips

- Not every model renders every ratio. A ratio the model doesn't render runs as the nearest one it does (`4:5` on Seedance 2 runs as `3:4`; the node's chips show the ratio it runs with). Check the Generate Video documentation for each model's ratios.
- The Aspect Ratio parameter node offers a simplified set of 5 ratios. Individual generation nodes may support additional ratios (e.g., 21:9 ultra-wide, 3:2, 2:3) through their own config panels.
