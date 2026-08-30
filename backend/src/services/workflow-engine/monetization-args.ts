// P14/W4g — the process_app_monetization wire args, extracted pure so the
// payer routing is unit-testable (the call site lives deep inside the
// orchestrator's completion path).
import type { BillingContext } from "../../lib/billing-context.js"

export interface MonetizationArgsInput {
  runnerId: string
  creatorId: string
  markupAmount: number
  appVersionId: string
  runId: string
  baseCost: number
  flatFee: number
  percentFee: number
  billingContext: BillingContext
}

/**
 * The BASE follows the payer: a workspace-paid run sends
 * `p_payer_workspace_id` and the RPC (migration 352) debits the workspace,
 * forking the MARKUP on the org's approved-apps sanction — entirely
 * RPC-side; the worker passes the context and nothing else. Conditional
 * spread: a personal run's wire shape stays byte-identical to pre-P14.
 */
export function monetizationRpcArgs(input: MonetizationArgsInput): Record<string, unknown> {
  return {
    p_runner_id: input.runnerId,
    p_creator_id: input.creatorId,
    p_markup_amount: input.markupAmount,
    p_app_id: input.appVersionId,
    p_run_id: input.runId,
    p_base_cost: input.baseCost,
    p_flat_fee: input.flatFee,
    p_percent_fee: input.percentFee,
    ...(input.billingContext.payer === "workspace"
      ? { p_payer_workspace_id: input.billingContext.workspaceId }
      : {}),
  }
}
