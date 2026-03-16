# Object
> Create a reusable object asset with angle, material, and variation sets.

## Overview
The Object node creates a persistent object asset with a base image and multiple variation categories. Objects can be viewed from different angles, rendered with different materials, and generated in visual variations. Objects are stored per-project in the database and can be referenced by scene nodes for consistent placement across compositions.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Name | string | `""` | Object name. |
| Description | string | `""` | Detailed text description of the object's appearance, size, and features. |
| Category | enum | `"other"` | Object category. Options: `furniture`, `vehicle`, `weapon`, `food`, `clothing`, `electronics`, `nature`, `tool`, `other`. |
| Style | enum | `"realistic"` | Visual style. Options: `realistic`, `anime`, `3d-pixar`, `illustration`. |
| Reference Image | image URL | `""` | Optional uploaded reference image to guide the object's appearance. |

### Asset Categories

| Category | Status Field | Description |
|----------|-------------|-------------|
| Angles | `anglesStatus` | Multiple viewing angles of the object. |
| Materials | `materialsStatus` | The object rendered in different surface materials and textures. |
| Variations | `variationsStatus` | Visual variations of the object (color, size, wear, etc.). |

## Inputs & Outputs

**Inputs:**
- `in` -- Optional text or image input for additional context.

**Outputs:**
- `objectRef` -- Object reference for use in scenes and compositions.

## Credit Cost
2 credits per base generation. Additional credits per asset category generation.

## Best Practices
- Include specific material and texture descriptions (e.g., "brushed stainless steel coffee mug with a matte black handle").
- Choose the appropriate category to help the AI understand the object's context and typical usage.
- Generate angle variations first, as they provide the most useful reference for compositions.
- Use a reference image for objects that need to match a specific real-world item.

## Common Use Cases
- Creating props for scene-based video compositions.
- Generating product shots from multiple angles for e-commerce content.
- Building a library of reusable objects for consistent use across workflows.
- Producing material variations for design exploration.

## Tips
- Objects are persisted in the project database and survive across sessions.
- Custom variations can be generated with a free-text prompt beyond the standard angle/material/variation categories.
- The `objectRef` output allows downstream nodes to reference this object consistently.
- Each asset category generates individual cropped images that can be accessed separately.
