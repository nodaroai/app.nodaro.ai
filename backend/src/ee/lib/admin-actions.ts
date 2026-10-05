import type { FastifyRequest } from "fastify"
import { supabase } from "../../lib/supabase.js"

/**
 * The admin audit trail (`admin_actions`, migration 102) for access controls:
 * who blocked or unblocked an account or a network, who took free credits back
 * or restored them, and why. Unblocking DELETES the block row, so this table is
 * the only history there is.
 *
 * Best-effort on purpose: the action has already happened when this runs, and
 * a failed audit write must not turn a done block into a reported failure —
 * it is logged loudly instead.
 */
export type AdminAccessAction =
  | "account_block"
  | "account_unblock"
  | "network_block"
  | "network_unblock"
  | "free_grant_revoke"
  | "free_grant_restore"

const TARGET_TYPE: Record<AdminAccessAction, "user" | "blocked_network"> = {
  account_block: "user",
  account_unblock: "user",
  network_block: "blocked_network",
  network_unblock: "blocked_network",
  free_grant_revoke: "user",
  free_grant_restore: "user",
}

export async function recordAdminAction(
  req: FastifyRequest,
  action: AdminAccessAction,
  targetId: string,
  payload: Record<string, unknown> = {},
  reason: string | null = null,
): Promise<void> {
  try {
    const { error } = await supabase.from("admin_actions").insert({
      admin_user_id: req.userId ?? null,
      action,
      target_type: TARGET_TYPE[action],
      target_id: targetId,
      reason,
      payload,
    })
    if (error) req.log.error({ err: error, action, targetId }, "admin audit write failed")
  } catch (err) {
    req.log.error({ err, action, targetId }, "admin audit write threw")
  }
}
