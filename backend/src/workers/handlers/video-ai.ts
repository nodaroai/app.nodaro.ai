// @reads-none reads only the media it renders or extracts into work dirs
import { dirname } from "node:path"
import {
  IMAGE_TO_VIDEO_DEFAULT_PROVIDER, LIP_SYNC_DEFAULT_PROVIDER, MOTION_TRANSFER_DEFAULT_PROVIDER, TEXT_TO_VIDEO_DEFAULT_PROVIDER,
  VIDEO_RETAKE_MODEL, VIDEO_TO_VIDEO_DEFAULT_PROVIDER, VIDEO_UPSCALE_DEFAULT_PROVIDER, VOICED_VIDEO_DEFAULT_PROVIDER,
} from "./default-models.js"
import { uploadToR2 } from "../../lib/storage.js"
import {
  imageToVideo,
  textToVideo,
  videoToVideo,
  lipSync,
  lipSyncVideo,
  motionTransfer,
  videoUpscale,
  speechToVideo,
} from "../../providers/index.js"
import { KIE_LIP_SYNC_MODELS } from "../../providers/kie/models.js"
import type { ProgressCallback, ProviderResult } from "../../providers/provider.interface.js"
import { runVeoExtendTask, runVeo1080pTask, runVeo4kTask, KieError } from "../../providers/kie/client.js"

import { runRunwayExtendTask } from "../../providers/kie/runway-client.js"
import { replicateLipSync } from "../../providers/replicate/lip-sync.js"
import { falLipSync } from "../../providers/fal/lip-sync.js"
import { replicateFaceSwap } from "../../providers/replicate/face-swap.js"
import { runGroundedSam } from "../../providers/replicate/grounded-sam.js"
import {
  runLtxTextToVideo,
  runLtxImageToVideo,
  runLtxAudioToVideo,
  runLtxExtend,
  runLtxRetake,
} from "../../providers/replicate/ltx-video.js"
import { config } from "../../lib/config.js"
import { loopTrimAddonCreditsFor } from "../../lib/loop-trim-addon.js"
import {
  canonicalVideoProvider,
  FAL_LIP_SYNC_PROVIDERS,
  REPLICATE_LIP_SYNC_PROVIDERS,
  SEEDANCE_2_EXTEND_STITCH,
  SEEDANCE_LIP_SYNC_PROVIDERS,
  getDialogueCapabilities,
  dialogueProviderOf,
  isVeoProvider,
  getVideoAudioCapability,
  type VideoUpscaleProvider
} from "@nodaro/shared/models"
import { ltxExtendDurationSec, ltxRetakeDurationSec, seedanceExtendResolution } from "@nodaro/shared/credits"
import { ttsSupportsAudioTags, SEEDANCE_DRAFT_FINALIZE_PROVIDER } from "@nodaro/shared/model-catalog"
import type { CharacterVoiceSpec, DialogueLine, ResolvedDialogueVoiceLine } from "@nodaro/shared/pipeline"
import type { VideoCharacterReference, FrameFit, FrameDelivery } from "@nodaro/shared/video"
import { mergeVideoAudio } from "../../providers/video/merge-video-audio.js"
import { extendTailPicture, stitchExtension, type ExtendStitchResult } from "../../providers/video/extend-stitch.js"
import { probeMatched } from "../../providers/video/matched-encode.js"
import { extractTailToFile } from "../../providers/video/extract-tail.js"
import { extractFrame } from "../../providers/video/extract-frame.js"
import { resolveSourceMatchedAspect } from "../../providers/video/source-matched-aspect.js"
import { extendSourceTooShortMessage, isTailRecipeProvider, tailRecipeSeconds, TAIL_RECIPES } from "../../lib/extend-recipe.js"
import { cutChainedMovTail, findChainedMovReference, isMovUrl } from "../../lib/seedance-extend-mov-chain.js"
import { rawExtensionObjectId, silentVideoKey } from "../../lib/job-output-keys.js"
import { discardFailedRunCopies } from "../../lib/discard-job-copies.js"
import { seedance25OutputFormat } from "../../providers/kie/video.js"
import { runSeedanceDraftFinalize } from "../../providers/kie/seedance-draft.js"
import { seedance25CostUsd } from "../../providers/kie/seedance-cost.js"
import { kling4CostUsd } from "../../providers/kie/kling4-cost.js"
import { measureSeedanceDraftRenderSec, draftRenderOutputData, positiveSeconds, seedanceDraftFinalizeQueuedBilledSec } from "../../lib/seedance-draft-finalize.js"
import { generateVideoAudioMergeRecipe, voiceTrackMuxRecipe, draftAudioMuxMergeArgs, draftAudioMuxOutputData, readDraftAudioMux, type DraftAudioMux } from "../../lib/seedance-draft-audio.js"
import { applyDraftAudioMux, draftAudioWarningOutputData } from "../../lib/seedance-draft-audio-apply.js"
import {
  cleanupWorkDir,
  COMBINE_DELIVERY_CRF,
  createWorkDir,
  downloadFile,
  stripAudio,
} from "../../providers/video/ffmpeg-utils.js"
import { unitRateBaseCredits } from "../../lib/credit-base-cost.js"
import { TOPAZ_VIDEO_UNIT_CREDIT_ID } from "@nodaro/render-rules"
import type { DeclaredSeedanceTaskType, TopazVideoResolution } from "@nodaro/shared/models"
import { isKling4RunnerProvider, isNodaroVideoUpscaleTier, NODARO_VIDEO_UPSCALE_PROVIDER } from "@nodaro/shared/models"
import { runHouseModelTask } from "../../lib/house-models.js"
import { houseModelTiming } from "../../lib/house-model-timeouts.js"
import { deliverHouseModelRun } from "../../lib/house-model-delivery.js"
import { applySmartLoopCutToR2Url } from "../../providers/video/apply-smart-loop-cut.js"
import { join } from "node:path"
import { readFile } from "node:fs/promises"
import { uploadBufferToR2, mediaObjectKey } from "../../lib/storage.js"
import { uploadJobScratchFile } from "../../lib/job-scratch.js"
import { runPostProcessing } from "../../lib/post-processing-error.js"
import { rewriteForContentPolicy } from "../../lib/content-policy-rewrite.js"
import { extractAudioTrack } from "../../providers/video/extract-audio-track.js"
import { probeVideoSource } from "../../providers/video/ffmpeg-utils.js"
import { directVoiceChanger } from "../../providers/elevenlabs/voice-changer.js"
import { directElevenLabsTTS, stripAudioTags } from "../../providers/elevenlabs/direct-tts.js"
import { directElevenLabsDialogue } from "../../providers/elevenlabs/direct-dialogue.js"
import { planVoicedDialogue, voicesTheVoicedVideoSends } from "../../lib/voiced-dialogue-lines.js"
import { assertVoicesAllowed } from "../../lib/voice-lock.js"

/**
 * VEO3 / VEO3.1 always produce a video with background audio per KIE's
 * docs (no native sound-off flag). When the user passes `sound: false`,
 * we honour intent by stream-copying the video and dropping the audio
 * track, then re-uploading. Cheap (no re-encode).
 */
async function stripAudioFromR2Url(videoUrl: string, jobId: string): Promise<string> {
  // POST-PROVIDER: `videoUrl` is the delivered VEO result; download/strip/
  // upload failures are post-delivery → PostProcessingError (refund skipped).
  return runPostProcessing(async () => {
    let workDir: string | undefined
    try {
      workDir = await createWorkDir("veo3-strip-audio")
      const inputPath = join(workDir, "in.mp4")
      const outputPath = join(workDir, "out.mp4")
      await downloadFile(videoUrl, inputPath)
      await stripAudio(inputPath, outputPath)
      const buffer = await readFile(outputPath)
      return await uploadBufferToR2(buffer, silentVideoKey(jobId), "video/mp4")
    } finally {
      if (workDir) await cleanupWorkDir(workDir)
    }
  })
}

import {
  buildProviderMeta,
  commitJobCredits,
  markJobCompleted,
  uploadVideoMaybeWatermark,
  watermarkLocalVideoAndUpload,
  generateAndUploadThumbnail,
  setJobProgress,
  startProgressRamp,
  withProgressRamp,
  type HandlerFn,
} from "../shared.js"
import { measureSeedance2Settle, type Seedance2Settle } from "../../lib/seedance2-ref-video-settle.js"
import { finalizeJobWithMedia } from "../../lib/job-finalize.js"
import { handleAiAvatar } from "./heygen-avatar.js"
import { handleCinematicAvatar } from "./heygen-cinematic.js"
import { handleBeebleSwitchX } from "./beeble-switchx.js"
import { makeOnTaskCreated } from "../../lib/reconcile/persistence.js"
import { uploadSwapWithSourceAudio } from "./face-swap-audio.js"
import { DeterministicJobError } from "../../lib/deterministic-job-error.js"
import {
  providerKindForVideoModel,
  providerKindForLipSyncModel,
  providerKindForVideoToVideoModel,
} from "../../lib/reconcile/provider-kind.js"
import type { ProviderKind } from "../../lib/reconcile/types.js"
import { applyFrameFitAndDelivery } from "../../lib/video-frame-dispatch.js"
import { withRunningVideoProvider } from "../../services/workflow-engine/normalize-node-types.js"

/**
 * Lightricks LTX 2.3 dispatch.
 *
 * Submits a Replicate prediction (one model id per variant — the `task` field
 * in the input switches behavior between text/image/audio inputs) and waits
 * synchronously via `replicate.wait()` for terminal state. On success,
 * uploads the resulting video to R2 (with watermark when applicable),
 * generates a thumbnail, and finalises the job row.
 *
 * The payload-builder (`services/workflow-engine/payload-builder.ts`) emits
 * a flat snake_case shape that mirrors the LTX provider's input fields, so
 * we can forward each field directly without re-deriving the task.
 *
 * `jobType` distinguishes the i2v ("image-to-video") vs t2v ("text-to-video")
 * caller so finalize records the right job type — matches the surrounding
 * handler that invoked us.
 *
 * Returns true when the LTX path handled the job (caller must return early);
 * false when the provider is not LTX (caller continues with default routing).
 */
async function dispatchLtxIfRequested(
  job: { data: unknown; updateProgress: (p: number) => Promise<void> },
  ctx: { jobId: string; jobUserId: string | undefined; shouldWatermark: boolean },
  jobType: "image-to-video" | "text-to-video",
): Promise<boolean> {
  const d = job.data as Record<string, unknown>
  const provider = d.provider as string | undefined
  if (provider !== "ltx-2.3-pro" && provider !== "ltx-2.3-fast") return false
  const variant: "ltx-2.3-pro" | "ltx-2.3-fast" = provider

  const task = (d.task as "text_to_video" | "image_to_video" | "audio_to_video" | undefined) ?? "text_to_video"
  const reconcileOpts = {
    onTaskCreated: makeOnTaskCreated(ctx.jobId, providerKindForVideoModel(variant)),
  }
  const common = {
    variant,
    prompt: (d.prompt as string | undefined) ?? "",
    resolution: d.resolution as "1080p" | "2k" | "4k",
    duration: d.duration as number,
    aspectRatio: d.aspect_ratio as "16:9" | "9:16",
    fps: d.fps as 24 | 25 | 48 | 50,
    generateAudio: (d.generate_audio as boolean | undefined) ?? true,
    cameraMotion: (d.camera_motion as
      | "dolly_in" | "dolly_out" | "dolly_left" | "dolly_right"
      | "jib_up" | "jib_down" | "static" | "focus_shift" | "none") ?? "none",
    reconcileOpts,
  }

  // Best-effort progress nudge so the widget shows movement; we ramp toward
  // 90% during the long Replicate wait, then snap to 100% on upload.
  await setJobProgress(job, ctx.jobId, 5)
  const ramp = startProgressRamp(job, ctx.jobId, { start: 5, cap: 85 })

  console.log(
    `[worker] ltx ${ctx.jobId} (variant: ${variant}, task: ${task})`,
  )

  let result
  try {
    if (task === "audio_to_video" && variant === "ltx-2.3-pro") {
      result = await runLtxAudioToVideo({ ...common, variant, audio: d.audio as string })
    } else if (task === "image_to_video") {
      // LTX bypasses the router, so the frame fit has to be applied here or a
      // start frame reaches Replicate at whatever size the user uploaded.
      // Delivery never switches on LTX (no reference-image support), so this is
      // the fit alone.
      const shaped = await applyFrameFitAndDelivery({
        model: variant,
        imageUrl: d.image as string,
        endFrameUrl: d.last_frame_image as string | undefined,
        prompt: common.prompt,
        options: { resolution: common.resolution, aspectRatio: common.aspectRatio, frameFit: d.frameFit as FrameFit | undefined },
      })
      result = await runLtxImageToVideo({
        ...common,
        image: shaped.imageUrl as string,
        lastFrameImage: shaped.endFrameUrl,
      })
    } else {
      result = await runLtxTextToVideo(common)
    }
  } finally {
    ramp.stop()
  }

  const r2Url = await uploadVideoMaybeWatermark(
    result.videoUrl,
    ctx.jobId,
    ctx.jobUserId,
    ctx.shouldWatermark,
  )
  await setJobProgress(job, ctx.jobId, 100)

  const thumbUrl = await generateAndUploadThumbnail(r2Url, ctx.jobId, ctx.jobUserId)

  const { ok } = await finalizeJobWithMedia({
    jobId: ctx.jobId,
    jobType,
    result: {
      url: result.videoUrl,
      cost: result.cost,
      providerUsed: variant,
      // LTX 2.3 is priced by its OUTPUT — the official per-(band × seconds)
      // tiers in STATIC_CREDIT_COSTS / model_pricing — and the reservation
      // already names that tier (`ltx-2.3-<v>:<band>:<s>s`, credit-identifiers
      // ltxPricedTier). It is NOT a GPU-time provider: `result.cost` is
      // predict_time × a per-second GPU rate, a small fraction of the tier, so
      // a metered commit charged 8 of a 264-credit hold (prod 2026-10-28).
      // Commit the reserved tier, as every fixed/composite-priced provider does.
      meteredCost: false,
    },
    mediaUrl: r2Url,
    extraOutputData: { thumbnailUrl: thumbUrl },
  })
  if (ok) {
    console.log(
      `[worker] Job ${ctx.jobId} completed: ${r2Url} (provider: ${variant}, cost: $${result.cost?.toFixed(6) ?? "N/A"})`,
    )
  }
  return true
}

/**
 * A render's result with the cost KIE billed for it, from the seconds its
 * charge was measured from (`measureSeedance2Settle`):
 *  - Seedance 2.5: those seconds — or, for a run with no reference video and a
 *    fixed duration, that duration;
 *  - Kling 4.0 / Kling 4.0 Flash with a reference video: output + the longer
 *    of output and the reference clips, the seconds the charge bills (the
 *    runner cannot see the clips' lengths and reports only the 2 × output
 *    floor).
 * Recorded only: finalize hands `result.cost` to the commit, where neither the
 * reserved tier nor the measured `meteredBaseCredits` reads it. Shared by the
 * i2v and t2v lanes.
 *
 * Unchanged: every other model; a result with no cost of its own (a relayed
 * run, billed to the far end's account); and a length that could not be
 * measured, which keeps the adapter's figure.
 */
function withMeasuredRenderCost<R extends { cost: number | null }>(
  result: R,
  run: {
    provider: string
    resolution: string | undefined
    draft: boolean | undefined
    referenceVideoUrls: readonly unknown[] | undefined
    /** The request's own duration (Auto = -1). */
    duration: unknown
    settle: Seedance2Settle
  },
): R {
  if (typeof result.cost !== "number") return result
  const hasVideoRef = Array.isArray(run.referenceVideoUrls) && run.referenceVideoUrls.length > 0
  if (isKling4RunnerProvider(run.provider)) {
    const seconds = run.settle.seconds
    if (!hasVideoRef || !seconds) return result
    return { ...result, cost: kling4CostUsd({ provider: run.provider, resolution: run.resolution, hasVideoRef, outputSec: seconds.outputSec, inputSec: seconds.inputSec }) }
  }
  if (run.provider !== "seedance-2-5") return result
  const fixedSec = hasVideoRef ? undefined : positiveSeconds(run.duration)
  const outputSec = run.settle.seconds?.outputSec ?? fixedSec
  if (outputSec === undefined) return result
  const inputSec = run.settle.seconds?.inputSec ?? 0
  return { ...result, cost: seedance25CostUsd({ resolution: run.resolution, draft: run.draft === true, hasVideoRef, outputSec, inputSec }) }
}

/** VEO direct-4K generates the base at 1080p, then chains get-4k-video (see
 *  {@link chainVeoBaseTo4k}). KIE's generate endpoint has no "4k" resolution. */
const VEO_4K_BASE_RESOLUTION = "1080p"

/**
 * Chain a completed VEO base generation into KIE's get-4k-video (`runVeo4kTask`)
 * and return the 4K URL. Shared by the i2v + t2v handlers when the user picks 4K:
 * the base runs at {@link VEO_4K_BASE_RESOLUTION}, then upscales here within the
 * same job (reserved at the `<model>:4k` composite price).
 *
 * Crash-window note: on a worker crash BETWEEN the base generation and this call,
 * reconcile finalizes the 1080p base (graceful degradation), not the 4K —
 * acceptable for the rare window; the alternative is full 4K-aware reconcile.
 */
async function chainVeoBaseTo4k(
  result: { url: string; kieTaskId?: string },
  job: { updateProgress: (p: number) => Promise<void> },
  jobId: string,
): Promise<string> {
  if (!result.kieTaskId) {
    throw new Error("VEO 4K requested but the base generation returned no KIE task id")
  }
  console.log(`[worker] VEO 4K — upscaling base task ${result.kieTaskId} for job ${jobId}`)
  await setJobProgress(job, jobId, 50)
  const { resultJson } = await runVeo4kTask(result.kieTaskId, 0, {
    onTaskCreated: makeOnTaskCreated(jobId, "kie-veo"),
  })
  const url = resultJson.resultUrls?.[0]
  if (!url) throw new Error("VEO 4K succeeded but no URL found")
  return url
}

const handleImageToVideo: HandlerFn = async function handleImageToVideo(job, ctx) {
  // A retired model in a queued job (any producer: a pipeline shot, an older
  // job) runs as the model it became — the one its credit id was priced on.
  const { imageUrl, endFrameUrl, audioUrl, prompt, provider, generateAudio, duration, mode, sound, negativePrompt, motionPrompt, cfgScale, aspectRatio, multiShot, shots, elements, resolution, grokMode, videoSize, seed, cameraFixed, referenceImageUrls, referenceVideoUrls, referenceAudioUrls, characterReferences, keepOriginalSound, webSearch, nsfwChecker, generationType, loopTrim, frameFit, frameDelivery, enableTranslation, videoTrimStart, videoTrimEnd, refVideoDurationsSec, draft, outputFormat, referenceTaskType } = withRunningVideoProvider({ data: job.data }).data as {
    jobId: string
    /** Seedance 2.5 container, set by the route only for a child job
     *  (`seedance25OutputFormatFor`); absent = mp4. */
    outputFormat?: "mov"
    /** Seedance Draft: render a 480p draft the 1080p finalize can re-render. */
    draft?: boolean
    /** Seedance 2.5: the reference task type the route resolved before pricing
     *  (`resolveVideoRequestNorm`); absent = none declared. Passed to the
     *  provider as given — the KIE adapter decides whether the body takes it. */
    referenceTaskType?: DeclaredSeedanceTaskType
    imageUrl?: string
    endFrameUrl?: string
    audioUrl?: string
    prompt?: string
    provider?: string
    generateAudio?: boolean
    duration?: number
    mode?: string
    sound?: boolean
    negativePrompt?: string
    motionPrompt?: string
    cfgScale?: number
    aspectRatio?: string
    multiShot?: boolean
    shots?: Array<{ prompt: string; duration: number }>
    elements?: Array<{ name: string; description: string; type: "image" | "video"; urls: string[] }>
    resolution?: string
    grokMode?: string
    videoSize?: string
    seed?: number
    cameraFixed?: boolean
    referenceImageUrls?: string[]
    referenceVideoUrls?: string[]
    referenceAudioUrls?: string[]
    /** Identity inputs (Gemini Omni `character_ids` after the provider mints them). */
    characterReferences?: VideoCharacterReference[]
    /** Kling 4.0: keep the reference videos' own sound. */
    keepOriginalSound?: boolean
    /** Start/end frame handling; absent = platform defaults. */
    frameFit?: FrameFit
    frameDelivery?: FrameDelivery
    /** The reservation's ffprobe of `referenceVideoUrls` (a failed probe is
     *  NaN, or null once through JSON) — the settlement reads it instead of
     *  probing again. */
    refVideoDurationsSec?: Array<number | null>
    webSearch?: boolean
    nsfwChecker?: boolean
    generationType?: string
    loopTrim?: {
      enabled: boolean
      framesToTest?: number
      quality?: "lossless" | "precise"
    }
    enableTranslation?: boolean
    videoTrimStart?: number
    videoTrimEnd?: number
  }

  // LTX 2.3 short-circuits the i2v router — it has its own Replicate
  // prediction shape (single model id, `task` discriminator in input) and
  // finalises synchronously via `replicate.wait()` inside the dispatcher,
  // not through the KIE poll loop.
  if (await dispatchLtxIfRequested(job, ctx, "image-to-video")) return

  console.log(`[worker] image-to-video ${ctx.jobId} (provider: ${provider ?? IMAGE_TO_VIDEO_DEFAULT_PROVIDER})${endFrameUrl ? " [with end frame]" : ""}${audioUrl ? " [with audio]" : ""}`)

  // Map frontend shots/elements to provider format for Kling 3.0
  const multiPrompt = shots?.map((s) => ({ prompt: s.prompt, duration: s.duration }))
  const klingElements = elements?.map((el) => ({
    name: el.name,
    description: el.description,
    ...(el.type === "image" ? { element_input_urls: el.urls } : { element_input_video_urls: el.urls }),
  }))

  // Create progress callback that updates the job record in the database.
  // Routed through setJobProgress so the monotonic guard suppresses the
  // brief backwards jitter when KIE briefly reports a value below where
  // the ramp has already pushed the bar.
  const onProgress: ProgressCallback = async (progress: number) => {
    console.log(`[worker] Job ${ctx.jobId} progress: ${progress}%`)
    await setJobProgress(job, ctx.jobId, progress)
  }

  // Fallback ramp for providers that DON'T expose live progress through
  // KIE's progress field (Seedance, some Wan / Hailuo variants). The
  // ramp climbs linearly to `cap`, then asymptotically toward ~95 — so
  // the bar keeps moving for the full provider duration instead of
  // freezing at `cap` and snapping at the end.
  await setJobProgress(job, ctx.jobId, 5)
  const ramp = startProgressRamp(job, ctx.jobId, { start: 5, cap: 35 })

  const resolvedI2vProvider = provider ?? IMAGE_TO_VIDEO_DEFAULT_PROVIDER
  const onTaskCreated = makeOnTaskCreated(
    ctx.jobId,
    providerKindForVideoModel(resolvedI2vProvider),
  )
  // VEO direct-4K: KIE's generate endpoint has no "4k" — 4K is produced by
  // chaining get-4k-video off the base task (see chainVeoBaseTo4k below).
  const wantsVeo4k = resolution === "4k" && isVeoProvider(provider)
  const baseResolution = wantsVeo4k ? VEO_4K_BASE_RESOLUTION : resolution
  // `outputFormat` only when the route honoured mov (Seedance 2.5, a child
  // job): the mp4 options stay key-for-key what they were. This lane never
  // rewords a refused prompt (that retry is the text-to-video worker's).
  const wantsMov = outputFormat === "mov" && resolvedI2vProvider === "seedance-2-5"
  let result
  try {
    result = await imageToVideo(imageUrl, resolvedI2vProvider, prompt, duration, endFrameUrl, { onProgress, mode, sound, negativePrompt, motionPrompt, cfgScale, aspectRatio, multiShots: multiShot, multiPrompt, klingElements, resolution: baseResolution, grokMode, seed, cameraFixed, generateAudio, referenceImageUrls, referenceVideoUrls, referenceAudioUrls, characterReferences, keepOriginalSound, webSearch, nsfwChecker, generationType, frameFit, frameDelivery, enableTranslation, videoTrimStart, videoTrimEnd, draft, ...(referenceTaskType ? { referenceTaskType } : {}), ...(wantsMov ? { outputFormat: "mov" as const } : {}) }, { onTaskCreated })
  } finally {
    ramp.stop()
  }

  // Don't write a backward milestone here — KIE (or the ramp) may have
  // already reported 80–90%+, and writing 40% would visibly regress the bar.
  // The upload milestone below (90%) advances past whatever was reported.

  let providerOutputUrl = result.url

  // Seedance reference-video runs were reserved at a WORST CASE (an edit
  // renders the source clip's length, a style run the requested duration —
  // and only the provider knows which). Measure what was actually delivered,
  // from the RAW provider output before any post-process, and let finalize
  // settle to it. `undefined` = not such a run, or unmeasurable → the
  // reservation is committed as before. The same measurement prices the
  // render's recorded provider cost (Seedance 2.5).
  const settle = await measureSeedance2Settle({
    provider: resolvedI2vProvider,
    resolution,
    outputUrl: result.url,
    referenceVideoUrls,
    refVideoDurationsSec,
    duration,
    // The type the route declared (the hold it sized): absent = none.
    referenceTaskType,
    jobId: ctx.jobId,
  })
  const meteredBaseCredits = settle.baseCredits
  const recorded = withMeasuredRenderCost(result, { provider: resolvedI2vProvider, resolution, draft, referenceVideoUrls, duration, settle })
  // A Seedance DRAFT records its RAW take length — before the loop-cut / audio
  // merge below — because the 1080p finalize re-renders (and bills) that take.
  const draftRenderSec = await measureSeedanceDraftRenderSec({ draft, provider: resolvedI2vProvider, outputUrl: result.url })

  // VEO direct-4K: chain the base task into get-4k-video, swapping in the 4K result.
  if (wantsVeo4k) providerOutputUrl = await chainVeoBaseTo4k(result, job, ctx.jobId)

  // Generic smart-loop-cut post-process. Runs for any provider when
  // loopTrim.enabled. Failures are non-fatal: keep the un-trimmed output
  // and take only the addon credits off the commit (the i2v base credits
  // stay charged).
  //
  // On SUCCESS the addon must be CHARGED (we spent the compute). The success
  // commit goes through finalizeJobWithMedia -> commitJobCredits with the
  // provider USD cost, which reconciles actual ≈ base and would otherwise
  // refund the addon — so we forward it as extraNonProviderCredits below.
  //
  // On FAILURE the addon is NOT settled here (review finding F7). Committing
  // at (reserved − addon) before finalize flips `usage_logs.status` out of
  // `reserved`, and EVERY result-gate rejection — a block, a reviewer reject,
  // the hold-TTL expiry, the owner's cancel — refunds through
  // `refundReservedCreditsForJob`, which only iterates `reserved` logs. The
  // early commit turned all four into silent no-ops (while the expiry message
  // still told the user their credits had been refunded), so the user paid the
  // FULL base video price for an output that was never delivered. It is
  // forwarded as `loopTrimAddonRefundCredits` instead: finalize applies it
  // only after the completion CAS wins, and parks it in
  // `held_completion_fields` so approve CAN replay the same settlement (the
  // replay itself lives in `lib/job-policy-review.ts`).
  let loopTrimAddonToCharge = 0
  let loopTrimAddonToRefund = 0
  if (loopTrim?.enabled) {
    // Same sizing as the route's reservation — Auto is priced at the model's ceiling.
    const addonCredits = loopTrimAddonCreditsFor(loopTrim, resolvedI2vProvider, duration)
    try {
      console.log(
        `[worker] image-to-video ${ctx.jobId} smart-loop-cut ` +
        `(quality=${loopTrim.quality ?? "precise"}, framesToTest=${loopTrim.framesToTest ?? 16})`,
      )
      providerOutputUrl = await applySmartLoopCutToR2Url(providerOutputUrl, ctx.jobId, ctx.jobUserId, {
        lookbackFrames: loopTrim.framesToTest ?? 16,
        quality: loopTrim.quality ?? "precise",
        outputSilent: sound === false ? true : undefined,
      })
      loopTrimAddonToCharge = addonCredits
    } catch (err) {
      console.warn(
        `[worker] smart-loop-cut failed for job ${ctx.jobId}; keeping un-trimmed output:`,
        err,
      )
      // Charge nothing for the trim; finalize settles at (reserved − addon).
      loopTrimAddonToRefund = addonCredits
    }
  }

  // VEO3 / VEO3.1 ignore the `sound: false` request (KIE has no audio
  // toggle for VEO). Honour user intent post-hoc: strip the audio track
  // from the result before R2 upload. Skipped when an explicit audioUrl
  // was provided (the merge step downstream handles that case).
  if (
    sound === false &&
    !audioUrl &&
    isVeoProvider(provider)
  ) {
    console.log(
      `[worker] VEO sound=false — stripping audio from output for job ${ctx.jobId}`,
    )
    providerOutputUrl = await stripAudioFromR2Url(providerOutputUrl, ctx.jobId)
  }

  // Upload the generated video to R2
  // If audio merge follows, upload without watermark (watermark applied to final)
  // POST-PROVIDER: `providerOutputUrl` is the delivered i2v result; the bare
  // uploadToR2 here (audio-merge branch) is wrapped so an R2 failure skips the
  // refund (uploadVideoMaybeWatermark already wraps itself).
  //
  // A MOV the provider actually returned (decided by the result, never the
  // request alone — the text-to-video lane's rule) is kept as it is, `.mov`:
  // its parent re-encodes it, and the browser-safe transcode would undo the
  // very container it asked for. A watermarked run, or one with an audio merge
  // to follow, takes the mp4 path as before.
  let finalVideoUrl = audioUrl
    ? await runPostProcessing(() => uploadToR2(providerOutputUrl, ctx.jobId, "video", ctx.jobUserId))
    : wantsMov && isMovUrl(providerOutputUrl) && !ctx.shouldWatermark
      ? await runPostProcessing(() => uploadToR2(providerOutputUrl, ctx.jobId, "video", ctx.jobUserId, { ext: "mov" }))
      : await uploadVideoMaybeWatermark(providerOutputUrl, ctx.jobId, ctx.jobUserId, ctx.shouldWatermark)
  await setJobProgress(job, ctx.jobId, 90)

  // If audio URL is provided, merge it with the video. ONE recipe, so a
  // Seedance draft's 1080p finalize can re-apply exactly this mux.
  const audioMerge = audioUrl ? generateVideoAudioMergeRecipe(audioUrl, generateAudio) : undefined
  if (audioMerge?.kind === "audio-track") {
    console.log(`[worker] Merging audio into video for job ${ctx.jobId}`)
    const mergedPath = await mergeVideoAudio(draftAudioMuxMergeArgs(finalVideoUrl, audioMerge))
    await setJobProgress(job, ctx.jobId, 95)

    // Upload merged video (with watermark if applicable)
    finalVideoUrl = await watermarkLocalVideoAndUpload(mergedPath, `${ctx.jobId}-merged`, ctx.jobUserId, ctx.shouldWatermark)
    await cleanupWorkDir(dirname(mergedPath))
  }

  await setJobProgress(job, ctx.jobId, 100)

  const thumbUrl = await generateAndUploadThumbnail(finalVideoUrl, ctx.jobId, ctx.jobUserId)

  // The settlement measured the provider's take. The stored video has its length
  // when nothing after it changed the length: the watermark re-encode and the
  // upload keep it, a loop cut or an audio merge may not. Otherwise finalize
  // measures the stored file itself, if the run records a length.
  const deliveredVideoSec = providerOutputUrl === result.url && !audioMerge ? settle.deliveredSec : undefined

  const { ok } = await finalizeJobWithMedia({
    jobId: ctx.jobId,
    jobType: "image-to-video",
    result: recorded,
    mediaUrl: finalVideoUrl,
    // Charge the loop-trim addon on top of provider cost when smart-loop-cut
    // succeeded; take it OFF the commit when it failed. Exactly one of these
    // is ever non-zero.
    extraNonProviderCredits: loopTrimAddonToCharge,
    loopTrimAddonRefundCredits: loopTrimAddonToRefund,
    meteredBaseCredits,
    ...(deliveredVideoSec !== undefined && { deliveredVideoSec }),
    extraOutputData: {
      thumbnailUrl: thumbUrl,
      ...buildProviderMeta(result),
      ...draftRenderOutputData(draftRenderSec),
      // A draft records the mux its finalize must re-apply (null = none).
      ...draftAudioMuxOutputData(draft, resolvedI2vProvider, audioMerge),
    },
  })
  if (!ok) return
  console.log(`[worker] Job ${ctx.jobId} completed: ${finalVideoUrl} (provider: ${result.providerUsed}, cost: $${recorded.cost?.toFixed(6) ?? "N/A"})`)
}

const handleVideoToVideo: HandlerFn = async function handleVideoToVideo(job, ctx) {
  const {
    videoUrl, prompt, provider, duration, resolution, audio, multiShots,
    aspectRatio, seed, referenceImageUrl,
    negativePrompt, videoEditDuration, audioSetting, promptExtend,
  } = job.data as {
    jobId: string
    videoUrl: string
    prompt?: string
    provider?: string
    duration?: string
    resolution?: string
    audio?: boolean
    multiShots?: boolean
    aspectRatio?: string
    seed?: number
    referenceImageUrl?: string
    negativePrompt?: string
    videoEditDuration?: string
    audioSetting?: "auto" | "origin"
    promptExtend?: boolean
  }
  const resolvedV2vProvider = provider ?? VIDEO_TO_VIDEO_DEFAULT_PROVIDER
  console.log(`[worker] video-to-video ${ctx.jobId} (provider: ${resolvedV2vProvider})`)

  const v2vOnTaskCreated = makeOnTaskCreated(
    ctx.jobId,
    providerKindForVideoToVideoModel(resolvedV2vProvider),
  )
  const result = await withProgressRamp(
    job,
    ctx.jobId,
    { start: 5, cap: 45 },
    () => videoToVideo(videoUrl, resolvedV2vProvider, prompt, {
      duration,
      resolution,
      audio,
      multiShots,
      aspectRatio,
      seed,
      referenceImageUrl,
      negativePrompt,
      videoEditDuration,
      audioSetting,
      promptExtend,
    }, { onTaskCreated: v2vOnTaskCreated }),
  )
  await setJobProgress(job, ctx.jobId, 50)

  const r2Url = await uploadVideoMaybeWatermark(result.url, ctx.jobId, ctx.jobUserId, ctx.shouldWatermark)
  await setJobProgress(job, ctx.jobId, 100)

  const thumbUrl = await generateAndUploadThumbnail(r2Url, ctx.jobId, ctx.jobUserId)

  const { ok } = await finalizeJobWithMedia({
    jobId: ctx.jobId,
    jobType: "video-to-video",
    result,
    mediaUrl: r2Url,
    extraOutputData: { thumbnailUrl: thumbUrl, ...buildProviderMeta(result) },
  })
  if (!ok) return
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url} (provider: ${result.providerUsed}, cost: $${result.cost?.toFixed(6) ?? "N/A"})`)
}

const handleTextToVideo: HandlerFn = async function handleTextToVideo(job, ctx) {
  // A retired model in a queued job runs as the model it became.
  const { prompt, provider, duration, mode, sound, negativePrompt, cfgScale, aspectRatio, multiShot, shots, elements, removeWatermark, seed, characterIdList, resolution, generateAudio, referenceImageUrls, referenceVideoUrls, referenceAudioUrls, characterReferences, keepOriginalSound, webSearch, nsfwChecker, enableTranslation, contentPolicyRewrite: allowContentPolicyRewrite, refVideoDurationsSec, draft, outputFormat, referenceTaskType } = withRunningVideoProvider({ data: job.data }).data as {
    jobId: string
    /** Seedance 2.5 container, set by the route only for a child job
     *  (`seedance25OutputFormatFor`); absent = mp4. */
    outputFormat?: "mov"
    /** Seedance Draft — see the image-to-video payload above. */
    draft?: boolean
    /** See the image-to-video payload above. */
    referenceTaskType?: DeclaredSeedanceTaskType
    prompt: string
    provider?: string
    duration?: number
    mode?: string
    sound?: boolean
    negativePrompt?: string
    cfgScale?: number
    aspectRatio?: string
    multiShot?: boolean
    shots?: Array<{ prompt: string; duration: number }>
    elements?: Array<{ name: string; description: string; type: "image" | "video"; urls: string[] }>
    removeWatermark?: boolean
    seed?: number
    characterIdList?: string[]
    resolution?: string
    generateAudio?: boolean
    referenceImageUrls?: string[]
    referenceVideoUrls?: string[]
    referenceAudioUrls?: string[]
    /** See the image-to-video payload above. */
    characterReferences?: VideoCharacterReference[]
    /** See the image-to-video payload above. */
    keepOriginalSound?: boolean
    /** See the image-to-video payload above. */
    refVideoDurationsSec?: Array<number | null>
    webSearch?: boolean
    nsfwChecker?: boolean
    enableTranslation?: boolean
    /** `false` = a copyright refusal fails the job instead of being retried
     *  once with a reworded prompt. Absent / true = the retry below. */
    contentPolicyRewrite?: boolean
  }

  // LTX 2.3 short-circuits the t2v router — same prediction-shape rationale
  // as the i2v handler above. Covers both `text_to_video` and (Pro-only)
  // `audio_to_video` tasks; payload-builder emits jobName "text-to-video"
  // for both.
  if (await dispatchLtxIfRequested(job, ctx, "text-to-video")) return

  console.log(`[worker] text-to-video ${ctx.jobId} (provider: ${provider ?? TEXT_TO_VIDEO_DEFAULT_PROVIDER})${removeWatermark ? " [remove watermark]" : ""}`)

  // Map frontend shots/elements to provider format for Kling 3.0
  const multiPrompt = shots?.map((s) => ({ prompt: s.prompt, duration: s.duration }))
  const klingElements = elements?.map((el) => ({
    name: el.name,
    description: el.description,
    ...(el.type === "image" ? { element_input_urls: el.urls } : { element_input_video_urls: el.urls }),
  }))

  // Same fallback ramp as i2v — covers t2v providers that don't expose
  // KIE progress (Seedance, some Wan / Hailuo) so the widget shows
  // movement instead of pinning at 0%.
  await setJobProgress(job, ctx.jobId, 5)
  const t2vRamp = startProgressRamp(job, ctx.jobId, { start: 5, cap: 40 })
  const resolvedT2vProvider = provider ?? TEXT_TO_VIDEO_DEFAULT_PROVIDER
  const t2vOnTaskCreated = makeOnTaskCreated(
    ctx.jobId,
    providerKindForVideoModel(resolvedT2vProvider),
  )
  // VEO direct-4K: run the base at VEO_4K_BASE_RESOLUTION, then chain get-4k-video below.
  const wantsVeo4k = resolution === "4k" && isVeoProvider(provider)
  const baseResolution = wantsVeo4k ? VEO_4K_BASE_RESOLUTION : resolution
  // Extracted to a const so the content-policy retry below resubmits with
  // byte-identical options — only the prompt text differs between the two
  // textToVideo calls.
  // `outputFormat` only when the route honoured mov (Seedance 2.5, a child
  // job): the mp4 options stay key-for-key what they were.
  const wantsMov = outputFormat === "mov" && resolvedT2vProvider === "seedance-2-5"
  const t2vOpts = { mode, sound, negativePrompt, cfgScale, multiShots: multiShot, multiPrompt, klingElements, seed, resolution: baseResolution, generateAudio, referenceImageUrls, referenceVideoUrls, referenceAudioUrls, characterReferences, keepOriginalSound, webSearch, nsfwChecker, enableTranslation, draft, ...(referenceTaskType ? { referenceTaskType } : {}), contentPolicyRewrite: allowContentPolicyRewrite, ...(wantsMov ? { outputFormat: "mov" as const } : {}) }
  let result
  // Content-policy rewrite-once (Task A2, 2026-08-03): a `contentPolicy`-
  // classified KieError (see classifyContentPolicy in providers/kie/client.ts)
  // means the identical prompt will fail again deterministically on a bare
  // retry, so this rewrites ONCE via an LLM (rewriteForContentPolicy) and
  // resubmits with the rewritten text. Any other error, a null rewrite, or a
  // second flagged failure all propagate untouched — fail-fast refund
  // semantics via isUpstreamFailure are unaffected. Sibling of the private
  // plugin repo's GVP rewrite-once (Task P5) — see content-policy-rewrite.ts's
  // header for the hand-sync contract.
  let contentPolicyRewrite: { original: string; rewritten: string } | undefined
  try {
    try {
      result = await textToVideo(prompt, resolvedT2vProvider, duration, aspectRatio, t2vOpts, { onTaskCreated: t2vOnTaskCreated })
    } catch (err) {
      // W4/M-19b: allow-list the ONE class the rewriter can actually help.
      // The rewrite prompt (lib/content-policy-rewrite.ts) is copyright-aware
      // only, so every other class is a no-op that burns an LLM call and a
      // paid retry. This was a deny-list naming a single excluded class, which
      // let SAFETY blocks through — and the moderation-vocabulary widening in
      // providers/kie/client.ts (log pull §11.3) makes safety blocks far more
      // common. A new class added later is excluded by default, which is the
      // safe direction for a paid retry.
      if (!(err instanceof KieError) || err.contentPolicyClass !== "copyright") throw err
      // The caller opted out: the refusal stands, unreworded.
      if (allowContentPolicyRewrite === false) throw err
      const rewritten = await rewriteForContentPolicy(prompt)
      if (!rewritten) throw err
      result = await textToVideo(rewritten, resolvedT2vProvider, duration, aspectRatio, t2vOpts, { onTaskCreated: t2vOnTaskCreated })
      contentPolicyRewrite = { original: prompt, rewritten }
    }
  } finally {
    t2vRamp.stop()
  }

  // Don't write a backward milestone — the ramp may already be at 80–90%+
  // for long generations. The 100% write after upload will advance past it.

  // VEO3 / VEO3.1: KIE has no native audio toggle, so honour `sound: false`
  // by stripping the audio track post-generation (cheap stream copy).
  let providerOutputUrl = result.url

  // Seedance reference-video runs: settle to the delivered clip (see the
  // image-to-video handler above for why the reservation is a worst case),
  // and record the render's provider cost from the same measurement.
  const settle = await measureSeedance2Settle({
    provider: resolvedT2vProvider,
    resolution,
    outputUrl: result.url,
    referenceVideoUrls,
    refVideoDurationsSec,
    duration,
    referenceTaskType,
    jobId: ctx.jobId,
  })
  const meteredBaseCredits = settle.baseCredits
  const recorded = withMeasuredRenderCost(result, { provider: resolvedT2vProvider, resolution, draft, referenceVideoUrls, duration, settle })
  // Seedance DRAFT: record the raw take length the 1080p finalize bills.
  const draftRenderSec = await measureSeedanceDraftRenderSec({ draft, provider: resolvedT2vProvider, outputUrl: result.url })

  // VEO direct-4K: chain into 4K BEFORE the sound-strip below, so stripping
  // operates on the 4K output (reserved at the `<model>:4k` composite).
  if (wantsVeo4k) providerOutputUrl = await chainVeoBaseTo4k(result, job, ctx.jobId)

  if (sound === false && isVeoProvider(provider)) {
    console.log(
      `[worker] VEO sound=false — stripping audio from t2v output for job ${ctx.jobId}`,
    )
    providerOutputUrl = await stripAudioFromR2Url(providerOutputUrl, ctx.jobId)
  }

  // A MOV the provider actually returned (decided by the result, never the
  // request alone: a relayed run's far end may answer mp4) is kept as it is,
  // `.mov` / `video/quicktime` — its parent re-encodes it, and the browser-
  // safe transcode would undo the very container it asked for. A watermarked
  // run re-encodes in the watermark step, which writes an honest mp4.
  const r2Url = wantsMov && isMovUrl(providerOutputUrl) && !ctx.shouldWatermark
    ? await runPostProcessing(() => uploadToR2(providerOutputUrl, ctx.jobId, "video", ctx.jobUserId, { ext: "mov" }))
    : await uploadVideoMaybeWatermark(providerOutputUrl, ctx.jobId, ctx.jobUserId, ctx.shouldWatermark)
  await setJobProgress(job, ctx.jobId, 100)

  const thumbUrl = await generateAndUploadThumbnail(r2Url, ctx.jobId, ctx.jobUserId)

  // The settlement measured the provider's take: the stored video's length (the
  // watermark re-encode and the upload keep it) unless a post-process (VEO's 4K
  // chain or sound strip) replaced the file.
  const deliveredVideoSec = providerOutputUrl === result.url ? settle.deliveredSec : undefined

  const { ok } = await finalizeJobWithMedia({
    jobId: ctx.jobId,
    jobType: "text-to-video",
    result: recorded,
    mediaUrl: r2Url,
    meteredBaseCredits,
    ...(deliveredVideoSec !== undefined && { deliveredVideoSec }),
    extraOutputData: {
      thumbnailUrl: thumbUrl,
      ...buildProviderMeta(result),
      ...(contentPolicyRewrite && { contentPolicyRewrite }),
      ...draftRenderOutputData(draftRenderSec),
      // This lane muxes nothing after the provider renders (the VEO sound strip
      // never applies to a draft-capable model): a draft records null.
      ...draftAudioMuxOutputData(draft, resolvedT2vProvider, undefined),
    },
  })
  if (!ok) return
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url} (provider: ${result.providerUsed}, cost: $${recorded.cost?.toFixed(6) ?? "N/A"})`)
}

const handleLipSync: HandlerFn = async function handleLipSync(job, ctx) {
  const {
    imageUrl, videoUrl, audioUrl, prompt, provider, resolution,
    audioDurationSec,
    guidanceScale, inferenceSteps, seed, fastMode,
    pads, smooth, fps, resizeFactor,
    enhancer, preprocess, still, poseStyle, expressionScale,
    enableDynamicDuration, disableMusicTrack, enableSpeechEnhancement,
    syncMode, temperature, activeSpeaker,
    mode, separateVocal, openScenedet, alignAudio, alignAudioReverse, templStartSeconds,
    lipSyncBilledSeconds,
  } = job.data as {
    jobId: string
    imageUrl?: string
    videoUrl?: string
    audioUrl: string
    prompt?: string
    provider?: string
    resolution?: string
    audioDurationSec?: number
    guidanceScale?: number
    inferenceSteps?: number
    seed?: number
    fastMode?: boolean
    pads?: string
    smooth?: boolean
    fps?: number
    resizeFactor?: number
    enhancer?: string
    preprocess?: string
    still?: boolean
    poseStyle?: number
    expressionScale?: number
    enableDynamicDuration?: boolean
    disableMusicTrack?: boolean
    enableSpeechEnhancement?: boolean
    syncMode?: string
    temperature?: number
    activeSpeaker?: boolean
    // Volcengine video-to-video dubbing
    mode?: "lite" | "basic"
    separateVocal?: boolean
    openScenedet?: boolean
    alignAudio?: boolean
    alignAudioReverse?: boolean
    templStartSeconds?: number
    // A per-second-rate model (OmniHuman 2.0): the seconds the run was held for.
    lipSyncBilledSeconds?: number
  }

  const resolvedProvider = provider ?? LIP_SYNC_DEFAULT_PROVIDER
  console.log(`[worker] lip-sync ${ctx.jobId} (provider: ${resolvedProvider})`)

  // Lip-sync providers (KIE Kling Avatar / InfiniTalk, Replicate models,
  // Seedance i2v with audio ref) all run long KIE/Replicate tasks. Wrap
  // in a single ramp so the widget bar moves regardless of which branch
  // we take.
  await setJobProgress(job, ctx.jobId, 5)
  const lipSyncRamp = startProgressRamp(job, ctx.jobId, { start: 5, cap: 45 })

  let resultUrl: string
  let resultCost: number | null = null
  let resultDisplayCost: number | null = null
  let resultProviderUsed: string = resolvedProvider
  // The full ProviderResult (was `Parameters<typeof buildProviderMeta>[0]`,
  // which is a Pick that drops the relay pair): `buildProviderMeta` accepts it
  // unchanged, and the rebuilt finalize literal below can read the two
  // migration-383 fields off it. Left undefined by the fal branch.
  let resultMeta: ProviderResult | undefined = undefined

  try {

  // Pick the right ProviderKind per branch. Replicate lip-sync runs on
  // Replicate predictions; Seedance routes through KIE's i2v provider;
  // KIE-native lip-sync (kling-avatar*, infinitalk) uses its own poll budget.
  let lipSyncKind: ProviderKind
  if (REPLICATE_LIP_SYNC_PROVIDERS.has(resolvedProvider as never)) {
    lipSyncKind = "replicate-prediction"
  } else if (FAL_LIP_SYNC_PROVIDERS.has(resolvedProvider as never)) {
    // fal queue jobs reconcile via the "fal-request" kind (tags the row so the
    // reconcile cron can recover/refund a crashed mid-poll fal job).
    lipSyncKind = "fal-request"
  } else if (SEEDANCE_LIP_SYNC_PROVIDERS.has(resolvedProvider as never)) {
    lipSyncKind = providerKindForVideoModel(resolvedProvider)
  } else {
    lipSyncKind = providerKindForLipSyncModel(resolvedProvider)
  }
  const lipSyncOnTaskCreated = makeOnTaskCreated(ctx.jobId, lipSyncKind)

  if (REPLICATE_LIP_SYNC_PROVIDERS.has(resolvedProvider as never)) {
    // Replicate path
    const faceUrl = videoUrl || imageUrl
    if (!faceUrl) throw new Error("No face input (imageUrl or videoUrl) provided")

    const { videoUrl: outUrl, cost } = await replicateLipSync(
      resolvedProvider,
      faceUrl,
      audioUrl,
      { guidanceScale, inferenceSteps, seed, pads, smooth, fps, resizeFactor, enhancer, preprocess, still, poseStyle, expressionScale, enableDynamicDuration, disableMusicTrack, enableSpeechEnhancement, syncMode, temperature, activeSpeaker },
      { onTaskCreated: lipSyncOnTaskCreated },
    )
    resultUrl = outUrl
    resultCost = cost
    resultDisplayCost = cost
    resultProviderUsed = `replicate:${resolvedProvider}`
  } else if (SEEDANCE_LIP_SYNC_PROVIDERS.has(resolvedProvider as never)) {
    // Seedance 2 / 2 Fast — ByteDance's multimodal video models do native
    // phoneme-level lip sync (8+ languages) when fed reference_audio_urls
    // alongside a first_frame_url image. We route through the i2v provider
    // and pass the audio as a reference; the model produces a cinematic
    // talking-head video synced to the voice line.
    if (!imageUrl) {
      throw new Error(`${resolvedProvider} lip-sync requires an image (face/portrait)`)
    }
    const result = await imageToVideo(
      imageUrl,
      resolvedProvider,
      prompt || "A person speaking naturally",
      8, // duration — seedance can pick 4-15s; we reserve credits at 8s
      undefined, // endFrameUrl — not used in lip-sync mode
      {
        referenceAudioUrls: [audioUrl],
        resolution: resolution ?? "720p",
        // generateAudio: false — we already have the audio track; let
        // seedance use OUR audio as the soundtrack rather than synthesise
        // a new one. (KIE merges reference_audio_urls into output by default.)
        generateAudio: false,
      },
      { onTaskCreated: lipSyncOnTaskCreated },
    )
    resultUrl = result.url
    resultCost = result.cost
    resultDisplayCost = result.displayCost
    resultProviderUsed = result.providerUsed
    resultMeta = result
  } else if (FAL_LIP_SYNC_PROVIDERS.has(resolvedProvider as never)) {
    // fal.ai path (sync-lipsync-v3) — video+audio → video dubbing via the fal
    // queue API. faceUrl can be a video OR an image; the worker already accepts
    // both. audioDurationSec drives per-second credit bucketing (reserved at the
    // route); here it only feeds the anomaly/display cost. activeSpeaker → fal
    // options.active_speaker_detection (auto-detect, v3) — see falLipSync.
    const faceUrl = videoUrl || imageUrl
    if (!faceUrl) throw new Error("Lip-sync requires a video or image input")
    const out = await falLipSync(
      resolvedProvider,
      faceUrl,
      audioUrl,
      { syncMode, audioDurationSec, activeSpeaker },
      { onTaskCreated: lipSyncOnTaskCreated },
    )
    resultUrl = out.videoUrl
    resultCost = out.cost
    resultDisplayCost = out.cost
    resultProviderUsed = "fal"
  } else if (KIE_LIP_SYNC_MODELS[resolvedProvider]?.inputKind === "video") {
    // KIE video-to-video dubbing (volcengine) — video_url + audio_url + mode +
    // optional toggles, NO prompt. Reconciles via the standard "kie-lip-sync"
    // kind (set above). audioDurationSec drives per-second credit bucketing
    // (reserved at the route) and selects the longer poll budget for >30s runs.
    if (!videoUrl) throw new Error("Volcengine lip sync requires a video input (videoUrl)")
    const result = await lipSyncVideo(
      videoUrl,
      audioUrl,
      resolvedProvider,
      { mode, separateVocal, openScenedet, alignAudio, alignAudioReverse, templStartSeconds },
      audioDurationSec,
      { onTaskCreated: lipSyncOnTaskCreated },
    )
    resultUrl = result.url
    resultCost = result.cost
    resultDisplayCost = result.displayCost
    resultProviderUsed = result.providerUsed
    resultMeta = result
  } else {
    // KIE path (existing) — audioDurationSec drives per-second pricing for
    // kling-avatar(-pro) and selects the longer poll budget for >30s runs.
    const result = await lipSync(
      imageUrl!,
      audioUrl,
      resolvedProvider,
      prompt,
      resolution,
      audioDurationSec,
      { onTaskCreated: lipSyncOnTaskCreated },
      { fastMode, seed, ...(lipSyncBilledSeconds !== undefined ? { billedSeconds: lipSyncBilledSeconds } : {}) },
    )
    resultUrl = result.url
    resultCost = result.cost
    resultDisplayCost = result.displayCost
    resultProviderUsed = result.providerUsed
    resultMeta = result
  }
  } finally {
    lipSyncRamp.stop()
  }

  await setJobProgress(job, ctx.jobId, 50)

  const r2Url = await uploadVideoMaybeWatermark(resultUrl, ctx.jobId, ctx.jobUserId, ctx.shouldWatermark)
  await setJobProgress(job, ctx.jobId, 100)

  const thumbUrl = await generateAndUploadThumbnail(r2Url, ctx.jobId, ctx.jobUserId)

  const { ok } = await finalizeJobWithMedia({
    jobId: ctx.jobId,
    jobType: "lip-sync",
    result: {
      url: resultUrl,
      cost: resultCost,
      displayCost: resultDisplayCost,
      providerUsed: resultProviderUsed,
      // Relay provenance (spec §8.2 lane 1, migration 383): this literal is
      // rebuilt from flattened locals, so the pair the NodaroCloud video
      // provider set on the ProviderResult only reaches finalize if it is
      // carried by hand. Absent on every vendor-direct branch (and on fal,
      // which leaves `resultMeta` undefined) ⇒ no key, no column written.
      ...(resultMeta?.relayJobId && { relayJobId: resultMeta.relayJobId, relayCredits: resultMeta.relayCredits ?? null }),
    },
    mediaUrl: r2Url,
    extraOutputData: { thumbnailUrl: thumbUrl, ...buildProviderMeta(resultMeta) },
  })
  if (!ok) return
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url} (provider: ${resultProviderUsed}, cost: $${resultCost?.toFixed(6) ?? "N/A"})`)
}

const handleSpeechToVideo: HandlerFn = async function handleSpeechToVideo(job, ctx) {
  const { imageUrl, audioUrl, prompt, resolution, negativePrompt, seed, numFrames, fps, inferenceSteps, guidanceScale, shift } = job.data as {
    jobId: string
    imageUrl: string
    audioUrl: string
    prompt: string
    resolution?: string
    negativePrompt?: string
    seed?: number
    numFrames?: number
    fps?: number
    inferenceSteps?: number
    guidanceScale?: number
    shift?: number
  }
  console.log(`[worker] speech-to-video ${ctx.jobId} (resolution: ${resolution ?? "480p"})`)

  // Through the capability router, not a direct KieVideoProvider construction
  // (#644): a local KIE key still wins the chain walk exactly as before, a
  // keyless CONNECTED install now reaches the cloud, and a keyless
  // unconnected one gets the router's actionable missing-key message.
  const s2vOnTaskCreated = makeOnTaskCreated(ctx.jobId, "kie-standard")
  const result = await withProgressRamp(
    job,
    ctx.jobId,
    { start: 5, cap: 45 },
    () => speechToVideo(imageUrl, audioUrl, prompt, resolution, {
      negativePrompt,
      seed,
      numFrames,
      fps,
      inferenceSteps,
      guidanceScale,
      shift,
    }, { onTaskCreated: s2vOnTaskCreated }),
  )
  await setJobProgress(job, ctx.jobId, 50)

  const r2Url = await uploadVideoMaybeWatermark(result.url, ctx.jobId, ctx.jobUserId, ctx.shouldWatermark)
  await setJobProgress(job, ctx.jobId, 100)

  const thumbUrl = await generateAndUploadThumbnail(r2Url, ctx.jobId, ctx.jobUserId)

  const { ok } = await finalizeJobWithMedia({
    jobId: ctx.jobId,
    jobType: "image-to-video",
    result,
    mediaUrl: r2Url,
    extraOutputData: { thumbnailUrl: thumbUrl, ...buildProviderMeta(result) },
  })
  if (!ok) return
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url} (provider: ${result.providerUsed}, cost: $${result.cost?.toFixed(6) ?? "N/A"})`)
}

const handleMotionTransfer: HandlerFn = async function handleMotionTransfer(job, ctx) {
  const { imageUrl, videoUrl, prompt, negativePrompt, characterOrientation, resolution, provider, backgroundSource } = job.data as {
    jobId: string
    imageUrl: string
    videoUrl: string
    prompt?: string
    negativePrompt?: string
    characterOrientation?: "image" | "video"
    resolution?: "480p" | "580p" | "720p" | "1080p"
    provider?: string
    backgroundSource?: "input_video" | "input_image"
  }
  const mtProvider = provider ?? MOTION_TRANSFER_DEFAULT_PROVIDER
  console.log(`[worker] motion-transfer ${ctx.jobId} (provider: ${mtProvider}, orientation: ${characterOrientation ?? "image"}, resolution: ${resolution ?? "720p"})`)

  const onProgress: ProgressCallback = async (progress: number) => {
    console.log(`[worker] Job ${ctx.jobId} motion-transfer progress: ${progress}%`)
    await setJobProgress(job, ctx.jobId, progress)
  }

  const mtOnTaskCreated = makeOnTaskCreated(ctx.jobId, "kie-standard")
  const result = await withProgressRamp(
    job,
    ctx.jobId,
    { start: 5, cap: 45 },
    () => motionTransfer(
      imageUrl,
      videoUrl,
      mtProvider,
      prompt,
      {
        onProgress,
        characterOrientation: characterOrientation ?? "image",
        resolution: resolution ?? "720p",
        provider: mtProvider,
        backgroundSource,
        negativePrompt,
      },
      { onTaskCreated: mtOnTaskCreated },
    ),
  )
  await setJobProgress(job, ctx.jobId, 50)

  const r2Url = await uploadVideoMaybeWatermark(result.url, ctx.jobId, ctx.jobUserId, ctx.shouldWatermark)
  await setJobProgress(job, ctx.jobId, 100)

  const thumbUrl = await generateAndUploadThumbnail(r2Url, ctx.jobId, ctx.jobUserId)

  const { ok } = await finalizeJobWithMedia({
    jobId: ctx.jobId,
    jobType: "motion-transfer",
    result,
    mediaUrl: r2Url,
    extraOutputData: { thumbnailUrl: thumbUrl, ...buildProviderMeta(result) },
  })
  if (!ok) return
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url} (provider: ${result.providerUsed}, cost: $${result.cost?.toFixed(6) ?? "N/A"})`)
}

/**
 * Nodaro Video Upscale, a house model (decided 2026-11-11): the run of exactly
 * what was measured and priced — the stored clip, the tier, the billed seconds
 * — happens behind the house-model seam (lib/house-models.ts), on the poll
 * cadence and budget of its row in house-model-timeouts.ts, and its result is
 * delivered by the lane's ONE delivery (`deliverHouseModelRun`, the same the
 * reconcile calls): never this handler's own finalize. The clip's one
 * measurement (its stored size) goes to the run as its input facts. A failure
 * is rethrown unchanged: the seam marks what is final (failed and refunded
 * now) and what is left for the reconcile to read again.
 */
async function runNodaroVideoUpscale(job: Parameters<HandlerFn>[0], ctx: Parameters<HandlerFn>[1]): Promise<void> {
  const request = job.data as Record<string, unknown>
  const { videoUrl, tier, billedSec, sourceSizeBytes } = request
  if (
    typeof videoUrl !== "string" || !isNodaroVideoUpscaleTier(tier) ||
    typeof billedSec !== "number" || typeof sourceSizeBytes !== "number"
  ) {
    throw new DeterministicJobError("Couldn't read the video to upscale.")
  }
  const run = await withProgressRamp(job, ctx.jobId, { start: 5, cap: 90 }, () => runHouseModelTask(
    NODARO_VIDEO_UPSCALE_PROVIDER,
    { videoUrl, tier, billedSec },
    { jobId: ctx.jobId, ...houseModelTiming(NODARO_VIDEO_UPSCALE_PROVIDER), inputFacts: { [videoUrl]: { bytes: sourceSizeBytes } } },
  ))
  const { ok } = await deliverHouseModelRun({
    id: NODARO_VIDEO_UPSCALE_PROVIDER,
    jobId: ctx.jobId,
    jobType: "video-upscale",
    job: request,
    ...run,
    claimant: "worker",
  })
  if (ok) console.log(`[worker] Job ${ctx.jobId} completed (provider: ${NODARO_VIDEO_UPSCALE_PROVIDER})`)
}

const handleVideoUpscale: HandlerFn = async function handleVideoUpscale(job, ctx) {
  const { videoUrl, upscaleFactor, targetResolution, targetFps, provider, kieTaskId, draftAudioMux, draftNsfwChecker, draftVideoUrl, draftHasRefVideo } = job.data as {
    jobId: string
    videoUrl?: string
    /** Legacy relative lever — mapped onto a target over the clip's size. */
    upscaleFactor?: "1" | "2" | "4"
    /** Topaz target, resolved by the route / workflow run before it priced the run. */
    targetResolution?: TopazVideoResolution
    targetFps?: number
    provider?: VideoUpscaleProvider
    kieTaskId?: string
    /** Seedance draft finalize: the mux the draft got after rendering (from the source job). */
    draftAudioMux?: unknown
    /** The draft's own filter choice (`nsfwChecker`), kept by its finalize. */
    draftNsfwChecker?: unknown
    /** Seedance draft finalize: the stored draft clip (audio-copy fallback). */
    draftVideoUrl?: string
    /** Seedance draft finalize: whether the draft had a reference video. */
    draftHasRefVideo?: boolean
    /** Seedance draft finalize, route only (queue only): the seconds its charge bills. A
     *  workflow run carries the draft's `draftOutputSec` / `draftRefVideoDurationsSec`
     *  instead, and the seconds are derived from those (`seedanceDraftFinalizeQueuedBilledSec`). */
    draftBilledSec?: unknown
  }
  const upscaleProvider = provider ?? VIDEO_UPSCALE_DEFAULT_PROVIDER
  console.log(`[worker] video-upscale ${ctx.jobId} (provider: ${upscaleProvider})`)
  if (upscaleProvider === NODARO_VIDEO_UPSCALE_PROVIDER) return runNodaroVideoUpscale(job, ctx)

  // Wrap each branch in a progress ramp — none of these (VEO upscale,
  // Topaz, etc.) reliably surface live progress; without the ramp the
  // bar pins for the whole upscale duration.
  // The relay half of the topaz branch's ProviderResult, captured out of the
  // ramp closure the way lip-sync captures `resultMeta`: the lambda returns a
  // URL (three branches, three different providers), so without this the pair
  // is discarded with the rest of the result. NodaroCloud serves the topaz
  // branch only — the two VEO branches are KIE-direct and leave it undefined.
  let upscaleMeta: ProviderResult | undefined
  // The draft finalize's result, kept the same way: it carries the render's cost.
  let finalizeMeta: Awaited<ReturnType<typeof runSeedanceDraftFinalize>> | undefined
  const outputUrl: string = await withProgressRamp(
    job,
    ctx.jobId,
    { start: 5, cap: 45 },
    async () => {
      // Per-branch provider_kind: each upscale path polls a DIFFERENT KIE
      // endpoint, so the reconcile dispatcher needs the right kind to pick
      // the matching `pollX` function. Wiring all three through
      // `kie-standard` (the old default) sent reconcile to
      // `/api/v1/jobs/recordInfo` for VEO 4K / 1080p tasks that live on
      // `/api/v1/veo/record-info` / `/api/v1/veo/get-1080p-video` — every
      // stuck row got force-failed after 18 wrong-endpoint polls.
      if (upscaleProvider === SEEDANCE_DRAFT_FINALIZE_PROVIDER) {
        // Seedance draft finalize: the route / workflow run validated the
        // draft (owner, model, draft flag, completed) and stamped ITS task id.
        if (!kieTaskId) throw new DeterministicJobError("Seedance 2.5 HD needs the draft's task id — finalize a completed Seedance 2.5 draft.")
        const onProgress: ProgressCallback = async (progress: number) => {
          await setJobProgress(job, ctx.jobId, progress)
        }
        // The seconds the charge bills (the route's, or derived from a workflow
        // run's draft fields): the render records what the provider bills for
        // them. None usable records no cost; working them out never fails the run.
        const billedSec = await seedanceDraftFinalizeQueuedBilledSec(job.data).catch((err: unknown) => {
          console.warn(`[worker] video-upscale ${ctx.jobId}: could not read the finalize's billed seconds; no provider cost is recorded:`, err)
          return undefined
        })
        const result = await runSeedanceDraftFinalize(kieTaskId, {
          onProgress,
          reconcile: { onTaskCreated: makeOnTaskCreated(ctx.jobId, "kie-seedance-draft") },
          nsfwChecker: draftNsfwChecker === true,
          ...(billedSec !== undefined ? { billing: { billedSec, hasRefVideo: draftHasRefVideo === true } } : {}),
        })
        finalizeMeta = result
        return result.url
      } else if (upscaleProvider === "veo-1080p" && kieTaskId) {
        const veo1080OnTaskCreated = makeOnTaskCreated(ctx.jobId, "kie-veo-1080p")
        const result = await runVeo1080pTask(kieTaskId, 0, { onTaskCreated: veo1080OnTaskCreated })
        return result.url
      } else if (upscaleProvider === "veo-4k" && kieTaskId) {
        const veo4kOnTaskCreated = makeOnTaskCreated(ctx.jobId, "kie-veo")
        const { resultJson } = await runVeo4kTask(kieTaskId, 0, { onTaskCreated: veo4kOnTaskCreated })
        const url = resultJson.resultUrls?.[0]
        if (!url) throw new Error("VEO 4K succeeded but no URL found")
        return url
      } else {
        if (!videoUrl) throw new Error("videoUrl is required for Topaz upscale")
        // Topaz runs on Replicate (since 2026-10-25): the prediction id is
        // persisted so the reconcile cron polls Replicate, never KIE.
        const topazOnTaskCreated = makeOnTaskCreated(ctx.jobId, "replicate-prediction")
        const onProgress: ProgressCallback = async (progress: number) => {
          console.log(`[worker] Job ${ctx.jobId} video-upscale progress: ${progress}%`)
          await setJobProgress(job, ctx.jobId, progress)
        }
        const result = await videoUpscale(
          videoUrl,
          "topaz",
          {
            ...(upscaleFactor !== undefined ? { upscaleFactor } : {}),
            ...(targetResolution !== undefined ? { targetResolution } : {}),
            ...(targetFps !== undefined ? { targetFps } : {}),
          },
          { onProgress },
          { onTaskCreated: topazOnTaskCreated },
        )
        upscaleMeta = result
        return result.url
      }
    },
  )
  await setJobProgress(job, ctx.jobId, 50)

  // A Seedance draft finalize re-applies the draft's post-render audio mux
  // (a merged audioUrl, a voiced lane's dialogue track) to the 1080p render, so
  // the HD keeps the draft's sound. Every other upscale: unchanged.
  const finalizeMux = upscaleProvider === SEEDANCE_DRAFT_FINALIZE_PROVIDER ? readDraftAudioMux(draftAudioMux) : undefined
  const muxed = finalizeMux
    ? await applyDraftAudioMux({ videoUrl: outputUrl, mux: finalizeMux, draftVideoUrl, jobId: ctx.jobId, userId: ctx.jobUserId, watermark: ctx.shouldWatermark })
    : undefined
  // Topaz delivers HEVC 10-bit: the delivery transcodes it to browser-safe
  // H.264 at the visually lossless CRF — the user paid for detail. Every other
  // upscaler here delivers H.264, which is
  // uploaded as delivered (the transcode runs only for a codec browsers
  // cannot play).
  const isTopaz = upscaleProvider === "topaz"
  const r2Url = muxed?.url ?? (isTopaz
    ? await uploadVideoMaybeWatermark(outputUrl, ctx.jobId, ctx.jobUserId, ctx.shouldWatermark, { crf: COMBINE_DELIVERY_CRF })
    : await uploadVideoMaybeWatermark(outputUrl, ctx.jobId, ctx.jobUserId, ctx.shouldWatermark))
  await setJobProgress(job, ctx.jobId, 100)

  const thumbUrl = await generateAndUploadThumbnail(r2Url, ctx.jobId, ctx.jobUserId)

  // Topaz is metered: charged the units Replicate reports at the unit's own
  // price row, never above the hold (the route / workflow run reserved a
  // ceiling from the clip's output gigapixels). No reported units = the hold.
  const meteredBaseCredits = isTopaz && upscaleMeta?.billedUnits !== undefined
    ? await unitRateBaseCredits(TOPAZ_VIDEO_UNIT_CREDIT_ID, upscaleMeta.billedUnits)
    : undefined

  const { ok } = await finalizeJobWithMedia({
    jobId: ctx.jobId,
    jobType: "video-upscale",
    ...(meteredBaseCredits !== undefined ? { meteredBaseCredits } : {}),
    result: {
      url: outputUrl,
      // Topaz: Replicate's bill for the run (recorded; the charge is the units above).
      // A draft finalize: what the provider bills for its render (recorded; the
      // charge is the reserved row). VEO: none.
      cost: isTopaz ? upscaleMeta?.cost ?? null : finalizeMeta?.cost ?? null,
      providerUsed: upscaleProvider,
      // Same rebuilt-literal carry as lip-sync above, same reason.
      ...(upscaleMeta?.relayJobId && { relayJobId: upscaleMeta.relayJobId, relayCredits: upscaleMeta.relayCredits ?? null }),
    },
    mediaUrl: r2Url,
    // The finalize's audio could not be re-applied: the render is delivered
    // (and charged) silent, with a visible warning on the result.
    extraOutputData: {
      thumbnailUrl: thumbUrl,
      ...(muxed ? draftAudioWarningOutputData(muxed) : {}),
    },
  })
  if (!ok) return
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url} (provider: ${upscaleProvider})`)
}

const handleExtendVideo: HandlerFn = async function handleExtendVideo(job, ctx) {
  const d = job.data as Record<string, unknown>
  // A retired id runs as the provider it became (`seedance-2-extend` → `seedance-2-5-extend`).
  const provider = canonicalVideoProvider(d.provider as string)

  // ─── LTX 2.3 Pro extend ────────────────────────────────────────────────
  // Synchronous `replicate.wait()` — the prediction id is persisted on the
  // job row by makeOnTaskCreated so the 20-min reconcile cron acts as a
  // safety net if the worker process dies mid-wait.
  if (provider === "ltx-2.3-pro") {
    console.log(`[worker] extend-video ${ctx.jobId} (provider: ltx-2.3-pro)`)
    await setJobProgress(job, ctx.jobId, 5)
    const ltxExtendRamp = startProgressRamp(job, ctx.jobId, { start: 5, cap: 85 })
    let ltxExtendResult
    try {
      ltxExtendResult = await runLtxExtend({
        variant: "ltx-2.3-pro",
        video: d.video as string,
        // The seconds the run was priced for — the route and the workflow run
        // already send this reading; repeating it here keeps a hand-queued
        // job on the same 1-20 whole seconds.
        duration: ltxExtendDurationSec(d.duration),
        extendMode: (d.extend_mode as "start" | "end" | undefined) ?? "end",
        reconcileOpts: {
          onTaskCreated: makeOnTaskCreated(ctx.jobId, providerKindForVideoModel("ltx-2.3-pro")),
        },
      })
    } finally {
      ltxExtendRamp.stop()
    }
    const ltxExtendR2Url = await uploadVideoMaybeWatermark(
      ltxExtendResult.videoUrl,
      ctx.jobId,
      ctx.jobUserId,
      ctx.shouldWatermark,
    )
    await setJobProgress(job, ctx.jobId, 100)
    const ltxExtendThumbUrl = await generateAndUploadThumbnail(
      ltxExtendR2Url,
      ctx.jobId,
      ctx.jobUserId,
    )
    const { ok: ltxExtendOk } = await finalizeJobWithMedia({
      jobId: ctx.jobId,
      jobType: "extend-video",
      result: {
        url: ltxExtendResult.videoUrl,
        cost: ltxExtendResult.cost,
        providerUsed: "ltx-2.3-pro",
        // Priced by output tier, never GPU time — see the main LTX finalize above.
        meteredCost: false,
      },
      mediaUrl: ltxExtendR2Url,
      extraOutputData: { thumbnailUrl: ltxExtendThumbUrl },
    })
    if (ltxExtendOk) {
      console.log(
        `[worker] Job ${ctx.jobId} completed: ${ltxExtendR2Url} (provider: ltx-2.3-pro, cost: $${ltxExtendResult.cost?.toFixed(6) ?? "N/A"})`,
      )
    }
    return
  }

  // ─── Tail-recipe smart-stitch extend (Seedance 2.5 / Seedance 2.0) ─────
  // Extends ANY video by URL: generate the continuation on the provider's own
  // model (`TAIL_RECIPES`, lib/extend-recipe.ts) through the i2v transport —
  // the source's LAST FRAME as the first-frame anchor + its last seconds as
  // the @video_1 reference, with the recipe's prompt (Seedance: the
  // spike-validated "extend @video_1 as follows:" template) — then
  // smart-stitch source+extension into one seamless clip (PSNR boundary
  // matching; the fixed trim counts are the no-match fallback).
  if (isTailRecipeProvider(provider)) {
    const recipe = TAIL_RECIPES[provider]
    const { video: sourceUrl, prompt: userPrompt, duration, resolution, generateAudio, referenceImageUrls } = job.data as {
      jobId: string
      video: string
      prompt: string
      duration?: number
      resolution?: string
      generateAudio?: boolean
      /** Route-assembled user refs (anchor-budgeted) — seats @image_1…N. */
      referenceImageUrls?: string[]
    }
    console.log(`[worker] extend-video ${ctx.jobId} (provider: ${provider})`)

    // The job's provider picks the model the continuation is generated on;
    // the credit id is the provider's own row (`seedanceExtendCreditId`), so
    // reserve and generation can't diverge.
    const genModel = recipe.genModel
    // The seconds the run is priced for — the funnel the credit id reads
    // (the provider's catalog default when unset) — held in the recipe's
    // window (2.0: 4–15s, 2.5: 4–30s): what the route queued.
    const extSeconds = tailRecipeSeconds(provider, duration)

    // The extension must match the SOURCE's shape or the stitch crops it
    // (`stitchExtension` scales it to cover the source's frame).
    // seedance-2 natively accepts aspect_ratio "adaptive" (adopts the
    // reference video's ratio — live-verified: 720×1280 ref → 496×864 out),
    // so this resolves without a probe round-trip; providers without a
    // native token would ffprobe + snap to the closest catalog ratio.
    const aspectRatio = await resolveSourceMatchedAspect(genModel, sourceUrl)

    await setJobProgress(job, ctx.jobId, 5)

    // Spike-validated generation inputs (2026-07-12): the @video_1 reference
    // is the source's last moments only (`recipe.tailSec` — a short tail keeps
    // the model continuing the boundary motion instead of re-staging the whole
    // clip, floored by KIE's r2v ≥1.8s reference-video minimum), measured from
    // the PICTURE's end (the sound may run past the last frame) — and the
    // source's LAST FRAME anchors the extension as its first frame (i2v
    // transport), so the continuation starts pixel-adjacent to the boundary
    // and the smart-stitch reliably finds+drops the duplicate.
    //
    // On 2.5, a source that is a previous 2.5 extension of ours, its raw mov
    // kept: the reference is that mov's last seconds instead
    // (`cutChainedMovTail`), in its own container, pixel format and PCM — the
    // tail cut here is re-encoded to 4:2:0, which throws away exactly the
    // colour fidelity `output_format: "mov"` was requested for. Nothing found
    // (a foreign source, a first extension, an mp4 chain) or a failed cut (the
    // source's clip already expired, say) falls back to the tail, the
    // transport that works today.
    //
    // The source's local copy is the stitch's source too, so the prep folder
    // stays until the stitch has read it, and is removed on every way out
    // (the `finally` below).
    const prepDir = await createWorkDir("extend-prep")
    // The raw copy below is named only in a COMPLETED job's output, which is
    // how expiry finds a job's files: a run that fails after it discards it
    // on the way out (`discardFailedRunCopies`), or it would stay in storage,
    // on the user's quota, for good.
    let rawCopyUrl: string | undefined
    try {
      const srcLocal = join(prepDir, "source.mp4")
      await downloadFile(sourceUrl, srcLocal)
      // A source whose picture is shorter than the provider floor
      // (`recipe.minSourceSec`, the floor the route refuses at) yields a tail
      // KIE will 400-reject after ~90s of queueing — fail fast with a clear
      // message.
      const srcProbe = await probeVideoSource(srcLocal)
      const pictureSec = srcProbe.videoDurationSeconds ?? srcProbe.durationSeconds
      if (pictureSec < recipe.minSourceSec) throw new Error(extendSourceTooShortMessage(provider, pictureSec))
      // An HDR or full-range source's tail, and so the last frame taken from
      // it below, goes through the stitch's own conversion
      // (`extendTailPicture`): the result shows the source in SDR, limited
      // range, so the model continues that picture and the seam matches. Any
      // other source's tail is cut as it always was, and so is a chained MOV
      // reference (Seedance's own SDR clip).
      const tailPicture = extendTailPicture(await probeMatched(srcLocal))
      const tailPath = await extractTailToFile(srcLocal, recipe.tailSec, { measureFrom: "picture", ...tailPicture })
      // Generation inputs only, never the deliverable: the tail, the frame and
      // a chained cut go to the job's scratch folder (`lib/job-scratch.ts`),
      // emptied when the job ends, and count against no one's quota.
      const tailUrl = await uploadJobScratchFile(tailPath, "extend-tail", "mp4", "video/mp4", ctx.jobId)
      // Last frame of the tail IS the source's last frame; the tail is
      // already on R2, so the frame-exact extractor can read it directly.
      const frame = await extractFrame({ videoUrl: tailUrl, mode: "last" })
      const lastFrameUrl = await uploadJobScratchFile(frame.imagePath, "extend-last-frame", "png", "image/png", ctx.jobId)
      await cleanupWorkDir(dirname(frame.imagePath))
      let chainTailUrl: string | undefined
      const chainedMovUrl = genModel === "seedance-2-5" ? await findChainedMovReference(sourceUrl, ctx.jobUserId) : undefined
      if (chainedMovUrl) {
        try {
          const cutPath = await cutChainedMovTail(chainedMovUrl, recipe.tailSec, prepDir)
          chainTailUrl = await uploadJobScratchFile(cutPath, "extend-chain-tail", "mov", "video/quicktime", ctx.jobId)
        } catch (err) {
          console.warn(`[worker] Job ${ctx.jobId}: chained mov cut failed, extending from the tail:`, err)
        }
      }
      await setJobProgress(job, ctx.jobId, 10)

      const kiePrompt = recipe.prompt(userPrompt)
      const referenceVideoUrl = chainTailUrl ?? tailUrl
      // `mp4` is KIE's default and is sent as no field at all, so the mp4
      // payload stays byte-identical to today.
      const outputFormat = genModel === "seedance-2-5" ? seedance25OutputFormat() : "mp4"

      const seedanceRamp = startProgressRamp(job, ctx.jobId, { start: 10, cap: 75 })
      let gen
      try {
        // NO onTaskCreated on purpose: the KIE task's result is the raw
        // extension clip, NOT the deliverable. Persisting it would let the
        // reconcile cron finalize this extend-video job with the unstitched
        // extension (silent wrong output). If the worker dies mid-wait,
        // BullMQ's stalled-job recovery re-runs the whole handler instead.
        gen = await imageToVideo(lastFrameUrl, genModel, kiePrompt, extSeconds, undefined, {
          // The resolution the run was priced at (`seedanceExtendResolution`,
          // the credit id's own reading): one the model offers, else 720p — a
          // job naming any other can never render above the row it reserved.
          resolution: seedanceExtendResolution(provider, resolution),
          generateAudio: generateAudio ?? true,
          // User references (route-assembled) ride alongside the tail; the
          // shared seedance resolver seats them as @image_1…N and appends the
          // last-frame anchor after them, so their prompt ordinals hold.
          ...(referenceImageUrls?.length ? { referenceImageUrls } : {}),
          referenceVideoUrls: [referenceVideoUrl],
          aspectRatio,
          ...(outputFormat === "mov" ? { outputFormat } : {}),
        })
      } finally {
        seedanceRamp.stop()
      }

      // A mov extension is worth keeping: it is the next extension's reference,
      // and KIE's own URL expires long before then. Stored as `<jobId>-raw`
      // (`rawExtensionObjectId`): in the job's own family, so the job's expiry
      // deletes it with the job (a later extend cuts what it sends from it
      // into its own scratch folder, above, before it generates) —
      // but never the job's bare key, which stays reserved for the stitched
      // deliverable (an object sitting there could be mistaken for the result).
      // No KIE task is persisted either way (see the onTaskCreated note above),
      // so the reconcile cron can never finalize this job with the raw extension.
      // A copy failure only breaks the chain (the next extend falls back to the
      // tail) — it must not fail a job whose deliverable is the stitch.
      let rawExtensionUrl = gen.url
      if (isMovUrl(gen.url)) {
        try {
          rawExtensionUrl = await uploadToR2(gen.url, rawExtensionObjectId(ctx.jobId), "video", ctx.jobUserId, { ext: "mov" })
          if (rawExtensionUrl !== gen.url) rawCopyUrl = rawExtensionUrl
        } catch (err) {
          console.warn(`[worker] Job ${ctx.jobId}: raw mov copy failed, chain not extended:`, err)
        }
      }

      // Smart-stitch (`stitchExtension`): the extension was generated FROM
      // the source's tail, so this is exactly the continuation case the smart
      // cut solves — PSNR-match the source's last frames against the
      // extension's first frames and cut at the closest pair (duplicate plays
      // once, motion continues). The fixed SEEDANCE_2_EXTEND_STITCH trims
      // remain the FALLBACK for boundaries where no genuine match is found
      // (or the search fails). Hard cut + a sound crossfade at the join; the
      // result has the source's size, frame rate and picture quality. It
      // reads the source's prep copy and the extension, downloaded into the
      // stitch's own folder, removed once the result is uploaded, on success
      // and failure. A stitch failure fails the job (full refund) — never
      // deliver the bare extension (or the bare source) as the result.
      const stitchDir = await createWorkDir("extend-stitch")
      let stitchedR2Url: string
      let stitchBoundary: ExtendStitchResult["boundary"]
      try {
        const extensionPath = join(stitchDir, isMovUrl(gen.url) ? "extension.mov" : "extension.mp4")
        await downloadFile(gen.url, extensionPath)
        const stitched = await stitchExtension({
          sourcePath: srcLocal,
          extensionPath,
          workDir: stitchDir,
          smartCut: { framesFromPrev: 8, framesFromNext: 8 },
          fallbackTrims: {
            trimEndFrames: SEEDANCE_2_EXTEND_STITCH.trimTailFrames,
            trimStartFrames: SEEDANCE_2_EXTEND_STITCH.trimHeadFrames,
          },
          audioFadeSec: SEEDANCE_2_EXTEND_STITCH.audioFadeSec,
        })
        stitchBoundary = stitched.boundary
        await setJobProgress(job, ctx.jobId, 85)

        stitchedR2Url = await watermarkLocalVideoAndUpload(
          stitched.outputPath,
          ctx.jobId,
          ctx.jobUserId,
          ctx.shouldWatermark,
        )
      } finally {
        await cleanupWorkDir(stitchDir)
      }
      await setJobProgress(job, ctx.jobId, 100)

      const stitchedThumbUrl = await generateAndUploadThumbnail(stitchedR2Url, ctx.jobId, ctx.jobUserId)
      const { ok: seedanceOk } = await finalizeJobWithMedia({
        jobId: ctx.jobId,
        jobType: "extend-video",
        result: {
          url: stitchedR2Url,
          cost: gen.cost ?? null,
          providerUsed: provider,
          // Same rebuilt-literal carry as lip-sync (:868) and video-upscale
          // (:1060), same reason: `gen` IS the RouteResult from the capability
          // router above, and on a keyless connected install the chain is
          // [nodaro] — both seedance-2 models are in the cloud provider's
          // image-to-video list. Dropping the pair here left jobs.relay_job_id /
          // relay_credits NULL for a generation the far end really reserved
          // credits for: a self-host settling on relay_credits billed it at zero,
          // and the row carried no provenance for support to follow.
          ...(gen.relayJobId && { relayJobId: gen.relayJobId, relayCredits: gen.relayCredits ?? null }),
        },
        mediaUrl: stitchedR2Url,
        extraOutputData: {
          thumbnailUrl: stitchedThumbUrl,
          // Raw (unstitched) extension clip — provenance/debug, AND the mov
          // the next extension in this chain cuts its reference from.
          rawExtensionUrl,
          // Where the stitch actually cut (smart-cut decision + PSNR), in the
          // shape combineVideos reported it: one boundary, its fields in its order.
          smartCuts: [{
            boundary: 0,
            prevClipEndTrimFrames: stitchBoundary.trimEndFrames,
            nextClipStartTrimFrames: stitchBoundary.trimStartFrames,
            psnrDb: stitchBoundary.psnrDb,
            matched: stitchBoundary.matched,
            searchedPrevFrames: stitchBoundary.searchedPrevFrames,
            searchedNextFrames: stitchBoundary.searchedNextFrames,
          }],
        },
      })
      if (seedanceOk) {
        console.log(
          `[worker] Job ${ctx.jobId} completed: ${stitchedR2Url} (provider: ${provider}, cost: $${gen.cost?.toFixed(6) ?? "N/A"})`,
        )
      }
      return
    } catch (err) {
      await discardFailedRunCopies(ctx.jobId, ctx.jobUserId, [rawCopyUrl])
      throw err
    } finally {
      await cleanupWorkDir(prepDir)
    }
  }

  const { kieTaskId, prompt, model, seeds, quality } = job.data as {
    jobId: string
    kieTaskId: string
    prompt: string
    provider: "veo-extend" | "runway-extend"
    model?: "fast" | "quality"
    seeds?: number
    quality?: "720p" | "1080p"
  }
  console.log(`[worker] extend-video ${ctx.jobId} (provider: ${provider})`)

  // Both extend providers run a long KIE task — wrap in a ramp so the
  // widget bar moves while we wait.
  const extendKind: ProviderKind = provider === "veo-extend" ? "kie-veo" : "kie-runway"
  const extendOnTaskCreated = makeOnTaskCreated(ctx.jobId, extendKind)
  const extendResult = await withProgressRamp(
    job,
    ctx.jobId,
    { start: 5, cap: 45 },
    async (): Promise<{ url: string; taskId: string | undefined }> => {
      if (provider === "veo-extend") {
        const { resultJson, taskId } = await runVeoExtendTask(kieTaskId, prompt, model, seeds, { onTaskCreated: extendOnTaskCreated })
        const url = resultJson.resultUrls?.[0]
        if (!url) throw new Error("VEO extend succeeded but no URL found")
        return { url, taskId }
      } else {
        const { resultJson, taskId } = await runRunwayExtendTask(kieTaskId, prompt, quality ?? "720p", { onTaskCreated: extendOnTaskCreated })
        const url = resultJson.resultUrls?.[0] ?? resultJson.videoUrl
        if (!url) throw new Error("Runway extend succeeded but no URL found")
        return { url, taskId }
      }
    },
  )
  const videoUrl: string = extendResult.url
  const newTaskId: string | undefined = extendResult.taskId
  await setJobProgress(job, ctx.jobId, 50)

  const r2Url = await uploadVideoMaybeWatermark(videoUrl, ctx.jobId, ctx.jobUserId, ctx.shouldWatermark)
  await setJobProgress(job, ctx.jobId, 100)

  const thumbUrl = await generateAndUploadThumbnail(r2Url, ctx.jobId, ctx.jobUserId)

  const { ok } = await finalizeJobWithMedia({
    jobId: ctx.jobId,
    jobType: "extend-video",
    result: { url: videoUrl, cost: null, providerUsed: provider },
    mediaUrl: r2Url,
    extraOutputData: {
      thumbnailUrl: thumbUrl,
      ...(newTaskId && { kieTaskId: newTaskId }),
    },
  })
  if (!ok) return
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url} (provider: ${provider})`)
}

const handleVideoRetake: HandlerFn = async function handleVideoRetake(job, ctx) {
  const d = job.data as Record<string, unknown>
  console.log(`[worker] video-retake ${ctx.jobId} (provider: ${VIDEO_RETAKE_MODEL})`)
  // Best-effort progress nudge so the widget bar moves while the long
  // Replicate wait blocks. The 20-min reconcile cron is the safety net
  // if this worker dies mid-wait — the prediction id is persisted by
  // makeOnTaskCreated before we begin waiting.
  await setJobProgress(job, ctx.jobId, 5)
  const ramp = startProgressRamp(job, ctx.jobId, { start: 5, cap: 85 })
  let result
  try {
    result = await runLtxRetake({
      variant: VIDEO_RETAKE_MODEL,
      video: d.video as string,
      prompt: (d.prompt as string | undefined) ?? "",
      retakeStartTime: d.retake_start_time as number,
      // The seconds the run was priced for (at least 2) — the route and the
      // workflow run send this same reading.
      retakeDuration: ltxRetakeDurationSec(d.retake_duration),
      retakeMode: d.retake_mode as "replace_audio" | "replace_video" | "replace_audio_and_video",
      resolution: "1080p",
      aspectRatio: (d.aspect_ratio as "16:9" | "9:16" | undefined) ?? "16:9",
      fps: (d.fps as 24 | 25 | 48 | 50 | undefined) ?? 25,
      generateAudio: (d.generate_audio as boolean | undefined) ?? true,
      cameraMotion: (d.camera_motion as
        | "dolly_in" | "dolly_out" | "dolly_left" | "dolly_right"
        | "jib_up" | "jib_down" | "static" | "focus_shift" | "none"
        | undefined) ?? "none",
      reconcileOpts: {
        onTaskCreated: makeOnTaskCreated(ctx.jobId, providerKindForVideoModel("ltx-2.3-pro")),
      },
    })
  } finally {
    ramp.stop()
  }

  const r2Url = await uploadVideoMaybeWatermark(
    result.videoUrl,
    ctx.jobId,
    ctx.jobUserId,
    ctx.shouldWatermark,
  )
  await setJobProgress(job, ctx.jobId, 100)
  const thumbUrl = await generateAndUploadThumbnail(r2Url, ctx.jobId, ctx.jobUserId)
  const { ok } = await finalizeJobWithMedia({
    jobId: ctx.jobId,
    jobType: "video-retake",
    result: {
      url: result.videoUrl,
      cost: result.cost,
      providerUsed: "ltx-2.3-pro",
    },
    mediaUrl: r2Url,
    extraOutputData: { thumbnailUrl: thumbUrl },
  })
  if (ok) {
    console.log(
      `[worker] Job ${ctx.jobId} completed: ${r2Url} (provider: ltx-2.3-pro, cost: $${result.cost?.toFixed(6) ?? "N/A"})`,
    )
  }
}

const handleFaceSwap: HandlerFn = async function handleFaceSwap(job, ctx) {
  const { faceImageUrl, videoUrl } = job.data as {
    jobId: string
    faceImageUrl?: string
    videoUrl?: string
  }
  // A missing input fails the same way on every attempt: refuse it now (the
  // worker fails and refunds on this attempt) with a message the user can act
  // on, instead of letting the provider crash on `undefined` three times.
  if (!faceImageUrl?.trim()) {
    throw new DeterministicJobError("Face Swap needs a face image: connect one to its Face input.")
  }
  if (!videoUrl?.trim()) {
    throw new DeterministicJobError("Face Swap needs a video: connect one to its Video input.")
  }
  console.log(`[worker] face-swap ${ctx.jobId}`)

  const faceSwapOnTaskCreated = makeOnTaskCreated(ctx.jobId, "replicate-prediction")
  const outputUrl = await withProgressRamp(job, ctx.jobId, { start: 5, cap: 45 }, async () => {
    const { videoUrl: out } = await replicateFaceSwap(faceImageUrl, videoUrl, { onTaskCreated: faceSwapOnTaskCreated })
    return out
  })
  await setJobProgress(job, ctx.jobId, 50)

  // The swap comes back without sound: put the source clip's audio back on it.
  const r2Url = await uploadSwapWithSourceAudio(outputUrl, videoUrl, ctx)
  await setJobProgress(job, ctx.jobId, 100)

  const thumbUrl = await generateAndUploadThumbnail(r2Url, ctx.jobId, ctx.jobUserId)

  const { ok } = await finalizeJobWithMedia({
    jobId: ctx.jobId,
    jobType: "video-to-video",
    result: { url: outputUrl, cost: null, providerUsed: "roop" },
    mediaUrl: r2Url,
    extraOutputData: { thumbnailUrl: thumbUrl },
  })
  if (!ok) return
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url}`)
}

const handleGenerateMask: HandlerFn = async function handleGenerateMask(job, ctx) {
  const { imageUrl, prompt, threshold } = job.data as {
    jobId: string
    imageUrl: string
    prompt: string
    threshold?: number
  }
  console.log(`[worker] generate-mask ${ctx.jobId}: "${prompt}" (threshold: ${threshold ?? 0.3})`)

  // Grounded SAM doesn't expose live progress — wrap in a ramp so the widget
  // bar moves while the segmentation runs.
  const maskOnTaskCreated = makeOnTaskCreated(ctx.jobId, "replicate-prediction")
  const maskOutputUrl = await withProgressRamp(job, ctx.jobId, { start: 5, cap: 80 }, () =>
    runGroundedSam(imageUrl, prompt, threshold ?? 0.3, config.REPLICATE_API_TOKEN, { onTaskCreated: maskOnTaskCreated }),
  )
  await setJobProgress(job, ctx.jobId, 85)

  // Upload the mask PNG to R2. Masks are intermediate artifacts (consumed by a
  // downstream inpainting node), not gallery content — never watermark them or
  // a watermark overlay would corrupt the binary mask.
  // POST-PROVIDER: `maskOutputUrl` is the delivered grounded-sam result — an R2
  // upload failure here is post-delivery, so skip the refund.
  const maskUrl = await runPostProcessing(() => uploadToR2(maskOutputUrl, ctx.jobId, "image", ctx.jobUserId))
  await setJobProgress(job, ctx.jobId, 100)

  // generate-mask outputs a {imageUrl, maskUrl} pair, not the standard single
  // imageUrl. Use markJobCompleted directly here rather than finalize — the
  // dispatch by jobType in finalize would mis-shape the output_data for masks.
  const ok = await markJobCompleted(ctx.jobId, {
    output_data: { imageUrl, maskUrl },
    provider: "grounded-sam",
    provider_cost: null,
  })
  if (!ok) return

  await commitJobCredits(ctx.usageLogId, ctx.jobId)
  console.log(`[worker] Job ${ctx.jobId} completed: mask=${maskUrl}`)
}

// ── Voiced video (character-voice orchestration) ─────────────────────────────
// One job, one combined reservation. Two modes, chosen by the model's audio
// capability (the route already gated this via videoModelCanSpeakDialogue):
//   audio_driven (Seedance 2) -> synthesise the dialogue track (direct ElevenLabs
//     TTS for a single voice; direct dialogue on the cast's dialogue model for
//     multi-speaker, any voice mix), feed it as reference audio, model lip-syncs.
//   native_speech (VEO)       -> bake the line during generation, then revoice the
//     baked audio to the primary character voice (keeps the music/SFX bed).
// The voice chain NEVER hard-fails the clip: a synth / revoice failure degrades to
// a plain silent clip + a `voiceWarning`, and the audio addon auto-refunds. If no
// voice resolves for the mode the clip still generates and the audio addon
// auto-refunds (finalize commits at the video provider cost only). No provider
// call is registered for reconcile: a worker crash re-runs the whole chain on
// BullMQ retry (credits reserve-once / commit-once; only the provider spend
// repeats), with the 30-min pre-task sync-sweep as the fail+refund backstop. A
// distinct job NAME ("voiced-video") drives handler dispatch; the row keeps
// job_type via the worker CAS, but finalize/asset both key off the passed
// jobType + output_data, so the deliverable is always handled as a video.

// Which lines are voiced, and the total-text cap that trims them (the chosen
// dialogue model's capability sheet), come from `planVoicedDialogue`
// (lib/voiced-dialogue-lines.ts) — the SAME reading the generate-video route
// priced the audio add-on from, never a worker-local copy (a hand-kept cap
// literal here once drifted from the route's). The model is the one the route
// forwarded (`dialogueProvider`), passed back in as given; an unset or unknown
// one reads as v3 dialogue.

/** Revoice a generated clip to `voiceId` (extract -> speech-to-speech -> remux), keeping the bed. */
async function revoiceClipToR2(
  job: Parameters<HandlerFn>[0],
  ctx: Parameters<HandlerFn>[1],
  videoUrl: string,
  voiceId: string,
): Promise<string> {
  const { audioPath, workDir } = await extractAudioTrack(videoUrl)
  let revoicedR2: string
  try {
    const src = await readFile(audioPath)
    const revoiced = await withProgressRamp(job, ctx.jobId, { start: 55, cap: 80 },
      () => directVoiceChanger(src, voiceId, { removeBackgroundNoise: false }))
    // POST-PROVIDER: speech-to-speech already delivered (billed) — skip refund on R2 fail.
    revoicedR2 = await runPostProcessing(() => uploadBufferToR2(revoiced, mediaObjectKey(ctx.jobId, "audio", "mp3"), "audio/mpeg", ctx.jobUserId))
  } finally {
    await cleanupWorkDir(workDir)
  }
  const mergedPath = await mergeVideoAudio({
    videoUrl,
    audioTracks: [{ url: revoicedR2, startTime: 0, volume: 100, sourceType: "audio" }],
    keepOriginalAudio: false,
  })
  const out = await watermarkLocalVideoAndUpload(mergedPath, `${ctx.jobId}-revoiced`, ctx.jobUserId, ctx.shouldWatermark)
  await cleanupWorkDir(dirname(mergedPath))
  return out
}

/**
 * Mux a ready voice track into a (silent) generated clip, replacing any model
 * audio, then watermark+upload. Used by the audio_driven path: Seedance 2 with
 * `generate_audio:false` outputs a SILENT video (the reference audio only drove
 * lip MOTION), so the synthesised voice must be muxed back in — otherwise
 * `voiceApplied:true` ships a silent clip. Mirrors `revoiceClipToR2`'s tail.
 */
async function mergeVoiceTrackToR2(
  ctx: Parameters<HandlerFn>[1],
  videoUrl: string,
  audioUrl: string,
): Promise<string> {
  const mergedPath = await mergeVideoAudio(draftAudioMuxMergeArgs(videoUrl, voiceTrackMuxRecipe(audioUrl)))
  const out = await watermarkLocalVideoAndUpload(mergedPath, ctx.jobId, ctx.jobUserId, ctx.shouldWatermark)
  await cleanupWorkDir(dirname(mergedPath))
  return out
}

/**
 * Synthesise the resolved dialogue into ONE reference-audio track (R2 URL) for the
 * audio_driven (Seedance) path. Genuine multi-speaker goes through the direct
 * ElevenLabs dialogue API in ONE call, on the cast's dialogue model — the one the
 * route chose and reserved (`dialogueProvider`: v3 dialogue unless every voice
 * names a speech model with one shared dialogue twin; a job enqueued before the
 * model travelled with it runs v3 dialogue). Per-line voice resolution means ANY
 * voice mix works (premade names, library UUIDs, clones); the old KIE proxy's
 * premade-names-only limit (and its degrade-to-primary-voice fallback) is gone
 * with the proxy itself. A single voice stays on direct TTS: it honours the
 * voice's own `ttsProvider` (turbo/multilingual/v3/v4).
 */
async function synthesizeDialogueTrack(
  ctx: Parameters<HandlerFn>[1],
  resolved: ResolvedDialogueVoiceLine[],
  voices: readonly CharacterVoiceSpec[],
  languageCode: string | undefined,
  dialogueProvider: string | undefined,
): Promise<string> {
  const distinctVoices = new Set(resolved.map((r) => r.voice))
  if (distinctVoices.size > 1) {
    // Genuine multi-speaker, any voice mix → direct dialogue (one call) on the
    // model the route reserved; `dialogueProviderOf` is the funnel's own
    // default rule, spelled here so the egress key and the bill agree.
    // Audio only: the per-shot split by the model's timings is its own later
    // design (spec phase 4); the transcript is not read here.
    const { audio: buf } = await directElevenLabsDialogue(
      resolved.map((r) => ({ text: r.text, voice: r.voice })),
      { provider: dialogueProviderOf(dialogueProvider), ...(languageCode ? { languageCode } : {}) },
    )
    return runPostProcessing(() =>
      uploadBufferToR2(buf, mediaObjectKey(ctx.jobId, "audio", "mp3"), "audio/mpeg", ctx.jobUserId),
    )
  }
  // Single voice → direct ElevenLabs TTS (supports library/custom by id;
  // premade names resolve too). Honour the voice's ttsProvider.
  const ttsProvider = voices[0]?.ttsProvider
  const joined = resolved.map((r) => r.text).join(" ")
  const processed = ttsSupportsAudioTags(ttsProvider) ? joined : stripAudioTags(joined)
  const buf = await directElevenLabsTTS(processed, resolved[0]!.voice, ttsProvider, {
    allowDefaultVoiceFallback: true,
  })
  return runPostProcessing(() =>
    uploadBufferToR2(buf, mediaObjectKey(ctx.jobId, "audio", "mp3"), "audio/mpeg", ctx.jobUserId),
  )
}

const handleVoicedVideo: HandlerFn = async function handleVoicedVideo(job, ctx) {
  const d = job.data as {
    jobId: string
    imageUrl?: string
    prompt?: string
    provider?: string
    duration?: number
    resolution?: string
    aspectRatio?: string
    seed?: number
    negativePrompt?: string
    sound?: boolean
    generateAudio?: boolean
    referenceImageUrls?: string[]
    /** Wired reference videos / audio ride along exactly as on an unvoiced
     *  run (#1396); on an audio_driven model the synthesised dialogue track
     *  takes the audio-reference slot. */
    referenceVideoUrls?: string[]
    referenceAudioUrls?: string[]
    /** The reservation's ffprobe of `referenceVideoUrls` — the settlement
     *  prices the input side from it (see the image-to-video handler). */
    refVideoDurationsSec?: Array<number | null>
    /** Seedance Draft — see the image-to-video payload above. */
    draft?: boolean
    /** See the image-to-video payload above: Seedance 2.5 is audio_driven, so
     *  a voiced run can carry reference videos and a declared task type. */
    referenceTaskType?: DeclaredSeedanceTaskType
    languageCode?: string
    characterVoices?: CharacterVoiceSpec[]
    dialogue?: DialogueLine[]
    voicedAudioAddon?: number
    /** The dialogue model the route reserved for a multi-speaker track (`DIALOGUE_PROVIDERS`); absent on jobs enqueued before it travelled → v3 dialogue. */
    dialogueProvider?: string
  }
  const provider = d.provider ?? VOICED_VIDEO_DEFAULT_PROVIDER
  const audioAddon = d.voicedAudioAddon ?? 0
  // Every provider call below carries it, like `draft`; absent = no key.
  const taskTypeOption = d.referenceTaskType ? { referenceTaskType: d.referenceTaskType } : {}
  const mode = getVideoAudioCapability(provider).mode

  const dialogueModel = dialogueProviderOf(d.dialogueProvider)
  // B4c: the voice lock's backstop, before anything is generated: every voice
  // this run will speak in (`voicesTheVoicedVideoSends`, the same reading the
  // route judged), as the job's user. Here and not inside the voice chain,
  // whose failures degrade to a silent or baked clip after the video is paid
  // for: a refusal fails the job instead, finally (failed and refunded on this
  // attempt). No lock: nothing is read.
  await assertVoicesAllowed(voicesTheVoicedVideoSends({ ...d, dialogueProvider: dialogueModel }, provider), { userId: ctx.jobUserId })
  const plan = planVoicedDialogue({ ...d, dialogueProvider: dialogueModel })
  const voices = d.characterVoices ?? []
  const primaryVoiceId = voices[0]?.voiceId
  const resolved = plan.lines
  if (plan.dropped > 0) {
    console.warn(`[worker] voiced-video ${ctx.jobId}: dropped ${plan.dropped} dialogue line(s) over the ${getDialogueCapabilities(dialogueModel).maxChars}-char dialogue cap`)
  }

  console.log(`[worker] voiced-video ${ctx.jobId} (provider: ${provider}, mode: ${mode}, lines: ${resolved.length})`)
  await setJobProgress(job, ctx.jobId, 5)

  let result: Awaited<ReturnType<typeof imageToVideo>> | undefined
  let finalUrl: string | undefined
  let voiceApplied = false
  let voiceWarning: string | undefined
  // The voice track muxed onto an audio-driven clip — a draft records it so
  // its 1080p finalize re-applies the same mux.
  let voiceTrackMux: DraftAudioMux | undefined

  if (mode === "audio_driven" && resolved.length > 0) {
    // Synthesise the dialogue track (voiceType-aware) -> reference audio -> lip-sync.
    // Any failure in this chain degrades to a plain silent clip below rather than
    // hard-failing the job (the Studio-reported contract violation).
    try {
      const trackUrl = await withProgressRamp(job, ctx.jobId, { start: 5, cap: 30 },
        () => synthesizeDialogueTrack(ctx, resolved, voices, d.languageCode, d.dialogueProvider))
      result = await withProgressRamp(job, ctx.jobId, { start: 30, cap: 85 },
        () => imageToVideo(d.imageUrl, provider, d.prompt, d.duration, undefined,
          { referenceAudioUrls: [trackUrl], generateAudio: false, draft: d.draft, ...taskTypeOption, resolution: d.resolution, aspectRatio: d.aspectRatio, seed: d.seed, negativePrompt: d.negativePrompt, referenceImageUrls: d.referenceImageUrls, referenceVideoUrls: d.referenceVideoUrls }))
      // Seedance 2 ran with generate_audio:false → the clip is SILENT; the
      // reference audio only drove lip motion. Mux the SAME synthesised track in
      // so the delivered video actually carries the voice (a bare upload of
      // result.url shipped a silent clip with voiceApplied:true). Inside the try
      // so a mux failure still degrades to the plain-clip fallback below.
      const genUrl = result.url
      finalUrl = await withProgressRamp(job, ctx.jobId, { start: 85, cap: 95 },
        () => mergeVoiceTrackToR2(ctx, genUrl, trackUrl))
      voiceApplied = true
      voiceTrackMux = voiceTrackMuxRecipe(trackUrl)
    } catch (err) {
      console.warn(`[worker] voiced-video ${ctx.jobId}: audio_driven voice chain failed — falling back to a silent clip: ${err instanceof Error ? err.message : String(err)}`)
      voiceWarning = "voice_chain_failed"
      result = undefined
      finalUrl = undefined
    }
  } else if (mode === "native_speech" && primaryVoiceId) {
    // Bake the line during generation (VEO speaks + lip-syncs), then revoice it.
    // If ONLY the revoice fails, keep the baked clip (it spoke, just not in the
    // exact saved voice) rather than discarding a paid-for generation.
    const spoken = resolved.map((r) => r.text).join(" ").trim()
    const veoPrompt = spoken ? `${(d.prompt ?? "").trim()}\n\nSpoken dialogue: "${spoken}"`.trim() : (d.prompt ?? "")
    result = await withProgressRamp(job, ctx.jobId, { start: 5, cap: 55 },
      () => imageToVideo(d.imageUrl, provider, veoPrompt, d.duration, undefined,
        { generateAudio: true, draft: d.draft, ...taskTypeOption, resolution: d.resolution, aspectRatio: d.aspectRatio, seed: d.seed, negativePrompt: d.negativePrompt, referenceImageUrls: d.referenceImageUrls, referenceVideoUrls: d.referenceVideoUrls, referenceAudioUrls: d.referenceAudioUrls }))
    try {
      finalUrl = await revoiceClipToR2(job, ctx, result.url, primaryVoiceId)
      voiceApplied = true
    } catch (err) {
      console.warn(`[worker] voiced-video ${ctx.jobId}: revoice failed — keeping the model's baked audio: ${err instanceof Error ? err.message : String(err)}`)
      voiceWarning = "revoice_failed"
      finalUrl = await uploadVideoMaybeWatermark(result.url, ctx.jobId, ctx.jobUserId, ctx.shouldWatermark)
    }
  }

  if (!result || !finalUrl) {
    // No voice resolvable for this mode, OR the audio_driven voice chain failed
    // above -> plain silent clip. The reserved audio addon auto-refunds (finalize
    // commits at the video provider cost only, voiceApplied=false).
    if (!voiceWarning) {
      console.warn(`[worker] voiced-video ${ctx.jobId}: no voice resolved (mode=${mode}); generating without voice`)
    }
    result = await withProgressRamp(job, ctx.jobId, { start: 30, cap: 90 },
      () => imageToVideo(d.imageUrl, provider, d.prompt, d.duration, undefined,
        { generateAudio: d.generateAudio, sound: d.sound, draft: d.draft, ...taskTypeOption, resolution: d.resolution, aspectRatio: d.aspectRatio, seed: d.seed, negativePrompt: d.negativePrompt, referenceImageUrls: d.referenceImageUrls, referenceVideoUrls: d.referenceVideoUrls, referenceAudioUrls: d.referenceAudioUrls }))
    finalUrl = await uploadVideoMaybeWatermark(result.url, ctx.jobId, ctx.jobUserId, ctx.shouldWatermark)
    voiceApplied = false
  }

  // A Seedance reference-video run was reserved at its worst case (an edit
  // renders the source clip's length); settle to the RAW clip the provider
  // delivered — before the voice mux / revoice — exactly as the unvoiced
  // handlers do. `undefined` = not such a run, or unmeasurable → the
  // reservation is committed.
  const settle = await measureSeedance2Settle({
    provider,
    resolution: d.resolution,
    outputUrl: result.url,
    referenceVideoUrls: d.referenceVideoUrls,
    refVideoDurationsSec: d.refVideoDurationsSec,
    duration: d.duration,
    referenceTaskType: d.referenceTaskType,
    jobId: ctx.jobId,
  })
  const meteredBaseCredits = settle.baseCredits
  // That measurement is the stored video's length (the upload and its
  // watermark keep it) only when no voice was muxed onto it; otherwise
  // finalize measures the stored file, if the run records a length.
  const deliveredVideoSec = voiceApplied ? undefined : settle.deliveredSec
  // Seedance DRAFT: the raw take length (before the voice mux) the finalize bills.
  const draftRenderSec = await measureSeedanceDraftRenderSec({ draft: d.draft, provider, outputUrl: result.url })

  await setJobProgress(job, ctx.jobId, 95)
  const thumbUrl = await generateAndUploadThumbnail(finalUrl, ctx.jobId, ctx.jobUserId)
  await setJobProgress(job, ctx.jobId, 100)
  const { ok } = await finalizeJobWithMedia({
    jobId: ctx.jobId,
    jobType: "image-to-video",
    result,
    mediaUrl: finalUrl,
    // Charge the audio step only when it ran; otherwise finalize commits at the
    // video provider cost and the reserved addon is refunded automatically.
    extraNonProviderCredits: voiceApplied ? audioAddon : 0,
    meteredBaseCredits,
    ...(deliveredVideoSec !== undefined && { deliveredVideoSec }),
    extraOutputData: {
      thumbnailUrl: thumbUrl,
      voiceApplied,
      ...(voiceWarning ? { voiceWarning } : {}),
      ...buildProviderMeta(result),
      ...draftRenderOutputData(draftRenderSec),
      ...draftAudioMuxOutputData(d.draft, provider, voiceApplied ? voiceTrackMux : undefined),
    },
  })
  if (!ok) return
  console.log(`[worker] voiced-video ${ctx.jobId} completed (voiceApplied=${voiceApplied}${voiceWarning ? `, warning=${voiceWarning}` : ""}): ${finalUrl}`)
}

export const videoAIHandlers: Record<string, HandlerFn> = {
  "image-to-video": handleImageToVideo,
  "voiced-video": handleVoicedVideo,
  "video-to-video": handleVideoToVideo,
  "text-to-video": handleTextToVideo,
  "lip-sync": handleLipSync,
  "speech-to-video": handleSpeechToVideo,
  "motion-transfer": handleMotionTransfer,
  "video-upscale": handleVideoUpscale,
  "extend-video": handleExtendVideo,
  "video-retake": handleVideoRetake,
  "face-swap": handleFaceSwap,
  "generate-mask": handleGenerateMask,
  "ai-avatar": handleAiAvatar,
  "cinematic-avatar": handleCinematicAvatar,
  "switchx": handleBeebleSwitchX,
}
