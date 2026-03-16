# Location
> Create an environment asset with time-of-day, weather, and angle variations.

## Overview
The Location node creates a persistent environment or setting asset with variations across time of day, weather conditions, and viewing angles. Locations are stored per-project in the database and can be referenced by scene nodes to provide consistent backgrounds and settings across a narrative.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Name | string | `""` | Location name. |
| Description | string | `""` | Detailed text description of the environment, including key features, architecture, and atmosphere. |
| Category | enum | `"other"` | Location category. Options: `indoor`, `outdoor`, `urban`, `nature`, `fantasy`, `sci-fi`, `historical`, `futuristic`, `other`. |
| Style | enum | `"realistic"` | Visual style. Options: `realistic`, `anime`, `3d-pixar`, `illustration`. |
| Reference Image | image URL | `""` | Optional uploaded reference image to guide the location's appearance. |

### Asset Categories

| Category | Status Field | Description |
|----------|-------------|-------------|
| Time of Day | `timeOfDayStatus` | The location at different times (dawn, noon, sunset, night, etc.). |
| Weather | `weatherStatus` | The location under different weather conditions (clear, rainy, foggy, snowy, etc.). |
| Angles | `anglesStatus` | Different viewpoints and camera angles of the location. |

## Inputs & Outputs

**Inputs:**
- `in` -- Optional text or image input for additional context.

**Outputs:**
- `locationRef` -- Location reference for use in scenes and compositions.

## Credit Cost
2 credits per base generation. Additional credits per asset category generation.

## Best Practices
- Write rich descriptions that cover architecture, vegetation, lighting mood, and scale.
- Choose a category that best represents the primary setting type for more accurate generation.
- Generate time-of-day variations first if your narrative spans different times.
- Upload a reference image when matching a specific real-world or concept-art location.

## Common Use Cases
- Creating consistent backgrounds for multi-scene narratives.
- Generating establishing shots at different times of day for cinematic sequences.
- Building weather variations for dynamic storytelling (e.g., a storm approaching).
- Producing environment concept art from multiple camera angles.

## Tips
- Locations are persisted in the project database. Reuse them across multiple workflows for narrative consistency.
- The `locationRef` output carries all location data, allowing scene nodes to automatically use the correct environment.
- Custom variations can be generated with free-text prompts beyond the standard categories.
- Combine location variations with character nodes to create scene compositions with consistent settings and characters.
