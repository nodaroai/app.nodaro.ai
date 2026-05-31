import type {
  PipelineInput,
  PipelineEvent,
  PipelineMode,
  PipelineStatus,
  PipelineStageName,
  SubGateName,
  ChatEnabledStage,
  AuditPromptResult,
  ImprovePromptResult,
  ImprovePromptInput,
  GenerateMotionResult,
  OptimizeForModelResult,
  AddBRollResult,
  BridgeToNextSceneResult,
  AnchorSceneStyleResult,
  AuditImagesResult,
  FixContinuityInput,
  FixContinuityResult,
  ValidateMatchCutInput,
  ValidateMatchCutResult,
} from "@nodaro/shared"
import type {
  ChatTurn,
  ChatStageResult,
  ApplyChatProposalResult,
} from "@nodaro/client"
import { getAuthHeaders } from "@/lib/api"
import type { PipelineTimelineInput } from "@remotion-pkg/lib/build-scene-graph-from-pipeline"

// Pipelines API uses the same proxy convention as the rest of the frontend:
// same-origin relative paths under /v1/* are proxied to the backend by Vite's
// dev server and by the Caddy reverse proxy in production. SSE is the only
// exception (handled separately by the SSE client when streaming events).
const API_BASE = ""

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { ...(await getAuthHeaders()) },
  })
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`)
  return res.json() as Promise<T>
}

async function postJson<T>(path: string, body?: unknown): Promise<T> {
  // Only send a JSON content-type when there's actually a body — otherwise
  // Fastify's content-type parser rejects the empty body with
  // FST_ERR_CTP_EMPTY_JSON_BODY (e.g. the no-body cancel/approve POSTs).
  const hasBody = body !== undefined && body !== null
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...(await getAuthHeaders()),
    },
    body: hasBody ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`)
  return res.json() as Promise<T>
}

async function patchJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(await getAuthHeaders()),
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`)
  return res.json() as Promise<T>
}

export interface PipelineRecord {
  id: string
  status: PipelineStatus
  current_stage: string | null
  /** Phase 0 studio — present on the list endpoint (recent-films history). */
  created_at?: string
  input_prompt?: string | null
  spent_credits: number
  reserved_credits: number
  upfront_credit_estimate: number
  /** Phase 1D.3 — set when this pipeline was created via POST /v1/pipelines/:id/branch */
  branched_from_pipeline_id: string | null
  /** Phase 1D.3 — the stage from which this pipeline was branched */
  branched_from_stage: string | null
  /**
   * Phase 1D.2a §4.5 — execution mode (`manual` | `guided` | `auto`). Drives
   * the Auto/Guided badge in the panel header AND the visibility of the
   * Switch-to-Manual button. May be `null` for pre-Phase-1D.2a rows.
   */
  mode?: PipelineMode | null
  /**
   * Phase 1D.2a §4.5 — terminal failure reason set when `status === 'failed'`.
   * Values ending in `_unresolvable` (e.g. `script_critic_unresolvable`) come
   * from the auto-mode critic chain and trigger the panel's critic-failure
   * surface.
   */
  failure_reason?: string | null
  /**
   * Most-recent transient LLM-streaming progress message (e.g. "Drafting
   * plan (3.4 KB so far)…"). Backed by `pipelines.current_progress_message`
   * — written by callLLM's onProgress, cleared on stream finalize / cancel.
   * Lets the panel render the StageProgressBanner on first mount or after
   * a refresh while an LLM call is mid-stream, instead of waiting for the
   * next live SSE event (~750ms throttle window). Null when no stream is
   * active.
   */
  current_progress_message?: string | null
}

/**
 * §6.11 Scene-Context helpers — each helper has its own request-body shape and
 * its own typed result. The runSceneHelper generic ties the two together so a
 * caller can't pass the wrong body shape for a given helper name.
 *
 * Helpers that take no body (audit_prompt, add_broll, anchor_scene_style) have
 * `undefined` as their body type — the runSceneHelper wrapper POSTs an empty
 * object in that case so the backend route's Zod parser still sees a valid
 * JSON body.
 */
export type SceneHelperBody = {
  audit_prompt: undefined
  improve_prompt: ImprovePromptInput
  generate_motion: { shot_ids: string[] }
  optimize_for_model: { target_model: string }
  add_broll: undefined
  bridge_to_next_scene: { target_shot_id: string }
  anchor_scene_style: undefined
  // Phase 1C.1 vision-keyframe helpers
  audit_images: undefined
  fix_continuity: FixContinuityInput
  validate_match_cut: ValidateMatchCutInput
}

export type SceneHelperResult = {
  audit_prompt: AuditPromptResult
  improve_prompt: ImprovePromptResult
  generate_motion: GenerateMotionResult
  optimize_for_model: OptimizeForModelResult
  add_broll: AddBRollResult
  bridge_to_next_scene: BridgeToNextSceneResult
  anchor_scene_style: AnchorSceneStyleResult
  // Phase 1C.1 vision-keyframe helpers
  audit_images: AuditImagesResult
  fix_continuity: FixContinuityResult
  validate_match_cut: ValidateMatchCutResult
}

/**
 * Phase 3 (granular-pipeline-control) — request body for the Character
 * Wizard Step A `approve-description` route. Discriminated on `mode` so a
 * caller can't pass an `asset_url` with `mode='llm'` or a `description` with
 * `mode='upload'`. Mirrors the backend's Zod discriminated union in
 * `backend/src/routes/pipelines.ts`.
 */
export type ApproveDescriptionBody =
  | { mode: "llm" }
  | { mode: "user_edited"; description: string }
  | {
      mode: "upload"
      asset_url: string
      filename?: string
      mime_type?: string
      size_bytes?: number
    }

export const pipelinesApi = {
  create: (body: PipelineInput) => postJson<{ id: string }>("/v1/pipelines", body),
  get: (id: string) => getJson<PipelineRecord>(`/v1/pipelines/${id}`),
  list: () => getJson<PipelineRecord[]>("/v1/pipelines"),
  cancel: (id: string) => postJson<{ ok: true }>(`/v1/pipelines/${id}/cancel`),
  pendingApprovals: (id: string) =>
    getJson<{ stage_name: PipelineStageName; output: unknown }[]>(
      `/v1/pipelines/${id}/pending-approvals`,
    ),
  approveStage: (id: string, stage: PipelineStageName, edits?: unknown) =>
    postJson<{ ok: true }>(
      `/v1/pipelines/${id}/stages/${stage}/approve`,
      edits ? { edits } : {},
    ),
  /**
   * Phase 1 (granular-pipeline-control spec) — save inline scene edits
   * WITHOUT advancing the stage. Backend applies the RFC 6902 patch to
   * `pipeline_stages.output` and appends the ops to `user_edits` for audit
   * trail; stage stays `awaiting_approval`. The caller still has to hit
   * `approveStage` to advance.
   *
   * Phase 1 path whitelist (enforced server-side):
   *   /scenes/{n}/description
   *   /scenes/{n}/duration_seconds
   *   /scenes/{n}/emotional_beat
   *   /scenes/{n}/dialogue/{m}/line
   * Ops are `replace` only — add/remove are Phase 5.
   *
   * `edits` typed as `unknown` to match the sibling approveStage signature
   * and avoid pulling JsonPatch into the import set; callers can pass a
   * typed `JsonPatch` from @nodaro/shared and it'll conform.
   */
  applyEdits: (id: string, stage: PipelineStageName, edits: unknown) =>
    postJson<{ ok: true; newOutput: unknown }>(
      `/v1/pipelines/${id}/stages/${stage}/edit`,
      { edits },
    ),
  /**
   * Phase 2 (granular-pipeline-control spec) — regenerate ONE scene from
   * the Stage 1 script plan based on user feedback. Backend cost: 3 credits
   * per call (refunded automatically on roster-validation failure or LLM
   * error). Replaces only `scenes[sceneIndex]` in
   * `pipeline_stages.output.plan`; other scenes (including any prior inline
   * edits) are preserved.
   *
   * sceneIndex is 0-based (matches the React array index, not the
   * 1-based scene_index field stored on the SceneSpec). feedback is
   * free-form user guidance, e.g. "make it more tense", "remove the
   * helicopter", "shorter — 4 seconds".
   *
   * On success returns the new scene and the full patched plan so the
   * caller can update local UI without an extra refetch (React Query
   * invalidations also handled in the mutation onSuccess).
   */
  regenerateScene: (
    id: string,
    sceneIndex: number,
    feedback: string,
  ) =>
    postJson<{ ok: true; newScene: unknown; newPlan: unknown }>(
      `/v1/pipelines/${id}/stages/script/regenerate-scene`,
      { sceneIndex, feedback },
    ),
  rejectStage: (id: string, stage: PipelineStageName, feedback: string) =>
    postJson<{ ok: true }>(`/v1/pipelines/${id}/stages/${stage}/reject`, { feedback }),
  approveEntity: (id: string, entityId: string) =>
    postJson<{ ok: true }>(`/v1/pipelines/${id}/entities/${entityId}/approve`, {}),
  rejectEntity: (id: string, entityId: string, feedback: string) =>
    postJson<{ ok: true }>(`/v1/pipelines/${id}/entities/${entityId}/reject`, { feedback }),
  /**
   * Phase 3 (granular-pipeline-control) — Character Wizard Step A approve.
   * Routes the entity from `pending_description` to its next state per mode:
   *   - `llm`         → `pending` (engine generates the portrait next cycle)
   *   - `user_edited` → `pending` + overwrites `metadata.visual_description`
   *   - `upload`      → `approved` directly, with the user's uploaded image
   *                     attached as the entity's `main_asset_id` (skips
   *                     Step B per spec — no image gen, no critic by default)
   *
   * Backend CAS-gates on `status='pending_description'`; a second click loses
   * the race and returns 409 `entity_not_pending_description`.
   */
  approveDescription: (
    id: string,
    entityId: string,
    body: ApproveDescriptionBody,
  ): Promise<{ ok: true; newStatus: "pending" | "approved"; assetId?: string }> =>
    postJson(`/v1/pipelines/${id}/entities/${entityId}/approve-description`, body),
  /**
   * Phase 3 (granular-pipeline-control) — Character Wizard Step A skip.
   * Flips the entity from `pending_description` to terminal `skipped`. No
   * image, no critic, no asset. The variant-batch gate ignores skipped
   * entities so the stage can still advance when every non-skipped entity
   * is approved.
   *
   * The UI surfaces a warning at skip time when the character appears in
   * `plan.scenes[].cast_keys` (D3 override) — that check is purely UI-side;
   * this route does NOT block based on scene refs.
   */
  skipEntity: (id: string, entityId: string): Promise<{ ok: true }> =>
    postJson(`/v1/pipelines/${id}/entities/${entityId}/skip`, {}),
  /**
   * Phase 1D.2c-a §7 (E1) follow-up — Skip button on the failed-entity surface.
   * Accept the image-critic-failed image AS-IS. Backend CAS-gates on
   * `status='failed' AND metadata.last_error='image_critic_unresolvable'`;
   * any other state returns 409 `entity_not_image_critic_failed`. The general
   * approveEntity route can't handle this because it CAS-gates on
   * `status='awaiting_approval'`.
   */
  forceApproveImageCriticFailure: (id: string, entityId: string) =>
    postJson<{ ok: true }>(
      `/v1/pipelines/${id}/entities/${entityId}/force-approve-image-critic-failure`,
      {},
    ),
  /**
   * Phase 1D.2c-a §7 (E1) follow-up — Regenerate button on the failed-entity
   * surface. Resets the entity to `status='pending'`, clears the
   * image-critic-only metadata (last_error / critic_findings / etc.), and
   * re-enqueues the orchestrator so the stage handler runs again with a fresh
   * retry budget. Other metadata fields (voice_match, name, role) survive.
   * Same 409 gate as forceApproveImageCriticFailure.
   */
  retryImageGeneration: (id: string, entityId: string) =>
    postJson<{ ok: true }>(
      `/v1/pipelines/${id}/entities/${entityId}/retry-image-generation`,
      {},
    ),
  /**
   * Retry character variant generation for an entity whose
   * `ensureCharacterVariants` either threw at the outermost level
   * (`variant_generation_error` metadata set) or finished with partial
   * failures (`variants_failed_count > 0`). Backend clears the failure
   * markers, deletes any rows in `pipeline_entity_variants` at
   * `status='failed'`, and re-enqueues `drivePipeline`. Approved variants
   * survive — only the failures regenerate.
   *
   * Gate: entity must be a character at `status='approved'`. The route
   * intentionally doesn't gate on a specific failure marker, so it also
   * recovers entities that pre-date the variant-failure-capture code —
   * if Stage 2 stalled silently with missing variants, hit this route.
   */
  retryVariants: (id: string, entityId: string) =>
    postJson<{ ok: true }>(
      `/v1/pipelines/${id}/entities/${entityId}/retry-variants`,
      {},
    ),
  /**
   * Phase 1D.2c-b-ii §9 (J1) — Skip button on the per-shot video-critic surface
   * (scene-configs.tsx). Accepts the failed clip AS-IS: backend flips
   * `video_critic_failed=false` on the target shot inside
   * `scene_node_data.shots[N]` and emits `shot:status` SSE. Findings stay
   * for audit. Backend CAS-gates on `shot.video_critic_failed === true`;
   * any other state returns 409 `shot_not_video_critic_failed`.
   */
  skipShotVideoCriticFailure: (pipelineId: string, sceneId: string, shotId: string) =>
    postJson<{ ok: true }>(
      `/v1/pipelines/${pipelineId}/shots/${sceneId}/${shotId}/skip-video-critic-failure`,
      {},
    ),
  /**
   * Phase 1D.2c-b-ii §9 (J1) — Regenerate button on the per-shot video-critic
   * surface. Backend strips every `video_critic_*` field from the shot and
   * re-enqueues the orchestrator so Stage 7 re-runs `processShot` for this
   * shot with a fresh critic retry budget. Same 409 gate as the skip route.
   */
  retryShotVideoGeneration: (pipelineId: string, sceneId: string, shotId: string) =>
    postJson<{ ok: true }>(
      `/v1/pipelines/${pipelineId}/shots/${sceneId}/${shotId}/retry-video-generation`,
      {},
    ),
  getStage: (id: string, stage: PipelineStageName) =>
    getJson<{ status: string; output: unknown; critic_feedback: unknown }>(
      `/v1/pipelines/${id}/stages/${stage}`,
    ),
  /**
   * Phase 0 — assembled timeline (ordered scene composites + their durations +
   * music/narration URLs) the studio turns into a Remotion SceneGraph.
   */
  getTimeline: (id: string) =>
    getJson<PipelineTimelineInput>(`/v1/pipelines/${id}/timeline`),
  eventsUrl: (id: string) => `${API_BASE}/v1/pipelines/${id}/events`,
  /**
   * Phase 1B.4 — fork a running pipeline. Backend response matches
   * `ForkResult` in `backend/src/ee/pipelines/fork.ts`. Idempotent: a second
   * call against an already-forked pipeline returns the original `forkedAt`.
   */
  forkPipeline: (
    id: string,
  ): Promise<{
    ok: true
    pipelineId: string
    forkedAt: string
    forkedStatus: string
    forkReason: string
  }> => postJson(`/v1/pipelines/${id}/fork`, {}),
  /**
   * Phase 1C.2 — Approve a Stage 7 sub-gate (`silent_cut_preview` or
   * `dialogue_recheck`). Clears `current_sub_gate` server-side and resumes
   * the orchestrator from the next sub-step.
   */
  approveSubGate: (
    pipelineId: string,
    gate: SubGateName,
  ): Promise<{ ok: true; gate: SubGateName; resumed_at: string }> =>
    postJson(`/v1/pipelines/${pipelineId}/sub-gates/${gate}/approve`, {}),
  /**
   * Phase 1C.2 — Reject a Stage 7 sub-gate. Fails the stage with
   * `failure_reason='sub_gate_rejected:<gate>'`; unspent credits refund.
   * Feedback is stashed on the stage output for the (1D) branch-from-stage
   * resume path.
   */
  rejectSubGate: (
    pipelineId: string,
    gate: SubGateName,
    feedback?: string,
  ): Promise<{ ok: false; gate: SubGateName; reason: string }> =>
    postJson(`/v1/pipelines/${pipelineId}/sub-gates/${gate}/reject`, {
      feedback,
    }),
  /**
   * Run a §6.11 scene-context helper. The generic ties the helper name to its
   * expected body shape (compile-time error if the wrong body is passed) and
   * its returned result shape.
   */
  runSceneHelper<N extends keyof SceneHelperBody>(
    pipelineId: string,
    sceneId: string,
    name: N,
    body: SceneHelperBody[N],
  ): Promise<SceneHelperResult[N]> {
    return postJson<SceneHelperResult[N]>(
      `/v1/pipelines/${pipelineId}/entities/${sceneId}/helpers/${name}`,
      body ?? {},
    )
  },
  /**
   * Phase 1D.3 — Branch a completed pipeline from a specific approved stage.
   * Clones all upstream stages as 'approved' and re-runs from `fromStage`.
   * Returns the new pipeline id + lists of cloned entity ids.
   *
   * URL: POST /v1/pipelines/:id/branch
   * Errors: 400 `pipeline_not_completed` | `invalid_stage`; 403 `forbidden`; 404 `pipeline_not_found`
   */
  branch: (
    id: string,
    fromStage: PipelineStageName,
  ): Promise<{
    pipelineId: string
    clonedStages: string[]
    clonedEntities: string[]
  }> => postJson(`/v1/pipelines/${id}/branch`, { fromStage }),

  /**
   * Phase 1D.1 — Zero-credit action that flips `accepted_match_cut_break=true`
   * on the target shot and removes it from `match_cut_break_pending` in Stage 6
   * output. When the list empties the sub-gate is cleared and the pipeline can
   * advance to Stage 7.
   *
   * URL: POST /v1/pipelines/:id/entities/:sceneId/helpers/accept_match_cut_break
   */
  acceptMatchCutBreak(
    pipelineId: string,
    sceneId: string,
    shotId: string,
  ): Promise<{ ok: true; pendingRemaining: number }> {
    return postJson(`/v1/pipelines/${pipelineId}/entities/${sceneId}/helpers/accept_match_cut_break`, {
      shotId,
    })
  },

  /**
   * Phase 1D.2a §4.5 — Flip a pipeline running in `auto` or `guided` mode to
   * `manual`. Allowed only while `status ∈ {running, awaiting_approval}`. The
   * backend enforces the same gate; failed runs use the Branch path instead.
   * The current target is intentionally restricted to `manual` — auto↔guided
   * switching is not part of this phase.
   */
  patchMode: (
    pipelineId: string,
    mode: "manual",
  ): Promise<{ ok: true; mode: "manual" }> =>
    patchJson(`/v1/pipelines/${pipelineId}`, { mode }),

  /**
   * Phase 1D.2b — Guided-mode chat. Fetch the chat history for a stage.
   * Returns `{ turns: [] }` when the stage has no turns yet. The frontend
   * panel calls this on initial mount; subsequent updates arrive via the
   * `chat:turn` SSE event (handled in `use-pipeline-events.ts`).
   */
  fetchChat: (
    pipelineId: string,
    stage: ChatEnabledStage,
  ): Promise<{ turns: ChatTurn[] }> =>
    getJson(`/v1/pipelines/${pipelineId}/stages/${stage}/chat`),

  /**
   * Phase 1D.2b — Send a chat message to the Showrunner Refinement Director.
   * Persists user + assistant turns and returns the assistant's reply plus
   * an optional `proposed_change` the user can accept via `applyChat`.
   */
  postChat: (
    pipelineId: string,
    stage: ChatEnabledStage,
    message: string,
  ): Promise<ChatStageResult> =>
    postJson(`/v1/pipelines/${pipelineId}/stages/${stage}/chat`, { message }),

  /**
   * Phase 1D.2b — Accept a proposed_change from a prior assistant turn.
   * Validates the JSON Patch + stage schema + reference integrity, then
   * persists a new pipeline_stage_attempts row and CAS-flips the stage to
   * approved. On recoverable failures (schema_invalid /
   * reference_integrity_failed) the backend inserts a follow-up assistant
   * turn with a hint and returns `{ applied: false, error }`.
   */
  applyChat: (
    pipelineId: string,
    stage: ChatEnabledStage,
    turnId: string,
  ): Promise<ApplyChatProposalResult> =>
    postJson(
      `/v1/pipelines/${pipelineId}/stages/${stage}/chat/turns/${turnId}/apply`,
      {},
    ),
}

export type { PipelineEvent }
