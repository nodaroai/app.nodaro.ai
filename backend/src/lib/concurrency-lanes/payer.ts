// backend/src/lib/concurrency-lanes/payer.ts — the payer line a job counts in.
// Each (user, payer) pair has its own lanes: a user's personal work, their
// workspace work and work a deployment payer funds never share slots.
import type { BillingContext } from "../billing-context.js"
import type { PluginOrgEntitlements } from "../private-plugins/types.js"
import type { PayerKey } from "./types.js"

/** The grade every workspace line is sized at: the plugin's `tierForGates` literal. */
const WORKSPACE_TIER: PluginOrgEntitlements["tierForGates"] = "business"

/**
 * The line of a billing context. An absent context reads as personal through
 * `payloadBillingContext`, which callers apply first (never re-resolve here).
 */
export function payerKeyOf(ctx: BillingContext): PayerKey {
  switch (ctx.payer) {
    case "user":
      return `user:${ctx.userId}`
    case "workspace":
      return `workspace:${ctx.workspaceId}`
    case "deployment":
      return `deployment:${ctx.payerId}`
    default: {
      const never: never = ctx
      throw new Error(`unknown payer: ${JSON.stringify(never)}`)
    }
  }
}

/**
 * The line of a job whose payload carries no billing context or no `userId`
 * (the `scene-render-child` payload is `{ jobId, sceneRenderChild: true }`;
 * the captions `render` hand-off carries the caption job's), read from its
 * jobs row: `workspace_id` set → that workspace's line, business-sized; else
 * the personal line, its tier left to the caller (`null`).
 *
 * A deployment payer cannot be recovered from the row. Such a child uses its
 * parent's lease (borrow) or, failing that, the personal line.
 */
export function payerOfRow(row: { user_id: string; workspace_id: string | null }): { payer: PayerKey; tier: string | null } {
  if (row.workspace_id) return { payer: `workspace:${row.workspace_id}`, tier: WORKSPACE_TIER }
  return { payer: `user:${row.user_id}`, tier: null }
}
