# Describe Image (Image to Text)
> Extract a text description from an image using Claude Sonnet vision, with configurable detail levels.

## Overview

Describe Image (internally `image-to-text`) analyzes an input image using Claude Sonnet's multimodal vision capability and produces a text description. It supports three detail levels (brief, detailed, structured) and an optional custom prompt for specialized descriptions. This is a sync HTTP node -- it calls the Anthropic API directly rather than queuing a BullMQ job. The output is text, not an image.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Detail Level | select | `"detailed"` | Controls description depth: `brief` (1-2 sentences), `detailed` (3-6 sentences, flowing prose), `structured` (labeled sections: Subject, Setting, Colors, Lighting, Mood, Details) |
| Custom Prompt | text | `""` | Optional override for the system prompt. When provided, replaces the default detail-level prompt entirely. Max 2000 characters. |

## Inputs & Outputs

**Inputs:**
- `image` -- source image from an upstream node (Upload Image, Generate Image, Edit Image, etc.) or a direct URL

**Outputs:**
- `text` -- generated text description

## Credit Cost

| Provider | Credits | Notes |
|----------|---------|-------|
| Claude Sonnet (Anthropic) | 5 | Fixed cost, single provider |

## Supported Providers

This node uses Claude Sonnet exclusively via the Anthropic API. There is no provider selection -- the model is fixed.

## Best Practices

- Use "brief" detail level when the description feeds into a downstream prompt that has its own context (e.g., as input to a script generator).
- Use "structured" detail level when you need machine-parseable categories (Subject, Setting, Colors, Lighting, Mood, Details).
- Use "detailed" for general-purpose flowing descriptions suitable for captions or alt text.
- Write a custom prompt when you need domain-specific analysis (e.g., "Describe the fashion items in this image including brand indicators, colors, and materials").

## Common Use Cases

- Auto-captioning generated images for accessibility or social media posting.
- Extracting prompts from existing artwork to reverse-engineer generation parameters.
- Analyzing reference images to generate structured descriptions for downstream AI nodes.
- Creating alt text for images in automated content pipelines.
- Feeding image descriptions into AI Writer or Generate Script nodes for image-driven storytelling.

## Tips

- The custom prompt field completely replaces the system prompt when provided. If you want to extend the default behavior rather than replace it, include the original instructions in your custom prompt.
- This node outputs text (not an image), so it connects to text-consuming nodes downstream (Text Prompt, AI Writer, Generate Script, Combine Text, etc.) via the `text` output handle.
- Results include a history of generated descriptions (`generatedResults` array) with job IDs and timestamps, accessible via the result navigation in the config panel.
