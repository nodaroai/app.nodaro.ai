import { z } from "zod"
import { supabase } from "../../lib/supabase.js"
import type { PluginJobSettlement, PluginJobSettlementResult } from "../../lib/private-plugins/types.js"

const receipt = z.object({
  jobId: z.string().uuid(), usageLogId: z.string().uuid(), actualCredits: z.number().int().nonnegative(),
  releasedCredits: z.number().int().nonnegative(), receiptHash: z.string().regex(/^[a-f0-9]{64}$/), replayed: z.boolean(),
})
/** The RPC owns the money and receipt together. A lost reply remains retryable. */
export async function settleReservedJob(input: PluginJobSettlement): Promise<PluginJobSettlementResult> {
  const { data, error } = await supabase.rpc("settle_job_reservation", {
    p_job_id: input.jobId, p_user_id: input.userId, p_usage_log_id: input.usageLogId,
    p_expected_status: input.expectedStatus, p_actual_credits: input.actualCredits,
    p_receipt_hash: input.receiptHash, p_provider_cost_usd: input.providerCostUsd ?? null,
  })
  if (error) throw new Error(`Job settlement could not be confirmed: ${error.message}`)
  const parsed = receipt.safeParse(data)
  if (!parsed.success || parsed.data.jobId !== input.jobId || parsed.data.usageLogId !== input.usageLogId
    || parsed.data.actualCredits !== input.actualCredits || parsed.data.receiptHash !== input.receiptHash) {
    throw new Error("Job settlement returned a mismatched receipt")
  }
  return parsed.data
}
