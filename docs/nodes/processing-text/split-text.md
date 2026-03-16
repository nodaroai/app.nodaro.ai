# Split Text

> Split text by delimiter into a list of items.

## Overview

The Split Text node breaks a single text input into multiple items based on a delimiter. The output is a list that can be iterated by downstream nodes, enabling batch processing from a single text source.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Delimiter | Select | newline | Split character: newline, comma, custom |
| Custom Delimiter | Text | — | Custom delimiter string (when "custom" selected) |

## Inputs & Outputs

**Inputs:** Text (required)
**Outputs:** List of text items

## Credit Cost

0 credits — always free. Inline execution (no API call).

## Best Practices

- Use newline delimiter for multi-line text (scripts, lists)
- Use comma delimiter for CSV-style data
- Ensure the source text uses consistent delimiters

## Common Use Cases

- Split a script into individual scene descriptions for per-scene generation
- Break a comma-separated list of subjects into individual items
- Parse AI Agent output into separate items for batch processing
- Convert structured text into list items for iteration

## Tips

- This node executes inline (client-side) — no server round-trip needed
- Empty items (e.g., double newlines) may produce empty list entries — clean source text accordingly
- Combine with Generate Image or Text to Video for batch generation from a single text block
