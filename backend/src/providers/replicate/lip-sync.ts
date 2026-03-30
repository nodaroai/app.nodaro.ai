/**
 * Replicate Lip-Sync Provider
 *
 * Supports four models: LatentSync, Wav2Lip, Video-Retalking, SadTalker.
 * Follows the VIDEO_MODEL_CONFIGS pattern from replicate/video.ts.
 */

import { replicate, extractUrl, extractCost } from "./client.js"

interface LipSyncModelConfig {
  model: string
  faceParam: string
  audioParam: string
}

const LIP_SYNC_MODEL_CONFIGS: Record<string, LipSyncModelConfig> = {
  latentsync: {
    model: "bytedance/latentsync",
    faceParam: "video",
    audioParam: "audio",
  },
  wav2lip: {
    model: "devxpy/cog-wav2lip",
    faceParam: "face",
    audioParam: "audio",
  },
  "video-retalking": {
    model: "chenxwh/video-retalking",
    faceParam: "face",
    audioParam: "input_audio",
  },
  sadtalker: {
    model: "cjwbw/sadtalker",
    faceParam: "source_image",
    audioParam: "driven_audio",
  },
}

export interface ReplicateLipSyncParams {
  // LatentSync
  guidanceScale?: number
  inferenceSteps?: number
  seed?: number
  // Wav2Lip
  pads?: string
  smooth?: boolean
  fps?: number
  resizeFactor?: number
  // SadTalker
  enhancer?: string
  preprocess?: string
  still?: boolean
  poseStyle?: number
  expressionScale?: number
}

export async function replicateLipSync(
  provider: string,
  faceUrl: string,
  audioUrl: string,
  params: ReplicateLipSyncParams = {},
): Promise<{ videoUrl: string; cost: number | null }> {
  const cfg = LIP_SYNC_MODEL_CONFIGS[provider]
  if (!cfg) {
    throw new Error(`Unsupported Replicate lip-sync provider: ${provider}`)
  }

  console.log(`[Replicate:lipSync] Provider: ${provider}, Model: ${cfg.model}`)
  console.log(`[Replicate:lipSync] Face: ${faceUrl}, Audio: ${audioUrl}`)

  const input: Record<string, unknown> = {
    [cfg.faceParam]: faceUrl,
    [cfg.audioParam]: audioUrl,
  }

  // LatentSync params
  if (provider === "latentsync") {
    if (params.guidanceScale !== undefined) input.guidance_scale = params.guidanceScale
    if (params.inferenceSteps !== undefined) input.inference_steps = params.inferenceSteps
    if (params.seed !== undefined) input.seed = params.seed
  }

  // Wav2Lip params
  if (provider === "wav2lip") {
    if (params.pads !== undefined) input.pads = params.pads
    if (params.smooth !== undefined) input.smooth = params.smooth
    if (params.fps !== undefined) input.fps = params.fps
    if (params.resizeFactor !== undefined) input.resize_factor = params.resizeFactor
  }

  // SadTalker params
  if (provider === "sadtalker") {
    if (params.enhancer !== undefined) input.enhancer = params.enhancer
    if (params.preprocess !== undefined) input.preprocess = params.preprocess
    if (params.still !== undefined) input.still = params.still
    if (params.poseStyle !== undefined) input.pose_style = params.poseStyle
    if (params.expressionScale !== undefined) input.expression_scale = params.expressionScale
  }

  console.log(`[Replicate:lipSync] Request:`, JSON.stringify({ model: cfg.model, input }, null, 2))

  const prediction = await replicate.predictions.create({
    model: cfg.model as `${string}/${string}`,
    input,
  })
  const completed = await replicate.wait(prediction)
  const output = completed.output

  const videoUrl = extractUrl(
    typeof output === "string" ? output : Array.isArray(output) && output.length > 0 ? output[0] : output,
  )
  const cost = extractCost(completed.metrics as Record<string, unknown> | undefined)

  console.log(`[Replicate:lipSync] Output: "${videoUrl}"`)
  console.log(`[Replicate:lipSync] Cost: $${cost?.toFixed(6) ?? "N/A"}`)

  return { videoUrl, cost }
}
