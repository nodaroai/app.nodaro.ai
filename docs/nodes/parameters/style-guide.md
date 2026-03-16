# Style Guide
> Define visual style reference text for consistent aesthetics across AI generation nodes in a workflow.

## Overview

The Style Guide parameter node holds a free-text visual style description that influences connected downstream AI nodes. It is designed for detailed visual direction -- describing color palettes, rendering styles, composition rules, and aesthetic references. Unlike the Tone node (which focuses on emotional quality), Style Guide targets the visual and structural aspects of generated content.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Text | text | `""` | Free-text style guide description. Can be as detailed as needed -- multiple sentences covering color palette, art style, composition rules, reference artists/works, etc. |

## Inputs & Outputs

**Inputs:**
- `in` -- optional upstream text input (can be used to dynamically set style guide text)

**Outputs:**
- `style_guide` -- style guide text string, consumed by downstream AI nodes

## Credit Cost

| Cost | Notes |
|------|-------|
| 0 credits | Parameter nodes are free -- they only pass data, no AI processing |

## Supported Providers

Not applicable. This is a data-passing parameter node with no AI provider.

## Best Practices

- Be specific about visual elements: "muted earth tones with teal accents, soft diffused lighting, shallow depth of field, 35mm film grain" is more useful than "vintage look".
- Reference concrete art styles or artists when appropriate: "in the style of Studio Ghibli watercolor backgrounds" or "Wes Anderson symmetrical framing with pastel palette".
- Use one Style Guide per workflow to maintain visual consistency across all generated images, scripts, and compositions.
- Keep the style guide under 500 characters for best results -- overly long guides can dilute the most important directives.

## Common Use Cases

- Establishing a consistent visual language across all Generate Image nodes in a multi-scene storyboard.
- Defining brand visual guidelines for product photo generation workflows.
- Setting art direction for AI-composed video scenes (After Effects, Motion Graphics, Lottie Overlay nodes).
- Providing visual references for Generate Script's image prompt generation.

## Tips

- Style Guide text is injected into the generation context of downstream nodes. The exact integration point varies by node type -- for image generation it typically augments the style portion of the prompt.
- Combine Style Guide with Tone for comprehensive creative direction: Style Guide for "how it looks" and Tone for "how it feels".
