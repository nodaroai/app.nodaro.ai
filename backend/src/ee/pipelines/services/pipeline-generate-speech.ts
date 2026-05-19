import type { SupabaseClient } from "@supabase/supabase-js"
import { runPipelineWorkerJob } from "./_run-worker-job.js"

export interface PipelineGenerateSpeechArgs {
  supabase: SupabaseClient
  pipelineId: string
  /** Entity that owns the resulting audio asset (typically the SceneNode entity
   *  for shot-level dialogue audio). */
  pipelineEntityId?: string
  userId: string
  /** Dialogue text to synthesize. Comes from `ShotSpec.dialogue_line`. */
  text: string
  /** ElevenLabs voice id — sourced from the cast member's matched voice
   *  (Voice Matcher LLM output stored on the character entity). */
  voice?: string
  /** Provider — defaults to ElevenLabs Turbo for cost-efficient dialogue. */
  provider?: string
  voiceType?: "premade" | "custom" | "library"
  stability?: number
  similarityBoost?: number
  style?: number
  speed?: number
  languageCode?: string
}

export interface PipelineGenerateSpeechResult {
  jobId: string
  assetId: string | null
  /** R2 URL of the generated audio (mp3/wav per provider). */
  assetUrl: string
  creditsSpent: number
}

/**
 * Synthesizes dialogue audio via the existing text-to-speech worker. Used by
 * the SceneNode internal pipeline (step 4) to generate one audio asset per
 * shot that has a `dialogue_line` value. The audio later feeds into the lip-
 * sync step (5) when enabled.
 *
 * Same pattern as `pipelineGenerateImage`: jobs row INSERT (tagged pipeline_id),
 * CreditsService.reserveCredits, videoQueue.add("text-to-speech", flat payload),
 * poll, link asset.
 */
export async function pipelineGenerateSpeech(
  args: PipelineGenerateSpeechArgs,
): Promise<PipelineGenerateSpeechResult> {
  const {
    supabase,
    pipelineId,
    pipelineEntityId,
    userId,
    text,
    voice,
    provider = "elevenlabs-turbo",
    voiceType = "premade",
    stability,
    similarityBoost,
    style,
    speed,
    languageCode,
  } = args

  // Map legacy "elevenlabs" to "elevenlabs-turbo" for credit identifier (mirrors
  // the route's resolution logic in routes/text-to-speech.ts).
  const modelIdentifier = provider === "elevenlabs" ? "elevenlabs-turbo" : provider

  return runPipelineWorkerJob({
    supabase,
    pipelineId,
    pipelineEntityId,
    userId,
    inputData: {
      text,
      voice,
      provider,
      voiceType,
      stability,
      similarityBoost,
      style,
      speed,
      languageCode,
      type: "text-to-speech",
    },
    queueName: "videoQueue",
    jobName: "text-to-speech",
    buildPayload: (jobId, usageLogId) => ({
      jobId,
      text,
      voice,
      provider: modelIdentifier,
      voiceType,
      stability,
      similarityBoost,
      style,
      speed,
      languageCode,
      usageLogId,
    }),
    modelIdentifier,
    assetType: "audio",
    pickOutputUrl: (output) =>
      (output.audioUrl as string | undefined) ?? (output.url as string | undefined),
    missingOutputError: "text-to-speech job completed without audioUrl in output_data",
  })
}
