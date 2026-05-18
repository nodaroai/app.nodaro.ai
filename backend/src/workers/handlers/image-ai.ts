import { generateImage, editImage } from "../../providers/index.js"
import {
  commitJobCredits,
  shouldSaveJobResult,
  markJobCompleted,
  buildProviderMeta,
  uploadImageMaybeWatermark,
  uploadImageVariantsMaybeWatermark,
  setJobProgress,
  startProgressRamp,
  type HandlerFn,
} from "../shared.js"
import { attachAssetToCharacter, resolveAssetColumn } from "../../lib/character-auto-attach.js"

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

  const allSourceUrls = [result.url, ...(result.extraUrls ?? [])]
  const r2Urls = await uploadImageVariantsMaybeWatermark(allSourceUrls, ctx.jobId, ctx.jobUserId, ctx.shouldWatermark)
  const r2Url = r2Urls[0]!
  await setJobProgress(job, ctx.jobId, 100)

  if (!await shouldSaveJobResult(ctx.jobId)) return

  const ok = await markJobCompleted(ctx.jobId, {
    output_data: {
      imageUrl: r2Url,
      ...(r2Urls.length > 1 ? { imageUrls: r2Urls } : {}),
      ...buildProviderMeta(result),
    },
    provider: result.providerUsed,
    provider_cost: result.cost,
    display_cost: result.displayCost,
  })
  if (!ok) return

  await commitJobCredits(ctx.usageLogId, ctx.jobId, result.cost)
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url}${r2Urls.length > 1 ? ` (+${r2Urls.length - 1} variants)` : ""} (provider: ${result.providerUsed}, cost: $${result.cost?.toFixed(6) ?? "N/A"})`)
}

const handleEditImage: HandlerFn = async function handleEditImage(job, ctx) {
  const { imageUrl, taskId, prompt, provider, upscaleFactor, aspectRatio, negativePrompt, style, seed, maskUrl } = job.data as {
    jobId: string
    imageUrl?: string
    taskId?: string
    prompt?: string
    provider?: string
    upscaleFactor?: string
    aspectRatio?: string
    negativePrompt?: string
    style?: string
    seed?: number
    maskUrl?: string
  }
  const resolvedProvider = provider ?? "recraft-upscale"
  // grok-upscale takes a prior Grok task_id instead of an image URL; the KIE
  // provider's editImage uses `imageParam` to route the input value to the
  // correct request key, so we just plumb taskId through the imageUrl arg
  // and let imageParam: "task_id" (in models.ts) place it correctly.
  const inputId = resolvedProvider === "grok-upscale" ? taskId : imageUrl
  if (!inputId) {
    throw new Error(
      resolvedProvider === "grok-upscale"
        ? "grok-upscale requires taskId from a prior Grok generation"
        : "edit-image requires imageUrl",
    )
  }
  // Append style to prompt if present (same pattern as generate-image)
  const effectivePrompt = style && prompt ? `${prompt}. Style: ${style}` : prompt
  console.log(`[worker] edit-image ${ctx.jobId} (provider: ${resolvedProvider}): "${effectivePrompt ?? "(no prompt)"}"`)

  const extraParams: Record<string, unknown> = {
    ...(upscaleFactor && { upscale_factor: upscaleFactor }),
    ...(aspectRatio && { image_size: aspectRatio }),
    ...(negativePrompt && { negative_prompt: negativePrompt }),
    ...(seed != null && { seed }),
    ...(maskUrl && { mask_url: maskUrl }),
  }
  const hasExtraParams = Object.keys(extraParams).length > 0

  await setJobProgress(job, ctx.jobId, 10)
  const editRamp = startProgressRamp(job, ctx.jobId, { start: 10, cap: 55 })
  let result
  try {
    result = await editImage(inputId, resolvedProvider, effectivePrompt, hasExtraParams ? extraParams : undefined)
  } finally {
    editRamp.stop()
  }
  await setJobProgress(job, ctx.jobId, 60)

  const allSourceUrls = [result.url, ...(result.extraUrls ?? [])]
  const r2Urls = await uploadImageVariantsMaybeWatermark(allSourceUrls, ctx.jobId, ctx.jobUserId, ctx.shouldWatermark)
  const r2Url = r2Urls[0]!
  await setJobProgress(job, ctx.jobId, 100)

  if (!await shouldSaveJobResult(ctx.jobId)) return

  const ok = await markJobCompleted(ctx.jobId, {
    output_data: {
      imageUrl: r2Url,
      ...(r2Urls.length > 1 ? { imageUrls: r2Urls } : {}),
      ...buildProviderMeta(result),
    },
    provider: result.providerUsed,
    provider_cost: result.cost,
    display_cost: result.displayCost,
  })
  if (!ok) return

  await commitJobCredits(ctx.usageLogId, ctx.jobId, result.cost)
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url}${r2Urls.length > 1 ? ` (+${r2Urls.length - 1} variants)` : ""} (provider: ${result.providerUsed}, cost: $${result.cost?.toFixed(6) ?? "N/A"})`)
}

const handleImageToImage: HandlerFn = async function handleImageToImage(job, ctx) {
  const { imageUrl, referenceImageUrls, prompt, provider, resolution, quality, strength, aspectRatio, negativePrompt, seed, renderingSpeed, guidanceScale, maskUrl, attachToCharacterId, attachToColumn, attachName, description, realLifeRefs } = job.data as {
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
    // Character Studio auto-attach. Best-effort: result lands in jobs.output_data
    // regardless; failures to attach are logged and ignored.
    attachToCharacterId?: string
    attachToColumn?: string
    attachName?: string
    // Character Studio Identity Foundation (PR 1) — richer asset-item fields
    // forwarded by the route on the studio path. Both are optional: the route
    // only includes them when attachToCharacterId is set, and the LLM-drafted
    // `description` may have failed (route swallows that error). Worker
    // forwards them straight through to attachAssetToCharacter's `item`.
    description?: string
    realLifeRefs?: string[]
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
  // Ramp progress while the KIE / Replicate call is in flight — providers
  // don't expose incremental progress, so without this the widget shows
  // 10% for the full 30s–2min the call can take (especially nano-banana-pro
  // 4K). Match the T2I handler's ramp shape; cap below the post-call jump.
  const i2iRamp = startProgressRamp(job, ctx.jobId, { start: 10, cap: 55 })
  let result
  try {
    result = await generateImage(prompt, resolvedProvider, allImages, hasExtraParams ? extraParams : undefined)
  } finally {
    i2iRamp.stop()
  }
  await setJobProgress(job, ctx.jobId, 60)

  const allSourceUrls = [result.url, ...(result.extraUrls ?? [])]
  const r2Urls = await uploadImageVariantsMaybeWatermark(allSourceUrls, ctx.jobId, ctx.jobUserId, ctx.shouldWatermark)
  const r2Url = r2Urls[0]!
  await setJobProgress(job, ctx.jobId, 100)

  if (!await shouldSaveJobResult(ctx.jobId)) return

  const ok = await markJobCompleted(ctx.jobId, {
    output_data: {
      imageUrl: r2Url,
      ...(r2Urls.length > 1 ? { imageUrls: r2Urls } : {}),
      ...buildProviderMeta(result),
    },
    provider: result.providerUsed,
    provider_cost: result.cost,
    display_cost: result.displayCost,
  })
  if (!ok) return

  await commitJobCredits(ctx.usageLogId, ctx.jobId, result.cost)

  if (attachToCharacterId && attachToColumn && attachName && ctx.jobUserId) {
    const column = resolveAssetColumn(attachToColumn)
    if (column) {
      await attachAssetToCharacter({
        characterId: attachToCharacterId,
        userId: ctx.jobUserId,
        column,
        item: {
          name: attachName,
          url: r2Url,
          description,
          realLifeRefs,
        },
      })
    }
  }

  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url} (provider: ${result.providerUsed}, cost: $${result.cost?.toFixed(6) ?? "N/A"})`)
}

export const imageAIHandlers: Record<string, HandlerFn> = {
  "generate-image": handleGenerateImage,
  "edit-image": handleEditImage,
  "image-to-image": handleImageToImage,
}
