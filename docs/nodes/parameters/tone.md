# Tone
> Define a tone or style modifier text (e.g., "cinematic", "cheerful") to influence connected AI nodes.

## Overview

The Tone parameter node holds a free-text tone descriptor that can be wired into downstream AI nodes such as Generate Script, Generate Image, or AI Writer. It provides a reusable, centralized way to control the emotional or stylistic tone of generated content across multiple nodes in a workflow without duplicating instructions in each prompt.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Tone | text | `""` | Free-text tone descriptor. Examples: "cinematic", "cheerful", "dark and moody", "corporate professional", "whimsical children's story" |

## Inputs & Outputs

**Inputs:**
- `in` -- optional upstream text input (can be used to dynamically set tone)

**Outputs:**
- `tone` -- tone text string, consumed by downstream AI nodes

## Credit Cost

| Cost | Notes |
|------|-------|
| 0 credits | Parameter nodes are free -- they only pass data, no AI processing |

## Supported Providers

Not applicable. This is a data-passing parameter node with no AI provider.

## Best Practices

- Keep tone descriptions concise but descriptive: "warm, nostalgic, golden-hour lighting" is more effective than a single word like "warm".
- Use one Tone node per workflow and connect it to all AI generation nodes that should share the same tone for visual/textual consistency.
- Combine with Style Guide for more granular control: Tone handles emotional quality while Style Guide handles visual specifics.

## Common Use Cases

- Setting a consistent cinematic tone across all image and video generation nodes in a storyboard workflow.
- Defining brand voice tone for AI Writer nodes producing marketing copy.
- Controlling the mood of Generate Script output (e.g., "suspenseful thriller" vs "lighthearted comedy").

## Tips

- The tone value is passed as-is to downstream nodes. How it is used depends on the consuming node -- typically it is injected into the system prompt or appended to the generation prompt.
- You can connect the `in` input from a Text Prompt node to dynamically set the tone based on upstream logic or user input.
