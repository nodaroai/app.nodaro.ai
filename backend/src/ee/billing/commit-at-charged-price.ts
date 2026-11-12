// @registry-enumerates prices the credit id it is given via getModelCreditCostFromDB / CreditsService — a credit id, not a node type, so not a @registry-lookup
import { supabase } from "../../lib/supabase.js"
import { CreditsService, getModelCreditCostFromDB } from "./credits.js"

/**
 * Settle a run at ANOTHER credit id's charged price — a run that was reserved
 * as one product and delivered as a different, cheaper one (a Suno Separate
 * run Suno refused, finished by the Demucs fallback, pays the Demucs price).
 *
 * The charged price is the id's live price (`getModelCreditCostFromDB`: the
 * admin's row plus its markup, what the Run button shows for that id),
 * clamped at the reservation: `commit_credits` cannot collect above the hold,
 * and a fallback never costs the user more than the run they started.
 *
 * A managed (job-once) reservation settles from its saved decision instead;
 * nothing is committed or written here then, and `committed` reports 0.
 * Errors propagate — the worker shim (`commitJobCreditsAtChargedPrice`) logs
 * them without failing the job, like `commitJobCredits`.
 */
export async function commitAtChargedPrice(
  usageLogId: string,
  jobId: string,
  creditId: string,
): Promise<{ committed: number; reserved: number | undefined }> {
  if (await CreditsService.trySettleManagedCredits(usageLogId)) return { committed: 0, reserved: undefined }

  const { data: usageLog } = await supabase
    .from("usage_logs")
    .select("credits_used")
    .eq("id", usageLogId)
    .single()
  const reserved = typeof usageLog?.credits_used === "number" ? usageLog.credits_used : undefined

  const charged = (await getModelCreditCostFromDB(creditId)).creditCost
  const committed = reserved !== undefined ? Math.min(charged, reserved) : charged

  await Promise.all([
    CreditsService.commitCredits(usageLogId, committed),
    supabase.from("jobs").update({ credits_actual: committed }).eq("id", jobId),
  ])
  return { committed, reserved }
}

/**
 * Settle a run at ANOTHER credit id's charged price, UP or DOWN — a run held
 * on a measured size and charged for the size the provider reports doing
 * (Nemotron 3.5 Transcribe: held at the minutes the file's header declares,
 * charged for the minutes KIE decoded; decided 2026-11-12).
 *
 * Below the hold the rest is released; above it the overrun is collected from
 * the payer's available balance — the metered settle (`commit_credits_metered`,
 * `CreditsService.commitCredits(…, { collectOverHold: true })`), which the
 * metered LLM calls use and which logs any part it cannot collect as an
 * `uncollected_overrun` anomaly itself. `jobs.credits_actual` is the RPC's
 * confirmed charge.
 *
 * When the metered RPC gives no receipt and the log is still `reserved` (the
 * RPC failed), the log is LEFT `reserved` and loud (an `[ALERT]`), exactly as
 * `settleCommitMetered` leaves a failed metered settle: no second settlement is
 * attempted here — a plain `commit_credits` that also failed would fall into
 * `settleCommit`'s TS fallback, which commits the WHOLE hold (while
 * `credits_actual` would say the charge), and a raw RPC call would skip the
 * service's balance and external-wallet follow-ups. A later RPC retry is the
 * only correct settlement. A log already committed (a re-run after a confirmed
 * settle) is left as it is. A managed (job-once) reservation settles from its
 * saved decision; nothing else is done then.
 */
export async function settleAtChargedPrice(
  usageLogId: string,
  jobId: string,
  creditId: string,
): Promise<{ charged: number | undefined; reserved: number | undefined; collectedOverHold: number; shortfall: number }> {
  if (await CreditsService.trySettleManagedCredits(usageLogId)) {
    return { charged: undefined, reserved: undefined, collectedOverHold: 0, shortfall: 0 }
  }
  const charge = (await getModelCreditCostFromDB(creditId)).creditCost
  const outcome = await CreditsService.commitCredits(usageLogId, charge, { collectOverHold: true })
  if (outcome) {
    await supabase.from("jobs").update({ credits_actual: outcome.charged }).eq("id", jobId)
    const { data } = await supabase.from("usage_logs").select("credits_used").eq("id", usageLogId).maybeSingle()
    const reserved = typeof data?.credits_used === "number" ? data.credits_used : undefined
    return { charged: outcome.charged, reserved, collectedOverHold: outcome.collectedOverHold, shortfall: outcome.shortfall }
  }
  const { data: log } = await supabase.from("usage_logs").select("status, credits_used").eq("id", usageLogId).maybeSingle()
  const reserved = typeof log?.credits_used === "number" ? log.credits_used : undefined
  if (log?.status !== "reserved") return { charged: undefined, reserved, collectedOverHold: 0, shortfall: 0 }
  console.error(
    `[ALERT] [credits] metered settle of job ${jobId} (log ${usageLogId}, ${creditId}, ${charge} credits) gave no receipt — ` +
      `the log is left reserved for an RPC retry (no fallback settlement)`,
  )
  return { charged: undefined, reserved, collectedOverHold: 0, shortfall: 0 }
}
