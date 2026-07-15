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
} from "../storage.js"
import { markProviderCallStart } from "../reconcile/persistence.js"
import { sendInternalError } from "../http-errors.js"
import { runPostProcessing } from "../post-processing-error.js"
import {
  markJobCompleted,
  setJobProgress,
  withProgressRamp,
  commitJobCredits,
  uploadVideoMaybeWatermark,
} from "../../workers/shared.js"
import { supabase } from "../supabase.js"
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
import { hasCredits } from "../config.js"
import { KieVideoProvider } from "../../providers/kie/video.js"
import { pollKieTask, isUpstreamKieFailure } from "../../providers/kie/client.js"
import { combineVideos as combineVideosCore } from "../../providers/video/combine-videos.js"
import { extractTailToFile } from "../../providers/video/extract-tail.js"
import { llmCompleteStructured } from "../llm-client.js"
import type { ProviderOptions, ReconcileOpts } from "../../providers/provider.interface.js"
import { randomUUID } from "node:crypto"
import { dirname, join } from "node:path"
import { promises as fs } from "node:fs"
import type { ZodType } from "zod"
import type { PluginToolkit, PluginLlmRequest, PluginLlmMultimodalRequest, PluginVideoGenOptions, PluginVideoGenResult } from "./types.js"

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
 * Adapts `PluginVideoGenOptions.onTaskCreated` (return type `void |
 * Promise<void>`, per the contract) into `ReconcileOpts.onTaskCreated`
 * (return type strictly `Promise<void>`, per `provider.interface.ts`) — the
 * two aren't directly assignable, since a callback that might return plain
 * `void` doesn't satisfy a slot the KIE client always awaits as a promise.
 * Returns `undefined` (omitting `reconcileOpts` entirely) when there's no
 * callback — never wires `makeOnTaskCreated` (spec §6: `provider_task_id` is
 * never written by this path; only the plugin's own checkpoint is).
 */
function toReconcileOpts(options: PluginVideoGenOptions | undefined): ReconcileOpts | undefined {
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
 * `tk.providers.getVideoTaskStatus` — wraps the single-shot KIE record-info
 * poll the reconcile cron uses: `pollKieTask(taskId, 1)`
 * (`providers/kie/client.ts`), the same call `lib/reconcile/kie.ts`'s
 * `singlePoll` makes for `provider_kind: "kie-standard"` rows. A `KieError`
 * with `isUpstreamFailure` set (`isUpstreamKieFailure`, same module) maps to
 * `"failed"`; any other rejection (still generating, network blip, or the
 * single-attempt timeout) maps to `"processing"`.
 */
async function getVideoTaskStatus(
  taskId: string,
): Promise<{ state: "processing" | "succeeded" | "failed"; videoUrl?: string }> {
  try {
    const { resultJson } = await pollKieTask(taskId, 1)
    const videoUrl = resultJson.resultUrls?.[0] ?? resultJson.videoUrl
    return { state: "succeeded", videoUrl }
  } catch (err) {
    if (isUpstreamKieFailure(err)) return { state: "failed" }
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
  smartCut?: { enabled: boolean; framesFromPrev: number; framesFromNext: number; boundaryMask?: readonly boolean[] }
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
  // `output` merges into output_data; `extraColumns` (optional) spread as real
  // jobs-table COLUMNS (video-analysis writes provider_cost this way). markJobCompleted
  // spreads its `fields` as UPDATE columns, so output_data + extraColumns land together.
  return markJobCompleted(jobId, { output_data: { ...existing, ...output }, ...(extraColumns ?? {}) })
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
    },
    jobs: {
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
    },
    http: {
      supabase,
      videoQueue,
      creditGuard,
      reserveCreditsForJob,
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
            timeoutMs: req.timeoutMs,
          },
          schema as ZodType<T>,
          opts,
        )
        return { output: result.output, providerCost: result.providerCost }
      },
    },
  }
}
