# Location
> Create an environment asset with time-of-day, weather, and angle variations.

## Overview
The Location node creates a persistent environment or setting asset with variations across time of day, weather conditions, and viewing angles. Locations are stored per-project in the database and can be referenced by scene nodes to provide consistent backgrounds and settings across a narrative.

PR-1 introduces a dedicated **Location Studio** modal (Appearance tab) for editing the canonical look, mood-board references, and style-lock policy. The full studio UX — atmosphere motion clips, the five environmental tabs (seasons, time of day, weather, angles, lighting), and the archive gallery — ships in PR-2.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Name | string | `""` | Location name. |
| Description | string | `""` | Short text description shown on the canvas badge. |
| Canonical Description | string | `""` | LLM-authored multi-sentence "true reference" description, written automatically on main-image approval and used as the implicit context block any time a downstream consumer references this location. Editable manually in the Location Studio's Appearance tab. |
| Category | enum | `"other"` | Location category. Options: `indoor`, `outdoor`, `urban`, `nature`, `fantasy`, `sci-fi`, `historical`, `futuristic`, `other`. |
| Style | enum | `"realistic"` | Visual style. Options: `realistic`, `anime`, `3d-pixar`, `illustration`. |
| Style Lock | boolean | `true` | When on, downstream image/video nodes inject the location's canonical description verbatim and refuse to override the style. When off, downstream nodes may freely reinterpret the location (useful for variants and mash-ups). Toggleable from the Location Studio header. |
| Reference Photos | array | `[]` | Mood-board of up to 20 reference images (URL + kind label). Treated as additional reference inputs by the canonical-fallback injector when no upstream wires are present. Managed via the Appearance tab's Reference Photos section. |
| Reference Image | image URL | `""` | Legacy single reference image. Continues to work for back-compat; new workflows should prefer the multi-image Reference Photos field. |

### Asset Categories

| Category | Status Field | Description |
|----------|-------------|-------------|
| Time of Day | `timeOfDayStatus` | The location at different times (dawn, noon, sunset, night, etc.). |
| Weather | `weatherStatus` | The location under different weather conditions (clear, rainy, foggy, snowy, etc.). |
| Angles | `anglesStatus` | Different viewpoints and camera angles of the location. |
| Lighting | `lightingStatus` | Different lighting setups (golden hour, blue hour, harsh midday, soft window light, etc.). |
| Seasons | `seasonsStatus` | The location across the four seasons (spring, summer, autumn, winter). |

> **Atmosphere motion clips** — looping ambient video (rain falling, fog drifting, leaves blowing) attached to the location and reusable as `start_frame` / texture loops in downstream image-to-video nodes. *(coming in PR-2)*

## Lifecycle

Locations are **soft-deleted** in PR-1 — `DELETE /v1/locations/:id` archives the row (sets `deleted_at`) instead of destroying it. Archived locations:

- Are hidden from the default per-project list (`GET /v1/locations?projectId=…`).
- Can be listed via `GET /v1/me/locations?archived=true` (CLI: `nodaro locations list --archived`).
- Can be restored via `POST /v1/locations/:id/restore` (CLI: `nodaro locations restore <id>`).
- Are NOT exposed via a permanent-delete endpoint in PR-1 — the runtime archive gallery for permanent destruction ships in PR-2.

Soft-delete is a **breaking change** for the SDK: `client.locations.delete(id)` returns `{ success: true, archived: true }` rather than destroying the row. See the changeset entry for migration notes.

## Inputs & Outputs

**Inputs:**
- `in` -- Optional text or image input for additional context.

**Outputs:**
- `locationRef` -- Location reference for use in scenes and compositions.

## Location Studio

Click **Open Studio** on the canvas to launch the fullscreen Location Studio modal. PR-1 ships the **Appearance tab** only:

- **Identity fields** — Name, description, category, style.
- **Canonical description editor** — LLM-authored on main-image approval, with a Retry caption button (`POST /v1/locations/:id/llm-caption`) to regenerate. Edit freely; saves are debounced with optimistic concurrency (409 → resolve modal).
- **Style Lock toggle** — header switch + sidebar badge.
- **Reference Photos section** — drag-and-drop or paste URLs to build the mood-board; per-tile kind label and remove control.
- **Save** — diff-only PATCH back to `/v1/locations/:id`; on 409 (concurrent edit) the modal surfaces a "Server changed under you — reload?" reconcile dialog.
- **Escape / Close** — `window.confirm` prompt when dirty.

> **Variants / Atmosphere / Reference tabs** — the rest of the studio UX (five environmental tabs, atmosphere motion clip generator, archive gallery) ships in PR-2.

## Best Practices
- Write rich descriptions that cover architecture, vegetation, lighting mood, and scale.
- Choose a category that best represents the primary setting type for more accurate generation.
- Generate the main image first, then let the LLM author the canonical description on approval — manual edits compound on a strong base.
- Use Style Lock when reusing a location across a single film (consistency wins). Turn it off when generating variants or mash-ups.
- Build a 3-6 image Reference Photos mood-board for unfamiliar or fantastical locations — wider context yields more faithful generations.
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
- An approved location with a canonical description is auto-injected as a reference into any downstream image/video node that references it via FieldMappings — even without a wired edge. Suppressible per-node via the Injected References list's × button (see Image / Video config panel docs).
