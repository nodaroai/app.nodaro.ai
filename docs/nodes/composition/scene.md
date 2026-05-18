# Scene
> Structured scene container with shot list, camera, and motion. Pipeline-managed.

## Overview

The Scene node is a **pipeline-managed container** populated by the Story → Video Generative Pipeline (Phase 1B.2 onward). It is not a directly executable node — instead, the Scene Director LLM (Sonnet) produces a complete `SceneNodeData` (shot list + camera + motion + model picks) for each scene in your story, and Phase 1C animates those shots into a `composite_video` plus a `last_frame` image and an `audio_track`.

This node is available on **Cloud edition only** and is created automatically by the pipeline orchestrator after Locations batch approval (Stage 5). Users approve or reject each Scene via the pipeline panel; there is no manual placement of this node in Phase 1B.2.

## View Modes

A Scene renders on the canvas with one of three switchable views (plus a placeholder for Phase 1C):

| View | What it shows | Phase |
|------|---------------|-------|
| **default** | Compact card with title, shot count, total duration, status | 1B.2 |
| **storyboard** | Keyframe grid (one tile per shot) + shot durations + camera shot types | 1B.2 (default) |
| **scripting** | Per-shot dialogue + action breakdown | 1B.2 |
| **video** | Embedded composite_video player | Phase 1C placeholder |

## Inputs & Outputs

**Inputs:** None (pipeline-populated).

**Outputs:**
- `video` (default) → `composite_video.url` (assembled in Phase 1C)
- `last_frame` → `last_frame.url` (final-frame image, useful for continuity)
- `audio_track` → `scene_audio_track.url` (per-scene audio bed)

All three outputs are `null` in Phase 1B.2 — they are populated by the internal scene-animation pipeline shipping in Phase 1C.

## SceneNodeData schema (Phase 1B.2)

Per `@nodaro/shared/scene-node-types`:

| Field | Type | Notes |
|-------|------|-------|
| `shot_input_mode` | enum | Gates which `video_model` values are valid via `modelsForInputMode()`. Options: `text_only`, `first_frame`, `first_last_frame`, `extends_shot`, `bridge_image`, `camera_path`. |
| `video_model` | string | The video provider key (e.g. `kling`, `veo3`, `seedance-2`) — constrained by `shot_input_mode` via `VIDEO_MODEL_CAPS`. |
| `shots[].camera` | object | `shot_type` / `angle` / `motion` |
| `shots[].duration_seconds` | number | Per-shot duration; sum is the scene duration ±10% |
| `shots[].shot_intent` | object | Provider-neutral hints (`needs_multishot_reference` / `is_loopable` / `needs_music_suppression` / `is_match_cut`) — mapped to provider directives by `provider-directive-defaults.ts`. |
| `shots[].visual_keyframe_prompt` | string | Image prompt for the shot's start keyframe |
| `shots[].end_keyframe_prompt` | string? | v4.1 Method 2 — required when `shot_input_mode='first_last_frame'` |
| `shots[].extends_shot_id` | string? | v4.1 Method 3 — video-continuation source shot |
| `shots[].bridge_image_prompt` | string? | v4.1 Method 5 — i2i edit on prior `last_frame` |
| `shots[].camera_path_directive` | object? | v4.1 Method 10 — parametric 3D camera path |
| `scene_anchor_keyframe` | AssetRef? | v4.1 Method 6 — master keyframe (set in Phase 1C) |

## Pipeline Integration

The Scene node is created via the Story → Video pipeline's **Stage 5 (Shot List)**:

1. Showrunner produces the scene list (Stage 1).
2. Characters / Objects / Locations are generated (Stages 2-4).
3. After Locations batch approval, the engine fans out **N parallel Scene Director Sonnet calls** — one per scene from the Showrunner plan.
4. The **Shot List Critic** (Sonnet, always-on, scene-local) validates each scene; on blocking issues the Scene Director retries that scene up to 2× with critic feedback injected.
5. Each scene materializes on the canvas as a SceneNode and into the pipeline panel as a SceneCard (storyboard preview).
6. User approves each scene; after the last one, the pipeline marks `status='completed'`.

In Phase 1C the same Scene node will be animated — `composite_video`, `last_frame`, and `scene_audio_track` will be populated by the internal pipeline.

## Credits

Scene Director (Sonnet, per scene) ≈ 5-8 credits + Shot List Critic (Sonnet, per scene) ≈ 2 credits. An 8-scene `short_film` adds ≈ 50-80 credits on top of the prior stages.

The Scene node itself has `creditCost: 0` — credits are billed against the upstream pipeline operations (Director, Critic, and the future Phase 1C animation calls).

## Edition Gating

Available on **Cloud** edition only. The node carries the `requires-edition-cloud` capability and `runs-in-pipeline-engine` capability so the workflow engine skips it as a no-op leaf (the pipeline orchestrator owns its lifecycle).

## See Also

- [Story → Video pipeline](../generative/generative-pipeline.md) — the parent pipeline that creates and animates Scene nodes.
