# Scene Count
> Specify the number of scenes for script generation nodes.

## Overview

The Scene Count parameter node provides a numeric value that controls how many scenes a connected Generate Script node will produce. It is a simple numeric parameter that decouples scene count configuration from the script generation node itself, making it easy to reuse or dynamically adjust across workflows.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Count | number | `5` | Number of scenes to generate. Passed to the Generate Script node as the target scene count. |

## Inputs & Outputs

**Inputs:**
- `in` -- optional upstream input (rarely used; Scene Count is typically a root parameter node)

**Outputs:**
- `scene_count` -- numeric scene count value, consumed by Generate Script nodes

## Credit Cost

| Cost | Notes |
|------|-------|
| 0 credits | Parameter nodes are free -- they only pass data, no AI processing |

## Supported Providers

Not applicable. This is a data-passing parameter node with no AI provider.

## Best Practices

- Match scene count to your target video duration. A rough guideline: 3-5 second clips per scene, so a 30-second video needs approximately 6-10 scenes.
- Keep scene counts between 3 and 15 for best script quality. Very high scene counts can produce shallow, repetitive scene descriptions.
- Use Scene Count as a separate node (rather than configuring it inline on Generate Script) when you want to quickly iterate on different scene counts without opening the script config panel.

## Common Use Cases

- Controlling the number of scenes in a storyboard generation workflow.
- Parameterizing template workflows where different users may need different scene counts.
- Quickly testing how scene count affects script quality by adjusting one node.

## Tips

- The Generate Script node also has a built-in `sceneCount` field. The Scene Count parameter node overrides it when connected, but if no Scene Count node is wired, the inline value is used.
- Scene count affects total credit usage indirectly: more scenes means more downstream image/video generation nodes to execute, each consuming their own credits.
