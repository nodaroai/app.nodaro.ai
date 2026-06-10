import { generateImage, editImage } from "../../providers/index.js"
import {
  setJobProgress,
  startProgressRamp,
  type HandlerFn,
} from "../shared.js"
import { attachAssetToCharacter, resolveAssetColumn } from "../../lib/character-auto-attach.js"
import { makeOnTaskCreated } from "../../lib/reconcile/persistence.js"
import { providerKindForImageModel } from "../../lib/reconcile/provider-kind.js"
import { finalizeJobWithMedia } from "../../lib/job-finalize.js"
import { supabase } from "../../lib/supabase.js"
import { IMAGE_MASK_MODE, describeMaskRegion, T2I_TO_I2I_VARIANT, type ImageGenProvider } from "@nodaro/shared"
import { compositeInpaint, maskBoundingBoxFromUrl, imageDimensions } from "../../services/inpaint/composite.js"

const handleGenerateImage: HandlerFn = async function handleGenerateImage(job, ctx) {
  const { prompt, referenceImageUrls, provider, model, aspectRatio, resolution, quality, negativePrompt, seed, renderingSpeed, styleType, expandPrompt, extraParams: upstreamExtras, baseImageUrl, maskUrl, strength, guidanceScale } = job.data as {
    jobId: string
    prompt: string
    referenceImageUrls?: string[]
    provider?: string
    /** Synthetic model id (e.g. "flux-lora-character") when the orchestrator
     *  or single-node route swaps to an internal-only model. The router's
     *  second positional arg is the *model* id, not the provider — without
     *  this destructure the worker would pass `provider` as the model and
     *  break LoRA routing. */
    model?: string
    aspectRatio?: string
    resolution?: string
    quality?: string
    negativePrompt?: string
    seed?: number
    renderingSpeed?: string
    styleType?: string
    expandPrompt?: boolean
    /** Upstream-supplied provider-specific params (e.g. `lora_version` +
     *  `lora_trigger` for `flux-lora-character`). Merged with the rebuilt
     *  per-field params below. */
    extraParams?: Record<string, unknown>
    /** Inpaint: base image to edit + white=edit/black=keep mask. When both are
     *  present the handler runs i2i conditioned on the base, then composites
     *  the masked region of the result over the base (the correctness floor). */
    baseImageUrl?: string
    maskUrl?: string
    strength?: number
    guidanceScale?: number
  }
  const resolvedModel = model ?? provider ?? "nano-banana"
  const inpaintBase = baseImageUrl ?? referenceImageUrls?.[0]
  // A mask present + a base → masked inpaint (composite + region hint).
  const isInpaint = Boolean(maskUrl && inpaintBase)
  // An EXPLICIT baseImageUrl (the "refine from this result" / full-image i2i case)
  // OR an inpaint → run image-to-image conditioned on the base. The route only
  // swaps T2I→I2I when referenceImageUrls is non-empty, which it isn't for a
  // baseImageUrl-driven edit — so swap here, and ensure the base is a reference.
  const isI2I = isInpaint || Boolean(baseImageUrl)
  const effectiveModel = isI2I ? (T2I_TO_I2I_VARIANT[resolvedModel] ?? resolvedModel) : resolvedModel
  const providerRefs = isI2I
    ? [inpaintBase!, ...(referenceImageUrls ?? []).filter((u) => u !== inpaintBase)]
    : referenceImageUrls
  console.log(`[worker] generate-image ${ctx.jobId} (model: ${effectiveModel}${isInpaint ? ", inpaint" : isI2I ? ", i2i" : ""}): "${prompt}"`)
  if (providerRefs?.length) {
    console.log(`[worker] Reference images (${providerRefs.length}): ${providerRefs.join(", ")}`)
  }

  const extraParams: Record<string, unknown> = {
    ...(upstreamExtras ?? {}),
    ...(aspectRatio && { aspect_ratio: aspectRatio }),
    ...(resolution && { resolution }),
    ...(quality && { quality }),
    ...(negativePrompt && { negative_prompt: negativePrompt }),
    ...(seed != null && { seed }),
    ...(renderingSpeed && { rendering_speed: renderingSpeed }),
    ...(styleType && { style_type: styleType }),
    ...(expandPrompt != null && { expand_prompt: expandPrompt }),
    ...(strength != null && { strength }),
    ...(guidanceScale != null && { guidance_scale: guidanceScale }),
  }
  const hasExtraParams = Object.keys(extraParams).length > 0
  await setJobProgress(job, ctx.jobId, 10)
  const ramp = startProgressRamp(job, ctx.jobId, { start: 10, cap: 80 })
  // Reconcile kind is keyed off the model actually called (the i2i variant on
  // an inpaint), so the task-created persistence records the right provider kind.
  const onTaskCreated = makeOnTaskCreated(ctx.jobId, providerKindForImageModel(effectiveModel))

  // Tier-B hint (best-effort; NEVER fails the job). Look up IMAGE_MASK_MODE by
  // the ORIGINAL gen provider (`resolvedModel`) — the map is keyed by
  // ImageGenProvider, not the swapped i2i variant.
  let effectivePrompt = prompt
  if (isInpaint && IMAGE_MASK_MODE[resolvedModel as ImageGenProvider] === "prompt") {
    try {
      const [box, dims] = await Promise.all([
        maskBoundingBoxFromUrl(maskUrl!),
        imageDimensions(inpaintBase!),
      ])
      if (box && dims.width && dims.height) effectivePrompt = describeMaskRegion(box, dims).fragment + prompt
    } catch {
      /* hint is best-effort — the composite floor still guarantees correctness */
    }
  }

  let result
  try {
    result = await generateImage(
      effectivePrompt,
      effectiveModel,
      providerRefs,
      hasExtraParams ? extraParams : undefined,
      { onTaskCreated },
    )
  } finally {
    ramp.stop()
  }
  await setJobProgress(job, ctx.jobId, 85)

  let mediaUrl: string | undefined
  if (isInpaint) {
    // REFUND-CRITICAL: run the composite BEFORE finalizeJobWithMedia and let a
    // plain Error propagate. Do NOT wrap this in try/catch or runPostProcessing —
    // swallowing the throw (or running it after finalize) would mark the job
    // completed and charge the user for a broken composite. The worker's
    // charge-for-nothing guard only refunds when the job is NOT yet completed.
    // See test "composite rejects (plain Error): ... finalize is NOT called".
    mediaUrl = await compositeInpaint({
      baseUrl: inpaintBase!,
      resultUrl: result.url,
      maskUrl: maskUrl!,
      jobId: ctx.jobId,
    })
  }

  const { ok } = await finalizeJobWithMedia({
    jobId: ctx.jobId,
    jobType: "generate-image",
    result,
    ...(mediaUrl && { mediaUrl }),
  })
  if (!ok) return
  await setJobProgress(job, ctx.jobId, 100)
  console.log(`[worker] Job ${ctx.jobId} completed (provider: ${result.providerUsed}, cost: $${result.cost?.toFixed(6) ?? "N/A"})`)
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
  const onTaskCreated = makeOnTaskCreated(ctx.jobId, providerKindForImageModel(resolvedProvider))
  let result
  try {
    result = await editImage(
      inputId,
      resolvedProvider,
      effectivePrompt,
      hasExtraParams ? extraParams : undefined,
      { onTaskCreated },
    )
  } finally {
    editRamp.stop()
  }
  await setJobProgress(job, ctx.jobId, 60)

  const { ok } = await finalizeJobWithMedia({
    jobId: ctx.jobId,
    jobType: "edit-image",
    result,
  })
  if (!ok) return
  await setJobProgress(job, ctx.jobId, 100)
  console.log(`[worker] Job ${ctx.jobId} completed (provider: ${result.providerUsed}, cost: $${result.cost?.toFixed(6) ?? "N/A"})`)
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
  const onTaskCreated = makeOnTaskCreated(ctx.jobId, providerKindForImageModel(resolvedProvider))
  let result
  try {
    result = await generateImage(
      prompt,
      resolvedProvider,
      allImages,
      hasExtraParams ? extraParams : undefined,
      { onTaskCreated },
    )
  } finally {
    i2iRamp.stop()
  }
  await setJobProgress(job, ctx.jobId, 60)

  const { ok } = await finalizeJobWithMedia({
    jobId: ctx.jobId,
    jobType: "image-to-image",
    result,
  })
  if (!ok) return
  await setJobProgress(job, ctx.jobId, 100)

  // Character Studio auto-attach. Read the persisted r2 URL back from the
  // job row (finalize wrote it into output_data.imageUrl) — finalize doesn't
  // return the upload URLs, so this is the canonical lookup.
  if (attachToCharacterId && attachToColumn && attachName && ctx.jobUserId) {
    const column = resolveAssetColumn(attachToColumn)
    if (column) {
      const { data: jobRow } = await supabase
        .from("jobs")
        .select("output_data")
        .eq("id", ctx.jobId)
        .single()
      const r2Url = (jobRow?.output_data as { imageUrl?: string } | null)?.imageUrl
      if (r2Url) {
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
  }

  console.log(`[worker] Job ${ctx.jobId} completed (provider: ${result.providerUsed}, cost: $${result.cost?.toFixed(6) ?? "N/A"})`)
}

export const imageAIHandlers: Record<string, HandlerFn> = {
  "generate-image": handleGenerateImage,
  "edit-image": handleEditImage,
  "image-to-image": handleImageToImage,
}
