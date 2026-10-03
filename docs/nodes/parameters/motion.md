# Motion
> Set how much a video moves — a clause added to the prompt of the video nodes it is wired into.

## Overview

The Motion parameter node specifies how much movement and dynamism should appear in generated video content. It provides three intensity levels that influence the amount of camera movement, subject motion, and visual activity in the output. Wire it into the **Settings** input of [Generate Video](../ai-video/generate-video.md#settings-input) or [Generate Video Pro](../ai-video/generate-video-pro.md): it adds a short clause to the video's prompt (below).

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
- `out` -- connect it to a video node's **Settings** input. It adds this clause to the prompt, beside the Look family's hints (and, like them, it follows the node's **Inject Look** switch):

  | Level | Clause added to the prompt |
  |-------|----------------------------|
  | `subtle` | "subtle, gentle motion with slow, minimal movement" |
  | `moderate` | "moderate, natural motion at an even pace" |
  | `dynamic` | "dynamic, energetic motion with fast, pronounced movement" |

  The node shows it as a chip (e.g. `Dynamic`). When two Motion nodes are wired, the last connection wins. It is a video-only clause: still-image nodes never take it.
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

- Motion intensity is a hint in the prompt, not a precise control. Different video models interpret it differently, and the actual motion in the output also depends on the prompt content and subject matter.
- To place the clause yourself, reference the node as `{Motion}` in the prompt instead: a node referenced by its label is not added a second time.
