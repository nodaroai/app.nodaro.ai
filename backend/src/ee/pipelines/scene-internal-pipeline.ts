import type { SupabaseClient } from "@supabase/supabase-js"
import {
  isSeedance2Provider,
  VIDEO_CRITIC_MAX_RETRIES,
  VIDEO_CRITIC_METADATA_KEYS,
  VIDEO_CRITIC_MIN_ADHERENCE_SCORE,
  type SceneNodeData,
  type ShotSpec,
  type VideoCriticFrameMode,
  type VideoCriticShotFields,
  type VideoCriticVerdict,
} from "@nodaro/shared"
import {
  allocateReferenceSlots,
  extractFramesForCritic,
  extractLastFrame,
  prepareSceneRefContext,
  type SceneRefContext,
} from "./continuity.js"
import { pipelineAnimateShot } from "./services/pipeline-animate-shot.js"
import { pipelineGenerateSpeech } from "./services/pipeline-generate-speech.js"
import { pipelineLipSync } from "./services/pipeline-lip-sync.js"
import { pipelineCombineVideos } from "./services/pipeline-combine-videos.js"
import { runImageCritic } from "./llms/image-critic.js"
import { runVideoCritic } from "./llms/video-critic.js"
import { pipelineEvents } from "./events.js"
import { settledWithLimit } from "../../lib/settled-with-limit.js"
import { buildCriticFeedbackPrompt, runCriticRetryLoop } from "./_critic-retry.js"

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
  /** Phase 1C.3 — pipeline run mode. Drives the Method 8 (frame_interpolation)
   *  auto-mode fallback inside `pipelineAnimateShot`. Defaults to "manual"
   *  in the per-shot animate call when omitted. */
  pipelineMode?: "manual" | "auto" | "guided"
  /** Phase 1D.2c-b-ii — Stage 7 row id. Threaded into `runVideoCritic` for
   *  LLM-call attribution. When omitted the Video Critic gate is skipped
   *  entirely (used by older callers + tests that don't need critic). */
  stageId?: string
  /** Phase 1D.2c-b-ii — frame-extraction grid for the Video Critic. Defaults
   *  to "first_last" in the critic loop when omitted. Read from
   *  `PipelineInput.video_critic_frame_count` by the Stage 7 dispatcher. */
  videoCriticFrameMode?: VideoCriticFrameMode
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

export interface SceneInternalPipelineShotResult extends VideoCriticShotFields {
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
  // Phase 1D.2c-b-ii — Video Critic verdict fields are inherited from
  // `VideoCriticShotFields`. Present only when the Video Critic actually ran
  // (i.e. ctx.stageId + videoCriticFrameMode were provided AND frame
  // extraction + critic call succeeded).
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
  /**
   * Updated scene metadata reflecting the just-produced per-shot videos,
   * lipsync replacements, and composite_video. The caller (`animate-audio-edit.ts`
   * per-scene loop) is expected to reassign `scenes[i] = { ...scenes[i], metadata: updatedMetadata }`
   * so downstream helpers (`collectAllShotsFromScenes`,
   * `loadScenesWithCutDecisions`) see the fresh values without a DB re-read.
   *
   * Only present on success (`ok === true`). Absent on failure paths so the
   * caller can fall through to the existing error-handling flush.
   *
   * Mirrors the return-fresh-array convention established by
   * `persistCutDecisions` — `runSceneInternalPipeline` does NOT mutate
   * `sceneEntity.metadata` in place.
   */
  updated_metadata?: Record<string, unknown>
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

  // ─── Step 0: scene-level idempotency short-circuit ────────────────────────
  // animate-audio-edit.ts runs this per-scene loop unconditionally on every
  // drive (and the orchestrator re-drives after each ~90-min hard-timeout
  // abort or worker restart). Without this guard, a drive that gets killed
  // mid-fan-out re-animates EVERY already-finished scene from scratch on the
  // next drive — re-paying KIE for video gen and blowing past the resume cap
  // before the pipeline ever completes (observed on prod pipeline 64b76ed9:
  // a 5-scene film aborted at the 90-min mark 3× → resume_limit_exceeded).
  //
  // A finished scene persists `composite_video_url` onto its scene_node_data
  // (see the success return below + the caller's entity UPDATE). If it's
  // already there, the scene's clips + composite are on R2 already — return
  // the cached result verbatim so the loop advances to unfinished scenes.
  // This is the short-circuit the handler's header comment already documents
  // as the contract; it was never actually implemented until now.
  //
  // Regeneration safety: the Regenerate (retry-video-generation) route clears
  // `composite_video_url` (clearSceneComposite in shot-recovery.ts), so a
  // scene the user asked to re-render does NOT carry the URL and correctly
  // re-animates. Skip (accept-bad-shot) intentionally keeps the URL — the
  // user accepted the existing composite, so skipping re-animation is correct.
  const existingComposite = sceneData.composite_video_url
  if (existingComposite) {
    return {
      ok: true,
      composite_video_url: existingComposite,
      composite_video_asset_id: sceneData.composite_video_asset_id,
      updated_metadata: sceneEntity.metadata ?? {},
    }
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

  // Compute the next-state scene metadata without mutating the input. Stage 7
  // (animate-audio-edit per-scene loop) reassigns `scenes[i].metadata` from
  // this — keeps the in-memory view canonical for the downstream
  // `collectAllShotsFromScenes` / `loadScenesWithCutDecisions` calls without
  // a DB re-read, and keeps the immutable-return-array convention that
  // `persistCutDecisions` already follows.
  const nextShots = sceneData.shots.map((s) => {
    const r = shotResults.find((x) => x.shot_id === s.shot_id)
    if (!r) return s
    return {
      ...s,
      video_asset_id: r.video_asset_id ?? s.video_asset_id,
      video_url: r.video_url ?? s.video_url,
      last_frame_asset_id: r.last_frame_asset_id ?? s.last_frame_asset_id,
      last_frame_url: r.last_frame_url ?? s.last_frame_url,
      ...(r.has_dialogue ? { has_dialogue: true } : {}),
      ...(r.actual_audio_duration_sec != null
        ? { actual_audio_duration_sec: r.actual_audio_duration_sec }
        : {}),
      // Phase 1D.2c-b-ii — Video Critic per-shot metadata. Always surface
      // `video_critic_failed` once the critic ran so the per-shot UI can
      // render a pass / fail badge; the score + findings fields are
      // populated on both pass (informational) and fail (diagnostic). On
      // critic-infrastructure failure none of these are present and the
      // shot looks the same as a pre-1D.2c-b-ii run. The /simplify pass-2
      // `pickDefinedVideoCriticFields` helper drives the spread off
      // `VIDEO_CRITIC_METADATA_KEYS` so the writer + the
      // `clearVideoCriticMetadata` clearer share a single key list.
      ...pickDefinedVideoCriticFields(r),
    }
  })
  const nextSceneNodeData = {
    ...sceneData,
    shots: nextShots,
    composite_video_asset_id: composite.assetId ?? undefined,
    composite_video_url: composite.assetUrl,
  }
  const updatedMetadata = {
    ...(sceneEntity.metadata ?? {}),
    scene_node_data: nextSceneNodeData,
  }

  return {
    ok: true,
    composite_video_asset_id: composite.assetId ?? undefined,
    composite_video_url: composite.assetUrl,
    per_shot_results: shotResults,
    updated_metadata: updatedMetadata,
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

  // J2a — fetch pipeline_entities + assets ONCE for the whole scene.
  // Without this, allocateReferenceSlots pays 2 DB queries per shot:
  // for an 8-shot scene that's 16 queries; for a 5×8 pipeline it's 80.
  const sceneRefCtx = await prepareSceneRefContext(ctx.supabase, ctx.pipelineId, sceneData)

  // Phase 1C.3 Method 3 — track each successfully-animated shot's KIE
  // taskId so a subsequent video_continuation shot can resolve
  // `priorClipKieTaskId` by `shot.extends_shot_id`. Populated lazily after
  // each animate (query `jobs.output_data.kieTaskId` for the just-completed
  // jobId).
  const shotKieTaskIdById: Record<string, string> = {}
  // Phase 1C.3 Method 3 (Seedance 2 path) — track each shot's extracted
  // last_frame URL so a subsequent video_continuation shot can resolve
  // `priorLastFrameUrl` by `shot.extends_shot_id`. Populated after each
  // successful extract_frame call below.
  const shotLastFrameUrlById: Record<string, string> = {}
  let priorLastFrameUrl: string | null = null
  let priorLastFrameAssetId: string | null = null

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

    // F1 — allocate ordered reference slots per §5.13.3. The continuity
    // anchor (prior shot's last_frame) wins slot 1 in sequential mode; the
    // remaining slots fan out across cast / location / objects, capped to
    // the provider's `maxReferenceImages` budget. Multi-ref-capable
    // providers (Kling Omni=7, Seedance 2=5) get richer context; 1-ref
    // providers degrade with a logged warning.
    const referenceUrls = await safelyAllocateRefs(
      ctx,
      sceneEntity,
      sceneData,
      shot,
      { priorLastFrameUrl, priorLastFrameAssetId },
      sceneRefCtx,
    )

    // Phase 1C.3 Method 3 — resolve continuation refs from the cached maps
    // when this shot opts into video_continuation. The shot's
    // `extends_shot_id` references a shot earlier in the same scene (Shot
    // List Critic gates cross-scene extends).
    //
    // Branch by model: VEO needs the prior clip's KIE taskId (for the native
    // /extend-video endpoint); Seedance 2 needs the prior clip's R2 URL
    // (for `reference_video_urls`) + the prior last_frame URL (for
    // `first_frame_url`).
    let priorClipKieTaskId: string | undefined
    let resolvedPriorClipUrl: string | undefined
    let resolvedPriorLastFrameUrl: string | undefined
    if (
      sceneData.shot_input_mode === "video_continuation" &&
      shot.extends_shot_id
    ) {
      if (isSeedance2Provider(sceneData.video_model)) {
        resolvedPriorClipUrl = shotVideoUrls[shot.extends_shot_id]
        resolvedPriorLastFrameUrl = shotLastFrameUrlById[shot.extends_shot_id]
        if (!resolvedPriorClipUrl || !resolvedPriorLastFrameUrl) {
          return {
            ok: false,
            reason: `animate_failed:video_continuation:${shot.shot_id}:prior_shot_seedance2_refs_unavailable`,
            shotResults,
            shotVideoUrls,
          }
        }
      } else {
        priorClipKieTaskId = shotKieTaskIdById[shot.extends_shot_id]
        if (!priorClipKieTaskId) {
          return {
            ok: false,
            reason: `animate_failed:video_continuation:${shot.shot_id}:prior_shot_kieTaskId_unavailable`,
            shotResults,
            shotVideoUrls,
          }
        }
      }
    }

    // Phase 1C.3 Method 8 — read pre-generated interpolation keyframe URLs
    // from Stage 6's per-shot stash. Stage 6 multi-keyframe gen writes
    // `interpolation_keyframe_urls` onto `scene_node_data.shots[N]` BEFORE
    // Stage 7 runs.
    const interpolationKeyframeUrls =
      sceneData.shot_input_mode === "frame_interpolation"
        ? (shot as ShotSpec & { interpolation_keyframe_urls?: string[] })
            .interpolation_keyframe_urls
        : undefined

    // Build the animate args once so the Video Critic regenerate closure
    // (below) can mirror the same shape with a feedback-augmented prompt.
    const buildAnimateArgs = (shotOverride: ShotSpec) => ({
      supabase: ctx.supabase,
      pipelineId: ctx.pipelineId,
      pipelineEntityId: sceneEntity.id,
      userId: ctx.userId,
      shot: shotOverride,
      sceneNodeData: sceneData,
      startFrameUrl,
      referenceUrls,
      priorClipKieTaskId,
      priorClipUrl: resolvedPriorClipUrl,
      priorLastFrameUrl: resolvedPriorLastFrameUrl,
      interpolationKeyframeUrls,
      pipelineMode: ctx.pipelineMode,
    })

    let animateResult: Awaited<ReturnType<typeof pipelineAnimateShot>>
    try {
      animateResult = await pipelineAnimateShot(buildAnimateArgs(shot))
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

    // Phase 1D.2c-b-ii — Video Critic per-shot gate. Cap=1 retry; on critic
    // infrastructure failure (LLM 5xx, ffmpeg OOM) the loop logs + returns
    // the original animate result with `video_critic_failed=false`. The
    // critic emits a `shot:status` SSE event on finalised verdicts (pass or
    // cap-exhausted fail) — infrastructure failures emit nothing so the
    // caller's flow proceeds as if the gate didn't exist.
    //
    // priorLastFrameUrl below is the prior shot's last_frame (still the
    // pre-extract value at this point in the loop — extract for THIS shot's
    // next-shot chain happens further down).
    const criticOutcome = await runVideoCriticLoopForShot({
      ctx,
      sceneEntity,
      sceneData,
      shot,
      shotIndex: i + 1,
      initialAnimateResult: animateResult,
      priorLastFrameUrl,
      regenerate: async (feedbackPrompt: string) =>
        pipelineAnimateShot(
          buildAnimateArgs({ ...shot, visual_keyframe_prompt: feedbackPrompt }),
        ),
    })
    animateResult = criticOutcome.finalAnimateResult

    // Phase 1C.3 Method 3 — cache this shot's kieTaskId for later
    // video_continuation shots in the same scene. Only relevant when the
    // scene's input mode is video_continuation (we want chained VEO
    // extensions) — skip the lookup otherwise to keep tests + non-VEO
    // animate paths fast.
    if (
      sceneData.shot_input_mode === "video_continuation" &&
      animateResult.jobId
    ) {
      const taskId = await lookupKieTaskIdForJob(ctx.supabase, animateResult.jobId)
      if (taskId) shotKieTaskIdById[shot.shot_id] = taskId
    }

    // Best-effort last_frame extraction for the next shot's chain. Skip on
    // the final shot (nothing consumes its last_frame inside this scene).
    //
    // /simplify pass-2 — when the Video Critic ran (ctx.stageId present), it
    // already extracted the t=duration-0.1s frame inside
    // `extractFramesForCritic`. Surfaced via `criticOutcome.lastFrameAsset`
    // we reuse it instead of firing a SECOND extract job on the SAME video
    // at the SAME timestamp (cuts one BullMQ extract-frame + poll per shot
    // in the critic-enabled path). The `pipeline_entities.last_frame_asset_id`
    // side-write that `extractLastFrame` does is replayed here when reusing
    // so the entity-level chain stays in sync.
    let lastFrameAssetId: string | null = null
    let lastFrameUrl: string | null = null
    if (i < sceneData.shots.length - 1) {
      if (criticOutcome.lastFrameAsset) {
        // Reuse path — the critic's extracted last-frame is already on R2.
        // Mirror `extractLastFrame`'s side-write to pipeline_entities so the
        // entity-level chain (next-scene linkage) sees the same value. The
        // side-write is best-effort: a transient DB error here breaks
        // ONLY the next-scene-linkage convenience field — the per-shot
        // last_frame_asset_id is the authoritative chain anchor and is
        // already populated below.
        const reused = criticOutcome.lastFrameAsset
        priorLastFrameUrl = reused.url
        priorLastFrameAssetId = reused.id
        lastFrameAssetId = reused.id
        lastFrameUrl = reused.url
        shotLastFrameUrlById[shot.shot_id] = reused.url
        if (reused.id) {
          try {
            await ctx.supabase
              .from("pipeline_entities")
              .update({ last_frame_asset_id: reused.id })
              .eq("id", sceneEntity.id)
          } catch (err) {
            console.warn(
              `[scene-internal-pipeline] pipeline_entities.last_frame_asset_id side-write failed for scene=${sceneEntity.id}:`,
              err instanceof Error ? err.message : err,
            )
          }
        }
      } else {
        // Fallback path — critic disabled (no ctx.stageId) OR threw before
        // the first extract completed. `extractLastFrame` does the same
        // extract + persists `last_frame_asset_id` itself.
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
          priorLastFrameAssetId = extracted.assetId
          lastFrameAssetId = extracted.assetId
          lastFrameUrl = extracted.url
          // Phase 1C.3 Method 3 (Seedance 2 path) — cache by shot_id so a
          // later video_continuation shot can resolve `priorLastFrameUrl`
          // from its `extends_shot_id`.
          shotLastFrameUrlById[shot.shot_id] = extracted.url
        } catch (err) {
          // Extract failure breaks the chain but doesn't block the rest of
          // the scene — fall back to the next shot's own keyframe.
          console.warn(
            `[scene-internal-pipeline] extract_frame failed for scene=${sceneEntity.id} shot=${shot.shot_id}:`,
            err instanceof Error ? err.message : err,
          )
          priorLastFrameUrl = null
          priorLastFrameAssetId = null
        }
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
      ...criticOutcome.critic,
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
  // J2a — fetch pipeline_entities + assets ONCE for the whole scene.
  const sceneRefCtx = await prepareSceneRefContext(ctx.supabase, ctx.pipelineId, sceneData)

  const tasks = sceneData.shots.map((shot, i) => async () => {
    const typedShot = shot as ShotSpec
    const startFrameUrl = typedShot.keyframe_url ?? null
    // F1 — parallel mode has no continuity chain across shots, so the
    // continuity anchor slot is empty. Cast / location / object slots
    // still fan out per §5.13.3.
    const referenceUrls = await safelyAllocateRefs(
      ctx,
      sceneEntity,
      sceneData,
      typedShot,
      { priorLastFrameUrl: null, priorLastFrameAssetId: null },
      sceneRefCtx,
    )
    // Phase 1C.3 — Method 8 keyframe URLs from Stage 6's per-shot stash.
    // Method 3 (video_continuation) is never picked in parallel mode (the
    // Shot List Critic gates it) so we don't plumb priorClipKieTaskId here.
    const interpolationKeyframeUrls =
      sceneData.shot_input_mode === "frame_interpolation"
        ? (typedShot as ShotSpec & { interpolation_keyframe_urls?: string[] })
            .interpolation_keyframe_urls
        : undefined
    const buildAnimateArgs = (shotOverride: ShotSpec) => ({
      supabase: ctx.supabase,
      pipelineId: ctx.pipelineId,
      pipelineEntityId: sceneEntity.id,
      userId: ctx.userId,
      shot: shotOverride,
      sceneNodeData: sceneData,
      startFrameUrl,
      referenceUrls,
      interpolationKeyframeUrls,
      pipelineMode: ctx.pipelineMode,
    })
    const animateResult = await pipelineAnimateShot(buildAnimateArgs(typedShot))

    // Phase 1D.2c-b-ii — per-shot Video Critic gate. Parallel mode has no
    // continuity chain (priorLastFrameUrl=null for every shot) — the critic
    // only validates prompt adherence + visual quality. Continuity_score
    // returned by the LLM is ignored when priorLastFrameUrl=null (treated as
    // first-shot semantics).
    const criticOutcome = await runVideoCriticLoopForShot({
      ctx,
      sceneEntity,
      sceneData,
      shot: typedShot,
      shotIndex: i + 1,
      initialAnimateResult: animateResult,
      priorLastFrameUrl: null,
      regenerate: async (feedbackPrompt: string) =>
        pipelineAnimateShot(
          buildAnimateArgs({ ...typedShot, visual_keyframe_prompt: feedbackPrompt }),
        ),
    })
    return { shot: typedShot, animateResult: criticOutcome.finalAnimateResult, critic: criticOutcome.critic }
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
    const { shot, animateResult, critic } = r.value
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
      ...critic,
    })
    shotVideoUrls[shot.shot_id] = animateResult.assetUrl
  }

  return { ok: true, shotResults, shotVideoUrls }
}

// ────────────────────────────────────────────────────────────────────────────
// Reference-slot allocation helper
// ────────────────────────────────────────────────────────────────────────────

/**
 * Wraps `allocateReferenceSlots` with a per-shot try/catch so a transient
 * DB error during allocation doesn't fail the entire animate step. On
 * failure we proceed without refs — `pipelineAnimateShot` already handles
 * the no-ref case (a `startFrameUrl` alone suffices for first_frame mode;
 * text mode needs neither). Returns `undefined` (not an empty array) so
 * `pipelineAnimateShot`'s `referenceUrls = []` fallback doesn't trip on
 * a deliberately-empty array vs. an absent param.
 */
async function safelyAllocateRefs(
  ctx: SceneInternalPipelineContext,
  sceneEntity: { id: string },
  sceneData: SceneNodeData,
  shot: ShotSpec,
  args: { priorLastFrameUrl: string | null; priorLastFrameAssetId: string | null },
  sceneContext?: SceneRefContext,
): Promise<ReadonlyArray<string> | undefined> {
  try {
    const slots = await allocateReferenceSlots({
      supabase: ctx.supabase,
      pipelineId: ctx.pipelineId,
      scene: { id: sceneEntity.id },
      shot,
      sceneNodeData: sceneData,
      priorLastFrame:
        args.priorLastFrameUrl && args.priorLastFrameAssetId
          ? { url: args.priorLastFrameUrl, assetId: args.priorLastFrameAssetId }
          : null,
      sceneContext,
    })
    if (slots.length === 0) return undefined
    return slots.map((s) => s.url)
  } catch (err) {
    console.warn(
      `[scene-internal-pipeline] allocateReferenceSlots failed for scene=${sceneEntity.id} shot=${shot.shot_id}; falling through with no refs:`,
      err instanceof Error ? err.message : err,
    )
    return undefined
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Phase 1D.2c-b-ii — Video Critic retry loop (Stage 7 per-shot gate)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Returns true when the verdict should be treated as a blocking fail and
 * trigger a regen-with-feedback retry (when budget remains).
 *
 * Three independent triggers per spec §5:
 *   1. `verdict === "fail"` — the LLM explicitly flagged it
 *   2. `prompt_adherence_score < MIN` — overly lenient verdict='pass' on a
 *      clearly off-prompt clip
 *   3. `continuity_score < MIN` (when non-null) — visible discontinuity even
 *      if the prompt was nominally hit. Null continuity_score means "first
 *      shot, no prior to compare against" and is NOT a fail.
 */
function isBlockingVideoCriticFail(verdict: VideoCriticVerdict): boolean {
  if (verdict.verdict === "fail") return true
  if (verdict.prompt_adherence_score < VIDEO_CRITIC_MIN_ADHERENCE_SCORE) return true
  if (
    verdict.continuity_score !== null &&
    verdict.continuity_score < VIDEO_CRITIC_MIN_ADHERENCE_SCORE
  ) {
    return true
  }
  return false
}

/**
 * /simplify pass-2 — collapses the verdict→VideoCriticShotFields fan-out
 * (was duplicated in 2 sites in `runVideoCriticLoopForShot`). The catch path
 * omits `failed` so the field stays absent in the persisted shot — the gate
 * didn't decide the shot's fate (infrastructure failure), so neither pass
 * nor fail is appropriate.
 *
 * `failed` is `false` for the pass-on-first-try & retry-passed paths,
 * `true` for cap-exhausted-fail. `verdict_outcome` mirrors the LLM's verdict
 * field so consumers can distinguish "explicit pass" from "implicit pass on
 * cap exhaustion" — pass-2's new `video_critic_verdict` field on the
 * `VideoCriticShotFields` interface.
 */
function verdictToCriticFields(
  verdict: VideoCriticVerdict,
  retryCount: number,
  lastAttemptedUrl: string,
  failed?: boolean,
): VideoCriticShotFields {
  const base: VideoCriticShotFields = {
    video_critic_findings: verdict.issues,
    video_critic_score: verdict.prompt_adherence_score,
    video_critic_continuity_score: verdict.continuity_score,
    video_critic_identified_action: verdict.identified_action,
    video_critic_retry_count: retryCount,
    video_critic_last_attempted_url: lastAttemptedUrl,
  }
  if (failed !== undefined) base.video_critic_failed = failed
  return base
}

/**
 * /simplify pass-2 — replaces the 21-line `...(r.video_critic_X !== undefined
 * ? { video_critic_X: r.video_critic_X } : {})` chain at the post-shot
 * metadata fan-in with a key-driven loop. `VIDEO_CRITIC_METADATA_KEYS` is the
 * single source of truth for which fields qualify — same set the
 * `clearVideoCriticMetadata` clearer reads, so writer + clearer can't drift.
 */
function pickDefinedVideoCriticFields(
  source: VideoCriticShotFields,
): Partial<VideoCriticShotFields> {
  const out: Partial<VideoCriticShotFields> = {}
  for (const key of VIDEO_CRITIC_METADATA_KEYS) {
    const value = source[key]
    if (value !== undefined) {
      // The key-set is the metadata-keys union and TypeScript can't narrow
      // value's type across that loop, so an inner cast is required.
      ;(out as Record<string, unknown>)[key] = value
    }
  }
  return out
}

interface VideoCriticLoopArgs {
  ctx: SceneInternalPipelineContext
  sceneEntity: { id: string }
  sceneData: SceneNodeData
  shot: ShotSpec
  shotIndex: number
  initialAnimateResult: Awaited<ReturnType<typeof pipelineAnimateShot>>
  priorLastFrameUrl: string | null
  /**
   * Closure that re-runs `pipelineAnimateShot` for the current shot with a
   * feedback-augmented prompt. The loop captures all the shot-specific args
   * (startFrameUrl, referenceUrls, etc.) once at call site so the loop body
   * stays generic across sequential / parallel modes + Method 3/8/10 branches.
   */
  regenerate: (feedbackPrompt: string) => Promise<Awaited<ReturnType<typeof pipelineAnimateShot>>>
}

interface VideoCriticLoopResult {
  /** Final animate result — either the initial one (on pass) or the last
   *  successful regeneration (on retry-pass / cap-exhausted-fail). */
  finalAnimateResult: Awaited<ReturnType<typeof pipelineAnimateShot>>
  /** Critic verdict fields to merge into `SceneInternalPipelineShotResult`.
   *  All fields are optional — none are set when the critic is disabled (no
   *  ctx.stageId). On critic-infrastructure failure `video_critic_failed`
   *  stays absent (the gate didn't decide the shot's fate), but partial
   *  findings from a pre-throw LLM verdict are preserved when present. */
  critic: VideoCriticShotFields
  /**
   * /simplify pass-2 — last-frame asset extracted by the critic's
   * `extractFramesForCritic` call (always the `duration - 0.1s` sample).
   * Sequential animate reuses this as the continuity anchor for the next
   * shot — without this surface, the caller had to fire a SECOND extract
   * for the same timestamp on the same video right after the critic.
   *
   * Null when the critic was disabled (`!ctx.stageId`) OR threw before the
   * extraction completed (frame extract OOM, etc.) — the caller falls
   * through to the legacy `extractLastFrame` path in that case.
   *
   * After regen, this reflects the LAST critic-pass's video (so the chain
   * matches the `finalAnimateResult` clip, not the original failed attempt).
   */
  lastFrameAsset: { id: string | null; url: string } | null
}

/**
 * Phase 1D.2c-b-ii Stage 7 per-shot Video Critic gate. Runs AFTER
 * `pipelineAnimateShot` succeeds for one shot. Cap=1 retry — videos are
 * expensive enough that a 2-retry budget per shot is over-spend.
 *
 * Non-fatal failure modes (catch → log → return original animate result
 * with `video_critic_failed=false`):
 *   - Frame extraction throws (e.g. ffmpeg OOM)
 *   - `runVideoCritic` throws (e.g. LLM 5xx)
 *
 * Blocking failure modes (regen-with-feedback, then if cap exhausted persist
 * `video_critic_failed=true`):
 *   - `verdict='fail'`
 *   - `prompt_adherence_score < VIDEO_CRITIC_MIN_ADHERENCE_SCORE`
 *   - `continuity_score < VIDEO_CRITIC_MIN_ADHERENCE_SCORE` (when non-null)
 *
 * Emits a `shot:status` SSE event after critic finalises (pass → 'approved',
 * cap-exhausted fail → 'failed'). Infrastructure failures emit NO event —
 * the caller's flow proceeds as if the critic gate didn't exist.
 */
async function runVideoCriticLoopForShot(
  args: VideoCriticLoopArgs,
): Promise<VideoCriticLoopResult> {
  const { ctx, sceneEntity, sceneData, shot, shotIndex } = args
  // Guard: when the caller didn't supply a `stageId`, the Video Critic is
  // disabled entirely (no extract, no LLM call, no SSE event, no metadata
  // fields written). This preserves compatibility with pre-1D.2c-b-ii callers
  // + scene-internal-pipeline tests whose fixtures don't mock the new
  // continuity / video-critic exports.
  if (!ctx.stageId) {
    return {
      finalAnimateResult: args.initialAnimateResult,
      critic: {},
      lastFrameAsset: null,
    }
  }
  // Local narrowing — the guard above proves ctx.stageId is non-nullable from
  // here on. Re-binding lets us avoid the `?? ""` defensive falls-through
  // below (which were unreachable + masked the contract).
  const stageId = ctx.stageId
  const frameMode: VideoCriticFrameMode = ctx.videoCriticFrameMode ?? "first_last"
  // continuityFromPrev maps the scene-level enum into the runVideoCritic
  // type. We treat 'dissolve' as null (no hard continuity expectation), and
  // first-shot (priorLastFrameUrl=null) → null regardless.
  const continuityFromPrev: "match_last_frame" | "hard_cut" | null =
    args.priorLastFrameUrl === null
      ? null
      : sceneData.continuity_from_prev === "match_last_frame"
        ? "match_last_frame"
        : sceneData.continuity_from_prev === "hard_cut"
          ? "hard_cut"
          : null

  let currentResult = args.initialAnimateResult
  let retryCount = 0
  let lastVerdict: VideoCriticVerdict | null = null
  // /simplify pass-2 — track the last-frame asset extracted by the critic
  // across retries. After regen, this snaps to the regen's last-frame so the
  // caller's continuity-chain reuse matches `finalAnimateResult`. Null until
  // the FIRST extract completes (caller falls through to extractLastFrame).
  let lastFrameAsset: { id: string | null; url: string } | null = null

  try {
    // Initial frame extraction + critic call.
    const firstFrameUrl = shot.keyframe_url
    if (!firstFrameUrl) {
      // Without a known input keyframe we can't run the critic — silently
      // skip. The scene still completes; the shot just has no critic
      // verdict. (text-mode shots are the only realistic path here in 1C.1
      // but Stage 5 always synthesises a keyframe upstream.)
      return { finalAnimateResult: currentResult, critic: {}, lastFrameAsset: null }
    }
    const initialFrames = await extractFramesForCritic({
      supabase: ctx.supabase,
      pipelineId: ctx.pipelineId,
      pipelineEntityId: sceneEntity.id,
      userId: ctx.userId,
      videoUrl: currentResult.assetUrl,
      durationSeconds: shot.duration_seconds,
      mode: frameMode,
      firstFrameUrl,
    })
    const initialFrameUrls = initialFrames.frameUrls
    // The last entry in frameUrls is ALWAYS the t=duration-0.1s sample —
    // see `extractFramesForCritic`. Snapshot the (id,url) pair so the
    // sequential animate caller can reuse it as the next-shot anchor.
    lastFrameAsset = {
      id: initialFrames.lastFrameAssetId,
      url: initialFrameUrls[initialFrameUrls.length - 1]!,
    }
    const initialCritic = await runVideoCritic({
      supabase: ctx.supabase,
      pipelineId: ctx.pipelineId,
      stageId,
      userId: ctx.userId,
      shotPrompt: shot.visual_keyframe_prompt,
      shotIndex,
      sceneIndex: sceneData.scene_index,
      priorLastFrameUrl: args.priorLastFrameUrl,
      continuityFromPrev,
      frameUrls: initialFrameUrls,
    })
    lastVerdict = initialCritic.verdict

    // The closure mutates `currentResult` / `lastFrameAsset` / `lastVerdict`
    // / `retryCount` on each retry so the surrounding catch block can read
    // the latest state on a mid-loop throw (e.g. frame-extract OOM after one
    // successful retry). Mirrors the pre-refactor manual while-loop exactly.
    const loopResult = await runCriticRetryLoop<VideoCriticVerdict>({
      initial: initialCritic.verdict,
      maxRetries: VIDEO_CRITIC_MAX_RETRIES,
      isBlockingFail: isBlockingVideoCriticFail,
      runAttempt: async (prevVerdict, attemptNumber) => {
        retryCount = attemptNumber
        const feedbackPrompt = buildCriticFeedbackPrompt({
          basePrompt: shot.visual_keyframe_prompt,
          identifiedAs: prevVerdict.identified_action,
          blockingIssues: prevVerdict.issues.filter(
            (i) => i.severity === "blocking",
          ),
          fallbackAdvice: "Improve overall adherence to the shot prompt.",
        })
        const regen = await args.regenerate(feedbackPrompt)
        currentResult = regen
        const regenFrames = await extractFramesForCritic({
          supabase: ctx.supabase,
          pipelineId: ctx.pipelineId,
          pipelineEntityId: sceneEntity.id,
          userId: ctx.userId,
          videoUrl: regen.assetUrl,
          durationSeconds: shot.duration_seconds,
          mode: frameMode,
          firstFrameUrl,
        })
        const regenFrameUrls = regenFrames.frameUrls
        // Snap last-frame to the REGEN's extracted sample so the caller's
        // continuity anchor matches the finalAnimateResult clip.
        lastFrameAsset = {
          id: regenFrames.lastFrameAssetId,
          url: regenFrameUrls[regenFrameUrls.length - 1]!,
        }
        const next = await runVideoCritic({
          supabase: ctx.supabase,
          pipelineId: ctx.pipelineId,
          stageId,
          userId: ctx.userId,
          shotPrompt: shot.visual_keyframe_prompt,
          shotIndex,
          sceneIndex: sceneData.scene_index,
          priorLastFrameUrl: args.priorLastFrameUrl,
          continuityFromPrev,
          frameUrls: regenFrameUrls,
        })
        lastVerdict = next.verdict
        return next.verdict
      },
    })

    const verdict = loopResult.finalVerdict
    const failed = loopResult.failed
    // Emit SSE so the per-shot UI updates without re-reading the scene entity.
    pipelineEvents.publish({
      type: "shot:status",
      pipelineId: ctx.pipelineId,
      sceneId: sceneEntity.id,
      shotId: shot.shot_id,
      status: failed ? "failed" : "approved",
    })

    return {
      finalAnimateResult: currentResult,
      critic: verdictToCriticFields(verdict, retryCount, currentResult.assetUrl, failed),
      lastFrameAsset,
    }
  } catch (err) {
    // Critic infrastructure failure (frame extraction, LLM 5xx, etc.) — log
    // and proceed with the original animate result. We do NOT mark the shot
    // failed because the FAILURE was on the gate, not the clip.
    console.warn(
      `[video-critic] non-fatal failure for shot=${shot.shot_id} (pipeline=${ctx.pipelineId}):`,
      err instanceof Error ? err.message : String(err),
    )
    // Surface partial findings when the LAST critic call returned a verdict
    // before a downstream throw — preserves diagnostic visibility on a
    // mid-loop extract failure. `video_critic_failed` stays absent: the gate
    // didn't decide the shot's fate (infrastructure failure), so neither
    // pass nor fail is appropriate.
    const partial: VideoCriticShotFields = lastVerdict
      ? verdictToCriticFields(lastVerdict, retryCount, currentResult.assetUrl)
      : {}
    // On infrastructure failure we surface whatever `lastFrameAsset` we
    // managed to extract before the throw. If the FIRST extract is what
    // threw, lastFrameAsset is still null and the caller falls through to
    // `extractLastFrame` exactly as if the critic were disabled.
    return { finalAnimateResult: currentResult, critic: partial, lastFrameAsset }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// KIE taskId lookup helper (Phase 1C.3 Method 3)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Reads `jobs.output_data.kieTaskId` for a just-completed animate jobId.
 *
 * Used by sequential animate to populate `shotKieTaskIdById` so a subsequent
 * `shot_input_mode='video_continuation'` shot can resolve its
 * `priorClipKieTaskId` from `extends_shot_id`. Returns null when the row
 * doesn't carry a kieTaskId (e.g. non-KIE provider, or the worker hasn't
 * landed `output_data` yet — rare but possible).
 */
async function lookupKieTaskIdForJob(
  supabase: SupabaseClient,
  jobId: string,
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("jobs")
      .select("output_data")
      .eq("id", jobId)
      .maybeSingle()
    if (error || !data) return null
    const output = (data as { output_data?: Record<string, unknown> | null })
      .output_data
    const taskId = (output as { kieTaskId?: unknown } | null | undefined)?.kieTaskId
    return typeof taskId === "string" && taskId.length > 0 ? taskId : null
  } catch {
    // Defensive: if the mocked supabase chain in tests doesn't implement
    // .maybeSingle() (most existing fixtures don't), swallow and treat as
    // "no kieTaskId available". Method 3 dispatcher handles the null
    // case by returning a clean structured failure.
    return null
  }
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
