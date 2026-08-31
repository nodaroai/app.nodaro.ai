/**
 * P14/W6 — the visible tombstone for a refused trigger fire.
 *
 * A trigger outlives the session that created it. When its creator loses the
 * right to run the workflow (grant revoked, membership suspended, workspace
 * archived), every fire lane REFUSES the fire — and without a record, the
 * owner's automation dies silently: the webhook caller sees the same 404 an
 * unknown token gets (deliberate — no oracle), the schedule just skips its
 * tick, and nothing anywhere says why the run history stopped.
 *
 * This writes ONE failed execution row carrying the stable refusal code, so
 * the owner's history shows the reason. One, not one-per-fire: a schedule
 * ticks every interval forever and a revoked webhook can be hammered at its
 * rate limit — so if the LATEST execution for this (workflow, owner, lane)
 * is already this refusal, nothing is written. The tombstone stays current
 * and the table stays clean.
 *
 * Never silently personal: the fire lanes refuse BEFORE any resolve or
 * enqueue, so an ex-member's standing automation cannot fall back to billing
 * their own pocket for class work.
 *
 * Best-effort by design — a bookkeeping failure must never turn a refusal
 * into a crash loop. Two CONCURRENT refused fires can both pass the dedupe
 * read and write two rows — bounded (the lanes are rate-limited or ticked)
 * and harmless, so no lock. The row deliberately carries NO payer pair:
 * resolving a payer for a user who just failed the access predicate is
 * self-contradictory; workspace-scoped history surfaces can join through
 * the workflow's own home if they ever need these rows.
 */
import { supabase } from "./supabase.js"

/** Stable refusal code — P16's history UI branches on this, never on text. */
export const RUN_REQUIRES_AUTHENTICATED_MEMBER = "run_requires_authenticated_member"

export async function recordTriggerFireRefusal(args: {
  workflowId: string
  userId: string
  triggerType: "webhook" | "schedule" | "telegram"
  /** Which trigger died — dedupe stays per (workflow, owner, lane), but the
   *  owner deserves to know which URL/schedule this was. */
  triggerId?: string
}): Promise<void> {
  try {
    const { data: latest } = await supabase
      .from("workflow_executions")
      .select("id, status, error_message")
      .eq("workflow_id", args.workflowId)
      .eq("user_id", args.userId)
      .eq("trigger_type", args.triggerType)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (latest?.status === "failed" && latest.error_message === RUN_REQUIRES_AUTHENTICATED_MEMBER) {
      return // the tombstone is already the latest word — don't spam the history
    }

    await supabase.from("workflow_executions").insert({
      workflow_id: args.workflowId,
      user_id: args.userId,
      status: "failed",
      trigger_type: args.triggerType,
      error_message: RUN_REQUIRES_AUTHENTICATED_MEMBER,
      ...(args.triggerId ? { trigger_data: { triggerId: args.triggerId } } : {}),
      completed_at: new Date().toISOString(),
    })
  } catch (err) {
    console.warn(
      `[trigger-fire] failed to record a fire refusal for workflow ${args.workflowId}:`,
      (err as Error).message,
    )
  }
}
