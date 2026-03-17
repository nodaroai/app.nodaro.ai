# Motion
> Define the motion intensity level for connected video generation nodes.

## Overview

The Motion parameter node specifies how much movement and dynamism should appear in generated video content. It provides three intensity levels that influence the amount of camera movement, subject motion, and visual activity in the output. This parameter is consumed by video generation nodes and script generation nodes to control the energy and pacing of generated video clips.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Motion | select | `"moderate"` | Motion intensity level: `subtle`, `moderate`, `dynamic` |

### Motion Levels

| Level | Description |
|-------|-------------|
| `subtle` | Minimal movement. Slow, gentle camera drifts. Subjects mostly stationary. Suitable for calm, contemplative, or dialogue-heavy scenes. |
| `moderate` | Balanced movement. Natural camera motion with moderate subject activity. Good default for most content types. |
| `dynamic` | High energy movement. Fast camera motion, active subjects, dramatic transitions. Suitable for action, sports, or high-energy content. |

## Inputs & Outputs

**Inputs:**
- `in` -- optional upstream input (rarely used; Motion is typically a root parameter node)

**Outputs:**
- `out` -- motion intensity string, consumed by downstream video generation and script nodes
## Supported Providers

Not applicable. This is a data-passing parameter node with no AI provider.

## Best Practices

- Use "subtle" for talking-head videos, product showcases, and scenes where the focus should be on static subjects.
- Use "moderate" as the default for most workflows -- it produces natural-looking motion without excessive movement artifacts.
- Use "dynamic" sparingly and primarily for action sequences, sports content, or music videos where high energy is desired.
- Match motion intensity to the tone of the content: a "calm, meditative" tone pairs naturally with subtle motion, while an "exciting, energetic" tone pairs with dynamic motion.

## Common Use Cases

- Controlling the energy level of AI-generated video clips in a storyboard workflow.
- Setting consistent motion intensity across all video generation nodes in a multi-scene project.
- Parameterizing template workflows for different content styles (e.g., corporate vs. entertainment).

## Tips

- Motion intensity is a hint to generation nodes, not a precise control. Different video providers interpret the motion parameter differently, and the actual motion in the output will also depend on the prompt content and subject matter.
- The output handle is named `out` (not `motion`), which means it connects to the generic input on downstream nodes.
