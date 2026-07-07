import type { Job } from "bullmq"
import { defaultCarriedFraction, type SurroundDirection } from "@nodaro/shared"
import { generateImage, editImage } from "../../providers/index.js"
import {
  commitJobCredits,
  shouldSaveJobResult,
  markJobCompleted,
  setJobProgress,
  refundSurroundRefineAddon,
  type HandlerFn,
  type JobContext,
} from "../shared.js"
import { makeOnTaskCreated } from "../../lib/reconcile/persistence.js"
import { providerKindForImageModel } from "../../lib/reconcile/provider-kind.js"
import { autoAttachLocationAsset } from "../../lib/location-auto-attach.js"
import type { PluginSurroundEngine } from "../../lib/private-plugins/types.js"

const DEFAULT_REFINE_PROVIDER = "recraft-upscale"

interface SurroundJobData {
  jobId: string
  prompt: string
  referenceImageUrl: string
  direction: SurroundDirection
  degrees?: number
  carriedFraction?: number
  refine?: boolean
  refineProvider?: string
  provider?: string
  aspectRatio?: string
  attachToLocationId?: string
  attachToColumn?: string
  attachName?: string
}

/**
 * Surround continuation worker. Pipeline:
 *   1. build the half-carry composite server-side — PRE-provider, plain Error → refund;
 *   2. paint the gray region via i2i off the composite;
 *   2b. (opt-in) refine — denoise/upscale the painted output BEFORE harmonize, so
 *       harmonize still restores the carried band byte-exact; best-effort with an
 *       addon refund on failure;
 *   3. color-harmonize the painted half to the carried half — POST-provider but
 *       REFUND-CRITICAL (plain Errors), watermarked for free tier;
 *   4. complete + commit credits + attach to the location's angles bucket.
 *
 * The two engine ops (`buildSurroundComposite`/`harmonizeSurround`) are the
 * IP-sensitive color-science/compositing steps — extracted to the private
 * `@nodaroai/cloud-plugins` package (S8) and reached here only through the
 * injected `engine` (see `createSurroundHandlers` below). Everything else in
 * this pipeline (provider dispatch, credit commit, location auto-attach) is
 * broadly-shared core infrastructure and stays inline.
 */
function makeHandler(engine: PluginSurroundEngine): HandlerFn {
  return async function handleGenerateSurroundContinuation(job: Job, ctx: JobContext) {
    const data = job.data as SurroundJobData
    const {
      prompt,
      referenceImageUrl,
      direction,
      degrees,
      refine,
      provider,
      aspectRatio,
      attachToLocationId,
      attachToColumn,
      attachName,
    } = data
    const resolvedProvider = provider ?? "nano-banana"
    const refineProvider = data.refineProvider ?? DEFAULT_REFINE_PROVIDER
    const carriedFraction = data.carriedFraction ?? defaultCarriedFraction(direction)

    console.log(
      `[worker] generate-surround-continuation ${ctx.jobId} (dir: ${direction}, provider: ${resolvedProvider}${refine ? `, refine: ${refineProvider}` : ""})`,
    )

    // 1. Half-carry composite (pre-provider → a failure here refunds).
    const compositeUrl = await engine.buildSurroundComposite({
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
    await setJobProgress(job, ctx.jobId, 50)

    // 2b. Optional refine of the painted output BEFORE harmonize — so harmonize
    // still overwrites the carried band byte-exact (panorama viewer stays seamless)
    // while the cleaner painted content is what compounds into the next ring view.
    // Best-effort: a refine failure keeps the un-refined output; the addon is refunded.
    let paintedUrl = result.url
    let refineCost = 0
    let refineFailed = false
    if (refine) {
      try {
        const refined = await editImage(result.url, refineProvider)
        paintedUrl = refined.url
        refineCost = refined.cost ?? 0
      } catch (err) {
        console.warn(`[worker] surround refine (${refineProvider}) failed for ${ctx.jobId}; keeping un-refined output:`, err)
        refineFailed = true
      }
      await setJobProgress(job, ctx.jobId, 70)
    }

    // 3. Harmonize the painted half to the carried half + feather (carried byte-exact).
    // REFUND-CRITICAL: harmonizeSurround throws PLAIN Errors so a post-provider
    // failure still refunds (mirrors compositeInpaint in handlers/image-ai.ts).
    const finalUrl = await engine.harmonizeSurround({
      compositeUrl,
      paintedUrl,
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
        ...(refine ? { refined: !refineFailed } : {}),
      },
      provider: result.providerUsed,
      provider_cost: refineCost ? (result.cost ?? 0) + refineCost : result.cost,
      display_cost: result.displayCost,
    })
    if (!ok) return

    // Commit credits. Refine success → charge the reserved base+addon. Refine
    // failure → refund just the addon (keep the un-refined result, charge the base).
    if (refine && refineFailed) {
      const { getModelCreditBaseCost } = await import("../../ee/billing/credits.js")
      const refineAddon = (await getModelCreditBaseCost(refineProvider)).creditCost
      await refundSurroundRefineAddon(ctx.jobId, ctx.usageLogId, refineAddon)
    } else {
      await commitJobCredits(ctx.usageLogId, ctx.jobId, result.cost)
    }

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
}

/**
 * Builds the `generate-surround-continuation` handler map. Additive-capability
 * factory (S8): the engine (`buildSurroundComposite`/`harmonizeSurround`) is
 * resolved by `loadPrivatePlugins()` at worker boot and passed in here — this
 * module can no longer construct a module-load-time-constant handlers object
 * because the engine isn't known until after that async load completes (see
 * `video-worker.ts`).
 *
 * When no engine is loaded (community/business, or cloud with
 * `PRIVATE_MODULES=optional` and the plugin unavailable), the returned handler
 * throws a clear, actionable error instead of crashing on an undefined import.
 * Surround-continuation is Cloud-only (see the edition gate on the route,
 * `routes/generate-surround-continuation.ts`); this stub is the worker-side
 * defensive backstop for the rare case a job is queued without a live engine.
 */
export function createSurroundHandlers(engine: PluginSurroundEngine | undefined): Record<string, HandlerFn> {
  if (!engine) {
    return {
      "generate-surround-continuation": async () => {
        throw new Error(
          "generate-surround-continuation: surround engine not loaded (requires @nodaroai/cloud-plugins on Cloud edition)",
        )
      },
    }
  }
  return { "generate-surround-continuation": makeHandler(engine) }
}
