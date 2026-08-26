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
 * this repo's `ee/pipelines/llms/prompt-registry.ts` as "here" and its
 * counterpart as "the plugin repo" — the plugin repo's copy of that same
 * comment necessarily flips those two references, same vantage-point pattern as this header comment.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify"
import type { ZodError, ZodType } from "zod"
import type { AudioFxPreset, PresetSettings, SurroundDirection } from "@nodaro/shared"

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

/**
 * Mirrors the options `generateImage` (`providers/router.ts`) accepts, folded
 * into one bag: `referenceImageUrls` maps to the router's positional param;
 * `aspectRatio`/`resolution`/`negativePrompt` map onto the snake_case
 * `extraParams` composition (`workers/handlers/image-ai.ts`); `onTaskCreated`
 * maps to `ReconcileOpts.onTaskCreated` (same adapter as
 * `PluginVideoGenOptions.onTaskCreated` — the engine checkpoints the task id;
 * `jobs.provider_task_id` is NEVER written by this path). ADDITIVE
 * (2026-08-03, gvp keyframes anchors).
 */
export interface PluginImageGenOptions {
  referenceImageUrls?: string[]
  aspectRatio?: string
  resolution?: string
  negativePrompt?: string
  onTaskCreated?: (taskId: string) => void | Promise<void>
}

/**
 * Mirrors the resolved-generation subset of `RouteResult`
 * (`providers/router.ts`) exposed for image generation — url plus the
 * provider task id (`RouteResult.kieTaskId`; image-lane providers don't
 * populate it today, so rely on `onTaskCreated` for checkpointing). ADDITIVE
 * (2026-08-03).
 */
export interface PluginImageGenResult {
  url: string
  taskId?: string
}

/**
 * Mirrors `SunoGenerateParams` (`providers/kie/suno-client.ts`) for the two
 * modes the plugin lanes use. ADDITIVE (2026-08-04, gvp keyframes music
 * post-mux); CUSTOM MODE added 2026-08-19.
 *
 * DESCRIPTION MODE (no `title`) is the original lane: `prompt` is a brief, the
 * model invents the song, and `durationSec` is advisory only (Suno's duration
 * is custom-mode-gated; the caller cuts to exact length with ffmpeg).
 *
 * CUSTOM MODE (a `title` is supplied) changes what the fields MEAN: `prompt`
 * becomes the EXACT LYRICS, `style` carries the musical description, and
 * `duration` is honoured (V5_5). Measured on a scat-ensemble recast: in
 * description mode with `instrumental: false`, Suno reads our prose as the
 * song's SUBJECT — a brief describing "singers swaying and tapping feet" came
 * back singing "step-step sway on through … feet go tap" in English. A source
 * whose vocal is non-lexical (scat, vocables, a wordless hook) can only be
 * reproduced by handing those syllables over as lyrics, which is what custom
 * mode is for.
 */
export interface PluginMusicGenOptions {
  /** Style tags riding alongside the brief ("cinematic orchestral, 120 BPM").
   *  In custom mode this is Suno's `style` — the musical description, ≤1000
   *  chars on V4_5+/V5/V5_5 (the wrapper trims). */
  style?: string
  /** Default TRUE — scores ride instrumental; voices live in the video. */
  instrumental?: boolean
  /** Advisory target seconds — EXCEPT in custom mode on V5_5, where it is the
   *  provider's own `duration` (clamped to the documented 10–360s) and the
   *  track is actually generated that long. */
  durationSec?: number
  /**
   * SUPPLYING A TITLE SELECTS CUSTOM MODE (≤80 chars, trimmed not rejected —
   * a title is metadata and losing a track over it would be absurd). Custom
   * mode additionally REQUIRES `style`; a title without one falls back to
   * description mode rather than sending a request the provider will refuse.
   */
  title?: string
  onTaskCreated?: (taskId: string) => void | Promise<void>
}

/** First track of the Suno result (`SunoTaskResult.tracks[0]`) — url +
 *  reported seconds + the provider task id for checkpointing. */
export interface PluginMusicGenResult {
  url: string
  durationSec?: number
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
   * Mirrors `videoUpscale` (`providers/router.ts`) — Topaz/VEO video
   * enhancement. Returns the provider's hosted result URL; the caller
   * re-hosts under its own deterministic key.
   */
  videoUpscale(
    videoUrl: string,
    model: string,
    upscaleFactor?: "1" | "2" | "4",
  ): Promise<{ url: string }>
  /**
   * Mirrors `imageUpscale` (`toolkit.ts` composition over
   * `providers/router.ts#editImage`) — Topaz image enhancement at a FIXED 2x
   * factor. The wrapper VERIFIES the result is the same frame (2x dims +
   * pixel alignment, `plate-gate.ts`) and re-hosts the verified bytes on R2,
   * so the returned URL is durable and gate-passed; a gate failure rejects.
   */
  imageUpscale(
    imageUrl: string,
    model: string,
  ): Promise<{ url: string }>
  /**
   * Mirrors `generateImage` (`providers/router.ts`) — provider-routed image
   * generation, folded to one options bag (`PluginImageGenOptions`; the
   * toolkit maps its fields onto the router's positional refs + snake_case
   * `extraParams`). Added for the gvp keyframes render method (2026-08-03):
   * the engine generates per-scene start/end anchor frames, hosts them, and
   * rides them as i2v start/end inputs — scenes re-render independently
   * instead of chaining continuation tails.
   *
   * OPTIONAL (additive-contract convention): absent → the app predates this
   * member; callers feature-guard (keyframes runs respond 503 "backend update
   * required" rather than crashing).
   */
  generateImage?(
    prompt: string,
    model: string,
    options?: PluginImageGenOptions,
  ): Promise<PluginImageGenResult>
  /**
   * Mirrors `sunoGenerate` (`providers/kie/suno-client.ts`) reduced to ONE
   * track from a prose brief — the gvp keyframes music lane (spec point 7):
   * the engine renders the plan's music brief as a single instrumental
   * track, cuts it to the stitched length, and muxes it AFTER finalize.
   * Music is never conditioned into the video model (Seedance mode
   * exclusivity), which is exactly why this is a separate audio-lane member
   * and not a video option.
   *
   * OPTIONAL (additive-contract convention): absent → the app predates this
   * member; callers feature-guard (music degrades to none, never crashes).
   */
  generateMusic?(
    prompt: string,
    options?: PluginMusicGenOptions,
  ): Promise<PluginMusicGenResult>
  /**
   * Mirrors the single-shot KIE record-info query the reconcile system polls
   * — `pollKieTask` (`providers/kie/client.ts`) called with `maxAttempts=1`,
   * the same call `lib/reconcile/kie.ts`'s `singlePoll` makes for
   * `provider_kind: "kie-standard"` rows — exposed as a plain function so the
   * pro engine can reconcile an in-flight checkpointed segment task on
   * resume. A `KieError` with `isUpstreamFailure` set (`isUpstreamKieFailure`,
   * same module) maps to `"failed"`; any other rejection (still generating,
   * network blip, single-attempt timeout) maps to `"processing"`.
   *
   * `contentPolicy: true` rides the failed state when the KieError carries
   * the content-screen flag — the plugin resume then goes rewrite-first
   * instead of resubmitting the rejected bytes (plugins ≥ 0.146.0; older
   * plugins ignore the extra field). Emitted only when true.
   */
  getVideoTaskStatus(taskId: string): Promise<{
    state: "processing" | "succeeded" | "failed"
    videoUrl?: string
    contentPolicy?: boolean
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
    /** PSNR boundary matcher — resolved via the smart-cut registry
     *  (`providers/video/smart-cut.ts`), which the private plugin's
     *  `engines.smartCut` fills at worker boot (the algorithms moved
     *  private 2026-07-24; gvp/evp stitches run in the video worker, so
     *  the engine is present whenever a plugin stitch runs). Built for
     *  tail-chained continuation clips whose boundary frames are
     *  near-twins; unmatched boundaries keep the fixed trims. Additive-
     *  optional so plugin versions on either side of this member interop. */
    smartCut?: { enabled: boolean; framesFromPrev: number; framesFromNext: number; boundaryMask?: readonly boolean[]; mode?: "best-pair" | "preroll-keep-prev" | "preroll-keep-next" }
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
  /**
   * Mirrors `mediaObjectKey` (`lib/storage.ts`) — THE key builder for produced
   * media (`images/` / `videos/` / `audios/`). Plugins that hand
   * `uploadBufferToR2` a raw key build it here instead of spelling a prefix
   * (#754: singular `audio/…` keys split the audio store). Optional: added
   * 2026-08-23, older loaders simply do not provide it.
   */
  mediaObjectKey?(id: string, type: "image" | "video" | "audio", ext?: string): string
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
  /** Host-aware inverse of `r2Url`; rejects foreign/user-owned URLs. */
  r2KeyFromOurUrl(url: string): string | null
  /** Mirrors `copyRecastObject` (`lib/storage.ts`) — physically copies one
   *  recast-owned R2 object to a fork-owned `destKey` (R2-to-R2, audio-aware
   *  ContentType); returns the fork URL + source byte size. Recast fork only. */
  copyRecastObject(sourceUrl: string, destKey: string): Promise<{ url: string; bytes: number }>
  /** Mirrors `reserveStorageIfWithinLimit` (`utils/file-validation.ts`) — atomically
   *  reserve `bytes` against the user's quota; false if it would exceed the cap. */
  reserveStorage(userId: string, bytes: number): Promise<boolean>
  /** Mirrors `refundStorage` (`utils/file-validation.ts`) — release a prior reservation. */
  refundStorage(userId: string, bytes: number): Promise<void>
  /**
   * Mirrors `storeImportedImageBuffer` (`lib/media-import.ts`) — the buffer
   * half of the image-import pipeline: sharp decode gate (HEIC→JPEG
   * transcode), atomic storage-quota reservation, R2 upload, best-effort
   * thumbnail, asset record. Returns the same discriminated result shape as
   * `importImageFromUrl` — callers map `ok: false` onto their route's error
   * envelope (`status`/`code`/`message` + optional `details`). Additive
   * (2026-07-29, extension-reimagine's base64 image path).
   */
  storeImportedImageBuffer(args: {
    userId: string
    body: Buffer
    uploadSource: "url_import" | "manual_upload"
    sourceUrl?: string
    filename?: string
  }): Promise<
    | {
        ok: true
        url: string
        thumbnailUrl: string | null
        assetId: string | null
        mimeType: string
        sizeBytes: number
        filename: string
      }
    | { ok: false; status: 400 | 413 | 422; code: string; message: string; details?: Record<string, unknown> }
  >
}

// ============================================================================
// tk.jobs — backend/src/workers/shared.ts
// ============================================================================

export interface PluginJobsToolkit {
  /** Persist the pre-watermark Recast remux base outside owner-readable jobs JSON. */
  storeRecastAudioBase(args: {
    gvpJobId: string
    userId: string
    baseUrl: string
  }): Promise<void>
  /** Read the selected GVP run's server-only remux base. */
  readRecastAudioBase(args: {
    gvpJobId: string
    userId: string
  }): Promise<string | null>
  /** Remove a base staged for a GVP completion that lost its terminal CAS. */
  clearRecastAudioBase(args: {
    gvpJobId: string
    userId: string
    baseUrl: string
  }): Promise<void>
  /** Narrow idempotency replay lookup for revisioned Recast rescores. */
  findJobByIdempotencyKey(
    userId: string,
    idempotencyKey: string,
  ): Promise<{
    id: string
    status: string
    input_data: Record<string, unknown> | null
    output_data: Record<string, unknown> | null
    error_message: string | null
  } | null>
  /**
   * Atomically claims the selected Recast audio revision for one live child.
   * The database resolves initial audio from the selected GVP row, repairs a
   * stale terminal pending child, and refuses a genuinely live competitor.
   */
  claimRecastRescore(args: {
    recastId: string
    childJobId: string
    userId: string
    gvpJobId: string
    expectedAudioRevision: string
    pendingRescore: Record<string, unknown>
  }): Promise<Record<string, unknown>>
  /** Clears `audio.pendingRescore` only when it still belongs to this child. */
  clearRecastRescoreClaim(args: {
    recastId: string
    childJobId: string
    userId: string
  }): Promise<boolean>
  /** Atomically publishes a legacy baked result and completes its live child. */
  publishLegacyRecastRescore(args: {
    recastId: string
    childJobId: string
    userId: string
    gvpJobId: string
    resultUrl: string
    rescore: Record<string, unknown>
  }): Promise<boolean>
  /**
   * Atomically publishes the policy-compliant delivery/current Music state,
   * replaces the terminal manifest, clears the matching claim, and completes
   * the still-live child.
   */
  publishRecastRescore(args: {
    recastId: string
    childJobId: string
    userId: string
    gvpJobId: string
    expectedAudioRevision: string
    resultUrl: string
    audio: Record<string, unknown>
    rescore: Record<string, unknown>
  }): Promise<boolean>
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
  /**
   * Reads a job row by id. Returns the job's id, status, user_id,
   * output_data (jsonb object or null), and error_message, or null if not found.
   * Mirrors a narrow jobs-row read for the pipeline seed lane.
   *
   * `job_type` + `input_data` are ADDITIVE-OPTIONAL (2026-07-21, gvp
   * stop/continue): the app-side select gained them for the continue route
   * (parent-job validation + payload rebuild). Optional in this mirror so a
   * plugin built against the new surface still typechecks against an older
   * app — call sites MUST runtime-guard (`undefined` → the app predates the
   * widened select → respond 503 "backend update required").
   */
  readJob(jobId: string): Promise<{
    id: string
    status: string
    user_id: string | null
    output_data: Record<string, unknown> | null
    error_message: string | null
    job_type?: string
    input_data?: Record<string, unknown> | null
  } | null>
  /**
   * Mirrors `requestJobStop` (`workers/shared.ts`, 2026-07-21) — stamps
   * `jobs.stop_requested_at = now()` on the row. The GRACEFUL-STOP signal:
   * unlike cancel it never flips `status`, so `markJobCompleted`'s live-status
   * CAS still accepts the partial delivery. Observed by the engine through
   * the SAME throttled ambient check as cancellation: `throwIfJobCancelled`
   * throws a `JobStopRequestedError` (identified by `.name ===
   * "JobStopRequestedError"`; cancellation wins when both flags are set).
   * The gvp handler converts it into a partial finalize + honest settle —
   * it must NEVER propagate to the worker layer.
   *
   * OPTIONAL (additive-contract convention): absent → the app predates the
   * stop surface; the stop route responds 503 instead of crashing.
   */
  requestJobStop?(jobId: string): Promise<void>
  /**
   * Route-side CAS fail for SYNCHRONOUS priced routes (first consumer:
   * `/v1/recast/revise`, which has no worker to own its failure path).
   * Flips only LIVE rows (pending/processing) and returns whether WE
   * flipped it — callers refund only on true, mirroring the workers'
   * only-if-we-flipped discipline.
   *
   * OPTIONAL (additive-contract convention): absent → 503 "backend update
   * required" from the consuming route.
   */
  markJobFailed?(jobId: string, errorMessage: string): Promise<boolean>
  /**
   * Exposes the worker-layer refund (`workers/shared.ts` `refundJobCredits`)
   * to routes. Falsy usageLogId no-ops; a string reason always refunds
   * (pre-provider failures — the only kind a synchronous route produces).
   *
   * OPTIONAL (additive-contract convention): absent → 503 from the route.
   */
  refundJobCredits?(usageLogId: string, jobId: string, reason: string): Promise<void>
  /**
   * The recast direction gate's re-take waiver predicate, as ONE dedicated
   * query (six filters + an OR — the generic select mirror cannot express
   * it, and `maybeSingle()` errors on ≥2 rows). True iff a completed recast
   * PLANNING row (`input_data.type === "recast"`, never `recast-revise`)
   * exists for this user + workflow + analysis AND (created before
   * `cutoverIso` OR `input_data.direction` present).
   *
   * OPTIONAL (additive-contract convention): absent → the gate treats the
   * waiver as un-checkable and responds 503 rather than mis-gating.
   */
  hasWaivingRecastRun?(q: {
    userId: string
    workflowId: string
    analysisJobId: string
    cutoverIso: string
  }): Promise<boolean>
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
 *
 * 2026-07-27 — DELIBERATE ASYMMETRY vs the plugin-side copy: the plugin
 * contract (`nodaro-cloud-plugins` `src/contract.ts`) additionally declares a
 * standalone `from().select().eq().eq().maybeSingle()` chain — the recast
 * create route's workflow ownership pre-check (the honest-400 fix for the
 * `jobs_workflow_id_fkey` 500). That chain is runtime-true here (this file's
 * `buildToolkit` passes the REAL supabase client, which has the full query
 * surface) but is NOT declared on this mirror: checking the real client's
 * generic `select` against any structural `select` signature sends
 * postgrest-js's type-level select-string parser into unbounded instantiation
 * and fails the `buildToolkit` return with TS2589 ("excessively deep") —
 * verified 2026-07-27 with both `string` and literal `"id"` column typings.
 * So this side stays shaped to what tsc CAN verify (the insert chain), and
 * the plugin side documents the wider runtime promise.
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
  /** CONTINUATION billing floor (2026-07-21, gvp continue): 1-based segment
   *  the CHILD job starts paying from. Segments below it were delivered and
   *  billed by the parent job — `commitBase` charges only `feeBase` + the
   *  ref-rate for segments ≥ this index (each consumes a continuation tail,
   *  including the first new one, which re-seeds off the parent prefix).
   *  Absent / 1 → the classic formula, byte-identical. */
  billFromSegment?: number
  /** KEYFRAMES render method (2026-08-03) — present ONLY when the run was
   *  priced under it (scene-decomposed: every segment at the no-ref rate, no
   *  continuation-tail term). Absent → the classic extend chain. This is also
   *  how a plugin detects an app that predates the field: request
   *  `renderMethod: "keyframes"` and check whether it comes back. */
  renderMethod?: "keyframes"
  /** KEYFRAMES anchor budget (pre-markup, already included in `reserveBase`)
   *  — WORST CASE: 2 anchor images per segment at the anchor image model's
   *  base credit. The engine commits actuals (metered down), so this only
   *  ever refunds. Absent on extend runs and on keyframes CONTINUATIONS,
   *  which re-use the parent's already-paid-for anchors. */
  anchorReserve?: number
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
  /** Applies the same configured service/global markup used by creditGuard to
   *  a dynamic pre-markup total, without checking balance or reserving it. */
  applyCreditMarkup(modelIdentifier: string, baseCredits: number): Promise<number>
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
    /** Per-join continuation-tail length (seconds), clamped app-side to
     *  [2, 5]; omitted → default 2. Additive-optional (no contract bump). */
    tailSec?: number
    /** Recommended segment length (seconds), clamped app-side to [4, 15];
     *  omitted → the classic pack-to-cap split. Additive-optional. */
    preferredSegmentSec?: number
    /** EXPLICIT per-segment durations (scene-aligned split, 2026-08-03) —
     *  validated app-side (ints 4..15, ≤24 entries, sum ===
     *  ceil(clampedD + 0.3×(n−1)); throws otherwise) and priced VERBATIM;
     *  echoed back on `GenerateVideoProPricing.segmentDurations`, which is how
     *  a plugin detects an older app that ignored the field. Takes precedence
     *  over `preferredSegmentSec`. Additive-optional (no contract bump). */
    segmentDurations?: number[]
    /** RENDER METHOD (2026-08-03) — "keyframes" prices the scene-decomposed
     *  shape: every segment at the no-ref rate, NO continuation-tail term,
     *  plus a worst-case 2-anchors-per-segment budget (see
     *  `GenerateVideoProPricing.renderMethod`/`anchorReserve`). Omitted /
     *  "extend" → the classic chain, byte-identical. Additive-optional. */
    renderMethod?: "extend" | "keyframes"
    /** ANCHORS ALREADY BOUGHT (interactive mode S2, 2026-08-04): the run is
     *  rendering from stills the caller already generated and paid for, so it
     *  holds NO anchor budget — without this a 14-scene run reserves ~1,260
     *  credits it will never spend, which is how a run 402s at the finish line
     *  on a balance that was always sufficient. `anchorReserve` is then absent
     *  from the result, which is also how a plugin detects an older app that
     *  ignored the field (it would come back non-zero). Additive-optional. */
    anchorsSeeded?: boolean
    /** ANCHOR ASPECT (2026-08-04) — the ratio the anchor wave will actually
     *  render at (`"adaptive"`/absent resolved to `"16:9"` plugin-side by
     *  `anchorAspectFor`). Keyframes only; moves ONLY the anchor unit price,
     *  since ratios GPT Image 2 cannot render (21:9) fall back to the pricier
     *  nano-banana-pro. Additive-optional — absent prices at that fallback,
     *  which is exactly what a plugin predating the field spends. */
    aspectRatio?: string
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
   * Mirrors `computeGenerateVideoProContinuationPricing`
   * (`ee/billing/generate-video-pro-credits.ts`, 2026-07-21) — the CONTINUE
   * reserve: the parent plan's segment durations are already known, so the
   * reserve is exact (no worst-case padding): `feeBase` + segments ≥
   * `fromSegment` at the ref rate (each new segment consumes one continuation
   * tail — including the first, which re-seeds off the parent prefix);
   * `fromSegment === 1` degenerates to the fresh-run formula over the same
   * fixed durations. Returns a `GenerateVideoProPricing` with
   * `billFromSegment` set so `commitBase` bills only the new segments.
   *
   * OPTIONAL (additive-contract convention): absent → the app predates the
   * continue surface; the continue route responds 503 instead of crashing.
   */
  computeGenerateVideoProContinuationPricing?(args: {
    provider: string
    resolution: string
    /** The PARENT plan's per-segment durations (money-authoritative — from
     *  the parent checkpoint's embedded pricing, never recomputed). */
    segmentDurations: number[]
    /** 1-based first segment the child regenerates (and pays for). */
    fromSegment: number
    /** Per-join continuation-tail seconds, clamped app-side to [2,5]. */
    tailSec?: number
    /** RENDER METHOD (2026-08-03) — "keyframes" bills the re-rendered
     *  segments at the no-ref rate with NO continuation tails and NO anchor
     *  reserve (the parent's anchors are re-used). Omitted / "extend" → the
     *  classic continuation, byte-identical. Additive-optional. */
    renderMethod?: "extend" | "keyframes"
  }): Promise<GenerateVideoProPricing>
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
  /** Sampling temperature — pinned deliberately by callers that must not ride the
   *  vendor default (the video-analysis grader pins 0 for a deterministic judge).
   *  Mirrors `LlmRequest.temperature`. Additive-optional. */
  temperature?: number
  /** Nucleus-sampling cutoff (`top_p`) — pinned deliberately (1.0 disables it).
   *  Mirrors `LlmRequest.topP`. Additive-optional. */
  topP?: number
  /** Reasoning effort (`low`–`max`), clamped per model by the app's registry.
   *  Mirrors `LlmRequest.reasoningEffort`. Additive-optional — INERT until the
   *  plugin repo mirrors the field in its own `contract.ts`. Note the output-cap
   *  floor for reasoning models does NOT depend on this: `deriveParams` floors on
   *  the registry's `thinkingDefaultOn`, so a plugin that sends no effort still
   *  gets headroom. */
  reasoningEffort?: string
  /**
   * Pin the serving lane and disable fallback. Additive-optional; UNSET by
   * default here, because this text-only path serves many plugins (gvp/evp
   * planners, film-studio doctrine) that should keep the registry's
   * cost-aware routing. A video-analysis text step that must not touch KIE
   * passes `"direct"` explicitly — the multimodal variant defaults to it.
   */
  requireLane?: "direct" | "kie"
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
  | {
      type: "video"
      url: string
      mimeType?: string
      /**
       * Frame sampling rate — Gemini's default is 1 fps, and this is the only
       * way to give an analysis roll more frames of the same clip. Mirrors
       * `LlmContentBlock`'s field; see there for the token cost (~66/frame).
       *
       * Additive-optional, so a plugin built before this field is unaffected and
       * `CONTRACT_VERSION` does not move. Only meaningful on the direct lane —
       * the KIE builder throws rather than silently sampling at 1 fps — which
       * the multimodal path already pins by default.
       */
      fps?: number
    }

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
  /** Reasoning depth. Present on the text-only `PluginLlmRequest` since the
   *  toolkit's first version; its absence HERE meant a multimodal caller could
   *  never request thinking, silently riding the vendor default no matter what
   *  it passed — which measurably cost analysis quality on the rolls.
   *  Same loose-string rationale as the text variant — `effectiveReasoningEffort`
   *  ignores anything off the ladder, so an unknown value degrades to the vendor
   *  default rather than a 400. */
  reasoningEffort?: string
  /**
   * Pin the serving lane and disable fallback. Additive-optional, so an older
   * plugin that never sets it is unaffected (no CONTRACT_VERSION bump).
   *
   * **This path DEFAULTS to `"direct"`** — it is the video-analysis lane, and
   * analysis must never be served through KIE: KIE reaches Gemini via the
   * `image_url` URL-smuggling hack rather than real media parts, so a silent
   * fallback would produce differently-grounded analysis instead of an error.
   * Pass `"kie"` explicitly to opt a non-analysis multimodal caller out.
   */
  requireLane?: "direct" | "kie"
  /**
   * Reject the response unless the provider reports at least this many PROMPT
   * tokens — the media fail-open guard. Additive-optional.
   *
   * Set it whenever this request carries media the answer depends on and the
   * call may reach the proxied lane, where a call can silently lose its media
   * and answer about a video it never saw — detectable because the reported
   * prompt tokens come back at system-prompt size. Only the caller knows how
   * much media it sent, so it supplies the floor —
   * typically `systemPromptTokens + durationSec * (a conservative
   * tokens-per-second)`. See `LlmRequest.minPromptTokens` in llm-client.ts.
   */
  minPromptTokens?: number
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
// tk.pipelines — backend/src/ee/pipelines/* seed-lane execution
// ============================================================================

/**
 * Seeded pipeline input — the request shape for `createSeeded` and estimation.
 * Structural mirror of `SeededPipelineInput` (`ee/pipelines/seed-pipeline.ts`).
 * `plan` and `scenes[].sceneNodeData` are `unknown` on the wire; the seed lane
 * validates them against `ShowrunnerPlanSchema` and `SceneNodeDataSchema`
 * respectively.
 */
export interface SeededPipelineInput {
  userId: string
  workflowId: string
  rootNodeId?: string
  inputPrompt: string
  plan: unknown
  scenes?: Array<{ sceneIndex: number; sceneNodeData: unknown }>
  config?: Record<string, unknown>
  maxCostCredits?: number
}

/** Seeded pipeline estimate input — the subset of `SeededPipelineInput` used for credit estimation. */
export type SeededPipelineEstimateInput = Pick<SeededPipelineInput, "plan" | "scenes" | "config">

/**
 * Pipeline snapshot — the status/progress shape returned by `getSnapshot`.
 * Structural mirror of the seeded-run status query result: the
 * `GET /v1/pipelines/:id` select (`routes/pipelines.ts`) plus the
 * `pipeline_stages` list (ordered by `stage_order`), with
 * `final_output_asset_id` resolved to a public `finalOutputUrl`.
 */
export interface PipelineSnapshot {
  id: string
  status: string
  currentStage: string | null
  stages: Array<{ stageName: string; status: string }>
  spentCredits: number
  reservedCredits: number
  upfrontCreditEstimate: number
  finalOutputUrl: string | null
  failureReason: string | null
  progressMessage: string | null
}

/**
 * Pipelines toolkit — the seeded execution and monitoring surface
 * (`ee/pipelines/seed-pipeline.ts` + `ee/pipelines/credits.ts`, reached from
 * core `toolkit.ts` via a runtime dynamic `import()`).
 */
export interface PluginPipelinesToolkit {
  /**
   * Creates a seeded pipeline from the input and immediately reserves credits.
   * Returns the pipeline id and reserved credit amount.
   */
  createSeeded(input: SeededPipelineInput): Promise<{ pipelineId: string; reservedCredits: number }>
  /**
   * Estimates credits for a seeded pipeline without executing it.
   * Returns the total credits and a breakdown by stage.
   */
  estimateSeeded(
    input: SeededPipelineEstimateInput,
  ): Promise<{ totalCredits: number; breakdown: Record<string, number> }>
  /**
   * Gets the current snapshot (status, progress, credits) of a seeded pipeline.
   * Returns null if the pipeline is not found or ownership check fails.
   */
  getSnapshot(pipelineId: string, userId: string): Promise<PipelineSnapshot | null>
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
  pipelines: PluginPipelinesToolkit
  redis: PluginRedisToolkit
  auth: PluginAuthToolkit
  /**
   * The service-role Supabase client, for a plugin that owns tables of its
   * own and needs a real query surface (filters, ordering, pagination,
   * writes, RPC) rather than the single insert chain `http.supabase` was
   * shaped to.
   *
   * Declared here with the SAME narrow structural type as `http.supabase`,
   * deliberately: checking the real postgrest-js client against a structural
   * `select` signature sends its type-level select-string parser into
   * unbounded instantiation (TS2589), so this side declares only what its own
   * tsc can verify against the real client. The plugin side declares the
   * wider surface it relies on — one runtime client, two true declarations,
   * the same asymmetry `PluginSupabaseClient` already documents.
   *
   * SERVICE ROLE: every query bypasses row-level security. Authorization is
   * the calling route's job, never the database's.
   */
  db: PluginSupabaseClient
  /**
   * Feature switches the host has turned on, each mirroring one edition /
   * env gate. Always present on this side; the plugin side declares it
   * OPTIONAL and reads absence as off, so a plugin built for a newer app
   * registers nothing for a feature this app has not enabled. The loader
   * registers every plugin's routes unconditionally and cannot know which
   * belong to a gated feature — the plugin checks here and stays dark.
   */
  features: PluginFeatures
  /**
   * Where this install lives, for links a plugin puts in front of people
   * (an invitation email, a share link). The public origin is decided in
   * exactly one place on the app side (`lib/deployment-urls.ts`, with its
   * fallback); a plugin must never carry a copy of that default.
   */
  deployment: PluginDeploymentToolkit
  /**
   * Organization money-in (E2/P13). OPTIONAL and additive: a plugin built
   * against this member must `?.`-guard it, because it may load on an older
   * host that predates it (the contract's standing additive rule — no
   * CONTRACT_VERSION bump). The Stripe SDK and the `ee/billing` glue stay on
   * the host; the plugin only ever asks for a URL.
   */
  billing?: PluginBillingToolkit
}

/**
 * The two Stripe operations the organization billing routes need. Implemented
 * host-side over `ee/billing/org-customer.ts` (the plugin cannot import
 * `ee/`); everything else about org money is a database RPC the plugin calls
 * through `db`.
 */
export interface PluginBillingToolkit {
  /**
   * A Checkout session for one prepaid org pack. Null when the packId is not
   * in the ladder — the route turns that into a 400, never a Stripe call.
   */
  createOrgPackCheckout(orgId: string, actorUserId: string, packId: string): Promise<{ url: string } | null>
  /** The org customer's Stripe portal (receipts). Null when the org has never bought. */
  getOrgCustomerPortalUrl(orgId: string): Promise<{ url: string } | null>
}

/** One member per gated feature. `organizations` = `hasOrganizations()`. */
export interface PluginFeatures {
  organizations: boolean
}

export interface PluginDeploymentToolkit {
  /** `appBaseUrl()` — the install's public origin, no trailing slash. */
  publicUrl: string
}

// ============================================================================
// Redis + auth toolkit groups
// ============================================================================

/**
 * The app's Redis connection, narrowed to the key-value operations a plugin
 * needs for caches, counters and rate limits. `url` is exposed because a
 * plugin may need to hand a connection string to a library of its own
 * (a sync server's Redis extension, say) rather than issue commands itself.
 *
 * Structural mirror of the `ioredis` client in `backend/src/lib/queue.ts`
 * (`get`/`set`/`del`/`incr`/`expire`/`ttl` are all real members). Values are
 * plain strings: whatever a plugin caches, it serializes itself.
 */
export interface PluginRedisToolkit {
  url: string
  kv: {
    get(key: string): Promise<string | null>
    /** SET with an optional TTL in seconds (`EX`). */
    set(key: string, value: string, ttlSeconds?: number): Promise<void>
    del(...keys: string[]): Promise<number>
    incr(key: string): Promise<number>
    expire(key: string, seconds: number): Promise<number>
    /** Remaining TTL in seconds; negative when absent or unexpiring. */
    ttl(key: string): Promise<number>
  }
}

/**
 * Platform-role questions. Org and workspace roles are the plugin's own
 * concern (it owns those tables); this is only about the PLATFORM staff role
 * on `profiles`, which core owns and caches.
 */
export interface PluginAuthToolkit {
  /** `profiles.role` ∈ (admin, super_admin). */
  isPlatformAdmin(userId: string): Promise<boolean>
  /** The raw role, so a plugin can require `super_admin` specifically. */
  platformRole(userId: string): Promise<string | null>
}

// ============================================================================
// Services — capabilities a plugin exposes to CORE SEAMS
// ============================================================================

/**
 * The caller's memberships, as the plugin loaded them. Core never interprets
 * these; it passes them to the plugin's own resolvers. Shapes are structural
 * mirrors of the organization tables.
 */
export interface PluginMemberships {
  organizations: Array<{
    orgId: string
    role: "owner" | "admin" | "member"
    /** The MEMBER's standing in the organization. */
    status: "active" | "suspended"
    /** The ORGANIZATION's own status; only `active` ones grant context. */
    orgStatus?: "pending" | "active" | "suspended" | "deleted"
  }>
  workspaces: Array<{
    workspaceId: string
    orgId: string
    role: "admin" | "member"
    status: "active" | "suspended"
  }>
}

/** What `resolveRequestContext` decided about one request. */
export interface PluginRequestContextResult {
  workspaceId?: string
  orgId?: string
  /**
   * Whether `workspaceId` names an ARCHIVED workspace.
   *
   * An archived workspace still resolves — archiving makes it read-only, it
   * does not revoke membership, and someone must still be able to open it and
   * read what is inside. So the flag rides alongside the id rather than
   * turning into a refusal here.
   *
   * Core needs it because "read-only" is enforced in two places that see
   * different things. A browser reading through Supabase meets the row
   * policies, which already cap an archived workspace at view. A REST or SDK
   * caller does not: those routes run with the service role and bypass row
   * policies entirely, so without this flag archiving would be read-only in
   * the browser and read-write through the API — the same workspace giving
   * two different answers about whether it can be written to.
   *
   * Optional-by-absence, like every other member of this contract. A plugin
   * build older than this one never sets it, which core reads as "not
   * archived" — the same permissive answer core gives today, so an older
   * plugin keeps working exactly as it does now rather than failing shut on a
   * field it has never heard of. The enforcement is therefore inert until a
   * plugin supplies the flag.
   */
  archived?: boolean
  /** Present when the request must be refused; core sends it verbatim. */
  reject?: { status: 400 | 403; code: string; message: string }
}

export interface PluginRequestContextInput {
  userId: string
  /** Raw `X-Nodaro-Workspace` value, if the request carried one. */
  headerWorkspaceId?: string
  /** Workspace a personal API token is bound to, if any. */
  tokenWorkspaceId?: string
  /**
   * Identity-establishing routes (`GET /v1/me`, invitation accept, workspace
   * list) treat a STALE header as absent rather than refusing: a client that
   * cached a workspace it has since been removed from must still be able to
   * call the endpoint that would tell it so.
   */
  identityRoute: boolean
}

/**
 * Organization capabilities the core seams reach through
 * `getPluginServices().orgs`. Absent (community/business, or a plugin that
 * predates this member) ⇒ every seam behaves as "no organizations".
 */
export interface PluginOrgsService {
  resolveRequestContext(input: PluginRequestContextInput): Promise<PluginRequestContextResult>
  loadMemberships(userId: string): Promise<PluginMemberships>
  invalidateMemberships(userId: string): Promise<void>
  /** The organizations/workspaces block `GET /v1/me` merges into its payload. */
  me(userId: string): Promise<{
    organizations: unknown[]
    workspaces: unknown[]
    lastWorkspaceId: string | null
  }>

  /**
   * A workspace's settings with the preset inheritance already resolved
   * (workspace override → organization override → kind preset).
   *
   * Core asks rather than reads because the settings tables and the
   * inheritance rule are the plugin's, and a second implementation of that
   * rule in core would be a second answer to the same question.
   *
   * Optional-by-absence like every member here: a plugin build older than this
   * one simply will not have it, so core must check before calling
   * (`orgs?.getEffectiveSettings?.(…)`) and fall back rather than throw.
   */
  getEffectiveSettings?(workspaceId: string): Promise<PresetSettings>

  /**
   * The project new work lands in when a workspace is selected and the caller
   * named none. Null only if the project was deleted out from under the
   * workspace — `create_workspace_with_project` gives every workspace one, and
   * the foreign key is ON DELETE SET NULL. Core's create path must handle the
   * null rather than 500.
   */
  workspaceDefaultProject?(workspaceId: string): Promise<string | null>

  /**
   * May this user move this workflow into this project?
   *
   * The creator may; a workspace admin of BOTH sides may; a personal↔workspace
   * move is treated as "creator only, no admin clause". Core cannot answer
   * this — it turns on memberships and effective settings the plugin owns.
   */
  canMoveWorkflow?(input: CanMoveWorkflowInput): Promise<{ allowed: boolean; reason?: string }>

  /**
   * What this user may do with this workflow — the twin of the SQL
   * `workflow_access()` the row policies use.
   *
   * Core asks rather than computes. The rule reads membership, the
   * workspace's settings inheritance, the caller's collaborator grant and
   * whether the workspace is archived; all four are the plugin's to know, and
   * a second implementation in core would be a third answer to a question
   * that already has two (TypeScript here, SQL in the policies) and a parity
   * test to keep those two honest.
   */
  workflowAccess?(userId: string, workflowId: string): Promise<WorkflowAccessLevel>

  /**
   * The same answer for a caller that already loaded the row.
   *
   * Exists for cost, not convenience: every by-id route loads the workflow
   * anyway, and asking by id would fire a second read on the hottest path in
   * the product.
   */
  workflowAccessFromRow?(userId: string, row: WorkflowAccessRow): Promise<WorkflowAccessLevel>

  /**
   * May this user DELETE it? Deliberately not `access >= edit`.
   *
   * A collaborator with an editor grant may change the work and must never be
   * able to destroy it — the grant was given to help with it, not to end it.
   */
  canDeleteWorkflow?(userId: string, workflowId: string): Promise<boolean>

  /**
   * May this user RUN it? Stricter than editing, because running spends
   * money: `edit` plus ACTIVE membership when the workflow is workspace
   * -scoped. A granted editor who does not belong to the class can change it
   * and cannot start a job the class pays for.
   */
  canRunWorkflow?(userId: string, workflowId: string): Promise<boolean>

  /**
   * May this user change who ELSE the workflow is visible to?
   *
   * Creator, workspace admin, or platform admin — the twin of what
   * `check_workflows_update_allowed` (migration 338) pins for the browser.
   * Deliberately not `access >= edit`: changing the canvas and changing the
   * audience are different powers, and an editor flipping a private workflow
   * to `workspace` would be publishing someone else's work to the class.
   *
   * Core asks rather than assembles because the workspace-admin half is not
   * computable there: an organization owner or admin is an IMPLICIT admin of
   * every workspace beneath it, with no membership row to read.
   */
  canChangeWorkflowVisibility?(userId: string, workflowId: string): Promise<boolean>

  /**
   * May this user hand access to somebody ELSE?
   *
   * Wider than `canChangeWorkflowVisibility` and narrower than `edit`: the
   * creator always, a workspace admin whose `admin_access` reaches `edit`, and
   * an ordinary editor only where the workspace's `collaborators_can_invite`
   * says so. Core cannot derive it — it turns on inherited settings and on
   * implicit memberships — and uses it only to decide which controls to show.
   */
  canShareWorkflow?(userId: string, workflowId: string): Promise<boolean>

  /**
   * Record that a workspace workflow is about to be deleted by someone who is
   * not its creator, and report whether the row was actually written.
   *
   * WRITE-AHEAD, unlike every other entry in the log: core refuses the delete
   * when this resolves false. The row policies admit only the creator, so an
   * admin deleting a member's work goes through the application or nowhere,
   * and the reason that is allowed at all is that the application records it.
   * Audit-after cannot honour that — once the row is gone there is nothing
   * left to refuse.
   *
   * Returning `true` means the entry is durable. Never return `true` on a
   * failed insert to keep a caller moving; the caller is relying on the
   * opposite.
   */
  auditWorkflowDeleted?(input: WorkflowDeletedAudit): Promise<boolean>
}

/** What the audit entry for an admin-side workflow delete has to say. */
export interface WorkflowDeletedAudit {
  /** Who asked for the deletion. Never the creator — that path is not audited. */
  actorId: string
  workflowId: string
  /** Named, because an id in an audit log tells a reader nothing later. */
  workflowName: string
  /** The workflow's workspace; the entry belongs to its organization. */
  workspaceId: string
  creatorId: string
}

/**
 * How much of a workflow one person may reach.
 *
 * Ordered: `none` < `view` < `edit` < `own`. Mirrored in core's
 * `lib/workflow-access.ts`, which is what routes import — this declaration
 * exists so the contract can name it without core importing from the plugin.
 */
export type WorkflowAccessLevel = "none" | "view" | "edit" | "own"

/**
 * The columns the access rule needs off a workflow row a caller already has.
 *
 * Deliberately small: everything else the rule reads (the workspace, the
 * caller's memberships, their grant) is the plugin's to load, and widening
 * this would move that knowledge into core one column at a time.
 */
export interface WorkflowAccessRow {
  id: string
  user_id: string
  workspace_id: string | null
  visibility: string
}

/** Facts `canMoveWorkflow` decides on. Core loads them; the plugin judges. */
export interface CanMoveWorkflowInput {
  userId: string
  workflow: { id: string; userId: string; workspaceId: string | null }
  targetProject: { id: string; userId: string; workspaceId: string | null }
}

/**
 * One named member per capability a core seam can delegate. Mirrors how
 * `PluginEngines` grows: additive-only, optional, never removed or narrowed
 * without a CONTRACT_VERSION bump.
 *
 * `engines` are called by core code that keeps its own orchestration and
 * delegates one computation; `services` are called by core SEAMS that have
 * no behaviour of their own and no-op when the plugin is absent.
 */
export interface PluginServices {
  orgs?: PluginOrgsService
  /** Payer/entitlement resolution — narrowed when the billing seam lands. */
  billing?: unknown
  /** Model-policy enforcement — narrowed when the policy seam lands. */
  policy?: unknown
  /** Live-document writer — narrowed when the collaboration seam lands. */
  collab?: unknown
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
  smartCut?: PluginSmartCutEngine
}

/**
 * Combine-videos boundary matcher (2026-07-24 — the smart-cut cut-point
 * algorithms moved private, deliberately — the smart algorithm stays
 * proprietary). `combineVideos` calls this per boundary with its
 * LOCAL normalized clip paths; the returned trims are DROP COUNTS the
 * caller applies via its own frame-trim plan. Absent engine
 * (community/business, or a plugin-version lag on cloud) → the app degrades
 * every boundary to its fixed-trims fallback.
 */
export interface PluginSmartCutEngine {
  findBoundary(
    prevPath: string,
    nextPath: string,
    framesFromPrev: number,
    framesFromNext: number,
    mode: "best-pair" | "preroll-keep-prev" | "preroll-keep-next",
  ): Promise<{
    trimEndFrames: number
    trimStartFrames: number
    psnr: number
    matched: boolean
    searchedPrevFrames: number
    searchedNextFrames: number
  }>
}

/** Mirrors the public surface of `services/surround/index.ts` (moved to the plugin repo). */
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
 * `ee/pipelines/llms/prompt-registry.ts` here / its counterpart in the
 * plugin repo). Values
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
  /**
   * Additive: capabilities core SEAMS delegate to (see `PluginServices`).
   * Unlike `engines`, these back a core module that has no behaviour of its
   * own — when no plugin provides the member, the seam returns its
   * "feature absent" answer. Merged by the loader with `Object.assign`, last
   * write wins per named member.
   */
  services?(tk: PluginToolkit): Partial<PluginServices>
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
