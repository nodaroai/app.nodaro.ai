/**
 * Replicate Lip-Sync Provider
 *
 * Supports six models: LatentSync, Wav2Lip, Video-Retalking, SadTalker,
 * HeyGen Lipsync Precision, and Sync Lipsync 2 Pro.
 * Follows the VIDEO_MODEL_CONFIGS pattern from replicate/video.ts.
 */

import type { ReconcileOpts } from "../provider.interface.js"
import { extractUrl, runReplicatePrediction } from "./client.js"

interface LipSyncModelConfig {
  // Community models require version-based predictions (not model-based)
  version: string
  faceParam: string
  audioParam: string
}

const LIP_SYNC_MODEL_CONFIGS: Record<string, LipSyncModelConfig> = {
  latentsync: {
    version: "637ce1919f807ca20da3a448ddc2743535d2853649574cd52a933120e9b9e293",
    faceParam: "video",
    audioParam: "audio",
  },
  wav2lip: {
    version: "8d65e3f4f4298520e079198b493c25adfc43c058ffec924f2aefc8010ed25eef",
    faceParam: "face",
    audioParam: "audio",
  },
  "video-retalking": {
    version: "db5a650c807b007dc5f9e5abe27c53e1b62880d1f94d218d27ce7fa802711d67",
    faceParam: "face",
    audioParam: "input_audio",
  },
  sadtalker: {
    version: "a519cc0cfebaaeade068b23899165a11ec76aaa1d2b313d40d214f204ec957a3",
    faceParam: "source_image",
    audioParam: "driven_audio",
  },
  // HeyGen Lipsync Precision — avatar-inference dubbing on an existing video.
  "heygen-lipsync-precision": {
    version: "03d0f07dd626f1ef31febe77bcd36109359811887a9e358803747a9da2707d28",
    faceParam: "video",
    audioParam: "audio",
  },
  // Sync Lipsync 2 Pro — studio-grade lip sync (sync.so).
  "lipsync-2-pro": {
    version: "11f76931a8a9dbaea7958865fced66b2ee03ec0fda2928dbc7cb432c7bb48c6c",
    faceParam: "video",
    audioParam: "audio",
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
  // HeyGen Lipsync Precision
  enableDynamicDuration?: boolean
  disableMusicTrack?: boolean
  enableSpeechEnhancement?: boolean
  // Sync Lipsync 2 Pro
  syncMode?: string
  temperature?: number
  activeSpeaker?: boolean
}

export async function replicateLipSync(
  provider: string,
  faceUrl: string,
  audioUrl: string,
  params: ReplicateLipSyncParams = {},
  reconcileOpts?: ReconcileOpts,
): Promise<{ videoUrl: string; cost: number | null }> {
  const cfg = LIP_SYNC_MODEL_CONFIGS[provider]
  if (!cfg) {
    throw new Error(`Unsupported Replicate lip-sync provider: ${provider}`)
  }

  console.log(`[Replicate:lipSync] Provider: ${provider}, Version: ${cfg.version.slice(0, 12)}...`)
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

  // HeyGen Lipsync Precision params
  if (provider === "heygen-lipsync-precision") {
    if (params.enableDynamicDuration !== undefined) input.enable_dynamic_duration = params.enableDynamicDuration
    if (params.disableMusicTrack !== undefined) input.disable_music_track = params.disableMusicTrack
    if (params.enableSpeechEnhancement !== undefined) input.enable_speech_enhancement = params.enableSpeechEnhancement
  }

  // Sync Lipsync 2 Pro params
  if (provider === "lipsync-2-pro") {
    if (params.syncMode !== undefined) input.sync_mode = params.syncMode
    if (params.temperature !== undefined) input.temperature = params.temperature
    if (params.activeSpeaker !== undefined) input.active_speaker = params.activeSpeaker
  }

  console.log(`[Replicate:lipSync] Request:`, JSON.stringify({ version: cfg.version.slice(0, 12), input }, null, 2))

  const { output, cost } = await runReplicatePrediction({
    version: cfg.version,
    input,
    label: "[replicate:lipSync]",
    reconcileOpts,
    costModelKey: provider,
  })

  const videoUrl = extractUrl(
    typeof output === "string" ? output : Array.isArray(output) && output.length > 0 ? output[0] : output,
  )

  console.log(`[Replicate:lipSync] Output: "${videoUrl}"`)
  console.log(`[Replicate:lipSync] Cost: $${cost?.toFixed(6) ?? "N/A"}`)

  return { videoUrl, cost }
}
