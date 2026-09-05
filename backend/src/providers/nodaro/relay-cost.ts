/**
 * Relay provenance — what a relayed job leaves on the NEAR end's row.
 *
 * Spec 2026-09-04-sai-local-development §8.2 / D14, D15, D18; migration 383.
 *
 * The far end already answers both facts on its public GET /v1/jobs/:id
 * (`credits` is in PUBLIC_JOB_KEYS, routes/jobs.ts:148-152), so nothing
 * changes on the hosted side. What was missing was anywhere to put them here:
 *
 *   relay_job_id   the far end's job id. Support provenance, and the marker
 *                  the delete paths read — a row carrying one references an
 *                  object THIS instance did not create and must never delete.
 *   relay_credits  the far end's RESERVED credits for that job. Never
 *                  `jobs.credits`, which means "credits this instance
 *                  reserved" and is what every cost audit and the
 *                  Connected-Instances rollup read.
 *
 * Two things this module deliberately does NOT do:
 *   - read `display_cost` / `credits_actual`. They are ADMIN_ONLY_JOB_KEYS on
 *     the far end; a relaying instance has no business seeing the far end's
 *     USD or its margin.
 *   - convert to display units. Units are the near end's own local transform
 *     (lib/billing-display-unit.ts `toUnits`), applied with the near end's own
 *     surface profile — whose rate the deploy-artifact validator pins equal to
 *     the far end's, so the two can never disagree.
 *
 * `credits` absent ⇒ NULL, never 0. "The authority could not say" is the same
 * contract `toUnits` keeps (it returns null, so the UI renders an em dash
 * rather than the word "free").
 */

import { supabase } from "../../lib/supabase.js"
import type { CloudJob } from "./client.js"

/** A far-end `credits` reading, normalised: a real finite number or NULL. */
function relayCreditsOf(job: Pick<CloudJob, "credits">): number | null {
  return typeof job.credits === "number" && Number.isFinite(job.credits) ? job.credits : null
}

/**
 * Lanes 2 and 3 hold the local job id directly, so they write the columns
 * themselves. Best-effort by design: a provenance write must NEVER fail a
 * generation that already ran and was already paid for at the far end, so
 * every failure is logged and swallowed.
 */
export async function recordRelayCost(localJobId: string, job: CloudJob): Promise<void> {
  if (!localJobId) return
  try {
    const { error } = await supabase
      .from("jobs")
      .update({ relay_job_id: job.id, relay_credits: relayCreditsOf(job) })
      .eq("id", localJobId)
    if (error) {
      console.error(`[relay-cost] could not stamp job ${localJobId} with relay provenance:`, error.message)
    }
  } catch (err) {
    console.error(`[relay-cost] could not stamp job ${localJobId} with relay provenance:`, err)
  }
}

/**
 * Lane 1, the capability router: the providers never receive the local job id
 * (`generateImage(prompt, refs, model, extraParams, reconcileOpts)` has none,
 * and ReconcileOpts carries only onTaskCreated / modelKey / dimensions), so
 * the pair rides back on the ProviderResult and the HANDLER persists it —
 * exactly as `kieTaskId` already works.
 */
export function relayResultFields(job: CloudJob): { relayJobId: string; relayCredits: number | null } {
  return { relayJobId: job.id, relayCredits: relayCreditsOf(job) }
}

/**
 * The completion-side half of lane 1: ProviderResult → the two job columns.
 * `{}` for every result no nodaro provider produced, which is what keeps the
 * router lane byte-identical to today off a relay. The exclusive-node relay
 * (lane 4) reuses it directly on its three `markJobCompleted` completions,
 * which take the columns rather than a ProviderResult.
 */
export function relayFieldsFrom(
  result: { relayJobId?: string; relayCredits?: number | null } | null | undefined,
): Record<string, unknown> {
  if (!result?.relayJobId) return {}
  return { relay_job_id: result.relayJobId, relay_credits: result.relayCredits ?? null }
}
