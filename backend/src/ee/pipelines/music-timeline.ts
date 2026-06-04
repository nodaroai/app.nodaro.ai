import type { SupabaseClient } from "@supabase/supabase-js"
import { pipelineEvents } from "./events.js"
import { pipelineGenerateMusic } from "./services/pipeline-generate-music.js"
import { pipelineExtractBeatGrid } from "./services/pipeline-extract-beat-grid.js"

/**
 * Phase 1C.2 sub-steps 7f + 7g — Music timeline.
 *
 * Orchestrates the music gen + beat-grid extract pair:
 *   1. Read `pipeline.config.music_enabled` — when false, return early with
 *      empty result (downstream sub-steps treat empty `musicAssetUrl` as
 *      "no music overlay").
 *   2. Build the Suno prompt from the Showrunner plan's `music_plan` field.
 *      Falls back to a generic instrumental score prompt if the plan is
 *      missing or has only a partial `music_plan`.
 *   3. Call `pipelineGenerateMusic` with `target_duration + 5s` so the
 *      silencedetect-based extractor has trailing headroom before the trim.
 *   4. Call `pipelineExtractBeatGrid` against the generated track — trims to
 *      target duration with a 0.8s fade-out and returns the beat grid + BPM.
 *   5. Emit `pipeline:music_ready` SSE so the canvas UI can render a music
 *      preview while the rest of Stage 7 continues.
 *   6. Compute `realignmentNeeded = |detected - planned| > 2 BPM` — when
 *      true the caller (sub-step 7g') shifts shot durations to land on
 *      beats; when false the planned grid wins.
 *
 * On Suno failure: the error bubbles to the caller (Stage 7), which fails
 * the stage with a structured reason. On beat-grid failure: the result
 * carries an empty `beatGrid` array; the orchestrator proceeds without snap
 * targets and downstream realignment skips (no drift signal).
 */

export interface MusicTimelinePlan {
  music_plan?: {
    bpm_target?: number
    style?: string
    prompt?: string
  }
}

export interface MusicTimelineConfig {
  music_enabled?: boolean
}

export interface RunMusicTimelineArgs {
  supabase: SupabaseClient
  pipelineId: string
  stageId: string
  userId: string
  totalDurationSec: number
  config: MusicTimelineConfig
  plan: MusicTimelinePlan
}

export interface MusicTimelineResult {
  /** False when `pipeline.config.music_enabled === false`. */
  enabled: boolean
  /** R2 URL of the trimmed music track. Empty string when disabled OR the
   *  Suno step failed. */
  musicAssetUrl: string
  /** Beat onset markers (seconds, relative to the trimmed track start). */
  beatGrid: number[]
  /** BPM estimated from inter-onset intervals (median). 0 when fewer than 2
   *  onsets were detected. */
  detectedBPM: number
  /** Planned BPM from the Showrunner plan's `music_plan.bpm_target`. 0 when
   *  the plan didn't carry one. */
  plannedBPM: number
  /** True when `plannedBPM > 0` AND `|detected - planned| > 2`. Drives the
   *  shot-realignment sub-step (7g'). */
  realignmentNeeded: boolean
}

const POST_TRIM_HEADROOM_SEC = 5 // Generate +5s so the extractor has tail
const BPM_DRIFT_TOLERANCE = 2

export async function runMusicTimeline(
  args: RunMusicTimelineArgs,
): Promise<MusicTimelineResult> {
  const {
    supabase,
    pipelineId,
    userId,
    totalDurationSec,
    config,
    plan,
  } = args

  const enabled = config.music_enabled ?? true
  if (!enabled) {
    return {
      enabled: false,
      musicAssetUrl: "",
      beatGrid: [],
      detectedBPM: 0,
      plannedBPM: 0,
      realignmentNeeded: false,
    }
  }

  const plannedBPM = plan.music_plan?.bpm_target ?? 0
  const prompt = buildMusicPrompt(plan.music_plan)
  const generateDurationSec = Math.max(
    totalDurationSec + POST_TRIM_HEADROOM_SEC,
    totalDurationSec,
  )

  // 3. Suno gen — wrapper handles credit reservation, job creation, polling.
  //    Pipeline background score uses Suno (instrumental, no vocals).
  const gen = await pipelineGenerateMusic({
    supabase,
    pipelineId,
    userId,
    prompt,
    durationSec: generateDurationSec,
    provider: "suno",
  })

  // 4. Trim + beat-grid extract. Failure here is degraded-gracefully —
  //    `pipelineExtractBeatGrid` always resolves (errors are swallowed
  //    internally into an empty grid + BPM=0).
  let beatGrid: number[] = []
  let detectedBPM = 0
  let musicAssetUrl = gen.assetUrl
  try {
    const beat = await pipelineExtractBeatGrid({
      musicUrl: gen.assetUrl,
      targetDurationSec: totalDurationSec,
      userId,
    })
    musicAssetUrl = beat.trimmedAssetUrl
    beatGrid = beat.beatGridSeconds
    detectedBPM = beat.detectedBPM
  } catch (err) {
    // Should never throw — `pipelineExtractBeatGrid` resolves on internal
    // failure with an empty grid — but guard anyway. Falls back to the
    // un-trimmed Suno track as the music asset.
    console.warn(
      "[music-timeline] beat-grid extract failed:",
      err instanceof Error ? err.message : err,
    )
  }

  // 5. Notify UI.
  pipelineEvents.publish({
    type: "pipeline:music_ready",
    pipelineId,
    musicAssetUrl,
    beatGridLength: beatGrid.length,
  })

  // 6. Drift detection — skipped when we have no planned BPM to compare
  //    against (the Showrunner didn't commit to one).
  const realignmentNeeded =
    plannedBPM > 0 && Math.abs(detectedBPM - plannedBPM) > BPM_DRIFT_TOLERANCE

  return {
    enabled: true,
    musicAssetUrl,
    beatGrid,
    detectedBPM,
    plannedBPM,
    realignmentNeeded,
  }
}

/**
 * Builds the Suno prompt from the Showrunner plan's `music_plan` field.
 * Falls back to a generic cinematic instrumental prompt when none is set.
 * Exported for unit testing.
 */
export function buildMusicPrompt(
  musicPlan: MusicTimelinePlan["music_plan"] | undefined,
): string {
  if (musicPlan?.prompt) return musicPlan.prompt
  const parts: string[] = []
  if (musicPlan?.style) parts.push(musicPlan.style)
  if (musicPlan?.bpm_target) parts.push(`${musicPlan.bpm_target} bpm`)
  parts.push("instrumental, no vocals")
  parts.push("cinematic score")
  return parts.join(", ")
}
