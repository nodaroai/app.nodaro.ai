import type { Job } from "bullmq"
import { supabase } from "../../lib/supabase.js"
import { generateImage } from "../../providers/index.js"
import { generateScript, type ScriptProvider } from "../../providers/script/script-generator.js"
import {
  commitJobCredits,
  shouldSaveJobResult,
  uploadImageMaybeWatermark,
  type HandlerFn,
  type JobContext,
} from "../shared.js"

interface EntityImageJobData {
  jobId: string
  prompt: string
  sourceImageUrl?: string
  assetType?: string
  provider?: string
}

function makeEntityImageHandler(
  logPrefix: string,
  opts?: { aspectRatio?: string; includeAssetType?: boolean },
): HandlerFn {
  return async function entityImageHandler(job: Job, ctx: JobContext) {
    const { prompt, sourceImageUrl, assetType, provider } = job.data as EntityImageJobData
    const resolvedProvider = provider ?? "nano-banana"

    if (opts?.includeAssetType) {
      console.log(`[worker] ${logPrefix} ${ctx.jobId} (type: ${assetType}, provider: ${resolvedProvider})`)
    } else {
      console.log(`[worker] ${logPrefix} ${ctx.jobId} (provider: ${resolvedProvider}): "${prompt}"`)
    }

    const referenceImageUrls = sourceImageUrl ? [sourceImageUrl] : undefined
    const extraParams = opts?.aspectRatio ? { aspect_ratio: opts.aspectRatio } : undefined
    const result = await generateImage(prompt, resolvedProvider, referenceImageUrls, extraParams)
    await job.updateProgress(50)

    const r2Url = await uploadImageMaybeWatermark(result.url, ctx.jobId, ctx.jobUserId, ctx.shouldWatermark)
    await job.updateProgress(100)

    if (!await shouldSaveJobResult(ctx.jobId)) return

    const outputData: Record<string, unknown> = { imageUrl: r2Url }
    if (opts?.includeAssetType && assetType) {
      outputData.assetType = assetType
    }

    await supabase.from("jobs").update({
      status: "completed",
      progress: 100,
      output_data: outputData,
      completed_at: new Date().toISOString(),
      provider: result.providerUsed,
      provider_cost: result.cost,
      display_cost: result.displayCost,
    }).eq("id", ctx.jobId)

    await commitJobCredits(ctx.usageLogId, ctx.jobId, result.cost)
    console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url} (provider: ${result.providerUsed}, cost: $${result.cost?.toFixed(6) ?? "N/A"})`)
  }
}

const handleGenerateScript: HandlerFn = async function handleGenerateScript(job, ctx) {
  const { prompt, sceneCount, tone, targetDuration, provider } = job.data as {
    jobId: string
    prompt: string
    sceneCount?: number
    tone?: string
    targetDuration?: number
    provider?: ScriptProvider
  }
  console.log(`[worker] generate-script ${ctx.jobId} (provider: ${provider ?? "gemini"})`)

  const script = await generateScript(prompt, sceneCount, tone, targetDuration, provider)
  await job.updateProgress(100)

  if (!await shouldSaveJobResult(ctx.jobId)) return

  await supabase
    .from("jobs")
    .update({
      status: "completed",
      progress: 100,
      output_data: { script },
      completed_at: new Date().toISOString(),
    })
    .eq("id", ctx.jobId)

  await commitJobCredits(ctx.usageLogId, ctx.jobId)
  console.log(`[worker] Job ${ctx.jobId} completed: "${script.title}" (${script.scenes.length} scenes)`)
}

export const entityHandlers: Record<string, HandlerFn> = {
  "generate-character": makeEntityImageHandler("generate-character"),
  "generate-face": makeEntityImageHandler("generate-face", { aspectRatio: "1:1" }),
  "generate-character-asset": makeEntityImageHandler("generate-character-asset", { includeAssetType: true }),
  "generate-object": makeEntityImageHandler("generate-object"),
  "generate-object-asset": makeEntityImageHandler("generate-object-asset", { includeAssetType: true }),
  "generate-location": makeEntityImageHandler("generate-location"),
  "generate-location-asset": makeEntityImageHandler("generate-location-asset", { includeAssetType: true }),
  "generate-script": handleGenerateScript,
}
