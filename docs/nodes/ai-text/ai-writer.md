# AI Writer
> General-purpose AI text generation with real-time streaming, powered by Claude Sonnet.

## Overview

The AI Writer node (labeled "AI Agent" on the canvas) uses Claude Sonnet to generate text from a prompt with optional system instructions. It supports real-time streaming, displaying tokens as they arrive. The node can reference upstream node outputs in its prompt, making it useful as a flexible text transformation and generation step in any workflow. Output can be a single text block or multiple items separated by `===NEXT===` delimiters.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Template ID | `string` | `"custom"` | Predefined template (Photo Shoot, Product Catalog, Storyboard, Custom). Templates set the system prompt and output format |
| System Prompt | `string` | `""` | Optional system instructions that guide the AI's behavior and output format |
| User Input | `string` | `""` | The main prompt. Can include references to upstream nodes via field mappings |
| Provider | `AiWriterProvider` | `"claude"` | AI provider (Claude Sonnet) |
| Model | `string` | `"claude-sonnet-4-5-20250929"` | Specific model version |
| Temperature | `number` | `0.7` | Creativity control (0 = deterministic, 1 = more creative) |
| Max Tokens | `number` | `4096` | Maximum output length in tokens |

## Inputs & Outputs

- **Input**: `in` -- optional upstream connection(s) for referencing text, images, or other data in the prompt via field mappings
- **Output**: `text` -- generated text string

### Output Modes

- **Single text**: One continuous text block
- **Multiple items**: Text separated by `===NEXT===` delimiters, parsed into `generatedItems[]` array. When using predefined templates, the node can spawn individual image nodes from these items.

## Credit Cost

5 credits per generation (`ai-writer`).

## Best Practices

- Use the System Prompt to define the output format, tone, and constraints. A good system prompt dramatically improves output consistency.
- Reference upstream nodes in the User Input via field mappings to create dynamic, context-aware prompts.
- Keep Temperature at 0.7 for a balance of creativity and coherence. Lower it for factual or structured outputs, raise it for brainstorming.
- For long-form content, increase Max Tokens to 4096 or higher. The default handles most use cases but may truncate very long outputs.
- When using templates (Photo Shoot, Product Catalog, Storyboard), connect a reference image upstream for best results. The Custom template does not require one.

## Common Use Cases

- Rewriting or transforming text from upstream nodes (e.g., making text more concise, changing tone)
- Generating social media captions from video descriptions
- Creating image prompts from high-level concepts (especially with predefined templates)
- Brainstorming ideas and variations from a seed concept
- Building structured data (JSON, lists, tables) from natural language input

## Tips

- Streaming is active by default -- tokens appear in real-time as the model generates them. A blinking cursor and stop button are visible during generation.
- The predefined templates (Photo Shoot, Product Catalog, Storyboard) output multiple items separated by `===NEXT===`. The "Create N Image Nodes" button spawns Generate Image nodes on the canvas, pre-filled with each generated prompt.
- Field mappings allow you to inject upstream node outputs into the prompt. For example, connect a Text Prompt node and reference its output in the User Input.
- The node uses the SSE streaming endpoint (`/v1/ai-writer/generate-stream`), which bypasses the Vite proxy for real-time delivery. Both the config panel and the DAG executor use the same streaming path.
- Output is accessible as both `generatedText` (full string) and `generatedItems` (array, when `===NEXT===` delimiters are present).
