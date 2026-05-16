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
import {
  attachAssetToCharacter,
  setCharacterPortrait,
  resolveAssetColumn,
  type CharacterAssetColumn,
} from "../../lib/character-auto-attach.js"

interface EntityImageJobData {
  jobId: string
  prompt: string
  sourceImageUrl?: string
  assetType?: string
  provider?: string
  // Character Studio auto-attach (best-effort). When set, after the image is
  // generated and stored on the jobs row, the result URL is also written
  // directly to the user's characters row — so closing the studio mid-job
  // doesn't orphan the result. See `lib/character-auto-attach.ts`.
  attachToCharacterId?: string
  attachToColumn?: string // "expressions" | "poses" | "angles" | "lighting_variations" | undefined
  attachName?: string
  // Richer Character Studio fields that travel alongside the asset for
  // downstream prompt enrichment. Routes (later tasks) put these on
  // `job.data`; the worker only reads + forwards them.
  description?: string
  motionDescription?: string
  realLifeRefs?: string[]
  // Per-asset-type aspect-ratio (set by the route via
  // `resolveCharacterAspectRatio`). When present, takes precedence over the
  // handler's static `opts.aspectRatio` so each generation can pick a
  // framing that matches its asset type (portrait=3:4, poses=9:16, etc.).
  aspectRatio?: string
}

function makeEntityImageHandler(
  logPrefix: string,
  opts?: { aspectRatio?: string; includeAssetType?: boolean },
): HandlerFn {
  return async function entityImageHandler(job: Job, ctx: JobContext) {
    const data = job.data as EntityImageJobData
    const {
      prompt,
      sourceImageUrl,
      assetType,
      provider,
      attachToCharacterId,
      attachToColumn,
      attachName,
      description,
      motionDescription,
      realLifeRefs,
      aspectRatio,
    } = data
    const resolvedProvider = provider ?? "nano-banana"

    if (opts?.includeAssetType) {
      console.log(`[worker] ${logPrefix} ${ctx.jobId} (type: ${assetType}, provider: ${resolvedProvider})`)
    } else {
      console.log(`[worker] ${logPrefix} ${ctx.jobId} (provider: ${resolvedProvider}): "${prompt}"`)
    }

    const referenceImageUrls = sourceImageUrl ? [sourceImageUrl] : undefined
    // Per-job aspect ratio (set by the route's `resolveCharacterAspectRatio`)
    // wins over the handler's static `opts.aspectRatio` so each character
    // asset can pick a framing that matches its asset type. Generate-face
    // still pins 1:1 via opts because faces are always square crops.
    const effectiveAspectRatio = aspectRatio ?? opts?.aspectRatio
    const extraParams = effectiveAspectRatio ? { aspect_ratio: effectiveAspectRatio } : undefined
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

    // Best-effort: write the result back onto the user's character row so the
    // Studio reflects it across page reloads (even if the user closed the tab
    // mid-generation). Logs and continues on failure — credits are already
    // committed and the job row holds the URL as the ultimate source.
    if (attachToCharacterId && ctx.jobUserId) {
      if (logPrefix === "generate-character") {
        // Portrait → source_image_url
        await setCharacterPortrait({ characterId: attachToCharacterId, userId: ctx.jobUserId, url: r2Url })
      } else if (attachToColumn && attachName) {
        const column: CharacterAssetColumn | null = resolveAssetColumn(attachToColumn)
        if (column) {
          await attachAssetToCharacter({
            characterId: attachToCharacterId,
            userId: ctx.jobUserId,
            column,
            item: {
              name: attachName,
              url: r2Url,
              description,
              motionDescription,
              realLifeRefs,
            },
          })
        }
      }
    }

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
  const {
    prompt,
    sourceImageUrl,
    provider,
    attachToCharacterId,
    attachName,
    description,
    motionDescription,
    realLifeRefs,
    aspectRatio,
  } = job.data as {
    jobId: string
    prompt: string
    sourceImageUrl: string
    provider?: string
    attachToCharacterId?: string
    attachName?: string
    description?: string
    motionDescription?: string
    realLifeRefs?: string[]
    aspectRatio?: string
  }
  const resolvedProvider = provider ?? "kling"
  console.log(`[worker] generate-character-motion ${ctx.jobId} (provider: ${resolvedProvider}): "${prompt}"`)

  // Pass the resolved aspect ratio (default 9:16 for motions, overridden by
  // the character node toggle or an explicit `aspectRatio`) through the
  // image-to-video provider chain via `options.aspectRatio`.
  const result = await imageToVideo(
    sourceImageUrl,
    resolvedProvider,
    prompt,
    undefined,
    undefined,
    aspectRatio ? { aspectRatio } : undefined,
  )
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

  // Best-effort attach to characters.motions[]
  if (attachToCharacterId && attachName && ctx.jobUserId) {
    await attachAssetToCharacter({
      characterId: attachToCharacterId,
      userId: ctx.jobUserId,
      column: "motions",
      item: {
        name: attachName,
        url: r2Url,
        description,
        motionDescription,
        realLifeRefs,
      },
    })
  }

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
