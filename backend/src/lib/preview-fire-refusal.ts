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
import { PREVIEW_REVIEW_REQUIRED } from "@nodaro/shared/nodes"
import { previewRefusalCode } from "@nodaro/render-rules"
import { supabase } from "./supabase.js"
import { recordTriggerFireRefusal } from "./trigger-fire-refusal.js"
import { previewReviewHold, type PreviewRefusal } from "./preview-review-gate.js"
import { previewRefusalMessage } from "./preview-refusal-copy.js"
import type { PreviewHoldKind } from "@nodaro/render-rules"
import { previewStopRuleEnabled } from "./preview-stop-rule-flag.js"

export async function refusePreviewFire(args: {
  workflowId: string
  userId: string
  triggerType: "webhook" | "schedule" | "telegram" | "telegram_account"
  triggerId?: string
  /** The trigger node this fire starts from — the branch it runs. */
  triggerNodeId?: string | null
}): Promise<PreviewRefusal | null> {
  if (!previewStopRuleEnabled()) return null
  let held: PreviewHoldKind | null = null
  try {
    const { data, error } = await supabase
      .from("workflows")
      .select("nodes, edges")
      .eq("id", args.workflowId)
      .single()
    if (error || !data) return null
    const row = data as { nodes?: unknown; edges?: unknown }
    held = previewReviewHold(
      Array.isArray(row.nodes) ? row.nodes : [],
      Array.isArray(row.edges) ? row.edges : [],
      { triggerType: args.triggerType, triggerNodeId: args.triggerNodeId },
    )
  } catch (err) {
    console.warn(
      `[trigger-fire] preview check skipped for workflow ${args.workflowId}:`,
      err instanceof Error ? err.message : String(err),
    )
    return null
  }
  if (!held) return null
  // The row carries what held the branch in its code (a render's keeps the
  // code it always had): the editor names the remedy from it.
  await recordTriggerFireRefusal({
    workflowId: args.workflowId,
    userId: args.userId,
    triggerType: args.triggerType,
    triggerId: args.triggerId,
    code: previewRefusalCode("headless", held),
  })
  // The refusal a caller that answers sends: the route's stable code, the holders' remedy.
  return { code: PREVIEW_REVIEW_REQUIRED, message: previewRefusalMessage("headless", held) }
}
