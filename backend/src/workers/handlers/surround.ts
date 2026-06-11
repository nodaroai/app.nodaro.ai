import type { Job } from "bullmq"
import type { SurroundDirection } from "@nodaro/shared"
import { generateImage } from "../../providers/index.js"
import {
  commitJobCredits,
  shouldSaveJobResult,
  markJobCompleted,
  setJobProgress,
  type HandlerFn,
  type JobContext,
} from "../shared.js"
import { makeOnTaskCreated } from "../../lib/reconcile/persistence.js"
import { providerKindForImageModel } from "../../lib/reconcile/provider-kind.js"
import { autoAttachLocationAsset } from "../../lib/location-auto-attach.js"
import { buildSurroundComposite, harmonizeSurround } from "../../services/surround/index.js"

interface SurroundJobData {
  jobId: string
  prompt: string
  referenceImageUrl: string
  direction: SurroundDirection
  degrees?: number
  carriedFraction?: number
  provider?: string
  aspectRatio?: string
  attachToLocationId?: string
  attachToColumn?: string
  attachName?: string
}

/**
 * Surround continuation worker. Pipeline:
 *   1. build the half-carry composite server-side (carry the reference's
 *      trailing half, gray the rest) — PRE-provider, plain Error → refund;
 *   2. paint the gray region via i2i off the composite;
 *   3. color-harmonize the painted half to the carried half + feather, keeping
 *      the carried half byte-exact — POST-provider but REFUND-CRITICAL (plain
 *      Errors, mirrors compositeInpaint), watermarked for free tier;
 *   4. complete + commit credits + attach to the location's angles bucket.
 */
const handleGenerateSurroundContinuation: HandlerFn = async function handleGenerateSurroundContinuation(
  job: Job,
  ctx: JobContext,
) {
  const data = job.data as SurroundJobData
  const {
    prompt,
    referenceImageUrl,
    direction,
    degrees,
    provider,
    aspectRatio,
    attachToLocationId,
    attachToColumn,
    attachName,
  } = data
  const resolvedProvider = provider ?? "nano-banana"
  const carriedFraction = data.carriedFraction ?? 0.5

  console.log(
    `[worker] generate-surround-continuation ${ctx.jobId} (dir: ${direction}, provider: ${resolvedProvider})`,
  )

  // 1. Half-carry composite (pre-provider → a failure here refunds).
  const compositeUrl = await buildSurroundComposite({
    referenceImageUrl,
    direction,
    carriedFraction,
    jobId: ctx.jobId,
    userId: ctx.jobUserId,
  })
  await setJobProgress(job, ctx.jobId, 20)

  // 2. Paint the gray region (i2i off the composite).
  const extraParams = aspectRatio ? { aspect_ratio: aspectRatio } : undefined
  const onTaskCreated = makeOnTaskCreated(ctx.jobId, providerKindForImageModel(resolvedProvider))
  const result = await generateImage(prompt, resolvedProvider, [compositeUrl], extraParams, { onTaskCreated })
  await setJobProgress(job, ctx.jobId, 60)

  // 3. Harmonize the painted half to the carried half + feather (carried byte-exact).
  // REFUND-CRITICAL: harmonizeSurround throws PLAIN Errors so a post-provider
  // failure still refunds (mirrors compositeInpaint in handlers/image-ai.ts).
  const finalUrl = await harmonizeSurround({
    compositeUrl,
    paintedUrl: result.url,
    direction,
    carriedFraction,
    jobId: ctx.jobId,
    userId: ctx.jobUserId,
    watermark: ctx.shouldWatermark,
  })
  await setJobProgress(job, ctx.jobId, 100)

  if (!(await shouldSaveJobResult(ctx.jobId))) return

  const ok = await markJobCompleted(ctx.jobId, {
    output_data: {
      imageUrl: finalUrl,
      direction,
      ...(degrees !== undefined ? { degrees } : {}),
    },
    provider: result.providerUsed,
    provider_cost: result.cost,
    display_cost: result.displayCost,
  })
  if (!ok) return

  await commitJobCredits(ctx.usageLogId, ctx.jobId, result.cost)

  // Auto-attach to the location's angles bucket. The helper re-verifies
  // (id, user_id, deleted_at IS NULL) so a forged payload can't attach elsewhere.
  await autoAttachLocationAsset({
    locationId: attachToLocationId,
    column: attachToColumn,
    name: attachName,
    userId: ctx.jobUserId,
    url: finalUrl,
  })

  console.log(`[worker] Job ${ctx.jobId} completed: ${finalUrl} (provider: ${result.providerUsed})`)
}

export const surroundHandlers: Record<string, HandlerFn> = {
  "generate-surround-continuation": handleGenerateSurroundContinuation,
}
