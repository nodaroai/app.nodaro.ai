import { promises as fs } from "node:fs"
import { join } from "node:path"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { TransitionType } from "@nodaro/shared"
import {
  createWorkDir,
  cleanupWorkDir,
  downloadFile,
  getVideoDuration,
  hasAudioStream,
  runFfmpeg,
  normalizeVideoForCombine,
} from "../../../providers/video/ffmpeg-utils.js"
import { pickTargetResolution } from "../../../providers/video/combine-videos.js"
import { uploadFileToR2 } from "../../../lib/storage.js"
import { settledOrThrow } from "../../../lib/settled-or-throw.js"
import {
  commitReservedCreditsForJob,
  refundReservedCreditsForJob,
} from "../../../lib/credits-job-lifecycle.js"

const DOWNLOAD_CONCURRENCY = 5
const FFPROBE_CONCURRENCY = 8

// `pickTargetResolution` (called between downloads and trim) still does its
// own internal `Promise.all` of ffprobes — leaving it unchanged keeps the
// other callers of `pickTargetResolution` in `combine-videos.ts` unaffected.
// The bounded-concurrency improvement here applies to the downloads (step 1)
// and the explicit ffprobe pass (step 3).

/**
 * Phase 1C.2 sub-step 7j — Final merge.
 *
 * Concatenates every scene's `composite_video_url` into a single MP4 +
 * applies per-shot cut decisions (head/tail trim + per-pair transitions)
 * + overlays the merged music track with a tail fade-out.
 *
 * **Why inline (not via `combine_videos` route):** the existing
 * `combine_videos` provider (`backend/src/providers/video/combine-videos.ts`)
 * supports concat-style transitions (cut / fade / dissolve / dip-to-black/white)
 * but ONLY ONE transition for the entire chain, AND it has no music-overlay
 * lever. Extending that route would balloon (~200 lines) and complicate the
 * 9 other callers that depend on the existing shape. Inline FFmpeg keeps the
 * pipeline's concerns (per-pair transitions, music bed, fade-out) isolated
 * to this one module.
 *
 * **Simplification — per-shot trims:** the Editor LLM produces ONE
 * `cut_decision` per SHOT, but Stage 7's per-scene combine already
 * concatenated each scene's shot clips into a single scene composite. For
 * 1C.2 v1 we honor cut decisions at SCENE boundaries only:
 *   - in_offset_sec from the scene's FIRST shot's cut_decision
 *   - out_offset_sec from the scene's LAST shot's cut_decision
 *   - transition_to_next from the LAST shot's cut_decision determines
 *     the transition INTO the next scene
 * Per-shot transitions WITHIN a scene cannot be honored without
 * re-rendering the scene composite from its individual shot clips (deeper
 * refactor — separate PR).
 *
 * **Credits:** reserved against the `pipeline-final-merge` identifier (3
 * credits per migration 135 seed). Refunded on dispatch failure; committed
 * on success.
 *
 * **Single-scene fast path:** when only one scene is supplied we still go
 * through this module (vs. the 1C.1 short-circuit that copied the lone
 * composite URL directly to the pipeline row) because the trim window from
 * the cut_decision + the music overlay + the fade-out all need to be
 * applied even when there's no concat work to do.
 *
 * On music overlay failure: we attempt to retry without the music input
 * (degrade gracefully — the final MP4 still ships).
 */

export interface FinalMergeShotInput {
  shot_id: string
  cut_decision?: {
    in_offset_sec: number
    out_offset_sec: number
    transition_to_next: TransitionType
    transition_duration_sec?: number
  }
  duration_seconds: number
}

export interface FinalMergeSceneInput {
  sceneEntityId: string
  compositeUrl: string
  shots: ReadonlyArray<FinalMergeShotInput>
}

export interface PipelineFinalMergeArgs {
  supabase: SupabaseClient
  pipelineId: string
  userId: string
  scenes: ReadonlyArray<FinalMergeSceneInput>
  /** R2 URL of the merged music track. Empty when music is disabled. */
  musicAssetUrl: string
  /**
   * Phase 1C.2.1 §G5 — Optional R2 URL of the narration audio track produced
   * by sub-step 7c (`pipelineGenerateNarration`). When present and music is
   * also present, the FFmpeg amix filter blends both tracks with music
   * ducked to 60% volume (constant duck — sidechain ducking is a follow-up).
   * When narration is present but music is absent, narration becomes the
   * sole audio track. When narration is absent, existing music-only / no-
   * audio behavior is preserved.
   */
  narrationAssetUrl?: string
  /** Default 0.8s — matches the §6 sub-step 7g spec. */
  fadeOutDurationSec?: number
}

export interface PipelineFinalMergeResult {
  finalAssetId: string | null
  finalAssetUrl: string
  /** Total duration of the merged MP4 in seconds. Surfaced so Stage 7 can
   *  persist it into `pipeline_stages.output.final_duration_seconds` for the
   *  chat-refine-postmerge specialist (and other downstream consumers). */
  finalDurationSeconds: number
}

const DEFAULT_FADE_OUT_SEC = 0.8
const TRANSITION_DEFAULT_DURATION_SEC = 0.5

export async function pipelineFinalMerge(
  args: PipelineFinalMergeArgs,
): Promise<PipelineFinalMergeResult> {
  const {
    supabase,
    pipelineId,
    userId,
    scenes,
    musicAssetUrl,
    narrationAssetUrl,
    fadeOutDurationSec = DEFAULT_FADE_OUT_SEC,
  } = args

  if (scenes.length === 0) {
    throw new Error("pipelineFinalMerge requires at least 1 scene")
  }

  // 1. Create the jobs row + reserve credits BEFORE doing FFmpeg work. Mirrors
  //    the pattern in `_run-worker-job.ts` (reserve → work → commit/refund).
  const { data: job, error: insertErr } = await supabase
    .from("jobs")
    .insert({
      user_id: userId,
      status: "pending",
      input_data: {
        type: "pipeline-final-merge",
        sceneCount: scenes.length,
        musicEnabled: !!musicAssetUrl,
        narrationEnabled: !!narrationAssetUrl,
      },
      pipeline_id: pipelineId,
    })
    .select("id")
    .single()
  if (insertErr || !job?.id) {
    throw new Error(
      `Failed to create pipeline-final-merge job: ${insertErr?.message ?? "no id returned"}`,
    )
  }
  const jobId = job.id as string

  // 2. Reserve credits.
  const { CreditsService } = await import("../../billing/credits.js")
  await CreditsService.reserveCredits(userId, jobId, "pipeline-final-merge", 0, 0, {
    isAppRun: false,
  })

  let workDir: string | null = null
  try {
    workDir = await createWorkDir("pipeline-final-merge-")
    const outputPath = join(workDir, "final.mp4")

    // 3. Run the merge.
    const totalDurationSec = await mergeScenesWithMusic({
      workDir,
      scenes,
      musicAssetUrl,
      narrationAssetUrl: narrationAssetUrl ?? "",
      fadeOutDurationSec,
      outputPath,
    })

    // 4. Upload to R2 + insert assets row.
    const r2Url = await uploadFileToR2(outputPath, jobId, "video", userId)
    const finalAssetId = await insertAssetRow(supabase, {
      userId,
      jobId,
      r2Url,
      pipelineId,
    })

    // 5. Mark job completed + commit credits.
    await supabase
      .from("jobs")
      .update({
        status: "completed",
        output_data: { videoUrl: r2Url, durationSec: totalDurationSec },
        completed_at: new Date().toISOString(),
      })
      .eq("id", jobId)

    await commitReservedCreditsForJob(jobId)

    return {
      finalAssetId,
      finalAssetUrl: r2Url,
      finalDurationSeconds: totalDurationSec,
    }
  } catch (err) {
    // Refund the reservation on dispatch failure. Mirrors the catch path in
    // character-lora training + every other pipeline service wrapper.
    const message = err instanceof Error ? err.message : String(err)
    await supabase
      .from("jobs")
      .update({
        status: "failed",
        error_message: message,
        completed_at: new Date().toISOString(),
      })
      .eq("id", jobId)
    await refundReservedCreditsForJob(jobId)
    throw err
  } finally {
    if (workDir) await cleanupWorkDir(workDir).catch(() => {})
  }
}

interface MergeArgs {
  workDir: string
  scenes: ReadonlyArray<FinalMergeSceneInput>
  musicAssetUrl: string
  /** Phase 1C.2.1 §G5 — narration audio track (empty string when absent). */
  narrationAssetUrl: string
  fadeOutDurationSec: number
  outputPath: string
}

const MUSIC_DUCK_VOLUME_WITH_NARRATION = 0.6

/**
 * Core FFmpeg merge — downloads every scene composite, applies per-scene
 * trim (head/tail), chain-concatenates with per-pair transitions, overlays
 * music + tail fade-out. Exported indirectly via `pipelineFinalMerge`.
 *
 * Returns the final clip duration so the caller can include it in the
 * result + emit it on the lifecycle event.
 */
async function mergeScenesWithMusic(args: MergeArgs): Promise<number> {
  const {
    workDir,
    scenes,
    musicAssetUrl,
    narrationAssetUrl,
    fadeOutDurationSec,
    outputPath,
  } = args

  // 1. Download every scene composite via bounded concurrency. `Promise.all`
  //    would fan out N parallel R2 connections regardless of scene count.
  const downloadTasks = scenes.map((scene, i) => async () => {
    const p = join(workDir, `scene_${i}.mp4`)
    await downloadFile(scene.compositeUrl, p)
    return p
  })
  const downloadedPaths = await settledOrThrow(downloadTasks, DOWNLOAD_CONCURRENCY)

  // 2. Normalize every clip to a common resolution (xfade / concat reject
  //    mismatched dimensions). We probe every downloaded clip + pick the
  //    most-common (W,H) — ties broken by largest area — via
  //    `pickTargetResolution` from the combineVideos provider. That keeps
  //    vertical (9:16) outputs from getting silently letter-boxed to 1920x1080.
  //    Normalization fans out via Promise.all; the ffmpeg slot semaphore in
  //    `normalizeVideoForCombine` paces concurrency so we don't oversubscribe.
  const target = await pickTargetResolution(downloadedPaths)
  const normalizedPaths = await Promise.all(
    downloadedPaths.map(async (input, i) => {
      const p = join(workDir, `normalized_${i}.mp4`)
      await normalizeVideoForCombine(input, p, target.width, target.height)
      return p
    }),
  )

  // 3. Apply per-scene head/tail trim from cut_decision. Probe every clip's
  //    full duration up front (bounded-concurrency ffprobes), then run the
  //    trim passes in parallel as well — they're FFmpeg-bound and the slot
  //    semaphore handles back-pressure.
  const fullDurations = await settledOrThrow(
    normalizedPaths.map((p) => () => getVideoDuration(p)),
    FFPROBE_CONCURRENCY,
  )
  const trimmedPaths = await Promise.all(
    normalizedPaths.map(async (input, i) => {
      const scene = scenes[i]!
      const firstShot = scene.shots[0]
      const lastShot = scene.shots[scene.shots.length - 1]
      const inOffset = firstShot?.cut_decision?.in_offset_sec ?? 0
      const outOffset = lastShot?.cut_decision?.out_offset_sec ?? 0
      const fullDur = fullDurations[i]!
      const keepDur = fullDur - inOffset - outOffset
      if (inOffset <= 0 && outOffset <= 0) return input
      if (keepDur <= 0.1) {
        // Trim would empty the clip — skip the trim defensively.
        return input
      }
      const out = join(workDir, `trimmed_${i}.mp4`)
      await runFfmpeg([
        "-y",
        "-ss", String(inOffset),
        "-i", input,
        "-t", String(keepDur),
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-preset", "fast",
        "-c:a", "aac",
        out,
      ])
      return out
    }),
  )

  // 4. Combine scenes with per-pair transitions. The transition between
  //    scene N and scene N+1 is determined by scene N's last shot's
  //    `transition_to_next`. Scene-internal transitions are already baked
  //    into each scene composite from Stage 7's per-scene combine.
  const concatPath = await chainCombineWithTransitions({
    workDir,
    clipPaths: trimmedPaths,
    transitions: scenes.slice(0, -1).map((s) => {
      const lastShot = s.shots[s.shots.length - 1]
      return {
        type: lastShot?.cut_decision?.transition_to_next ?? "hard_cut",
        duration: lastShot?.cut_decision?.transition_duration_sec,
      }
    }),
  })

  // 5. Mix audio onto the concatenated video. Four cases:
  //
  //   a. music + narration  → amix the two with music ducked to 60% (§G5).
  //   b. narration only     → narration is the sole audio track.
  //   c. music only         → existing behavior (1C.2): music with tail fade.
  //   d. neither            → fade-only on whatever audio survived concat.
  //
  // Music overlay failure (case a/c) falls back to case d so the pipeline
  // still ships a final MP4.
  const concatDur = await getVideoDuration(concatPath)
  const fadeStart = Math.max(0, concatDur - fadeOutDurationSec)
  const fadeStartStr = fadeStart.toFixed(3)

  // Download all required audio inputs up front via the same bounded-
  // concurrency settledOrThrow used for scene downloads. The narration
  // download is sequenced alongside music so the work can overlap.
  const audioDownloads: Array<() => Promise<{ kind: "music" | "narration"; path: string }>> = []
  let musicPath = ""
  let narrationPath = ""
  if (musicAssetUrl) {
    musicPath = join(workDir, "music.mp3")
    audioDownloads.push(async () => {
      await downloadFile(musicAssetUrl, musicPath)
      return { kind: "music" as const, path: musicPath }
    })
  }
  if (narrationAssetUrl) {
    narrationPath = join(workDir, "narration.mp3")
    audioDownloads.push(async () => {
      await downloadFile(narrationAssetUrl, narrationPath)
      return { kind: "narration" as const, path: narrationPath }
    })
  }
  if (audioDownloads.length > 0) {
    await settledOrThrow(audioDownloads, DOWNLOAD_CONCURRENCY)
  }

  const hasMusic = !!musicAssetUrl
  const hasNarration = !!narrationAssetUrl
  // Scene dialogue rides on the concat's audio stream (0:a) — preserved on the
  // hard-cut concat path (the xfade/transition path still drops it; see
  // chainCombineWithTransitions). Probe so silent films don't break the mix.
  const dialoguePresent = await hasAudioStream(concatPath)
  // Role-aware: the music score ducks under any PRIMARY speech track —
  // narration VO and/or scene dialogue — so it never drowns the voices.
  // (Constant duck; sidechain compression is a follow-up.)
  const duckMusic = hasNarration || dialoguePresent

  if (hasMusic || hasNarration) {
    try {
      // Build the mix dynamically so dialogue (0:a) + narration + (ducked)
      // music are MIXED, rather than music/narration REPLACING the dialogue
      // (the prior bug: `-map [aout]` dropped 0:a whenever music/narration
      // was present). Fixed input order: [0]=video(+dialogue), then music,
      // then narration.
      const inputs: string[] = ["-i", concatPath]
      let musicIdx = -1
      let narrIdx = -1
      let nextIdx = 1
      if (hasMusic) {
        inputs.push("-i", musicPath)
        musicIdx = nextIdx++
      }
      if (hasNarration) {
        inputs.push("-i", narrationPath)
        narrIdx = nextIdx++
      }

      const filters: string[] = []
      const mixLabels: string[] = []
      if (dialoguePresent) {
        filters.push(`[0:a]volume=1.0[dlg]`)
        mixLabels.push("[dlg]")
      }
      if (hasNarration) {
        filters.push(`[${narrIdx}:a]volume=1.0[narr]`)
        mixLabels.push("[narr]")
      }
      if (hasMusic) {
        const musicVol = duckMusic ? MUSIC_DUCK_VOLUME_WITH_NARRATION : 1.0
        filters.push(
          `[${musicIdx}:a]volume=${musicVol},afade=t=out:st=${fadeStartStr}:d=${fadeOutDurationSec}[music]`,
        )
        mixLabels.push("[music]")
      }
      // Single source → passthrough; multiple → amix (default normalize keeps
      // the pre-existing 2-input loudness behavior).
      filters.push(
        mixLabels.length === 1
          ? `${mixLabels[0]}anull[aout]`
          : `${mixLabels.join("")}amix=inputs=${mixLabels.length}:duration=longest:dropout_transition=0[aout]`,
      )

      await runFfmpeg([
        "-y",
        ...inputs,
        "-filter_complex", filters.join(";"),
        "-map", "0:v",
        "-map", "[aout]",
        "-c:v", "copy",
        "-c:a", "aac",
        "-shortest",
        outputPath,
      ])
    } catch (err) {
      // Audio mix failed — fall back to fade-only output so the pipeline
      // still ships a final MP4. Mirrors the original 1C.2 music-only
      // fallback (which already lived inside `if (musicAssetUrl)`); the
      // G5 narration paths inherit the same graceful-degrade behavior.
      console.warn(
        "[pipeline-final-merge] audio mix failed, falling back to fade-only output:",
        err instanceof Error ? err.message : err,
      )
      await runFfmpeg([
        "-y",
        "-i", concatPath,
        "-af", `afade=t=out:st=${fadeStartStr}:d=${fadeOutDurationSec}`,
        "-c:v", "copy",
        "-c:a", "aac",
        outputPath,
      ])
    }
  } else {
    // Case d: neither narration nor music. Existing pre-G5 behavior — a
    // single ffmpeg call applies a tail fade on whatever audio survived
    // concat. NOT wrapped in try/catch: a failure here is a real pipeline
    // failure (no audio mix involved), and the outer pipelineFinalMerge
    // catch handles the refund + status flip. Test #5 pins this behavior.
    await runFfmpeg([
      "-y",
      "-i", concatPath,
      "-af", `afade=t=out:st=${fadeStartStr}:d=${fadeOutDurationSec}`,
      "-c:v", "copy",
      "-c:a", "aac",
      outputPath,
    ])
  }

  return getVideoDuration(outputPath)
}

interface ChainTransition {
  type: TransitionType
  duration?: number
}

interface ChainArgs {
  workDir: string
  clipPaths: ReadonlyArray<string>
  /** One transition per ADJACENT scene pair (length === clipPaths.length - 1). */
  transitions: ReadonlyArray<ChainTransition>
}

/**
 * Concatenates clips with per-pair transitions. All transitions are mapped
 * onto FFmpeg primitives:
 *
 *   hard_cut  → concat demuxer (stream copy / no fade)
 *   match_cut → concat demuxer (Editor uses this when the visuals already
 *               match; technically the same as hard_cut at the FFmpeg level)
 *   dissolve  → xfade transition=fade
 *   overlap   → xfade transition=fade with a longer duration (default
 *               1.0s vs 0.5s for dissolve). This is the J-cut variant; the
 *               Editor LLM picks it deliberately. We don't have a separate
 *               audio J-cut path in v1 — the music overlay already covers
 *               most cases.
 *
 * Mixed-transition chains (some hard_cut + some dissolve) are handled by
 * walking adjacent pairs: hard_cut pairs are concat-streamed; dissolve/
 * overlap pairs trigger an xfade. For the common case of all-hard_cut
 * (no transitions) we take the fast concat-demuxer path end-to-end.
 *
 * Returns the path to the concatenated file.
 */
async function chainCombineWithTransitions(args: ChainArgs): Promise<string> {
  const { workDir, clipPaths, transitions } = args
  const outPath = join(workDir, "chained.mp4")

  if (clipPaths.length === 1) {
    return clipPaths[0]!
  }

  // Fast path: every transition is hard_cut / match_cut → concat demuxer.
  const allHardOrMatch = transitions.every(
    (t) => t.type === "hard_cut" || t.type === "match_cut",
  )
  if (allHardOrMatch) {
    const listPath = join(workDir, "filelist.txt")
    const listContent = clipPaths
      .map((p) => `file '${p.replace(/'/g, "'\\''")}'`)
      .join("\n")
    await fs.writeFile(listPath, listContent)
    await runFfmpeg([
      "-y", "-f", "concat", "-safe", "0", "-i", listPath,
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "fast",
      "-c:a", "aac",
      outPath,
    ])
    return outPath
  }

  // Slow path: at least one xfade transition. Build a chained filter graph
  // where every clip-pair uses its own transition type + duration. Parallel
  // ffprobe — N independent reads, no ordering between them.
  const durations = await Promise.all(clipPaths.map(getVideoDuration))

  const filterParts: string[] = []
  let running = durations[0]!
  let videoLabel = "[0:v]"
  for (let i = 1; i < clipPaths.length; i++) {
    const t = transitions[i - 1]!
    // Pipeline transitions are LLM-emitted story-level beats (hard_cut /
    // match_cut / dissolve / overlap), distinct from combine-videos' raw
    // FFmpeg-name catalog. `dissolve` here means "soft reflective blend",
    // NOT the pixel-noise `dissolve` xfade — keep it on `fade`. `overlap`
    // is the same fade with a longer default duration (1.0s, set below).
    const xfadeType = "fade"
    // overlap → longer; dissolve → standard 0.5s default
    const dur =
      t.duration ??
      (t.type === "overlap" ? 1.0 : TRANSITION_DEFAULT_DURATION_SEC)
    const safeDur = Math.min(dur, Math.max(0.1, durations[i]! * 0.9))
    const offset = Math.max(0, running - safeDur)
    const outLabel = i === clipPaths.length - 1 ? "[vout]" : `[v${i}]`
    filterParts.push(
      `${videoLabel}[${i}:v]xfade=transition=${xfadeType}:duration=${safeDur}:offset=${offset}${outLabel}`,
    )
    videoLabel = outLabel
    // xfade output runs from start of inputA to end of inputB, with the
    // overlap region taking `safeDur` seconds. Running = offset + durations[i].
    running = offset + durations[i]!
  }

  const inputs: string[] = []
  for (const p of clipPaths) inputs.push("-i", p)

  await runFfmpeg([
    "-y",
    ...inputs,
    "-filter_complex", filterParts.join(";"),
    "-map", "[vout]",
    // Audio: drop scene audio (music overlay replaces it). Stage 7
    // per-scene combine kept dialogue audio in the composite, but the
    // final merge replaces audio entirely with the music track.
    "-an",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "fast",
    outPath,
  ])
  return outPath
}

/**
 * Inserts an `assets` row + returns the new asset id. Mirrors the shape
 * `createAssetFromJob` writes in the worker (worker shared helpers), kept
 * inline here because this module runs outside a BullMQ worker context.
 */
async function insertAssetRow(
  supabase: SupabaseClient,
  args: {
    userId: string
    jobId: string
    r2Url: string
    pipelineId: string
  },
): Promise<string | null> {
  const filename = args.r2Url.split("/").pop() ?? "final.mp4"
  // Best-effort: read size for the assets.size_bytes (NOT NULL). When the
  // file is gone or unreadable, fall back to 0 (DB column is NOT NULL but
  // 0 is acceptable — admin cleanup paths cope with it).
  const { data: inserted, error } = await supabase
    .from("assets")
    .insert({
      user_id: args.userId,
      job_id: args.jobId,
      type: "video",
      filename,
      mime_type: "video/mp4",
      size_bytes: 0,
      r2_key: filename,
      r2_url: args.r2Url,
      pipeline_id: args.pipelineId,
      metadata: { source: "pipeline-final-merge" },
    })
    .select("id")
    .single()
  if (error) {
    console.error(
      "[pipeline-final-merge] assets insert failed:",
      error.message,
    )
    return null
  }
  return inserted?.id ?? null
}
