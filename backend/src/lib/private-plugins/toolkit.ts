import { directVoiceChanger } from "../../providers/elevenlabs/voice-changer.js"
import { ReplicateAudioSeparationProvider } from "../../providers/replicate/audio-separation.js"
import { extractAudio } from "../../providers/video/extract-audio.js"
import {
  runFfmpeg,
  runFfmpegCapture,
  createWorkDir,
  cleanupWorkDir,
  downloadFile,
  probeVideoSource,
  runFfprobe,
  getVideoDuration,
  probeMediaDuration,
  needsTranscode,
  transcodeToBrowserSafe,
  needsContainerRemux,
  remuxToMp4,
} from "../../providers/video/ffmpeg-utils.js"
import { downloadYouTubeVideo, ytMetadataProbe, YtUrlNotAllowedError } from "../../providers/video/youtube-video.js"
import { trimVideo as trimVideoCore } from "../../providers/video/trim-video.js"
import { mixAudio } from "../../providers/video/mix-audio.js"
import { mergeVideoAudio } from "../../providers/video/merge-video-audio.js"
import { applyAudioFx } from "../../providers/video/audio-fx.js"
import { applyImageWatermark } from "../../utils/watermark.js"
import {
  uploadBufferToR2,
  uploadFileToR2,
  uploadToR2,
  uploadFileWithKeyToR2,
  r2Url,
  getR2ObjectSize,
  downloadR2ObjectToFile,
  readR2ObjectBuffer,
  deleteFromR2,
  r2KeyFromOurUrl,
  mediaObjectKey,
  copyRecastObject,
} from "../storage.js"
import { reserveStorageIfWithinLimit, refundStorage } from "../../utils/file-validation.js"
import { storeImportedImageBuffer } from "../media-import.js"
import { markProviderCallStart } from "../reconcile/persistence.js"
import { sendInternalError } from "../http-errors.js"
import { runPostProcessing } from "../post-processing-error.js"
import {
  markJobCompleted,
  setJobProgress,
  withProgressRamp,
  commitJobCredits,
  refundJobCredits,
  uploadVideoMaybeWatermark,
  requestJobStop,
} from "../../workers/shared.js"
import { supabase } from "../supabase.js"
import { config } from "../config.js"
import { redis } from "../queue.js"
import { checkIsAdmin } from "../admin-check.js"
import { videoQueue } from "../queue.js"
import { creditGuard, reserveCreditsForJob } from "../../middleware/credit-guard.js"
import { safeUrlSchema, YOUTUBE_HOSTS, hostnameMatchesAllowlist } from "../url-validator.js"
import { safeFetch } from "../safe-fetch.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../request-helpers.js"
import { extractMcpClient } from "../extract-mcp-client.js"
import { buildJobInputData } from "../job-input-data.js"
import { formatZodError } from "../zod-error.js"
import { insertWithIdempotencyKey } from "../idempotent-insert.js"
import { throwIfJobCancelled } from "../job-cancellation.js"
import { hasCredits, hasOrganizations } from "../config.js"
import { appBaseUrl } from "../deployment-urls.js"
import { getAppSettings } from "../app-settings.js"
import { KieVideoProvider } from "../../providers/kie/video.js"
import { videoUpscale, editImage, generateImage } from "../../providers/router.js"
import { assertExact2xAligned, fetchImageBuffer } from "./plate-gate.js"
import { pollKieTask, isUpstreamKieFailure } from "../../providers/kie/client.js"
import { sunoGenerate, sunoCreditType } from "../../providers/kie/suno-client.js"
import { combineVideos as combineVideosCore } from "../../providers/video/combine-videos.js"
import { extractTailToFile } from "../../providers/video/extract-tail.js"
import { llmCompleteStructured } from "../llm-client.js"
import type { LlmReasoningEffort } from "@nodaro/shared"
import type { ProviderOptions, ReconcileOpts } from "../../providers/provider.interface.js"
import { randomUUID } from "node:crypto"
import { dirname, join } from "node:path"
import { promises as fs } from "node:fs"
import type { ZodType } from "zod"
import type { PluginToolkit, PluginLlmRequest, PluginLlmMultimodalRequest, PluginVideoGenOptions, PluginVideoGenResult, PluginImageGenOptions, PluginImageGenResult, PluginMusicGenOptions, PluginMusicGenResult, PipelineSnapshot } from "./types.js"

/**
 * Assembles the real `PluginToolkit` dependency-injection surface handed to
 * every private plugin (`@nodaroai/cloud-plugins`, loaded by `load.ts`).
 *
 * Every member below is a direct reference (or a thin wrap) to this app's own
 * CORE modules — no plugin ever imports an app path directly; it only ever
 * sees the shape declared in `./types.js`. This file is itself core
 * (`backend/src/lib/private-plugins/`) and must never statically import from
 * `ee/` (enforced by `tools/check-ee-imports.mjs`) — `creditGuard`/
 * `reserveCreditsForJob` come from the core `middleware/credit-guard.ts`
 * shim, which only reaches `ee/` via a runtime-gated dynamic `import()`, not
 * a static one; `http.computeGenerateVideoProPricing` below does the same
 * (mirrors `middleware/credit-guard.ts` and `load.ts`'s
 * `applyStaticCreditCosts`/`applyPipelinePrompts`).
 *
 * See `.superpowers/sdd/task-9-report.md` for the Task 9 member -> source
 * traceability table, and `.superpowers/sdd/task-8-report.md` for the Task 8
 * additions (generate-video-pro: `providers.textToVideo`/`imageToVideo`/
 * `getVideoTaskStatus`, `ffmpeg.combineVideos`/`extractTail`,
 * `media.uploadVideoMaybeWatermark`, `storage.uploadVideoFromUrl`,
 * `jobs.clearReconcileSentinel`/`throwIfJobCancelled`/`updateJobCheckpoint`/
 * `readJobCheckpoint`, `http.insertJobWithIdempotencyKey`/
 * `computeGenerateVideoProPricing`, and the whole `llm` group).
 */

/**
 * Adapts `PluginVideoGenOptions`/`PluginImageGenOptions`' `onTaskCreated`
 * (return type `void | Promise<void>`, per the contract) into
 * `ReconcileOpts.onTaskCreated` (return type strictly `Promise<void>`, per
 * `provider.interface.ts`) — the two aren't directly assignable, since a
 * callback that might return plain `void` doesn't satisfy a slot the KIE
 * client always awaits as a promise. Returns `undefined` (omitting
 * `reconcileOpts` entirely) when there's no callback — never wires
 * `makeOnTaskCreated` (spec §6: `provider_task_id` is never written by this
 * path; only the plugin's own checkpoint is).
 */
function toReconcileOpts(
  options: { onTaskCreated?: (taskId: string) => void | Promise<void> } | undefined,
): ReconcileOpts | undefined {
  const onTaskCreated = options?.onTaskCreated
  if (!onTaskCreated) return undefined
  return {
    onTaskCreated: async (taskId: string) => {
      await onTaskCreated(taskId)
    },
  }
}

/**
 * Picks/renames `PluginVideoGenOptions`'s fields onto the real
 * `ProviderOptions` shape `KieVideoProvider` expects. `aspectRatio` is only
 * set when the caller passes one explicitly — `textToVideo` has its own
 * positional `aspectRatio` param and never needs it here; `imageToVideo` has
 * no positional slot and reads it exclusively via `options.aspectRatio` (the
 * KIE i2v generic path otherwise infers aspect ratio from the input image).
 */
function toProviderOptions(options: PluginVideoGenOptions | undefined, aspectRatio?: string): ProviderOptions {
  return {
    resolution: options?.resolution,
    generateAudio: options?.generateAudio,
    referenceImageUrls: options?.referenceImageUrls,
    referenceVideoUrls: options?.referenceVideoUrls,
    referenceAudioUrls: options?.referenceAudioUrls,
    ...(aspectRatio !== undefined ? { aspectRatio } : {}),
  }
}

/** `tk.providers.textToVideo` — wraps `KieVideoProvider#textToVideo` (`providers/kie/video.ts:1059`). */
async function pluginTextToVideo(
  prompt: string,
  model: string,
  durationSec: number,
  aspectRatio: string,
  options?: PluginVideoGenOptions,
): Promise<PluginVideoGenResult> {
  const result = await new KieVideoProvider().textToVideo(
    prompt,
    model,
    durationSec,
    aspectRatio,
    toProviderOptions(options),
    toReconcileOpts(options),
  )
  return { url: result.url, taskId: result.kieTaskId }
}

/** `tk.providers.imageToVideo` — wraps `KieVideoProvider#imageToVideo` (`providers/kie/video.ts`). */
async function pluginImageToVideo(
  imageUrl: string,
  prompt: string,
  model: string,
  durationSec: number,
  aspectRatio: string,
  options?: PluginVideoGenOptions,
): Promise<PluginVideoGenResult> {
  const result = await new KieVideoProvider().imageToVideo(
    imageUrl,
    prompt,
    model,
    durationSec,
    // The FINAL segment of a generate-video-pro run may carry the user's
    // closing frame (plugin contract PluginVideoGenOptions.endFrameUrl) —
    // positional here, where the Seedance-2 input resolver turns it into the
    // closing-frame reference hint. Undefined for every other segment.
    options?.endFrameUrl,
    toProviderOptions(options, aspectRatio),
    toReconcileOpts(options),
  )
  return { url: result.url, taskId: result.kieTaskId }
}

/**
 * `tk.providers.generateImage` — wraps `generateImage` (`providers/router.ts`)
 * for the gvp keyframes anchor lever (ADDITIVE 2026-08-03). Option fields map
 * onto the router's snake_case `extraParams` exactly like
 * `workers/handlers/image-ai.ts`'s composition (unset fields omitted; an
 * empty bag passed as `undefined`). Cost fields stay app-internal; the
 * provider task id rides back as `taskId` (`RouteResult.kieTaskId` — image-
 * lane providers don't populate it today, so engines checkpoint via
 * `onTaskCreated`).
 */
async function pluginGenerateImage(
  prompt: string,
  model: string,
  options?: PluginImageGenOptions,
): Promise<PluginImageGenResult> {
  const { aspectRatio, resolution, negativePrompt } = options ?? {}
  const extraParams: Record<string, unknown> = {
    ...(aspectRatio && { aspect_ratio: aspectRatio }),
    ...(resolution && { resolution }),
    ...(negativePrompt && { negative_prompt: negativePrompt }),
  }
  const result = await generateImage(
    prompt,
    model,
    options?.referenceImageUrls,
    Object.keys(extraParams).length > 0 ? extraParams : undefined,
    toReconcileOpts(options),
  )
  return { url: result.url, taskId: result.kieTaskId }
}

/** Suno's documented ceilings for the model this wrapper pins (V5_5, custom
 *  mode): style 1000, title 80, lyrics/prompt 5000, duration 10–360s
 *  (docs.kie.ai/suno-api/generate-music). Trimmed rather than rejected — the
 *  caller is a render pipeline mid-flight, and a track trimmed by a character
 *  beats a run that dies on a validation error. */
const SUNO_CUSTOM_STYLE_MAX = 1000
const SUNO_CUSTOM_TITLE_MAX = 80
const SUNO_CUSTOM_LYRICS_MAX = 5000
const SUNO_DURATION_MIN = 10
const SUNO_DURATION_MAX = 360

/**
 * `tk.providers.generateMusic` — wraps `sunoGenerate`
 * (`providers/kie/suno-client.ts`) reduced to ONE track for the gvp
 * keyframes music lane (ADDITIVE 2026-08-04). Instrumental defaults ON
 * (voices live in the video; the score is post-muxed under them). Suno
 * returns up to two takes — the first track wins; an empty result throws so
 * the caller's non-fatal music guard can degrade to a silent mux rather than
 * shipping a broken URL.
 *
 * TWO MODES (custom added 2026-08-19). Without a `title` this is the original
 * DESCRIPTION mode: `prompt` is a brief, the model invents the song, and the
 * provider ignores `duration`. With a `title` AND `style` it is CUSTOM mode,
 * where `prompt` is the EXACT LYRICS, `style` is the musical description, and
 * `duration` is honoured (V5_5 only, per the send-gate in sunoGenerate).
 *
 * WHY IT MATTERS: description mode with `instrumental: false` makes Suno
 * invent lyrics ABOUT the brief — a scat-ensemble recast briefed with
 * "singers swaying and tapping feet" came back singing "step-step sway on
 * through … feet go tap" in English. Non-lexical vocals (scat, vocables) can
 * only be reproduced by handing the syllables over as lyrics.
 *
 * A title WITHOUT a style stays in description mode: custom mode requires
 * both, and sending a request the provider will refuse would turn a
 * best-effort score into a failed one.
 */
async function pluginGenerateMusic(
  prompt: string,
  options?: PluginMusicGenOptions,
): Promise<PluginMusicGenResult> {
  const style = options?.style?.trim()
  const title = options?.title?.trim()
  const custom = !!(title && style)
  const duration = options?.durationSec
  const result = await sunoGenerate(
    {
      prompt: custom ? prompt.slice(0, SUNO_CUSTOM_LYRICS_MAX) : prompt,
      model: "V5_5",
      customMode: custom,
      instrumental: options?.instrumental !== false,
      ...(style ? { style: custom ? style.slice(0, SUNO_CUSTOM_STYLE_MAX) : style } : {}),
      ...(custom && title ? { title: title.slice(0, SUNO_CUSTOM_TITLE_MAX) } : {}),
      ...(custom && typeof duration === "number" && Number.isFinite(duration)
        ? { duration: Math.min(SUNO_DURATION_MAX, Math.max(SUNO_DURATION_MIN, Math.round(duration))) }
        : {}),
    },
    // Thread OUR Nodaro key so the egress seam attributes this billed create
    // (model is pinned V5_5 → "suno-v5_5"); spread keeps any onTaskCreated.
    { ...toReconcileOpts(options), modelKey: sunoCreditType("V5_5", "suno-generate") },
  )
  const track = result.tracks[0]
  if (!track?.audioUrl) {
    throw new Error("music generation returned no track")
  }
  return {
    url: track.audioUrl,
    ...(typeof track.duration === "number" && Number.isFinite(track.duration) ? { durationSec: track.duration } : {}),
    taskId: result.taskId,
  }
}

/**
 * `tk.providers.getVideoTaskStatus` — wraps the single-shot KIE record-info
 * poll the reconcile cron uses: `pollKieTask(taskId, 1)`
 * (`providers/kie/client.ts`), the same call `lib/reconcile/kie.ts`'s
 * `singlePoll` makes for `provider_kind: "kie-standard"` rows. A `KieError`
 * with `isUpstreamFailure` set (`isUpstreamKieFailure`, same module) maps to
 * `"failed"`; any other rejection (still generating, network blip, or the
 * single-attempt timeout) maps to `"processing"`.
 *
 * `contentPolicy` rides the failed state when the KieError carries the flag
 * (same stamp `isContentPolicyError` duck-types on live throws) — the gvp
 * chain's resume then rewrites the checkpointed prompt before its one
 * remaining attempt instead of resubmitting the identical bytes the
 * deterministic screen just rejected (2026-08-16, run 499deba8: a deploy
 * restart mid-segment turned a rewritable rejection into a doomed identical
 * resubmit). Emitted only when true — plugins predating the field see the
 * exact wire shape they always did.
 */
async function getVideoTaskStatus(
  taskId: string,
): Promise<{ state: "processing" | "succeeded" | "failed"; videoUrl?: string; contentPolicy?: boolean }> {
  try {
    const { resultJson } = await pollKieTask(taskId, 1)
    const videoUrl = resultJson.resultUrls?.[0] ?? resultJson.videoUrl
    return { state: "succeeded", videoUrl }
  } catch (err) {
    if (isUpstreamKieFailure(err)) {
      const contentPolicy = !!err && typeof err === "object" && (err as { contentPolicy?: unknown }).contentPolicy === true
      return contentPolicy ? { state: "failed", contentPolicy: true } : { state: "failed" }
    }
    return { state: "processing" }
  }
}

/**
 * `tk.ffmpeg.combineVideos` — wraps core `combineVideos`
 * (`providers/video/combine-videos.ts:183`), which returns a LOCAL path
 * inside its own temp dir, and adapts it to the contract's always-an-R2-URL
 * member. Defaults mirror the route's Zod schema (`routes/combine-videos.ts`)
 * for the fields the contract leaves optional. No `jobId` reaches this
 * member (see the `types.ts` doc comment) — the upload key is minted here.
 */
async function combineVideosToUrl(options: {
  videoUrls: string[]
  transition: string
  transitionDuration?: number
  audioMode?: "keep" | "crossfade" | "remove"
  audioCrossfadeCurve?: string
  trimStartFrames?: number
  trimEndFrames?: number
  targetWidth?: number
  targetHeight?: number
  smartCut?: { enabled: boolean; framesFromPrev: number; framesFromNext: number; boundaryMask?: readonly boolean[]; mode?: "best-pair" | "preroll-keep-prev" | "preroll-keep-next" }
}): Promise<string> {
  const { outputPath: localPath } = await combineVideosCore({
    videoUrls: options.videoUrls,
    transition: options.transition,
    transitionDuration: options.transitionDuration ?? 0.5,
    audioMode: options.audioMode ?? "crossfade",
    audioCrossfadeCurve: options.audioCrossfadeCurve,
    trimStartFrames: options.trimStartFrames ?? 0,
    trimEndFrames: options.trimEndFrames ?? 0,
    targetWidth: options.targetWidth,
    targetHeight: options.targetHeight,
    smartCut: options.smartCut,
  })
  try {
    return await uploadFileToR2(localPath, randomUUID(), "video")
  } finally {
    // combineVideos uses its own temp dir structure (not cleanupWorkDir-
    // compatible) — mirrors workers/handlers/ffmpeg.ts's handleCombineVideos.
    await fs.rm(dirname(localPath), { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * `tk.ffmpeg.extractTail` — downloads `url` to a temp file, re-encodes its
 * last `seconds` via `extractTailToFile` (`providers/video/extract-tail.ts`),
 * and uploads the result to R2.
 */
async function extractTailToUrl(url: string, seconds: number, jobId: string): Promise<string> {
  // One line of observability per cut (job dbf95612 post-mortem: the actual
  // `seconds` that reached this function in production was unknowable from
  // the logs — this is the line that would have answered it instantly).
  console.log(`[extract-tail] ${jobId}: last ${seconds}s of ${url}`)
  const workDir = await createWorkDir("extract-tail")
  try {
    const inputPath = join(workDir, "input.mp4")
    await downloadFile(url, inputPath)
    const tailPath = await extractTailToFile(inputPath, seconds)
    return await uploadFileToR2(tailPath, jobId, "video")
  } finally {
    await cleanupWorkDir(workDir)
  }
}

/**
 * `tk.ffmpeg.trimVideo` — re-encoding cut of [startSec, endSec) via core
 * `trimVideo` (`providers/video/trim-video.ts`), uploaded to R2. `opts.crf`
 * threads to the new TrimVideoOptions.crf (default 23; edit-video-pro cuts
 * at 18). Cleanup mirrors combineVideosToUrl (core leaves its work dir).
 */
async function trimVideoToUrl(
  url: string,
  startSec: number,
  endSec: number | undefined,
  jobId: string,
  opts?: { crf?: number },
): Promise<string> {
  const { videoPath } = await trimVideoCore({
    videoUrl: url,
    startTime: startSec,
    ...(endSec !== undefined ? { endTime: endSec } : {}),
    ...(opts?.crf !== undefined ? { crf: opts.crf } : {}),
  })
  try {
    return await uploadFileToR2(videoPath, jobId, "video")
  } finally {
    await fs.rm(dirname(videoPath), { recursive: true, force: true }).catch(() => {})
  }
}

/** `tk.ffmpeg.probeVideoMeta` — mirrors `probeVideoSource`, field rename only. */
async function probeVideoMeta(url: string): Promise<{ durationSec: number; width: number; height: number }> {
  const { width, height, durationSeconds } = await probeVideoSource(url)
  return { width, height, durationSec: durationSeconds }
}

/**
 * `tk.jobs.updateJobCheckpoint` — read-merge-write on `jobs.output_data`.
 * Shallow merge only: a patch key REPLACES the existing key wholesale (no
 * deep merge), matching every other `output_data` writer in this codebase
 * (e.g. `workers/shared.ts`'s `markJobCompleted`). The read step's error is
 * checked BEFORE the merge — a silently-ignored transient read failure would
 * otherwise treat existing output_data as `{}` and the write below would
 * clobber it wholesale.
 */
async function updateJobCheckpoint(jobId: string, patch: Record<string, unknown>): Promise<void> {
  const { data, error } = await supabase.from("jobs").select("output_data").eq("id", jobId).single()
  if (error) {
    throw new Error(`Failed to read checkpoint for job ${jobId}: ${error.message}`)
  }
  const existing = (data?.output_data as Record<string, unknown> | null) ?? {}
  await supabase
    .from("jobs")
    .update({ output_data: { ...existing, ...patch } })
    .eq("id", jobId)
}

/** `tk.jobs.readJobCheckpoint` — read-only counterpart of `updateJobCheckpoint`. */
async function readJobCheckpoint(jobId: string): Promise<Record<string, unknown> | null> {
  const { data } = await supabase.from("jobs").select("output_data").eq("id", jobId).single()
  return (data?.output_data as Record<string, unknown> | null) ?? null
}

/** Server-only storage for Recast's pre-watermark remux input. */
async function storeRecastAudioBase(args: {
  gvpJobId: string
  userId: string
  baseUrl: string
}): Promise<void> {
  const { error } = await supabase.from("recast_audio_bases").upsert({
    gvp_job_id: args.gvpJobId,
    user_id: args.userId,
    base_url: args.baseUrl,
    updated_at: new Date().toISOString(),
  }, { onConflict: "gvp_job_id" })
  if (error) throw new Error(`Failed to store private Recast audio base: ${error.message}`)
}

async function readRecastAudioBase(args: {
  gvpJobId: string
  userId: string
}): Promise<string | null> {
  const { data, error } = await supabase
    .from("recast_audio_bases")
    .select("base_url")
    .eq("gvp_job_id", args.gvpJobId)
    .eq("user_id", args.userId)
    .maybeSingle()
  if (error) throw new Error(`Failed to read private Recast audio base: ${error.message}`)
  return typeof data?.base_url === "string" && data.base_url.length > 0 ? data.base_url : null
}

async function clearRecastAudioBase(args: {
  gvpJobId: string
  userId: string
  baseUrl: string
}): Promise<void> {
  const { error } = await supabase
    .from("recast_audio_bases")
    .delete()
    .eq("gvp_job_id", args.gvpJobId)
    .eq("user_id", args.userId)
    .eq("base_url", args.baseUrl)
  if (error) throw new Error(`Failed to clear private Recast audio base: ${error.message}`)
}

/** Stable V2 transport retries must resolve before stale-revision checks. */
async function findJobByIdempotencyKey(
  userId: string,
  idempotencyKey: string,
): Promise<{
  id: string
  status: string
  input_data: Record<string, unknown> | null
  output_data: Record<string, unknown> | null
  error_message: string | null
} | null> {
  const { data, error } = await supabase
    .from("jobs")
    .select("id,status,input_data,output_data,error_message")
    .eq("user_id", userId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle()
  if (error) {
    throw new Error(`Failed to read idempotent job: ${error.message}`)
  }
  if (!data) return null
  return {
    id: data.id as string,
    status: data.status as string,
    input_data: (data.input_data as Record<string, unknown> | null) ?? null,
    output_data: (data.output_data as Record<string, unknown> | null) ?? null,
    error_message: (data.error_message as string | null) ?? null,
  }
}

async function claimRecastRescore(args: {
  recastId: string
  childJobId: string
  userId: string
  gvpJobId: string
  expectedAudioRevision: string
  pendingRescore: Record<string, unknown>
}): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc("claim_recast_rescore", {
    p_recast_id: args.recastId,
    p_child_job_id: args.childJobId,
    p_user_id: args.userId,
    p_gvp_job_id: args.gvpJobId,
    p_expected_audio_revision: args.expectedAudioRevision,
    p_pending_rescore: args.pendingRescore,
  })
  if (error) throw new Error(`claim_recast_rescore failed: ${error.message}`)
  return (data ?? { ok: false, reason: "unknown" }) as Record<string, unknown>
}

async function clearRecastRescoreClaim(args: {
  recastId: string
  childJobId: string
  userId: string
}): Promise<boolean> {
  const { data, error } = await supabase.rpc("clear_recast_rescore_claim", {
    p_recast_id: args.recastId,
    p_child_job_id: args.childJobId,
    p_user_id: args.userId,
  })
  if (error) throw new Error(`clear_recast_rescore_claim failed: ${error.message}`)
  return data === true
}

/**
 * Publication RPCs are transactionally atomic but their HTTP response is not:
 * the database can commit and the connection can disappear before PostgREST
 * returns. Retry the exact idempotent call once so a committed first attempt is
 * observed as success and an uncommitted transport failure can simply execute.
 */
async function retryBooleanPublicationRpc(
  name: string,
  invoke: () => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<boolean> {
  let detail = "unknown error"
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { data, error } = await invoke()
      if (!error) return data === true
      detail = error.message
    } catch (error) {
      detail = error instanceof Error ? error.message : String(error)
    }
  }
  throw new Error(`${name} failed after an exact retry: ${detail}`)
}

async function publishLegacyRecastRescore(args: {
  recastId: string
  childJobId: string
  userId: string
  gvpJobId: string
  resultUrl: string
  rescore: Record<string, unknown>
}): Promise<boolean> {
  return retryBooleanPublicationRpc(
    "publish_legacy_recast_rescore",
    () => supabase.rpc("publish_legacy_recast_rescore", {
      p_recast_id: args.recastId,
      p_child_job_id: args.childJobId,
      p_user_id: args.userId,
      p_gvp_job_id: args.gvpJobId,
      p_result_url: args.resultUrl,
      p_rescore: args.rescore,
    }),
  )
}

async function publishRecastRescore(args: {
  recastId: string
  childJobId: string
  userId: string
  gvpJobId: string
  expectedAudioRevision: string
  resultUrl: string
  audio: Record<string, unknown>
  rescore: Record<string, unknown>
}): Promise<boolean> {
  return retryBooleanPublicationRpc(
    "publish_recast_rescore",
    () => supabase.rpc("publish_recast_rescore", {
      p_recast_id: args.recastId,
      p_child_job_id: args.childJobId,
      p_user_id: args.userId,
      p_gvp_job_id: args.gvpJobId,
      p_expected_audio_revision: args.expectedAudioRevision,
      p_result_url: args.resultUrl,
      p_audio: args.audio,
      p_rescore: args.rescore,
    }),
  )
}

/**
 * `tk.jobs.markJobCompleted` — plugins pass the job's OUTPUT PAYLOAD
 * (`{ videoUrl, pro: checkpoint }`), NOT jobs-table columns. This wrapper
 * read-merges the payload into `output_data` (same shallow-merge semantics
 * and read-error handling as `updateJobCheckpoint` above) and completes
 * through the core CAS (`workers/shared.ts` `markJobCompleted`, which spreads
 * its `fields` as UPDATE COLUMNS). Registering the core function here RAW was
 * the bug that left every gvp/evp completion unrecorded: PostgREST rejected
 * the payload keys as unknown columns ("Could not find the 'pro' column of
 * 'jobs' in the schema cache"), the resulting `false` read as
 * cancelled-mid-flight, and a fully-generated job rotted in
 * status=processing until the reconcile sweep failed+refunded it
 * (jobs 1e209599, dbf95612 — the latter with a finished stitch in hand).
 * A transient read failure THROWS (retryable via the handler's stitch-retry /
 * next BullMQ attempt) rather than returning false — false means "skip the
 * credit commit", which is wrong for a delivered output.
 */
function jsonContains(actual: unknown, expected: unknown): boolean {
  if (expected === null || typeof expected !== "object") return Object.is(actual, expected)
  if (Array.isArray(expected)) {
    return Array.isArray(actual)
      && actual.length === expected.length
      && expected.every((value, index) => jsonContains(actual[index], value))
  }
  if (actual === null || typeof actual !== "object" || Array.isArray(actual)) return false
  const actualRecord = actual as Record<string, unknown>
  return Object.entries(expected as Record<string, unknown>)
    .every(([key, value]) => Object.prototype.hasOwnProperty.call(actualRecord, key)
      && jsonContains(actualRecord[key], value))
}

async function pluginMarkJobCompleted(
  jobId: string,
  output: Record<string, unknown>,
  extraColumns?: Record<string, unknown>,
): Promise<boolean> {
  const { data, error } = await supabase.from("jobs").select("output_data").eq("id", jobId).single()
  if (error) {
    throw new Error(`Failed to read output_data for job ${jobId}: ${error.message}`)
  }
  const existing = (data?.output_data as Record<string, unknown> | null) ?? {}
  const nextOutput = { ...existing, ...output }
  // `output` merges into output_data; `extraColumns` (optional) spread as real
  // jobs-table COLUMNS (video-analysis writes provider_cost this way). markJobCompleted
  // spreads its `fields` as UPDATE columns, so output_data + extraColumns land together.
  const updated = await markJobCompleted(jobId, {
    output_data: nextOutput,
    ...(extraColumns ?? {}),
  })
  if (updated) return true

  // `markJobCompleted` intentionally returns false both for a terminal CAS
  // loss and for a PostgREST error. Resolve that ambiguity before a plugin
  // deletes staged media or skips settlement. An exact completed payload means
  // the UPDATE committed and only its response was lost; a still-live row is
  // retryable infrastructure failure, never a cancellation.
  const { data: terminal, error: terminalError } = await supabase
    .from("jobs")
    .select("status,output_data")
    .eq("id", jobId)
    .single()
  if (terminalError) {
    throw new Error(`Failed to verify completion outcome for job ${jobId}: ${terminalError.message}`)
  }
  const terminalRow = terminal as {
    status?: unknown
    output_data?: unknown
  } | null
  if (terminalRow?.status === "completed" && jsonContains(terminalRow.output_data, nextOutput)) {
    return true
  }
  if (["pending", "queued", "processing"].includes(String(terminalRow?.status))) {
    throw new Error(`Job ${jobId} is still live after its completion CAS failed`)
  }
  return false
}

/**
 * `tk.jobs.clearReconcileSentinel` — nulls the reconcile sentinel fields so
 * the cron doesn't treat an in-flight pro-engine run as a stale pickup.
 * Precedent: `workers/handlers/ffmpeg.ts:482-497` (add-captions→render
 * handoff, same two-field update).
 */
async function clearReconcileSentinel(jobId: string): Promise<void> {
  await supabase
    .from("jobs")
    .update({ provider_kind: null, provider_call_started_at: null })
    .eq("id", jobId)
}

/**
 * `tk.jobs.readJob` — narrow jobs-row read for the seed lane. Returns the
 * job's id/status/user_id/output_data/error_message, or null when the row is
 * absent. `output_data` (and `user_id`/`error_message`) normalize to null when
 * unset so the shape is exactly the contract's.
 *
 * `job_type` + `input_data` (2026-07-21, gvp stop/continue): the continue
 * route validates the parent's type and rebuilds the run payload from its
 * input — additive-optional in the contract mirror, so a plugin built
 * against the widened surface runtime-guards their presence.
 */
async function readJob(jobId: string): Promise<{
  id: string
  status: string
  user_id: string | null
  output_data: Record<string, unknown> | null
  error_message: string | null
  job_type?: string
  input_data?: Record<string, unknown> | null
} | null> {
  const { data } = await supabase
    .from("jobs")
    .select("id,status,user_id,output_data,error_message,job_type,input_data")
    .eq("id", jobId)
    .maybeSingle()
  if (!data) return null
  const row = data as {
    id: string
    status: string
    user_id: string | null
    output_data: Record<string, unknown> | null
    error_message: string | null
    job_type: string
    input_data: Record<string, unknown> | null
  }
  return {
    id: row.id,
    status: row.status,
    user_id: row.user_id ?? null,
    output_data: row.output_data ?? null,
    error_message: row.error_message ?? null,
    job_type: row.job_type,
    input_data: row.input_data ?? null,
  }
}

/**
 * `tk.jobs.markJobFailed` — route-side CAS fail for SYNCHRONOUS priced routes
 * (first consumer: `/v1/recast/revise`, which has no worker to own its
 * failure path). Flips only LIVE rows — the same live-status gate as the
 * worker failure paths (`workers/video-worker.ts`) so a concurrent
 * completion/cancel is never clobbered — and reports whether WE flipped it
 * (the caller refunds only on true, mirroring the worker's only-if-we-flipped
 * refund discipline).
 */
async function pluginMarkJobFailed(jobId: string, errorMessage: string): Promise<boolean> {
  const { data } = await supabase
    .from("jobs")
    .update({
      status: "failed",
      error_message: errorMessage,
      completed_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .in("status", ["pending", "processing"])
    .select("id")
  return Array.isArray(data) && data.length > 0
}

/**
 * `tk.jobs.refundJobCredits` — exposes the worker-layer refund to routes.
 * Falsy usageLogId no-ops (the reserve never landed / was already aborted);
 * a plain string reason always refunds (`workers/shared.ts` treats a string
 * as carrying no post-delivery signal — correct for pre-provider revise
 * failures, the only kind a synchronous route produces).
 */
async function pluginRefundJobCredits(usageLogId: string, jobId: string, reason: string): Promise<void> {
  if (!usageLogId) return
  await refundJobCredits(usageLogId, jobId, reason)
}

/**
 * `tk.jobs.hasWaivingRecastRun` — the recast direction gate's re-take waiver
 * predicate as ONE dedicated query. Deliberately NOT the generic select
 * mirror: the predicate needs six filters plus an OR, and `maybeSingle()`
 * would ERROR on any user with ≥2 completed runs — hence `.limit(1)`.
 * Waives iff a completed recast PLANNING row (never `recast-revise` rows —
 * a paid revise must not disarm the gate) exists for this user + workflow +
 * analysis, AND it either predates the gate cutover or itself carried
 * direction.
 */
async function hasWaivingRecastRun(q: {
  userId: string
  workflowId: string
  analysisJobId: string
  cutoverIso: string
}): Promise<boolean> {
  const { data } = await supabase
    .from("jobs")
    .select("id")
    .eq("user_id", q.userId)
    .eq("workflow_id", q.workflowId)
    .eq("app_slug", "recast")
    .eq("status", "completed")
    .eq("input_data->>type", "recast")
    .eq("input_data->>analysisJobId", q.analysisJobId)
    .or(`created_at.lt.${q.cutoverIso},input_data->direction.not.is.null`)
    .limit(1)
  return Array.isArray(data) && data.length > 0
}

/**
 * `tk.pipelines.getSnapshot` — user-scoped status/progress read for a seeded
 * run. Three reads: the ownership-scoped `pipelines` row (`.eq("user_id",
 * userId)` → null on a foreign caller or a missing id, since the service-role
 * client bypasses RLS — same enforcement `routes/pipelines.ts`'s
 * `GET /v1/pipelines/:id` applies), the `pipeline_stages` list ordered by
 * `stage_order` (mirrors `ee/pipelines/engine.ts`'s stage read), and — only
 * when a final asset exists — the `assets.r2_url` lookup that resolves
 * `final_output_asset_id` → a public `finalOutputUrl` (the same asset-id → URL
 * resolution the pipeline stages use, e.g. `locations.ts`'s `assetUrlForId`).
 * Field mapping matches `PipelineSnapshot` (camelCase keys).
 *
 * Error handling mirrors `routes/pipelines.ts`'s `GET /v1/pipelines/:id`
 * (500-on-error vs 404-on-missing): a DB fault on the PRIMARY pipelines read
 * THROWS so the consuming route can surface a 500 — swallowing it to `null`
 * would be indistinguishable from not-found/ownership-fail (a transient fault
 * would read as a spurious "not found" under status polling). The follow-up
 * stages / asset reads degrade gracefully (empty stages / null URL) but log
 * the swallowed error so the partial degradation stays observable.
 */
async function getPipelineSnapshot(
  pipelineId: string,
  userId: string,
): Promise<PipelineSnapshot | null> {
  const { data: pipelineData, error: pipelineError } = await supabase
    .from("pipelines")
    .select(
      "id,status,current_stage,spent_credits,reserved_credits,upfront_credit_estimate,final_output_asset_id,failure_reason,current_progress_message",
    )
    .eq("id", pipelineId)
    .eq("user_id", userId)
    .maybeSingle()
  if (pipelineError) {
    throw new Error(
      `Failed to read pipeline snapshot for ${pipelineId}: ${pipelineError.message}`,
    )
  }
  if (!pipelineData) return null
  const pipeline = pipelineData as {
    id: string
    status: string
    current_stage: string | null
    spent_credits: number | null
    reserved_credits: number | null
    upfront_credit_estimate: number | null
    final_output_asset_id: string | null
    failure_reason: string | null
    current_progress_message: string | null
  }

  const { data: stages, error: stagesError } = await supabase
    .from("pipeline_stages")
    .select("stage_name, status")
    .eq("pipeline_id", pipelineId)
    .order("stage_order", { ascending: true })
  if (stagesError) {
    // Non-fatal: return the snapshot with an empty stage list rather than
    // failing the whole read — but log so the blanked list is observable.
    console.error(
      `[private-plugins/pipelines] Failed to read stages for pipeline ${pipelineId}:`,
      stagesError.message,
    )
  }
  const stageRows = (stages ?? []) as Array<{ stage_name: string; status: string }>

  let finalOutputUrl: string | null = null
  if (pipeline.final_output_asset_id) {
    const { data: asset, error: assetError } = await supabase
      .from("assets")
      .select("r2_url")
      .eq("id", pipeline.final_output_asset_id)
      .maybeSingle()
    if (assetError) {
      // Non-fatal: leave finalOutputUrl null rather than failing the read —
      // but log so the missing URL is observable.
      console.error(
        `[private-plugins/pipelines] Failed to resolve final output URL for pipeline ${pipelineId}:`,
        assetError.message,
      )
    }
    finalOutputUrl = (asset as { r2_url: string | null } | null)?.r2_url ?? null
  }

  return {
    id: pipeline.id,
    status: pipeline.status,
    currentStage: pipeline.current_stage ?? null,
    stages: stageRows.map((s) => ({ stageName: s.stage_name, status: s.status })),
    spentCredits: pipeline.spent_credits ?? 0,
    reservedCredits: pipeline.reserved_credits ?? 0,
    upfrontCreditEstimate: pipeline.upfront_credit_estimate ?? 0,
    finalOutputUrl,
    failureReason: pipeline.failure_reason ?? null,
    progressMessage: pipeline.current_progress_message ?? null,
  }
}

export function buildToolkit(): PluginToolkit {
  return {
    providers: {
      directVoiceChanger,
      // Exposed as a plain function per the contract; the real capability is
      // a class method (`AudioSeparationProvider` interface implementation),
      // so this wraps a fresh instance per call — the class itself carries
      // no per-instance state (concurrency throttling lives in
      // module-level state inside audio-separation.ts).
      separateAudio: (audioUrl, opts, reconcileOpts) =>
        new ReplicateAudioSeparationProvider().separateAudio(audioUrl, opts, reconcileOpts),
      textToVideo: pluginTextToVideo,
      imageToVideo: pluginImageToVideo,
      generateImage: pluginGenerateImage,
      generateMusic: pluginGenerateMusic,
      // Provider-routed video enhancement (Topaz by default at the routing
      // layer). The gvp tail-restoration lever calls this on a 2-5s tail —
      // the contract exposes only (url, model, factor); reconcile/progress
      // hooks stay app-internal.
      videoUpscale: (videoUrl, model, upscaleFactor) =>
        videoUpscale(videoUrl, model, upscaleFactor).then((r) => ({ url: r.url })),
      // IDENTITY PLATE (gvp stage 3, 2026-08-02): fixed-2x Topaz image
      // enhancement with the exact-same-frame guarantee — verify 2x dims +
      // pixel alignment (plate-gate.ts), then host the VERIFIED bytes on R2 so
      // the plugin gets a durable, gate-passed URL. Any provider drift (crop/
      // pad/resolution snap) rejects here and the plugin's non-fatal guard
      // drops the plate for that boundary.
      imageUpscale: async (imageUrl, model) => {
        // Source fetch doubles as a readability preflight: the gate needs
        // these bytes anyway, and an unreadable anchor should fail here
        // before a provider task is spent on it.
        const src = await fetchImageBuffer(imageUrl)
        // KIE's market ingest can fail transiently on a seconds-old object
        // and the failure sticks to that exact URL for a window (2026-08-03:
        // 422 "Field required" replayed for ~2h while Seedance ingested the
        // same URL fine). Retry once under a fresh query nonce — the CDN
        // serves identical bytes, KIE sees a new cache key. Safe here because
        // this lane only ever receives our own bare R2/CDN URLs.
        let r: Awaited<ReturnType<typeof editImage>>
        try {
          r = await editImage(imageUrl, model)
        } catch (err) {
          console.warn(
            `[private-plugins/imageUpscale] first attempt failed (${err instanceof Error ? err.message : String(err)}) — retrying under a fresh nonce`,
          )
          const sep = imageUrl.includes("?") ? "&" : "?"
          r = await editImage(`${imageUrl}${sep}n=${randomUUID().replace(/-/g, "").slice(0, 8)}`, model)
        }
        if (!r.url) throw new Error("image upscale returned no url")
        const ups = await fetchImageBuffer(r.url)
        const gate = await assertExact2xAligned(src, ups)
        const ext = gate.format === "jpeg" ? "jpg" : gate.format
        return { url: await uploadBufferToR2(ups, `images/plate-${randomUUID()}.${ext}`, `image/${gate.format}`) }
      },
      getVideoTaskStatus,
      // The contract narrows `downloadYouTubeVideo`'s opts to {url,outPath,
      // maxFilesizeBytes?}; the core fn's extra params are all optional, so the
      // narrower shape is a valid subset and the reference assigns directly.
      downloadYouTubeVideo,
      ytMetadataProbe,
      YtUrlNotAllowedError,
    },
    ffmpeg: {
      runFfmpeg,
      runFfmpegCapture,
      createWorkDir,
      cleanupWorkDir,
      downloadFile,
      combineVideos: combineVideosToUrl,
      extractTail: extractTailToUrl,
      trimVideo: trimVideoToUrl,
      probeVideoMeta,
      runFfprobe,
      getVideoDuration,
      probeMediaDuration,
      needsTranscode,
      transcodeToBrowserSafe,
      needsContainerRemux,
      remuxToMp4,
    },
    media: {
      extractAudio,
      mixAudio,
      mergeVideoAudio,
      applyAudioFx,
      applyImageWatermark,
      uploadVideoMaybeWatermark,
    },
    storage: {
      uploadBufferToR2,
      uploadFileToR2,
      runPostProcessing,
      // Mirrors `uploadToR2` (`lib/storage.ts:126`) narrowed to video.
      uploadVideoFromUrl: (url, jobId, trackUserId) => uploadToR2(url, jobId, "video", trackUserId),
      uploadFileWithKeyToR2,
      r2Url,
      getR2ObjectSize,
      downloadR2ObjectToFile,
      readR2ObjectBuffer,
      deleteFromR2,
      r2KeyFromOurUrl,
      storeImportedImageBuffer,
      mediaObjectKey,
      copyRecastObject,
      reserveStorage: reserveStorageIfWithinLimit,
      refundStorage,
    },
    jobs: {
      storeRecastAudioBase,
      readRecastAudioBase,
      clearRecastAudioBase,
      findJobByIdempotencyKey,
      claimRecastRescore,
      clearRecastRescoreClaim,
      publishLegacyRecastRescore,
      publishRecastRescore,
      markJobCompleted: pluginMarkJobCompleted,
      setJobProgress,
      withProgressRamp,
      commitJobCredits,
      clearReconcileSentinel,
      throwIfJobCancelled,
      updateJobCheckpoint,
      readJobCheckpoint,
      // `kind` is narrowed to the reconcile `ProviderKind` union at the call
      // boundary — the video-analysis handler only ever passes `"pre-task"`
      // (a valid member); the cast keeps the contract's `string` param without
      // importing the union type here.
      markProviderCallStart: (jobId, kind) =>
        markProviderCallStart(jobId, kind as Parameters<typeof markProviderCallStart>[1]),
      readJob,
      requestJobStop,
      markJobFailed: pluginMarkJobFailed,
      refundJobCredits: pluginRefundJobCredits,
      hasWaivingRecastRun,
    },
    http: {
      supabase,
      videoQueue,
      creditGuard,
      reserveCreditsForJob,
      applyCreditMarkup: async (modelIdentifier, baseCredits) => {
        if (!Number.isFinite(baseCredits) || baseCredits < 0) {
          throw new Error("Dynamic credit quote must be a finite non-negative number")
        }
        if (!hasCredits() || baseCredits === 0) return baseCredits
        const { effectiveMarkupPercent } = await import("../../ee/billing/service-margin.js")
        const markup = effectiveMarkupPercent(await getAppSettings(), modelIdentifier)
        return markup > 0 ? Math.ceil(baseCredits * (1 + markup / 100)) : baseCredits
      },
      safeUrlSchema,
      extractWorkflowId,
      extractNodeId,
      extractForcePrivate,
      extractMcpClient,
      buildJobInputData,
      formatZodError,
      safeFetch,
      // Mirrors `insertWithIdempotencyKey` (`lib/idempotent-insert.ts:33`),
      // narrowed to the "jobs" table + the one column the contract needs.
      insertJobWithIdempotencyKey: async (data, idempotencyKey) => {
        const { row, created } = await insertWithIdempotencyKey<{ id: string }>("jobs", data, idempotencyKey)
        return { id: row.id, created }
      },
      // Dynamic import keeps the core/ee boundary: this file (core) may not
      // statically import `ee/` (tools/check-ee-imports.mjs). Gated on
      // hasCredits() so the import is never even attempted outside Cloud —
      // mirrors middleware/credit-guard.ts's creditGuard() shim and
      // load.ts's applyStaticCreditCosts()/applyPipelinePrompts().
      computeGenerateVideoProPricing: async (args) => {
        if (!hasCredits()) {
          throw new Error("computeGenerateVideoProPricing requires a Cloud-edition build")
        }
        const { computeGenerateVideoProPricing: computePricing } = await import(
          "../../ee/billing/generate-video-pro-credits.js"
        )
        return computePricing(args)
      },
      computeEditVideoProPricing: async (args) => {
        if (!hasCredits()) {
          throw new Error("computeEditVideoProPricing requires a Cloud-edition build")
        }
        const { computeEditVideoProPricing: computePricing } = await import(
          "../../ee/billing/edit-video-pro-credits.js"
        )
        return computePricing(args)
      },
      computeGenerateVideoProContinuationPricing: async (args) => {
        if (!hasCredits()) {
          throw new Error("computeGenerateVideoProContinuationPricing requires a Cloud-edition build")
        }
        const { computeGenerateVideoProContinuationPricing: computePricing } = await import(
          "../../ee/billing/generate-video-pro-credits.js"
        )
        return computePricing(args)
      },
      sendInternalError,
      hostnameMatchesAllowlist,
      youtubeHosts: YOUTUBE_HOSTS,
    },
    llm: {
      // Adapts PluginLlmRequest {model, system?, prompt, maxTokens?} to
      // lib/llm-client.ts's LlmRequest and unwraps StructuredLlmOutput<T> to
      // the contract's bare Promise<T>.
      completeStructured: async <T>(
        req: PluginLlmRequest,
        schema: unknown,
        opts?: { schemaName?: string; maxRetries?: number },
      ): Promise<T> => {
        const result = await llmCompleteStructured(
          {
            modelId: req.model,
            system: req.system ?? "",
            messages: [{ role: "user", content: req.prompt }],
            maxTokens: req.maxTokens,
            // Forward pinned sampling (video-analysis grader pins temperature 0 for
            // a deterministic judge). deriveParams gates on `!== undefined`, so 0
            // survives; an unset field stays vendor-default as before.
            temperature: req.temperature,
            topP: req.topP,
            // The contract keeps this a loose string (no cross-repo type
            // identity); effectiveReasoningEffort ignores anything outside the
            // ladder, so an unknown value degrades to vendor-default, not a 400.
            reasoningEffort: req.reasoningEffort as LlmReasoningEffort | undefined,
            // Unset by default — this text-only path serves gvp/evp planners
            // and film-studio doctrine, which keep the registry's cost-aware
            // routing. Only a caller that must not touch KIE pins a lane.
            requireLane: req.requireLane,
          },
          schema as ZodType<T>,
          opts,
        )
        return result.output
      },
      // Multimodal variant — a per-window `[{video},{text}]` turn, returning
      // BOTH the validated output AND the summed providerCost (video-analysis
      // accumulates per-window cost). PluginLlmContentBlock is a subset of the
      // core LlmContentBlock union, so `req.messages` assigns to LlmMessage[].
      completeStructuredMultimodal: async <T>(
        req: PluginLlmMultimodalRequest,
        schema: unknown,
        opts?: { schemaName?: string; maxRetries?: number },
      ): Promise<{ output: T; providerCost?: number }> => {
        const result = await llmCompleteStructured(
          {
            modelId: req.model,
            system: req.system ?? "",
            messages: req.messages,
            maxTokens: req.maxTokens,
            temperature: req.temperature,
            topP: req.topP,
            // Multimodal callers can request thinking depth too. Omitting this
            // pinned every video-analysis roll to the vendor default no matter
            // what it passed; `effectiveReasoningEffort` clamps unknown values.
            reasoningEffort: req.reasoningEffort as LlmReasoningEffort | undefined,
            timeoutMs: req.timeoutMs,
            // Video-analysis is direct-ONLY. This is the analysis lane (see the
            // contract docstring), so it defaults to the direct Google API and
            // takes no KIE fallback: falling back would silently swap real
            // media parts for KIE's `image_url` URL-smuggling hack and return
            // differently-grounded analysis instead of an error. A caller that
            // genuinely wants the aggregator passes `requireLane: "kie"`.
            requireLane: req.requireLane ?? "direct",
            // Media fail-open guard — only the caller knows how much media it
            // sent, so the floor rides the request. See the contract docstring.
            minPromptTokens: req.minPromptTokens,
          },
          schema as ZodType<T>,
          opts,
        )
        return { output: result.output, providerCost: result.providerCost }
      },
    },
    pipelines: {
      // Core (`lib/private-plugins/`) may not STATICALLY import `ee/`
      // (tools/check-ee-imports.mjs) — each method reaches the seed lane via a
      // runtime dynamic import() inside its body, mirroring load.ts's
      // applyPipelinePrompts()/applyStaticCreditCosts() and the
      // http.computeGenerateVideoProPricing shim above. No hasCredits() gate:
      // tk.pipelines is only ever called by a loaded Cloud plugin, and the
      // seed lane guards its own prompt availability internally.
      createSeeded: async (input) => {
        const { createSeededPipeline } = await import("../../ee/pipelines/seed-pipeline.js")
        return createSeededPipeline(supabase, input)
      },
      estimateSeeded: async (input) => {
        const { estimateSeededPipelineCredits } = await import("../../ee/pipelines/credits.js")
        return estimateSeededPipelineCredits(supabase, input)
      },
      getSnapshot: getPipelineSnapshot,
    },
    features: { organizations: hasOrganizations() },
    deployment: { publicUrl: appBaseUrl() },
    redis: {
      url: config.REDIS_URL,
      kv: {
        get: (key) => redis.get(key),
        set: async (key, value, ttlSeconds) => {
          if (ttlSeconds === undefined) await redis.set(key, value)
          else await redis.set(key, value, "EX", ttlSeconds)
        },
        del: (...keys) => redis.del(...keys),
        incr: (key) => redis.incr(key),
        expire: (key, seconds) => redis.expire(key, seconds),
        ttl: (key) => redis.ttl(key),
      },
    },
    db: supabase,
    auth: {
      isPlatformAdmin: checkIsAdmin,
      // Throws on a lookup failure rather than returning null: null means
      // "this user holds no platform role", and a plugin gating on a SPECIFIC
      // role (`=== "super_admin"`) fails closed on that, but one gating the
      // other way would not. A database outage must not read as an answer.
      // Uncached, unlike its `isPlatformAdmin` sibling, which goes through
      // admin-check's 5-minute cache and its invalidation — ask for the
      // boolean unless the exact role matters.
      platformRole: async (userId) => {
        const { data, error } = await supabase.from("profiles").select("role").eq("id", userId).maybeSingle()
        if (error) throw new Error(`platformRole lookup failed: ${error.message}`)
        return (data?.role as string | undefined) ?? null
      },
    },
  }
}
