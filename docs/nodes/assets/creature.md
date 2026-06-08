# Animal/Creature
> Create a reusable animal or creature asset with angle, pose, variation, and motion sets, edited in the full-screen Creature Studio.

## Overview
The Animal/Creature node creates a persistent creature asset with a base image and multiple asset categories. Creatures can be viewed from different angles, rendered in different poses, generated as visual variations, and animated into motion clips. Creatures are stored per-project in the database and can be referenced by downstream scene, image, and video nodes for consistent appearance across compositions.

Unlike the [Object](./object.md) node, the creature's `Category` / `Species` field is **free text** (not a fixed enum) — so mythical and hybrid creatures (e.g. "griffin", "dragon") are not locked to the built-in animal catalog. A 126-entry animal catalog powers autocomplete suggestions, but any value is accepted.

The full editing experience lives in the **Creature Studio**, a five-tab full-screen modal opened from the node's config panel (appearance, assets, motion, reference photos, and identity).

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Name | string | `""` | Creature name. |
| Species / Type | string (free text) | `""` | The animal or creature kind, e.g. `red fox`, `griffin`, `dragon`. Autocomplete suggests from the animal catalog but accepts any text. |
| Description | string | `""` | Detailed text description of the creature's appearance and features. |
| Category | string (free text) | `""` | Free-text grouping (cats / dogs / wild / birds / sea / mythical / etc.). Distinct from Object's hard category enum. |
| Style | enum | `"realistic"` | Visual style. Options: `realistic`, `anime`, `3d-pixar`, `illustration`. |
| Reference Image | image URL | `""` | Optional uploaded reference image to guide the creature's appearance. |
| Style Lock | boolean | `true` | When enabled, every variant generation passes the approved main image (plus the canonical description) as a reference, keeping form and species consistent across assets. |

### Asset Categories

| Category | Status Field | Description |
|----------|-------------|-------------|
| Angles | `anglesStatus` | Multiple viewing angles of the creature. |
| Poses | `posesStatus` | The creature in different poses and stances. |
| Variations | `variationsStatus` | Visual variations of the creature (color, age, markings, etc.). |
| Motion | `motionStatus` | Short animated motion clips generated from the creature's images. |

A canonical, LLM-authored description is set when the main image is approved; it anchors downstream generations when Style Lock is on.

## Inputs & Outputs

**Inputs:**
- `in` — Optional text or image input for additional context.

**Outputs:**
- `creatureRef` — Creature reference for use in scenes and compositions.

## Credits

The creature node itself is a setup/reference node and does not bill credits to exist on the canvas. Generation inside the Creature Studio bills per the chosen provider, the same as the standalone generation nodes:

- **Image assets** (angles / poses / variations / main image) bill per the selected image provider (default `nano-banana`, 2 credits). See [Generate Image](../ai-image/generate-image.md) for the per-provider credit table.
- **Motion clips** bill per the selected image-to-video provider (default `kling-turbo`, 10 credits). See [Image to Video](../ai-video/image-to-video.md) for the per-provider credit table.

## Best Practices
- Approve a strong main image first — it becomes the visual anchor for every other asset when Style Lock is on.
- Use the free-text Species field for precise prompting (e.g. "arctic fox with thick winter coat") rather than relying on the category alone.
- Generate angles before poses and variations; angles give the most useful reference for downstream compositions.
- Use a reference image for creatures that need to match a specific look or an existing design.

## Common Use Cases
- Creating recurring animal or creature characters for scene-based video compositions.
- Generating consistent multi-angle and multi-pose reference sheets for animation.
- Building a library of reusable creatures that survive across sessions and workflows.
- Producing motion clips of a creature for use in larger video assemblies.

## Tips
- Creatures are persisted in the project database and survive across sessions.
- Custom variations can be generated with a free-text prompt beyond the standard angle/pose/variation categories.
- The `creatureRef` output lets downstream nodes reference this creature consistently.
- Style Lock (default on) trades a little creative variance for much stronger species/form consistency — turn it off when you want freer reinterpretation.
