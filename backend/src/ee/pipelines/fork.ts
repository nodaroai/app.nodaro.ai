import type { SupabaseClient } from "@supabase/supabase-js"
import { refundPipelineCredits } from "./credits.js"
import { pipelineEvents } from "./events.js"
import { orphanAllEntityNodes } from "./depends-on.js"

/**
 * Phase 1B.4 — pipeline-level fork (user takes over creative control).
 *
 * When the user forks a pipeline, the orchestrator releases ownership of
 * every entity it created so the canvas survives and the user keeps the
 * work — but no future stages run and no more credits are spent.
 *
 * Side effects (single function — Supabase JS doesn't expose transactions
 * across .from() calls, so we accept best-effort consistency since fork is
 * a terminal operation):
 *   1. `pipelines.status = 'forked'`, `forked_at = now()`,
 *      `fork_reason = <reason>`, `forked_status = <prior status>` so the UI
 *      can render "Forked from approval" vs "Forked mid-stage".
 *   2. `pipeline_entities.is_forked = true` for ALL entities.
 *   3. `pipeline_entity_nodes.pipeline_state = 'pipeline_orphaned'` for ALL
 *      nodes (via {@link orphanAllEntityNodes}). The canvas nodes survive;
 *      only the pipeline's claim on them is released.
 *   4. Refund the unspent reservation
 *      (`pipelines.reservation_usage_log_id`) via
 *      {@link CreditsService.refundCredits}.
 *   5. Emit `pipeline:forked` event so the SSE stream + DriftBanner + canvas
 *      visuals can react.
 *
 * Idempotent: if `pipelines.forked_at` is already set, the helper returns
 * the existing result without touching anything else.
 *
 * Caller (route handler) is responsible for cancelling queued BullMQ jobs;
 * this helper does NOT touch the queue.
 */
export type ForkReason = "user_takeover" | "drift_unrecoverable"

export interface ForkResult {
  ok: true
  pipelineId: string
  forkedAt: string
  forkedStatus: string
  forkReason: ForkReason
}

export async function forkPipeline(
  supabase: SupabaseClient,
  pipelineId: string,
  reason: ForkReason = "user_takeover",
): Promise<ForkResult> {
  const { data: pipeline, error: readErr } = await supabase
    .from("pipelines")
    .select("status, user_id, reservation_usage_log_id, forked_at, forked_status, fork_reason")
    .eq("id", pipelineId)
    .single()
  if (readErr) throw new Error(`forkPipeline read: ${readErr.message}`)
  if (!pipeline) throw new Error(`forkPipeline: pipeline ${pipelineId} not found`)

  // Idempotency — second call returns the existing fork state without
  // re-emitting events or re-refunding.
  if (pipeline.forked_at) {
    return {
      ok: true,
      pipelineId,
      forkedAt: pipeline.forked_at as string,
      forkedStatus: (pipeline.forked_status as string | null) ?? (pipeline.status as string),
      forkReason: (pipeline.fork_reason as ForkReason | null) ?? reason,
    }
  }

  const forkedAt = new Date().toISOString()
  const priorStatus = (pipeline.status as string) ?? "unknown"

  // The three independent state writes (pipeline row + entity flag + node
  // orphaning) touch disjoint rows and can race safely. Refund runs AFTER
  // they settle so its `reservation_usage_log_id = null` clear lands on a
  // pipeline row whose status is already `forked` (consistent post-state).
  await Promise.all([
    supabase
      .from("pipelines")
      .update({
        status: "forked",
        forked_at: forkedAt,
        fork_reason: reason,
        forked_status: priorStatus,
      })
      .eq("id", pipelineId),
    supabase
      .from("pipeline_entities")
      .update({ is_forked: true })
      .eq("pipeline_id", pipelineId),
    orphanAllEntityNodes(supabase, pipelineId),
  ])

  // Canonical refund path — looks up `reservation_usage_log_id`, refunds via
  // `refund_credits` RPC, and clears the link so re-runs are a fast no-op.
  await refundPipelineCredits({
    supabase,
    userId: (pipeline.user_id as string) ?? "",
    pipelineId,
    reason: `fork:${reason}`,
  })

  pipelineEvents.publish({
    type: "pipeline:forked",
    pipelineId,
    forkedAt,
    forkedStatus: priorStatus,
    forkReason: reason,
  })

  return {
    ok: true,
    pipelineId,
    forkedAt,
    forkedStatus: priorStatus,
    forkReason: reason,
  }
}
