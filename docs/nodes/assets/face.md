# Face
> Create a facial identity asset from a reference photo for lip-sync and identity preservation.

## Overview
The Face node creates a facial identity asset from a clear reference photo. It preserves the subject's facial identity in generated images and is primarily used for lip-sync operations and head replacement in video compositions. A clear, front-facing photo is required as input for best results.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Name | string | `""` | Name for this face asset. |
| Description | string | `""` | Optional text description of facial features or context. |
| Style | enum | `"realistic"` | Visual style. Options: `realistic`, `anime`, `3d-pixar`, `illustration`. |
| Reference Photo | image URL | required | A clear face photo. This is the primary input -- the photo should show a front-facing view with good lighting and minimal occlusion. |

## Inputs & Outputs

**Inputs:**
- `in` -- Source image containing the face (typically from an Upload Image node).

**Outputs:**
- `faceRef` -- Face reference for use in lip-sync nodes, scene nodes, and other identity-preserving operations.

## Credit Cost
2 credits per base generation (5 credits as listed in NODE_DEFINITIONS).

## Best Practices
- Use a clear, well-lit, front-facing photo with the face clearly visible and unobstructed.
- Avoid photos with heavy makeup, sunglasses, or extreme angles, as these reduce identity accuracy.
- One face per node -- create separate Face nodes for different people.
- Generate the face asset before connecting it to downstream lip-sync or scene nodes.

## Common Use Cases
- Providing facial identity for lip-sync video generation.
- Maintaining face consistency across multiple generated images in a workflow.
- Creating a reusable face identity for talking-head video content.
- Preserving a speaker's identity when generating video from audio narration.

## Tips
- The face reference carries enough identity information for downstream nodes to maintain visual consistency without re-uploading the photo.
- Face assets are persisted in the project database and can be reused across workflows within the same project.
- Unlike the Character node, the Face node focuses solely on facial identity rather than full-body variations.
- For best lip-sync results, use a photo where the subject's mouth is clearly visible and in a neutral position.
