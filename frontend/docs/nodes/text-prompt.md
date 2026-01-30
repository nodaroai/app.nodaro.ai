# Text Prompt

## Overview

Input node that provides text content to downstream nodes.

## When to Use

- Starting point for most workflows
- Provide story text, descriptions, or prompts to AI nodes

## Inputs

None (this is a source node).

## Outputs

| Output | Type | Description |
|--------|------|-------------|
| prompt | string | The text content |

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| text | textarea | "" | The prompt text |
| variables | key-value | {} | Template variables for dynamic content |

## Credit Cost

0 credits (no AI processing).
