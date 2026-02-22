import { supabase } from "../../lib/supabase.js"
import { generateImage, editImage } from "../../providers/index.js"
import {
  commitJobCredits,
  shouldSaveJobResult,
  uploadImageMaybeWatermark,
  type HandlerFn,
} from "../shared.js"

const handleGenerateImage: HandlerFn = async function handleGenerateImage(job, ctx) {
  const { prompt, referenceImageUrls, provider, aspectRatio, resolution, quality, negativePrompt } = job.data as {
    jobId: string
    prompt: string
    referenceImageUrls?: string[]
    provider?: string
    aspectRatio?: string
    resolution?: string
    quality?: string
    negativePrompt?: string
  }
  console.log(`[worker] generate-image ${ctx.jobId} (provider: ${provider ?? "nano-banana"}): "${prompt}"`)
  if (referenceImageUrls?.length) {
    console.log(`[worker] Reference images (${referenceImageUrls.length}): ${referenceImageUrls.join(", ")}`)
  }

  const extraParams: Record<string, unknown> = {
    ...(aspectRatio && { aspect_ratio: aspectRatio }),
    ...(resolution && { resolution }),
    ...(quality && { quality }),
    ...(negativePrompt && { negative_prompt: negativePrompt }),
  }
  const hasExtraParams = Object.keys(extraParams).length > 0
  const result = await generateImage(prompt, provider ?? "nano-banana", referenceImageUrls, hasExtraParams ? extraParams : undefined)
  await job.updateProgress(50)

  const r2Url = await uploadImageMaybeWatermark(result.url, ctx.jobId, ctx.jobUserId, ctx.shouldWatermark)
  await job.updateProgress(100)

  if (!await shouldSaveJobResult(ctx.jobId)) return

  await supabase
    .from("jobs")
    .update({
      status: "completed",
      progress: 100,
      output_data: { imageUrl: r2Url },
      completed_at: new Date().toISOString(),
      provider: result.providerUsed,
      provider_cost: result.cost,
      display_cost: result.displayCost,
    })
    .eq("id", ctx.jobId)

  await commitJobCredits(ctx.usageLogId, ctx.jobId)
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url} (provider: ${result.providerUsed}, cost: $${result.cost?.toFixed(6) ?? "N/A"})`)
}

const handleEditImage: HandlerFn = async function handleEditImage(job, ctx) {
  const { imageUrl, prompt, provider } = job.data as {
    jobId: string
    imageUrl: string
    prompt?: string
    provider?: "recraft-upscale" | "recraft-remove-bg" | "nano-banana-edit"
  }
  const resolvedProvider = provider ?? "recraft-upscale"
  console.log(`[worker] edit-image ${ctx.jobId} (provider: ${resolvedProvider}): "${prompt ?? "(no prompt)"}"`)

  const result = await editImage(imageUrl, resolvedProvider, prompt)
  await job.updateProgress(50)

  const r2Url = await uploadImageMaybeWatermark(result.url, ctx.jobId, ctx.jobUserId, ctx.shouldWatermark)
  await job.updateProgress(100)

  if (!await shouldSaveJobResult(ctx.jobId)) return

  await supabase
    .from("jobs")
    .update({
      status: "completed",
      progress: 100,
      output_data: { imageUrl: r2Url },
      completed_at: new Date().toISOString(),
      provider: result.providerUsed,
      provider_cost: result.cost,
      display_cost: result.displayCost,
    })
    .eq("id", ctx.jobId)

  await commitJobCredits(ctx.usageLogId, ctx.jobId)
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url} (provider: ${result.providerUsed}, cost: $${result.cost?.toFixed(6) ?? "N/A"})`)
}

const handleImageToImage: HandlerFn = async function handleImageToImage(job, ctx) {
  const { imageUrl, referenceImageUrls, prompt, provider } = job.data as {
    jobId: string
    imageUrl: string
    referenceImageUrls?: string[]
    prompt: string
    provider?: "nano-banana" | "nano-banana-pro" | "flux-i2i" | "flux-pro-i2i" | "grok-i2i" | "gpt-image-i2i"
  }
  const resolvedProvider = provider ?? "nano-banana"
  // Combine main image with additional reference images (e.g., from Location/Character nodes)
  const allImages = [imageUrl, ...(referenceImageUrls ?? [])]
  console.log(`[worker] image-to-image ${ctx.jobId} (provider: ${resolvedProvider}, images: ${allImages.length}): "${prompt}"`)

  const result = await generateImage(prompt, resolvedProvider, allImages)
  await job.updateProgress(50)

  const r2Url = await uploadImageMaybeWatermark(result.url, ctx.jobId, ctx.jobUserId, ctx.shouldWatermark)
  await job.updateProgress(100)

  if (!await shouldSaveJobResult(ctx.jobId)) return

  await supabase
    .from("jobs")
    .update({
      status: "completed",
      progress: 100,
      output_data: { imageUrl: r2Url },
      completed_at: new Date().toISOString(),
      provider: result.providerUsed,
      provider_cost: result.cost,
      display_cost: result.displayCost,
    })
    .eq("id", ctx.jobId)

  await commitJobCredits(ctx.usageLogId, ctx.jobId)
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url} (provider: ${result.providerUsed}, cost: $${result.cost?.toFixed(6) ?? "N/A"})`)
}

export const imageAIHandlers: Record<string, HandlerFn> = {
  "generate-image": handleGenerateImage,
  "edit-image": handleEditImage,
  "image-to-image": handleImageToImage,
}
