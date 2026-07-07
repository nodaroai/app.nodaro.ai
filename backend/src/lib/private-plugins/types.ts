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
 * One deliberate departure from the plugin repo's copy: `PluginAudioFxOptions
 * .preset` is typed as the real `AudioFxPreset` (`@nodaro/shared`) here
 * instead of structural `string` — this app has `@nodaro/shared` natively,
 * so there's no reason to widen it. Still structurally compatible with the
 * plugin repo's `string` version at the call boundary (a narrower type is
 * always assignable to the wider one).
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify"
import type { ZodError, ZodType } from "zod"
import type { AudioFxPreset } from "@nodaro/shared"

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
 */
export interface PluginJob {
  readonly data: unknown
  updateProgress(progress: number): Promise<void>
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
}

// ============================================================================
// tk.jobs — backend/src/workers/shared.ts
// ============================================================================

export interface PluginJobsToolkit {
  /** Mirrors `markJobCompleted` (`workers/shared.ts`). */
  markJobCompleted(jobId: string, fields: Record<string, unknown>): Promise<boolean>
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

export interface PluginHttpToolkit {
  /** Mirrors `supabase` (`lib/supabase.ts`), shaped to VCP route usage. */
  supabase: PluginSupabaseClient
  /** Mirrors `videoQueue` (`lib/queue.ts`), narrowed to the one method used. */
  videoQueue: { add(name: string, data: Record<string, unknown>): Promise<unknown> }
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
}

// ============================================================================
// Plugin registration surface
// ============================================================================

export interface NodaroPrivatePlugin {
  name: string
  registerRoutes?(app: FastifyInstance, tk: PluginToolkit): Promise<void>
  handlers?(tk: PluginToolkit): Record<string, PluginHandlerFn>
  staticCreditCosts?(): Record<string, number>
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
