import type { SupabaseClient } from "@supabase/supabase-js"
import type { SceneNodeData, ShotSpec } from "@nodaro/shared"
import { extractLastFrame } from "./continuity.js"
import { pipelineAnimateShot } from "./services/pipeline-animate-shot.js"
import { pipelineGenerateSpeech } from "./services/pipeline-generate-speech.js"
import { pipelineLipSync } from "./services/pipeline-lip-sync.js"
import { pipelineCombineVideos } from "./services/pipeline-combine-videos.js"
import { runImageCritic } from "./llms/image-critic.js"
import { settledWithLimit } from "../../lib/settled-with-limit.js"

/**
 * Shared context for the scene-internal pipeline. Mirrors the
 * RunXxxStageArgs shape used by every Stage handler so the runner can be
 * called directly from `stages/animate-audio-edit.ts` without re-shaping
 * arguments.
 */
export interface SceneInternalPipelineContext {
  supabase: SupabaseClient
  pipelineId: string
  userId: string
}

export interface SceneInternalPipelineOptions {
  /**
   * Sequential mode: shots run in order; each shot's last_frame chains into
   * the next shot's startFrameUrl. Image Critic gates shots N>0 with a
   * `continuity_with_previous` field.
   *
   * Parallel mode: shots run concurrently via `settledWithLimit`; no
   * continuity chain, no last_frame extraction, no Image Critic gate.
   */
  mode: "sequential" | "parallel"
  /** When true and a shot has `dialogue_line`, lipsync the speech onto the
   *  animated clip. The lipsynced video replaces the original in the
   *  per-scene combine step. */
  lipSyncEnabled: boolean
  /** Whether to run the Image Critic continuity_break gate. Defaults true
   *  in sequential mode, false in parallel mode (Stage 7 wires this from
   *  the discriminator). */
  runImageCritic: boolean
}

export interface SceneInternalPipelineShotResult {
  shot_id: string
  /** Asset id of the shot's video — either the raw animate output OR the
   *  lipsynced replacement when lipsync ran. */
  video_asset_id: string
  /** R2 URL of the shot's video. Stage 7 persists this back to
   *  `ShotSpec.video_url` so the SceneNode renderer + downstream helpers
   *  (e.g. `fix_continuity`) can read it without a join. */
  video_url?: string | null
  /** Last-frame asset id from the post-animate extract step. Null in
   *  parallel mode (no chain) or when extract failed. */
  last_frame_asset_id?: string | null
  /** R2 URL of the extracted last frame. Stage 7 persists this back to
   *  `ShotSpec.last_frame_url` so the activated `fix_continuity` helper can
   *  read `prior.last_frame_url` from the persisted scene data — without
   *  it the helper would always 500 on a clean Stage 7 run. */
  last_frame_url?: string | null
  /** Phase 1C.2 — true when this shot has a `dialogue_line` AND the speech
   *  generator produced an audio track. Stage 7 persists this to
   *  `ShotSpec.has_dialogue` so the Editor LLM (sub-step 7d') can gate
   *  cut-in / cut-out into the dialogue_no_cut_zone. */
  has_dialogue?: boolean
  /** Phase 1C.2 — measured length of the per-shot speech audio in seconds,
   *  as probed from the rendered R2 URL by `pipelineGenerateSpeech`. Null
   *  when the shot has no dialogue OR ffprobe failed. Stage 7 persists this
   *  to `ShotSpec.actual_audio_duration_sec` for the Editor LLM's
   *  no-cut-zone computation. */
  actual_audio_duration_sec?: number | null
}

export type SceneInternalPipelineFailure =
  | "scene_node_data_missing"
  | "shots_missing"
  | "continuity_break"
  | "animate_failed"
  | "combine_failed"

export interface SceneInternalPipelineResult {
  ok: boolean
  reason?: SceneInternalPipelineFailure | string
  composite_video_asset_id?: string
  composite_video_url?: string
  per_shot_results?: SceneInternalPipelineShotResult[]
}

const SHOT_PARALLEL_CONCURRENCY = 4

/**
 * The SceneNode 5-step internal pipeline (per §6.9.3 of the architecture
 * spec). Called once per scene by Stage 7.
 *
 *   Step 1 — Keyframes already exist (Stage 6 generated them). We just read
 *            shot.keyframe_url here.
 *   Step 2 — i2i bridge frames (Method 5). DEFERRED to Phase 1C.3. For
 *            1C.1 no shot carries `bridged_frame_url`; the start-frame
 *            selection (Step 3) just walks `priorLastFrameUrl ?? keyframe_url`.
 *   Step 3 — Animate. Sequential mode chains last_frame → start frame and
 *            optionally gates each shot N>0 with the Image Critic. Parallel
 *            mode fans shots out via settledWithLimit(4).
 *   Step 4 — Dialogue audio. For each shot with `dialogue_line`, synthesize
 *            speech. Failures are non-blocking (shot keeps its silent video).
 *   Step 5 — Lip-sync. Only when `lipSyncEnabled` AND the shot has dialogue
 *            audio. The lipsynced clip replaces the raw animate output in
 *            the per-scene combine step.
 *   Step 6 — Combine. One `pipelineCombineVideos` call merges every shot's
 *            video into the scene's composite_video.
 *
 * Failure surfaces as a structured `reason` value that Stage 7 maps to a
 * pipeline_stages row failure message.
 */
export async function runSceneInternalPipeline(
  ctx: SceneInternalPipelineContext,
  sceneEntity: { id: string; metadata: Record<string, unknown> | null },
  options: SceneInternalPipelineOptions,
): Promise<SceneInternalPipelineResult> {
  const sceneData = (sceneEntity.metadata as Record<string, unknown> | null)
    ?.scene_node_data as SceneNodeData | undefined
  if (!sceneData) {
    return { ok: false, reason: "scene_node_data_missing" }
  }
  if (!sceneData.shots || sceneData.shots.length === 0) {
    return { ok: false, reason: "shots_missing" }
  }

  // ─── Step 3: animate ──────────────────────────────────────────────────────
  const shotResultsResult =
    options.mode === "sequential"
      ? await animateSequential(ctx, sceneEntity, sceneData, options)
      : await animateParallel(ctx, sceneEntity, sceneData)
  if (!shotResultsResult.ok) {
    return {
      ok: false,
      reason: shotResultsResult.reason,
      per_shot_results: shotResultsResult.shotResults,
    }
  }
  const shotResults = shotResultsResult.shotResults
  const shotVideoAssets: Record<string, string> = Object.fromEntries(
    shotResults.map((r) => [r.shot_id, r.video_asset_id]),
  )
  const shotVideoUrls: Record<string, string> = shotResultsResult.shotVideoUrls

  // ─── Step 4 + 5: dialogue audio + lip-sync ────────────────────────────────
  // Both are non-blocking on failure — a shot without audio keeps its silent
  // animate clip. Lip-sync only fires when audio synth succeeded AND
  // lipSyncEnabled is true.
  //
  // Voice selection (partial fix — full per-shot speaker resolution needs a
  // ShotSpec.speaker_key field, which lands in a separate PR). For now:
  //   - Single-cast scene: use that character's matched voice_id.
  //   - Multi-cast scene: best-effort default to the first cast member's
  //     voice. Mixed-dialogue scenes still all sound like the first speaker
  //     until ShotSpec.speaker_key is wired through.
  //   - No cast / no voice_match: omit the `voice` param so the worker falls
  //     back to ElevenLabs default (Rachel).
  // TODO: full per-shot speaker resolution requires ShotSpec.speaker_key
  //       field — separate PR.
  const voiceByEntityKey = await loadCastVoiceMap(
    ctx.supabase,
    ctx.pipelineId,
    sceneData.cast_keys ?? [],
  )
  const sceneDefaultVoice =
    (sceneData.cast_keys ?? []).length > 0
      ? voiceByEntityKey[(sceneData.cast_keys ?? [])[0]!]
      : undefined

  // Per-shot speech + lipsync are independent across shots — fan out via
  // `settledWithLimit(3)`. Failure of either step is still non-blocking per
  // shot. The shot-result map keyed by shot_id keeps writes order-independent.
  interface DialogueUpdate {
    shot_id: string
    has_dialogue?: boolean
    actual_audio_duration_sec?: number | null
    lipsync_asset_id?: string | null
    lipsync_asset_url?: string | null
  }
  const dialogueTasks = sceneData.shots
    .filter((shot): shot is ShotSpec & { dialogue_line: string } => !!shot.dialogue_line)
    .map((shot) => async (): Promise<DialogueUpdate | null> => {
      let audioUrl: string | undefined
      let audioDurationSec: number | null = null
      try {
        const speech = await pipelineGenerateSpeech({
          supabase: ctx.supabase,
          pipelineId: ctx.pipelineId,
          pipelineEntityId: sceneEntity.id,
          userId: ctx.userId,
          text: shot.dialogue_line,
          // Pass voice only when we resolved one — omitting falls through to
          // the worker's default.
          ...(sceneDefaultVoice ? { voice: sceneDefaultVoice } : {}),
        })
        audioUrl = speech.assetUrl
        // Phase 1C.2 — real audio duration from the rendered R2 audio (probed
        // by `pipelineGenerateSpeech` with ffprobe). Null when the probe
        // failed; the lip-sync wrapper's `buildLipSyncCreditId` falls back to
        // the worst-case 5-min bucket in that case, which the worker reconciles
        // via `commitJobCredits` once KIE returns actual costTime.
        audioDurationSec = speech.audioDurationSec
      } catch (err) {
        // Step-4 failures are non-blocking — log + continue without audio.
        console.warn(
          `[scene-internal-pipeline] speech gen failed for scene=${sceneEntity.id} shot=${shot.shot_id}:`,
          err instanceof Error ? err.message : err,
        )
        return null
      }

      const update: DialogueUpdate = {
        shot_id: shot.shot_id,
        has_dialogue: true,
        actual_audio_duration_sec: audioDurationSec,
      }

      if (!options.lipSyncEnabled || !audioUrl) return update

      try {
        const animatedVideoUrl = shotVideoUrls[shot.shot_id]
        if (!animatedVideoUrl) return update
        const lipsync = await pipelineLipSync({
          supabase: ctx.supabase,
          pipelineId: ctx.pipelineId,
          pipelineEntityId: sceneEntity.id,
          userId: ctx.userId,
          videoUrl: animatedVideoUrl,
          audioUrl,
          audioDurationSec: audioDurationSec ?? undefined,
        })
        update.lipsync_asset_id = lipsync.assetId ?? null
        update.lipsync_asset_url = lipsync.assetUrl
      } catch (err) {
        // Lip-sync failure is also non-blocking — fall back to silent video.
        console.warn(
          `[scene-internal-pipeline] lipsync failed for scene=${sceneEntity.id} shot=${shot.shot_id}:`,
          err instanceof Error ? err.message : err,
        )
      }
      return update
    })

  const SHOT_DIALOGUE_CONCURRENCY = 3
  const dialogueSettled = await settledWithLimit(
    dialogueTasks,
    SHOT_DIALOGUE_CONCURRENCY,
    undefined,
    false,
  )

  // Apply each per-shot update against the shotResults / shotVideoUrls /
  // shotVideoAssets maps. The shot_id index map makes this O(N) on result count.
  const indexByShotId = new Map<string, number>(
    shotResults.map((r, i) => [r.shot_id, i] as const),
  )
  for (const r of dialogueSettled) {
    if (r.status !== "fulfilled" || !r.value) continue
    const update = r.value
    const idx = indexByShotId.get(update.shot_id)
    if (idx === undefined) continue
    const prev = shotResults[idx]!
    const next: SceneInternalPipelineShotResult = { ...prev }
    if (update.has_dialogue !== undefined) {
      next.has_dialogue = update.has_dialogue
      next.actual_audio_duration_sec = update.actual_audio_duration_sec
    }
    if (update.lipsync_asset_url) {
      shotVideoUrls[update.shot_id] = update.lipsync_asset_url
      next.video_url = update.lipsync_asset_url
      if (update.lipsync_asset_id) {
        shotVideoAssets[update.shot_id] = update.lipsync_asset_id
        next.video_asset_id = update.lipsync_asset_id
      }
    }
    shotResults[idx] = next
  }

  // ─── Step 6: combine ──────────────────────────────────────────────────────
  // Even a single-shot scene gets concatenated through combine_videos — the
  // route's Zod requires ≥2 inputs, so single-shot scenes need a different
  // codepath. We special-case here by returning the lone clip as the
  // composite when shots.length === 1.
  let composite: { assetId: string | null; assetUrl: string }
  if (sceneData.shots.length === 1) {
    const onlyShot = sceneData.shots[0]!
    composite = {
      assetId: shotVideoAssets[onlyShot.shot_id] ?? null,
      assetUrl: shotVideoUrls[onlyShot.shot_id] ?? "",
    }
  } else {
    // Build the ordered URL list in shot order so the combine output
    // matches the scene's narrative sequence.
    const orderedUrls = sceneData.shots.map((s) => shotVideoUrls[s.shot_id]).filter(
      (u): u is string => !!u,
    )
    if (orderedUrls.length !== sceneData.shots.length) {
      return {
        ok: false,
        reason: "combine_failed",
        per_shot_results: shotResults,
      }
    }
    try {
      const result = await pipelineCombineVideos({
        supabase: ctx.supabase,
        pipelineId: ctx.pipelineId,
        pipelineEntityId: sceneEntity.id,
        userId: ctx.userId,
        videoUrls: orderedUrls,
      })
      composite = { assetId: result.assetId, assetUrl: result.assetUrl }
    } catch (err) {
      console.error(
        `[scene-internal-pipeline] combine failed for scene=${sceneEntity.id}:`,
        err instanceof Error ? err.message : err,
      )
      return {
        ok: false,
        reason: "combine_failed",
        per_shot_results: shotResults,
      }
    }
  }

  return {
    ok: true,
    composite_video_asset_id: composite.assetId ?? undefined,
    composite_video_url: composite.assetUrl,
    per_shot_results: shotResults,
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Step 3 — animate
// ────────────────────────────────────────────────────────────────────────────

interface AnimateBranchResult {
  ok: boolean
  reason?: SceneInternalPipelineFailure | string
  shotResults: SceneInternalPipelineShotResult[]
  shotVideoUrls: Record<string, string>
}

/**
 * Sequential animate path. Walks shots in order. For shots N>0 with
 * `continuity_with_previous` and a prior last_frame, runs the Image Critic
 * Stage 7b-pre gate; a blocking continuity_break verdict short-circuits the
 * whole scene. Each shot's last frame is extracted post-animate (best-effort
 * — extraction failure doesn't fail the shot, just empties the chain).
 */
async function animateSequential(
  ctx: SceneInternalPipelineContext,
  sceneEntity: { id: string },
  sceneData: SceneNodeData,
  options: SceneInternalPipelineOptions,
): Promise<AnimateBranchResult> {
  const shotResults: SceneInternalPipelineShotResult[] = []
  const shotVideoUrls: Record<string, string> = {}
  let priorLastFrameUrl: string | null = null

  for (let i = 0; i < sceneData.shots.length; i++) {
    const shot = sceneData.shots[i]! as ShotSpec

    // Stage 7b-pre — continuity_break gate. Only when N>0, the shot opts
    // into a continuity link, and the caller enables the critic.
    if (
      i > 0 &&
      shot.continuity_with_previous &&
      priorLastFrameUrl &&
      options.runImageCritic &&
      shot.keyframe_url
    ) {
      try {
        const verdict = await runImageCritic({
          supabase: ctx.supabase,
          pipelineId: ctx.pipelineId,
          pipelineEntityId: sceneEntity.id,
          userId: ctx.userId,
          shotId: shot.shot_id,
          assetId: shot.keyframe_asset_id,
          keyframeUrl: shot.keyframe_url,
          priorLastFrameUrl,
          sceneDescription: sceneData.description,
          emotionalBeat: sceneData.emotional_beat,
          shotStartState: shot.start_state,
          continuityWithPrevious: shot.continuity_with_previous,
          visualKeyframePrompt: shot.visual_keyframe_prompt,
          invokedVia: "stage_7b_pre",
        })
        const blocking = verdict.issues.find(
          (issue) =>
            issue.type === "continuity_break" && issue.severity === "blocking",
        )
        if (blocking) {
          return {
            ok: false,
            reason: "continuity_break",
            shotResults,
            shotVideoUrls,
          }
        }
      } catch (err) {
        // Image Critic failure shouldn't block the pipeline — log + proceed.
        console.warn(
          `[scene-internal-pipeline] Image Critic threw for scene=${sceneEntity.id} shot=${shot.shot_id}:`,
          err instanceof Error ? err.message : err,
        )
      }
    }

    // Resolve start frame: prior last_frame (Method 1) wins over shot's
    // own keyframe. For shot 0 / parallel mode there's no prior, so the
    // keyframe is used.
    const startFrameUrl = priorLastFrameUrl ?? shot.keyframe_url ?? null

    let animateResult: Awaited<ReturnType<typeof pipelineAnimateShot>>
    try {
      animateResult = await pipelineAnimateShot({
        supabase: ctx.supabase,
        pipelineId: ctx.pipelineId,
        pipelineEntityId: sceneEntity.id,
        userId: ctx.userId,
        shot,
        sceneNodeData: sceneData,
        startFrameUrl,
      })
    } catch (err) {
      console.error(
        `[scene-internal-pipeline] animate failed for scene=${sceneEntity.id} shot=${shot.shot_id}:`,
        err instanceof Error ? err.message : err,
      )
      return {
        ok: false,
        reason: "animate_failed",
        shotResults,
        shotVideoUrls,
      }
    }

    // Best-effort last_frame extraction for the next shot's chain. Skip on
    // the final shot (nothing consumes its last_frame inside this scene).
    let lastFrameAssetId: string | null = null
    let lastFrameUrl: string | null = null
    if (i < sceneData.shots.length - 1) {
      try {
        const extracted = await extractLastFrame({
          supabase: ctx.supabase,
          pipelineId: ctx.pipelineId,
          sceneEntityId: sceneEntity.id,
          userId: ctx.userId,
          videoUrl: animateResult.assetUrl,
          durationSec: shot.duration_seconds,
        })
        priorLastFrameUrl = extracted.url
        lastFrameAssetId = extracted.assetId
        lastFrameUrl = extracted.url
      } catch (err) {
        // Extract failure breaks the chain but doesn't block the rest of
        // the scene — fall back to the next shot's own keyframe.
        console.warn(
          `[scene-internal-pipeline] extract_frame failed for scene=${sceneEntity.id} shot=${shot.shot_id}:`,
          err instanceof Error ? err.message : err,
        )
        priorLastFrameUrl = null
      }
    }

    if (!animateResult.assetId) {
      // Animate succeeded but the asset row didn't land. That's a hard
      // failure for the combine step — we'd have no asset id to reference.
      return {
        ok: false,
        reason: "animate_failed",
        shotResults,
        shotVideoUrls,
      }
    }

    shotResults.push({
      shot_id: shot.shot_id,
      video_asset_id: animateResult.assetId,
      video_url: animateResult.assetUrl,
      last_frame_asset_id: lastFrameAssetId,
      last_frame_url: lastFrameUrl,
    })
    shotVideoUrls[shot.shot_id] = animateResult.assetUrl
  }

  return { ok: true, shotResults, shotVideoUrls }
}

/**
 * Parallel animate path. Fans every shot out via `settledWithLimit(4)`.
 * No continuity chain, no last_frame extraction. Any shot's failure fails
 * the whole scene (per Phase 1C.1 spec — partial scene success would
 * complicate combine + downstream credit accounting).
 */
async function animateParallel(
  ctx: SceneInternalPipelineContext,
  sceneEntity: { id: string },
  sceneData: SceneNodeData,
): Promise<AnimateBranchResult> {
  const tasks = sceneData.shots.map((shot) => async () => {
    const startFrameUrl = (shot as ShotSpec).keyframe_url ?? null
    const animateResult = await pipelineAnimateShot({
      supabase: ctx.supabase,
      pipelineId: ctx.pipelineId,
      pipelineEntityId: sceneEntity.id,
      userId: ctx.userId,
      shot: shot as ShotSpec,
      sceneNodeData: sceneData,
      startFrameUrl,
    })
    return { shot: shot as ShotSpec, animateResult }
  })

  const results = await settledWithLimit(tasks, SHOT_PARALLEL_CONCURRENCY, undefined, false)

  const shotResults: SceneInternalPipelineShotResult[] = []
  const shotVideoUrls: Record<string, string> = {}
  for (const r of results) {
    if (r.status === "rejected") {
      console.error(
        `[scene-internal-pipeline] parallel animate rejected for scene=${sceneEntity.id}:`,
        r.reason instanceof Error ? r.reason.message : r.reason,
      )
      return {
        ok: false,
        reason: "animate_failed",
        shotResults,
        shotVideoUrls,
      }
    }
    const { shot, animateResult } = r.value
    if (!animateResult.assetId) {
      return {
        ok: false,
        reason: "animate_failed",
        shotResults,
        shotVideoUrls,
      }
    }
    shotResults.push({
      shot_id: shot.shot_id,
      video_asset_id: animateResult.assetId,
      video_url: animateResult.assetUrl,
      last_frame_asset_id: null, // not needed in parallel mode
      last_frame_url: null,
    })
    shotVideoUrls[shot.shot_id] = animateResult.assetUrl
  }

  return { ok: true, shotResults, shotVideoUrls }
}

// ────────────────────────────────────────────────────────────────────────────
// Voice resolution helper
// ────────────────────────────────────────────────────────────────────────────

/**
 * Load the Voice Matcher LLM output for every character entity referenced by
 * the scene's `cast_keys` and return a `{ entityKey: voiceId }` map.
 *
 * `voice_match` is written onto `pipeline_entities.metadata.voice_match` by
 * Stage 2 (characters) — only for cast members with `has_dialogue=true`. The
 * shape (per `voice-matcher.ts`) is at minimum `{ voice_id: string, ... }`.
 *
 * Missing entries (cast not yet processed, no dialogue, voice match failed)
 * are dropped silently — the caller falls through to the worker default.
 */
async function loadCastVoiceMap(
  supabase: SupabaseClient,
  pipelineId: string,
  castKeys: ReadonlyArray<string>,
): Promise<Record<string, string>> {
  if (castKeys.length === 0) return {}
  const { data, error } = await supabase
    .from("pipeline_entities")
    .select("entity_key, metadata")
    .eq("pipeline_id", pipelineId)
    .eq("entity_type", "character")
    .in("entity_key", [...castKeys])
  if (error) {
    console.warn(
      `[scene-internal-pipeline] loadCastVoiceMap query failed for pipeline=${pipelineId}:`,
      error.message,
    )
    return {}
  }
  const out: Record<string, string> = {}
  for (const row of data ?? []) {
    const voiceMatch = (row.metadata as Record<string, unknown> | null)
      ?.voice_match as { voice_id?: string } | undefined
    if (voiceMatch?.voice_id) {
      out[row.entity_key as string] = voiceMatch.voice_id
    }
  }
  return out
}
