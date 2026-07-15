/**
 * Plugin contract v1 — the interface boundary between this app repo's
 * private-plugin loader (`backend/src/lib/private-plugins/`, Stage 1 Tasks
 * 8-9) and plugins published from the private `nodaroai/nodaro-cloud-plugins`
 * repo (package `@nodaroai/cloud-plugins`).
 *
 * This file is a CANONICAL COPY of that repo's `src/contract.ts` (same
 * names, same shapes — kept in sync by hand; Stage 1 has no automated sync,
 * a later stage may publish the contract as a tiny shared type-only package
 * to remove this duplication). It exists here so the loader (`load.ts`) and
 * toolkit (`toolkit.ts`, Task 9) can be typed without a runtime dependency on
 * the proprietary plugin package, which community/business builds — and
 * this file's own `tsc --noEmit` — never install.
 *
 * Every shape below is a STRUCTURAL mirror of a real export in this repo —
 * see the per-member comments, and `.superpowers/sdd/task-2-report.md` for
 * the exact file:line each one was derived from. Structural typing (not a
 * shared package) is the compatibility mechanism: this app's `buildToolkit()`
 * assembles a real object from its own modules and hands it to plugins as
 * `PluginToolkit`; TypeScript accepts it as long as the shapes line up.
 * `CONTRACT_VERSION` is the drift guard — this app's loader refuses to load
 * a plugin module whose `contractVersion` doesn't match.
 *
 * Toolkit evolution is additive-only (new groups/members may be added; never
 * remove or narrow an existing member without bumping CONTRACT_VERSION).
 *
 * Two deliberate departures from the plugin repo's copy: (1) `PluginAudioFxOptions
 * .preset` is typed as the real `AudioFxPreset` (`@nodaro/shared`) here
 * instead of structural `string` — this app has `@nodaro/shared` natively,
 * so there's no reason to widen it. Still structurally compatible with the
 * plugin repo's `string` version at the call boundary (a narrower type is
 * always assignable to the wider one). (2) `PromptTable`'s doc comment names
 * this repo's `ee/pipelines/llms/prompt-registry.ts` as "here" and the plugin
 * repo's `src/plugins/film-studio-prompts/prompt-keys.ts` as "the plugin
 * repo" — the plugin repo's copy of that same comment necessarily flips
 * those two references, same vantage-point pattern as this header comment.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify"
import type { ZodError, ZodType } from "zod"
import type { AudioFxPreset, SurroundDirection } from "@nodaro/shared"

// ============================================================================
// Job / handler shapes
// ============================================================================

/**
 * Structural mirror of the subset of BullMQ's `Job` that a plugin handler
 * consumes: `job.data` (raw payload) and `job.updateProgress` (passed
 * straight through to `tk.jobs.setJobProgress` / `tk.jobs.withProgressRamp`).
 * Mirrors the `job` parameter of `HandlerFn` (`backend/src/workers/shared.ts`:
 * `export type HandlerFn = (job: Job, ctx: JobContext) => Promise<void>`) and
 * the `job.data as {...}` access pattern used by core worker handlers (see
 * any handler in `backend/src/workers/handlers/`).
 *
 * The plugin package (`@nodaroai/cloud-plugins`) never imports `bullmq` —
 * this app's loader/worker passes a REAL bullmq `Job` across the plugin
 * boundary, which satisfies this interface structurally (it has both
 * members, plus many more the plugin doesn't need).
 *
 * Additive: `attemptsMade`/`opts.attempts` (also real BullMQ `Job` members)
 * are exposed so a handler can compute final-attempt status itself, mirroring
 * the inputs to `isFinalJobAttempt` (`workers/shared.ts:51-53`) — needed by
 * generate-video-pro's partial-commit-on-exhaustion path.
 */
export interface PluginJob {
  readonly data: unknown
  updateProgress(progress: number): Promise<void>
  /** BullMQ `Job#attemptsMade` — how many attempts have already run. */
  readonly attemptsMade: number
  /** BullMQ `Job#opts`, narrowed to the one field `isFinalJobAttempt` reads. */
  readonly opts: { attempts?: number }
}

/**
 * Structural mirror of `JobContext` (`backend/src/workers/shared.ts`).
 */
export interface PluginHandlerCtx {
  jobId: string
  jobUserId: string | undefined
  usageLogId: string | null | undefined
  shouldWatermark: boolean
}

/** Structural mirror of `HandlerFn` (`backend/src/workers/shared.ts`). */
export type PluginHandlerFn = (job: PluginJob, ctx: PluginHandlerCtx) => Promise<void>

// ============================================================================
// tk.providers — backend/src/providers/{elevenlabs,replicate}/*
// ============================================================================

/** Mirrors `VoiceChangerOptions` (`providers/elevenlabs/voice-changer.ts`). */
export interface PluginVoiceChangerOptions {
  modelId?: string
  removeBackgroundNoise?: boolean
  stability?: number
  similarityBoost?: number
  style?: number
  useSpeakerBoost?: boolean
  seed?: number
}

/** Mirrors `AudioSeparationResult` (`providers/provider.interface.ts`). */
export interface PluginAudioSeparationResult {
  vocals?: string
  instrumental?: string
  drums?: string
  bass?: string
  other?: string
  guitar?: string
  piano?: string
  cost: number | null
}

/**
 * Mirrors the options object `textToVideo`/`imageToVideo` accept
 * (`providers/kie/video.ts`), narrowed to the fields generate-video-pro uses.
 */
export interface PluginVideoGenOptions {
  resolution?: string
  generateAudio?: boolean
  referenceImageUrls?: string[]
  referenceVideoUrls?: string[]
  /** Seedance-2 r2v reference audio (max 3) — the gvp plugin sends it on
   *  EVERY segment for consistent conditioning across the stitch. */
  referenceAudioUrls?: string[]
  /** Closing (last) frame — threaded to imageToVideo's POSITIONAL end-frame
   *  param (Seedance-2 resolver builds the closing-frame hint). Sent by the
   *  gvp plugin for the FINAL segment only. */
  endFrameUrl?: string
  /** Invoked with the provider task id as soon as it exists. The pro engine
   * checkpoints it; jobs.provider_task_id is NEVER written (spec §6 linchpin). */
  onTaskCreated?: (taskId: string) => void | Promise<void>
}

/**
 * Mirrors the resolved-generation shape `textToVideo`/`imageToVideo` return
 * (`providers/kie/video.ts`).
 */
export interface PluginVideoGenResult {
  url: string
  taskId?: string
}

export interface PluginProvidersToolkit {
  /** Mirrors `directVoiceChanger` (`providers/elevenlabs/voice-changer.ts`). */
  directVoiceChanger(
    audioBuffer: Buffer,
    voiceId: string,
    options?: PluginVoiceChangerOptions,
  ): Promise<Buffer>
  /**
   * Mirrors `ReplicateAudioSeparationProvider#separateAudio`
   * (`providers/replicate/audio-separation.ts`), exposed as a plain
   * function — this app's toolkit assembly (`toolkit.ts`, Task 9) wraps
   * `new ReplicateAudioSeparationProvider().separateAudio(...)`.
   */
  separateAudio(
    audioUrl: string,
    opts: { mode: "vocal_instrumental" | "stems"; quality: "auto" | "fast" | "best" },
    reconcileOpts?: { onTaskCreated?: (taskId: string) => Promise<void> },
  ): Promise<PluginAudioSeparationResult>
  /** Mirrors `textToVideo` (`providers/kie/video.ts`). */
  textToVideo(
    prompt: string,
    model: string,
    durationSec: number,
    aspectRatio: string,
    options?: PluginVideoGenOptions,
  ): Promise<PluginVideoGenResult>
  /** Mirrors `imageToVideo` (`providers/kie/video.ts`). */
  imageToVideo(
    imageUrl: string,
    prompt: string,
    model: string,
    durationSec: number,
    aspectRatio: string,
    options?: PluginVideoGenOptions,
  ): Promise<PluginVideoGenResult>
  /**
   * Mirrors the single-shot KIE record-info query the reconcile system polls
   * — `pollKieTask` (`providers/kie/client.ts`) called with `maxAttempts=1`,
   * the same call `lib/reconcile/kie.ts`'s `singlePoll` makes for
   * `provider_kind: "kie-standard"` rows — exposed as a plain function so the
   * pro engine can reconcile an in-flight checkpointed segment task on
   * resume. A `KieError` with `isUpstreamFailure` set (`isUpstreamKieFailure`,
   * same module) maps to `"failed"`; any other rejection (still generating,
   * network blip, single-attempt timeout) maps to `"processing"`.
   */
  getVideoTaskStatus(taskId: string): Promise<{
    state: "processing" | "succeeded" | "failed"
    videoUrl?: string
  }>
  /**
   * Mirrors `downloadYouTubeVideo` (`providers/video/youtube-video.ts`),
   * narrowed to the three fields the video-analysis worker passes. Downloads
   * (yt-dlp, UA-spoofed + client-ladder) to `outPath`, size-capped by
   * `maxFilesizeBytes`. SSRF-gated internally (throws `YtUrlNotAllowedError`
   * on a non-allowlisted host).
   */
  downloadYouTubeVideo(opts: {
    url: string
    outPath: string
    maxFilesizeBytes?: number
  }): Promise<void>
  /**
   * Mirrors `ytMetadataProbe` (`providers/video/youtube-video.ts`) — yt-dlp
   * metadata-only probe (duration/title/live). Throws `YtUrlNotAllowedError`
   * on a non-YouTube host; other failures reject with a plain Error.
   */
  ytMetadataProbe(url: string): Promise<{
    durationSec: number | null
    title: string | null
    isLive: boolean
  }>
  /**
   * Mirrors the `YtUrlNotAllowedError` CLASS (`providers/video/youtube-video.ts`)
   * — the app passes its REAL constructor so the plugin can
   * `err instanceof tk.providers.YtUrlNotAllowedError` across the module
   * boundary (both members above throw instances of it).
   */
  YtUrlNotAllowedError: new (message?: string) => Error
}

// ============================================================================
// tk.ffmpeg — backend/src/providers/video/ffmpeg-utils.ts
// ============================================================================

export interface PluginFfmpegToolkit {
  runFfmpeg(args: readonly string[], timeoutMs?: number): Promise<string>
  runFfmpegCapture(
    args: readonly string[],
    timeoutMs?: number,
  ): Promise<{ stdout: string; stderr: string }>
  createWorkDir(prefix: string): Promise<string>
  cleanupWorkDir(workDir: string): Promise<void>
  downloadFile(url: string, dest: string): Promise<void>
  /**
   * Mirrors `combineVideos` (`providers/video/combine-videos.ts:183`),
   * adapted to always resolve an R2 URL — the toolkit implementation uploads
   * when the core function instead returns a local path (see
   * `workers/handlers/ffmpeg.ts`'s `handleCombineVideos` for the same
   * combine-then-upload-then-cleanup shape). Note there is no `jobId`
   * parameter here (unlike `extractTail` below) — the toolkit implementation
   * mints its own upload key.
   */
  combineVideos(options: {
    videoUrls: string[]
    transition: string
    transitionDuration?: number
    audioMode?: "keep" | "crossfade" | "remove"
    audioCrossfadeCurve?: string
    trimStartFrames?: number
    trimEndFrames?: number
    /** Pin the normalization canvas (both together) instead of the majority-
     *  resolution pick — edit-video-pro pins the SOURCE dims so a long bridge
     *  can never flip the majority vote and letterbox the kept footage. */
    targetWidth?: number
    targetHeight?: number
    /** PSNR boundary matcher (core `providers/video/smart-cut.ts`) — built
     *  for tail-chained continuation clips whose boundary frames are
     *  near-twins; unmatched boundaries keep the fixed trims. Additive-
     *  optional so plugin versions on either side of this member interop. */
    smartCut?: { enabled: boolean; framesFromPrev: number; framesFromNext: number; boundaryMask?: readonly boolean[] }
  }): Promise<string>
  /**
   * New core helper added alongside this contract member
   * (`providers/video/extract-tail.ts`'s `extractTailToFile`) — re-encodes
   * (never stream-copies, since a stream-copy trim snaps to the nearest
   * keyframe and can emit an undecodable tail — same rationale as
   * `trimLastFrames`, `providers/video/ffmpeg-utils.ts:404-431`) and uploads
   * the result to R2.
   */
  extractTail(url: string, seconds: number, jobId: string): Promise<string>
  /**
   * Re-encoding cut of `[startSec, endSec)` (endSec undefined = to EOF) —
   * wraps core `trimVideo` (`providers/video/trim-video.ts`, input-seek +
   * libx264) and uploads the cut to R2, returning the URL. `opts.crf`
   * overrides the default 23 (edit-video-pro cuts kept footage at 18).
   */
  trimVideo(
    url: string,
    startSec: number,
    endSec: number | undefined,
    jobId: string,
    opts?: { crf?: number },
  ): Promise<string>
  /**
   * Mirrors `probeVideoSource` (`providers/video/ffmpeg-utils.ts`) — remote-
   * capable ffprobe (SSRF-asserted, protocol-whitelisted), field rename only
   * (`durationSeconds` → `durationSec`).
   */
  probeVideoMeta(url: string): Promise<{ durationSec: number; width: number; height: number }>
  /**
   * Mirrors `runFfprobe` (`providers/video/ffmpeg-utils.ts`) — runs ffprobe with
   * the given args and resolves its stdout (the video-analysis segmenter reads
   * the keyframe packet PTS listing).
   */
  runFfprobe(args: readonly string[]): Promise<string>
  /**
   * Mirrors `getVideoDuration` (`providers/video/ffmpeg-utils.ts`) — the CONTAINER
   * duration (NOT the video-stream duration) of a local file, in seconds.
   */
  getVideoDuration(filePath: string): Promise<number>
  /**
   * Mirrors `probeMediaDuration` (`providers/video/ffmpeg-utils.ts`) — remote-
   * capable ffprobe duration (seconds) of a URL or path, SSRF-asserted. Used by
   * the route's pre-reserve duration gate.
   */
  probeMediaDuration(srcUrlOrPath: string): Promise<number>
  /**
   * Mirrors `needsTranscode` (`providers/video/ffmpeg-utils.ts`) — true when the
   * source stream isn't browser-safe and must be re-encoded.
   */
  needsTranscode(filePath: string): Promise<boolean>
  /**
   * Mirrors `transcodeToBrowserSafe` (`providers/video/ffmpeg-utils.ts`) —
   * re-encodes to a browser-safe mp4 at `outputPath`, returning the output path.
   */
  transcodeToBrowserSafe(inputPath: string, outputPath: string): Promise<string>
  /**
   * Mirrors `needsContainerRemux` (`providers/video/ffmpeg-utils.ts`) — SYNC
   * check: true when the container (not the codec) needs a remux to mp4.
   */
  needsContainerRemux(pathOrExt: string): boolean
  /**
   * Mirrors `remuxToMp4` (`providers/video/ffmpeg-utils.ts`) — stream-copy remux
   * of the input container into an mp4 at `outputPath`.
   */
  remuxToMp4(inputPath: string, outputPath: string): Promise<void>
}

// ============================================================================
// tk.media — backend/src/providers/video/{extract-audio,mix-audio,
//   merge-video-audio,audio-fx}.ts
// ============================================================================

/** Mirrors `MixAudioOptions` (`providers/video/mix-audio.ts`). */
export interface PluginMixAudioOptions {
  readonly audioUrls: readonly string[]
  readonly trackVolumes?: readonly number[]
  readonly sumTracks?: boolean
}

/** Mirrors the inline `AudioTrack` type (`providers/video/merge-video-audio.ts`). */
export interface PluginAudioTrack {
  readonly url: string
  readonly startTime: number
  readonly volume?: number
  readonly sourceType?: "audio" | "video"
}

/** Mirrors `MergeVideoAudioOptions` (`providers/video/merge-video-audio.ts`). */
export interface PluginMergeVideoAudioOptions {
  readonly videoUrl: string
  readonly audioUrl?: string
  readonly audioTracks?: readonly PluginAudioTrack[]
  readonly voiceoverVolume?: number
  readonly backgroundVolume?: number
  readonly keepOriginalAudio?: boolean
  readonly sumTracks?: boolean
}

/**
 * Mirrors `AudioFxOptions` (`providers/video/audio-fx.ts`). `preset` is
 * typed as the real `AudioFxPreset` (`@nodaro/shared`) — see the file-level
 * doc comment for why this differs from the plugin repo's structural
 * `string` copy.
 */
export interface PluginAudioFxOptions {
  readonly audioUrl: string
  readonly preset: AudioFxPreset
  readonly mix?: number
  readonly delayMs?: number
  readonly decay?: number
  readonly eqLow?: number
  readonly eqHigh?: number
}

export interface PluginMediaToolkit {
  /** Mirrors `extractAudio` (`providers/video/extract-audio.ts`). */
  extractAudio(options: { readonly videoUrl: string }): Promise<{ readonly audioPath: string }>
  /** Mirrors `mixAudio` (`providers/video/mix-audio.ts`). */
  mixAudio(options: PluginMixAudioOptions): Promise<string>
  /** Mirrors `mergeVideoAudio` (`providers/video/merge-video-audio.ts`). */
  mergeVideoAudio(options: PluginMergeVideoAudioOptions): Promise<string>
  /** Mirrors `applyAudioFx` (`providers/video/audio-fx.ts`). */
  applyAudioFx(opts: PluginAudioFxOptions): Promise<{ outputPath: string }>
  /** Mirrors `applyImageWatermark` (`utils/watermark.ts`). */
  applyImageWatermark(buffer: Buffer): Promise<Buffer>
  /**
   * Mirrors `uploadVideoMaybeWatermark` (`workers/shared.ts:513-541`) — also
   * transcodes to browser-safe when `watermark` is false. Used for the final
   * stitched output only (per-segment uploads go through
   * `storage.uploadVideoFromUrl`).
   */
  uploadVideoMaybeWatermark(
    url: string,
    jobId: string,
    userId: string | undefined,
    watermark: boolean,
  ): Promise<string>
}

// ============================================================================
// tk.storage — backend/src/lib/storage.ts, lib/post-processing-error.ts
// ============================================================================

export interface PluginStorageToolkit {
  /** Mirrors `uploadBufferToR2` (`lib/storage.ts`). */
  uploadBufferToR2(
    buffer: Buffer,
    key: string,
    contentType: string,
    trackUserId?: string,
  ): Promise<string>
  /**
   * Mirrors `uploadFileToR2` (`lib/storage.ts`). `type` is optional here to
   * express the real function's `= "video"` default — a defaulted parameter
   * value can't be expressed on a type-only member signature.
   */
  uploadFileToR2(
    filePath: string,
    jobId: string,
    type?: "image" | "video" | "audio",
    trackUserId?: string,
  ): Promise<string>
  /** Mirrors `runPostProcessing` (`lib/post-processing-error.ts`). */
  runPostProcessing<T>(fn: () => Promise<T>): Promise<T>
  /**
   * Mirrors `uploadToR2` (`lib/storage.ts:126`), narrowed to video content —
   * downloads `url` and uploads to R2 without transcoding. Used for
   * per-segment persistence in generate-video-pro.
   */
  uploadVideoFromUrl(url: string, jobId: string, trackUserId?: string): Promise<string>
  /**
   * Mirrors `uploadFileWithKeyToR2` (`lib/storage.ts`) — uploads a local file to
   * an EXPLICIT R2 key (not a jobId-derived key), returning its public URL. The
   * video-analysis worker keys its jobId-scoped tmp clips/checkpoint verbatim.
   */
  uploadFileWithKeyToR2(filePath: string, key: string, contentType: string, trackUserId?: string): Promise<string>
  /** Mirrors `r2Url` (`lib/storage.ts`) — the public CDN URL for an R2 key. */
  r2Url(key: string): string
  /** Mirrors `getR2ObjectSize` (`lib/storage.ts`) — byte size of an R2 object (0 if absent). */
  getR2ObjectSize(key: string): Promise<number>
  /** Mirrors `downloadR2ObjectToFile` (`lib/storage.ts`) — S3-origin download of an R2 object to a local path. */
  downloadR2ObjectToFile(key: string, dest: string): Promise<void>
  /** Mirrors `readR2ObjectBuffer` (`lib/storage.ts`) — S3-origin read of an R2 object into a Buffer, or null if absent. */
  readR2ObjectBuffer(key: string): Promise<Buffer | null>
  /** Mirrors `deleteFromR2` (`lib/storage.ts`) — deletes an R2 object by key. */
  deleteFromR2(key: string): Promise<void>
}

// ============================================================================
// tk.jobs — backend/src/workers/shared.ts
// ============================================================================

export interface PluginJobsToolkit {
  /** `output` is the job's OUTPUT PAYLOAD (`{ videoUrl, pro: checkpoint }`),
   *  NOT jobs-table columns — the toolkit read-merges it into `output_data`
   *  and completes via the core CAS (`workers/shared.ts` `markJobCompleted`).
   *  NEVER register the core column-level function here raw: PostgREST
   *  rejects payload keys as unknown columns ("Could not find the 'pro'
   *  column"), completion silently no-ops, and finished jobs rot in
   *  status=processing (jobs 1e209599, dbf95612). Returns false only for the
   *  cancelled/already-terminal CAS miss; transient read failures throw. */
  markJobCompleted(
    jobId: string,
    output: Record<string, unknown>,
    extraColumns?: Record<string, unknown>,
  ): Promise<boolean>
  /** Mirrors `setJobProgress` (`workers/shared.ts`). */
  setJobProgress(job: PluginJob, jobId: string, progress: number): Promise<void>
  /** Mirrors `withProgressRamp` (`workers/shared.ts`). */
  withProgressRamp<T>(
    job: PluginJob,
    jobId: string,
    opts: {
      start: number
      cap: number
      tickMs?: number
      tickStep?: number
      softCeiling?: number
      asymptoteFactor?: number
    },
    fn: () => Promise<T>,
  ): Promise<T>
  /** Mirrors `commitJobCredits` (`workers/shared.ts`). */
  commitJobCredits(
    usageLogId: string | null | undefined,
    jobId: string,
    providerCostUsd?: number | null,
    extraNonProviderCredits?: number,
    metered?: boolean,
  ): Promise<void>
  /**
   * Nulls `provider_kind` + `provider_call_started_at` on the job row so the
   * reconcile sweep doesn't treat an in-flight handler as a stale pickup
   * (precedent: the add-captions→render handoff,
   * `workers/handlers/ffmpeg.ts:482-497`). Must be called first on every
   * handler entry, including re-picks.
   */
  clearReconcileSentinel(jobId: string): Promise<void>
  /**
   * Mirrors `throwIfJobCancelled` (`lib/job-cancellation.ts`) — an ambient
   * check against the current job's cancellation flag, internally throttled
   * to once per 4s.
   */
  throwIfJobCancelled(): Promise<void>
  /**
   * Shallow-merges `patch` into the job row's `output_data` (read-merge-
   * write) — used for per-segment checkpointing. See `toolkit.ts`'s
   * `updateJobCheckpoint` implementation. See `readJobCheckpoint` below for
   * the read side.
   */
  updateJobCheckpoint(jobId: string, patch: Record<string, unknown>): Promise<void>
  /**
   * Reads and returns the job row's parsed `output_data` (or null). See
   * `toolkit.ts`'s `readJobCheckpoint` implementation.
   */
  readJobCheckpoint(jobId: string): Promise<Record<string, unknown> | null>
  /**
   * Mirrors `markProviderCallStart` (`lib/reconcile/persistence.ts`) — stamps
   * `provider_kind` + `provider_call_started_at=now` on the job row. The
   * video-analysis handler heartbeats `"pre-task"` every 60s so the reconcile
   * sync-sweep never races a live 300s LLM window. `kind` is the reconcile
   * `ProviderKind` (kept as `string` here — structural, no import).
   */
  markProviderCallStart(jobId: string, kind: string): Promise<void>
}

// ============================================================================
// tk.http — supabase / queue / credit-guard / request-helpers / zod-error
// ============================================================================

/**
 * Minimal `from().insert().select().single()` chain — the ONLY supabase
 * usage in the VCP route (`ee/routes/voice-changer-pro.ts`). This is NOT a
 * general Supabase client mirror; it is shaped strictly to that one call
 * site, per the Stage 1 "minimal structural interface" rule.
 *
 * `single()` is typed `PromiseLike`, not `Promise` (Task 9 correction: the
 * original mirror declared `Promise`, but `lib/supabase.ts`'s real client is
 * built via `createClient(...)` with no explicit `Database` generic, so its
 * `.from().insert().select().single()` chain resolves to postgrest-js's
 * `PostgrestBuilder`, which implements ONLY `PromiseLike` (`.then`) — it has
 * no `.catch`/`.finally`/`Symbol.toStringTag`, so it is NOT structurally
 * assignable to `Promise`. Verified via `tsc --noEmit` in Task 9 — assigning
 * the real `supabase` export to `PluginHttpToolkit.supabase` failed under
 * the `Promise` declaration with exactly this missing-members error.
 * `PromiseLike` is strictly wider (every `Promise` is a `PromiseLike`) and is
 * the accurate description of "the ONE thing every real call site does:
 * `await` the result" — no behavior changes for any caller.
 * The plugin repo's hand-synced copy (`nodaro-cloud-plugins`
 * `src/contract.ts`) carries the same `PromiseLike` typing — synced in
 * nodaro-cloud-plugins@894e2c4 ("fix(contract): single() returns
 * PromiseLike", referencing this repo's types.ts@241da6f5) — so the two
 * copies are in sync on this member. There is still no automated sync (see
 * the file header); any future edit here must be hand-mirrored there.
 */
export interface PluginSupabaseClient {
  from(table: string): {
    insert(values: Record<string, unknown>): {
      select(columns: string): {
        single(): PromiseLike<{ data: { id: string } | null; error: { message: string } | null }>
      }
    }
  }
}

/** Mirrors `CreditReservation` (`middleware/credit-guard.ts`). */
export interface PluginCreditReservation {
  usageLogId: string
  creditsReserved: number
  watermark: boolean
  creditOverride?: number
}

/** Mirrors `CreditGuardOpts` (`middleware/credit-guard.ts`). */
export interface PluginCreditGuardOpts {
  computeCredits?: (parsedBody: unknown) => number | Promise<number>
  dedup?: boolean
}

/**
 * Minimal structural mirror of the undici `Response` subset `fetchImageBytes`
 * actually reads: `.ok`, `.status`, `.headers.get(...)`, `.arrayBuffer()`.
 */
export interface PluginFetchResponse {
  readonly ok: boolean
  readonly status: number
  readonly headers: { get(name: string): string | null }
  arrayBuffer(): Promise<ArrayBuffer>
}

/**
 * Mirrors the return shape of `computeGenerateVideoProPricing`
 * (`ee/billing/generate-video-pro-credits.ts`) — the pro split/pricing
 * formula's single source of truth, shared by the route's credit-guard
 * `computeCredits` and the node-executor override path.
 */
export interface GenerateVideoProPricing {
  mode: "single" | "multi"
  clampedDurationSec: number
  segmentCount: number
  totalRawSec: number
  segmentDurations: number[]
  feeBase: number // 0 when mode === "single"
  noRefPerSec: number
  refPerSec: number
  tailSec: number
  reserveBase: number // pre-markup
  creditIdentifier?: string // single mode: the plain composite identifier
}

/**
 * Mirrors the return shape of `computeEditVideoProPricing`
 * (`ee/billing/edit-video-pro-credits.ts`) — the edit-video-pro reserve
 * formula's single source of truth (route computeCredits + DAG override +
 * the engine's commit math all derive from it). Reserve probes the source
 * server-side (spec rev4); `probe` is null when the probe failed and the
 * reserve worst-cased (top tier + tail/refIn assumed).
 */
export interface EditVideoProPricing {
  mode: "replace"
  spanStartSec: number
  spanEndSec: number // possibly clamped: ≤ spanStart+maxSpan, and ≤ probed D
  clampedSpanSec: number
  maxSpanSec: number
  segmentCount: number
  segmentDurations: number[]
  totalRawSec: number // S′ at reserve
  refsSecReserve: number
  outerSeamLossReserve: number
  feeBase: number
  refPerSecByResolution: Record<string, number>
  reserveResolution: string
  reserveBase: number // pre-markup
  probe: { width: number; height: number; durationSec: number } | null
  /** Probe succeeded AND requested spanEnd > D + tolerance. Money was clamped
   *  to D; callers REJECT before reserving (route 400 / DAG throw). */
  spanExceedsSource: boolean
}

export interface PluginHttpToolkit {
  /** Mirrors `supabase` (`lib/supabase.ts`), shaped to VCP route usage. */
  supabase: PluginSupabaseClient
  /** Mirrors `videoQueue` (`lib/queue.ts`), narrowed to the one method used. */
  videoQueue: { add(name: string, data: Record<string, unknown>, opts?: { attempts?: number }): Promise<unknown> }
  /** Mirrors `creditGuard` (`middleware/credit-guard.ts`). */
  creditGuard(
    modelResolver: (req: FastifyRequest) => string,
    opts?: PluginCreditGuardOpts,
  ): (req: FastifyRequest, reply: FastifyReply) => Promise<void>
  /** Mirrors `reserveCreditsForJob` (`middleware/credit-guard.ts`). */
  reserveCreditsForJob(
    req: FastifyRequest,
    reply: FastifyReply,
    jobId: string,
    modelIdentifier: string,
  ): Promise<PluginCreditReservation | undefined>
  /** Mirrors `safeUrlSchema` (`lib/url-validator.ts`). */
  safeUrlSchema: ZodType<string>
  /** Mirrors `extractWorkflowId` (`lib/request-helpers.ts`). */
  extractWorkflowId(body: unknown): string | null
  /** Mirrors `extractNodeId` (`lib/request-helpers.ts`). */
  extractNodeId(body: unknown): string | null
  /** Mirrors `extractForcePrivate` (`lib/request-helpers.ts`). */
  extractForcePrivate(body: unknown): boolean
  /** Mirrors `extractMcpClient` (`lib/extract-mcp-client.ts`). */
  extractMcpClient(rawBody: unknown): string | null
  /** Mirrors `buildJobInputData` (`lib/job-input-data.ts`). */
  buildJobInputData(body: Record<string, unknown>, type: string): Record<string, unknown>
  /** Mirrors `formatZodError` (`lib/zod-error.ts`). */
  formatZodError(error: ZodError): {
    message: string
    issues: Array<{ path: string; message: string }>
  }
  /**
   * Mirrors `safeFetch` (`lib/safe-fetch.ts`), narrowed: the only real call
   * site (`fetchImageBytes`) never passes `init`, so the member omits it
   * rather than importing undici's `SafeFetchInit`/`Response` types.
   */
  safeFetch(url: string): Promise<PluginFetchResponse>
  /** Mirrors `insertWithIdempotencyKey` (`lib/idempotent-insert.ts:33`). */
  insertJobWithIdempotencyKey(
    data: Record<string, unknown> & { user_id: string },
    idempotencyKey: string | null | undefined,
  ): Promise<{ id: string; created: boolean }>
  /**
   * Mirrors `computeGenerateVideoProPricing`
   * (`ee/billing/generate-video-pro-credits.ts`) — see `GenerateVideoProPricing`.
   * Core may not statically import `ee/`; the toolkit implementation reaches
   * it via a runtime-gated dynamic `import()` (mirrors
   * `middleware/credit-guard.ts`'s shim pattern and `load.ts`'s
   * `applyStaticCreditCosts`/`applyPipelinePrompts`).
   */
  computeGenerateVideoProPricing(args: {
    provider: string
    resolution: string
    durationSec: number
  }): Promise<GenerateVideoProPricing>
  /**
   * Mirrors `computeEditVideoProPricing` (`ee/billing/edit-video-pro-credits.ts`)
   * — same runtime-gated dynamic `import()` shim as
   * `computeGenerateVideoProPricing` above. `sourceUrl` optional: absent or
   * unreachable degrades to the worst-case reserve instead of throwing.
   */
  computeEditVideoProPricing(args: {
    provider: string
    sourceUrl?: string
    spanStart: number
    spanEnd: number
  }): Promise<EditVideoProPricing>
  /**
   * Mirrors `sendInternalError` (`lib/http-errors.ts`) — logs `err` server-side
   * and sends a sanitized `internal_error` 500 with the curated `clientMessage`
   * (marked so the global onSend net leaves it intact). The video-analysis route
   * uses it for the job-insert failure path.
   */
  sendInternalError(reply: FastifyReply, req: FastifyRequest, err: unknown, clientMessage?: string): FastifyReply
  /**
   * Mirrors `hostnameMatchesAllowlist` (`lib/url-validator.ts`) — exact-suffix
   * host allowlist match (SSRF gate). Used with `youtubeHosts` below for the
   * route's YouTube-URL check and the worker's D2 re-validation.
   */
  hostnameMatchesAllowlist(hostname: string, domains: readonly string[]): boolean
  /** Mirrors `YOUTUBE_HOSTS` (`lib/url-validator.ts`) — the narrow YouTube host allowlist. */
  youtubeHosts: readonly string[]
}

// ============================================================================
// tk.llm — backend/src/lib/llm-client.ts
// ============================================================================

/** Narrow mirror of `lib/llm-client.ts` llmCompleteStructured, shaped to the
 * pro planner's single call site (minimal structural interface rule). */
export interface PluginLlmRequest {
  model: string
  system?: string
  prompt: string
  maxTokens?: number
}

/**
 * Multimodal content block — a structural subset of `lib/llm-client.ts`'s
 * `LlmContentBlock` union (text | image | image_base64 | video | audio),
 * narrowed to the parts the video-analysis window turn uses (video + text;
 * image kept for forward-compat). A real app `LlmContentBlock[]` satisfies this.
 */
export type PluginLlmContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; url: string }
  | { type: "video"; url: string; mimeType?: string }

/**
 * Multimodal structured request — mirrors the subset of `lib/llm-client.ts`'s
 * `LlmRequest` the video-analysis handler builds: one or more messages whose
 * content is a block array (a per-window `[{video},{text}]` turn), plus an
 * optional per-request timeout. `system` maps to the request's system prompt.
 */
export interface PluginLlmMultimodalRequest {
  model: string
  system?: string
  messages: Array<{ role: "user" | "assistant"; content: PluginLlmContentBlock[] }>
  timeoutMs?: number
  maxTokens?: number
  /** Sampling temperature — pinned deliberately by callers that must not ride the
   *  vendor default. Mirrors `LlmRequest.temperature`. */
  temperature?: number
  /** Nucleus-sampling cutoff — pinned deliberately (1.0 disables it). Mirrors
   *  `LlmRequest.topP`. */
  topP?: number
}

export interface PluginLlmToolkit {
  /** Mirrors `llmCompleteStructured` (`lib/llm-client.ts:133`). */
  completeStructured<T>(
    req: PluginLlmRequest,
    schema: unknown, // ZodType<T> — kept opaque to avoid pinning zod's type identity across repos
    opts?: { schemaName?: string; maxRetries?: number },
  ): Promise<T>
  /**
   * Multimodal variant of `completeStructured` — mirrors `llmCompleteStructured`
   * (`lib/llm-client.ts`) called with a MULTIMODAL `messages` array. Returns BOTH
   * the validated output AND the summed `providerCost` (the video-analysis
   * handler accumulates per-window provider cost), unlike `completeStructured`
   * which unwraps to a bare `T`.
   */
  completeStructuredMultimodal<T>(
    req: PluginLlmMultimodalRequest,
    schema: unknown,
    opts?: { schemaName?: string; maxRetries?: number },
  ): Promise<{ output: T; providerCost?: number }>
}

// ============================================================================
// PluginToolkit — the full dependency-injection surface handed to every plugin
// ============================================================================

export interface PluginToolkit {
  providers: PluginProvidersToolkit
  ffmpeg: PluginFfmpegToolkit
  media: PluginMediaToolkit
  storage: PluginStorageToolkit
  jobs: PluginJobsToolkit
  http: PluginHttpToolkit
  llm: PluginLlmToolkit
}

// ============================================================================
// Engines — named callables a plugin exposes for CORE code to invoke
// directly (not a queue handler, not an HTTP route)
// ============================================================================

/**
 * One named member per extracted engine — a plugin that exposes a callable
 * computation for core code to invoke directly (not a queue handler, not an
 * HTTP route). Future engine-shaped capabilities nest here as a new optional
 * member; capabilities whose entire contribution is DATA (no callable, e.g.
 * `prompts()`) are separate top-level `NodaroPrivatePlugin` members instead.
 */
export interface PluginEngines {
  surround?: PluginSurroundEngine
}

/** Mirrors the public surface of `services/surround/index.ts` (moved to the private repo's `src/plugins/surround/`). */
export interface PluginSurroundEngine {
  buildSurroundComposite(opts: {
    referenceImageUrl: string
    direction: SurroundDirection
    carriedFraction: number
    jobId: string
    userId?: string
  }): Promise<string>
  harmonizeSurround(opts: {
    compositeUrl: string
    paintedUrl: string
    direction: SurroundDirection
    carriedFraction: number
    jobId: string
    userId?: string
    watermark: boolean
  }): Promise<string>
}

// ============================================================================
// Plugin registration surface
// ============================================================================

/**
 * Additive (S9). A plugin whose entire contribution is DATA — no routes,
 * no handlers, no pricing — implements ONLY this member. Keys are the
 * PIPELINE_PROMPT_KEYS constants (mirrored in both repos — see
 * `ee/pipelines/llms/prompt-registry.ts` here /
 * `src/plugins/film-studio-prompts/prompt-keys.ts` in the plugin repo). Values
 * are the exact doctrine string — no functions, no per-request
 * interpolation; callers substitute any placeholders (e.g.
 * "{{current_plan_json}}") themselves after lookup. Merged additively across
 * plugins (last write wins per key, mirroring the Object.assign merge
 * `handlers()` already gets) into `ee/pipelines/llms/prompt-registry.ts` via
 * `registerPipelinePrompts()`.
 */
export type PromptTable = Record<string, string>

export interface NodaroPrivatePlugin {
  name: string
  registerRoutes?(app: FastifyInstance, tk: PluginToolkit): Promise<void>
  handlers?(tk: PluginToolkit): Record<string, PluginHandlerFn>
  staticCreditCosts?(): Record<string, number>
  /**
   * Additive: named engines a plugin exposes for CORE code to call directly
   * (not a queue handler, not an HTTP route). Used when a core worker/route
   * must keep its own orchestration but delegate one self-contained,
   * IP-sensitive computation to private code. Grows the same way
   * `PluginToolkit` does — additive-only, one new optional named member per
   * capability, never removed/narrowed without a CONTRACT_VERSION bump.
   * Same shape as `handlers(tk)`: a function of the toolkit, so an engine's
   * own internals can reach shared app functionality (safeFetch, storage,
   * watermarking) through `tk` without importing an app path.
   */
  engines?(tk: PluginToolkit): PluginEngines
  /** See `PromptTable`'s doc comment above for the full contract. */
  prompts?(): PromptTable
}

export interface PrivatePluginsModule {
  contractVersion: 1
  plugins: NodaroPrivatePlugin[]
}

/**
 * Drift guard this app's loader (`load.ts`) checks before registering any
 * plugin from `@nodaroai/cloud-plugins`:
 * `module.contractVersion !== CONTRACT_VERSION` ⇒ fatal (cloud edition) or
 * warn-and-skip (`PRIVATE_MODULES=optional`).
 */
export const CONTRACT_VERSION = 1 as const
