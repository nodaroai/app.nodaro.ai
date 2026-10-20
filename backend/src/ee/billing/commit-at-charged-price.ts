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
