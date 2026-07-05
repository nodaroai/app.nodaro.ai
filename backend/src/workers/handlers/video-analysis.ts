/**
 * Worker handler for the `video-analysis` job (design: windowed multimodal LLM
 * analysis of a ≤10-minute video into a scene/slot timeline).
 *
 * HANDLER CONTRACT (verbatim from spec): this handler NEVER persists a
 * `provider_task_id` and NEVER adopts `provider_kind: "kie-llm"` — that kind's
 * 5-minute stale-sweep threshold would race a legitimate 300 s LLM window. The
 * worker's generic `"pre-task"` pickup sentinel (30-min threshold) PLUS a 60 s
 * heartbeat that re-stamps `provider_call_started_at` IS the stale-sweep
 * contract: while the handler lives the row never goes stale; if it dies the
 * sync-sweep marks failed + refunds.
 *
 * Shape: heartbeat → cancel-check → R2 checkpoint re-entry → (fresh) ingest +
 * tolerance money-gate + windowed segmentation → per-window LLM analysis with a
 * per-JOB transport-retry budget and ≤3 concurrency → merge → persist. Failure
 * is all-or-nothing: any window without a validated response after the budget
 * throws a PLAIN Error (never a PostProcessingError — no billed provider
 * delivery to protect); the worker owns the final-attempt refund (the handler
 * NEVER refunds directly). The tmp working set is torn down in `finally`.
 */
import type { Job } from "bullmq"
import { join } from "node:path"
import { windowAnalysisSchema, videoAnalysisResultSchema, aspectRatioFromDims, bucketSecondsFromCreditId, VIDEO_ANALYSIS_DURATION_TOLERANCE_SEC, VIDEO_ANALYSIS_MAX_DURATION_SEC, type WindowAnalysis } from "@nodaro/shared"
import { llmCompleteStructured, type StructuredLlmOutput } from "../../lib/llm-client.js"
import {
  buildVideoAnalysisSystemPrompt,
  buildVideoAnalysisUserText,
} from "../../lib/video-analysis-prompt.js"
import { markProviderCallStart } from "../../lib/reconcile/persistence.js"
import { throwIfJobCancelled } from "../../lib/job-cancellation.js"
import { sleep } from "../../lib/sleep.js"
import { settledOrThrow } from "../../lib/settled-or-throw.js"
import { YOUTUBE_HOSTS, hostnameMatchesAllowlist } from "../../lib/url-validator.js"
import {
  createWorkDir,
  cleanupWorkDir,
  downloadFile,
  probeVideoSource,
  needsTranscode,
  transcodeToBrowserSafe,
  needsContainerRemux,
  remuxToMp4,
} from "../../providers/video/ffmpeg-utils.js"
import { downloadYouTubeVideo } from "../../providers/video/youtube-video.js"
import {
  uploadFileWithKeyToR2,
  r2Url,
  getR2ObjectSize,
  downloadR2ObjectToFile,
} from "../../lib/storage.js"
import {
  vaTmpKeys,
  readVaState,
  writeVaState,
  deleteVaTmp,
  type VaState,
  type VaTmpKeys,
} from "./video-analysis-state.js"
import { mergeWindowResults } from "./video-analysis-merge.js"
import { segmentAndUploadWindows, recutWindowFromSource } from "./video-analysis-segment.js"
import type { HandlerFn } from "../shared.js"
import { markJobCompleted, commitJobCredits } from "../shared.js"

/** Per-window LLM timeout (rides the request; llmCompleteStructured re-uses it
 *  on each schema retry). 300 s — long enough for a 150 s multimodal window. */
const VA_LLM_TIMEOUT_MS = 300_000
/** Heartbeat cadence — well under the `pre-task` 30-min stale threshold. */
const VA_HEARTBEAT_MS = 60_000
/** Max windows analyzed concurrently (in-job semaphore). */
const VA_WINDOW_CONCURRENCY = 3
/** Per-JOB transport-retry budget (total extra attempts across ALL windows). */
const VA_TRANSPORT_BUDGET = 3
/** Backoff per transport retry (index by retries already spent). */
const VA_BACKOFFS_MS = [500, 2000, 8000]
/** Source-download ceiling → yt-dlp `--max-filesize 512M` (spec D2). The
 *  orchestrated / app-input path has NO pre-download duration probe (route
 *  preHandlers never run there), so this byte cap — not the duration gate — is
 *  the real pre-money-gate bound on a YouTube fetch. */
const VA_MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024

/** Enumerated worker payload (REST route + orchestrated payload-builder). Only
 *  `jobId`, `llmModel`, and `reservedCreditId` are guaranteed; treat every other
 *  field as optional (orchestrated runs omit workflowId + probedTitle). */
export interface VideoAnalysisJobPayload {
  jobId: string
  usageLogId?: string | null
  videoUrl?: string
  youtubeUrl?: string
  llmModel: string
  analysisFocus?: string
  reservedCreditId: string
  probedTitle?: string
  workflowId?: string
  nodeId?: string
}

/** Custom failure for the money gate — a PLAIN error, so the refund path fires. */
class VaDurationError extends Error {
  constructor(
    public readonly code: "video_too_long" | "duration_exceeded_reserved_bucket",
    message: string,
  ) {
    super(message)
    this.name = "VaDurationError"
  }
}

/** True once ALL planned windows carry a stored analysis result. */
function allResultsPresent(state: VaState): boolean {
  return state.windows.length > 0 && state.windows.every((w) => state.results[w.k] !== undefined)
}

/**
 * Tolerance-aware money gate (spec step 2). ffprobe floats run 0.05–2 s over the
 * route's integer-rounded metadata, so a ±TOL grace prevents rejecting legit
 * videos at exact bucket edges. A missing/unparseable reservedCreditId is
 * treated as the ceiling (no bucket throw — the MAX check still applies).
 */
function assertDurationWithinLimits(durationSec: number, reservedCreditId: string | undefined): void {
  const tol = VIDEO_ANALYSIS_DURATION_TOLERANCE_SEC
  if (durationSec > VIDEO_ANALYSIS_MAX_DURATION_SEC + tol) {
    throw new VaDurationError(
      "video_too_long",
      `Video is ${Math.ceil(durationSec)}s; the maximum analyzable duration is ${VIDEO_ANALYSIS_MAX_DURATION_SEC}s.`,
    )
  }
  const bucket = reservedCreditId ? bucketSecondsFromCreditId(reservedCreditId) : null
  if (bucket !== null && durationSec > bucket + tol) {
    throw new VaDurationError(
      "duration_exceeded_reserved_bucket",
      `Video is ${Math.ceil(durationSec)}s but only ${bucket}s of analysis were reserved.`,
    )
  }
}

/** Build the LLM-facing public URL for a window: a stored full URL (single-window
 *  clean-remote case) passes through; a bare tmp KEY resolves via the CDN base. */
function resolveWindowUrl(r2Key: string): string {
  return /^https?:\/\//i.test(r2Key) ? r2Key : r2Url(r2Key)
}

/** Derive a source extension from a URL path (defaults to mp4) so the container
 *  remux decision (extension-based) sees a real container hint. */
function extFromUrl(url: string): string {
  try {
    const m = /\.([a-z0-9]{2,5})$/i.exec(new URL(url).pathname)
    return m ? m[1]!.toLowerCase() : "mp4"
  } catch {
    return "mp4"
  }
}

/**
 * Transport-vs-terminal classifier. Retry ONLY transient upstream conditions
 * (HTTP 429/5xx, network/timeout). A schema-validation exhaustion from
 * llmCompleteStructured ("validation failed after N attempt(s)") is that layer's
 * OWN retry giving up — a terminal window failure, never transport-retried.
 */
function isTransportError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const msg = err.message
  if (/llm-structured: validation failed/i.test(msg)) return false
  if (/failed \((?:429|5\d\d)\)/.test(msg)) return true
  if (err.name === "AbortError" || err.name === "TimeoutError") return true
  return /\b(?:fetch failed|network|socket hang up|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|timed out|aborted)\b/i.test(
    msg,
  )
}

/**
 * The single ISOLATED provider call site. Gate 0 (transport verification) is
 * deferred to staging; if it fails, the transport is swapped HERE only.
 */
async function analyzeWindowViaKie(args: {
  clipUrl: string
  windowLenSec: number
  focus?: string
  llmModel: string
  system: string
}): Promise<StructuredLlmOutput<WindowAnalysis>> {
  // GATE 0: transport pending staging verification; swap point for direct-Google fallback. [720p downscale hook: insert at segmentation if Gate 0 size tests fail]
  return llmCompleteStructured(
    {
      modelId: args.llmModel,
      system: args.system,
      messages: [
        {
          role: "user",
          content: [
            { type: "video", url: args.clipUrl },
            { type: "text", text: buildVideoAnalysisUserText({ windowLenSec: args.windowLenSec, focus: args.focus }) },
          ],
        },
      ],
      timeoutMs: VA_LLM_TIMEOUT_MS,
    },
    windowAnalysisSchema,
    { maxRetries: 1 },
  )
}

/**
 * Download + normalize the source to a local browser-safe mp4, returning its
 * probe (dimensions + duration) and — when a direct remote video needed NO
 * normalization — its own clean URL (so a single-window analysis can skip the
 * re-upload). Ingest ordering (VP9-mkv trap): codec probe FIRST — transcode a
 * non-browser-safe stream (outputs mp4, skip remux); else remux a non-mp4
 * container. Never remux-then-transcode.
 */
async function ingestSourceToLocal(
  p: VideoAnalysisJobPayload,
  tmp: VaTmpKeys,
  workDir: string,
): Promise<{
  localPath: string
  cleanRemoteUrl?: string
  width: number
  height: number
  durationSeconds: number
}> {
  const fromYouTube = !p.videoUrl && !!p.youtubeUrl
  let rawPath: string
  if (p.videoUrl) {
    rawPath = join(workDir, `raw.${extFromUrl(p.videoUrl)}`)
    await downloadFile(p.videoUrl, rawPath)
  } else if (p.youtubeUrl) {
    // D2 SSRF gate: the worker is the ONLY choke point on the orchestrated /
    // app-input path (route preHandlers never run, and video can enter via the
    // uncapped client-writable `youtube-video` node upstream). RE-VALIDATE the
    // host against the NARROW YOUTUBE_HOSTS list (NOT the broad social allowlist)
    // BEFORE spawning yt-dlp, whose generic extractor would otherwise fetch an
    // arbitrary URL outside our ffprobe guards.
    let ytHost: string | undefined
    try {
      ytHost = new URL(p.youtubeUrl).hostname
    } catch {
      ytHost = undefined
    }
    if (!ytHost || !hostnameMatchesAllowlist(ytHost, YOUTUBE_HOSTS)) {
      throw new Error("youtube_host_not_allowed")
    }
    rawPath = join(workDir, "yt.mp4")
    await downloadYouTubeVideo({ url: p.youtubeUrl, outPath: rawPath, maxFilesizeBytes: VA_MAX_DOWNLOAD_BYTES })
  } else {
    throw new Error("video-analysis: no source — videoUrl and youtubeUrl are both absent")
  }

  const probe = await probeVideoSource(rawPath)

  let normalizedPath = rawPath
  let normalized = false
  if (await needsTranscode(rawPath)) {
    normalizedPath = await transcodeToBrowserSafe(rawPath, join(workDir, "normalized.mp4"))
    normalized = normalizedPath !== rawPath
  } else if (needsContainerRemux(rawPath)) {
    normalizedPath = join(workDir, "normalized.mp4")
    await remuxToMp4(rawPath, normalizedPath)
    normalized = true
  }

  // Checkpoint the normalized source ONLY for YouTube: a direct-video URL is
  // re-fetchable on re-entry; a YouTube download is not deterministically so.
  if (fromYouTube) {
    await uploadFileWithKeyToR2(normalizedPath, tmp.source, "video/mp4")
  }

  const cleanRemoteUrl = p.videoUrl && !normalized ? p.videoUrl : undefined
  return {
    localPath: normalizedPath,
    cleanRemoteUrl,
    width: probe.width,
    height: probe.height,
    durationSeconds: probe.durationSeconds,
  }
}

function logCheckpointFail(jobId: string, err: unknown): void {
  console.warn(
    `[worker] video-analysis ${jobId} checkpoint write failed (continuing):`,
    err instanceof Error ? err.message : err,
  )
}

export async function handleVideoAnalysis(job: Job): Promise<void> {
  const p = job.data as VideoAnalysisJobPayload
  const tmp = vaTmpKeys(p.jobId)

  // Heartbeat: re-stamp the `pre-task` sentinel every 60 s so the reconcile
  // sync-sweep never races a live 300 s window. Cleared in `finally`.
  const heartbeat = setInterval(() => {
    void markProviderCallStart(p.jobId, "pre-task")
  }, VA_HEARTBEAT_MS)

  let windowCount = 0
  let workDir: string | undefined
  let totalProviderCost = 0
  let transportBudget = VA_TRANSPORT_BUDGET

  // Lazily (re-)materialize the source for the re-entry self-heal path. Prefers
  // the YouTube checkpoint (tmp.source, byte-identical); falls back to re-fetch.
  let reentrySourcePath: string | undefined
  const ensureReentrySource = async (): Promise<string> => {
    if (reentrySourcePath) return reentrySourcePath
    if (!workDir) workDir = await createWorkDir("va-reentry")
    const dst = join(workDir, "reentry-source.mp4")
    try {
      await downloadR2ObjectToFile(tmp.source, dst)
      reentrySourcePath = dst
    } catch {
      const ing = await ingestSourceToLocal(p, tmp, workDir)
      reentrySourcePath = ing.localPath
    }
    return reentrySourcePath
  }

  // Retry a transport-flaky LLM call against the shared per-JOB budget. Cancel
  // is checked BEFORE every attempt (including retries).
  const withTransportRetry = async <T>(fn: () => Promise<T>): Promise<T> => {
    for (;;) {
      await throwIfJobCancelled()
      try {
        return await fn()
      } catch (err) {
        if (transportBudget <= 0 || !isTransportError(err)) throw err
        const idx = VA_TRANSPORT_BUDGET - transportBudget
        transportBudget -= 1
        const base = VA_BACKOFFS_MS[Math.min(idx, VA_BACKOFFS_MS.length - 1)]!
        await sleep(base + Math.floor(Math.random() * 250))
      }
    }
  }

  try {
    await throwIfJobCancelled()

    let state = await readVaState(p.jobId)

    if (!state) {
      // ---- FRESH: ingest → tolerance money-gate → segment → write plan ----
      workDir = await createWorkDir("va")
      const ingest = await ingestSourceToLocal(p, tmp, workDir)
      assertDurationWithinLimits(ingest.durationSeconds, p.reservedCreditId)
      await throwIfJobCancelled()
      const windows = await segmentAndUploadWindows({
        localSourcePath: ingest.localPath,
        durationSec: ingest.durationSeconds,
        tmp,
        workDir,
        cleanRemoteUrl: ingest.cleanRemoteUrl,
      })
      state = {
        meta: {
          durationSec: ingest.durationSeconds,
          width: ingest.width,
          height: ingest.height,
          title: p.probedTitle,
        },
        windows,
        results: {},
      }
      // Write the PLAN (meta + windows incl. r2Keys) BEFORE any LLM call so a
      // stall re-enters with the boundaries frozen. A failed checkpoint write
      // must not crash the analysis → .catch (log + continue).
      await writeVaState(p.jobId, state).catch((err) => logCheckpointFail(p.jobId, err))
    } else if (!allResultsPresent(state)) {
      // ---- PARTIAL RE-ENTRY: idempotent gate + heal any swept window clips ----
      assertDurationWithinLimits(state.meta.durationSec, p.reservedCreditId)
      for (const w of state.windows) {
        if (state.results[w.k] !== undefined) continue // completed — clip not needed
        if (/^https?:\/\//i.test(w.r2Key)) continue // clean-remote source URL — assume live
        const size = await getR2ObjectSize(w.r2Key)
        if (size > 0) continue // clip still present — reuse it
        const src = await ensureReentrySource()
        await recutWindowFromSource({
          localSourcePath: src,
          window: w,
          durationSec: state.meta.durationSec,
          workDir: workDir!,
        })
      }
    }
    // (full re-entry — all results present — falls straight through to merge.)

    windowCount = state.windows.length

    // ---- ANALYZE the missing windows (fresh: all; partial re-entry: the gaps) ----
    const missing = state.windows.filter((w) => state.results[w.k] === undefined)
    if (missing.length > 0) {
      const system = buildVideoAnalysisSystemPrompt()
      const tasks = missing.map((w) => async () => {
        const clipUrl = resolveWindowUrl(w.r2Key)
        const windowLenSec = Math.max(1, Math.round(w.endSec - w.startSec))
        const structured = await withTransportRetry(() =>
          analyzeWindowViaKie({
            clipUrl,
            windowLenSec,
            focus: p.analysisFocus,
            llmModel: p.llmModel,
            system,
          }),
        )
        totalProviderCost += structured.providerCost ?? 0
        // Accumulator mutation: concurrent windows fold results into the shared
        // map; writeVaState is internally serialized so the fuller snapshot
        // always lands last. Checkpoint failure never crashes analysis (.catch).
        state.results[w.k] = structured.output
        await writeVaState(p.jobId, state).catch((err) => logCheckpointFail(p.jobId, err))
      })
      // Bounded concurrency + fail-fast: the first window to exhaust its share of
      // the transport budget rejects the whole step (all-or-nothing).
      await settledOrThrow(tasks, VA_WINDOW_CONCURRENCY)
    }

    // ---- MERGE (actual boundaries) + PERSIST ----
    const merged = mergeWindowResults({
      durationSec: state.meta.durationSec,
      windows: state.windows,
      results: state.results,
    })
    // Surface merge diagnostics (spec: "log a warning" for unresolved slot-token
    // unwraps and other non-fatal merge conditions) — otherwise silently dropped.
    if (merged.warnings.length > 0) {
      console.warn(
        `[worker] video-analysis ${p.jobId} merge: ${merged.warnings.length} warning(s) — ${merged.warnings.join("; ")}`,
      )
    }
    const result = videoAnalysisResultSchema.parse({
      meta: {
        durationSec: state.meta.durationSec,
        width: state.meta.width,
        height: state.meta.height,
        aspectRatio: aspectRatioFromDims(state.meta.width, state.meta.height),
        title: p.probedTitle ?? state.meta.title,
        language: merged.language,
      },
      slots: merged.slots,
      scenes: merged.scenes,
    })

    const ok = await markJobCompleted(p.jobId, {
      output_data: { json: result },
      provider_cost: totalProviderCost || null,
    })
    if (!ok) return // cancelled/terminal mid-flight — the cancel route owns the refund

    // Non-metered commit: video-analysis is fixed/bucket-priced, so the RESERVED
    // tier is committed as-is. Any providerCostUsd would be DISCARDED on this
    // path, so the summed provider_cost is persisted via markJobCompleted above.
    await commitJobCredits(p.usageLogId, p.jobId)
  } catch (err) {
    // Failure contract: the handler NEVER refunds — it throws a PLAIN Error
    // (duration gate, transport exhaustion, schema exhaustion, cancellation) and
    // the worker owns mark-failed + refund TIMING. Refunding here would fire on
    // EVERY BullMQ attempt; on the orchestrated path (queue default attempts: 3) a
    // non-final-attempt refund CAS-flips the reservation reserved→refunded, then a
    // later SUCCEEDING attempt's commit_credits (requires status='reserved')
    // silently no-ops → the analysis is delivered FREE. See isFinalJobAttempt in
    // workers/shared.ts: the worker's catch (video-worker.ts) refunds only on the
    // final attempt; the cancel route covers cancellation.
    throw err
  } finally {
    clearInterval(heartbeat)
    await deleteVaTmp(p.jobId, windowCount).catch(() => {})
    if (workDir) await cleanupWorkDir(workDir).catch(() => {})
  }
}

export const videoAnalysisHandlers: Record<string, HandlerFn> = {
  "video-analysis": handleVideoAnalysis,
}
