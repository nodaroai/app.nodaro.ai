// The video-queue handler: one tall picture from a prompt
// (providers/kie/long-image.ts), then the one delivery (recover.ts
// `deliverLongImage`) — the picture stored as what its bytes are, charged what
// the run holds. A job whose delivery failed, or whose worker died after the
// provider finished, is finished from its saved task by the reconcile through
// that same delivery (recover.ts).
import { longImageRun, longImageSentProducts, type LongImageRequest, type LongImageRun } from "@nodaro/render-rules"
import { makeOnTaskCreated } from "../../lib/reconcile/persistence.js"
import { runLongImage } from "../../providers/kie/long-image.js"
import { LONG_IMAGE_MODEL_KEY } from "../../providers/kie/models.js"
import { ensureImageForProvider } from "../../providers/kie/video.js"
import { setJobProgress, startProgressRamp } from "../../workers/shared.js"
import type { UnitWorker } from "../kit.js"
import { descriptor } from "./descriptor.generated.js"
import { deliverLongImage } from "./recover.js"

/** The picture formats the provider takes (it lists jpg, jpeg and png); anything else is converted before the call. */
const ACCEPTED_FORMATS = new Set(["jpeg", "png"])

/**
 * Each picture the run sends, in a format and size the provider takes, by its
 * own URL (the run is counted and named by those). A product picture must also
 * be at least 300 pixels a side and between 2:5 and 5:2 (the provider's
 * recommendation for its product pictures, which it otherwise fails during
 * generation): one that is too small is enlarged, one of another shape fails
 * the job here, naming the picture. That is after the run's credits are held,
 * so the job's failure refunds them (refusing it before the hold is a
 * follow-up). The webpage pictures take no shape rule: a tall page is the
 * obvious style picture.
 */
async function preparePictures(run: LongImageRun): Promise<ReadonlyMap<string, string>> {
  const context = "Long Image"
  const jobs: Array<Promise<readonly [string, string]>> = []
  if (run.mode === "ecommerce") {
    longImageSentProducts(run).forEach((url, i) => {
      jobs.push(ensureImageForProvider(url, LONG_IMAGE_MODEL_KEY, {
        context,
        acceptedFormats: ACCEPTED_FORMATS,
        minDimension: 300,
        minAspectRatio: 0.4,
        maxAspectRatio: 2.5,
        inputLabel: `product image ${i + 1}`,
      }).then((sent) => [url, sent] as const))
    })
  } else {
    for (const [url, inputLabel] of [[run.styleImageUrl, "style image"], [run.subjectImageUrl, "subject image"]] as const) {
      if (url) jobs.push(ensureImageForProvider(url, LONG_IMAGE_MODEL_KEY, { context, acceptedFormats: ACCEPTED_FORMATS, inputLabel }).then((sent) => [url, sent] as const))
    }
  }
  return new Map(await Promise.all(jobs))
}

export const worker: UnitWorker = async function handleLongImage(job, ctx) {
  const run = longImageRun(job.data as LongImageRequest)
  console.log(`[worker] ${descriptor.type} ${ctx.jobId} (${run.mode}${run.length ? ` ${run.length}` : ""}, ${run.resolution})`)

  await setJobProgress(job, ctx.jobId, 5)
  // A format, size or file the provider refuses is fixed (or refused by name) before the call.
  const sent = await preparePictures(run)
  await setJobProgress(job, ctx.jobId, 10)
  const ramp = startProgressRamp(job, ctx.jobId, { start: 10, cap: 90 })
  let result
  try {
    result = await runLongImage(run, (url) => sent.get(url) ?? url, { onTaskCreated: makeOnTaskCreated(ctx.jobId, "kie-standard") })
  } finally {
    ramp.stop()
  }
  await setJobProgress(job, ctx.jobId, 92)
  console.log(`[worker] ${descriptor.type} ${ctx.jobId}: picture returned${result.kieCredits !== undefined ? ` (task: ${result.kieCredits} KIE credits)` : ""}`)

  // A picture that cannot be stored throws a refundable error here; on a retry
  // the stall re-pick finishes the job from the saved task (recover.ts).
  const outcome = await deliverLongImage({ jobId: ctx.jobId, result, settings: run, claimant: "worker" })
  if (!outcome.ok) return
  await setJobProgress(job, ctx.jobId, 100)
}
