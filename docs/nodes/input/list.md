# List

> Create a list of items for batch iteration.

## Overview

The List node lets you define multiple text items that are processed sequentially by downstream nodes. Each item in the list triggers a separate execution of connected nodes, enabling batch workflows.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Items | Dynamic list | — | Newline-separated text items, add/remove with buttons |

Item counter displays the total number of entries.

## Inputs & Outputs

**Inputs:** None (this is a source node)

**Outputs:**
- Text — each item is emitted sequentially to downstream nodes

## Credit Cost

0 credits — always free.

## Best Practices

- Keep list items consistent in format for predictable downstream behavior
- Use one concept per item — each item should be a complete, standalone prompt or value
- For structured data with multiple fields per row, use the Loop node instead

## Common Use Cases

- Batch-generate images from a list of prompts
- Process multiple subjects through the same video generation pipeline
- Generate TTS audio for multiple text entries
- Create social media posts for a list of topics

## Tips

- Press Enter to add a new item quickly
- Items are processed in order from top to bottom
- For very large batches, consider breaking into smaller lists to manage credit usage
