# Preview
> Display any result type (text, image, video, audio) in the workflow editor for inspection.

## Overview
The Preview node renders the output of any upstream node directly in the workflow editor canvas. It accepts all media types -- text, images, video, and audio -- and displays them inline. Multiple upstream connections are supported, with results displayed as an ordered list that persists its ordering across re-executions.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Preview Items | PreviewItem[] | `[]` | Auto-populated list of received results from upstream nodes. |
| Item Order | string[] | `[]` | Persisted ordering of preview items by source node ID. Survives re-execution so items remain in the same visual order. |

## Inputs & Outputs

**Inputs:**
- `in` -- Accepts any media type. Multiple upstream connections supported.

**Outputs:**
None. This is a display-only node.
## Best Practices
- Place Preview nodes at key points in your workflow to monitor intermediate results.
- Use multiple Preview nodes to compare outputs from different branches of a workflow.
- Remove Preview nodes before deploying automated workflows (they serve no purpose without a user viewing the editor).

## Common Use Cases
- Debugging workflow logic by inspecting intermediate outputs.
- Comparing results from different AI models or parameter settings side by side.
- Previewing generated images, audio, or video before sending to output nodes.
- Monitoring text outputs (scripts, captions, prompts) at various stages of processing.

## Tips
- The item order is persisted, so reordering is preserved when you re-run the workflow.
- Preview supports all media types: text renders as formatted text, images render inline, video shows a player, and audio shows a playback control.
- This node has no outputs -- it is purely for visual inspection in the editor.
- Preview nodes are lightweight and do not affect workflow performance.
