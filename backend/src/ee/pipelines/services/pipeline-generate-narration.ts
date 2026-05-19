import type { SupabaseClient } from "@supabase/supabase-js"
import { getVideoDuration } from "../../../providers/video/ffmpeg-utils.js"
import { runPipelineWorkerJob } from "./_run-worker-job.js"

/**
 * Phase 1C.2.1 §G2 — pipeline-generate-narration.
 *
 * Synthesizes a SINGLE narration audio track that spans the full pipeline.
 * Unlike `pipelineGenerateSpeech` (which is called per-shot for dialogue
 * lines), this wrapper runs ONCE per pipeline and produces the omniscient
 * narrator voice-over that gets mixed over the music in the final merge.
 *
 * Routed through the same `text-to-speech` worker so we get the existing
 * ElevenLabs integration + R2 upload + jobs-row lifecycle for free. Defaults
 * to `elevenlabs-v3` because the v3 model accepts `[audio tags]` for
 * delivery-style cues (calm / epic / etc.) and is the canonical "expressive
 * narrator" model — see Backend CLAUDE.md "TTS v3 vs v2".
 *
 * The wrapper probes the rendered audio with ffprobe to capture its real
 * duration. The narration_audio_duration_sec is needed by the final-merge
 * step (G5) to decide whether the narration outlasts the video (it usually
 * shouldn't, but we surface it for callers to validate).
 *
 * Same shape as `pipelineGenerateSpeech` — jobs row INSERT tagged with
 * pipeline_id, CreditsService.reserveCredits, videoQueue.add, poll, link
 * asset row. The shared `runPipelineWorkerJob` helper handles the boilerplate.
 */

export interface PipelineGenerateNarrationArgs {
  supabase: SupabaseClient
  pipelineId: string
  userId: string
  /** Full narration text. Showrunner emits this on `plan.narration_script.text`. */
  text: string
  /** Optional ElevenLabs voice id. When omitted, the worker uses the account-
   *  level default voice (ElevenLabs returns a sensible narrator voice). */
  voiceId?: string
  /** Optional model id override. Defaults to `elevenlabs-v3` (direct API)
   *  which supports the [audio tag] delivery cues. Callers can pass
   *  `elevenlabs-turbo` for a cheaper run via KIE. */
  modelId?: string
}

export interface PipelineGenerateNarrationResult {
  jobId: string
  assetId: string | null
  /** R2 URL of the generated narration audio (mp3). */
  assetUrl: string
  /** Measured duration of the rendered audio in seconds via ffprobe — same
   *  fallback as `pipelineGenerateSpeech`. Null when the probe fails. The
   *  final-merge step uses this to validate the narration fits inside the
   *  video duration. */
  audioDurationSec: number | null
  creditsSpent: number
}

export async function pipelineGenerateNarration(
  args: PipelineGenerateNarrationArgs,
): Promise<PipelineGenerateNarrationResult> {
  const { supabase, pipelineId, userId, text, voiceId, modelId } = args

  // Default to ElevenLabs v3 (direct API) — supports expressive delivery via
  // [audio tags] and the worker routes it through the ElevenLabs SDK rather
  // than KIE. Callers can override with `elevenlabs-turbo` to save credits.
  const provider = modelId ?? "elevenlabs-v3"
  const modelIdentifier = provider === "elevenlabs" ? "elevenlabs-turbo" : provider

  const base = await runPipelineWorkerJob({
    supabase,
    pipelineId,
    // Narration is pipeline-level, NOT scene-level. No entity attribution.
    pipelineEntityId: undefined,
    userId,
    inputData: {
      text,
      voice: voiceId,
      provider,
      voiceType: "premade",
      type: "text-to-speech",
      // Tag the job so admin/billing/cleanup can distinguish narration runs
      // from per-shot dialogue runs. Keys live inside input_data so the
      // existing TTS worker doesn't need to know about it.
      _pipeline_role: "narration",
    },
    queueName: "videoQueue",
    jobName: "text-to-speech",
    buildPayload: (jobId, usageLogId) => ({
      jobId,
      text,
      voice: voiceId,
      provider: modelIdentifier,
      voiceType: "premade",
      usageLogId,
    }),
    modelIdentifier,
    assetType: "audio",
    pickOutputUrl: (output) =>
      (output.audioUrl as string | undefined) ?? (output.url as string | undefined),
    missingOutputError:
      "narration text-to-speech job completed without audioUrl in output_data",
  })

  // Probe the rendered audio with ffprobe. The TTS worker writes only
  // `audioUrl` to output_data; the duration is captured here so the
  // final-merge step can validate the narration fits inside the video.
  // Failure is non-fatal (matches pipelineGenerateSpeech).
  const audioDurationSec = await probeAudioDuration(base.assetUrl)

  return { ...base, audioDurationSec }
}

async function probeAudioDuration(audioUrl: string): Promise<number | null> {
  try {
    const duration = await getVideoDuration(audioUrl)
    if (!Number.isFinite(duration) || duration <= 0) return null
    return duration
  } catch (err) {
    console.warn(
      `[pipeline-generate-narration] ffprobe failed for ${audioUrl}:`,
      err instanceof Error ? err.message : err,
    )
    return null
  }
}
