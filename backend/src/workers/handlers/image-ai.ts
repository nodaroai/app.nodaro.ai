import { generateImage, editImage } from "../../providers/index.js"
import {
  commitJobCredits,
  shouldSaveJobResult,
  markJobCompleted,
  uploadImageMaybeWatermark,
  setJobProgress,
  startProgressRamp,
  type HandlerFn,
} from "../shared.js"

const handleGenerateImage: HandlerFn = async function handleGenerateImage(job, ctx) {
  const { prompt, referenceImageUrls, provider, aspectRatio, resolution, quality, negativePrompt, seed, renderingSpeed, styleType, expandPrompt } = job.data as {
    jobId: string
    prompt: string
    referenceImageUrls?: string[]
    provider?: string
    aspectRatio?: string
    resolution?: string
    quality?: string
    negativePrompt?: string
    seed?: number
    renderingSpeed?: string
    styleType?: string
    expandPrompt?: boolean
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
    ...(seed != null && { seed }),
    ...(renderingSpeed && { rendering_speed: renderingSpeed }),
    ...(styleType && { style_type: styleType }),
    ...(expandPrompt != null && { expand_prompt: expandPrompt }),
  }
  const hasExtraParams = Object.keys(extraParams).length > 0
  await setJobProgress(job, ctx.jobId, 10)
  const ramp = startProgressRamp(job, ctx.jobId, { start: 10, cap: 80 })
  let result
  try {
    result = await generateImage(prompt, provider ?? "nano-banana", referenceImageUrls, hasExtraParams ? extraParams : undefined)
  } finally {
    ramp.stop()
  }
  await setJobProgress(job, ctx.jobId, 85)

  const r2Url = await uploadImageMaybeWatermark(result.url, ctx.jobId, ctx.jobUserId, ctx.shouldWatermark)
  await setJobProgress(job, ctx.jobId, 100)

  if (!await shouldSaveJobResult(ctx.jobId)) return

  const ok = await markJobCompleted(ctx.jobId, {
    output_data: { imageUrl: r2Url },
    provider: result.providerUsed,
    provider_cost: result.cost,
    display_cost: result.displayCost,
  })
  if (!ok) return

  await commitJobCredits(ctx.usageLogId, ctx.jobId, result.cost)
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url} (provider: ${result.providerUsed}, cost: $${result.cost?.toFixed(6) ?? "N/A"})`)
}

const handleEditImage: HandlerFn = async function handleEditImage(job, ctx) {
  const { imageUrl, prompt, provider, upscaleFactor, aspectRatio, negativePrompt, style, seed } = job.data as {
    jobId: string
    imageUrl: string
    prompt?: string
    provider?: string
    upscaleFactor?: string
    aspectRatio?: string
    negativePrompt?: string
    style?: string
    seed?: number
  }
  const resolvedProvider = provider ?? "recraft-upscale"
  // Append style to prompt if present (same pattern as generate-image)
  const effectivePrompt = style && prompt ? `${prompt}. Style: ${style}` : prompt
  console.log(`[worker] edit-image ${ctx.jobId} (provider: ${resolvedProvider}): "${effectivePrompt ?? "(no prompt)"}"`)

  const extraParams: Record<string, unknown> = {
    ...(upscaleFactor && { upscale_factor: upscaleFactor }),
    ...(aspectRatio && { image_size: aspectRatio }),
    ...(negativePrompt && { negative_prompt: negativePrompt }),
    ...(seed != null && { seed }),
  }
  const hasExtraParams = Object.keys(extraParams).length > 0

  await setJobProgress(job, ctx.jobId, 10)
  const result = await editImage(imageUrl, resolvedProvider, effectivePrompt, hasExtraParams ? extraParams : undefined)
  await setJobProgress(job, ctx.jobId, 60)

  const r2Url = await uploadImageMaybeWatermark(result.url, ctx.jobId, ctx.jobUserId, ctx.shouldWatermark)
  await setJobProgress(job, ctx.jobId, 100)

  if (!await shouldSaveJobResult(ctx.jobId)) return

  const ok = await markJobCompleted(ctx.jobId, {
    output_data: { imageUrl: r2Url },
    provider: result.providerUsed,
    provider_cost: result.cost,
    display_cost: result.displayCost,
  })
  if (!ok) return

  await commitJobCredits(ctx.usageLogId, ctx.jobId, result.cost)
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url} (provider: ${result.providerUsed}, cost: $${result.cost?.toFixed(6) ?? "N/A"})`)
}

const handleImageToImage: HandlerFn = async function handleImageToImage(job, ctx) {
  const { imageUrl, referenceImageUrls, prompt, provider, resolution, quality, strength, aspectRatio, negativePrompt, seed, renderingSpeed, guidanceScale, maskUrl } = job.data as {
    jobId: string
    imageUrl: string
    referenceImageUrls?: string[]
    prompt: string
    provider?: string
    resolution?: string
    quality?: string
    strength?: number
    aspectRatio?: string
    negativePrompt?: string
    seed?: number
    renderingSpeed?: string
    guidanceScale?: number
    maskUrl?: string
  }
  const resolvedProvider = provider ?? "nano-banana"
  // Combine main image with additional reference images (e.g., from Location/Character nodes)
  const allImages = [imageUrl, ...(referenceImageUrls ?? [])]
  console.log(`[worker] image-to-image ${ctx.jobId} (provider: ${resolvedProvider}, images: ${allImages.length}): "${prompt}"`)

  const extraParams: Record<string, unknown> = {
    ...(aspectRatio && { aspect_ratio: aspectRatio }),
    ...(resolution && { resolution }),
    ...(quality && { quality }),
    ...(strength != null && { strength }),
    ...(negativePrompt && { negative_prompt: negativePrompt }),
    ...(seed != null && { seed }),
    ...(renderingSpeed && { rendering_speed: renderingSpeed }),
    ...(guidanceScale != null && { guidance_scale: guidanceScale }),
    ...(maskUrl && { mask_url: maskUrl }),
  }
  const hasExtraParams = Object.keys(extraParams).length > 0
  await setJobProgress(job, ctx.jobId, 10)
  const result = await generateImage(prompt, resolvedProvider, allImages, hasExtraParams ? extraParams : undefined)
  await setJobProgress(job, ctx.jobId, 60)

  const r2Url = await uploadImageMaybeWatermark(result.url, ctx.jobId, ctx.jobUserId, ctx.shouldWatermark)
  await setJobProgress(job, ctx.jobId, 100)

  if (!await shouldSaveJobResult(ctx.jobId)) return

  const ok = await markJobCompleted(ctx.jobId, {
    output_data: { imageUrl: r2Url },
    provider: result.providerUsed,
    provider_cost: result.cost,
    display_cost: result.displayCost,
  })
  if (!ok) return

  await commitJobCredits(ctx.usageLogId, ctx.jobId, result.cost)
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url} (provider: ${result.providerUsed}, cost: $${result.cost?.toFixed(6) ?? "N/A"})`)
}

export const imageAIHandlers: Record<string, HandlerFn> = {
  "generate-image": handleGenerateImage,
  "edit-image": handleEditImage,
  "image-to-image": handleImageToImage,
}
