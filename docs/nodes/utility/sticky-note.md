# Sticky Note
> Place annotated notes on the workflow canvas for documentation and organization.

## Overview
The Sticky Note node provides a free-form text annotation that can be placed anywhere on the workflow canvas. It has no inputs or outputs and does not participate in workflow execution. Sticky notes are purely for documentation, organization, and communication -- useful for labeling sections of complex workflows, leaving instructions for collaborators, or noting design decisions.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Title | string | `"Note"` | Heading rendered inside the note, above the body. While a note has a title, it replaces the floating label above the note. Optional — notes made before titles existed keep their floating label. |
| Text | string | `""` | Note body. Supports multi-line text. Click into the note to edit. |
| Color | hex string | `"#26221a"` | Background color. The toolbar offers seven swatches — three muted, three brand tints, and **paper** (`#26221a`: warm near-black in dark mode, cream `#f6eedc` in light mode, the default) — plus a free colour well for any hex. Text colour follows the surface automatically (dark ink on light surfaces, light ink on dark). |
| Text Color | hex string | `"#ffffff"` | Legacy field; the rendered ink is derived from the surface colour. |
| Width | number (px) | `320` | Note width in pixels. |
| Height | number (px) | `200` | Note height in pixels. |
| Font Size | enum | `"base"` | Body size, cycled from the note's toolbar. Options: `sm` (**Small**, 12px body / 14px title), `base` (**Paragraph**, 14 / 17), `lg` (**Heading**, 18 / 22), `xl` (**Display**, 26 / 30) — the title always sits one step above its body. |
| Bold | boolean | `false` | Whether the text is bold. |
| Italic | boolean | `false` | Whether the text is italic. |
| Alignment | enum | `"start"` | Text alignment. Options: `start`, `left`, `center`, `right`. `start` follows the note's own text: a Hebrew or Arabic note sits on the right, an English one on the left (the toolbar lights the side it lands on). Picking a side in the toolbar fixes it. A note saved as `left` without a pick (the old default) is shown as `start`; `center` and `right` are always kept. |
| Alignment chosen | boolean | absent | Set to `true` when an alignment is picked in the toolbar, so a deliberate `left` is told apart from the old default. Write `alignment: "left"` with `alignmentChosen: true` to pin a note to the left. |

## Inputs & Outputs

**Inputs:**
None.

**Outputs:**
None.
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
