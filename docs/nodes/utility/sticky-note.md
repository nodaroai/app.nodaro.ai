# Sticky Note
> Place annotated notes on the workflow canvas for documentation and organization.

## Overview
The Sticky Note node provides a free-form text annotation that can be placed anywhere on the workflow canvas. It has no inputs or outputs and does not participate in workflow execution. Sticky notes are purely for documentation, organization, and communication -- useful for labeling sections of complex workflows, leaving instructions for collaborators, or noting design decisions.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Text | string | `"I'm a note\nDouble click to customize"` | Note content. Supports multi-line text. Double-click to edit. |
| Color | hex string | `"#2d2d44"` | Background color of the note. |
| Text Color | hex string | `"#ffffff"` | Text color. |
| Width | number (px) | `840` | Note width in pixels. |
| Height | number (px) | `540` | Note height in pixels. |
| Font Size | enum | `"base"` | Text size. Options: `sm`, `base`, `lg`, `xl`. |
| Bold | boolean | `false` | Whether the text is bold. |
| Italic | boolean | `false` | Whether the text is italic. |
| Alignment | enum | `"left"` | Text alignment. Options: `left`, `center`, `right`. |

## Inputs & Outputs

**Inputs:**
None.

**Outputs:**
None.

## Credit Cost
0 credits.

## Best Practices
- Use sticky notes to label major sections of complex workflows (e.g., "Image Generation", "Audio Processing", "Output").
- Choose contrasting background and text colors for readability.
- Keep notes concise. Use larger font sizes for section headers and smaller sizes for detailed annotations.
- Place notes behind or beside the nodes they describe, sized large enough to visually group related nodes.

## Common Use Cases
- Documenting workflow purpose and design decisions directly on the canvas.
- Labeling sections of large workflows for navigation.
- Leaving instructions or context for team members who may edit the workflow later.
- Marking TODO items or known issues within a workflow.

## Tips
- Double-click the note to enter edit mode. Click outside to finish editing.
- Sticky notes appear transparent on the MiniMap, so they do not clutter the overview.
- Resize by adjusting the width and height values in the configuration.
- Sticky notes are saved with the workflow and persist across sessions.
- Since they have no inputs or outputs, sticky notes never affect execution and cannot cause errors.
