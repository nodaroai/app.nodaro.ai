/**
 * The ONE delivery of a finished house-model run (docs/design/house-models.md).
 *
 * The worker (after `runHouseModelTask` resolves) and the reconcile kind (after
 * one `poll`, lib/reconcile/house-model.ts) both call `deliverHouseModelRun`
 * with the same inputs, so a recovered job is delivered exactly like a normal
 * one: the lane's own `deliver` when its row has one, else the default — the
 * result re-hosted through the shared finalize (`finalizeJobWithMedia`: the
 * stored file, its size, the commit), the job's provider recorded as the
 * house-model id, and the lane's `settledBase` for a held run.
 *
 * A lane's worker, once its run resolved:
 *   const run = await runHouseModelTask(id, args, { jobId, … })
 *   await deliverHouseModelRun({ id, jobId, jobType, job: payload, ...run, claimant: "worker" })
 * (`run` is `{ resultUrls, width?, height?, reportedCostUsd, plannedCostUsd }`:
 * the fields the reconcile reads from one `poll`, plus the start's planned
 * cost, which the reconcile finds on the row instead — it was saved with the
 * run's reference).
 *
 * The cost is resolved here, once, for both paths (`houseModelDeliveredCostUsd`):
 * what the upstream reported, else `plan` on what was delivered (the lane's
 * `deliveredPlanArgs`), else the start's planned figure. The recovery has no
 * planned figure in hand and passes none; the completion write skips a null
 * cost, so the figure saved with the reference stays. The job records the
 * same cost on either path.
 */
import { finalizeJobWithMedia, type FinalizeClaimant, type FinalizeJobType, type FinalizeOutcome } from "./job-finalize.js"
import { houseModelLane, type HouseModelLane } from "./house-model-lanes.js"
import { redactProviderDetail } from "./provider-error-detail.js"
import { planHouseModelRun } from "./house-models.js"
import { houseModelLabel } from "./house-model-failure.js"
import { SVG_REFUSED_MESSAGE } from "./svg-sanitize.js"

/**
 * A finished run to deliver — the same inputs on the worker path (after
 * `runHouseModelTask` resolves) and the reconcile path (after one `poll`).
 */
export interface HouseModelDelivery {
  /** The house model (its catalog id): recorded as the job's provider. */
  readonly id: string
  readonly jobId: string
  readonly jobType: FinalizeJobType
  /** The request: the worker's payload, or the job's `input_data` (the same keys). */
  readonly job: Readonly<Record<string, unknown>>
  /** The result files, in order; the first is the job's result. */
  readonly resultUrls: readonly string[]
  /** The delivered size, as a pair or not at all. */
  readonly width?: number
  readonly height?: number
  /** What the upstream reported the run cost, in USD; null when it reported none. */
  readonly reportedCostUsd: number | null
  /**
   * The start's planned cost, in USD — the worker has it; the recovery does
   * not (it was saved on the row with the run's reference).
   */
  readonly plannedCostUsd?: number
  /** Who finalizes: the worker, or the reconcile cron. */
  readonly claimant: FinalizeClaimant
}

/**
 * A delivery with its cost resolved: what a lane's own `deliver` receives
 * (and the default delivery reads). The two raw figures are gone: a lane
 * records `providerCostUsd` and nothing else.
 */
export interface HouseModelPricedDelivery extends Omit<HouseModelDelivery, "reportedCostUsd" | "plannedCostUsd"> {
  /** What `jobs.provider_cost` records, in USD; null keeps the figure already on the row (the planned one, saved with the reference). */
  readonly providerCostUsd: number | null
}

/** What a delivery ends in: the shared finalize's outcome. */
export type HouseModelDeliveryOutcome = FinalizeOutcome

/**
 * Delivers a finished run through its lane's one delivery. A `{ ok: false }`
 * outcome (a held run parked for review, or another finalizer that won) is not
 * an error: the caller returns, and never throws on it.
 *
 * A delivery that throws rethrows with a FIXED sentence in place of its words
 * (`houseModelDeliveryError`): the result files sit on the upstream's own
 * host, and a re-host failure can name it — a URL, a redirect target, a
 * certificate's names, an address — in the message the worker writes to
 * `error_message` and the recovery to `reconcile_last_error` / `error_detail`.
 * Only the redacted original, in one log line, keeps them.
 */
export async function deliverHouseModelRun(delivery: HouseModelDelivery): Promise<HouseModelDeliveryOutcome> {
  const lane = houseModelLane(delivery.id)
  try {
    const { reportedCostUsd: _reported, plannedCostUsd: _planned, ...rest } = delivery
    const priced: HouseModelPricedDelivery = { ...rest, providerCostUsd: houseModelDeliveredCostUsd(delivery, lane) }
    return await (lane?.deliver ? lane.deliver(priced) : defaultHouseModelDelivery(priced, lane))
  } catch (err) {
    throw houseModelDeliveryError(err, delivery)
  }
}

/** A non-negative finite USD figure, or undefined. */
function usd(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined
}

/**
 * The cost a delivered run records (`jobs.provider_cost`), the same on both
 * paths: what the upstream reported, else `plan` on what was delivered (the
 * lane's `deliveredPlanArgs`, built from the job's request), else the start's
 * planned figure when the caller has it, else null — which keeps the figure
 * saved with the run's reference.
 */
export function houseModelDeliveredCostUsd(
  d: HouseModelDelivery,
  lane: Pick<HouseModelLane, "deliveredPlanArgs"> | undefined = houseModelLane(d.id),
): number | null {
  const reported = usd(d.reportedCostUsd)
  if (reported !== undefined) return reported
  const url = d.resultUrls[0]
  if (url !== undefined && lane?.deliveredPlanArgs) {
    const size = d.width && d.height ? { width: d.width, height: d.height } : {}
    const args = lane.deliveredPlanArgs(d.job, { url, ...size })
    const replanned = args ? planHouseModelRun(d.id, args)?.providerCostUsd : undefined
    if (replanned !== undefined) return replanned
  }
  return usd(d.plannedCostUsd) ?? null
}

/** The sentence a failed delivery's error carries, by the one class the platform's classifiers read off its message. */
function deliveryFailureSentence(text: string, id: string): string {
  // The reconcile fails these at once rather than retrying (lib/reconcile/bump-attempts.ts).
  if (text.startsWith(SVG_REFUSED_MESSAGE)) return SVG_REFUSED_MESSAGE
  if (/^upload-size-exceeded/.test(text)) return `upload-size-exceeded: the result of ${houseModelLabel(id)} is larger than storage takes.`
  return `${houseModelLabel(id)} finished, but its result could not be stored.`
}

/** The neutral operator detail (`jobs.error_detail`) of a failed delivery. */
const DELIVERY_FAILED_DETAIL = "House model delivery failed."

/**
 * A failed delivery's error, its words kept to the log: logs the original
 * once, redacted, with the job id; then gives the error a FIXED sentence
 * (`message`, what `error_message` and `reconcile_last_error` are written
 * from) and a neutral `internalDetails` (what `error_detail` is written from,
 * read before any cause's). Nothing of the original text survives outside the
 * log line — no host, address or URL in any form — except the class prefix
 * the classifiers need (`upload-size-exceeded`, the SVG refusal). The same
 * object is returned, so its markers (`PostProcessingError`, `deterministic`)
 * still classify it; one whose message cannot be set is wrapped, its markers
 * copied.
 */
export function houseModelDeliveryError(err: unknown, d: Pick<HouseModelDelivery, "id" | "jobId">): Error {
  const text = err instanceof Error ? err.message : String(err)
  console.warn(`[house-models] job ${d.jobId} (${d.id}) delivery failed: ${redactProviderDetail(text) ?? "(no words)"}`)
  const sentence = deliveryFailureSentence(text, d.id)
  if (err instanceof Error) {
    try {
      err.message = sentence
      ;(err as Error & { internalDetails?: string }).internalDetails = DELIVERY_FAILED_DETAIL
      if (err.message === sentence) return err
    } catch {
      /* a read-only message: wrapped below */
    }
  }
  const wrapped = Object.assign(new Error(sentence), { internalDetails: DELIVERY_FAILED_DETAIL })
  if (err !== null && typeof err === "object") {
    const marks = err as { postProcessing?: unknown; deterministic?: unknown }
    if (marks.postProcessing === true) Object.assign(wrapped, { postProcessing: true })
    if (marks.deterministic === true) Object.assign(wrapped, { deterministic: true })
  }
  return wrapped
}

/**
 * The lane's settle for a held run, as the finalize takes it: a figure above 0
 * in BASE credits, or undefined to commit the reservation as it stands. A
 * figure of 0 (or below, or not a number) is NOT "charge nothing" — the
 * count-based settle needs a value above 0, and the commit would take the
 * whole reservation — so it is refused here with an error log and the
 * reservation commits as it stands, as for undefined.
 */
function settledBaseCredits(value: number | undefined, d: Pick<HouseModelDelivery, "id" | "jobId">): number | undefined {
  if (value === undefined) return undefined
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value
  console.error(
    `[house-models] job ${d.jobId} (${d.id}): the lane's settledBase returned ${String(value)}, which settles nothing — ` +
      "the reservation commits as it stands (return a figure above 0, or undefined)",
  )
  return undefined
}

/**
 * The default delivery: the first file is the result (the rest ride along),
 * re-hosted by the shared finalize; the job's provider is the house-model id;
 * a held run settles on what was delivered (`settledBase`), never above its
 * reservation. A lane that needs more (a thumbnail it makes itself, its own
 * output fields) declares `deliver` and may call this for the common part.
 */
export async function defaultHouseModelDelivery(
  d: HouseModelPricedDelivery,
  lane: Pick<HouseModelLane, "settledBase"> | undefined = houseModelLane(d.id),
): Promise<HouseModelDeliveryOutcome> {
  const url = d.resultUrls[0]!
  const size = d.width && d.height ? { width: d.width, height: d.height } : {}
  const meteredBaseCredits = settledBaseCredits(await lane?.settledBase?.(d.job, { url, ...size }), d)
  return finalizeJobWithMedia({
    jobId: d.jobId,
    jobType: d.jobType,
    claimant: d.claimant,
    ...(meteredBaseCredits !== undefined ? { meteredBaseCredits } : {}),
    result: {
      url,
      ...(d.resultUrls.length > 1 ? { extraUrls: d.resultUrls.slice(1) } : {}),
      cost: d.providerCostUsd,
      providerUsed: d.id,
    },
  })
}
