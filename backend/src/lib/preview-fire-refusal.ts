/**
 * The fire lanes' half of "nobody is there to review" (decided 2026-10-04).
 *
 * A schedule, a webhook or a Telegram trigger fires a run nobody watches: if
 * the branch it runs holds a Preview render, the run would bill the upstream
 * and a preview no one reviews while every delivery node behind it stays
 * silent. The lane refuses BEFORE it creates an execution or enqueues — with
 * ONE visible failed row carrying the stable code, deduped like every other
 * fire refusal (`recordTriggerFireRefusal`), because a schedule ticks forever
 * and a webhook can be hammered at its rate limit.
 *
 * The orchestrator asks the same question of every run it picks up (the wall
 * every lane passes); this check is what keeps a refused trigger from writing
 * one failed row per tick. A graph it cannot read is left to that wall.
 *
 * While the rollout flag is off (`PREVIEW_STOP_RULE_ENABLED`) it answers "not
 * refused" before reading anything, so a fire costs what it did before.
 */
import { PREVIEW_REVIEW_REQUIRED } from "@nodaro/shared"
import { supabase } from "./supabase.js"
import { recordTriggerFireRefusal } from "./trigger-fire-refusal.js"
import { previewReviewRefusal } from "./preview-review-gate.js"
import { previewStopRuleEnabled } from "./preview-stop-rule-flag.js"

export async function refusePreviewFire(args: {
  workflowId: string
  userId: string
  triggerType: "webhook" | "schedule" | "telegram" | "telegram_account"
  triggerId?: string
  /** The trigger node this fire starts from — the branch it runs. */
  triggerNodeId?: string | null
}): Promise<boolean> {
  if (!previewStopRuleEnabled()) return false
  let refused = false
  try {
    const { data, error } = await supabase
      .from("workflows")
      .select("nodes, edges")
      .eq("id", args.workflowId)
      .single()
    if (error || !data) return false
    const row = data as { nodes?: unknown; edges?: unknown }
    refused =
      previewReviewRefusal(
        Array.isArray(row.nodes) ? row.nodes : [],
        Array.isArray(row.edges) ? row.edges : [],
        { triggerType: args.triggerType, triggerNodeId: args.triggerNodeId },
      ) !== null
  } catch (err) {
    console.warn(
      `[trigger-fire] preview check skipped for workflow ${args.workflowId}:`,
      err instanceof Error ? err.message : String(err),
    )
    return false
  }
  if (!refused) return false
  await recordTriggerFireRefusal({
    workflowId: args.workflowId,
    userId: args.userId,
    triggerType: args.triggerType,
    triggerId: args.triggerId,
    code: PREVIEW_REVIEW_REQUIRED,
  })
  return true
}
