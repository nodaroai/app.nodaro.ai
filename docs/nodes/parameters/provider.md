# Provider
> Choose the model of the generation nodes it is wired into.

## Overview

The Provider parameter node centralizes model selection. Instead of choosing the model on each generation node, wire one Provider node into the **Settings** input of several nodes and switch their model from one place. The node shows the chosen model's name.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Category | select | `"video"` | Which models the node offers: `image` or `video`. |
| Model | select | `"seedance-2-fast"` | A model from that category — the same list the matching generation node offers in its own model picker. Stored as `provider` (the model id). |

Provider nodes saved before the node offered real models may hold a vendor name (such as `pika`) or a `voice` / `script` category. Opening the node's settings moves it to a model from the list.

## Inputs & Outputs

**Inputs:**
- `in` -- optional upstream input (rarely used; Provider is typically a root parameter node)

**Outputs:**
- `provider` -- the model id. Connect it to the **Settings** input of [Generate Image](../ai-image/generate-image.md) (an image Provider), or of [Generate Video](../ai-video/generate-video.md#settings-input) or [Generate Video Pro](../ai-video/generate-video-pro.md) (a video Provider); it replaces the node's own model at run time, and the run is priced for that model. A Generate Image node set to several models runs only the wired one.

## Supported Providers

- **Image**: the Generate Image models.
- **Video**: the Generate Video models. Generate Video Pro runs a subset of them (see its page).

The model must be one the wired node runs. A Provider set to an image model on a video node (or the reverse), or to a video model Generate Video Pro doesn't offer, stops that node's run before anything is charged, and the error names the Provider node. The node's chips show the problem in red before you run.

## Best Practices

- Use one Provider node when several generation nodes should use the same model -- changing it updates every connected node at once.
- Set the category to match the nodes it drives: an image Provider for Generate Image, a video Provider for Generate Video and Generate Video Pro.
- To compare models, duplicate the Provider node with different selections rather than repeatedly changing a single node.

## Common Use Cases

- Switching every image or video node in a workflow from a fast draft model to a production model by changing one node.
- A/B testing video models across the same workflow by swapping the Provider node.
- Centralizing model selection for template workflows that are reused with different models.

## Tips

- A connected Provider takes precedence over the model set on the node itself; the node's settings panel shows the model field as connected.
- When two Provider nodes are wired into one node, the last connection wins.
