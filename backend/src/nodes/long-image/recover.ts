// The ONE delivery of a finished Long Image run (tools/units/README.md, "A
// worker unit's recovery"): from the provider's result and the run's settings
// to finalizeJobWithMedia — the picture stored as what its bytes are (its type
// and size are not stated, and a page can be far taller than any picture the
// other models return), its provider cost recorded, the run charged what it
// holds. The worker (worker.ts) calls it after its provider call; the
// reconcile (`recover`, below — the cron and the worker's stall re-pick,
// lib/reconcile/kie.ts) calls it with the same inputs, read back from the
// job's saved task and `input_data`, so a recovered job is delivered and
// charged exactly as the worker would have delivered it.
import { longImageInputImages, longImageRun, type LongImageRun } from "@nodaro/render-rules"
import { finalizeJobWithMedia, type FinalizeClaimant, type FinalizeOutcome } from "../../lib/job-finalize.js"
import { isPostProcessingError } from "../../lib/post-processing-error.js"
import { kieRecoveredCostUsd } from "../../providers/kie/billed-cost.js"
import { longImageCostUsd } from "../../providers/kie/image-cost.js"
import { longImageResultOf, type LongImageResult } from "../../providers/kie/long-image.js"
import { LONG_IMAGE_MODEL_KEY } from "../../providers/kie/models.js"
import type { UnitRecover } from "../kit.js"

/** What the one delivery is handed — the same on the worker's path and the reconcile's. */
export interface LongImageDelivery {
  readonly jobId: string
  /** The finished task's result (`longImageResultOf`). */
  readonly result: LongImageResult
  /** The run's settings, as its job carries them (`longImageRun` of its payload or its `input_data`). */
  readonly settings: LongImageRun
  /** Who finalizes: the worker (its run, or its stall re-pick), or the reconcile cron. */
  readonly claimant: FinalizeClaimant
}

/**
 * The finalize's outcome, a store failure made REFUNDABLE. The run delivers one
 * picture: a picture that cannot be stored delivered nothing usable, so the run
 * fails as a plain error — never the post-processing kind that keeps the
 * charge. A `{ ok: false }` outcome is returned as it is.
 */
async function storeRefundable(finalize: Promise<FinalizeOutcome>): Promise<FinalizeOutcome> {
  try {
    return await finalize
  } catch (err) {
    if (isPostProcessingError(err)) {
      throw new Error(`Long Image: the picture could not be saved (${err instanceof Error ? err.message : String(err)})`, { cause: err })
    }
    throw err
  }
}

/**
 * Finalize a finished run: the picture stored as what its bytes are
 * (re-encoded to fit the stored-image cap when it is over it), the job's
 * provider cost from the task's own record, else the listed figure for what
 * was sent. The run's reservation is its charge (one picture, at the row its
 * settings and pictures name). A store that fails refunds the run; the
 * worker's stall re-pick or the reconcile can deliver it again from the saved
 * task.
 */
export async function deliverLongImage(d: LongImageDelivery): Promise<FinalizeOutcome> {
  const listed = longImageCostUsd(d.settings.mode, d.settings.length, d.settings.resolution, longImageInputImages(d.settings))
  return storeRefundable(finalizeJobWithMedia({
    jobId: d.jobId,
    jobType: "generate-image",
    claimant: d.claimant,
    result: {
      url: d.result.url,
      // Recorded only (jobs.provider_cost): the charge is the reservation.
      cost: kieRecoveredCostUsd(d.result.kieCredits) ?? listed,
      providerUsed: LONG_IMAGE_MODEL_KEY,
      ...(d.result.taskId ? { kieTaskId: d.result.taskId } : {}),
      ...(d.result.providerMs !== undefined ? { providerMs: d.result.providerMs } : {}),
    },
    storeAsItsBytes: true,
  }))
}

/**
 * The reconcile's recovery (backend/src/nodes/kit.ts `UnitRecover`): the saved
 * task's result, read back exactly as the worker's run reads it, and the
 * settings off the job's `input_data`, through the one delivery. A result with
 * no picture throws (the parser's error), and so does a picture that cannot be
 * stored: the reconcile fails the job and refunds it.
 */
export const recover: UnitRecover = async (task) =>
  deliverLongImage({
    jobId: task.jobId,
    result: longImageResultOf({ taskId: task.taskId, resultJson: task.result, kieCredits: task.providerCredits, providerMs: task.providerMs }),
    settings: longImageRun(task.input),
    claimant: task.claimant,
  })
