import { supabase } from "../../lib/supabase.js"
import { generateImage } from "../../providers/index.js"
import { generateScript, type ScriptProvider } from "../../providers/script/script-generator.js"
import {
  commitJobCredits,
  shouldSaveJobResult,
  uploadImageMaybeWatermark,
  type HandlerFn,
} from "../shared.js"

const handleGenerateCharacter: HandlerFn = async function handleGenerateCharacter(job, ctx) {
  const { prompt, sourceImageUrl, provider } = job.data as { jobId: string; prompt: string; sourceImageUrl?: string; provider?: string }
  console.log(`[worker] generate-character ${ctx.jobId} (provider: ${provider ?? "nano-banana"}): "${prompt}"`)
  const referenceImageUrls = sourceImageUrl ? [sourceImageUrl] : undefined
  const result = await generateImage(prompt, provider ?? "nano-banana", referenceImageUrls)
  await job.updateProgress(50)
  const r2Url = await uploadImageMaybeWatermark(result.url, ctx.jobId, ctx.jobUserId, ctx.shouldWatermark)
  await job.updateProgress(100)

  if (!await shouldSaveJobResult(ctx.jobId)) return

  await supabase.from("jobs").update({
    status: "completed",
    progress: 100,
    output_data: { imageUrl: r2Url },
    completed_at: new Date().toISOString(),
    provider: result.providerUsed,
    provider_cost: result.cost,
    display_cost: result.displayCost,
  }).eq("id", ctx.jobId)
  await commitJobCredits(ctx.usageLogId, ctx.jobId)
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url} (provider: ${result.providerUsed}, cost: $${result.cost?.toFixed(6) ?? "N/A"})`)
}

const handleGenerateFace: HandlerFn = async function handleGenerateFace(job, ctx) {
  const { prompt, sourceImageUrl, provider } = job.data as { jobId: string; prompt: string; sourceImageUrl?: string; provider?: string }
  console.log(`[worker] generate-face ${ctx.jobId} (provider: ${provider ?? "nano-banana"}): "${prompt}"`)
  const referenceImageUrls = sourceImageUrl ? [sourceImageUrl] : undefined
  const result = await generateImage(prompt, provider ?? "nano-banana", referenceImageUrls, { aspect_ratio: "1:1" })
  await job.updateProgress(50)
  const r2Url = await uploadImageMaybeWatermark(result.url, ctx.jobId, ctx.jobUserId, ctx.shouldWatermark)
  await job.updateProgress(100)

  if (!await shouldSaveJobResult(ctx.jobId)) return

  await supabase.from("jobs").update({
    status: "completed",
    progress: 100,
    output_data: { imageUrl: r2Url },
    completed_at: new Date().toISOString(),
    provider: result.providerUsed,
    provider_cost: result.cost,
    display_cost: result.displayCost,
  }).eq("id", ctx.jobId)
  await commitJobCredits(ctx.usageLogId, ctx.jobId)
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url} (provider: ${result.providerUsed}, cost: $${result.cost?.toFixed(6) ?? "N/A"})`)
}

const handleGenerateCharacterAsset: HandlerFn = async function handleGenerateCharacterAsset(job, ctx) {
  const { prompt, sourceImageUrl, assetType, provider } = job.data as { jobId: string; prompt: string; sourceImageUrl?: string; assetType: string; provider?: string }
  console.log(`[worker] generate-character-asset ${ctx.jobId} (type: ${assetType}, provider: ${provider ?? "nano-banana"})`)
  const referenceImageUrls = sourceImageUrl ? [sourceImageUrl] : undefined
  const result = await generateImage(prompt, provider ?? "nano-banana", referenceImageUrls)
  await job.updateProgress(50)
  const r2Url = await uploadImageMaybeWatermark(result.url, ctx.jobId, ctx.jobUserId, ctx.shouldWatermark)
  await job.updateProgress(100)

  if (!await shouldSaveJobResult(ctx.jobId)) return

  await supabase.from("jobs").update({
    status: "completed",
    progress: 100,
    output_data: { imageUrl: r2Url, assetType },
    completed_at: new Date().toISOString(),
    provider: result.providerUsed,
    provider_cost: result.cost,
    display_cost: result.displayCost,
  }).eq("id", ctx.jobId)
  await commitJobCredits(ctx.usageLogId, ctx.jobId)
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url} (provider: ${result.providerUsed}, cost: $${result.cost?.toFixed(6) ?? "N/A"})`)
}

const handleGenerateObject: HandlerFn = async function handleGenerateObject(job, ctx) {
  const { prompt, sourceImageUrl, provider } = job.data as { jobId: string; prompt: string; sourceImageUrl?: string; provider?: string }
  console.log(`[worker] generate-object ${ctx.jobId} (provider: ${provider ?? "nano-banana"}): "${prompt}"`)
  const referenceImageUrls = sourceImageUrl ? [sourceImageUrl] : undefined
  const result = await generateImage(prompt, provider ?? "nano-banana", referenceImageUrls)
  await job.updateProgress(50)
  const r2Url = await uploadImageMaybeWatermark(result.url, ctx.jobId, ctx.jobUserId, ctx.shouldWatermark)
  await job.updateProgress(100)

  if (!await shouldSaveJobResult(ctx.jobId)) return

  await supabase.from("jobs").update({
    status: "completed",
    progress: 100,
    output_data: { imageUrl: r2Url },
    completed_at: new Date().toISOString(),
    provider: result.providerUsed,
    provider_cost: result.cost,
    display_cost: result.displayCost,
  }).eq("id", ctx.jobId)
  await commitJobCredits(ctx.usageLogId, ctx.jobId)
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url} (provider: ${result.providerUsed}, cost: $${result.cost?.toFixed(6) ?? "N/A"})`)
}

const handleGenerateObjectAsset: HandlerFn = async function handleGenerateObjectAsset(job, ctx) {
  const { prompt, sourceImageUrl, assetType, provider } = job.data as { jobId: string; prompt: string; sourceImageUrl?: string; assetType: string; provider?: string }
  console.log(`[worker] generate-object-asset ${ctx.jobId} (type: ${assetType}, provider: ${provider ?? "nano-banana"})`)
  const referenceImageUrls = sourceImageUrl ? [sourceImageUrl] : undefined
  const result = await generateImage(prompt, provider ?? "nano-banana", referenceImageUrls)
  await job.updateProgress(50)
  const r2Url = await uploadImageMaybeWatermark(result.url, ctx.jobId, ctx.jobUserId, ctx.shouldWatermark)
  await job.updateProgress(100)

  if (!await shouldSaveJobResult(ctx.jobId)) return

  await supabase.from("jobs").update({
    status: "completed",
    progress: 100,
    output_data: { imageUrl: r2Url, assetType },
    completed_at: new Date().toISOString(),
    provider: result.providerUsed,
    provider_cost: result.cost,
    display_cost: result.displayCost,
  }).eq("id", ctx.jobId)
  await commitJobCredits(ctx.usageLogId, ctx.jobId)
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url} (provider: ${result.providerUsed}, cost: $${result.cost?.toFixed(6) ?? "N/A"})`)
}

const handleGenerateLocation: HandlerFn = async function handleGenerateLocation(job, ctx) {
  const { prompt, sourceImageUrl, provider } = job.data as { jobId: string; prompt: string; sourceImageUrl?: string; provider?: string }
  console.log(`[worker] generate-location ${ctx.jobId} (provider: ${provider ?? "nano-banana"}): "${prompt}"`)
  const referenceImageUrls = sourceImageUrl ? [sourceImageUrl] : undefined
  const result = await generateImage(prompt, provider ?? "nano-banana", referenceImageUrls)
  await job.updateProgress(50)
  const r2Url = await uploadImageMaybeWatermark(result.url, ctx.jobId, ctx.jobUserId, ctx.shouldWatermark)
  await job.updateProgress(100)

  if (!await shouldSaveJobResult(ctx.jobId)) return

  await supabase.from("jobs").update({
    status: "completed",
    progress: 100,
    output_data: { imageUrl: r2Url },
    completed_at: new Date().toISOString(),
    provider: result.providerUsed,
    provider_cost: result.cost,
    display_cost: result.displayCost,
  }).eq("id", ctx.jobId)
  await commitJobCredits(ctx.usageLogId, ctx.jobId)
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url} (provider: ${result.providerUsed}, cost: $${result.cost?.toFixed(6) ?? "N/A"})`)
}

const handleGenerateLocationAsset: HandlerFn = async function handleGenerateLocationAsset(job, ctx) {
  const { prompt, sourceImageUrl, assetType, provider } = job.data as { jobId: string; prompt: string; sourceImageUrl?: string; assetType: string; provider?: string }
  console.log(`[worker] generate-location-asset ${ctx.jobId} (type: ${assetType}, provider: ${provider ?? "nano-banana"})`)
  const referenceImageUrls = sourceImageUrl ? [sourceImageUrl] : undefined
  const result = await generateImage(prompt, provider ?? "nano-banana", referenceImageUrls)
  await job.updateProgress(50)
  const r2Url = await uploadImageMaybeWatermark(result.url, ctx.jobId, ctx.jobUserId, ctx.shouldWatermark)
  await job.updateProgress(100)

  if (!await shouldSaveJobResult(ctx.jobId)) return

  await supabase.from("jobs").update({
    status: "completed",
    progress: 100,
    output_data: { imageUrl: r2Url, assetType },
    completed_at: new Date().toISOString(),
    provider: result.providerUsed,
    provider_cost: result.cost,
    display_cost: result.displayCost,
  }).eq("id", ctx.jobId)
  await commitJobCredits(ctx.usageLogId, ctx.jobId)
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url} (provider: ${result.providerUsed}, cost: $${result.cost?.toFixed(6) ?? "N/A"})`)
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
  "generate-character": handleGenerateCharacter,
  "generate-face": handleGenerateFace,
  "generate-character-asset": handleGenerateCharacterAsset,
  "generate-object": handleGenerateObject,
  "generate-object-asset": handleGenerateObjectAsset,
  "generate-location": handleGenerateLocation,
  "generate-location-asset": handleGenerateLocationAsset,
  "generate-script": handleGenerateScript,
}
