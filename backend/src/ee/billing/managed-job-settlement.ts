import { z } from "zod"
import { supabase } from "../../lib/supabase.js"
import type { PluginJobSettlementCheckpoint } from "../../lib/private-plugins/types.js"

const result = z.discriminatedUnion("managed", [
  z.object({ managed: z.literal(false) }),
  z.object({ managed: z.literal(true), deferred: z.boolean(), settlement: z.object({
    usageLogId: z.string().uuid(), actualCredits: z.number().int().nonnegative(),
    releasedCredits: z.number().int().nonnegative(), receiptHash: z.string().regex(/^[a-f0-9]{64}$/), replayed: z.boolean(),
  }).optional() }),
])
/** Legacy rows keep their old path; unknown ownership never falls through to it. */
export async function trySettleManagedJob(usageLogId: string): Promise<boolean> {
  return (await trySettleManagedJobOrReadLog(usageLogId)).managed
}

/** The usage log as the managed check read it (one read): what a routed settle decides from. */
export interface SettledLogRead {
  readonly action: string | null
  readonly credits_used: number | null
  readonly job_id: string | null
  /** The reservation is marked routed (a routed run's own mode, or the mark a routed job's admission writes). */
  readonly routed: boolean
}

/**
 * {@link trySettleManagedJob}, also handing back what the same read found on
 * the log when it is not managed (null: no such log) — so the routed settle
 * decides without a read of its own.
 */
export async function trySettleManagedJobOrReadLog(usageLogId: string): Promise<{ managed: true } | { managed: false; log: SettledLogRead | null }> {
  const { data: row, error } = await supabase.from("usage_logs").select("metadata, action, credits_used, job_id").eq("id",usageLogId).maybeSingle()
  if (error && error.code !== "PGRST116") throw new Error(`Cannot confirm reservation ownership: ${error.message}`)
  if (row?.metadata?.reservation_mode !== "job-once") {
    const r = row as { action?: unknown; credits_used?: unknown; job_id?: unknown } | null
    return {
      managed: false,
      log: r ? {
        action: typeof r.action === "string" ? r.action : null, credits_used: typeof r.credits_used === "number" ? r.credits_used : null, job_id: typeof r.job_id === "string" ? r.job_id : null,
        routed: row?.metadata?.reservation_mode === "video-route" || row?.metadata?.video_route === true,
      } : null,
    }
  }
  const { data, error: rpcError } = await supabase.rpc("settle_checkpointed_job_reservation", { p_usage_log_id: usageLogId })
  if (rpcError) throw new Error(`Managed job settlement could not be confirmed: ${rpcError.message}`)
  const parsed = result.safeParse(data)
  if (!parsed.success || !parsed.data.managed || (!parsed.data.deferred && parsed.data.settlement?.usageLogId !== usageLogId)) {
    throw new Error("Managed job settlement returned an invalid receipt")
  }
  return { managed: true }
}
/** Persist the cumulative admitted-price decision before crossing output policy. */
export async function checkpointJobSettlement(input: PluginJobSettlementCheckpoint): Promise<void> {
  const { data, error } = await supabase.rpc("checkpoint_job_settlement", {
    p_job_id: input.jobId, p_user_id: input.userId, p_usage_log_id: input.usageLogId,
    p_sequence: input.sequence, p_actual_credits: input.actualCredits, p_ready: input.ready,
    p_receipt_hash: input.receiptHash, p_provider_cost_usd: input.providerCostUsd ?? null,
  })
  if (error) throw new Error(`Job settlement checkpoint could not be confirmed: ${error.message}`)
  if (!data || data.sequence !== input.sequence || data.actualCredits !== input.actualCredits
    || data.ready !== input.ready || data.receiptHash !== input.receiptHash
    || data.providerCostUsd !== (input.providerCostUsd ?? null)) throw new Error("Job settlement checkpoint returned an invalid receipt")
}
