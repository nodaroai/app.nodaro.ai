# Text Prompt

> User-provided text input with variable support.

## Overview

The Text Prompt node is the most common starting point for workflows. It provides freeform text that can be connected to any node accepting text input — AI generation prompts, descriptions, captions, or any text-based parameter. Supports node references for dynamic content.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Text | Textarea (5 rows) | — | Freeform text content with node reference support |

## Inputs & Outputs

**Inputs:** None (this is a source node)

**Outputs:**
- Text — the entered text value, available to all connected downstream nodes
## Best Practices

- Write detailed, specific prompts for AI generation nodes — vague prompts produce vague results
- Use separate Text Prompt nodes for different purposes (e.g., one for image prompt, one for negative prompt)
- Keep prompts focused on a single concept or instruction per node

## Common Use Cases

- Provide generation prompts for Generate Image, Text to Video, or Generate Text
- Enter descriptions for Text to Speech or Text to Dialogue
- Supply captions for social media output nodes
- Pass configuration text to downstream processing

## Tips

- Text Prompt outputs can fan out to multiple downstream nodes simultaneously
- For batch workflows, use a List or Loop node instead, which feeds items one at a time
- Node references allow you to dynamically include output from other nodes in your text
