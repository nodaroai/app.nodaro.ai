# Provider
> Select an AI provider and model to override the default provider on connected generation nodes.

## Overview

The Provider parameter node allows you to centralize provider/model selection for downstream AI generation nodes. Instead of configuring the provider on each individual Generate Image or Image to Video node, you can wire a single Provider node to multiple generation nodes and switch models from one place. It supports four categories: image, video, voice, and script.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Category | select | `"image"` | Provider category: `image`, `video`, `voice`, `script` |
| Provider | select | `"nano-banana"` | The AI provider/model to use. Options change based on the selected category. |
| Model | text | `""` | Optional model variant specification |

## Inputs & Outputs

**Inputs:**
- `in` -- optional upstream input (rarely used; Provider is typically a root parameter node)

**Outputs:**
- `provider` -- provider identifier string, consumed by downstream generation nodes
## Supported Providers

The available providers depend on the selected category:

- **Image**: All 21 Generate Image providers (nano-banana, nano-banana-pro, flux, grok, gpt-image, imagen4, ideogram-v3, qwen, seedream, etc.)
- **Video**: All Image-to-Video and Text-to-Video providers (minimax, veo3, kling, seedance, wan, etc.)
- **Voice**: Text-to-Speech providers (elevenlabs-v3, elevenlabs-turbo, elevenlabs-multilingual)
- **Script**: Script generation providers (gemini)

## Best Practices

- Use a Provider node when your workflow has multiple generation nodes that should all use the same model -- changing the Provider node updates all connected nodes at once.
- Set the category to match the type of downstream nodes. Connecting an image Provider to a video generation node will not produce the expected result.
- For workflows that need to test different providers, duplicate the Provider node with different selections rather than repeatedly changing a single node.

## Common Use Cases

- Batch-switching all image generation nodes in a storyboard from a fast draft model (nano-banana) to a production model (nano-banana-pro) by changing one node.
- A/B testing different video providers across the same workflow by swapping the Provider node.
- Centralizing model selection for template workflows that will be reused with different providers.

## Tips

- The Provider node overrides the provider field on connected downstream nodes. If a downstream node also has a provider set in its own config, the upstream Provider node takes precedence when connected.
- The model field is an optional refinement -- most workflows only need to set the provider, and the downstream node will use the appropriate default model for that provider.
