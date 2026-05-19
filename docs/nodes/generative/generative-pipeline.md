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

**Active in Phase 1C.1:** The 3 above helpers ship in Phase 1C.1 with the Image Critic LLM:

| Helper | Model | Credits | Purpose |
|--------|-------|---------|---------|
| 🔍 Audit Images | Sonnet vision | 3 | Run Image Critic over every keyframe in the scene; aggregate per-shot issues |
| 🔗 Fix Continuity | Sonnet vision + i2i | 4 | Critic on target shot vs prior shot's last frame; if `continuity_break`, regenerate the keyframe via image-to-image with the last frame as a strong reference |
| 🎯 Validate Match Cut | Sonnet vision | 3 | Side-by-side critic on two consecutive shots flagged `is_match_cut`; returns match-strength score + suggested adjustments |

### Endpoints

`POST /v1/pipelines/:id/entities/:sceneId/helpers/:name` (scope `pipelines:approve`, Cloud edition only) where `:name` is one of `audit_prompt`, `improve_prompt`, `generate_motion`, `optimize_for_model`, `add_broll`, `bridge_to_next_scene`, `anchor_scene_style`, `audit_images`, `fix_continuity`, `validate_match_cut`. Every successful invocation writes a `pipeline_stage_attempts` row with `trigger='scene_helper:<name>'` for audit + future undo (Phase 1B.4).

## Stages 6/7/8 — Scene Images, Animate/Audio/Edit, Post-merge (Phase 1C.1)

After Stage 5 plans every scene's shot list, the orchestrator runs three new stages:

### Stage 6 — `scene_images`

For every approved scene, generate a keyframe per shot via `pipelineGenerateImage`. Each shot's `keyframe_url` is persisted back to `scene_node_data.shots[N]`. Concurrency: 5 scenes in parallel; shots within a scene are sequential. Cost: 1 image-gen credit per shot × N shots × M scenes.

### Stage 7 — `animate_audio_edit`

Drives the SceneNode's built-in 5-step internal pipeline per scene (§6.9.3): animate each shot via `pipelineAnimateShot` → extract last_frame post-animate → dialogue audio per shot (if `dialogue_line` set) → lip-sync (if `config.lipsync_enabled`) → `combine_videos` produces the scene's composite. Returns `composite_video_url` exposed on the SceneNode's `video` view.

**Mode-aware behavior** (read from `pipelines.config.shot_generation_mode`):
- **`"sequential"` (default for continuity-aware scenes)** — scenes processed 1-at-a-time; shots within a scene flow last_frame → start_frame across consecutive shots (Continuity Method 1); Image Critic runs the Stage 7b-pre `continuity_break` gate before each animate (§5.13.4).
- **`"parallel"` (auto/fast mode)** — scenes processed 3-at-a-time; shots within a scene fan out via `settledWithLimit`; no last_frame chain, no Stage 7b-pre.

**Continuity Methods 1 + 4 (shipped in 1C.1):**
- **Method 1** — `pipeline_entities.last_frame_asset_id` written after each animate; `start_frame_url = sceneN.last_frame_asset_id` for shot N+1 in sequential mode.
- **Method 4** — Multi-shot reference slot allocation per §5.13.3 H3 v3.9: continuity anchor (slot 1) wins over secondary refs. Capped to `VIDEO_MODEL_CAPS[shot.video_model].maxReferenceImages`. 1-ref providers (Hailuo) silently degrade — `needs_multishot_reference` is dropped but continuity anchor stays.

**Continuity Methods 3, 8, and 10 are available from Phase 1C.3** — see below for details.

### Stage 8 — `post_merge`

Concatenates every scene's `composite_video_url` via the existing `combine_videos` route (FFmpeg). Writes `pipelines.final_output_asset_id` + flips `status='completed'`. Single-scene pipelines skip the combine call and copy the lone composite directly.

Emits the new `pipeline:completed` SSE event with `finalOutputUrl`. The pipeline panel closes the stream on this event.

## Continuity Methods 3, 8, and 10 (Phase 1C.3)

These three methods are configured per shot in `ShotSpec` and are selected by the Scene Director or set manually in the per-shot editor.

### Method 3 — Video extension (`video_continuation`)

Extends the previous shot's rendered video rather than generating a fresh clip from a keyframe. The shot's `extends_shot_id` must point to another shot in the same scene whose video model supports extension.

**Supported providers:**

| Model | How it works |
|-------|-------------|
| VEO 3.1, VEO 3 | Native — uses the prior clip's `kieTaskId` via the KIE `extend_video` endpoint. Frame-perfect continuation. |
| Seedance 2, Seedance 2 Fast | Workaround — passes the prior clip as `reference_video_urls`, the prior shot's last frame as `first_frame_url`, and appends "continue seamlessly from the previous clip" to the prompt. Visually plausible but not frame-perfect. |

**Eligibility:** The prior shot's `video_model` must have `supportsVideoExtension: true` in `VIDEO_MODEL_CAPS`. The Shot List Critic validates this before Stage 7 runs and will reject an invalid `extends_shot_id`.

**ShotSpec field:** `extends_shot_id` (string, optional) — the `id` of the shot to extend.

**Pricing:** No additional pricing row. Extension uses the same per-second credit cost as a normal generation with that model.

---

### Method 8 — Frame interpolation (`frame_interpolation`)

Generates additional intermediate frames between the shot's start keyframe and one or more `interpolation_keyframes`, producing smoother motion or a distinct stylistic effect.

**Provider status:** RIFE and Topaz Apollo are not yet available via a public provider endpoint. When configured, Stage 7 will return a `provider_not_available:<model>` error for those models and the scene falls back to `first_frame` mode automatically with a logged warning. Manual and guided mode configurations are preserved and will execute correctly once the providers are wired.

**Stage 6 behavior:** When a shot uses Method 8, Stage 6 generates one sub-keyframe per entry in `interpolation_keyframes[N].prompt` in addition to the main start keyframe.

**ShotSpec field:** `interpolation_keyframes` (array, optional) — each entry is `{ timestamp_sec: number, prompt: string }`.

**Pricing:** No additional pricing row today. When interpolation providers ship, expect an add-on credit cost similar to the existing `loop_trim` model.

---

### Method 10 — Camera path (`camera_path`)

Applies a parametric 3D camera movement to the shot by either driving a native 3D model or — for all other i2v models — injecting a descriptive prompt amendment.

**Text-prompt fallback (works universally):** For any i2v model, the engine calls `cameraPathToPromptAmendment()` which maps the `path_kind` to a natural-language phrase appended to the shot prompt:

| `path_kind` | Example prompt amendment |
|-------------|--------------------------|
| `orbit` | "camera orbits 360° around the subject" |
| `dolly` | "slow dolly push toward the subject" |
| `crane` | "camera cranes upward revealing the scene" |
| `arc` | "camera arcs around the subject" |
| `reveal` | "camera pulls back to reveal the wider scene" |

Optional `parameters` (e.g., `{ degrees: 360 }` for orbit) are woven into the phrase.

**Native 3D provider:** Stable Video 3D is not yet available via a public endpoint. When configured, Stage 7 returns `provider_not_available:stable-video-3d` and the engine falls back to the text-prompt path automatically.

**ShotSpec field:** `camera_path_directive` (object, optional) — `{ path_kind: "orbit" | "dolly" | "crane" | "arc" | "reveal", parameters?: Record<string, number> }`.

**Pricing:** No additional pricing row. Camera path uses the underlying video model's pricing.

---

### Scene Director auto-pick heuristic (updated in Phase 1C.3)

The Scene Director now includes Methods 3, 8, and 10 in its auto-pick logic. Three new rows have been added to the internal heuristic table:

| Scenario | Auto-suggested method |
|----------|-----------------------|
| Shot narrative explicitly continues action from the prior shot (same subject, same motion) | Method 3 — Video extension (if `supportsVideoExtension` is true for the chosen model; falls back to Method 1 otherwise) |
| Shot requires a slow-motion or stylized motion effect | Method 8 — Frame interpolation (auto mode falls back to `first_frame` if providers unavailable) |
| Shot narrative calls for a specific cinematic camera move | Method 10 — Camera path (text-prompt fallback always active) |

### Shot List Critic eligibility validation (Phase 1C.3)

The Shot List Critic runs BEFORE Stage 7 and rejects invalid Method 3/8/10 configurations so they fail fast at planning time rather than mid-animation:

- **Method 3:** `extends_shot_id` must reference a prior shot in the same scene whose model has `supportsVideoExtension: true`.
- **Method 8:** `interpolation_keyframes` must contain at least 2 entries.
- **Method 10:** `camera_path_directive.path_kind` must be one of the 5 supported values.

---

### Image Critic LLM (Phase 1C.1)

`backend/src/ee/pipelines/llms/image-critic.ts` — Sonnet vision call with 6 issue types: `continuity_break`, `identity_mismatch`, `composition_break`, `wardrobe_inconsistency`, `style_drift`, `prompt_mismatch`. Each verdict is persisted to the new `image_critic_verdicts` table (migration 134) with the `invoked_via` discriminator (`stage_7b_pre` / `helper:audit_images` / `helper:fix_continuity` / `helper:validate_match_cut`).

## Stage 7 sub-steps 7d'–7j (Phase 1C.2)

After every scene's `composite_video_url` is populated (sub-step 7e from 1C.1), Stage 7 runs an additional 6-step chain that turns the raw scene composites into a cut-and-scored final video. Sub-step completion is tracked in `pipeline_stages.output.sub_step_completed` so the stage is re-entrant after sub-gate approvals.

- **7d' Dialogue duration recheck** (manual + guided only) — verifies actual ElevenLabs audio durations against the shot-list estimate. Rebalances scene timing to keep within ±10% of the target. If rebalance fails for any scene, the stage pauses with `current_sub_gate='dialogue_recheck'` and the panel surfaces a rebalance approval banner. Auto mode logs warnings and proceeds.
- **7e' Silent-cut review** (manual + guided only) — assembles a preview merge using current cut decisions but **no music** and surfaces it for user approval before the music spend. Pauses with `current_sub_gate='silent_cut_preview'`. Auto mode skips.
- **7f Music** — Suno generates a track at `target_duration_seconds + 5s` using the Showrunner's music plan. New service wrapper `pipeline-generate-music.ts`.
- **7g Music post-processing** — trim to exact target duration with 0.8s fade-out, extract beat grid via FFmpeg silencedetect onset detection (aubio swap is a follow-up). New helper `pipeline-extract-beat-grid.ts`.
- **7g' Shot duration realignment** — when actual BPM deviates >2 BPM from planned, shift shot durations by ≤±1 beat to land cleanly. Bounded so total scene duration stays within ±0.3s of target.
- **7h Editor LLM** (Sonnet vision) — per-shot cut decisions across 4 transition types (`hard_cut` / `dissolve` / `match_cut` / `overlap`) honoring `dialogue_no_cut_zone` and beat-snap heuristics. Verdicts persisted to the new `editor_decisions` table (migration 135).
- **7j Final merge** — FFmpeg merge using Editor cut decisions + music overlay + 0.8s fade-out. Per-shot cut decisions within a scene are honored at scene boundaries (full per-shot in-scene trim is a follow-up). Persists `pipelines.final_output_asset_id`.

**FreeCut export option**: when `pipelines.config.freecut_export_enabled === true && mode === 'manual'`, sub-step 7j skips the FFmpeg auto-merge and instead generates a Nodaro-flat-timeline-v1 JSON file (uploaded to R2) referencing every scene composite, per-shot trim points, transition metadata, and the music URL. FCPXML serialization over the same in-memory timeline is a planned follow-up — most NLE software can ingest via XML/EDL converters.

## Stage 8 — Post-merge approval gate (Phase 1C.2)

Stage 8 is now a pure approval gate. Auto mode flips `pipelines.status='completed'` immediately. Manual + Guided modes set `awaiting_approval` with `final_output_url` populated; the user reviews and approves via `POST /v1/pipelines/:id/stages/post_merge/approve`. The 1C.1 implementation that did the final concat in Stage 8 was an interim shortcut — that work has moved to Stage 7 sub-step 7j.

## Sub-gate approval endpoints (Phase 1C.2)

| Method | Path | Scope |
|--------|------|-------|
| `POST` | `/v1/pipelines/:id/sub-gates/silent_cut_preview/approve` | `pipelines:approve` |
| `POST` | `/v1/pipelines/:id/sub-gates/silent_cut_preview/reject` | `pipelines:approve` |
| `POST` | `/v1/pipelines/:id/sub-gates/dialogue_recheck/approve` | `pipelines:approve` |
| `POST` | `/v1/pipelines/:id/sub-gates/dialogue_recheck/reject` | `pipelines:approve` |

Approve clears `pipeline_stages.output.current_sub_gate`, flips stage status back to `running`, and re-enqueues `drivePipeline`. Reject marks the stage failed with `failure_reason='sub_gate_rejected:<gate>'`, cascades the pipeline to `failed`, and refunds unspent credits. Proper branch-from-stage integration on reject lands in Phase 1D.

## Canvas-wide Scene View Modes (Phase 1C.2)

A new toolbar toggle in the canvas (`<ViewModeToggle>`) switches ALL SceneNodes between `default` / `storyboard` / `video` / `scripting` view modes simultaneously. Per-node toggle still works; the canvas-wide override wins when set (clicking the active button again clears the override and returns to per-node selection).

## Phase 1C.2.1 additions (cleanup + narration + FCPXML)

### Auto-sequential mode

Stage 5 auto-forces `pipeline.config.shot_generation_mode = 'sequential'` when any scene contains a shot with `continuity_with_previous` set, per spec §5.13.4 ("Sequential mode is the only mode that honors continuity"). Manual override still wins. Emits a `pipeline:warning` event with `code: "auto_forced_sequential_mode"` for visibility.

### Sub-step 7c — Narration audio

When `plan.narration_script` is set on the Showrunner output (optional — best for trailers, documentaries, omniscient-narrator formats), sub-step 7c generates a single narrator-voice audio track via ElevenLabs (default model: `elevenlabs-v3` for `[audio tags]` support). Runs ONCE per pipeline (not per-scene) before sub-step 7d'. Persists `narration_audio_url` + `narration_audio_duration_sec` to `pipeline_stages.output`. Sub-step 7j mixes it as a second audio track over the music with **60% music duck** (constant amix ducking; sidechain compression is a follow-up).

`pipelines.config.narration_enabled` (default `true`) lets the user opt out.

### FCPXML export format

`pipelines.config.freecut_export_format` accepts `"json"` (default — Nodaro-flat-timeline-v1) or `"fcpxml"` (FCPXML 1.10 — Apple's open NLE timeline format ingested by Final Cut Pro, DaVinci Resolve, Premiere XML import). Both formats reuse the same in-memory timeline reduction logic (per-scene head/tail trim + per-pair transitions). Narration audio (when present) becomes a separate audio lane (no pre-mix) so downstream NLE re-mixing stays unconstrained.

### Beat detection: aubio with FFmpeg silencedetect fallback

Sub-step 7g prefers `aubio onset` (Debian `aubio-tools` package, baked into the Dockerfile) when available. Falls back to the original FFmpeg silencedetect heuristic when aubio is absent. aubio detection is cached at module init.

## Mid-flight canvas edits (Phase 1B.4)

While a pipeline is running, the engine writes nodes to the canvas. Each node carries an ownership flag (`pipeline_state`) that controls what the user can do:

| State | Visual cue | What the user can do |
|-------|-----------|---------------------|
| `pipeline_owned_running` | Gray pulsing border + ⚙ badge | Move/relabel only — config locked |
| `pipeline_owned_awaiting_approval` | Amber border + ⏸ badge | Edit config, approve, reject |
| `pipeline_owned_approved` | Blue border + ✓ badge | Edit config (warns about downstream regen needed) |
| `pipeline_orphaned` | No border | Anything — user-owned |

State transitions stream via the `entity:state_change` SSE event. Adding a small orange "stale" pill (`entity:stale` event) signals that an upstream entity changed and the node may need regenerating — the smart-regen prompt lands in Phase 1D.

### Fork

`POST /v1/pipelines/:id/fork` (scope `pipelines:execute`, Cloud only) — takes the canvas off the pipeline's hands. All entities are marked `pipeline_orphaned`, unspent credits are refunded, and the pipeline transitions to `status='forked'`. **Terminal — no un-fork in v1.** Users who want to continue with AI assistance start a new pipeline from the forked canvas. Entity-level fork (per-scene) lands in Phase 1D.

### Drift detection

At each stage start, the engine validates the canvas against its plan. If entities are missing, disconnected, or forked, the pipeline pauses at `awaiting_approval` with `awaiting_reason='canvas_drift'` and emits a `pipeline:drift` SSE event. The panel surfaces a banner with a `Fork pipeline` action; the user can also edit the canvas back into shape and re-trigger approval. Sub-job-dequeue-time drift detection (mid-stage) is deferred to Phase 1D.

### Dependency tracking

Each scene entity's `depends_on` array records which character/object/location entities feed it. When an upstream entity changes (`main_asset_id` update), a Postgres trigger marks transitive dependents `is_stale=true` and `entity:stale` SSE events fire. The canvas surfaces this as a small orange "stale" pill. The smart-regen UX prompt ("8 scenes depend on Hero — regenerate?") lands in Phase 1D.

## Resume

When the BullMQ pipeline worker boots, it scans for `active` orchestration jobs and re-attaches. Each pipeline can resume up to 3 times before `failure_reason='resume_limit_exceeded'` and a refund. The `resume_count` counter is separate from `tool_retry_count` so backend crashes don't burn provider-flake budget. Stages are idempotent at the entity-key level (`pipeline_entities` UNIQUE constraint prevents duplicate inserts on retry).

## Live canvas

As entities materialize, the canvas runs ELK auto-layout (`elkjs`, `layered` algorithm, `RIGHT` direction) to position nodes without overlap. New nodes fade-in-scale (300ms); edges fade in (500ms). The viewport auto-pans to follow the build, but only when the user has been idle for 5+ seconds — the moment the user pans/zooms/clicks, auto-pan disengages until the user clicks the "Follow build →" mini-button to re-engage.

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
