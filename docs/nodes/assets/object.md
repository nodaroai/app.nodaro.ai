# Object/Props Asset
> Create a reusable object or prop asset with angle, material, and variation sets — or choose an existing object from your Library or the Public Gallery.

## Overview
The Object node creates a persistent object asset with a base image and multiple variation categories. Objects can be viewed from different angles, rendered with different materials, and generated in visual variations. You can either build a new object or bind the node to an existing one from your Library or the Public Gallery. Objects are stored per-project in the database and can be referenced by scene nodes for consistent placement across compositions.

## The Canvas Node

Alongside the existing **⬡ Studio** button, the Object node shows a **Choose existing** button that opens the **Asset Picker** to bind the node to an object you already have. Once an object is bound, this button becomes **Replace** — use it to swap in a different object.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Name | string | `""` | Object name. |
| Description | string | `""` | Detailed text description of the object's appearance, size, and features. |
| Category | enum | `"other"` | Object category. Options: `furniture`, `vehicle`, `weapon`, `food`, `clothing`, `electronics`, `nature`, `tool`, `other`. |
| Style | enum | `"realistic"` | Visual style. Options: `realistic`, `anime`, `3d-pixar`, `illustration`. |
| Reference Image | image URL | `""` | Optional uploaded reference image to guide the object's appearance. |
| Choose from Library / Gallery | button (row) | — | Opens the **Asset Picker** to bind the node to an existing object. Becomes **Replace from Library / Gallery** once an object is bound — use it to swap in a different one. |

### Asset Categories

| Category | Status Field | Description |
|----------|-------------|-------------|
| Angles | `anglesStatus` | Multiple viewing angles of the object. |
| Materials | `materialsStatus` | The object rendered in different surface materials and textures. |
| Variations | `variationsStatus` | Visual variations of the object (color, size, wear, etc.). |

## Choosing an existing asset

Instead of creating a new object, you can bind the node to one you already have. Open the **Asset Picker** from either the **Choose existing** button on the canvas node or the **Choose from Library / Gallery** row in the config panel. The picker has two tabs:

- **My Library** — your own saved objects.
- **Public Gallery** — objects shared by the community. Selecting one **clones it into your library first** (you can't reference another creator's private asset), then binds the node to that fresh clone.

This works both for an empty node (first-time selection) and to **replace** an object that's already set — once an object is bound, the buttons read **Replace** / **Replace from Library / Gallery**. Binding or replacing carries the full object (base image plus every variation bucket — angles, materials, and variations), so downstream nodes immediately use the new object.

In two more cases the picker helps you avoid clutter:

- **Already have a copy?** If you pick a Public Gallery listing you've cloned before, the picker asks whether to **use your existing copy** or **make a new copy** — so a gallery pick never silently piles up duplicates.
- **Delete from My Library.** Hover a card in the **My Library** tab and click the trash icon to remove a saved asset. It's archived (recoverable), and any nodes already using it keep working.

## Inputs & Outputs

**Inputs:**
- `in` -- Optional text or image input for additional context.

**Outputs:**
- `objectRef` -- Object reference (identity) for use in scenes and compositions.
- `image` -- The object's image as a **plain image**. Connect this anywhere a Generate Image output can go (image References, Image-to-Image, Generate Video image input, etc.). Unlike `objectRef`, it carries no identity injection — it is just the picture.
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
