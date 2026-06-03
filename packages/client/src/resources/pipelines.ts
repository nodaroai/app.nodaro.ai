import type { NodaroClient } from "../client.js"
import type {
  PipelineInput,
  PipelineStageName,
  PipelineStatus,
  PipelineMode,
  SubGateName,
  ChatEnabledStage,
  ProposedChange,
} from "@nodaro/shared"

export type {
  PipelineInput,
  PipelineStageName,
  PipelineStatus,
  PipelineMode,
  SubGateName,
  ChatEnabledStage,
  ProposedChange,
}

/**
 * Owner-scoped pipeline record returned by `get` / `list` (the server strips
 * `user_id`). Mirrors the public field set of `GET /v1/pipelines/:id`.
 */
export interface PipelineRecord {
  id: string
  status: PipelineStatus
  current_stage: string | null
  spent_credits: number
  reserved_credits: number
  upfront_credit_estimate: number
  branched_from_pipeline_id: string | null
  branched_from_stage: string | null
  mode: PipelineMode | null
  failure_reason: string | null
  current_progress_message: string | null
}

/** One stage currently awaiting approval (from `pendingApprovals`). */
export interface PendingApproval {
  stage_name: PipelineStageName
  /** Stage output snapshot; shape varies by stage. */
  output: unknown
}

/**
 * Assembled timeline (`GET /v1/pipelines/:id/timeline`) — ordered scene
 * composites + their durations, plus optional music/narration and live
 * per-shot animate progress. The data the studio turns into a render.
 */
export interface PipelineTimeline {
  fps: number
  width: number
  height: number
  scenes: Array<{ compositeUrl: string; durationSeconds: number }>
  musicUrl?: string
  narrationUrl?: string
  animateProgress?: {
    totalShots: number
    shotsDone: number
    percent: number
  }
}

export interface BranchPipelineInput {
  /** The stage to re-run from. Upstream stages are cloned as approved. */
  fromStage: PipelineStageName
}

export interface BranchPipelineResult {
  /** The id of the newly created pipeline. */
  pipelineId: string
  /** Stage names that were cloned as 'approved' (stages before `fromStage`). */
  clonedStages: string[]
  /** Number of entity rows cloned into the new pipeline. */
  clonedEntities: number
}

/**
 * A single chat turn returned by `getStageChat`. Mirrors the
 * `pipeline_chat_turns` row shape selected by the GET handler.
 *
 * `@nodaro/shared` does not yet export a Zod schema for the full row; it only
 * exports `ChatTurnResponseSchema` (the LLM response shape) and the
 * `ProposedChange` discriminated union. Define the wire-format row locally so
 * callers get end-to-end typing today without re-shaping the backend payload.
 */
export interface ChatTurn {
  id: string
  turn_n: number
  role: "user" | "assistant"
  content: string
  proposed_change: ProposedChange | null
  llm_call_id: string | null
  applied_to_attempt_id: string | null
  created_at: string
}

/**
 * Result of `chatStage` — the assistant turn that was just persisted. The
 * route always echoes the assistant message back so callers can render the
 * reply without a follow-up GET (SSE is the secondary delivery channel).
 */
export interface ChatStageResult {
  turnId: string
  role: "assistant"
  content: string
  proposed_change: ProposedChange | null
}

/**
 * Result of `applyChatProposal`. Discriminated on `applied`:
 *
 * - `applied: true` — `applyStageEdit` validated + persisted a new attempt and
 *   flipped the stage to approved. `newOutput` is the post-patch artifact.
 * - `applied: false` — recoverable failure (schema_invalid or
 *   reference_integrity_failed); the backend has already inserted a follow-up
 *   assistant turn with a human-readable hint so the user can iterate via
 *   chat. Hard failures throw via the client's error pipeline (409).
 */
export type ApplyChatProposalResult =
  | { applied: true; attemptId: string; newOutput: unknown }
  | { applied: false; error: { code: string; detail?: unknown } }

export class PipelinesResource {
  constructor(private client: NodaroClient) {}

  /**
   * Start a new pipeline (headless film generation) — the programmatic
   * equivalent of the studio's "Create film". In Auto mode the engine
   * self-advances to completion; poll {@link get} for status and
   * {@link getTimeline} for the assembled output. In manual/guided mode, drive
   * it with {@link pendingApprovals} + {@link approveStage} /
   * {@link approveSubGate}.
   *
   * Requires `pipelines:execute` scope. Returns the new pipeline id.
   */
  create(input: PipelineInput): Promise<{ id: string }> {
    return this.client.request("POST", "/v1/pipelines", { body: input })
  }

  /**
   * Fetch current pipeline state: `status`, `current_stage`, credit counters,
   * `mode`, and `failure_reason` (set when `status='failed'`). Poll this to
   * track a headless Auto run to completion. Requires `pipelines:read`.
   */
  get(id: string): Promise<PipelineRecord> {
    return this.client.request(
      "GET",
      `/v1/pipelines/${encodeURIComponent(id)}`,
    )
  }

  /** List the caller's pipelines (most recent first). Requires `pipelines:read`. */
  list(): Promise<PipelineRecord[]> {
    return this.client.request("GET", "/v1/pipelines")
  }

  /**
   * Cancel a running pipeline. Unspent reserved credits refund. Idempotent on
   * an already-terminal pipeline. Requires `pipelines:execute`.
   */
  cancel(id: string): Promise<{ ok: true }> {
    return this.client.request(
      "POST",
      `/v1/pipelines/${encodeURIComponent(id)}/cancel`,
      { body: {} },
    )
  }

  /**
   * Stages currently `awaiting_approval`. Empty in a clean Auto run (the engine
   * self-approves); populated in manual/guided mode at each gate. Requires
   * `pipelines:read`.
   */
  pendingApprovals(id: string): Promise<PendingApproval[]> {
    return this.client.request(
      "GET",
      `/v1/pipelines/${encodeURIComponent(id)}/pending-approvals`,
    )
  }

  /**
   * Approve a stage so the engine advances to the next one. An optional `edits`
   * JSON-Patch is applied to the stage output before approval. Requires
   * `pipelines:approve`.
   */
  approveStage(
    id: string,
    stage: PipelineStageName,
    edits?: unknown,
  ): Promise<{ ok: true }> {
    return this.client.request(
      "POST",
      `/v1/pipelines/${encodeURIComponent(id)}/stages/${encodeURIComponent(stage)}/approve`,
      { body: edits ? { edits } : {} },
    )
  }

  /**
   * Reject a stage with feedback; the engine re-runs it incorporating the note.
   * Requires `pipelines:approve`.
   */
  rejectStage(
    id: string,
    stage: PipelineStageName,
    feedback: string,
  ): Promise<{ ok: true }> {
    return this.client.request(
      "POST",
      `/v1/pipelines/${encodeURIComponent(id)}/stages/${encodeURIComponent(stage)}/reject`,
      { body: { feedback } },
    )
  }

  /**
   * Approve a Stage-7 sub-gate (`dialogue_recheck` / `silent_cut`) so the
   * orchestrator resumes from the next sub-step. Requires `pipelines:approve`.
   */
  approveSubGate(
    id: string,
    gate: SubGateName,
  ): Promise<{ ok: true; gate: SubGateName; resumed_at: string }> {
    return this.client.request(
      "POST",
      `/v1/pipelines/${encodeURIComponent(id)}/sub-gates/${encodeURIComponent(gate)}/approve`,
      { body: {} },
    )
  }

  /**
   * Read a single stage's `status`, `output`, and `critic_feedback`. Useful for
   * inspecting the script/plan before approving. Requires `pipelines:read`.
   */
  getStage(
    id: string,
    stage: PipelineStageName,
  ): Promise<{ status: string; output: unknown; critic_feedback: unknown }> {
    return this.client.request(
      "GET",
      `/v1/pipelines/${encodeURIComponent(id)}/stages/${encodeURIComponent(stage)}`,
    )
  }

  /**
   * Assembled timeline — ordered scene composites + durations + audio URLs +
   * live animate progress. The output a headless caller renders or hands to a
   * downstream editor. Requires `pipelines:read`.
   */
  getTimeline(id: string): Promise<PipelineTimeline> {
    return this.client.request(
      "GET",
      `/v1/pipelines/${encodeURIComponent(id)}/timeline`,
    )
  }

  /**
   * Branch a completed pipeline into a new pipeline that re-runs from the
   * given stage. The original pipeline's upstream stages and entities are
   * cloned into the new pipeline; downstream stages are created by the
   * orchestrator as it advances.
   *
   * Requires `pipelines:execute` scope.
   * The source pipeline must have `status='completed'`.
   *
   * @returns 201 with `{ pipelineId, clonedStages, clonedEntities }`.
   */
  branch(id: string, input: BranchPipelineInput): Promise<BranchPipelineResult> {
    return this.client.request(
      "POST",
      `/v1/pipelines/${encodeURIComponent(id)}/branch`,
      { body: input },
    )
  }

  /**
   * Send a chat message to the Showrunner Refinement Director (Guided Mode).
   * Persists user + assistant turns; returns the assistant's reply and an
   * optional `proposed_change` the user can `applyChatProposal` to commit.
   *
   * Requires `pipelines:approve` scope. The pipeline must have
   * `mode='guided'` and the stage must be `awaiting_approval`.
   *
   * Only the Script stage ships a wired specialist in Phase 1D.2b — the other
   * chat-enabled stages (`shot_list`, `post_merge`) return 501 until 1D.2d.
   */
  chatStage(
    pipelineId: string,
    stage: ChatEnabledStage,
    message: string,
  ): Promise<ChatStageResult> {
    return this.client.request(
      "POST",
      `/v1/pipelines/${encodeURIComponent(pipelineId)}/stages/${encodeURIComponent(stage)}/chat`,
      { body: { message } },
    )
  }

  /**
   * Accept a proposed change from a prior assistant turn. Routes through
   * `applyStageEdit` (validates JSON Patch + per-stage schema +
   * reference-integrity, inserts a new pipeline_stage_attempts row, CAS-flips
   * the stage to approved, emits `chat:proposal_applied` SSE).
   *
   * Requires `pipelines:approve` scope.
   *
   * Returns `{ applied: true, attemptId, newOutput }` on success, or
   * `{ applied: false, error }` on recoverable failures (the backend already
   * inserted a follow-up assistant turn with a hint). Hard failures
   * (`patch_invalid`, `stage_not_awaiting`) throw via the standard error
   * pipeline (HTTP 409).
   */
  applyChatProposal(
    pipelineId: string,
    stage: ChatEnabledStage,
    turnId: string,
  ): Promise<ApplyChatProposalResult> {
    return this.client.request(
      "POST",
      `/v1/pipelines/${encodeURIComponent(pipelineId)}/stages/${encodeURIComponent(stage)}/chat/turns/${encodeURIComponent(turnId)}/apply`,
      { body: {} },
    )
  }

  /**
   * Fetch the chat history for a stage. Returns an empty array when no turns
   * exist yet (e.g., stage has not been started or the user hasn't sent any
   * messages). Used by the frontend chat panel on initial mount; subsequent
   * updates arrive via SSE (`chat:turn` events).
   *
   * Requires `pipelines:read` scope.
   */
  getStageChat(
    pipelineId: string,
    stage: ChatEnabledStage,
  ): Promise<{ turns: ChatTurn[] }> {
    return this.client.request(
      "GET",
      `/v1/pipelines/${encodeURIComponent(pipelineId)}/stages/${encodeURIComponent(stage)}/chat`,
    )
  }
}
