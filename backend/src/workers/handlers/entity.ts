import type { Job } from "bullmq"
import { generateImage, imageToVideo } from "../../providers/index.js"
import { generateScript, type ScriptProvider } from "../../providers/script/script-generator.js"
import {
  commitJobCredits,
  shouldSaveJobResult,
  markJobCompleted,
  uploadImageMaybeWatermark,
  uploadVideoMaybeWatermark,
  setJobProgress,
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
    await setJobProgress(job, ctx.jobId, 50)

    const r2Url = await uploadImageMaybeWatermark(result.url, ctx.jobId, ctx.jobUserId, ctx.shouldWatermark)
    await setJobProgress(job, ctx.jobId, 100)

    if (!await shouldSaveJobResult(ctx.jobId)) return

    const outputData: Record<string, unknown> = { imageUrl: r2Url }
    if (opts?.includeAssetType && assetType) {
      outputData.assetType = assetType
    }

    const ok = await markJobCompleted(ctx.jobId, {
      output_data: outputData,
      provider: result.providerUsed,
      provider_cost: result.cost,
      display_cost: result.displayCost,
    })
    if (!ok) return

    await commitJobCredits(ctx.usageLogId, ctx.jobId, result.cost)
    console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url} (provider: ${result.providerUsed}, cost: $${result.cost?.toFixed(6) ?? "N/A"})`)
  }
}

const handleGenerateScript: HandlerFn = async function handleGenerateScript(job, ctx) {
  const { prompt, sceneCount, tone, targetDuration, provider, llmModel } = job.data as {
    jobId: string
    prompt: string
    sceneCount?: number
    tone?: string
    targetDuration?: number
    provider?: ScriptProvider
    llmModel?: string
  }
  console.log(`[worker] generate-script ${ctx.jobId} (model: ${llmModel ?? provider ?? "default"})`)

  const script = await generateScript(prompt, sceneCount, tone, targetDuration, provider, llmModel)
  await setJobProgress(job, ctx.jobId, 100)

  if (!await shouldSaveJobResult(ctx.jobId)) return

  const ok = await markJobCompleted(ctx.jobId, {
    output_data: { script },
  })
  if (!ok) return

  await commitJobCredits(ctx.usageLogId, ctx.jobId)
  console.log(`[worker] Job ${ctx.jobId} completed: "${script.title}" (${script.scenes.length} scenes)`)
}

const handleGenerateCharacterMotion: HandlerFn = async function handleGenerateCharacterMotion(job, ctx) {
  const { prompt, sourceImageUrl, provider } = job.data as {
    jobId: string
    prompt: string
    sourceImageUrl: string
    provider?: string
  }
  const resolvedProvider = provider ?? "kling"
  console.log(`[worker] generate-character-motion ${ctx.jobId} (provider: ${resolvedProvider}): "${prompt}"`)

  const result = await imageToVideo(sourceImageUrl, resolvedProvider, prompt)
  await setJobProgress(job, ctx.jobId, 50)

  const r2Url = await uploadVideoMaybeWatermark(result.url, ctx.jobId, ctx.jobUserId, ctx.shouldWatermark)
  await setJobProgress(job, ctx.jobId, 100)

  if (!await shouldSaveJobResult(ctx.jobId)) return

  const ok = await markJobCompleted(ctx.jobId, {
    output_data: { videoUrl: r2Url },
    provider: result.providerUsed,
    provider_cost: result.cost,
    display_cost: result.displayCost,
  })
  if (!ok) return

  await commitJobCredits(ctx.usageLogId, ctx.jobId, result.cost)
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url} (provider: ${result.providerUsed}, cost: $${result.cost?.toFixed(6) ?? "N/A"})`)
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
  "generate-character-motion": handleGenerateCharacterMotion,
}
