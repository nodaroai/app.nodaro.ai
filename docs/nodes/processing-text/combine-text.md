# Combine Text

> Concatenate multiple text inputs with a custom separator.

## Overview

The Combine Text node joins text from multiple input connections into a single output string. Choose a separator (newline, space, comma, or custom) to control how the texts are joined. Useful for assembling prompts, combining AI outputs, or building structured text.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Separator | Select | newline | Join character: newline, space, comma, custom |
| Custom Separator | Text | — | Custom separator string (when "custom" selected) |

## Inputs & Outputs

**Inputs:** 2+ text connections
**Outputs:** Single combined text string

## Credit Cost

0 credits — always free. Inline execution (no API call).

## Best Practices

- Use newline separator for combining multi-line content (scripts, lists)
- Use space separator for building sentences from fragments
- Use comma separator for creating CSV-like data

## Common Use Cases

- Combine AI Agent output with additional instructions for a second AI pass
- Join multiple text prompts into a single complex prompt
- Assemble captions from different text sources
- Build structured data from separate text nodes

## Tips

- This node executes inline (client-side) — no server round-trip needed
- Input order matters — texts are joined in the order they're connected
