# Story → Video (Generative Pipeline)

**Status:** Phase 1A (Cloud edition only). Stages 2-8 ship in Phase 1B+.

Generates an editable Nodaro graph from a single text prompt by orchestrating
multiple LLMs and generation steps under approval gates.

## Inputs

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `story_prompt` | string | yes | The story description, max 4000 chars |
| `target_duration_seconds` | number | yes | Per-format range; max 600s |
| `format` | enum | yes | `trailer` \| `short_film` \| `music_video` \| `reel` \| `commercial` |
| `output_resolution` | enum | no | `720p` \| `1080p` (default) \| `4K` |
| `mode` | enum | no | `manual` (default in 1A) \| `auto` \| `guided` |

### Format duration bounds

| Format | Min (s) | Max (s) |
|--------|---------|---------|
| reel | 7 | 90 |
| commercial | 10 | 90 |
| trailer | 30 | 180 |
| short_film | 30 | 600 |
| music_video | 30 | 600 |

## Stage 1 — Script

1. **Detection** (Haiku) extracts entities from the prompt.
2. **Showrunner** (Opus) builds a global `ShowrunnerPlan` — cast, locations, objects,
   scene list, beats, duration math.
3. **Script Critic** + **Cast Coverage Critic** (Sonnet, always-on) validate.
4. The Stage row enters `awaiting_approval` and the panel renders the plan.
5. User clicks **Approve** to finish (Phase 1A) or **Reject + feedback** to retry
   the Showrunner up to 2× with critic feedback injected.

## Stages 2-4 — Characters, Objects, Locations (Phase 1B.1)

After Script approval, the engine advances through three entity stages, generating
reference images and (for characters) voice-matching against the ElevenLabs catalog.

| Stage | What runs | Approval shape |
|-------|-----------|----------------|
| 2. Characters | Per cast member: image gen + voice match → per-character approval → angle + expression variants → batch variant approval | Per-character (main+voice), then batch (variants) |
| 3. Objects | Per object: single reference image | Batch (all objects together) |
| 4. Locations | Per location: main image → per-location approval → variants per `variants_needed` → batch variant approval | Per-location (main), then batch (variants) |

### Variants

- **Character angle variants:** up to `angle_count_hint - 1` from the canonical labels (`profile`, `three_quarter`, `full_body`).
- **Character expression variants:** from `expression_set_hint` (max 6, controlled vocabulary).
- **Location variants:** up to 4 from `variants_needed` (kinds: `time_of_day`, `weather`, `aftermath`, `angle`).

### Credits

Phase 1B.1 image gen uses `nano-banana` by default (2 credits/image, tier-overridable
in Phase 1C). Voice match is a Haiku call (~0.005 USD ≈ 0.3 credits). A typical 4-cast,
3-object, 3-location run with default variants is ~50-80 credits beyond the Phase 1A
30-credit Stage 1 estimate.

## Stage 5 — Shot List (Phase 1B.2)

After Locations batch approval, the engine fans out **N parallel Scene Director Sonnet calls** — one per scene from the Showrunner plan. Each call emits a complete `SceneNodeData` (shot list + camera + motion + model picks) constrained by the `shot_input_mode` and `VIDEO_MODEL_CAPS` capability registry.

The **Shot List Critic** (always-on, like Script Critic) validates each scene's output. On blocking issues the Scene Director retries that scene up to 2x with critic feedback injected.

Each scene materializes as a new **SceneNode** on the canvas:

- Renders in **storyboard view** by default — keyframe grid + shot durations + camera shot types.
- User reviews and approves **per scene** via the pipeline panel.
- View mode is switchable per-node (default / storyboard / video / scripting). Video view shows `Pending Phase 1C` until the internal pipeline lands.

### Scene Director output schema

Per `@nodaro/shared/scene-node-types`:

| Field | Type | Notes |
|-------|------|-------|
| `shot_input_mode` | enum | Gates which `video_model` values are valid via `modelsForInputMode()` |
| `shots[].camera` | object | shot_type / angle / motion |
| `shots[].duration_seconds` | number | Per-shot duration; sum ≈ scene duration ±10% |
| `shots[].shot_intent` | object | Provider-neutral hints (needs_multishot_reference / is_loopable / needs_music_suppression / is_match_cut) |
| `shots[].visual_keyframe_prompt` | string | Image prompt for the shot's start keyframe |
| `shots[].end_keyframe_prompt` | string? | v4.1 Method 2 — required when `shot_input_mode='first_last_frame'` |
| `shots[].extends_shot_id` | string? | v4.1 Method 3 — video continuation source shot |
| `shots[].bridge_image_prompt` | string? | v4.1 Method 5 — i2i edit on prior last_frame |
| `shots[].camera_path_directive` | object? | v4.1 Method 10 — parametric 3D camera path |
| `scene_anchor_keyframe` | AssetRef? | v4.1 Method 6 — master keyframe (set in Phase 1C) |

### Credits

Scene Director (Sonnet, per scene) ~5-8 credits/scene + Shot List Critic ~2 credits/scene. An 8-scene short_film adds ~50-80 credits on top of the prior stages (~30 + ~80 = ~110 credits cumulative at end of 1B.2).

## Scene-Context Helpers (Phase 1B.3)

After Stage 5 plans the shots for each scene, the user can refine via 7 LLM-backed helper buttons on the SceneNode config panel. Each helper is **user-triggered only** — never auto-runs — returns a structured suggestion the user accepts (patches the SceneNodeData) or rejects. Credits reserved at invocation; refunded on failure.

| Helper | Model | Credits | Purpose |
|--------|-------|---------|---------|
| 🔍 Audit Prompt | Haiku | 1 | Check shots for contradictions with the scene description / emotional beat / format |
| ✨ Improve Prompt | Sonnet | 2 | Rewrite a shot's action / motion_prompt / dialogue with model-aware phrasing |
| 🎬 Generate Motion | Haiku | 1 | Fill motion_prompt for shots missing one |
| 🎯 Optimize for Model | Sonnet | 3 | Rewrite all shots for current `video_model`'s prompting style |
| 🎞️ Add B-Roll | Sonnet | 2 | Propose 1-4 insert shots (reaction / cutaway / establishing / transition) |
| 🌉 Bridge to Next Scene | Sonnet | 2 | Generate `bridge_image_prompt` for i2i edit between shots (v4.1 Method 5) |
| 🎨 Anchor Scene Style | Sonnet + image gen | 5 | Plan + generate a master keyframe for the scene (v4.1 Method 6) |

### Deferred to Phase 1C

Three vision-keyframe helpers need Stage 6 keyframes which don't exist until Phase 1C. Their buttons render in the SceneNode panel but are disabled with a "Pending Phase 1C — requires Stage 6 keyframes." tooltip:

- 🔍 **Audit Images** — wraps the Image Critic over generated keyframes
- 🔗 **Fix Continuity** — vision check across the scene boundary
- 🎯 **Validate Match Cut** — MatchCutCritic for shot pairs

### Endpoints

`POST /v1/pipelines/:id/entities/:sceneId/helpers/:name` (scope `pipelines:approve`, Cloud edition only) where `:name` is one of `audit_prompt`, `improve_prompt`, `generate_motion`, `optimize_for_model`, `add_broll`, `bridge_to_next_scene`, `anchor_scene_style`. The audit trail lives in `llm_calls` (Phase 1B.3); the spec-required `pipeline_stage_attempts` row lands in Phase 1B.4 alongside undo support.

## Credits

Phase 1A: ~30 credits per Stage 1 run (LLM calls only). Reserved upfront on POST;
refunded on cancel/failure. A future hard cap defaults to the tier ceiling and is
overridable via `max_cost_credits` in the request body.

## Edition gating

Available on **Cloud** edition only. Community + Business return 403 `edition_required`.

## Endpoints

| Method | Path | Scope | Notes |
|--------|------|-------|-------|
| POST | `/v1/pipelines` | `pipelines:execute` | Create + start a run |
| GET | `/v1/pipelines` | `pipelines:read` | List user's pipelines |
| GET | `/v1/pipelines/:id` | `pipelines:read` | Status + cost |
| GET | `/v1/pipelines/:id/events` | `pipelines:read` | SSE stream |
| GET | `/v1/pipelines/:id/stages/:stage_name` | `pipelines:read` | Fetch one stage |
| POST | `/v1/pipelines/:id/cancel` | `pipelines:execute` | Cancel + refund |
| GET | `/v1/pipelines/:id/pending-approvals` | `pipelines:approve` | List stages awaiting approval |
| POST | `/v1/pipelines/:id/stages/:stage_name/approve` | `pipelines:approve` | Approve a stage |
| POST | `/v1/pipelines/:id/stages/:stage_name/reject` | `pipelines:approve` | Reject + feedback |
