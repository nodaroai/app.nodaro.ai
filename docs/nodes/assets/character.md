# Character
> Create a multi-variation character with consistent identity across poses, expressions, and lighting conditions.

## Overview
The Character node creates a reusable character asset with a base portrait and multiple variation categories. Once the base portrait is generated, you can produce asset sheets for different angles, expressions, poses, and lighting conditions. Characters are persisted per-project in the database and can be referenced by other nodes (scenes, image generation) to maintain visual consistency.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Name | string | `""` | Character name. Auto-versioning appends a number if a character with the same name already exists in the project. |
| Description | string | `""` | Detailed text description of the character's appearance, clothing, and distinguishing features. |
| Gender | enum | `"other"` | Character gender. Options: `male`, `female`, `other`. |
| Style | enum | `"realistic"` | Visual style. Options: `realistic`, `anime`, `3d-pixar`, `illustration`. |
| Base Outfit | string | `""` | Description of the character's default clothing and accessories. |
| Reference Image | image URL | `""` | Optional uploaded reference image to guide the character's appearance. |

### Asset Categories

Each category can be generated independently:

| Category | Status Field | Description |
|----------|-------------|-------------|
| Angles | `anglesStatus` | Front, side, back, and three-quarter views. |
| Expressions | `expressionStatus` | Emotional variations (happy, sad, angry, surprised, etc.). |
| Poses | `poseStatus` | Different body positions and stances. |
| Lighting | `lightingStatus` | The character under various lighting conditions. |

A "Generate All Assets" button triggers all categories at once.

## Inputs & Outputs

**Inputs:**
- `in` -- Optional text or image input for additional context.

**Outputs:**
- `characterRef` -- Character reference that can be connected to scene nodes, image generation, and other nodes that accept character references.
## Best Practices
- Write detailed descriptions covering facial features, body type, hair, and clothing for the most consistent results.
- Upload a reference image when you need the character to match a specific look.
- Generate all asset categories before using the character in scenes to ensure consistent reference material is available.
- Use the same style setting across all characters in a project for visual coherence.

## Common Use Cases
- Creating consistent characters for animated explainer videos.
- Building a cast of characters for a multi-scene narrative.
- Generating character turnaround sheets for animation reference.
- Producing expression sheets for dialogue-driven content.

## Tips
- Characters are saved to the project database. They persist across sessions and can be reused in multiple workflows within the same project.
- The `characterRef` output carries the character's identity information, allowing downstream nodes to maintain visual consistency.
- Individual cropped images from each asset sheet are stored separately, so you can use specific expressions or poses individually.
- Custom variations can be generated beyond the standard categories using the custom variation prompt.
