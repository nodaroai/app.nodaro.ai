# Generate Image

## Overview

AI node that generates images from text prompts, optionally using reference images for consistency.

## When to Use

- Generate scene images from text descriptions
- Create character-consistent images using reference chaining

## Inputs

| Input | Type | Required | Description |
|-------|------|----------|-------------|
| prompt | string | Yes | Text description of the image |
| reference | image | No | Reference image for style/character consistency |

## Outputs

| Output | Type | Description |
|--------|------|-------------|
| image | image | The generated image |

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| provider | select | Nano Banana | AI provider (Nano Banana, Flux, DALL-E) |
| model | string | gemini-2.5-flash-image | Model identifier |
| style | string | "" | Visual style preset |
| aspectRatio | select | 16:9 | Output aspect ratio |
| negativePrompt | string | "" | What to avoid in generation |

## Credit Cost

5 credits per execution.
