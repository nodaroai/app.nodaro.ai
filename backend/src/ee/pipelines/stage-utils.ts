import type { SupabaseClient } from "@supabase/supabase-js"
import type { PipelineStageName } from "@nodaro/shared"
import { IMAGE_CRITIC_UNRESOLVABLE } from "@nodaro/shared"
import { pipelineEvents } from "./events.js"

/**
 * When the user hits "Redo" on a generated entity image at the approval gate,
 * `rejectEntity` stores their note in `metadata.last_reject_feedback` and
 * re-drives the stage. This appends that note to the regeneration prompt so the
 * new image actually addresses what the user disliked — without it, a Redo just
 * re-rolls the same prompt and the feedback is silently dropped. Returns "" when
 * there's no feedback so the prompt is unchanged on a first generation.
 */
export function rejectFeedbackSuffix(
  metadata: Record<string, unknown> | null | undefined,
): string {
  const fb = metadata?.last_reject_feedback
  if (typeof fb !== "string" || !fb.trim()) return ""
  return `. Revision note — address this feedback from the previous attempt: ${fb.trim()}`
}

/**
 * Manual/guided recovery for `failed` entities. A failed entity must NOT let the
 * stage advance — the engine used to fall through to "stage approved" past a
 * failed entity (e.g. an image that failed on a credit error), silently moving
 * the run on with a missing asset. This sends every `failed` entity back to the
 * `pending_description` choose-gate, which both:
 *   1. holds the stage open (pending_description always pauses for the user), and
 *   2. lets the user edit the description / regenerate / upload / reuse / skip
 *      via the normal Step A gate — no separate failed-entity UI needed.
 *
 * Returns a NEW array with the failed rows' status normalized to
 * `pending_description` so the caller's loop sees the recovered state without a
 * re-fetch. The DB write + SSE happen here. Auto mode is a no-op — its failure
 * path is the image-critic aggregator, not user recovery.
 */
export async function recoverFailedEntitiesToChoose<
  T extends { id: string; entity_key: string; status: string },
>(
  supabase: SupabaseClient,
  pipelineId: string,
  entityType: "character" | "object" | "location",
  entities: ReadonlyArray<T>,
  mode: string | undefined,
): Promise<T[]> {
  if (mode === "auto") return [...entities]
  const out: T[] = []
  for (const e of entities) {
    if (e.status !== "failed") {
      out.push(e)
      continue
    }
    await supabase
      .from("pipeline_entities")
      .update({ status: "pending_description" })
      .eq("id", e.id)
    pipelineEvents.publish({
      type: "entity:status",
      pipelineId,
      entityId: e.id,
      entityType,
      entityKey: e.entity_key,
      status: "pending_description",
    })
    out.push({ ...e, status: "pending_description" })
  }
  return out
}

/**
 * Atomically increments pipeline_stages.critic_retry_count by 1.
 * The DB CHECK enforces critic_retry_count <= 2 — if this would exceed it,
 * the UPDATE fails and the caller should treat it as "retry budget exhausted."
 *
 * Returns the new count, or null if the row couldn't be updated (cap hit).
 */
export async function incrementCriticRetry(
  supabase: SupabaseClient,
  stageId: string,
): Promise<number | null> {
  const { data: current } = await supabase
    .from("pipeline_stages")
    .select("critic_retry_count")
    .eq("id", stageId)
    .single()
  const next = (current?.critic_retry_count ?? 0) + 1
  if (next > 2) return null
  const { error } = await supabase
    .from("pipeline_stages")
    .update({ critic_retry_count: next })
    .eq("id", stageId)
  if (error) return null
  return next
}

/**
 * Idempotent create-or-fetch of a pipeline_stages row for (pipelineId, stageName).
 * UNIQUE(pipeline_id, stage_name) makes the second create idempotent.
 */
export async function ensureStageRow(
  supabase: SupabaseClient,
  pipelineId: string,
  stageName: PipelineStageName,
  stageOrder: number,
): Promise<string> {
  const { data: existing } = await supabase
    .from("pipeline_stages")
    .select("id")
    .eq("pipeline_id", pipelineId)
    .eq("stage_name", stageName)
    .maybeSingle()
  if (existing?.id) return existing.id
  const { data, error } = await supabase
    .from("pipeline_stages")
    .insert({
      pipeline_id: pipelineId,
      stage_name: stageName,
      stage_order: stageOrder,
      status: "running",
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single()
  if (error || !data)
    throw new Error(`Failed to create stage row for ${stageName}: ${error?.message}`)
  return data.id
}

/**
 * Marks a stage as failed with a structured reason.
 */
export async function failStage(
  supabase: SupabaseClient,
  stageId: string,
  reason: string,
): Promise<void> {
  await supabase
    .from("pipeline_stages")
    .update({
      status: "failed",
      output: { failure_reason: reason },
      completed_at: new Date().toISOString(),
    })
    .eq("id", stageId)
}

/**
 * Phase 1D.2a §4.1: bulk-flip every `awaiting_approval` entity for this
 * pipeline+entity_type to `approved`, then batch-flip the matching
 * `pipeline_entity_nodes` rows from `pipeline_owned_awaiting_approval` →
 * `pipeline_owned_approved` (emitting one `entity:state_change` SSE per
 * touched node). Idempotent — safe to call multiple times in the same pass.
 *
 * Used by auto-mode in Stages 2/3/4/5/6 to advance without user gating.
 * Does NOT flip the `pipeline_stages` row or emit `stage:status` —
 * callers handle the stage-level transition because they vary on timing
 * (e.g., characters phase 1 leaves the stage `running` while variants
 * generate; phase 2 flips to `approved`).
 */
export async function bulkApproveStageEntities(
  supabase: SupabaseClient,
  pipelineId: string,
  entityType: "character" | "object" | "location" | "scene",
  emitLabel: string,
): Promise<void> {
  const { transitionStageEntityNodesAndEmit } = await import("./depends-on.js")
  await supabase
    .from("pipeline_entities")
    .update({ status: "approved" })
    .eq("pipeline_id", pipelineId)
    .eq("entity_type", entityType)
    .eq("status", "awaiting_approval")
  await transitionStageEntityNodesAndEmit(
    supabase,
    pipelineId,
    entityType,
    "pipeline_owned_approved",
    emitLabel,
  )
}

/**
 * Phase 1D.2c-a §6 (D1): scans an already-loaded entities array and returns
 * those whose `metadata.last_error === IMAGE_CRITIC_UNRESOLVABLE`. Used by
 * auto-mode in Stages 2 (characters) and 4 (locations) to detect entities
 * force-failed by the image-critic cap exhaustion before deciding whether to
 * advance the stage.
 *
 * Callers MUST pass entities already filtered by entity_type — the helper
 * does NOT re-query the DB (callers always have the freshly-loaded array
 * a few lines earlier in the stage handler).
 */
export function detectImageCriticFailures(
  entities: ReadonlyArray<{
    id: string
    entity_key: string
    metadata: Record<string, unknown> | null
  }>,
): Array<{ id: string; entity_key: string }> {
  return entities
    .filter(
      (e) =>
        (e.metadata as { last_error?: string } | null)?.last_error ===
        IMAGE_CRITIC_UNRESOLVABLE,
    )
    .map((e) => ({ id: e.id, entity_key: e.entity_key }))
}

/**
 * Documented set of `*_unresolvable` reasons emitted by Stage 2/4/7 auto-mode
 * aggregators. The Stage 1 (Script) caller also uses this helper — it passes
 * `"script_critic_unresolvable"` on cap-reached failures AND arbitrary
 * `err.message` strings on uncaught Showrunner errors. The DB column
 * `pipelines.failure_reason` is `text`, so `string` is the runtime contract;
 * the literal union is preserved as documentation + autocomplete for the
 * known reason set.
 */
export type CriticFailureReason =
  | "characters_image_critic_unresolvable"
  | "locations_image_critic_unresolvable"
  | "video_critic_unresolvable"
  | "script_critic_unresolvable"
  // Catch-block escape hatch — Stage 1 emits `err.message` from runShowrunner /
  // runScriptCritic failures, and the column accepts any string.
  | (string & {})

/**
 * Shared SELECT shape for the 3 fields needed by the auto-mode critic-failure
 * aggregator at Stage 2/4/7: `user_id` for the refund call, plus
 * `reserved_credits` / `spent_credits` to compute the refund delta. Each
 * stage's handler does `select("user_id, reserved_credits, spent_credits")`
 * up front so it can call `failPipelineWithCriticReason` without a second
 * round-trip. Stage 7's handler also needs `config`, `mode`, and
 * `target_duration_seconds` from the same row — it extends this interface
 * rather than repeating the 3 fields.
 */
export interface CriticRefundFields {
  user_id: string | null
  reserved_credits: number | null
  spent_credits: number | null
}

/**
 * Phase 1D.2c-a §6 (D1) — originally introduced for the Stage 2/4 image
 * critic. Phase 1D.2c-b-ii (E1) generalized the helper to the Stage 7 video
 * critic. Phase 1D.2c follow-up extended the helper to ALSO cover Stage 1
 * (Script) failures. /simplify pass-2 consolidates the per-caller aggregator
 * boilerplate into the helper itself:
 *   - The 3-times-duplicated `reserved/spent/userId/refundCredits` derivation
 *     at Stage 2/4/7 collapses into a single `pipelineRow: CriticRefundFields
 *     | null` arg — the helper computes the refund delta + reads userId.
 *   - The redundant `outputPatch: { failure_reason }` arg (where the string
 *     always matched `failureReason`) becomes implicit. `outputPatch` is now a
 *     3-state contract:
 *       • undefined (default) → writes `{ failure_reason }` automatically.
 *       • explicit `null`     → skips the `output` write entirely (Stage 1's
 *         pre-refactor behavior — its failure surface is `critic_feedback`,
 *         not `output`).
 *       • explicit object     → writes the provided object verbatim.
 *
 * Order of operations (matters when individual steps can throw):
 *   1. Flip the pipeline_stages row to failed (mirrors engine.ts script-stage
 *      failure — without this the stage row stays at `running` while the
 *      pipeline is `failed`, leaving the UI rendering an "in progress" stage
 *      for a dead pipeline). `critic_feedback` + `output` columns are touched
 *      only when the caller's contract says so (see `outputPatch` semantics
 *      above; `criticFeedback` is opt-in).
 *   2. Flip the pipeline row to `failed` + `failure_reason=<reason>`.
 *   3. Emit `pipeline:status failed` + `stage:status failed` SSE.
 *   4. Refund unspent credits via `refundPipelineCredits` (only when the
 *      derived `refundCredits > 0`). Wrapped in try/catch — a refund failure
 *      (RPC down, network blip) is best-effort: the cleanup cron sweeps
 *      unrefunded reservations on the next pass, but missing the terminal
 *      pipeline-state flip is not recoverable. By doing the refund LAST we
 *      guarantee the pipeline reaches a terminal state even if the RPC call
 *      throws.
 *
 * Auto-mode-only for Stage 2/4/7 — manual/guided keep the failed entity/shot
 * visible so the user can Regenerate. Stage 1 calls the helper regardless of
 * mode (its failure is always terminal).
 */
export async function failPipelineWithCriticReason(args: {
  supabase: SupabaseClient
  pipelineId: string
  failureReason: CriticFailureReason
  stageName: PipelineStageName
  /**
   * The loaded `pipelines` row (or `null` when unavailable — the helper
   * tolerates a missing row by skipping the refund and writing `""` for
   * userId on the refund call, which never fires when `refundCredits=0`).
   * The helper derives `userId` from `pipelineRow.user_id` and
   * `refundCredits = max(0, reserved_credits - spent_credits)` internally —
   * callers no longer compute either themselves.
   */
  pipelineRow: CriticRefundFields | null
  /**
   * Optional structured blob to persist to `pipeline_stages.critic_feedback`
   * alongside the standard stage-row mutation. Stage 1 uses this to carry
   * `{ failure_detail: 'script' | 'cast_coverage' | ... }` so the
   * EntityCard/PipelinePanel can render the specific blocking critic. Stage
   * 2/4/7 omit this — their failure surface is the per-entity/per-shot card
   * metadata, not a stage-level blob.
   */
  criticFeedback?: Record<string, unknown>
  /**
   * Optional blob to persist to `pipeline_stages.output`. Three-state contract:
   *   - `undefined` (default): writes `{ failure_reason }` automatically.
   *     Used by Stage 2/4/7 — matches their pre-refactor inline write without
   *     forcing them to re-type the same string.
   *   - explicit `null`: skips the `output` write entirely. Used by Stage 1
   *     (engine.ts script-arm) — preserves the null output it had before this
   *     helper existed (its failure surface is `critic_feedback`, not
   *     `output`).
   *   - explicit object: writes the provided object verbatim. Reserved for
   *     callers that need custom output content beyond the default
   *     `{ failure_reason }`.
   */
  outputPatch?: Record<string, unknown> | null
}): Promise<void> {
  const {
    supabase,
    pipelineId,
    failureReason,
    stageName,
    pipelineRow,
    criticFeedback,
    outputPatch,
  } = args

  // Derive refund delta + userId from the loaded pipeline row. When the row is
  // null (defensive), refundCredits clamps to 0 — the helper still writes the
  // terminal state + emits SSE, just skips the refund RPC. userId="" is safe
  // because it's only consumed inside the `if (refundCredits > 0)` branch.
  const reserved = pipelineRow?.reserved_credits ?? 0
  const spent = pipelineRow?.spent_credits ?? 0
  const refundCredits = Math.max(0, reserved - spent)
  const userId = pipelineRow?.user_id ?? ""

  // Resolve the effective output write per the 3-state `outputPatch` contract:
  //   undefined → default to `{ failure_reason }`
  //   explicit null → skip the output write (Stage 1)
  //   explicit object → write as-is
  const effectiveOutputPatch =
    outputPatch === null
      ? undefined
      : outputPatch ?? { failure_reason: failureReason }

  // 1. Flip the pipeline_stages row to failed (mirrors engine.ts script-stage
  // failure). Without this, the stage row stays at `running` even though the
  // pipeline is `failed`, leaving the UI rendering a half-dead state. The
  // `output` column is set per the contract above; `critic_feedback` is
  // touched only when the caller supplied a blob (Stage 1 uses it for
  // structured failure_detail; Stage 2/4/7 omit it — their failure surface is
  // per-entity card metadata, not a stage-level blob).
  const stageUpdate: Record<string, unknown> = {
    status: "failed",
    completed_at: new Date().toISOString(),
  }
  if (effectiveOutputPatch !== undefined) {
    stageUpdate.output = effectiveOutputPatch
  }
  if (criticFeedback !== undefined) {
    stageUpdate.critic_feedback = criticFeedback
  }
  await supabase
    .from("pipeline_stages")
    .update(stageUpdate)
    .eq("pipeline_id", pipelineId)
    .eq("stage_name", stageName)

  // 2. Flip the pipeline row to failed with the typed reason.
  await supabase
    .from("pipelines")
    .update({ status: "failed", failure_reason: failureReason })
    .eq("id", pipelineId)

  // 3. Emit SSE: pipeline:status + stage:status. The `pipeline:warning` event
  // was dropped here — no frontend consumer subscribes to it, and the failure
  // surface is already covered by `pipeline:status failed` + the per-stage
  // `failure_reason` written to the pipeline_stages row.
  pipelineEvents.publish({ type: "pipeline:status", pipelineId, status: "failed" })
  pipelineEvents.publish({
    type: "stage:status",
    pipelineId,
    stageName,
    status: "failed",
  })

  // 4. Refund only when there's something to refund. Done LAST so a refund
  // failure (RPC down, network blip) doesn't leave the pipeline stuck in a
  // non-terminal state — the DB writes + SSE above have already persisted the
  // failure. Unrefunded reservations are picked up by the cleanup cron on its
  // next pass.
  if (refundCredits > 0) {
    try {
      const { refundPipelineCredits } = await import("./credits.js")
      await refundPipelineCredits({
        supabase,
        userId,
        pipelineId,
        credits: refundCredits,
        reason: `pipeline_failed:${failureReason}`,
      })
    } catch (err) {
      // Best-effort: pipeline-failed state is already persisted. Log and
      // let the cleanup cron sweep the unrefunded reservation on its next
      // pass.
      console.warn(
        `[failPipelineWithCriticReason] refund failed for pipeline ${pipelineId} (${refundCredits} credits); cleanup-cron will sweep:`,
        err,
      )
    }
  }
}
