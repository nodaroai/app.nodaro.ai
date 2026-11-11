/**
 * Recover a house model's job whose worker died (provider_kind "house-model",
 * docs/design/house-models.md).
 *
 * The persisted provider_task_id is the opaque reference the deployment's
 * plugin returned from `start`. Recovery reads its status through the same
 * plugin (`poll`) — never a re-start, so a premature takeover costs a read,
 * not a second run. The cron reads once a tick; the worker's inline re-pick
 * (`pollToEnd`) keeps reading on the model's own cadence up to its budget:
 *   - done    → the lane's ONE delivery (`deliverHouseModelRun`,
 *               house-model-delivery.ts), the same call the worker makes
 *               after its run, so the row is delivered exactly as the worker
 *               would have delivered it; a done with no file fails like a
 *               failed run, as it does in the worker;
 *   - failed  → the one failure mapper (house-model-failure.ts), the same
 *               `error_message` and `error_hint` the worker writes, then
 *               fail + refund;
 *   - running → bump `reconcile_attempts` and let the next tick look;
 *   - a job claimed for a run whose reference was never saved (the claim,
 *     house-model-claim.ts: the worker died between `start` and the save, or
 *     the save failed) → failed and refunded at the first look: it can never
 *     progress;
 *   - the model not served here (no plugin, a plugin that dropped it), or a
 *     read that throws → bump toward exhaustion, which fails the job and
 *     refunds it.
 *
 * Nothing here names an upstream or imports a provider client.
 */
import { markJobFailed } from "../job-failure.js"
import { isFinalizeJobType, type FinalizeClaimant } from "../job-finalize.js"
import { refundReservedCreditsForJob } from "../credits-job-lifecycle.js"
import { providerDetailOf, redactProviderDetail } from "../provider-error-detail.js"
import { userFacingMessage } from "../user-facing-error.js"
import {
  audioRefusedOf,
  fallbackLabelOf,
  inputImageRefusedOf,
  inputVideoRefusedOf,
  jobModelIdOf,
  promptRefusedOf,
  refusalHintFor,
  requestRefusedHintOf,
  safetyBlockMessage,
  safetyBlockOf,
  sentVideoInput,
  type ErrorHint,
} from "../safety-block.js"
import { DrainAbortError, isWorkerDraining } from "../worker-drain.js"
import { isHouseModelReference } from "../house-model-claim.js"
import { houseModelTiming } from "../house-model-timeouts.js"
import { getPluginServices } from "../private-plugins/services-registry.js"
import type { PluginHouseModelPoll } from "../private-plugins/types.js"
import { houseModelFailureError, houseModelFailureOf, houseModelLabel } from "../house-model-failure.js"
import { deliverHouseModelRun } from "../house-model-delivery.js"
import { houseModelServed, isOwnLabelModel } from "../house-models-served.js"
import { bumpAttemptsOrExhaust } from "./bump-attempts.js"
import { HOUSE_MODEL_MAX_POLL_READ_FAILURES, assertHouseModelPluginsLoaded } from "../house-models.js"

export interface HouseModelJobRow {
  id: string
  provider_task_id: string | null
  reconcile_attempts: number
  job_type: string | null
  /** The job's request: its `provider` is the house model it ran, and its lane settles on it. */
  input_data: Record<string, unknown> | null
}

/** The house model a job ran: its `input_data.provider`, when that is an own-label catalog id. */
export function houseModelIdOfJob(input: Readonly<Record<string, unknown>> | null | undefined): string | undefined {
  const provider = input?.provider
  return isOwnLabelModel(provider) ? provider : undefined
}

/** The `error_hint` the worker would have written for this failure (the one shared mapping). */
function hintOf(err: unknown, input: Record<string, unknown> | null): ErrorHint | null {
  return refusalHintFor(
    safetyBlockOf(err, jobModelIdOf(input)),
    false,
    inputVideoRefusedOf(err) && sentVideoInput(input),
    inputImageRefusedOf(err),
    requestRefusedHintOf(err, input),
    promptRefusedOf(err),
    audioRefusedOf(err),
  )
}

/**
 * The `error_message` the video worker writes for this failure (its final
 * catch, workers/video-worker.ts): a safety-class block gets the platform's
 * own safety sentence, anything else its user-facing message. `retried` is
 * false: a house model never takes the worker's inline safety retry (its
 * catalog entry declares no stochastic filter — house-models-tables.test.ts).
 */
export function houseModelFailureMessage(err: Error, input: Record<string, unknown> | null): string {
  const block = safetyBlockOf(err, jobModelIdOf(input))
  return block && block.class === "safety"
    ? safetyBlockMessage(block.fallback ? fallbackLabelOf(block.fallback) : undefined, false)
    : userFacingMessage(err, err.message)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)))
}

/** A non-negative finite USD figure, or undefined. */
function usd(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined
}

/** A positive whole pixel count, or undefined. */
function side(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : undefined
}

/**
 * Valid where the plugins are loaded: the API process (the reconcile cron,
 * `server.ts`) and the video worker (the inline re-pick). Anywhere else it
 * throws `HouseModelsNotLoadedError` (the cron's per-row catch logs it and the
 * row waits), never "not served" — which would exhaust and refund a job whose
 * run may have delivered.
 */
export async function reconcileHouseModelJob(
  row: HouseModelJobRow,
  opts?: {
    claimant?: FinalizeClaimant
    /**
     * Keep reading a run that is still going, on the model's own cadence, up
     * to its poll budget (`houseModelTiming`) — the worker's inline re-pick,
     * inside a live queue handler. Without it: one read a tick (the cron).
     */
    pollToEnd?: boolean
  },
): Promise<void> {
  assertHouseModelPluginsLoaded("reconcileHouseModelJob")
  const taskRef = row.provider_task_id
  if (!isHouseModelReference(taskRef)) {
    // Claimed for a run whose reference was never saved (house-model-claim.ts):
    // nothing to read, and nothing may start, so the job can never progress —
    // failed and refunded at this first look, not after the exhaustion ladder.
    // The cron reaches it only past the kind's stale threshold; the inline
    // re-pick only once the worker that claimed it lost its job. The sentence
    // stays true either way: the run may have reached the upstream, and it is
    // not retried.
    const label = houseModelLabel(houseModelIdOfJob(row.input_data) ?? "")
    const flipped = await markJobFailed(row.id, {
      error_message: `${label} could not complete this run, and it will not be retried.`,
      error_detail: "House model run claimed, but its reference was never saved.",
      reconcile_last_error: "claimed_without_reference",
    })
    if (flipped) await refundReservedCreditsForJob(row.id)
    return
  }
  const input = row.input_data ?? null
  const id = houseModelIdOfJob(input)
  const service = getPluginServices().houseModels
  if (!id || !service || !houseModelServed(id)) {
    await bumpAttemptsOrExhaust(row.id, new Error("house model not served on this deployment"))
    return
  }

  const timing = houseModelTiming(id)
  const deadline = Date.now() + (opts?.pollToEnd ? timing.timeoutMs : 0)
  let readFailures = 0
  let polled: PluginHouseModelPoll | undefined
  for (;;) {
    if (opts?.pollToEnd && isWorkerDraining()) throw new DrainAbortError()
    try {
      polled = await service.poll(id, taskRef)
      readFailures = 0
    } catch (err) {
      readFailures++
      // The read's own words go to this log line only, redacted: what the row
      // keeps (`reconcile_last_error`, and `error_detail` once the attempts run
      // out) is the neutral sentence below.
      console.warn(`[house-models] job ${row.id} (${id}) status read failed: ${redactProviderDetail(err instanceof Error ? err.message : String(err)) ?? "(no words)"}`)
      if (!opts?.pollToEnd || readFailures >= HOUSE_MODEL_MAX_POLL_READ_FAILURES || Date.now() >= deadline) {
        await bumpAttemptsOrExhaust(row.id, new Error("house model status read failed"))
        return
      }
      await sleep(timing.pollIntervalMs)
      continue
    }
    if (polled?.state === "done" || polled?.state === "failed") break
    if (!opts?.pollToEnd || Date.now() >= deadline) {
      await bumpAttemptsOrExhaust(row.id, new Error("house model run still in progress"))
      return
    }
    await sleep(timing.pollIntervalMs)
  }

  // The loop ends only on a read that came back done or failed.
  const ended = polled as Exclude<PluginHouseModelPoll, { state: "running" }>
  const resultUrls =
    ended.state === "done" && Array.isArray(ended.resultUrls)
      ? ended.resultUrls.filter((u): u is string => typeof u === "string" && u.length > 0)
      : []
  if (ended.state === "failed" || resultUrls.length === 0) {
    // A done with no file is the run's end too, as in the worker (house-models.ts).
    const err = houseModelFailureError(
      ended.state === "failed" ? houseModelFailureOf(ended) : { message: "done without result files" },
      { id, jobId: row.id },
    )
    const hint = hintOf(err, input)
    const flipped = await markJobFailed(row.id, {
      error_message: houseModelFailureMessage(err, input),
      error_detail: providerDetailOf(err),
      reconcile_last_error: "upstream_failed",
      ...(hint ? { error_hint: hint } : {}),
    })
    if (flipped) await refundReservedCreditsForJob(row.id)
    return
  }
  if (!isFinalizeJobType(row.job_type)) {
    await bumpAttemptsOrExhaust(row.id, new Error(`unknown job_type for finalize: ${row.job_type ?? "null"}`))
    return
  }

  try {
    // The delivered size comes as a pair or not at all.
    const width = side(ended.width)
    const height = side(ended.height)
    await deliverHouseModelRun({
      id,
      jobId: row.id,
      jobType: row.job_type,
      job: input ?? {},
      resultUrls,
      ...(width && height ? { width, height } : {}),
      // The upstream's own figure when it reported one. No planned figure here:
      // it was saved on the row with the reference, and the delivery's null
      // cost leaves it there.
      reportedCostUsd: usd(ended.providerCostUsd) ?? null,
      claimant: opts?.claimant ?? "cron",
    })
  } catch (err) {
    await bumpAttemptsOrExhaust(row.id, err)
  }
}
