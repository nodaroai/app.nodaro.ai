import type { PluginSceneArtifactToolkit } from "./scene3d-artifact-contract.js"
export type * from "./scene3d-artifact-contract.js"
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
import type { AudioFxPreset } from "@nodaro/shared/media"
import type { PresetSettings } from "@nodaro/shared/organizations"
import type { SurroundDirection } from "@nodaro/shared/entities"
import type { PluginScene3DEngine, PluginStageToolkit } from "./scene3d-contract.js"
import type { FrameFit, FrameDelivery } from "@nodaro/shared/video"
import type { Edl, EdlRegion, EdlSegment } from "@nodaro/shared/edl"
import type {
  PluginAccountSecretsToolkit,
  PluginDaemon,
  PluginDaemonClientToolkit,
  PluginRedisLeaseToolkit,
  PluginTriggersToolkit,
} from "./daemon-contract.js"
export type * from "./scene3d-contract.js"
export type * from "./daemon-contract.js"

// ============================================================================
// Job / handler shapes
// ============================================================================

/**
 * Structural mirror of the subset of BullMQ's `Job` that a plugin handler
 * consumes: `job.data` (raw payload) and `job.updateProgress` (passed
 * straight through to `tk.jobs.setJobProgress` / `tk.jobs.withProgressRamp`).
 * Mirrors the `job` parameter of `HandlerFn` (`backend/src/workers/shared.ts`:
 * `(job: Job, ctx: JobContext) => Promise<void>`, which a CORE handler may also
 * carry an optional `livenessBudgetMs(job)` on — core-only, not part of this
 * contract: plugin handlers keep the pre-task heartbeat's default cap) and
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

/**
 * Structural mirror of `HandlerFn` (`backend/src/workers/shared.ts`).
 *
 * HOW A HANDLER FAILS A JOB — the video worker reads these OWN PROPERTIES off
 * the error a handler throws (duck-typed, because a class does not survive the
 * plugin boundary):
 *
 * - `contentPolicyClass: "copyright" | "likeness" | "safety"` (top-level error
 *   only) — a provider content-policy block: the attempt is final, the job is
 *   refunded and `jobs.error_hint` becomes `{ kind: "safety-block", class, … }`.
 *   A `safety` block's `error_message` is the host's generic safety sentence
 *   ("…Try adjusting the prompt or the input image.") unless the error also
 *   carries `userSafeMessage: true`.
 * - `userSafeMessage: true` (strict `true`, an own property of the TOP-LEVEL
 *   error; a marker on a `cause` does not count) — the handler vouches that
 *   the error's `message` is a fixed sentence fit to show the user, so a
 *   `safety` block keeps it as `error_message` (the hint is unchanged). For a
 *   run whose prompt the user never wrote (a trend preset), where the generic
 *   advice is wrong. Never put provider text, URLs or hidden inputs in a
 *   marked message. Copyright/likeness blocks and plain failures already keep
 *   the handler's message. Honoured only for a job type a plugin serves.
 *   ADDITIVE-OPTIONAL (no CONTRACT_VERSION bump): an older host ignores it and
 *   writes the generic sentence.
 * - `failureHint: { kind: "credits", code }` (on the error or its `cause`
 *   chain) — a child job's credit reservation was refused; written to
 *   `error_hint` as a credits hint (`code` a lowercase snake_case token).
 * - `deterministic: true` (error or `cause` chain) — the refusal is a pure
 *   function of the job's inputs: final now, no queue retry.
 * - `inputVideoRefused: true` (error or `cause` chain) — the provider refused
 *   the job's INPUT VIDEO. Honoured only when the job's payload sent a video
 *   (`videoUrl`, `referenceVideoUrl` or `referenceVideoUrls`): final now, and
 *   `error_hint` names it — `subject: "input_video"` on a safety-block hint, or
 *   `{ kind: "input-refused", subject: "input_video" }` with no content class.
 * - `inputImageRefused: true` (error or `cause` chain) — the provider refused
 *   one of the job's INPUT IMAGES as possibly copyrighted. Honoured only on a
 *   `copyright` block: `error_hint` then carries `subject: "input_image"`.
 *   ADDITIVE-OPTIONAL.
 */
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
  /** Start/end FRAME handling — additive-optional (2026-09-16). Absent means
   *  the platform defaults, which is what every plugin gets today: the frame is
   *  resized to the model's measured output canvas and delivered as a frame
   *  (or, on the Seedance 2.0 family, as a bound reference). A plugin only
   *  needs these to OPT OUT — e.g. an engine that has already sized its own
   *  anchors passes `frameFit: "original"`. Mirror in the plugins repo's
   *  contract.ts before a plugin can send them. */
  frameFit?: FrameFit
  frameDelivery?: FrameDelivery
  /** Seedance Draft — additive-optional (no CONTRACT_VERSION bump; gate on
   *  `tk.capabilities?.seedanceDraft === true`, an older host ignores it). On a
   *  draft-capable model (`isSeedanceDraftCapable`) the render is a 480p DRAFT
   *  (resolution is forced to 480p) whose task id `finalizeSeedanceDraft`
   *  re-renders as the same take at 1080p. Ignored on any other model. The
   *  caller prices the draft as the 480p run it is. */
  draft?: boolean
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
 * `duration` is honoured (V6 family). Measured on a scat-ensemble recast: in
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
   *  chars on V6 / V4_5+ / V5 / V5_5 (the wrapper trims). */
  style?: string
  /** Default TRUE — scores ride instrumental; voices live in the video. */
  instrumental?: boolean
  /** Advisory target seconds — EXCEPT in custom mode on the V6 family, where it is the
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

/**
 * Mirrors the speech-model capability sheet `ModelCatalogEntry.tts` in the
 * HOST's `@nodaro/shared` (app `packages/shared/src/model-catalog.ts`),
 * narrowed to what a plugin reads. The host answers from ITS copy of the
 * catalog — the plugin package's own `@nodaro/shared` pin lags the app's by
 * whole releases, so a plugin must never read model capability from it.
 */
export interface PluginTtsCapabilities {
  /** Per-request character cap. */
  maxChars: number
  /** Voice-setting levers the model honours ("stability", "similarity", "style", "speed", "speakerBoost"). */
  levers: readonly string[]
  /** ISO 639-1 codes offered for the model (`fil` has no two-letter code). A curated list. */
  languages: readonly string[]
  /** The model performs inline `[audio tags]`. */
  audioTags: boolean
}

export interface PluginProvidersToolkit {
  /** Mirrors `directVoiceChanger` (`providers/elevenlabs/voice-changer.ts`). */
  directVoiceChanger(
    audioBuffer: Buffer,
    voiceId: string,
    options?: PluginVoiceChangerOptions,
  ): Promise<Buffer>
  /**
   * ADDITIVE-OPTIONAL (no CONTRACT_VERSION bump) — `?.`-guard it.
   * Voices `text` with one ElevenLabs voice and returns the stored file and its
   * measured length. Mirrors the text-to-speech worker's direct ElevenLabs call
   * (`workers/handlers/audio-ai.ts`), stored under the job's key (`jobId`) and
   * counted to the user's storage quota (`userId`). Never enables the
   * default-voice fallback: a missing voice fails the step, and no other voice
   * is tried. `voiceType` is accepted for the contract and not forwarded.
   */
  textToSpeech?(
    text: string,
    opts: {
      model: string
      voiceId: string
      voiceType?: string
      languageCode?: string
      jobId: string
      userId: string
    },
  ): Promise<{ audioUrl: string; durationSec: number }>
  /**
   * The HOST's capability sheet for a text-to-speech model id (e.g.
   * "elevenlabs-v4"), or `undefined` when the id is not a text-to-speech model.
   * Read from the app's own `@nodaro/shared` — see `PluginTtsCapabilities`.
   * ADDITIVE-OPTIONAL (no CONTRACT_VERSION bump) — `?.`-guard it; an older host
   * has no such member and the caller falls back to its own table.
   */
  ttsCapabilities?(providerId: string): PluginTtsCapabilities | undefined
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
   * Seedance 2.5 Draft finalize (`providers/kie/seedance-draft.ts`): re-render
   * the draft whose provider task id is `draftTaskId` as the SAME take at
   * 1080p, at the draft's own length. Nothing creative is re-sent. An expired
   * or unknown draft (drafts are kept about 7 days) rejects with a
   * `DeterministicJobError`-shaped error carrying a user-facing message. The
   * caller owns pricing (`tk.http.computeSeedanceDraftFinalizePricing`) and must
   * only pass a task id of a draft it rendered for the same user.
   *
   * OPTIONAL (additive-contract convention, no CONTRACT_VERSION bump): absent →
   * the app predates it; feature-guard with `?.`.
   */
  finalizeSeedanceDraft?(
    draftTaskId: string,
    options?: { onTaskCreated?: (taskId: string) => void | Promise<void> },
  ): Promise<PluginVideoGenResult>
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
  /**
   * Mirrors `socialPostOf` (`providers/video/social-post-video.ts`): the
   * canonical link when `url` is ONE post on a platform the hardened lane
   * fetches (YouTube, TikTok, Instagram, X, Facebook), else null — a profile,
   * a channel, a story or a share short link is not. Optional: absent on an
   * older host.
   */
  socialPostVideoUrl?(url: string): string | null
  /**
   * Mirrors `probeSocialPostVideo`: the post's length and whether it is live,
   * before anything is paid for. Throws `YtUrlNotAllowedError` for a link
   * `socialPostVideoUrl` refuses. Optional: absent on an older host.
   */
  probeSocialPostVideo?(url: string, opts?: { signal?: AbortSignal }): Promise<{
    durationSec: number | null
    title: string | null
    isLive: boolean
  }>
  /**
   * Mirrors `downloadSocialPostVideo`: the hardened fetch of one post's video
   * (that platform's extractors only, no live stream, nothing past
   * `maxDurationSec`, a size cap, one wall-clock limit, a minimal child
   * environment). Throws `YtUrlNotAllowedError` for a link
   * `socialPostVideoUrl` refuses. A fetch that must not be retried rejects
   * with an Error whose `name` is `"YtDlpHaltError"` and whose `reason` is
   * `"refused"` (live, or past `maxDurationSec`), `"aborted"`,
   * `"out_of_time"` or `"too_much_output"` — match it by that shape; the class
   * lives in the host. Optional: absent on an older host.
   */
  downloadSocialPostVideo?(opts: {
    url: string
    outPath: string
    maxDurationSec: number
    maxFilesizeBytes?: number
    maxHeight?: number
    signal?: AbortSignal
  }): Promise<void>
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
    /** PER-BOUNDARY override of `transition`/`transitionDuration`: `index` is
     *  boundary k, the join between clip k and clip k+1 (N clips have N-1
     *  boundaries). Built for the recast stitcher, which renders the device
     *  the analyser recorded at each segment SEAM. A boundary with no entry
     *  keeps the global transition; an entry with `transition: "cut"` or
     *  `duration <= 0` is a hard cut there; an out-of-range index or an id
     *  outside the app's `COMBINE_TRANSITIONS` catalog is warned about and
     *  ignored (never fatal — a plugin released after the running app build
     *  must degrade, not abort a stitch of already-paid-for renders). The
     *  concat-demuxer fast path is used only when EVERY boundary is a cut.
     *  Additive-optional, like `smartCut`: absent → byte-identical to before
     *  this member existed, so plugin versions on either side interop. */
    transitions?: ReadonlyArray<{ index: number; transition: string; duration: number }>
    /** Film-edge fades in SECONDS — `fade=t=in` over the head of the first
     *  clip, `fade=t=out` over the tail of the last. The opening/closing fades
     *  a keyframes render cannot make itself (every segment opens on a pinned
     *  anchor frame). Baked in before any join, so they survive the
     *  stream-copying fast path. Absent/0 → no fade pass runs. */
    edgeFades?: { in?: number; out?: number }
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
   *
   * `durationSec` — the CONTAINER's duration (`format=duration`), not the
   * video stream's: it can be longer than the video (a clip whose audio runs
   * past its last frame), so `durationSec × fps` is an estimate of the frame
   * count, not an exact one.
   *
   * `fps` — the video stream's CONSTANT frame rate, when `probeVideoSource`
   * reports one (absent for a variable rate or none usable). ADDITIVE-OPTIONAL
   * (no CONTRACT_VERSION bump): a host predating it never sets it, so a caller
   * treats absent as "unknown" and keeps its old behaviour.
   *
   * `videoDurationSec` — the first VIDEO stream's own duration
   * (`stream=duration`), shorter than `durationSec` when the audio runs past
   * the last frame; absent when the stream reports none usable.
   * ADDITIVE-OPTIONAL like `fps`: a host predating it never sets it, so a
   * caller falls back to `durationSec`.
   */
  probeVideoMeta(url: string): Promise<{ durationSec: number; width: number; height: number; fps?: number; videoDurationSec?: number }>
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
   * Mirrors `probeMediaStreams` (`providers/video/ffmpeg-utils.ts`) — which
   * streams a URL or path ACTUALLY carries (`hasVideo` ignores embedded cover
   * art; SSRF-asserted for remote URLs). THE MEDIA, NOT THE INPUT SLOT, decides
   * a plugin's audio-vs-video mode: an audio-only M4A uploaded as `.mp4` must run
   * as audio (voice-changer-pro incident, 2026-08-30). Throws when ffprobe's
   * output is unparseable — callers fail OPEN on the slot's word.
   */
  probeMediaStreams(srcUrlOrPath: string): Promise<{ hasVideo: boolean; hasAudio: boolean }>
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
  /**
   * The EDL timeline (`providers/video/edl-timeline.ts`) — Apply EDL's
   * renderer, lent to a plugin that draws its OWN picture on it (Speaker View,
   * SV1 b, decided 2026-10-06). Core keeps everything that makes the cut
   * correct and long renders survivable: the cumulative frame grid, chunks
   * split at hard cuts, per-input seeks, the one lossless sound pass with a
   * single AAC encode, fingerprinted R2 checkpoints, the per-chunk kill
   * budgets and each launch's memory reservation. The plugin supplies only
   * `picture(ctx)`: per segment, the filter-graph fragment that draws its
   * slots onto the canvas. Slots come from the EDL (`layout.slots`, D20 via
   * `resolveEdlSegmentSlots` with `speakerRegions`), so write the layouts
   * into `edl` before calling. An `xfade:<id>` layout switch joins with that
   * combine-videos transition and blends the sound like a crossfade,
   * consuming the overlap (D17; SV21 c — write one only where master time is
   * discontinuous).
   *
   * Uploads the render PLAIN under `jobId` (tracked to `jobUserId`'s storage),
   * plus a thumbnail for video, exactly as core Apply EDL does, and removes
   * its local files. Runs inside the worker's cancellation context: a cancel
   * stops it at the next chunk boundary with the host's `JobCancelledError`.
   * The plugin passes its OWN `label` (e.g. `"speaker-view"`, required) so
   * its checkpoints and logs never mix with Apply EDL's `apply-edl-cache/`.
   * A refusal that depends only on the inputs (a missing or invalid label, a
   * segment past its media, an unknown `xfade:` id) is a deterministic error
   * the worker fails without retrying. The handler still owns its heartbeat budget: the host sizes it
   * from `DECLARED_JOB_BUDGETS[job.name]` at dispatch.
   *
   * ADDITIVE-OPTIONAL: absent on an older host. A plugin feature-detects it
   * (`typeof tk.ffmpeg.renderEdlTimeline === "function"`) and refuses BEFORE
   * any credit is reserved when it is missing.
   */
  renderEdlTimeline?(opts: PluginEdlTimelineOptions): Promise<PluginEdlTimelineResult>
}

/** Mirrors `EdlPictureSlot` (`providers/video/edl-picture.ts`). */
export interface PluginEdlPictureSlot {
  readonly source: string
  /** Crop on the source, fractions of its frame (D20); full frame when none was set. */
  readonly region: EdlRegion
  readonly regionFrom: "slot" | "segment" | "resolver" | "speaker" | "source" | "full"
  readonly speaker?: string
  readonly weight?: number
  /** The slot stream's graph label (e.g. `[p3s0]`), read by a `graph`
   *  fragment (one slot included); a `chain` ignores it. Held past the source's end, trimmed to
   *  the segment's read window, timestamps from 0 at `leadSec` before the
   *  segment's own start, a few frames past its end. */
  readonly label?: string
  /** The slot stream's read window on its SOURCE's own clock, whole ms
   *  (`masterMs − offsetMs`, D19) — the clock face tracks are kept on.
   *  `startMs` is the stream's t = 0 (a split tail's: its whole segment's
   *  start, `leadSec` earlier); `endMs` the segment's own end. */
  readonly sourceSpan: { readonly startMs: number; readonly endMs: number }
}

/** Mirrors `EdlPictureContext` (`providers/video/edl-picture.ts`). */
export interface PluginEdlPictureContext {
  readonly segment: EdlSegment
  readonly index: number
  readonly slots: readonly PluginEdlPictureSlot[]
  readonly canvas: { readonly width: number; readonly height: number }
  readonly fps: number
  readonly quality: "proxy" | "final"
  readonly durationSec: number
  readonly leadSec: number
  /** Frames this segment holds on the output grid; the host keeps exactly these. */
  readonly frames: number
  /** Its first frame on the GLOBAL output grid (`frameAtMs`). */
  readonly startFrame: number
  /** The output frame grid on the slot streams: kept output frame k
   *  (0 ≤ k < `frames`) is the canvas-rate frame at stream time
   *  `(leadFrames + k) / fps`, i.e. at
   *  `slots[j].sourceSpan.startMs + 1000·(leadFrames + k)/fps` ms on slot j's
   *  source clock (to within one source frame) — where a glide samples its
   *  face track. Non-zero only on a split tail (its head rendered those). */
  readonly leadFrames: number
  /** The label a `graph` fragment must write: one canvas-sized stream. */
  readonly output: string
  /** Prefix for every intermediate label a `graph` fragment defines. */
  readonly scope: string
}

/**
 * Mirrors `EdlPictureFragment`: `{ chain }` — a linear filter chain (no
 * labels, no `;`) applied to a ONE-slot segment's stream; `{ graph }` —
 * statements that read every slot's `label` and write `ctx.output`. The host
 * conforms the result to the canvas rate and the segment's exact frame count.
 * The builder is called synchronously while each slice is planned and its
 * fragment is part of the checkpoint key, so it must be pure and
 * self-contained — the key hashes a file's path, not its content. A `movie=` /
 * `amovie=` source or a `sendcmd` command file (pass the commands inline,
 * `c=`) is refused as deterministic; other file-reading filters are not
 * checked, and must not be used either.
 *
 * `memoryHint` (ADDITIVE-OPTIONAL, decided 2026-10-07; no contract bump): what
 * the fragment draws that costs memory beyond its canvas. `zoom: true` on
 * every segment drawn with a zoom's window (its tween, its rest, and a later
 * segment carried on that window) makes the slice reserve the host's zoom
 * term (`zoomPeakMemoryMiB`, `providers/video/ffmpeg-memory-model.ts`): a
 * per-slice part plus a part for every segment so marked (per segment
 * since 2026-10-10, refit on measured figures with one straight thread
 * slope 2026-10-11), sized from the
 * launch's own thread counts — so mark every such segment, and name the
 * effect, never a figure. Without it the slice reserves what it always
 * has. A malformed hint
 * (not an object, or a non-boolean `zoom`) is refused as deterministic;
 * unknown keys are ignored for forward compatibility, so a misspelled key
 * (`zooms`, `Zoom`) reads as no hint and the slice reserves no zoom term. Not
 * part of the graph, so not part of the checkpoint key. An older host ignores
 * the field (its slice reserves the no-zoom prediction).
 *
 * The number of CAMERAS needs no hint: the host opens the source files, so it
 * counts them itself (base per camera, decided 2026-10-11; the slice's
 * `memoryBasis.inputs`) from the sources a slice's slots read. A builder only
 * ever names an effect (`zoom`), never a count or a figure.
 */
export type PluginEdlPictureFragment = ({ readonly chain: string } | { readonly graph: string }) & {
  readonly memoryHint?: { readonly zoom?: boolean }
}

/** Mirrors `EdlTimelineOptions` (`providers/video/edl-timeline.ts`). */
export interface PluginEdlTimelineOptions {
  readonly edl: Edl
  /** Default `"video"`. */
  readonly output?: "video" | "audio"
  readonly quality: "proxy" | "final"
  /** Keys the checkpoints (a retry of the same job resumes them) and the upload. */
  readonly jobId: string
  readonly jobUserId?: string
  /** Default: the full-frame picture (Apply EDL's). */
  readonly picture?: (ctx: PluginEdlPictureContext) => PluginEdlPictureFragment
  /** D20's per-(source, speaker) framing (`ResolveEdlSlotsOptions.speakerRegions`). */
  readonly speakerRegions?: ReadonlyArray<{ readonly source: string; readonly speaker: string; readonly region: EdlRegion }>
  /** D20's resolver rung (`ResolveEdlSlotsOptions.regionFor`, Speaker View
   *  v3): a per-(segment, slot) region — the tracked framing — below an
   *  explicit slot/segment region and above `speakerRegions`. Asked about the
   *  EDL's own segment, never a chunk's split half. Pure, like `picture`: its
   *  regions reach the fragments the checkpoint key hashes. Additive-optional:
   *  a host older than this field ignores it (as it lacks `sourceSpan` and
   *  `leadFrames`), so a plugin that relies on them ships after the host does. */
  readonly regionFor?: (q: { readonly segment: EdlSegment; readonly source: string; readonly speaker?: string }) => EdlRegion | undefined
  /** A fixed canvas (even-rounded) for every quality — the plugin sizes it
   *  (SV7). Default: the most common source resolution, 720p-capped for a proxy. */
  readonly canvas?: { readonly width: number; readonly height: number }
  /** REQUIRED (decided 2026-10-06): the plugin's own render name, e.g.
   *  `"speaker-view"` — it names the renderer in refusals and logs, its work
   *  directory and its checkpoint prefix (`<label>-cache/`), so a plugin's
   *  checkpoints never mix with Apply EDL's `apply-edl-cache/`. A short slug:
   *  lowercase letters and digits in words joined by single hyphens, a letter
   *  first, at most 40 characters; never `"apply-edl"`. No default — a
   *  missing or invalid label is refused as a deterministic error (failed now,
   *  never retried) before anything is downloaded or rendered. */
  readonly label: string
  /** 0..1 render progress. */
  readonly onProgress?: (fraction: number) => void
}

export interface PluginEdlTimelineResult {
  /** The render, uploaded plain (no watermark, no transcode). */
  readonly url: string
  /** Video only; null when the thumbnail could not be made. */
  readonly thumbnailUrl: string | null
  /** The rendered length — `edlDurationMs(edl)` by construction. */
  readonly durationMs: number
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
  /** Ducking (`MixAudioDuck`, `lib/mix-audio-duck.ts`): every track except `under` dips while track `under` is loud. */
  readonly duck?: {
    readonly under: number
    readonly amount?: number
    readonly thresholdDb?: number
    readonly ratio?: number
    readonly attackMs?: number
    readonly releaseMs?: number
  }
  /** Mirrors `MixAudioOptions.endAt`: `"voice"` ends the mix when the voice (the `duck.under` track) ends. */
  readonly endAt?: "longest" | "voice"
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
export type PluginAudioFxOptions = (
  | { readonly audioUrl: string; readonly inputPath?: undefined }
  /**
   * LOCAL input in place of `audioUrl` (exactly one of the two): an absolute
   * path to an existing file inside the host temp directory (a `createWorkDir`
   * path). Nothing is downloaded. ADDITIVE-OPTIONAL — gate on
   * `tk.capabilities?.audioFxLossless === true`.
   */
  | { readonly inputPath: string; readonly audioUrl?: undefined }
) & {
  readonly preset: AudioFxPreset
  readonly mix?: number
  readonly delayMs?: number
  readonly decay?: number
  readonly eqLow?: number
  readonly eqHigh?: number
  /**
   * ADDITIVE-OPTIONAL (no CONTRACT_VERSION bump) — gate on
   * `tk.capabilities?.audioFxLossless === true`: an older host ignores
   * `format` / `inputPath` / `outputPath` silently (and would then fail on a
   * missing `audioUrl`, or hand back an mp3).
   *
   * Output format. Default `"mp3"` (byte-identical to before). `"wav"` = 16-bit
   * PCM, no resample/remix: a non-reverb preset keeps the input's sample rate
   * and channels; the reverb presets render at 48 kHz (their impulse-response
   * rate) with the input's channel count.
   */
  readonly format?: "mp3" | "wav"
  /**
   * Write the result at this absolute path inside the host temp directory,
   * ending `.mp3` / `.wav` to match `format`. The function then removes all its
   * own scratch (also on failure, plus any partial output) — only this file
   * remains, no R2 upload involved. Omitted: the output lands in a fresh work
   * dir the caller removes (`dirname(outputPath)`), as before. Gate on
   * `audioFxLossless`.
   */
  readonly outputPath?: string
}

/** Mirrors `ProxySpan` (`services/media-proxy-span-map.ts`): ms on the source's own clock. */
export interface PluginProxySpan {
  readonly startMs: number
  readonly endMs: number
}

/** Mirrors `ProxySpanMapRow` (`services/media-proxy-span-map.ts`). Frame
 * `firstFrame + k` of the proxy shows the source at
 * `sourceStartMs + k × 1000 / fps`; proxy time is half-open
 * `[proxyStartMs, proxyEndMs)`. */
export interface PluginProxySpanMapRow {
  readonly proxyStartMs: number
  readonly proxyEndMs: number
  readonly sourceStartMs: number
  readonly firstFrame: number
  readonly frameCount: number
}

/** Mirrors `MediaProxyOptions` (`services/media-proxy.ts`), video side. */
export interface PluginVideoProxyOptions {
  readonly fps?: number
  /** Even px, at most 2160; a shorter source is never upscaled. Default 360. */
  readonly height?: number
  /** Omitted = the whole source. Padding (the 2 s detection margin) is the caller's. */
  readonly spans?: readonly PluginProxySpan[]
  /** Per-spawn ffmpeg timeout (ms). Omitted: each span's encode runs at a
   *  ceiling sized by its length, the whole source and the join at the
   *  proxy's ~3h ceiling. ANY value replaces all of them, the per-span
   *  ceilings included — a handler charged by a per-span budget
   *  (`speaker-frames-budget.ts`) must leave it unset. */
  readonly timeoutMs?: number
}

/** Mirrors `VideoProxyResult` (`services/media-proxy.ts`). */
export interface PluginVideoProxy {
  readonly url: string
  readonly key: string
  readonly kind: "video"
  readonly cached: boolean
  readonly fps: number
  /** The proxy's only clock: built from the frames actually written. */
  readonly spanMap: readonly PluginProxySpanMapRow[]
  /** Display-oriented, square-pixel frame size; box fractions refer to it. */
  readonly frame: { readonly w: number; readonly h: number }
  readonly frameCount: number
  /**
   * Scene cuts (P3.2b), ms on the SOURCE clock, ascending: a cut at `c` starts
   * a new shot at `c`. Found in the decode that built the proxy, at the decode
   * rate, over the kept spans only. A gap between two kept spans is never
   * decoded, so a cut in it cannot be seen: every `spanMap` row after the
   * first starts a POSSIBLE shot, and a consumer merges those rows'
   * `sourceStartMs` into this list.
   * Added after `ensureMediaProxy` itself shipped: a plugin mirrors it as
   * optional and treats its absence as an older host.
   */
  readonly cuts: readonly number[]
}

/** Mirrors `DetectFacesInput` (`services/face-detect/detect-faces.ts`): one
 * window of a detection proxy. */
export interface PluginDetectFacesInput {
  /** `PluginVideoProxy.url` — a proxy this platform stored; any other URL is refused. */
  readonly proxyUrl: string
  /** `PluginVideoProxy.fps`. */
  readonly fps: number
  /** `PluginVideoProxy.spanMap`: the only clock a detection goes through. */
  readonly spanMap: readonly PluginProxySpanMapRow[]
  /** First proxy frame, inclusive. */
  readonly fromFrame: number
  /** Last proxy frame, exclusive; at most 1,200 frames after `fromFrame`. */
  readonly toFrame: number
  /** Keep faces scoring at least this, in (0, 1]. The threshold is the caller's. */
  readonly minScore: number
  /** Also return a 16×9 RGB thumbnail per frame (base64): the camera-setup signature input. */
  readonly thumb?: boolean
  /**
   * Proxy frames inside the window whose boxes also carry a job-only
   * `descriptor` (P3.2b round 3): the samples at the edges of each kept span.
   * Additive-optional: a host without it returns no descriptors, and the
   * caller abstains (links nothing across a gap), as before.
   */
  readonly descriptorFrames?: readonly number[]
}

/**
 * Mirrors `FaceDescriptor` (`services/face-detect/face-descriptor.ts`):
 * appearance plus landmark alignment, not an embedding. JOB-ONLY: never store
 * it, never checkpoint it, never write it to an artifact, never compare it
 * across episodes.
 */
export interface PluginFaceDescriptor {
  /** Compare only descriptors of equal versions. */
  readonly version: 1
  /** 64 signed bytes, base64: the 8×8 luma crop aligned on the five landmarks, zero-mean, unit length (×127). */
  readonly luma: string
  /** 128 bytes, base64: 64-bin RGB histograms (4 levels per channel) of the face, then of the region just below it; each totals ~255, all zeros when absent. */
  readonly hist: string
}

/** Mirrors `YunetFace` (`services/face-detect/yunet-decode.ts`). */
export interface PluginDetectedFace {
  /** Top-left corner and size, fractions of the proxy frame; not clipped to it. */
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  readonly score: number
  /** Right eye, left eye, nose tip, right and left mouth corners: [x, y] fractions. */
  readonly landmarks: ReadonlyArray<readonly [number, number]>
  /** Only on the boxes of `descriptorFrames` (at most 32 a frame, highest score first). */
  readonly descriptor?: PluginFaceDescriptor
}

/** Mirrors `DetectFacesResult` (`services/face-detect/detect-faces.ts`). */
export interface PluginDetectFacesResult {
  /** What a track set records as its detector, e.g. `yunet:2023mar-dyn@57acd732`. */
  readonly detector: { readonly id: string; readonly version: string }
  readonly frame: { readonly w: number; readonly h: number }
  /** The window's frames a span-map row holds, in order, each on the SOURCE clock. */
  readonly frames: ReadonlyArray<{
    readonly frame: number
    readonly sourceMs: number
    readonly boxes: readonly PluginDetectedFace[]
    readonly thumb?: string
  }>
  /** Frames held by no span-map row: dropped, never given a time. */
  readonly dropped: number
  readonly boxCount: number
  /** The Node process's CPU while the call held its admission slot, ms (not
   *  the wait for the slot, not the decode child's). */
  readonly cpuMs: number
}

export interface PluginMediaToolkit {
  /** Authorize the source first. Public-only bounded video download and local
   * still extraction; no jobs, storage credentials or automatic media spend. */
  readPublicVideoFrame?(input: { videoUrl: string; timeSec: number }): Promise<Buffer>
  /**
   * Mirrors `ensureMediaProxy(url, "video", opts)` (`services/media-proxy.ts`)
   * — the cached detection/review proxy (P3.2), span-scoped and height-keyed,
   * with its span map. Additive-optional: feature-detect and refuse before any
   * reserve when absent.
   */
  ensureMediaProxy?(sourceUrl: string, kind: "video", opts?: PluginVideoProxyOptions): Promise<PluginVideoProxy>
  /**
   * Mirrors `proxyFrameToSourceMs` (`services/media-proxy-span-map.ts`): a proxy
   * frame index → source-clock ms, undefined when no row holds it (drop and
   * count it). The only conversion a detection may go through.
   */
  proxyFrameToSourceMs?(spanMap: readonly PluginProxySpanMapRow[], fps: number, frame: number): number | undefined
  /**
   * Mirrors `detectFaces` (`services/face-detect/detect-faces.ts`) — YuNet
   * (the pinned model, onnxruntime-node) over one window of a detection proxy
   * (P3.3). Core owns the decode, the session, the admission hold and the
   * clock: boxes come back on the SOURCE clock through the span map.
   * Additive-optional: feature-detect and refuse before any reserve when
   * absent. Rejects with a deterministic error when the host cannot detect (no
   * model, no native binary, a model whose hash is not the pin) or when a
   * window would pass the speaker-track caps.
   */
  detectFaces?(input: PluginDetectFacesInput): Promise<PluginDetectFacesResult>
  /** Mirrors `extractAudio` (`providers/video/extract-audio.ts`). */
  extractAudio(options: { readonly videoUrl: string }): Promise<{ readonly audioPath: string }>
  /**
   * Mirrors `removeAudio` (`providers/video/remove-audio.ts`): the video with
   * every audio stream dropped, stream-copied (no re-encode). `videoPath` is a
   * local file in its own work dir; the caller removes `dirname(videoPath)`.
   * ADDITIVE-OPTIONAL (no CONTRACT_VERSION bump) — `?.`-guard it.
   */
  removeAudio?(options: { readonly videoUrl: string }): Promise<{ readonly videoPath: string }>
  /**
   * Mirrors `pitchTempo` (`providers/video/pitch-tempo.ts`) as a pitch shift
   * only: tempo 1, formants kept. Give it audio-only media (e.g.
   * `extractAudio`'s output) — the core picks its lane from the streams the
   * file carries, and only an audio input comes back as MP3. `audioPath` is a
   * local file in its own work dir; the caller removes `dirname(audioPath)`.
   * A bad input rejects with the core's `PitchTempoInputError`, unchanged.
   * ADDITIVE-OPTIONAL (no CONTRACT_VERSION bump) — `?.`-guard it.
   */
  pitchTempo?(options: { readonly audioUrl: string; readonly semitones: number }): Promise<{ readonly audioPath: string }>
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

export interface PluginRetainedJobImage {
  jobId: string
  submissionContext: Record<string, unknown>
  image: { assetId: string; contentHash: string; url: string; width: number; height: number }
}

export interface PluginRetainedImageCopy {
  id: string
  source: { workflowId: string; jobId?: string; copyId?: string }
  sourceContext: Record<string, unknown>
  origin: { workflowId: string; jobId: string; submissionContext: Record<string, unknown> }
  context: Record<string, unknown>
  image: { assetId: string; contentHash: string; url: string; width: number; height: number }
}

export interface PluginRetainedJobVideo {
  jobId: string
  submissionContext: Record<string, unknown>
  video: { assetId: string; contentHash: string; url: string; width: number; height: number; durationMs: number; byteLength: number }
}

export interface PluginRetainedVideoCopy {
  id: string
  source: { workflowId: string; jobId?: string; copyId?: string }
  sourceContext: Record<string, unknown>
  origin: { workflowId: string; jobId: string; submissionContext: Record<string, unknown> }
  context: Record<string, unknown>
  video: { assetId: string; contentHash: string; url: string; width: number; height: number; durationMs: number; byteLength: number }
}

export interface PluginStorageToolkit {
  /** Authorize reading the workflow first; verifies destination bytes even if
   * the original job and source workflows were deleted. */
  readRetainedImageCopies?(workflowId: string, copyIds: readonly string[]): Promise<PluginRetainedImageCopy[]>
  /** Authorize both workflows and validate mapped context first. A copy gets
   * its own proof ID, never a synthetic job or inherited acceptance. */
  recordRetainedImageCopy?(args: {
    id: string; userId: string; workflowId: string; imageId: string;
    source: { workflowId: string; jobId: string; copyId?: never } | { workflowId: string; copyId: string; jobId?: never };
    context: Record<string, unknown>
  }): Promise<PluginRetainedImageCopy | null>
  /** Authorize source read and destination edit access first. Copies verified
   * bytes into destination retention; does not transfer job/review authority. */
  copyRetainedImage?(args: { userId: string; sourceWorkflowId: string; workflowId: string; assetId: string }): Promise<{
    assetId: string; contentHash: string; url: string; width: number; height: number
  } | null>
  /** Authorize editing first; capture an owned completed job with server provenance. */
  retainJobImage?(args: { userId: string; workflowId: string; jobId: string }): Promise<PluginRetainedJobImage | null>
  /** Authorize workflow access first; retained results survive source-job deletion. */
  readRetainedJobImages?(workflowId: string, jobIds: readonly string[]): Promise<PluginRetainedJobImage[]>
  /** Snapshot bytes after the caller authorizes the source and workflow. */
  retainImage?(args: { userId: string; workflowId: string; body: Buffer }): Promise<{
    assetId: string; contentHash: string; url: string; width: number; height: number
  }>
  /** Read only after workflow access authorization; cross-workflow ids return null. */
  readRetainedImage?(workflowId: string, assetId: string): Promise<{
    assetId: string; contentHash: string; url: string; width: number; height: number
  } | null>
  canRetainImages?: boolean
  /** Authorize reading the workflow first; verifies destination bytes even if
   * the original job and source workflows were deleted. */
  readRetainedVideoCopies?(workflowId: string, copyIds: readonly string[]): Promise<PluginRetainedVideoCopy[]>
  /** Authorize both workflows and validate mapped context first. A copy gets
   * its own proof ID, never a synthetic job or inherited acceptance. */
  recordRetainedVideoCopy?(args: {
    id: string; userId: string; workflowId: string; videoId: string;
    source: { workflowId: string; jobId: string; copyId?: never } | { workflowId: string; copyId: string; jobId?: never };
    context: Record<string, unknown>
  }): Promise<PluginRetainedVideoCopy | null>
  /** Authorize source read and destination edit access first. Copies verified
   * bytes into destination retention; does not transfer job/review authority. */
  copyRetainedVideo?(args: { userId: string; sourceWorkflowId: string; workflowId: string; assetId: string }): Promise<{
    assetId: string; contentHash: string; url: string; width: number; height: number; durationMs: number; byteLength: number
  } | null>
  /** Authorize editing first; capture an owned completed job with server provenance. */
  retainJobVideo?(args: { userId: string; workflowId: string; jobId: string }): Promise<PluginRetainedJobVideo | null>
  /** Authorize workflow access first; retained results survive source-job deletion. */
  readRetainedJobVideos?(workflowId: string, jobIds: readonly string[]): Promise<PluginRetainedJobVideo[]>
  /** Snapshot bytes after the caller authorizes the source and workflow. */
  retainVideo?(args: { userId: string; workflowId: string; body: Buffer }): Promise<{
    assetId: string; contentHash: string; url: string; width: number; height: number; durationMs: number; byteLength: number
  }>
  /** Read only after workflow access authorization; cross-workflow ids return null. */
  readRetainedVideo?(workflowId: string, assetId: string): Promise<{
    assetId: string; contentHash: string; url: string; width: number; height: number; durationMs: number; byteLength: number
  } | null>
  canRetainVideos?: boolean
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
   * Mirrors `uploadJobScratchFile` (`lib/job-scratch.ts`): streams a local file
   * into the RUNNING job's scratch folder (the job id comes from the handler's
   * job context, so call it from a worker job handler only) and returns its
   * url. The folder is emptied when the job ends; counted against no quota.
   * ADDITIVE-OPTIONAL (no CONTRACT_VERSION bump) — `?.`-guard it.
   */
  uploadJobScratchFile?(filePath: string, name: string, ext: string, contentType: string): Promise<string>
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

/**
 * Structural mirror of `ErrorHint` (`backend/src/lib/safety-block.ts`) — the
 * `jobs.error_hint` column (migration 376): a user-safe, machine-readable
 * verdict on a FAILED job, so a caller can act on a child's failure (say "the
 * safety filter blocked it", offer the fallback model, say "top up") without
 * parsing `error_message`. Switch on `kind`; treat a kind you do not know as
 * an unclassified failure (the union may grow).
 */
export type PluginJobErrorHint =
  | {
      /** A provider's content-policy block. */
      kind: "safety-block"
      class: "copyright" | "likeness" | "safety"
      /** The request was retried once inline before this verdict. */
      retried: boolean
      /** A catalog model id the same request may pass on. */
      suggestedProvider?: string
      /**
       * What was blocked, when the provider named it: `"input_video"` = the
       * job's input video (not its prompt); `"input_image"` = one of the job's
       * input images, refused as possibly copyrighted (only with
       * `class: "copyright"`). Absent ⇒ unknown. ADDITIVE-OPTIONAL — the union
       * may grow; treat an unknown subject as absent.
       */
      subject?: "input_video" | "input_image"
    }
  | {
      /**
       * The provider could not take the job's INPUT VIDEO (refused or failed
       * to process it) without naming a content class. ADDITIVE-OPTIONAL.
       */
      kind: "input-refused"
      subject: "input_video"
    }
  | {
      /** Nodaro's own job policy refused the request or withheld the result. */
      kind: "policy-block"
      policyId: string
      /** User-safe by contract. */
      reason: string
      hookPoint: "request" | "result"
    }
  | {
      /** A credit reservation was refused partway (`insufficient_credits`, …). */
      kind: "credits"
      code: string
    }

/** One job row as `readJobsOwnedBy` returns it, `output_data` already redacted. */
export interface PluginOwnedJobRow {
  id: string
  status: string
  output_data: Record<string, unknown> | null
  error_message: string | null
  /**
   * The job's `error_hint`, null when it has none (any job that did not fail
   * with a classified verdict). ADDITIVE-OPTIONAL (no CONTRACT_VERSION bump):
   * absent on an older host — read it as `row.error_hint ?? null`.
   */
  error_hint?: PluginJobErrorHint | null
}

/**
 * One job as `readOwnedJob` returns it: `input_data` and `output_data` RAW,
 * server-only `__` keys included — never sent to a client as is.
 */
export interface PluginOwnedRawJob {
  id: string
  status: string
  input_data: Record<string, unknown>
  output_data: Record<string, unknown> | null
  created_at: string
  completed_at: string | null
  /**
   * The job's `error_hint` (see `PluginJobErrorHint`), null when it has none.
   * ADDITIVE-OPTIONAL (no CONTRACT_VERSION bump): absent on an older host.
   */
  error_hint?: PluginJobErrorHint | null
}

/** Structural mirror of `_wait-for-job.ts`'s own (unexported) options. */
export interface PluginWaitForJobOptions {
  jobId: string
  /** Maximum wall-clock to wait. Host default: 120s (image), 300s otherwise. */
  timeoutMs?: number
  /** Stop waiting (status `aborted`) when this fires — the request's signal. */
  signal?: AbortSignal
}

/**
 * Structural mirror of `_wait-for-job.ts`'s own (unexported) result.
 *
 * `pending_review` is NOT a failure and NOT a timeout — the job produced a
 * result whose release is waiting on a human.
 */
export interface PluginWaitForJobResult {
  status: "completed" | "failed" | "cancelled" | "pending_review" | "timeout" | "aborted"
  outputUrl: string | null
  outputData: Record<string, unknown> | null
  error: string | null
  jobType: string | null
  /**
   * A `failed` child's structured failure verdict, as stored on
   * `jobs.error_hint` (see `PluginJobErrorHint`) — a child's failure class
   * without parsing `error`; null on every other status, or when the job has
   * none. ADDITIVE-OPTIONAL (no CONTRACT_VERSION bump) — absent on an older
   * host; treat `undefined` like null.
   */
  errorHint?: PluginJobErrorHint | null
}

export interface PluginJobSettlement {
  jobId: string
  userId: string
  usageLogId: string
  expectedStatus: "completed" | "failed" | "cancelled"
  actualCredits: number
  receiptHash: string
  providerCostUsd?: number
}
export interface PluginJobSettlementCheckpoint {
  jobId: string
  userId: string
  usageLogId: string
  sequence: number
  actualCredits: number
  ready: boolean
  receiptHash: string
  providerCostUsd?: number
}
export interface PluginJobSettlementResult {
  jobId: string
  usageLogId: string
  actualCredits: number
  releasedCredits: number
  receiptHash: string
  replayed: boolean
}

/**
 * The workflow run a job belongs to, as `readJobExecution` reads it (never
 * from the job's payload, and never from the run's trigger data, which an
 * owner or a webhook caller can word).
 */
export interface PluginJobExecution {
  jobId: string
  /** Who the job runs as — from the job row, which no client can update. A shared or published run's runner is not the workflow's owner. */
  runnerId: string
  /** The workflow node the job runs for, when the orchestrator recorded it (job row). */
  nodeId: string | null
  /** The run (job row). */
  executionId: string
  /**
   * Through the run row, which its user may re-point to another workflow of
   * THEIR OWN. Good for refusing someone else's run; never proof on its own
   * that the runner may act for a workflow — bind that to rows the runner owns.
   */
  workflowId: string
  workflowOwnerId: string
}

export interface PluginJobsToolkit {
  /** Owner-scoped access to immutable server submission records. */
  readJobSubmissionsOwnedBy?(userId: string, jobIds: ReadonlyArray<string>): Promise<Array<{ id: string; submission_context: Record<string, unknown> }>>
  /**
   * The workflow run a job belongs to — its runner, its node and its owner —
   * read host-side by job id, for a job that may act only for the run's
   * owner. Never the run's trigger data (owner- or caller-worded). Scoped to the
   * runner the handler already holds (`ctx.jobUserId`): someone else's job
   * reads as no run. Null for a job outside any run; a read error throws
   * rather than reading as "no run".
   *
   * ADDITIVE-OPTIONAL (no CONTRACT_VERSION bump) — `?.`-guard it.
   */
  readJobExecution?(jobId: string, scope: { runnerId: string }): Promise<PluginJobExecution | null>
  /**
   * The status of jobs THIS user owns, by id, redacted.
   *
   * Ids the caller does not own — and ids that name nothing at all — are
   * simply absent from the answer, which is what makes the two
   * indistinguishable to everything downstream. The owner filter is part of
   * the QUERY, never a post-filter in JS: a read that fetches rows it must
   * then throw away is one refactor away from keeping them.
   *
   * `output_data` comes back through `redactPrivateJobOutput` (its `__`
   * server-only keys dropped, then `redactPrivateJobData`), for the same
   * reason every other job reader applies it — it can carry server-only
   * fields, and a landed result is persisted on a document that can later be
   * shared by link. An empty id list issues no query. A read ERROR throws
   * rather than reading as "nothing landed", which would invite a caller to
   * give up on a render that is sitting there finished.
   *
   * ADDITIVE-OPTIONAL (no CONTRACT_VERSION bump) — `?.`-guard it.
   */
  readJobsOwnedBy?(userId: string, jobIds: readonly string[]): Promise<PluginOwnedJobRow[]>
  /**
   * ONE job THIS user owns, with `input_data` and `output_data` RAW —
   * server-only `__` keys included. For a plugin route that acts on the
   * user's own job and needs its hidden inputs (Trends' Full Quality re-runs a
   * draft from them). The answer is SERVER-SIDE ONLY: never return it, or any
   * `__` key in it, to a client. A client-facing read is `readJobsOwnedBy`
   * (redacted).
   *
   * The owner filter is part of the QUERY: someone else's job and a missing
   * job are the same `null`, as is a malformed id. Any other database error
   * THROWS (`.name === "JobReadError"`, `.retryable === true`,
   * `.code === "job_read_failed"`), never a null that would tell the user
   * "not your job" during an outage. `input_data` absent reads as `{}`.
   *
   * ADDITIVE-OPTIONAL (no CONTRACT_VERSION bump) — `?.`-guard it.
   */
  readOwnedJob?(jobId: string, userId: string): Promise<PluginOwnedRawJob | null>
  /**
   * Mirrors `waitForJob` (`lib/mcp/tools/_wait-for-job.ts`) — block until a
   * job reaches a terminal state, then hand back its output.
   *
   * The same waiter the MCP tools use, deliberately: the jittered backoff,
   * the abort signal, the one forgiven transient DB error and the held-job
   * (`pending_review`) early return are decisions the host owns, and a plugin
   * polling on its own would re-decide all four differently.
   *
   * ADDITIVE-OPTIONAL (no CONTRACT_VERSION bump) — `?.`-guard it.
   */
  waitForJob?(opts: PluginWaitForJobOptions): Promise<PluginWaitForJobResult>
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
  /** Atomic final settlement of an opt-in reservation; never reprices the admitted ceiling. */
  settleReservedJob?(input: PluginJobSettlement): Promise<PluginJobSettlementResult>
  checkpointReservedJob?(input: PluginJobSettlementCheckpoint): Promise<void>
  settleCheckpointedJob?(usageLogId: string): Promise<boolean>
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
   * R38: {@link markProviderCallStart} as a CAS on the live statuses
   * (`markProviderCallStartIfLive`, `lib/reconcile/persistence.ts`) — what a
   * plugin route that reserved a METERED LLM hold (`reserveLlmCall`) stamps
   * immediately before its call. `not-live`: the job was cancelled since the
   * reserve — the call must NOT be sent (the cancel found no stamp and refunded
   * the hold); `error`: not stamped — do not send it either. Release the hold
   * with `settleLlmJob` on an empty spend in both cases.
   */
  markProviderCallStartIfLive(jobId: string, kind: string): Promise<"started" | "not-live" | "error">
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
   *
   * `job_type` IS THE QUEUE NAME AFTER PICKUP, not the type the plugin's own
   * route admitted: the app's video worker OVERWRITES `jobs.job_type` with the
   * BullMQ `job.name` in the CAS that picks a row up (the app's
   * `workers/video-worker.ts`) — an unconditional overwrite the gallery
   * allowlists depend on, not a backfill. A `row.job_type !== "<admitted type>"` guard is
   * therefore safe only when the lane inserts and enqueues under the SAME
   * string (generate-video-pro's deliberate lockstep). A lane that admits X and
   * enqueues Y must accept BOTH — assuming otherwise is what left the Scene3D
   * advanced preview lane dark for a day (plugins PR #467).
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
   * `readJob`'s twin that tells a DATABASE ERROR apart from "no such row".
   * `readJob` drops the Supabase error and returns null, so a blip reads as
   * "not found" (a 404, or "not your tracks") and blames the user for an
   * outage. This returns null ONLY when the query succeeded and found no row;
   * on a database error it THROWS an Error whose `.name === "JobReadError"`,
   * `.retryable === true` and `.code === "job_read_failed"`, with a message
   * that says the read failed (never that the job is missing, never the
   * database's own text). A route answers it as a retryable 503; a handler
   * rethrows it so the queue's retry policy runs.
   *
   * OPTIONAL (additive-contract convention): absent → the app predates it;
   * feature-detect (`tk.jobs.readJobStrict ?? tk.jobs.readJob`) and keep the
   * old behaviour. Same row shape as `readJob`, `job_type` and `input_data`
   * included.
   */
  readJobStrict?(jobId: string): Promise<{
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
   *
   * `detail` (optional, W0): the provider's raw error; the toolkit redacts it (lib/provider-error-detail.ts) into `jobs.error_detail`. Omit when there is no provider text.
   */
  markJobFailed?(jobId: string, errorMessage: string, detail?: string | null): Promise<boolean>
  /**
   * The same CAS and the same boolean, plus `output_data` (2026-09-11, Scene3D
   * refused drafts).
   *
   * It exists for the one shape of failure that still produced something a
   * caller can USE: a Pro 3D run whose scene was built and reviewed and then
   * refused retains that draft as a scene revision and a delivery, and the row
   * has to say WHERE — `sceneRevisionId`, `deliveryId`, `posterAssetId`,
   * `validation.reportAssetId`. Without it the evidence exists and nothing a
   * caller can reach addresses it (staging job fa2111ae, 2026-09-11).
   *
   * A failed row NEVER carries a media URL through here: the producer omits
   * `resultUrl`/`videoUrl` (contracts §5 — a failed job must not masquerade as
   * a video producer), and every reader of `output_data` that resolves media
   * gates on `status` or on the URL field itself.
   *
   * OPTIONAL (additive-contract convention): absent → the plugin falls back to
   * `markJobFailed`; the verdict still settles and the retained revision and
   * delivery stay reachable through their own authenticated routes.
   */
  markJobFailedWithOutput?(jobId: string, errorMessage: string, outputData: Record<string, unknown>,
    detail?: string | null): Promise<boolean>
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
  /** P14: wealth-check-only guard — the route never reserves in-request, so
   *  the preflight stays PERSONAL even under a workspace billing context.
   *  Additive-optional (no CONTRACT_VERSION bump); today's plugin routes all
   *  reserve in-request via `tk.reserveCreditsForJob` and take the default. */
  checkOnly?: boolean
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
  /**
   * Streaming body. The reason it exists: `arrayBuffer()` buffers whatever the
   * upstream sends before anyone can measure it, so a lying or absent
   * `content-length` on an attacker-influenced URL is an unbounded allocation.
   * A reader lets a caller enforce a real byte ceiling and destroy the socket
   * the moment it is crossed. Structurally satisfied by `ReadableStream`.
   */
  readonly body?: PluginFetchBody | null
}

/** The `ReadableStream` subset a bounded reader needs. */
export interface PluginFetchBody {
  getReader(): PluginFetchBodyReader
  cancel(reason?: unknown): Promise<void>
}

/** The `ReadableStreamDefaultReader<Uint8Array>` subset a bounded reader needs. */
export interface PluginFetchBodyReader {
  read(): Promise<{ done: boolean; value?: Uint8Array }>
  cancel(reason?: unknown): Promise<void>
  releaseLock(): void
}

/**
 * The `SafeFetchInit` (`lib/safe-fetch.ts`) subset a plugin may pass. Narrowed
 * on purpose: it carries no `body`, no `dispatcher` and no credential-bearing
 * member, so widening the init cannot be used to turn the SSRF-checked fetch
 * into a general-purpose outbound client.
 */
export interface PluginSafeFetchInit {
  method?: "GET" | "HEAD"
  headers?: Record<string, string>
  /** Cancels the request; applied in addition to `timeoutMs`. */
  signal?: AbortSignal
  /** Per-request timeout in ms. The host defaults to 30s when unset. */
  timeoutMs?: number
  redirect?: "follow" | "error" | "manual"
}

/**
 * Mirrors the return shape of `computeVoiceChangerProPricing`
 * (`ee/billing/voice-changer-pro-credits.ts`). BASE (pre-markup) credits:
 * the per-minute speech-to-speech unit and the per-1K Re-speak unit are read
 * from `model_pricing` (static seed as fallback), each slot priced as
 * `max(floor, ceil(unit × stemSec / 60))` / `max(floor, ceil(chars/1000) × per1K)`.
 * On a host that prices speech by length (SPEECH_LENGTH_PRICING_ENABLED), a
 * Re-speak slot is instead priced exactly as the Text to Speech node prices
 * the same text on the slot's engine model (v3 → `elevenlabs-v3`, v4 →
 * `elevenlabs-v4`): per started 100 characters with the speech floor;
 * `respeakCredits` carries the result, `respeakPer1K` still reports the flat
 * row. The speech-to-speech slots and `floor` are the same either way.
 */
export interface VoiceChangerProPricing {
  unitPerMinute: number
  respeakPer1K: number
  floor: number
  stsCredits: number[]
  respeakCredits: number[]
  reserveBase: number
}

/**
 * Mirrors the return shape of `computeVoiceChangerProTranslatePricing`
 * (`ee/billing/voice-changer-pro-credits.ts`) — the translate step of
 * "Re-speak in another language". BASE (pre-markup) credits: the floor is
 * the `voice-changer-pro-translate` row, the reservation is a CEILING per
 * started 1K source characters for the tier; the worker commits the metered
 * actual under it.
 */
export interface VoiceChangerProTranslatePricing {
  /** BASE floor — the `voice-changer-pro-translate` row (admin-tunable). */
  floor: number
  /** BASE reservation ceiling per started 1K source characters for the tier. */
  ceilingPer1K: number
  /** max(floor, ceil(sourceChars / 1000) × ceilingPer1K) — pre-markup. */
  reserveBase: number
}

/**
 * Mirrors the return shape of `computeGenerateVideoProPricing`
 * (`ee/billing/generate-video-pro-credits.ts`) — the pro split/pricing
 * formula's single source of truth, shared by the route's credit-guard
 * `computeCredits` and the node-executor override path.
 */
export interface GenerateVideoProPricing {
  sourceSegmentDurations?: number[]
  /** Upper-bound reservation awaiting action-aligned planning. */
  segmentPlanning?: { mode: "short" | "long"; durationSec: number; minSeg: number; maxSeg: number; lossSec: number; capSec: number }
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
  /** This host stores internalRequest.jobSubmission on the initial job insert. */
  supportsJobSubmissionContext?: true
  /** Applies the same configured service/global markup used by creditGuard to
   *  a dynamic pre-markup total, without checking balance or reserving it. */
  applyCreditMarkup(modelIdentifier: string, baseCredits: number): Promise<number>
  /**
   * ADDITIVE-OPTIONAL (no CONTRACT_VERSION bump) — `?.`-guard it.
   * The charge-time price of each UGC builder call (`{ tool, args }`, MCP
   * argument names), one number per call, in order — the same rows and the same
   * gates the credit guard uses for that payer. An unpriceable call rejects;
   * it is never priced 0. Nodaro Cloud only: rejects on any other edition.
   */
  priceUgcCalls?(
    caller: { userId: string; billingContext?: PluginBillingContext },
    calls: ReadonlyArray<{ tool: string; args: Readonly<Record<string, unknown>> }>,
  ): Promise<number[]>
  /** Mirrors `supabase` (`lib/supabase.ts`), shaped to VCP route usage. */
  supabase: PluginSupabaseClient
  /** Mirrors `videoQueue` (`lib/queue.ts`), narrowed to the one method used. */
  videoQueue: { add(name: string, data: Record<string, unknown>, opts?: { attempts?: number; jobId?: string }): Promise<unknown> }
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

  /**
   * ADDITIVE-OPTIONAL (no CONTRACT_VERSION bump) — `?.`-guard it.
   * Can the payer of this request afford `credits` (final, already marked-up
   * credits) right now? Payer-aware exactly as creditGuard's balance check
   * (personal, workspace, deployment payer). Holds nothing and leaves nothing on
   * the request (no reservation, no creditOverride). Resolves { ok: true }, or
   * { ok: false, statusCode, body } where statusCode/body are exactly what
   * creditGuard sends when the balance is short (same code, same message shape).
   * Rejects on an internal failure. Cloud only (hasCredits()); absent elsewhere.
   */
  checkPayerCanAfford?(req: FastifyRequest, credits: number): Promise<{ ok: true } | { ok: false; statusCode: number; body: unknown }>

  /** Optional atomic job reservation with exact replay and transactional ledger. */
  reserveCreditsForJobOnce?(
    req: FastifyRequest, reply: FastifyReply, jobId: string, modelIdentifier: string,
  ): Promise<PluginCreditReservation | undefined>;
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
  safeFetch(url: string, init?: PluginSafeFetchInit): Promise<PluginFetchResponse>
  /** Public HTTP bytes, SSRF checked, 30s timeout and streaming cap (1–25 MiB).
   * Caller must separately authorize the source. No storage credentials. */
  safeFetchBytes?(url: string, maxBytes: number): Promise<Buffer>
  /** Mirrors `insertWithIdempotencyKey` (`lib/idempotent-insert.ts:33`).
   *  P14: the optional context stamps the payer pair (workspace_id/org_id)
   *  onto the row — which also trips the DB privacy clamp for workspace
   *  work. Additive-optional: an older plugin's rows stay personal-shaped. */
  insertJobWithIdempotencyKey(
    data: Record<string, unknown> & { user_id: string },
    idempotencyKey: string | null | undefined,
    billingContext?: PluginBillingContext,
    /** The originating request. When given, the toolkit stamps the calling
     *  surface (`source` / `source_detail`, `lib/job-source.ts`) UNDER the
     *  plugin's row — caller-supplied columns still win — so plugin jobs stop
     *  rendering as "—" in /admin/jobs. Additive-optional (no contract bump):
     *  an older plugin omits it and its rows stay unstamped as before. */
    req?: FastifyRequest,
  ): Promise<{ id: string; created: boolean }>
  /**
   * The request job funnel for a plugin route: mirrors `insertJobIdempotent`
   * (`lib/insert-job.ts`). On top of `insertJobWithIdempotencyKey` it stamps
   * what a core route's job carries — the request's validated `session_id`
   * (`sessionId` in `req.body`), its client `input_data.origin` (`origin` in
   * `req.body`), the calling surface, and the P14 payer pair from
   * `req.billingContext` — and runs the job-policy gate before any row exists.
   * A plugin-written `session_id` / `input_data.origin` is replaced by the
   * request's.
   *
   * A refusal of the request rejects with a `PluginHttpError` (identify it by
   * `.name === "PluginHttpError"`) whose `statusCode` + `body` the route sends
   * verbatim: a session the caller may not use → 404, an `origin` that is not
   * a slug → 400, a job-policy block → 422. Any other failure (the database)
   * is re-thrown unchanged.
   *
   * ADDITIVE-OPTIONAL (no CONTRACT_VERSION bump) — `?.`-guard it.
   */
  insertJobWithProvenance?(
    req: FastifyRequest,
    row: Record<string, unknown> & { user_id: string },
    idempotencyKey: string | null | undefined,
  ): Promise<{ id: string; created: boolean }>
  /**
   * Mirrors `computeVoiceChangerProPricing`
   * (`ee/billing/voice-changer-pro-credits.ts`) — see `VoiceChangerProPricing`.
   * Same dynamic-import gate as `computeGenerateVideoProPricing` below.
   * Additive-optional (no contract bump): `?.`-guard it and fall back to the
   * plugin's own constants when the host predates it.
   */
  computeVoiceChangerProPricing?(args: {
    /** Stem seconds per speech-to-speech slot (prorated per second, rounded up
     *  to the next credit); null/0 = unknown → one minute. */
    stsSlotSeconds: ReadonlyArray<number | null | undefined>
    /** Re-spoken chars per Re-speak slot; null/0 = unknown → one 1K bucket. */
    respeakChars: ReadonlyArray<number | null | undefined>
    /** The engine of each Re-speak slot, index-aligned with `respeakChars`
     *  (`"v3"` | `"v4"`); absent, shorter, null or unknown → v3. Picks the
     *  text-to-speech row the slot is priced on where the host prices speech
     *  by length; ignored otherwise. Additive-optional (no contract bump):
     *  a plugin that omits it prices every Re-speak slot as v3. */
    respeakEngines?: ReadonlyArray<string | null | undefined>
    /** Whether each Re-speak slot speaks a translation, index-aligned with
     *  `respeakChars`. RESERVE ONLY: a translated v4 slot is priced on its
     *  transcript × the host's translated allowance (`respeakReservedChars`,
     *  `ee/billing/voice-changer-pro-pricing.ts`), so the plugin sends the
     *  transcript's own count. A metered commit never sends it. Honoured
     *  where `tk.capabilities.voiceChangerProRespeakSlotArgs` is true; an
     *  older host ignores it (the plugin multiplies itself there). */
    respeakTranslated?: ReadonlyArray<boolean | null | undefined>
  }): Promise<VoiceChangerProPricing>
  /**
   * The translate step's reservation ceiling from the host's `model_pricing`
   * floor — see `VoiceChangerProTranslatePricing`. Same dynamic-import gate
   * as `computeVoiceChangerProPricing` above. ADDITIVE-OPTIONAL (no contract
   * bump): `?.`-guard it; an older host prices at the plugin's constants.
   */
  computeVoiceChangerProTranslatePricing?(args: {
    /** Characters of SOURCE text the translation is asked for. */
    sourceChars: number
    tier: "economy" | "standard" | "premium"
  }): Promise<VoiceChangerProTranslatePricing>
  /**
   * ADDITIVE-OPTIONAL (no CONTRACT_VERSION bump) — feature-detect it
   * (`typeof tk.http.unitRatePrice === "function"`).
   * The BASE (pre-markup) price of `units` of a per-unit rate (`rateId`, e.g.
   * `speaker-view:proxy` per output minute), read through the lookup that
   * prices the rate's whole-run quote (`<rateId>:<units>u`): the rate's
   * `model_pricing` row, else `STATIC_CREDIT_COSTS` (a plugin's
   * `staticCreditCosts()` included), × the units, rounded up once.
   * `unitBaseCredits` is the row itself, from the same read — stamp it on the
   * job so a later count-based commit prices at the rate the reserve used.
   * Hand `baseCredits` to `creditGuard`'s `computeCredits` (which marks it up),
   * so an admin's retune of the row moves the route's charge with its quote.
   * A rate priced nowhere rejects (`PriceNotConfiguredError`), as its quote
   * does. Cloud-only: rejects on any other edition.
   */
  unitRatePrice?(rateId: string, units: number): Promise<{ unitBaseCredits: number; baseCredits: number }>
  /**
   * Mirrors `computeGenerateVideoProPricing`
   * (`ee/billing/generate-video-pro-credits.ts`) — see `GenerateVideoProPricing`.
   * Core may not statically import `ee/`; the toolkit implementation reaches
   * it via a runtime-gated dynamic `import()` (mirrors
   * `middleware/credit-guard.ts`'s shim pattern and `load.ts`'s
   * `applyStaticCreditCosts`/`applyPipelinePrompts`).
   */
  /**
   * The BASE (pre-markup) credits a Seedance 2.5 draft finalize costs, from the
   * draft's delivered length and — for a draft made with a reference VIDEO —
   * the draft's own probe of its reference clips (input + output seconds).
   * `creditId` is the row the host would reserve under; mark it up with
   * `applyCreditMarkup(creditId, baseCredits)`. Without a reference video the
   * base is the `seedance-2-5-hd:{N}s` row, DB-first (`model_pricing` over
   * `STATIC_CREDIT_COSTS` — admin overrides apply). With one it is the
   * per-second rate of `STATIC_CREDIT_COSTS["seedance-2-5-hd:8s-ref"]` ONLY
   * (no DB read, so an admin override of a `-ref` row does not apply) × the
   * input + output seconds — the same rule as the generation reference lane
   * (`ee/billing/seedance2-ref-video-credits.ts`). Cloud-only, same dynamic-import gate as
   * `computeGenerateVideoProPricing`. ADDITIVE-OPTIONAL (no contract bump).
   */
  /**
   * The CHARGED credits a Seedance 2 / Kling 4.0 reference-video run holds and
   * is expected to settle at, from reference clips the caller has ALREADY
   * measured — for a clip that only exists after the quote (Cast Swap cuts its
   * clip once it has quoted). `hold` is exactly what the run reserves (the
   * reservation's own rule, `seedance2RefVideoHeldOutputSec`: an Auto run's
   * output held at the first clip rounded up plus a second);
   * `expected` is what it should settle at once delivered, null when a clip
   * is unmeasurable. `duration` is the requested duration (-1 = Auto);
   * `durationsSec` the measured clip lengths in seconds, in request order
   * (null or NaN = unmeasurable, priced at the worst case). Rejects for a
   * model whose price does not follow its reference clips. Cloud-only.
   * Present when `tk.capabilities.seedanceRefVideoQuote` is true.
   * ADDITIVE-OPTIONAL (no contract bump).
   */
  quoteSeedanceRefVideo?(args: {
    provider: string
    resolution?: string
    duration?: number
    draft?: boolean
    durationsSec: ReadonlyArray<number | null>
  }): Promise<{ hold: number; expected: number | null }>
  computeSeedanceDraftFinalizePricing?(args: {
    /** The draft's delivered length in seconds (rounded to the billed whole seconds). */
    draftDurationSec: number
    /** The draft's reference-clip durations; empty/absent = no reference video. */
    refVideoDurationsSec?: ReadonlyArray<number | null>
  }): Promise<{ creditId: string; baseCredits: number }>
  computeGenerateVideoProPricing(args: {
    sourceSegmentDurations?: number[]
    segmentMode?: "short" | "long" | "max"
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
  /**
   * How a plugin route reaches another `/v1` route.
   *
   * A plugin that needs what a core route already does — the credit
   * reservation, the model gates, the job row, the 402/413 refusals, the
   * provenance stamp — CALLS it, so behaviour and pricing cannot drift
   * between "the plugin did it" and "an agent did it".
   *
   * The identity travels the way `lib/mcp/internal-request.ts` sends it: the
   * internal-orchestrator secret plus `x-internal-user-id`, which the auth
   * hook reads. The route handling the outer request has a `userId` but no
   * JWT it could replay, which is the same situation the MCP tools are in.
   *
   * `headers` adds what the reached route needs (an `idempotency-key`, say);
   * a header that decides identity, billing or how the body is read is
   * dropped, so only this member's typed options set those (see
   * `PluginInternalRequestOptions.headers`). The body cannot pick the
   * identity either: a top-level `userId` in `payload` that is not
   * `opts.userId` is replaced by it before the request is sent (one that
   * already names the caller, or none at all, leaves the body untouched).
   * `payload` must be a JSON-serializable object; a string, Buffer, typed
   * array, stream, FormData, URLSearchParams or Blob is refused, because it
   * could not be checked. A refused option (that payload, or a `request` of
   * another user) rejects the call with a 400 `PluginHttpError`
   * (`validation_error`) and nothing is sent.
   *
   * Provenance is opt-in per call: the payload's `origin` / `sessionId` are
   * IGNORED (a payload can carry records the plugin's caller controls). The
   * job the reached route creates carries only what `opts.provenance`
   * declares — fields the plugin validated itself — checked as a public
   * request's are: `origin` against the slug rule (else a 400), `sessionId`
   * as the caller's own session on the request's side of the workspace line,
   * under the outer caller's grant (else the route's 404). See
   * `PluginInternalRequestOptions.provenance` / `.request`; gate on
   * `tk.capabilities?.internalRequestProvenance`.
   *
   * ADDITIVE-OPTIONAL (no CONTRACT_VERSION bump) — `?.`-guard it.
   */
  internalRequest?(
    app: FastifyInstance,
    opts: PluginInternalRequestOptions,
  ): Promise<PluginInjectedResponse>
  /**
   * `internalRequest` for code that has no Fastify app in hand — a queue
   * handler in the video worker. Same contract: the same internal headers
   * (caller headers filtered), the same pinned `payload.userId`, the same
   * `jobSubmission` scope. The host supplies the app: the API app in the API
   * process; in the worker, an app built once at worker boot and reused
   * (`lib/private-plugins/worker-app.ts`). Absent where the process has no app
   * to reach (the daemon host).
   *
   * `parentJobId` is the id (a UUID) of the job the handler is running. It
   * travels only in the server-side submission scope, never on the wire, so
   * the route's job insert can be tied to it. A job with a parent is a step
   * of that job, so it carries no `origin` and no session, whatever the
   * payload or `provenance` says.
   *
   * ADDITIVE-OPTIONAL (no CONTRACT_VERSION bump) — `?.`-guard it.
   */
  workerRequest?(
    opts: PluginInternalRequestOptions & { parentJobId?: string },
  ): Promise<PluginInjectedResponse>
}

export interface PluginInternalRequestOptions {
  /** Trusted metadata stored atomically on matching job inserts, outside public JSON. */
  jobSubmission?: { readonly jobType: string; readonly metadata: Readonly<Record<string, unknown>> }
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE"
  url: string
  /** The caller — impersonated through the internal secret, exactly as MCP does. */
  userId: string
  /** A JSON-serializable object; its top-level `userId`, if any, is pinned to `userId`. */
  payload?: object
  /** The caller's workspace, when the outer request carried one. */
  workspaceId?: string
  /**
   * Extra headers this route needs (an `idempotency-key`, say). Headers that
   * decide identity, billing or how the body is read (`x-internal-*`,
   * `x-app-run`, `x-web-free-mode`, the workspace header, `authorization`,
   * `cookie`, `content-type`, `content-length`, `host`) are dropped in any
   * letter case: only the options above set them, and a body is sent as JSON.
   */
  headers?: Record<string, string>
  /**
   * The client provenance the job the reached route creates should carry —
   * opt-in, per call: without it the job carries none, whatever the payload
   * holds. Fill it only from fields the plugin validated (never by spreading
   * an open record); every other key is ignored.
   *  - `origin`: the calling client's origin slug (`input_data.origin`); not a
   *    slug is the route's 400.
   *  - `sessionId`: a generation session to file the job in. Applied only
   *    with `request` (the host reads the outer caller's grant from it): the
   *    caller's own session, on the request's side of the workspace line, and
   *    `assets:write` for an OAuth app or an MCP session, else the route's 404.
   *    Without `request`, or when the outer request's grant cannot be told
   *    (an internal hop no server-side scope vouches for), it is not applied.
   *
   * ADDITIVE-OPTIONAL (no CONTRACT_VERSION bump): an older host ignores it,
   * so gate on `tk.capabilities?.internalRequestProvenance`.
   */
  provenance?: { origin?: string; sessionId?: string }
  /**
   * The plugin route's OWN request this call serves (the `req` its handler
   * got), so a declared `provenance.sessionId` is held to the outer caller's
   * grant. What holds:
   *  - no option states a grant: the host reads it off this object, by the
   *    credential its auth hook recorded (`authKind`, and an OAuth app's
   *    `appAuthorization`), or, for an internal request, from the scope server
   *    code attached to it (an MCP session's grant);
   *  - only an object the host itself received counts (registered when the
   *    request arrived); one merely shaped like a request, or one with no or
   *    an unrecognised `authKind`, names no grant, and the session is not
   *    applied;
   *  - it must be the same user as `userId`, else the call is refused (a 400
   *    `PluginHttpError`) before anything is sent.
   * Which received request is passed is still the plugin's choice: the host
   * cannot tell that it is the one this call serves rather than another
   * request of the same user, so pass the handler's own `req`.
   * ADDITIVE-OPTIONAL, as `provenance`.
   */
  request?: FastifyRequest
}

/** What `fastify.inject()` answers with, narrowed to what a caller reads. */
export interface PluginInjectedResponse {
  statusCode: number
  body: string
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
  /**
   * Allow ONE transport retry when the provider call fails before reporting any usage —
   * a connection error, a 5xx, an error frame or a silent close with no tokens. Defaults to
   * TRUE; pass `false` to see the first failure immediately.
   *
   * Additive-optional, and INERT until the plugin repo mirrors the field in its own
   * `contract.ts`. It exists because `maxRetries` cannot express this: that option counts
   * VALIDATION retries — re-asking a provider that already answered and billed — which is
   * exactly why a structured plugin call sets it to 0. A failure that reported no usage cost
   * nothing, so it is a different question and gets a different lever. Mirrors
   * `LlmRequest.retryStreamOnError` (`lib/llm-client.ts`); a call that DID report usage is
   * never retried whatever this says.
   */
  retryStreamOnError?: boolean
}

/**
 * Multimodal content block — a structural subset of `lib/llm-client.ts`'s
 * `LlmContentBlock` union (text | image | image_base64 | video | video_base64 |
 * audio), narrowed to the parts the video-analysis window turn uses (video +
 * text; image kept for forward-compat). A real app `LlmContentBlock[]`
 * satisfies this.
 */
export type PluginLlmContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; url: string }
  | { type: "image_base64"; mediaType: string; data: string }
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
  | {
      /**
       * Inline video BYTES — the exact clip, in the request itself.
       *
       * For a plugin that must analyse a SPECIFIC, IMMUTABLE payload it already
       * holds: it neither publishes the user's media to reach the model nor
       * leans on a mutable/signed URL as the request's durable identity (the
       * object behind such a URL can change, expire or 403 between build and
       * read, and the analysis would silently describe something else).
       *
       * ADDITIVE (no CONTRACT_VERSION bump): this WIDENS what the host accepts,
       * so every existing plugin is unaffected, and a plugin that sends the
       * block to an older host simply has no such member on its own mirror.
       *
       * Constraints, all enforced host-side before anything is sent or metered
       * (`lib/gemini/media.ts`): `mediaType` exactly `video/mp4`, canonical
       * base64 (no `data:` prefix, no whitespace, no URL-safe alphabet), real
       * MP4 `ftyp` magic, and 6 MiB of RAW bytes. Larger clips stay on the
       * URL-bearing `video` block, which streams to Google's Files API.
       *
       * Direct-lane only, and the host REJECTS the whole request otherwise —
       * `completeStructuredMultimodal` already defaults `requireLane: "direct"`,
       * but a caller reaching the metered adapter directly must pass it.
       */
      type: "video_base64"
      mediaType: "video/mp4"
      data: string
      /** Frame sampling rate — same semantics and cost as the `video` block's. */
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
  /**
   * Allow ONE transport retry when the provider call fails before reporting any usage —
   * a connection error, a 5xx, an error frame or a silent close with no tokens. Defaults to
   * TRUE; pass `false` to see the first failure immediately.
   *
   * Additive-optional, and INERT until the plugin repo mirrors the field in its own
   * `contract.ts`. It exists because `maxRetries` cannot express this: that option counts
   * VALIDATION retries — re-asking a provider that already answered and billed — which is
   * exactly why a structured plugin call sets it to 0. A failure that reported no usage cost
   * nothing, so it is a different question and gets a different lever. Mirrors
   * `LlmRequest.retryStreamOnError` (`lib/llm-client.ts`); a call that DID report usage is
   * never retried whatever this says.
   */
  retryStreamOnError?: boolean
}

/**
 * What one attempt of an LLM call spent — structural mirror of the host's
 * `LlmAttemptSpend` (`lib/llm/types.ts`). Each attempt is costed on the lane
 * that served it, from the size of the request it sent.
 */
export interface PluginLlmAttemptSpend {
  lane: "kie" | "direct-gemini" | "direct-anthropic"
  modelId: string
  requestChars: number
  inputTokens: number
  outputTokens: number
  providerCost?: number
  creditsUsd?: number
  estimated?: true
}

export interface PluginLlmMeteredUsage {
  inputTokens: number
  outputTokens: number
  providerCost?: number
  /** False means some provider usage is unknown; never treat it as zero cost. */
  complete: boolean
  /**
   * Every attempt the call made (additive-optional: absent on an older host).
   * A failed result passed whole to `tk.llmBilling` spend `add(…, { error: result })`
   * is costed from these.
   */
  attempts?: PluginLlmAttemptSpend[]
}
/**
 * On success `lane` and `attempts` (additive-optional) let the result itself
 * be recorded: `spend.add(model, request, { output: result })`; on failure
 * `spend.add(model, request, { error: result })`.
 */
export type PluginLlmMeteredResult<T> =
  | { ok: true; output: T; usage: PluginLlmMeteredUsage; lane?: PluginLlmAttemptSpend["lane"]; attempts?: PluginLlmAttemptSpend[] }
  | { ok: false; message: string; usage: PluginLlmMeteredUsage }

export interface PluginLlmToolkit {
  /**
   * Is `modelId` an LLM this host can serve — answered from the HOST's live
   * registry (canonical ids and their dash-form/slug aliases, `getLlmModel`).
   *
   * A plugin validates a caller-supplied model id with this instead of its own
   * pinned `@nodaro/shared`, which lags the host by whole releases (a model the
   * host added last week would be refused). Additive-optional: on a host that
   * predates it a plugin falls back to its pinned list.
   */
  isKnownModel?(modelId: string): boolean
  /** Preserves usage on failures and uses the selected model's normal lane. */
  completeStructuredMetered?<T>(
    req: PluginLlmMultimodalRequest,
    schema: unknown,
    opts?: { schemaName?: string; maxRetries?: number },
  ): Promise<PluginLlmMeteredResult<T>>
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
  ): Promise<{ output: T; providerCost?: number; lane?: PluginLlmAttemptSpend["lane"]; attempts?: PluginLlmAttemptSpend[] }>
}

// ============================================================================
// tk.llmBilling — metered LLM billing (lib/llm-billing.ts)
// ============================================================================

/**
 * One call a metered feature makes for certain, as it will be sent: its hold
 * is one attempt of it on its primary lane. Structural mirror of
 * `LlmPlannedCall` (`lib/llm-billing.ts`); `request` is the host's
 * `LlmRequest` shape (modelId, system, messages, maxTokens, reasoningEffort,
 * requireLane, jsonSchema …).
 */
export interface PluginLlmPlannedCall {
  modelId: string
  request: {
    modelId: string
    system: string
    messages: Array<{ role: "user" | "assistant"; content: string | PluginLlmContentBlock[] }>
    maxTokens?: number
    reasoningEffort?: string
    requireLane?: "kie" | "direct"
    jsonSchema?: { name: string; schema: Record<string, unknown> }
  }
  /** Length of EACH video / audio block, when known. */
  mediaSeconds?: number
  cheapLanesOnly?: boolean
}

/**
 * `{ metered: true, … }` — the hold is reserved; `{ metered: false }` —
 * metering is off on this host, bill as before; `undefined` — a reply was
 * already sent (a refusal), return at once.
 */
export type PluginLlmReserveResult =
  | {
      metered: true
      reservation: { usageLogId: string; creditsReserved: number; watermark: boolean }
      chargeId: string
      holdCredits: number
    }
  | { metered: false }
  | undefined

/**
 * The spend of one metered job (`LlmSpend`). Every call the job makes is
 * added — fallbacks and repairs included — with the request it sent and its
 * outcome: `{ response }` (an `llmComplete` answer), `{ output }` (a
 * structured call's full output, with its per-attempt `attempts`), or
 * `{ error }` (whatever the call threw). Only a spend from `newSpend()` may
 * be settled.
 */
export interface PluginLlmSpend {
  /**
   * `{ output }` takes a `completeStructuredMetered` success or a
   * `completeStructuredMultimodal` result (their `attempts`, else `lane` +
   * totals); `{ error }` a failed `completeStructuredMetered` result or a
   * thrown error. A malformed outcome (no lane, a count that is not a finite
   * number) throws `TypeError` rather than recording a figure that cannot be
   * charged.
   */
  add(
    modelId: string,
    request: PluginLlmPlannedCall["request"],
    outcome:
      | { response: unknown }
      | { output: { lane?: PluginLlmAttemptSpend["lane"]; attempts?: PluginLlmAttemptSpend[]; inputTokens?: number; outputTokens?: number; providerCost?: number } }
      | { error: unknown },
  ): void
  readonly costUsd: number
  readonly billedAnything: boolean
}

export interface PluginLlmBillingToolkit {
  /**
   * Whether this host bills LLM calls metered RIGHT NOW: false under the
   * rollback, without credits, and until the host has confirmed its metered
   * schema (R33). It can flip from false to true while the process runs (once
   * the schema is confirmed; never back), so read it on EVERY call — never
   * cache it at registration or plugin load.
   */
  meteredPricing(): boolean
  /** `reserveLlmCall`: hold one attempt of each planned call, marked up at `<feature>:<calls[0].modelId>`. */
  reserve(
    req: FastifyRequest,
    reply: FastifyReply,
    jobId: string,
    args: { feature: string; calls: readonly [PluginLlmPlannedCall, ...PluginLlmPlannedCall[]] },
  ): Promise<PluginLlmReserveResult>
  newSpend(): PluginLlmSpend
  /** `settleLlmJob`: charge the real cost (refund when nothing was billed). `unsettled` = left for the reconcile sweep. */
  settle(
    jobId: string,
    reserve: PluginLlmReserveResult,
    spend: PluginLlmSpend,
  ): Promise<PluginLlmSettleOutcome>
  /**
   * Metered SIDE holds (`lib/llm-side-hold.ts`, migration 554) — a metered
   * hold for an LLM call a job makes BESIDE its own reservation (a UGC
   * clip's per-take frame check), reserved, started and settled from a WORKER.
   * It never touches the job's row or its reservation (`usage_log_id`,
   * `credits`, `credits_actual`, checkpoints, the job's cancel decision).
   * Optional: feature-detect it (`tk.llmBilling?.side`), then ask
   * `available()` on every call.
   */
  side?: PluginLlmSideHoldToolkit
}

/** What a metered settle did (`LlmSettleOutcome`). `unsettled` = left reserved for the reconcile sweep, never refunded on a guess. */
export type PluginLlmSettleOutcome =
  | { outcome: "charged"; charged: number; shortfall: number }
  | { outcome: "refunded" }
  | { outcome: "not-metered" }
  | { outcome: "unsettled" }

/**
 * Who pays for a side hold: the job's payer as its admitting request
 * resolved it (`payerOf(req)` in the route), stamped on the job's payload and
 * handed back by the worker — never re-resolved. Opaque to the plugin; the
 * host checks it (another user's or a malformed context is refused). Absent =
 * the personal payer.
 */
export interface PluginLlmSideHoldPayer {
  billingContext?: unknown
  isAppRun?: boolean
  webFreeMode?: boolean
  skipAutoRecharge?: boolean
  communityInstance?: boolean
}

/** A side-hold refusal: nothing was reserved and the job was not touched. */
export interface PluginLlmSideHoldRefusal {
  ok: false
  /**
   * `unavailable` (metered pricing is off: bill as before), `job_not_live`,
   * `conflict`, `llm_model_unpriced`, `insufficient_credits`,
   * `subscription_required`, `free_video_limit`, `consent_required`,
   * `invalid_request`, a reserve refusal (`budget_exceeded`,
   * `member_cap_exceeded`, `user_allowance_exceeded`, `access_blocked`, …)
   * or `reservation_failed`.
   */
  code: string
  /** A user-presentable sentence. */
  message: string
  /** `insufficient_credits`: the hold. */
  required?: number
  balance?: number
}

/** A reserved side hold. */
export interface PluginLlmSideHold {
  readonly jobId: string
  readonly usageLogId: string
  /** `<feature>:<model>` — the charge id it is reserved and settled under. */
  readonly chargeId: string
  readonly holdCredits: number
  /** The key named an open hold already: this is that hold, its recorded spend carried into the settle. */
  readonly replayed: boolean
  /**
   * Immediately before the call. Resolves: send it. Throws — never send it —
   * a `JobCancelledError` (name `"JobCancelledError"`) when the job is no
   * longer live (the hold is released), or an Error when the hold is closed
   * or the start could not be recorded.
   */
  callStarting(): Promise<void>
  /** After every answered call: record the spend so far (the sweep's evidence). Never throws. */
  noteSpend(spend: PluginLlmSpend): Promise<void>
  /**
   * Exactly once, on success, failure and cancel alike: charge the actual (D1), refund what nothing
   * billed. AWAIT the settle of EVERY side hold BEFORE the job's terminal write and BEFORE the clip's
   * final ready checkpoint: a run reads a step's charge (its own + its SETTLED side holds, R53) when
   * the job turns terminal, and a cancel/sweep only waits a short grace for a closed hold.
   */
  settle(spend: PluginLlmSpend): Promise<PluginLlmSettleOutcome>
}

/**
 * Usage, in order, per reading: `reserve({ …, key })` (one key per reading, e.g. `take:${n}`) →
 * `hold.callStarting()` immediately before the call → the call → `spend.add(…)` + `hold.noteSpend(spend)`
 * → `await hold.settle(spend)` — in a `finally`, BEFORE the job's terminal write and before the clip's
 * final ready checkpoint. A refusal `key_settled` on a retried attempt: that reading already ran and
 * was settled — keep its checkpointed verdict, else reserve under a new key. `key_in_use`: retry.
 * The clip's ceiling, when the plugin declares metered readings (`ugc.clipReadingMode() === "metered"`),
 * holds the clip's video + speech only: the reading is held by its own side hold, never in the clip's
 * managed reservation (else held twice).
 */
export interface PluginLlmSideHoldToolkit {
  /** Whether a side hold can be reserved RIGHT NOW (metered pricing on). Read it per call; never cache it. */
  available(): boolean
  /** The request's payer, to stamp on the job's payload for its worker. */
  payerOf(req: FastifyRequest): PluginLlmSideHoldPayer
  /** The hold `reserve` would take for `calls` (one attempt of each on its primary lane), or undefined when metered pricing is off. */
  holdFor(args: { feature: string; calls: readonly [PluginLlmPlannedCall, ...PluginLlmPlannedCall[]] }): Promise<{ chargeId: string; holdCredits: number } | undefined>
  /** What the settle would charge for `spend` under `chargeId` (credits; 0 when nothing billed). */
  creditsFor(chargeId: string, spend: PluginLlmSpend): Promise<number>
  /**
   * Reserve a side hold for job `jobId` (live, owned by `userId`), paid by the
   * job's payer. `key` (unique per job, e.g. `take:3`) makes it idempotent.
   * A refusal is an answer, never a throw.
   */
  reserve(args: {
    jobId: string
    userId: string
    feature: string
    calls: readonly [PluginLlmPlannedCall, ...PluginLlmPlannedCall[]]
    payer?: PluginLlmSideHoldPayer
    /** REQUIRED, unique per job, 1–200 chars — one per reading, e.g. `take:${n}`. */
    key: string
  }): Promise<{ ok: true; hold: PluginLlmSideHold } | PluginLlmSideHoldRefusal>
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
  /** P14: the seeding lane's resolved payer, stamped durably into
   *  pipelines.config (one payer per pipeline). Additive-optional — an
   *  older plugin simply seeds unstamped (personal) pipelines. */
  billingContext?: PluginBillingContext
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

/**
 * One server-sent event a plugin route may write: the subset of the app's
 * `StreamEvent` (`lib/sse.ts`) plugin streams carry today. A new member needs
 * its app-side twin in `StreamEvent` first.
 */
export type PluginSseEvent =
  | { type: "field"; data: { field: string; value: string | string[] } }
  | { type: "done"; data: Record<string, unknown> }
  | { type: "error"; data: { code: string; message: string } }

/** An open event stream on a plugin route's response (`lib/sse.ts`'s `SSEController`). */
export interface PluginSseController {
  sendEvent(event: PluginSseEvent): void
  /** An SSE comment line (a keepalive ping). */
  sendComment(text?: string): void
  /** End the stream. Writes after this, or after the client left, are no-ops. */
  close(): void
  /** True after close() or once the client disconnected. */
  readonly isClosed: boolean
}

/**
 * Server-sent events on a plugin route, written by the app's own helper: one
 * JSON object per `data:` line, a blank line between events, keepalive
 * comments, and origin-checked CORS headers (the raw write bypasses
 * Fastify's CORS hook).
 */
export interface PluginSseToolkit {
  /**
   * Open the stream. It writes `200 text/event-stream` at once, so every
   * plain HTTP error (auth, validation, credits) must be sent BEFORE this.
   */
  create(req: FastifyRequest, reply: FastifyReply): Promise<PluginSseController>
}

// ============================================================================
// PluginToolkit — the full dependency-injection surface handed to every plugin
// ============================================================================

export interface PluginToolkit {
  /** Optional durable, fenced stage journal. Absent on older hosts. */
  stages?: PluginStageToolkit
  sceneArtifacts?: PluginSceneArtifactToolkit
  sceneRendering?: import("./scene3d-render-contract.js").PluginSceneRenderingToolkit
  scenePlayback?: import("./scene3d-playback-contract.js").PluginScenePlaybackToolkit
  providers: PluginProvidersToolkit
  ffmpeg: PluginFfmpegToolkit
  media: PluginMediaToolkit
  storage: PluginStorageToolkit
  jobs: PluginJobsToolkit
  http: PluginHttpToolkit
  llm: PluginLlmToolkit
  /**
   * Metered LLM billing (per-model usage pricing): reserve a call's hold,
   * record what each call spent, settle at the real cost. ADDITIVE-OPTIONAL
   * (no CONTRACT_VERSION bump) — `?.`-guard it; an older host has no such
   * member and the plugin keeps its tier billing.
   */
  llmBilling?: PluginLlmBillingToolkit
  pipelines: PluginPipelinesToolkit
  redis: PluginRedisToolkit
  auth: PluginAuthToolkit
  /**
   * The by-id workflow door, for a plugin that owns routes over workflows it
   * did not create. ADDITIVE-OPTIONAL (no CONTRACT_VERSION bump): a plugin
   * built against it must `?.`-guard the group, because it may load on an
   * older host that predates it.
   */
  workflows?: PluginWorkflowsToolkit
  /**
   * The caller's saved-entity library. ADDITIVE-OPTIONAL (no
   * CONTRACT_VERSION bump) — `?.`-guard it; an older host has no such member.
   */
  entities?: PluginEntitiesToolkit
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
   * Host capability markers (see `PluginCapabilities`). ADDITIVE-OPTIONAL for
   * plugins (no CONTRACT_VERSION bump) — `?.`-guard it; an older host has no
   * such member, and absence means "not supported".
   */
  capabilities?: PluginCapabilities
  /**
   * Deployment-wide settings an admin saves for a plugin feature
   * (`PluginSettingsToolkit`). ADDITIVE-OPTIONAL: an older host has no such
   * member — read it as `tk.settings?.nodaroMotionMasking?.()` and treat
   * absence as "never saved". Advertised per member in `capabilities`.
   */
  settings?: PluginSettingsToolkit
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
  /**
   * The generic account-secret store (`plugin_account_secrets`). Its
   * decrypting members exist only in the daemon host's toolkit — see
   * `PluginAccountSecretsToolkit`. ADDITIVE-OPTIONAL — `?.`-guard it.
   */
  accountSecrets?: PluginAccountSecretsToolkit
  /**
   * The API side of the internal hop to a hosted daemon. ADDITIVE-OPTIONAL —
   * `?.`-guard it.
   */
  daemons?: PluginDaemonClientToolkit
  /**
   * Trigger lanes served by a hosted daemon: read a lane's active rows and
   * start a run from one through the built-in fire-time gates. Daemon host
   * only. ADDITIVE-OPTIONAL — `?.`-guard it.
   */
  triggers?: PluginTriggersToolkit
  /**
   * Server-sent events on a plugin route's response, in the app's own
   * convention. ADDITIVE-OPTIONAL — `?.`-guard it; an older host has none,
   * so a route that can stream answers JSON there.
   */
  sse?: PluginSseToolkit
  /**
   * The user's own connected social accounts, for delivering something to
   * that user. ADDITIVE-OPTIONAL — `?.`-guard it.
   */
  social?: PluginSocialToolkit
}

export interface PluginTelegramBotTextInput {
  /** Whose bot, and whose account it writes to: both are looked up by this owner. */
  userId: string
  /** One of the user's Telegram connections; omitted = their default bot. */
  connectionId?: string
  /**
   * One of the user's own connected Telegram accounts (an account-secret row
   * of theirs, in this environment). The message goes to THAT account's
   * private chat with the bot — the host reads the chat from the row, so a
   * caller can name no other chat.
   */
  toAccountId: string
  /** 1–4096 characters, sent as written (no parse mode), link previews off. */
  text: string
  /**
   * The chat a Telegram message started this run from, when one did. A bot
   * never answers a run started in the chat of ANY of the user's bots
   * (`own_chat`): its replies would start the next run, and two bots of one
   * owner would answer each other for ever.
   */
  startedFromChatId?: string
}

export type PluginTelegramBotTextResult =
  | { status: "sent"; messageId: string }
  /** No such bot of the user's, or Telegram no longer accepts its token (the bot is marked for reconnecting). */
  | { status: "not_connected" }
  /** No such account of the user's here (or an admin switched it off): there is no one to write to. */
  | { status: "no_account" }
  /** The run was started from this bot's own chat: answering would start the next run. Nothing was sent. */
  | { status: "own_chat" }
  /** The person never pressed Start in the bot, or blocked it: a bot cannot write first. */
  | { status: "chat_not_started" }
  | { status: "rate_limited"; retryAfterSeconds: number | null }
  /** `uncertain`: the request may have reached Telegram — never send it again. */
  | { status: "failed"; reason: string; uncertain: boolean }

export interface PluginSocialToolkit {
  /**
   * One plain-text message from the user's own connected Telegram bot.
   * Telegram's answer is a typed result; only arguments the caller got wrong
   * throw. ADDITIVE-OPTIONAL — `?.`-guard it.
   */
  sendTelegramBotText?(input: PluginTelegramBotTextInput): Promise<PluginTelegramBotTextResult>
}

/**
 * The two Stripe operations the organization billing routes need. Implemented
 * host-side over `ee/billing/org-customer.ts` (the plugin cannot import
 * `ee/`); everything else about org money is a database RPC the plugin calls
 * through `db`.
 * Direction: host → plugin. The OTHER `billing` in this file —
 * `PluginServices.billing` (PluginBillingService) — points the opposite
 * way (plugin → host: payer resolution, P14).
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
  scene3dAdvanced?: boolean
  scene3dLocal?: boolean
}

/**
 * What THIS host's toolkit can do, one named boolean per additive capability.
 * Distinct from `PluginFeatures` (edition / env gates a plugin must mirror):
 * a capability is a code-level fact a plugin cannot infer from
 * `CONTRACT_VERSION`, which is an exact-match integer that only moves for a
 * breaking change. Always present on this side; the plugin side declares the
 * group OPTIONAL and reads absence as off, so a plugin built for a newer
 * host degrades cleanly on an older one:
 * `if (tk.capabilities?.mixAudioDuck === true) { ...pass duck... }`.
 * Grows one optional member at a time (additive-only, no CONTRACT_VERSION bump).
 */
export interface PluginCapabilities {
  /** `tk.media.mixAudio` honours `PluginMixAudioOptions.duck`; an older host ignores it silently. */
  readonly mixAudioDuck?: boolean
  /**
   * `tk.media.applyAudioFx` honours `format: "wav"` (lossless), a local
   * `inputPath` and a caller-chosen `outputPath` (see `PluginAudioFxOptions`);
   * an older host ignores them silently.
   */
  readonly audioFxLossless?: boolean
  /**
   * `PluginVideoGenOptions.draft` renders a Seedance 2.5 draft, and
   * `tk.providers.finalizeSeedanceDraft` / `tk.http.computeSeedanceDraftFinalizePricing`
   * exist; an older host ignores `draft` silently (a full-price non-draft render).
   */
  readonly seedanceDraft?: boolean
  /**
   * `tk.http.computeVoiceChangerProPricing` honours `respeakTranslated`: the
   * host applies the translated Re-speak allowance to the transcript count the
   * plugin sends (the one copy of it, shared with the whole-convert quote). An
   * older host ignores the argument silently, so a plugin must multiply the
   * characters itself unless this is true.
   */
  readonly voiceChangerProRespeakSlotArgs?: boolean
  /**
   * `tk.http.internalRequest` honours `PluginInternalRequestOptions.provenance`
   * and `.request` (the declared client origin and generation session of the
   * job the reached route creates). An older host ignores both silently: the
   * job carries no origin and no session.
   */
  readonly internalRequestProvenance?: boolean
  /**
   * `tk.settings.nodaroMotionMasking()` exists: the face masking an admin set
   * per Nodaro Motion engine, for every DIRECT Cast Swap run. An older host has
   * no `tk.settings` at all: a plugin reads that as never saved (no masking).
   */
  readonly nodaroMotionMasking?: boolean
  /**
   * `tk.http.quoteSeedanceRefVideo` exists: the charged hold and expected
   * settlement of a reference-video run from clip lengths the plugin has
   * measured, by the reservation's own rule. An older host has no such
   * member: a plugin derives the hold itself.
   */
  readonly seedanceRefVideoQuote?: boolean
  /**
   * `tk.settings.nodaroMotionPromptParts()` exists: the prompt part overrides
   * an admin set per Nodaro Motion engine and style, for every DIRECT Cast
   * Swap run. An older host has no such member: a plugin reads that as never
   * saved (the defaults).
   */
  readonly nodaroMotionPromptParts?: boolean
  /**
   * `tk.settings.nodaroMotionMotion()` exists: the setting an admin chose per
   * Nodaro Motion engine for DIRECT runs with `style: "motion"` (its masking,
   * which may be full depth, and its prompt style). An older host has no such
   * member: a plugin reads that as never saved (the Precise masking with the
   * Flexible prompt).
   */
  readonly nodaroMotionMotion?: boolean
}

/**
 * A Cast Swap `faceMasking` setting, as the host validates it
 * (`faceMaskingSchema` in `lib/cast-swap-face-masking.ts`; a structural
 * mirror, pinned to it by a type test). Keys left out take the engine's
 * defaults.
 */
export interface PluginFaceMasking {
  mode: "off" | "always" | "auto"
  /** A trend's clip preparation; a direct run's setting is always faces (absent or `"faces"`). */
  source?: "faces" | "full-depth" | "keep-people"
  /**
   * Full depth only: where the run's scene comes from — `"description"` (the
   * default: the engine describes the clip per run into the `scene` prompt
   * part), `"original"` (the original clip as a second video; clips up to
   * 27.9 s; a trend publishes with up to 27.5 s) or `"none"` (depth only). A trend run sends it resolved.
   */
  scene?: "description" | "original" | "none"
  target?: "face" | "head" | "body"
  fill?: "blur" | "depth"
  minFaceHeightPct?: number
  maxFaceHeightPct?: number
  zone?: { leftPct?: number; rightPct?: number; topPct?: number; bottomPct?: number } | null
  blurStrengthPct?: number
  threshold?: number
}

/**
 * Nodaro Motion's face masking per engine, keyed by the PUBLIC engine ids
 * (`"motion-prism"` = Seedance 2.5, `"motion-pulse"` = Kling 4). An engine
 * left out masks nothing.
 *
 * TRANSITION SHIM (the 2026-10-26 rename): every entry is answered under BOTH
 * its current key and its earlier one (`"motion-pro"` beside `"motion-prism"`,
 * `"motion-lite"` beside `"motion-pulse"`, the same value), because a plugin
 * up to 0.397.0 looks only for the earlier keys. Drop the earlier keys once
 * every environment pins a plugin that reads the new ones.
 */
export type PluginNodaroMotionMasking = Partial<
  Record<"motion-prism" | "motion-pulse" | "motion-pro" | "motion-lite", PluginFaceMasking>
>

/** A Cast Swap prompt part's id (`@nodaro/render-rules` `CAST_SWAP_PROMPT_PART_IDS`; a mirror, pinned by a type test). */
export type PluginPromptPartId =
  | "opener"
  | "artStyle"
  | "original"
  | "scene"
  | "quality"
  | "keep"
  | "audio"
  | "face"
  | "depthGuard"
  | "person"
  | "pet"
  | "product"
  | "location"
  | "avoid"
  | "postHeader"

/**
 * Nodaro Motion's prompt part overrides per engine and style, keyed by the
 * PUBLIC engine ids, each style's entry the override text per part
 * (1–2000 characters; `"-"` removes the part). An engine or style left out
 * uses the engine's defaults.
 *
 * TRANSITION SHIM (as `PluginNodaroMotionMasking`): every entry is answered
 * under BOTH its current key and its earlier one (`"motion-pro"` beside
 * `"motion-prism"`, `"motion-lite"` beside `"motion-pulse"`, the same value).
 */
export type NodaroMotionPromptParts = {
  readonly [publicEngineId: string]: {
    readonly precise?: Partial<Record<PluginPromptPartId, string>>
    readonly motion?: Partial<Record<PluginPromptPartId, string>>
  }
}

/**
 * A direct Motion run's setting for one Nodaro Motion engine: its masking (a
 * face mask, or full depth with its `scene`; never keep people) and its prompt
 * style. `masking` left out = the engine's Precise masking
 * (`nodaroMotionMasking`); `promptStyle` left out = `"flexible"`.
 */
export interface NodaroMotionMotionEntry {
  readonly masking?: PluginFaceMasking & { readonly source?: "faces" | "full-depth" }
  readonly promptStyle?: "precise" | "flexible"
}

/**
 * Nodaro Motion's Motion setting per engine, keyed by the PUBLIC engine ids.
 * An engine left out runs Motion on its Precise masking with the Flexible
 * prompt. TRANSITION SHIM (as `PluginNodaroMotionMasking`): every entry is
 * answered under BOTH its current key and its earlier one.
 */
export type NodaroMotionMotion = {
  readonly [publicEngineId: string]: NodaroMotionMotionEntry
}

/**
 * Deployment-wide settings a plugin feature reads (host → plugin), each a
 * short in-process cached read of an `app_settings` row (about 60 s, cleared
 * on this process's own admin write). Grows one optional member at a time.
 */
export interface PluginSettingsToolkit {
  /**
   * The admin's face masking per Nodaro Motion engine, for direct runs (a
   * trend run keeps its own trend's setting): each entry validated by the host
   * (an invalid one is dropped and logged), or null when it was never saved
   * (then no engine masks). Returns a copy the plugin may change freely.
   * REJECTS when the settings could not be read: a failed read is never
   * "never saved".
   */
  nodaroMotionMasking?(): Promise<PluginNodaroMotionMasking | null>
  /**
   * The admin's prompt part overrides per Nodaro Motion engine and style, for
   * direct runs (a trend run sends its own trend's): each engine's entry
   * validated by the host (an invalid one is dropped and logged), or null
   * when it was never saved (then every run uses the defaults). Returns a copy
   * the plugin may change freely. REJECTS when the settings could not be
   * read. Advertised as `capabilities.nodaroMotionPromptParts`.
   */
  nodaroMotionPromptParts?(): Promise<NodaroMotionPromptParts | null>
  /**
   * The admin's Motion setting per Nodaro Motion engine, for direct runs with
   * `style: "motion"`: each engine's entry validated by the host (an invalid
   * one is dropped and logged), or null when it was never saved. Returns a
   * copy the plugin may change freely. REJECTS when the settings could not
   * be read. Advertised as `capabilities.nodaroMotionMotion`.
   */
  nodaroMotionMotion?(): Promise<NodaroMotionMotion | null>
}

/**
 * What a plugin's OWN handlers can do, declared to the host — direction
 * plugin → host. The other capability group, `PluginCapabilities`
 * (`tk.capabilities`), points the opposite way (host → plugin: what this
 * host's toolkit can do). The host reads a member's ABSENCE as "the
 * behaviour every plugin had before the member existed", never as "all", so a
 * newer host on an older plugin degrades cleanly. Grows one optional member at
 * a time (additive-only, no CONTRACT_VERSION bump); merged by the loader with
 * `Object.assign`, last write wins per member.
 */
export interface PluginSupports {
  /**
   * The `edit-plan` modes the plugin's handler plans for BEYOND the three
   * Phase-1 modes (`tighten`, `clips`, `chapters`), which are always planned;
   * listing those too is harmless. Absent ⇒ only the Phase-1 three. An older handler coerces a
   * mode it does not know to `tighten`, while the workflow run already reserved
   * that mode's price — so the video worker refuses (and refunds) a job in a
   * mode not listed here before the handler runs
   * (`lib/private-plugins/edit-plan-mode-gate.ts`).
   */
  readonly editPlanModes?: readonly string[]
  /**
   * The plugin's `POST /v1/edit-plan` route reserves PER STARTED MINUTE
   * (`edit-plan:<mode>:<tier>:<N>m`, N = ceil(probed seconds / 60), priced
   * flat + rate × N from one rate row and one flat row per mode × tier), and
   * its handler's money gate accepts those ids (decided 2026-10-07). The host
   * switches its own reserve (workflow runs), estimates and listing from the
   * 15/30/60/90/120/180-minute steps only when this is `true`, so the same
   * node costs the same from the Run button and from Execute-All. Absent ⇒
   * steps (`lib/private-plugins/edit-plan-per-minute.ts`).
   */
  readonly editPlanPerMinute?: boolean
  /**
   * The plugin's `POST /v1/speaker-frames` accepts a RELAYED job from a
   * connected self-host (P3.6; P3-15 (a), P3-23 (b), decided 2026-10-06): the
   * detection proxies the self-host built (`proxies: [{ sourceId, url, fps,
   * height, spanMap, cuts, frame }]`) in place of the originals, and the
   * `relayed: true` marker, on which the handler skips mouth-motion
   * attribution with a note. nodaro.ai answers it on
   * `GET /v1/speaker-frames/capabilities`, and a connected self-host relays
   * Speaker Frames only when it is `true`; otherwise it refuses with "not
   * available on a connected install yet". Absent ⇒ false.
   */
  readonly speakerFramesRelayedProxies?: boolean
  /**
   * What the plugin's Cast Swap engine can run, for Trends (spec D17). Each
   * environment records its plugin's declaration at boot
   * (`ee/lib/engine-environments.ts`, table `engine_environments`), and
   * publishing a trend checks every environment's engine against what the
   * trend uses, because staging and production share one database but pin
   * their own plugin builds.
   *
   * - `roleKinds`: the role kinds a run may cast.
   * - `fixedReferences`: a run accepts fixed reference images (a trend's own).
   * - `fullQuality`: a completed draft run can be re-rendered at full quality.
   * - `resolutions`: the output resolutions a run accepts.
   * - `trendRun`: a run accepts a trend's hidden inputs (`trendRun`).
   * - `faceMasking`: a run accepts `faceMasking` (masks the faces in the
   *   source clip before the video model). Additive-optional: absent ⇒ an
   *   engine that predates face masking, read as `false`.
   * - `trendPrePrompt`: a trend run accepts a trend's own `prePrompt` (kept
   *   hidden). Additive-optional: absent ⇒ an engine that predates it, read
   *   as `false`.
   * - `engines`: the video engines a run accepts as `engine`. Additive-optional:
   *   absent ⇒ an engine that predates the choice, read as `["seedance-2-5"]`
   *   (such an engine drops an `engine` it does not know and runs Seedance,
   *   so a run on any other engine is held back until it is declared here).
   *   Any vocabulary: Nodaro Motion's public ids (`"motion-prism"`,
   *   `"motion-pulse"`), their earlier ids (`"motion-pro"`, `"motion-lite"`,
   *   what 0.394.0 – 0.397.0 declare, with the internal ids as their aliases)
   *   or the internal ones. The host reads every form as the internal ids
   *   (`castSwapEnginesOf`: two engines, however many ids are listed, so a
   *   list of the new ids alone names both) and keeps sending the internal
   *   ids, which every engine takes (0.393.0 and older refuse the public ones).
   * - `engineAliases`: the engine takes `engine` in either vocabulary (the
   *   public ids and the internal ones, normalised to the public ids at parse
   *   time) and records the public id. Additive-optional: absent ⇒ an engine
   *   that takes the internal ids only.
   * - `storedFaceMask`: the engine makes a trend's face mask ahead of time
   *   (`POST /v1/cast-swap/face-mask`, internal only) and a trend run accepts
   *   the approved one (`storedFaceMask: { url, frames }`) in place of masking
   *   per run. Additive-optional: absent ⇒ `false` (the platform then never
   *   sends `storedFaceMask`, and publishing a masked trend is held back).
   * - `faceMaskRecipe`: the version of the engine's own masking parameters
   *   (`maskClip`); a stored face mask made under another is out of date.
   *   Additive-optional: read only with `storedFaceMask`.
   * - `faceMaskTargets`: what a run's (and a stored face mask's)
   *   `faceMasking.target` may name: `"head"` (the whole head, hair and people
   *   seen from behind included), `"face"` (the face only) and/or `"body"`
   *   (the whole person — a keep-people trend clip only).
   *   Additive-optional: absent ⇒ `["head"]`, what every 0.392.0 engine does
   *   (it strips a `target` it does not know), so a trend that masks `"face"`
   *   is held back from publishing and running there (`faceMaskTargetsOf`).
   * - `faceMaskErase`: a stored face mask's make (`POST /v1/cast-swap/face-mask`)
   *   takes `faceMasking.marks` (its `"erased"` marks' faces left out of the
   *   mask, through the core `mask-erase` job) and `fromMask` (an earlier raw
   *   mask, so the faces are not found again), and its result carries the raw
   *   mask (`maskUrl`, `depthUrl`) and `stats.erasedRegions`.
   *   Additive-optional: absent ⇒ `false` (a make with marks is held back, and
   *   `fromMask` is never sent).
   * - `storedFaceMaskRequired`: a trend run's `storedFaceMask` takes
   *   `required: true`, and with it the engine fails the run rather than
   *   masking per run (a trend with marks). Additive-optional: absent ⇒ an
   *   engine that strips `required`, so a trend with marks is not run there.
   * - `sourceModes`: the clip preparations a trend's `faceMasking.source` may
   *   name — `"faces"` (the face mask), `"full-depth"` and `"keep-people"`.
   *   Additive-optional: absent ⇒ faces only, so a depth-mode trend is held
   *   back from publishing and running there (a trend that masks faces never
   *   needs it).
   * - `faceMaskMarkLabels`: the mark labels a stored clip's make takes —
   *   `"erased"`, and `"main"` (keep people's main character).
   *   Additive-optional: absent ⇒ `["erased"]`.
   * - `promptParts`: the engine answers the internal-only
   *   `POST /v1/cast-swap/prompt-parts` (each prompt part's default, the
   *   assembled prompt and the problems of a set of overrides), and a trend
   *   run takes `promptParts` (an admin's override text per part).
   *   Additive-optional: absent ⇒ `false` (the prompt editors say the engine
   *   is out of date, a trend with overrides is held back from publishing, and
   *   a run is sent without them).
   * - `styles`: what a direct run's `style` may name (`"precise"`, `"motion"`).
   *   Additive-optional: absent ⇒ precise only.
   * - `generateVideoChildren`: the engine's video steps run on
   *   `/v1/generate-video`. Additive-optional, informational.
   * - `promptStyles`: what a trend run's `promptStyle` may name
   *   (`"precise"`, `"flexible"`), and the prompt-parts route takes
   *   `promptStyle` too. Additive-optional: absent ⇒ an engine that picks the
   *   prompt from the clip preparation (faces and keep people Precise, full
   *   depth Flexible), so a trend that names another style is held back from
   *   publishing and is sent without the key.
   * - `fullDepthScenes`: what a full-depth `faceMasking.scene` may name
   *   (`"description"`, `"original"`, `"none"`), and the prompt-parts route
   *   takes `scene` too. Additive-optional: absent ⇒ `["original"]` (an engine
   *   that always sends the original as the second video), so a full-depth
   *   trend whose scene is another one is held back from publishing and is
   *   sent without the key.
   * - `preparedPreview`: a trend run takes `preparedPreview: true` — its
   *   `videoUrl` IS the preview's input clip, cut ahead of time by the host
   *   (the 4 s window plus up to 1 s of real footage), so the engine edits it
   *   as it is: `preview` must be true and `previewStart` 0 (else
   *   `400 prepared_preview_mismatch`), a clip slightly short of 4 s is
   *   admitted, and a `storedFaceMask` sent with it is already the preview's
   *   cut (its frames equal the clip's). The run also takes `sourceAsset`
   *   (`{ kind: "preview" | "full", sha256?, startSec?, durationSec?,
   *   recipe? }`, provenance only), stamped VISIBLY on the job as
   *   `input_data.sourceAsset` (copied to `output_data.sourceAsset` at
   *   completion) beside `input_data.preparedPreview`. Additive-optional:
   *   absent ⇒ `false` — the host strips both fields and sends the whole
   *   source clip with `previewStart` as before, so the wire is byte-identical
   *   (`withPreparedPreview`, ee/lib/trends/run-helpers.ts).
   * - `storedSceneDescription`: a full-depth make (`POST /v1/cast-swap/face-mask`)
   *   takes `roles` (`[{ name, kind }]`, the trend's role names) and
   *   `previewStart`, and its completion carries `sceneDescription` (the whole
   *   original clip, people named by role) and `previewSceneDescription` (the
   *   4 s preview window); a trend run takes `sceneDescription` (the stored
   *   text, platform-only) with `sceneDescriptionWindow` (`{ fromSec, toSec }`
   *   of the source it covers) and rewrites it for the new cast and the run's
   *   window instead of describing the clip again. Additive-optional: absent ⇒
   *   `false` — the make is sent neither key and a run neither field, so the
   *   wire is byte-identical (ee/lib/trends/scene-description.ts).
   * - `pulseAudio`: a Pulse run (`engine: "kling-4"`) takes
   *   `pulseAudio: "generated"` — Kling's own output audio delivered as is, in
   *   place of the original audio put back on the result. The host sends it
   *   only for that value (a body without it is the original audio): a
   *   trend's choice (`TrendVersionData.pulseAudio`) and, for every direct
   *   run, the admin's `nodaro_motion_pulse_audio` setting (any caller-sent
   *   value is dropped). Additive-optional: absent ⇒ `false` — the key is
   *   never sent, so the wire is byte-identical (lib/cast-swap-pulse-audio.ts).
   * - `prismReferenceAudio`: a Prism run (`engine: "seedance-2-5"`, or none)
   *   takes `prismReferenceAudio: "voice" | "none"` — what audio the
   *   reference video sent to the video model carries: only the voice split
   *   from the music, or none, in place of the clip's full audio. The original
   *   audio goes back on the result either way. The engine quotes `"voice"`
   *   with the audio split in it. The host sends it only for those values (a
   *   body without it is the full audio): a trend's choice
   *   (`TrendVersionData.prismReferenceAudio`) and, for every direct run, the
   *   admin's `nodaro_motion_prism_reference_audio` setting (any caller-sent
   *   value is dropped). Additive-optional: absent ⇒ `false` — the key is
   *   never sent, so the wire is byte-identical
   *   (lib/cast-swap-prism-reference-audio.ts). An engine declaring only this
   *   flag is sent the mode of the run's own resolution (a draft is 480p).
   * - `prismReferenceAudioPerResolution`: a Prism run takes
   *   `prismReferenceAudio` as one mode PER OUTPUT RESOLUTION,
   *   `{ "480p"?, "720p"?, "1080p"? }` of `"voice" | "none"`, a missing key
   *   being the full audio — so a Full Quality render of a draft knows its own
   *   resolution's mode. The host sends only the non-`"full"` keys, and no key
   *   at all when every resolution is the full audio. Wins over
   *   `prismReferenceAudio` when both are declared. Additive-optional: absent
   *   ⇒ `false` — the string of `prismReferenceAudio` above (or nothing).
   *
   * Absent ⇒ an engine that predates Trends: publishing treats that
   * environment as supporting no trend at all.
   */
  readonly castSwap?: {
    readonly roleKinds: readonly ("person" | "location" | "product" | "pet")[]
    readonly fixedReferences: boolean
    readonly fullQuality: boolean
    readonly resolutions: readonly ("480p" | "720p" | "1080p")[]
    readonly trendRun: boolean
    readonly faceMasking?: boolean
    readonly trendPrePrompt?: boolean
    readonly engines?: readonly ("motion-prism" | "motion-pulse" | "motion-pro" | "motion-lite" | "seedance-2-5" | "kling-4")[]
    readonly engineAliases?: boolean
    readonly storedFaceMask?: boolean
    readonly faceMaskRecipe?: string
    readonly faceMaskTargets?: readonly ("face" | "head" | "body")[]
    readonly faceMaskErase?: boolean
    readonly storedFaceMaskRequired?: boolean
    readonly sourceModes?: readonly ("faces" | "full-depth" | "keep-people")[]
    readonly faceMaskMarkLabels?: readonly ("erased" | "main")[]
    readonly promptParts?: boolean
    readonly styles?: readonly ("precise" | "motion")[]
    readonly generateVideoChildren?: boolean
    readonly promptStyles?: readonly ("precise" | "flexible")[]
    readonly fullDepthScenes?: readonly ("description" | "original" | "none")[]
    readonly preparedPreview?: boolean
    readonly storedSceneDescription?: boolean
    readonly pulseAudio?: boolean
    readonly prismReferenceAudio?: boolean
    readonly prismReferenceAudioPerResolution?: boolean
  }
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
  /**
   * Single-holder leases (`SET NX PX` + compare-and-extend/delete) — the one
   * shape `kv` cannot express atomically. ADDITIVE-OPTIONAL (no
   * CONTRACT_VERSION bump) — `?.`-guard it.
   */
  lease?: PluginRedisLeaseToolkit
}

/**
 * Platform-role questions. Org and workspace roles are the plugin's own
 * concern (it owns those tables); this is only about the PLATFORM staff role
 * on `profiles`, which core owns and caches.
 */
export interface PluginAuthToolkit {
  /** Canonical workflow permission, including organization revocation. */
  workflowAccess?(userId: string, workflowId: string): Promise<"none" | "view" | "edit" | "own">
  /** `profiles.role` ∈ (admin, super_admin). */
  isPlatformAdmin(userId: string): Promise<boolean>
  /** The raw role, so a plugin can require `super_admin` specifically. */
  platformRole(userId: string): Promise<string | null>
  /**
   * Mirrors `requireScope` (`lib/scopes.ts`) — the OAuth-token scope check,
   * as a ready-to-send refusal. Null means the scope is granted; otherwise
   * the route sends `reply.status(err.statusCode).send(err.body)` verbatim.
   *
   * A first-party session JWT carries no `appAuthorization` and is not
   * scope-checked at all, which is why this takes the granted list as an
   * argument rather than reading the request: the CALLER decides whether the
   * question applies, exactly as the app's own routes do.
   *
   * `required` is `string` here rather than the app's `Scope` union: the
   * union is core's to grow, and a structural mirror that pinned it would
   * make every new scope a contract change. The wiring site casts.
   *
   * ADDITIVE-OPTIONAL (no CONTRACT_VERSION bump) — `?.`-guard it.
   */
  requireScope?(granted: readonly string[], required: string): PluginScopeError | null
  /**
   * Mirrors `supabase.auth.admin.getUserById` — the account's GoTrue record
   * as the service role reads it, result shape included, so a port of an app
   * module that read it keeps its own error handling.
   *
   * ADDITIVE-OPTIONAL (no CONTRACT_VERSION bump) — `?.`-guard it.
   */
  getUserById?(userId: string): Promise<{ data: { user: PluginAuthUser | null } | null; error: { message: string } | null }>
}

/** The slice of a GoTrue user record the contract names; the real one carries more. */
export interface PluginAuthUser {
  id: string
  email?: string
  /** Written only by the service role (`provider`, `providers`, …) — the trustworthy identity facts. */
  app_metadata: Record<string, unknown>
  /** The linked identities, as GoTrue files them; a plugin narrows what it reads. */
  identities?: unknown
}

/**
 * A refusal of a plugin route's request, shaped to be sent:
 * `reply.status(err.statusCode).send(err.body)`. The body is exactly what
 * `sendInternalError` (`lib/http-errors.ts`) answers for the original error,
 * which rides along as `cause`. A plugin cannot import this class across the
 * boundary: it identifies it by `.name === "PluginHttpError"`.
 */
export class PluginHttpError extends Error {
  override readonly name = "PluginHttpError"
  constructor(
    readonly statusCode: 400 | 404 | 422,
    readonly body: { error: { code: string; message: string } & Record<string, unknown> },
    cause: unknown,
  ) {
    super(body.error.message, { cause })
  }
}

/** Mirrors `ScopeError` (`lib/scopes.ts`) — a refusal shaped to be sent. */
export interface PluginScopeError {
  statusCode: 403
  body: { error: { code: string; message: string; missingScope: string } }
}

// ============================================================================
// tk.workflows — backend/src/lib/workflow-route-access.ts + workflow-access.ts
// ============================================================================

/**
 * Mirrors `LoadedWorkflow` (`lib/workflow-route-access.ts`). `{ ok: false }`
 * means the reply has ALREADY been sent, so a route reads
 * `if (!loaded.ok) return`.
 */
export type PluginLoadedWorkflow =
  | { ok: true; row: Record<string, unknown>; access: WorkflowAccessLevel }
  | { ok: false }

/**
 * Reaching a workflow BY ID, and deciding what this caller may do with it.
 *
 * A plugin that serves routes over workflows must not re-implement any of
 * this: inside a workspace the person entitled to open a workflow is very
 * often not the person who created it, and a query filtered by creator
 * decides that question before asking it. One rule, one place.
 */
export interface PluginWorkflowsToolkit {
  /** Host guards editable-copy permission on every generic audience write. */
  supportsEditableCopySharing?: boolean
  /** Copy-only access: shared + owner opt-in may admit a viewer without
   * granting ordinary workflow access. The returned row is one saved snapshot. */
  loadStudioEditableCopySource?: PluginWorkflowsToolkit["loadWorkflowFor"]
  /** Server-only compatible document transport. The caller MUST authorize the
   * target and validate with its codec. An empty update result means a lost CAS.
   * Additive-optional; older hosts must refuse dependency edits. */
  writeCompatible?(input:
    | { kind: "create"; row: Record<string, unknown> }
    | { kind: "update"; workflowId: string; expectedVersion: number; patch: Record<string, unknown> }
  ): Promise<{ data: Record<string, unknown> | null; error: unknown }>
  /**
   * Mirrors `WORKFLOW_ACCESS_COLS` — the columns a row must carry to be
   * judgeable. A projection one column short is REFUSED (loudly) rather than
   * read leniently, so a plugin appends its own columns to this string
   * instead of writing its own list.
   *
   * Additive-optional with its group (no CONTRACT_VERSION bump).
   */
  accessCols: string
  /**
   * Mirrors `loadWorkflowFor` (`lib/workflow-route-access.ts`), signature for
   * signature. Answers 404 for a caller who may not reach the workflow at all
   * (a 403 there would confirm to a stranger that the id is real) and 403 once
   * they can already see it but need more than they have.
   *
   * Additive-optional with its group (no CONTRACT_VERSION bump).
   *
   * The row comes back AS STORED: saved result ids (placeholder `exec-…` job
   * ids, unlabelled Apply EDL takes) are resolved only when the plugin asks,
   * with `opts.resolveResultIds: true` and `settings` among `cols` — a plugin
   * that hands a canvas's nodes to a client asks; one that only judges or
   * rewrites the row does not pay the jobs lookup. `opts` is additive-optional:
   * an older host ignores it.
   */
  loadWorkflowFor(
    req: FastifyRequest,
    reply: FastifyReply,
    userId: string,
    workflowId: string,
    min: Exclude<WorkflowAccessLevel, "none">,
    cols: string,
    failureMessage: string,
    opts?: { readonly resolveResultIds?: boolean },
  ): Promise<PluginLoadedWorkflow>
  /**
   * Mirrors `canChangeWorkflowVisibility` (`lib/workflow-access.ts`) — may
   * this user change WHO CAN REACH the work? Wider than `edit`: a
   * collaborator saves all day and still may not publish.
   *
   * Additive-optional with its group (no CONTRACT_VERSION bump).
   */
  canChangeVisibility(userId: string, workflowId: string): Promise<boolean>
  /**
   * Mirrors `changesStudioPublishFlag` (`lib/studio-audience.ts`) — would this
   * settings write move either audience lever the free-form column carries?
   * A full-body write that OMITS them erases them, and erasing is a change,
   * so this compares effective state rather than looking for the keys.
   *
   * Additive-optional with its group (no CONTRACT_VERSION bump).
   */
  changesStudioPublishFlag(next: unknown, stored: unknown): boolean
}

// ============================================================================
// tk.entities — backend/src/lib/mcp/tools/_entity-scope.ts
// ============================================================================

/** The four saved-entity tables, named as the tables they are. */
export type PluginEntityTable = "characters" | "locations" | "objects" | "creatures"

/**
 * How much of a library to read, and in what order. REQUIRED, never
 * optional-with-a-default: `listOwned` hands back a resolved array rather
 * than a query, so a caller that forgot to bound the read cannot re-bound it,
 * and an unbounded library read is not something to make writable by omission.
 */
export interface PluginEntityRead {
  orderBy: string
  ascending: boolean
  limit: number
}

export interface PluginEntitiesToolkit {
  /**
   * The caller's own characters / locations / objects / creatures.
   *
   * Every read goes through the app's ONE ownership predicate
   * (`entityOwnerFilter`), applied to the QUERY rather than checked after the
   * fetch, so a row that is not the caller's comes back as zero rows and "not
   * yours" and "does not exist" stay the same answer. Throws on a read error
   * rather than reporting an empty library.
   *
   * ADDITIVE-OPTIONAL as a group (no CONTRACT_VERSION bump).
   */
  listOwned(
    userId: string,
    kind: PluginEntityTable,
    columns: string,
    read: PluginEntityRead,
  ): Promise<Array<Record<string, unknown>>>
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
/**
 * The entitlements a WORKSPACE payer works under (E2/P14, decision A3): one
 * hard-coded grade — today's business-tier values, watermark off, no personal
 * daily cap. No per-org grades in v1; `organizations` deliberately has no
 * tier column. The literal-typed members make misuse unrepresentable: a
 * workspace context that watermarks or daily-caps cannot even be constructed.
 */
export interface PluginOrgEntitlements {
  watermark: false
  dailyCapCredits: null
  /** TIER_PARALLELISM.business at resolve time (the resolver reads the table). */
  parallelism: number
  /** What tierRestriction / resolution / upload gates compare against. */
  tierForGates: "business"
  freeTierBlocklist: false
  webFreeMode: false
  appCreditsAllowance: false
}

/**
 * One resolved answer per job to "who pays, under which entitlements".
 * Resolved ONCE per lane (per HTTP request; per execution at enqueue),
 * carried explicitly — on `req`, or verbatim on a queue payload (the shape
 * is JSON-safe by construction) — and never re-derived downstream.
 *
 * ABSENT means PERSONAL: a queue payload without the field reads as
 * `{ payer: "user", userId: <payload userId> }`, unconditionally and
 * permanently — old-enqueuer/new-worker and rollback windows depend on it.
 */
export type PluginBillingContext =
  | {
      payer: "user"
      userId: string
      /**
       * Present ONLY on the fallback answer core substitutes when the
       * resolver failed or returned a malformed value — never on a resolved
       * personal context. A spend site may refuse a degraded context where
       * silently charging the member for work they explicitly asked a
       * workspace to pay for would be worse than failing the request.
       */
      degraded?: true
    }
  | {
      payer: "workspace"
      /** The human doing the work — jobs.user_id stays this. */
      userId: string
      workspaceId: string
      orgId: string
      entitlements: PluginOrgEntitlements
      /** Display data only — enforcement is the RPC, atomically. */
      memberCap: number | null
    }

/** What the resolver is told about one request/run. */
export interface PluginBillingResolveInput {
  userId: string
  /** The hook-validated `req.workspaceId`, when the request carried one. */
  explicitWorkspaceId?: string
  /**
   * Client-supplied pre-Zod (`extractWorkflowId`) — UNTRUSTED. The resolver
   * may let the workflow's home workspace pay only through the run predicate
   * (`canRunWorkflow`'s twin), never the read rule.
   */
  workflowId?: string
  isAppRun?: boolean
  /**
   * Internal-secret lane (orchestrator loopback, MCP dispatch). Rung 1 is
   * SKIPPED: the forwarded workspace header IS the parent's resolved answer,
   * and its absence means personal — the parent already decided.
   */
  internal?: boolean
}

/**
 * Payer/entitlement resolution (E2/P14) — the org-billing plugin's seam.
 * Direction: plugin → host (a capability core seams call). The OTHER
 * `billing` in this file — `PluginToolkit.billing` — points the opposite
 * way (host → plugin: Stripe operations for the org billing routes, P13).
 */
export interface PluginBillingService {
  resolve(input: PluginBillingResolveInput): Promise<PluginBillingContext>
  /**
   * P14/W8 — the payer-aware estimate's budget preview: the workspace's
   * remaining headroom for this member, plus a display label. ONE formula,
   * shared with the budget route (the plugin extracts its route-local math
   * into this member). Additive-optional: an older plugin degrades the
   * preview to "workspace pays — no preview" (headroom null), never an
   * error.
   */
  headroom?(workspaceId: string, userId: string): Promise<{ headroomCredits: number; workspaceLabel?: string } | null>
}

/** What a UGC video's planned length and inputs ask the plugin to plan (spec §5.4). */
export interface PluginUgcEstimateInput {
  readonly targetDurationSec: number
  readonly screenshotCount: number
  readonly source: "sampled" | "photo"
  /**
   * ADDITIVE-OPTIONAL — the video's language ("en" | "he"). Absent = English. A language whose clips are
   * cut from one recorded speech answers lane tickets and `lane`.
   */
  readonly language?: string
}

/**
 * A speech-first video's estimate, shaped as the canvas runs it: the three prelude calls (speech, word
 * timings, split) and the finish call, each run once, and `ceilingTickets` — the most clips the rules
 * plan for — beside the estimate's own `tickets`. The host prices the tickets as any canvas clip.
 */
export interface PluginUgcLaneEstimate {
  readonly prelude: ReadonlyArray<{ tool: string; args: Record<string, unknown> }>
  readonly finish: { tool: string; args: Record<string, unknown> }
  readonly ceilingTickets: unknown[]
  /**
   * ADDITIVE-OPTIONAL — the worst case's clips: one ticket list per worst split a take can legally get
   * (every legal split is covered by one: no more clips, none longer). The host prices each and holds the
   * dearest. Absent (an older plugin): the worst case reads `ceilingTickets`.
   */
  readonly worstTicketSets?: unknown[][]
  readonly estimateClipCount: number
  readonly clipCount: number
}

/**
 * The calls a UGC video will make, as the plugin plans them: `tickets` are the
 * builder's per-clip tickets (opaque to the host), `creatorImage` the creator's
 * image call (null for a photo creator) and `creatorChecks` the additive slot
 * for the gender reading on a sampled creator and the photo reading on `photo`.
 */
export interface PluginUgcEstimate {
  readonly tickets: unknown[]
  /** The primary's image call: what a run with no person to ask renders. */
  readonly creatorImage: { tool: string; args: Record<string, unknown> } | null
  readonly creatorChecks?: ReadonlyArray<{ tool: string; args: Record<string, unknown> }>
  /**
   * ADDITIVE-OPTIONAL — every image candidate's call for a sampled creator, the
   * primary (`creatorImage`) first. A run that can ask a person renders each one
   * and runs `creatorChecks` on each, and the person picks; a run that cannot
   * renders `creatorImage` alone. Absent on an older plugin and for a photo:
   * the primary alone, whatever the run.
   */
  readonly creatorCandidates?: ReadonlyArray<{ tool: string; args: Record<string, unknown> }>
  /** ADDITIVE-OPTIONAL — a speech-first video's prelude, finish and ceiling tickets. */
  readonly lane?: PluginUgcLaneEstimate
}

/**
 * The plan schema's line limits, in characters: the most the opening line (`hook`), a beat's line
 * and the closing line may hold.
 */
export interface PluginUgcPlanLineLimits {
  readonly hook: number
  readonly beatLine: number
  readonly closerLine: number
}

/** UGC planning, provided by the plugin (the host prices what it returns with `http.priceUgcCalls`). */
export interface PluginUgcService {
  estimate(input: PluginUgcEstimateInput): PluginUgcEstimate
  /**
   * ADDITIVE-OPTIONAL (no CONTRACT_VERSION bump) — `?.`-guard it. The plan schema's line limits,
   * read from the plugin's own schema: the host hands them to the editor on the UGC estimate's
   * answer (`/v1/ugc/quote`), so the script editor refuses an over-long line by name, and the app
   * holds no copy of them. Absent on an older plugin: the editor sets no limit, and UGC Clips
   * refuses an over-long line as before.
   */
  planLineLimits?(): PluginUgcPlanLineLimits
  /**
   * ADDITIVE-OPTIONAL (no CONTRACT_VERSION bump) — `?.`-guard it. The multiple of a clip's expected
   * price a run holds while its clips render (the plugin's re-render factor). The host reads it for
   * every UGC quote and estimate answer, so the hold it states and checks a balance against is the
   * plugin's own and the app holds no copy of it. Absent on an older plugin, or not a finite number
   * of at least 1: the host holds twice the price.
   */
  clipHoldFactor?(): number
  /**
   * ADDITIVE-OPTIONAL (no CONTRACT_VERSION bump) — `?.`-guard it. How UGC Clip charges its per-take
   * reading (the frame check): `"metered"` — through a metered SIDE hold (`tk.llmBilling.side`),
   * charged its actual, and NOT in the clip's managed reservation; `"fixed"` — today's fixed reading
   * price inside the clip's reservation. The ONE switch both sides read: the host's quote and estimate
   * price the reading as the plugin will charge it, and the plugin's admission decides with the same
   * answer (metered only while `tk.llmBilling.side.available()` too). Absent (an older plugin), or any
   * other answer: `"fixed"`, exactly as today.
   */
  clipReadingMode?(): "metered" | "fixed"
  /**
   * ADDITIVE-OPTIONAL — `?.`-guard it. The model a metered reading runs (the plugin pins it, e.g.
   * `claude-sonnet-5.5`); the quote prices `image-to-text:<model>` on the lane the reading runs
   * (`requireLane: "direct"`, R56). Absent: the host's default image-to-text model.
   */
  clipReadingModel?(): string
  /**
   * ADDITIVE-OPTIONAL (no CONTRACT_VERSION bump) — `?.`-guard it. The content key the plugin's
   * `/v1/ugc/clip` admits this ticket under, at this Re-render count (`nonce`) and run key (none for an
   * editor run): the key a UGC Clip job's `idempotency_key` carries as `<key>:<attempt>`. The host's
   * quote reads it to check a clip claimed as reused (`ee/lib/ugc-clip-reuse-check.ts`) and holds no
   * copy of how it is made. Null when the ticket is not one the route can admit. Absent on an older
   * plugin (or with no plugin): the host checks no claim and prices every clip in full.
   */
  clipContentKey?(ticket: unknown, nonce: number, runKey?: string): string | null
}

export interface PluginServices {
  /** Public read projection for extension documents. Called only after the
   * host's share-by-link authorization. Null means unsupported; never return
   * raw authoring state as a fallback. Pure: no jobs, storage or writes. */
  publicWorkflow?: {
    project(input: { id: string; name: string; nodes: unknown[]; edges: unknown[]; settings: Record<string, unknown> }):
      { nodes: unknown[]; edges: unknown[]; settings: Record<string, unknown> } | null
  }
  orgs?: PluginOrgsService
  /**
   * Payer/entitlement resolution (E2/P14). Optional-by-absence like every
   * member here: an older plugin build simply has no workspace payers.
   */
  billing?: PluginBillingService
  /**
   * ADDITIVE-OPTIONAL (no CONTRACT_VERSION bump) — `?.`-guard it.
   * UGC video planning (spec §5.4).
   */
  ugc?: PluginUgcService
  /** Model-policy enforcement — narrowed when the policy seam lands. */
  policy?: unknown
  /** Live-document writer — narrowed when the collaboration seam lands. */
  collab?: unknown
  /**
   * ADDITIVE-OPTIONAL (no CONTRACT_VERSION bump) — `?.`-guard it.
   * The free signup grant's decision (see `PluginSignupGateService`).
   */
  signupGate?: PluginSignupGateService
}

// ============================================================================
// Signup gate — the free signup grant's decision
// ============================================================================

/**
 * One claim, as `ee/billing/signup-grant.ts` already shaped it: every key is
 * a digest the browser or the app computed, nothing raw. The app records the
 * claim's row before it asks, so every count the gate makes excludes
 * `userId` and reads what this claim left behind.
 */
export interface PluginSignupGateInput {
  userId: string
  browserKey: string | null
  deviceKey: string | null
  ipHash: string
  /** Hash of the claim's network neighbourhood; null for an unknown address. */
  netKeyHash?: string | null
  /** The claim came from a published hosting range. */
  hosting?: boolean
  /** Hash of the browser's server-signed cookie id; null when the claim carried none. */
  cookieKey?: string | null
}

/** What the gate answers. The app stores and displays `reasons` as opaque strings. */
export interface PluginSignupGateDecision {
  decision: "granted" | "withheld"
  reasons: string[]
}

/** The slice of a request logger the gate writes to (a Fastify logger satisfies it). */
export interface PluginSignupGateLog {
  info(obj: Record<string, unknown>, msg: string): void
  warn(obj: Record<string, unknown>, msg: string): void
}

/**
 * The free signup grant's decision — the rules, their thresholds and the
 * reads behind them. The app keeps the claim itself (the signal row, the
 * state transition, the ledger line, the admin surfaces) and asks here only
 * whether to grant. Every member fails open on a read it could not make;
 * nothing here writes credits.
 */
export interface PluginSignupGateService {
  /** The decision for one claim. */
  evaluate(input: PluginSignupGateInput, log: PluginSignupGateLog): Promise<PluginSignupGateDecision>
  /**
   * Whether a withhold with these reasons is evidence against EARLIER
   * accounts on the same links, and how far back the app looks for them.
   * Null: it is not.
   */
  siblingTakeback(reasons: readonly string[]): { windowMs: number } | null
  /** Withheld only for want of keys — a later keyed claim from the account decides afresh. */
  withheldForKeylessOnly(reasons: readonly string[] | null | undefined): boolean
  /** A settled purchase on record for the account. A failed read is false. */
  hasPurchase(userId: string, log: PluginSignupGateLog): Promise<boolean>
  /** The admin changed a gate setting: forget any cached configuration. */
  invalidateConfig(): void
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
  scene3d?: PluginScene3DEngine
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

/**
 * Additive. One content recipe a plugin serves through `get_recipe` — the
 * same shape a local `backend/skills/recipes/<name>/` folder carries, as
 * DATA: `body` is the recipe's instructions (frontmatter already stripped),
 * `files` maps a bundled reference name to its text. A `library` recipe is
 * loadable by name but never listed (it is shared material other recipes
 * point at, not an entry point). `files` is a plain map — lookups are exact
 * key matches, never paths resolved against anything.
 */
export interface PluginRecipe {
  readonly description: string
  readonly triggers: readonly string[]
  readonly library?: boolean
  readonly body: string
  readonly files: Readonly<Record<string, string>>
}
export type RecipeTable = Record<string, PluginRecipe>

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
  /**
   * Additive: content recipes served by the `get_recipe` MCP tool beside the
   * local catalog (see `PluginRecipe`). Merged by the loader with
   * `Object.assign`, last write wins per recipe name; a local recipe of the
   * same name always wins over a plugin one.
   */
  recipes?(): RecipeTable
  /**
   * Additive: long-lived processes, run only by the daemon host
   * (`plugin-daemons.ts`) — see `PluginDaemon`. The host passes its own
   * toolkit, the one whose `accountSecrets` can decrypt.
   */
  daemons?(tk: PluginToolkit): PluginDaemon[]
  /**
   * Additive: what this plugin's own handlers can do, as DATA (see
   * `PluginSupports` — plugin → host, the reverse of `tk.capabilities`).
   */
  supports?(): PluginSupports
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
