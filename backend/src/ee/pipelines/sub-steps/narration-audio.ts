import type { SupabaseClient } from "@supabase/supabase-js"
import type { ShowrunnerPlan, PipelineConfig } from "@nodaro/shared"
import { pipelineGenerateNarration } from "../services/pipeline-generate-narration.js"

/**
 * Phase 1C.2.1 §G3 — Sub-step 7c Narration audio.
 *
 * Per spec §4 Stage 7c: "Narration audio (ElevenLabs, if hasNarrator)". Runs
 * ONCE per pipeline (not per-scene) and produces an omniscient narrator
 * voice-over that gets mixed over the music in the final merge (G5).
 *
 * Skip conditions (both result in `{ ok: true, skipped: true }`):
 *   1. `config.narration_enabled === false` — user opted out.
 *   2. `plan.narration_script` is undefined — Showrunner didn't plan a
 *      narration track for this format (dialogue-driven scenes).
 *
 * The caller (Stage 7 handler) persists the result to
 * `pipeline_stages.output.narration_audio_url` +
 * `pipeline_stages.output.narration_audio_duration_sec` via stageOutputAcc,
 * then flushes the row at the next checkpoint. We don't write to
 * `scene_node_data` because narration is pipeline-level, not per-scene.
 *
 * On TTS failure: throws — caller wraps in failAndMarkTerminal. Credits are
 * refunded inside pipelineGenerateNarration's try/catch (see runPipelineWorkerJob).
 */

export interface NarrationAudioArgs {
  supabase: SupabaseClient
  pipelineId: string
  stageId: string
  userId: string
  plan: ShowrunnerPlan
  config: PipelineConfig | Partial<PipelineConfig>
}

export type NarrationAudioResult =
  | {
      ok: true
      skipped: true
      reason: "narration_disabled" | "no_script"
    }
  | {
      ok: true
      skipped: false
      narrationUrl: string
      narrationDurationSec: number | null
      narrationAssetId: string | null
    }

export async function runNarrationAudio(
  args: NarrationAudioArgs,
): Promise<NarrationAudioResult> {
  const { supabase, pipelineId, userId, plan, config } = args

  // Skip 1: user opted out via pipeline config.
  if (config.narration_enabled === false) {
    return { ok: true, skipped: true, reason: "narration_disabled" }
  }

  // Skip 2: Showrunner didn't plan narration (most scripted-dialogue formats).
  const script = plan.narration_script
  if (!script || !script.text || script.text.trim().length === 0) {
    return { ok: true, skipped: true, reason: "no_script" }
  }

  const result = await pipelineGenerateNarration({
    supabase,
    pipelineId,
    userId,
    text: script.text,
    voiceId: script.voice_id,
    // Stick with the default (elevenlabs-v3) - it accepts [audio tags] for
    // delivery cues. The Showrunner's `delivery_style` could be turned into
    // an [audio tag] prefix in a follow-up; for v1 we let the script's plain
    // text carry the delivery.
  })

  return {
    ok: true,
    skipped: false,
    narrationUrl: result.assetUrl,
    narrationDurationSec: result.audioDurationSec,
    narrationAssetId: result.assetId,
  }
}
