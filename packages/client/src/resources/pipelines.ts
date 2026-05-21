import type { NodaroClient } from "../client.js"
import type {
  PipelineStageName,
  ChatEnabledStage,
  ProposedChange,
} from "@nodaro/shared"

export type { PipelineStageName, ChatEnabledStage, ProposedChange }

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
