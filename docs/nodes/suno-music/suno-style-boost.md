# Suno Style Boost
> Enhance and refine the style of lyrics or text content using Suno AI.

## Overview

Suno Style Boost takes raw text content (typically lyrics) and enhances its stylistic quality. The AI refines word choice, flow, rhythm, and poetic elements to produce more polished lyrics. This node executes synchronously (inline, not via worker queue) and returns the enhanced text immediately. It is commonly placed between Suno Lyrics and Suno Generate in a workflow.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Content | string (max 3000) | `""` | The text content to enhance (typically lyrics). |

## Inputs & Outputs

- **Inputs:** `text` -- text content from an upstream node (e.g., Suno Lyrics)
- **Outputs:** `text` -- enhanced/boosted text

## Credit Cost

- **Fixed:** 1 credit

## Best Practices

- Use this after Suno Lyrics to polish AI-generated lyrics before feeding them into Suno Generate.
- Provide rough drafts or outlines as input -- the style boost works best when there is a solid foundation to refine.
- Chain multiple style boost passes for increasingly refined output, though diminishing returns apply after 2-3 passes.
- Keep input under 3000 characters for reliable processing.
- This node processes text, not audio -- it is a text-to-text transformation.

## Common Use Cases

- Polishing AI-generated lyrics before song creation.
- Enhancing manually written lyrics with better flow and rhythm.
- Building a multi-step lyrics pipeline: Suno Lyrics -> Suno Style Boost -> Suno Generate.
- Refining song concepts before committing to full generation.
- Improving word choice and poetic quality of rough drafts.

## Tips

- At 1 credit, this is the cheapest Suno node -- use it liberally in your workflows.
- Unlike most Suno nodes, Style Boost executes synchronously (no job polling). Results return immediately.
- The output is plain text, not audio. Connect it to a Suno Generate node's lyrics or prompt input for the next step.
- This node processes the content through the Suno style enhancement API directly, without going through the BullMQ worker queue.
