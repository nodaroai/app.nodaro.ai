import type { SupabaseClient } from "@supabase/supabase-js"
import { runPipelineWorkerJob } from "./_run-worker-job.js"

export interface PipelineGenerateMusicArgs {
  supabase: SupabaseClient
  pipelineId: string
  /** Pipeline-level music asset — not attributed to any single entity. Leave
   *  unset so the resulting asset row lives on the pipeline directly. */
  pipelineEntityId?: string
  userId: string
  /** Suno prompt describing the music style/mood. Built by the music-timeline
   *  orchestrator from the Showrunner plan's `music_plan` field. */
  prompt: string
  /** Target track length in seconds. The orchestrator passes
   *  `target_duration_seconds + 5` so the silencedetect-based beat-grid
   *  extractor has trailing headroom before the post-trim. */
  durationSec: number
  /** Music provider — defaults to `minimax` (the only MUSIC_PROVIDERS entry
   *  exposed today). Suno V5 wiring is tracked in MUSIC_PROVIDERS notes. */
  provider?: "minimax" | "suno"
  /** Provider model variant — passed through to the worker payload as
   *  `modelVersion` (matches the existing generate-music route shape). */
  modelVersion?: string
  /** Optional vocals (default: instrumental score, no vocals — built by
   *  the music-timeline orchestrator). */
  lyrics?: string
  /** Optional reference audio URL. Falls through to the existing
   *  generate-music worker handler unchanged. */
  referenceAudioUrl?: string
}

export interface PipelineGenerateMusicResult {
  jobId: string
  assetId: string | null
  /** R2 URL of the generated music track. */
  assetUrl: string
  creditsSpent: number
}

/**
 * Phase 1C.2 sub-step 7f — generates a pipeline-level music track via the
 * existing generate-music worker (KIE Minimax music today; Suno V5 once the
 * provider lands). Pattern matches `pipelineCombineVideos` / `pipelineGenerateSpeech` —
 * the 1C.1 service-wrapper shape: insert jobs row → reserve credits → enqueue
 * `videoQueue.add("generate-music", payload)` → poll job → return URL.
 *
 * The model identifier is `generate-music` (matches the route handler in
 * `backend/src/routes/generate-music.ts`); the worker handler in
 * `backend/src/workers/handlers/audio-ai.ts::handleGenerateMusic` reads the
 * payload's `provider` + `duration` + `lyrics` + `referenceAudioUrl` +
 * `modelVersion` keys.
 *
 * Returns the R2 audio URL ready for the beat-grid extractor (sub-step 7g).
 */
export async function pipelineGenerateMusic(
  args: PipelineGenerateMusicArgs,
): Promise<PipelineGenerateMusicResult> {
  const {
    supabase,
    pipelineId,
    pipelineEntityId,
    userId,
    prompt,
    durationSec,
    provider = "minimax",
    modelVersion,
    lyrics,
    referenceAudioUrl,
  } = args

  return runPipelineWorkerJob({
    supabase,
    pipelineId,
    pipelineEntityId,
    userId,
    inputData: {
      prompt,
      provider,
      duration: durationSec,
      modelVersion,
      lyrics,
      referenceAudioUrl,
      type: "generate-music",
    },
    queueName: "videoQueue",
    jobName: "generate-music",
    buildPayload: (jobId, usageLogId) => ({
      jobId,
      prompt,
      provider,
      duration: durationSec,
      lyrics,
      referenceAudioUrl,
      modelVersion,
      usageLogId,
    }),
    modelIdentifier: "generate-music",
    assetType: "audio",
    pickOutputUrl: (output) =>
      (output.audioUrl as string | undefined) ?? (output.url as string | undefined),
    missingOutputError:
      "generate-music job completed without audioUrl in output_data",
  })
}
