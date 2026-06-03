import type { SupabaseClient } from "@supabase/supabase-js"
import { runPipelineWorkerJob } from "./_run-worker-job.js"

export interface PipelineVoiceChangeArgs {
  supabase: SupabaseClient
  pipelineId: string
  /** Entity to attribute the revoiced video asset to (typically the SceneNode). */
  pipelineEntityId?: string
  userId: string
  /** Source talking clip — the shot's already-animated video whose baked-in
   *  voice should be swapped for the character's consistent ElevenLabs voice. */
  videoUrl: string
  /** ElevenLabs voiceId — from the cast voice map / the character's saved voice. */
  voiceId: string
  /** Keep the music/SFX bed under the new voice (false) or yield a clean
   *  voice-only track (true). Pipeline revoice keeps the bed so the model's
   *  ambience survives — matches the node's `removeBackgroundNoise` knob. */
  removeBackgroundNoise?: boolean
  stability?: number
  similarityBoost?: number
}

export interface PipelineVoiceChangeResult {
  jobId: string
  assetId: string | null
  /** R2 URL of the revoiced video (revoiced audio remuxed in). */
  assetUrl: string
  creditsSpent: number
}

/**
 * Revoices a talking shot clip — swaps the video model's baked-in voice for the
 * character's consistent ElevenLabs voice via the media-aware voice-changer
 * (ElevenLabs speech-to-speech, video mode: extract audio → s2s → remux). The
 * model's lip-sync is preserved (it already synced the original voice), so this
 * yields the same character voice across every shot/film without re-animating.
 * `removeBackgroundNoise: false` keeps the music/SFX bed under the new voice.
 *
 * Same 5-step wrapper shape as pipelineLipSync. Credit identifier matches
 * routes/voice-changer.ts ("elevenlabs-voice-changer", 4cr; ffmpeg remux 0cr).
 */
export async function pipelineVoiceChange(
  args: PipelineVoiceChangeArgs,
): Promise<PipelineVoiceChangeResult> {
  const {
    supabase,
    pipelineId,
    pipelineEntityId,
    userId,
    videoUrl,
    voiceId,
    removeBackgroundNoise = false,
    stability,
    similarityBoost,
  } = args

  if (!videoUrl) throw new Error("pipelineVoiceChange requires a videoUrl")
  if (!voiceId) throw new Error("pipelineVoiceChange requires a voiceId")

  return runPipelineWorkerJob({
    supabase,
    pipelineId,
    pipelineEntityId,
    userId,
    inputData: {
      videoUrl,
      voiceId,
      removeBackgroundNoise,
      stability,
      similarityBoost,
      type: "voice-changer",
    },
    queueName: "videoQueue",
    jobName: "voice-changer",
    buildPayload: (jobId, usageLogId) => ({
      jobId,
      videoUrl,
      voiceId,
      removeBackgroundNoise,
      stability,
      similarityBoost,
      usageLogId,
    }),
    modelIdentifier: "elevenlabs-voice-changer",
    assetType: "video",
    pickOutputUrl: (output) =>
      (output.videoUrl as string | undefined) ?? (output.url as string | undefined),
    missingOutputError:
      "voice-changer job completed without videoUrl in output_data",
  })
}
