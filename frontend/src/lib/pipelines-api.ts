import type {
  PipelineInput,
  PipelineEvent,
  PipelineStatus,
  PipelineStageName,
  SubGateName,
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
import { getAuthHeaders } from "@/lib/api"

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
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await getAuthHeaders()),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`)
  return res.json() as Promise<T>
}

export interface PipelineRecord {
  id: string
  status: PipelineStatus
  current_stage: string | null
  spent_credits: number
  reserved_credits: number
  upfront_credit_estimate: number
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
  rejectStage: (id: string, stage: PipelineStageName, feedback: string) =>
    postJson<{ ok: true }>(`/v1/pipelines/${id}/stages/${stage}/reject`, { feedback }),
  approveEntity: (id: string, entityId: string) =>
    postJson<{ ok: true }>(`/v1/pipelines/${id}/entities/${entityId}/approve`, {}),
  rejectEntity: (id: string, entityId: string, feedback: string) =>
    postJson<{ ok: true }>(`/v1/pipelines/${id}/entities/${entityId}/reject`, { feedback }),
  getStage: (id: string, stage: PipelineStageName) =>
    getJson<{ status: string; output: unknown; critic_feedback: unknown }>(
      `/v1/pipelines/${id}/stages/${stage}`,
    ),
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
}

export type { PipelineEvent }
