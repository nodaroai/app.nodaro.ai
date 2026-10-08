import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promises as fs } from "node:fs"
import { uploadFileWithKeyToR2, uploadBufferToR2 } from "./storage.js"
import { recordDownloadedVideoAsset } from "./asset-records.js"
import { thumbnailFromLocalVideo } from "../utils/thumbnail.js"
import { downloadYouTubeVideo, type VideoSection } from "../providers/video/youtube-video.js"
import type { DownloadSlot } from "./download-slots.js"
import { downloadSlots } from "./download-slots-instance.js"

/**
 * The server's ONE video downloader: a social link (or a direct file) becomes
 * a stored video the account owns. The `/v1/download-video` route starts it for
 * a person (the editor's Video URL node, the app runner's card, Recast, Studio)
 * and follows it over SSE; the orchestrator starts it for a run
 * (`downloadVideoForRun`, decided 2026-10-08) so MCP, SDK and API runs get the
 * very download the card does — same provider, same upload, same ownership row,
 * and the same per-account cap on running downloads, ONE count shared by the
 * API process, the orchestrator process and every replica (see
 * `MAX_ACTIVE_DOWNLOADS_PER_USER`).
 */

/** Size cap for DIRECT-file downloads — parity with /v1/upload's and
 *  save-to-storage's 500MB video limit (file-validation SIZE_LIMITS.video).
 *  Social fetches stay uncapped: their sources are duration-bounded flows whose
 *  behavior must not change. */
export const DIRECT_FILE_MAX_BYTES = 500 * 1024 * 1024

/**
 * Downloads one account may have RUNNING at once. Each one is a yt-dlp process,
 * usually an ffmpeg re-encode, and paid proxy bandwidth — and this route has no
 * credit guard in front of it. The editor now starts downloads by itself (on a
 * pasted link, and before a run for every link that feeds it), so the bound has
 * to live here, where workflow JSON written by someone else cannot argue with
 * it. Every download takes a SLOT first (`download-slots.ts`) and gives it back
 * when it ends; the slots are leases in a Redis ledger keyed by the account, so
 * the cap is ONE count across the API process (the route, the card), the
 * orchestrator process (a run's fetch) and every replica (decided 2026-10-08).
 * When Redis is unreachable the cap is counted per process, as it was before the
 * ledger. Generous for a person — Recast, Studio and the voice changer import one
 * video at a time — and the editor's pre-run pass stays under it on purpose.
 */
export const MAX_ACTIVE_DOWNLOADS_PER_USER = 4

export interface ActiveDownload {
  /** The owner — only ever read to count an account's running downloads. */
  userId: string
  percent: number
  phase: "downloading" | "processing" | "uploading" | "completed" | "failed"
  videoUrl?: string
  thumbnailUrl?: string
  error?: string
}

export const activeDownloads = new Map<string, ActiveDownload>()

/** How many of this process's downloads for the account are still running (terminal
 *  ones linger in the map for the progress stream's sake and do not count). The CAP
 *  is not read from this: it is the account's slots (`tryAcquireDownloadSlot`). */
export function runningDownloadsFor(userId: string): number {
  let count = 0
  for (const download of activeDownloads.values()) {
    if (download.userId === userId && download.phase !== "completed" && download.phase !== "failed") count++
  }
  return count
}

async function findAndUploadThumbnail(baseName: string, outputId: string): Promise<string | undefined> {
  const thumbExtensions = [".jpg", ".webp", ".png"]
  for (const ext of thumbExtensions) {
    const thumbPath = join(tmpdir(), `${baseName}${ext}`)
    try {
      await fs.access(thumbPath)
      const thumbStat = await fs.stat(thumbPath)
      if (thumbStat.size > 0) {
        const thumbBuffer = await fs.readFile(thumbPath)
        const contentType = ext === ".jpg" ? "image/jpeg" : ext === ".webp" ? "image/webp" : "image/png"
        const thumbR2Key = `thumbnails/yt-${outputId}${ext}`
        const url = await uploadBufferToR2(thumbBuffer, thumbR2Key, contentType)
        await fs.unlink(thumbPath).catch(() => {})
        return url
      }
      await fs.unlink(thumbPath).catch(() => {})
    } catch {
      continue
    }
  }
  return undefined
}

function cleanupFiles(baseName: string): void {
  const videoExts = [".mp4", ".mkv", ".webm", ".mov", ".avi", ".flv"]
  const thumbExts = [".jpg", ".webp", ".png"]
  for (const ext of [...videoExts, ...thumbExts]) {
    fs.unlink(join(tmpdir(), `${baseName}${ext}`)).catch(() => {})
  }
}

async function runDownloadWithProgress(
  downloadId: string,
  url: string,
  outputId: string,
  baseName: string,
  outPath: string,
  userId: string,
  section?: VideoSection,
  maxHeight?: number,
  maxFilesizeBytes?: number,
  requireAudio = true,
): Promise<void> {
  const state = activeDownloads.get(downloadId)
  if (!state) return

  try {
    // Provider owns yt-dlp spawn + spoof + h264 normalize; we keep the SSE
    // progress map, fed by its callbacks. onProgress reports download percent;
    // onProcessingStart fires once when the h264 re-encode begins. For section
    // downloads yt-dlp's percents are jumpy — accepted, the map just relays them.
    await downloadYouTubeVideo({
      url,
      outPath,
      section,
      maxHeight,
      maxFilesizeBytes,
      // Default TRUE: a voice changer can't use a silent clip, and a silent
      // result is usually a degraded source response — so fail the import (and
      // fail over to the next attempt) instead of ingesting it. The caller can
      // opt out for a clip that really has no sound. See assertAudioPresent; a
      // silent file re-encodes video-only, so the "-c:a aac" crash can't happen.
      requireAudio,
      onProgress: (pct) => {
        if (state.phase === "downloading") {
          state.percent = Math.min(Math.round(pct), 99)
        }
      },
      onProcessingStart: () => {
        state.phase = "processing"
        state.percent = 90
      },
    })

    state.phase = "uploading"
    state.percent = 95

    const videoR2Key = `videos/yt-${outputId}.mp4`
    // Size taken BEFORE the upload path unlinks the file — it becomes the
    // assets row's size_bytes, which is exactly what the delete paths
    // (library.ts, media-process deleteSource) decrement by later.
    const videoSizeBytes = (await fs.stat(outPath)).size
    const videoR2Url = await uploadFileWithKeyToR2(outPath, videoR2Key, "video/mp4")

    // Sidecar thumbnail first (yt-dlp's --write-thumbnail); when the source had
    // none — a direct file URL never does, and some social fetches come back
    // bare — extract the file's own first frame while it is still on disk.
    // Nice-to-have semantics, same as /v1/upload: a poster failure logs and the
    // download proceeds without one.
    let thumbnailUrl = await findAndUploadThumbnail(baseName, outputId)
    if (!thumbnailUrl) {
      try {
        const poster = await thumbnailFromLocalVideo(outPath)
        thumbnailUrl = await uploadBufferToR2(poster, `thumbnails/yt-${outputId}.png`, "image/png")
      } catch (err) {
        console.warn(
          `[download-video] poster fallback failed: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
    await fs.unlink(outPath).catch(() => {})

    // Ownership row + increment-only storage accounting — the same assets shape
    // /v1/upload and /v1/media/process insert. Without this row the downloaded
    // object is unowned and untracked: the ownership-gated deleteSource on
    // /v1/media/process could never clean it up, and its bytes never counted
    // toward the user's storage. Primary video object only — no thumbnail row
    // and no thumbnail byte tracking, matching the platform's delete paths
    // (which remove/decrement only the primary object + row).
    //
    // DELIBERATELY no reserve_storage_if_within_limit here: social imports have
    // never been quota-ENFORCED, and silently making them fail over-quota would
    // be an unauthorized product change. Increment-only accounting for now;
    // enforcement is an explicit future decision.
    //
    // Bookkeeping is best-effort: a failure must never fail a download whose
    // video already uploaded — the user keeps their video; it is merely unowned
    // (deleteSource will skip it), same as every pre-existing download.
    await recordDownloadedVideoAsset({
      userId,
      outputId,
      sizeBytes: videoSizeBytes,
      r2Key: videoR2Key,
      r2Url: videoR2Url,
      thumbnailUrl,
      sourceUrl: url,
    })

    state.phase = "completed"
    state.percent = 100
    state.videoUrl = videoR2Url
    state.thumbnailUrl = thumbnailUrl
  } catch (err) {
    state.phase = "failed"
    state.error = err instanceof Error ? err.message : "Download failed"
    // LOG IT. This ran in the background and only ever reported the failure to
    // the SSE client, so a broken downloader looked like silence server-side —
    // which is how a `spawn ... yt-dlp ENOENT` (the binary was missing from the
    // image entirely) survived unnoticed across every social-video path.
    console.error(`[download-video] ${downloadId} failed: ${state.error}`)
    cleanupFiles(baseName)
  }

  // Auto-clean from map after 5 minutes
  setTimeout(() => activeDownloads.delete(downloadId), 5 * 60 * 1000)
}

export interface TrackedDownloadRequest {
  readonly url: string
  readonly userId: string
  readonly section?: VideoSection
  readonly maxHeight?: number
  /** Direct files carry the 500MB cap; social fetches pass none (unchanged). */
  readonly maxFilesizeBytes?: number
  /** Default TRUE — see `runDownloadWithProgress`. */
  readonly requireAudio?: boolean
}

export interface TrackedDownload {
  readonly downloadId: string
  readonly state: ActiveDownload
  /** Settles when the download is over, either way (read `state.phase`). Never rejects. */
  readonly done: Promise<void>
}

/**
 * Take one of the account's download slots, or null when it is at its cap — on
 * any process (`download-slots.ts`). Every download starts here: the route
 * answers 429 on null, a run waits for one.
 */
export function tryAcquireDownloadSlot(userId: string): Promise<DownloadSlot | null> {
  return downloadSlots().tryAcquire(userId, MAX_ACTIVE_DOWNLOADS_PER_USER)
}

/**
 * Register a download under the account and start it in the background. The
 * caller holds `slot` (`tryAcquireDownloadSlot`) and has checked the link; the
 * slot is given back when the download ends, either way.
 */
export function startTrackedDownload(request: TrackedDownloadRequest, slot: DownloadSlot): TrackedDownload {
  const downloadId = randomUUID()
  const outputId = randomUUID()
  const baseName = `yt-video-${outputId}`
  const outPath = join(tmpdir(), `${baseName}.mp4`)
  const state: ActiveDownload = { userId: request.userId, percent: 0, phase: "downloading" }
  activeDownloads.set(downloadId, state)
  const done = runDownloadWithProgress(
    downloadId, request.url, outputId, baseName, outPath, request.userId,
    request.section, request.maxHeight, request.maxFilesizeBytes, request.requireAudio ?? true,
  ).finally(() => slot.release())
  return { downloadId, state, done }
}

/** How long a run waits for one of the account's download slots before giving up. */
export const RUN_DOWNLOAD_SLOT_WAIT_MS = 5 * 60 * 1000
/** The longest a run waits on one download (the provider's own hold ceiling is 30 minutes). */
export const RUN_DOWNLOAD_MAX_MS = 40 * 60 * 1000

export class RunDownloadError extends Error {
  constructor(message: string, readonly kind: "failed" | "busy" | "timeout" | "aborted") {
    super(message)
    this.name = "RunDownloadError"
  }
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms)
    function done() {
      clearTimeout(timer)
      signal?.removeEventListener("abort", done)
      resolve()
    }
    signal?.addEventListener("abort", done, { once: true })
  })

/**
 * Wait for one of the account's download slots — the same slots the route's
 * downloads take, in whichever process they run: a run that would take a fifth
 * waits for one to free instead of failing for it, and gives up after
 * `RUN_DOWNLOAD_SLOT_WAIT_MS`. A stop of the run ends the wait; a slot granted
 * in the instant of the stop is given back.
 */
async function acquireSlot(userId: string, signal: AbortSignal | undefined, waitMs: number): Promise<DownloadSlot> {
  const until = Date.now() + waitMs
  for (;;) {
    if (signal?.aborted) throw new RunDownloadError("The run was stopped", "aborted")
    const slot = await tryAcquireDownloadSlot(userId)
    if (slot) {
      if (!signal?.aborted) return slot
      slot.release()
      throw new RunDownloadError("The run was stopped", "aborted")
    }
    const left = until - Date.now()
    if (left <= 0) {
      throw new RunDownloadError("Too many downloads are running — wait for one to finish and try again.", "busy")
    }
    await sleep(Math.min(1000, left), signal)
  }
}

/** Race `work` against the run's stop signal and the download ceiling. */
async function within<T>(work: Promise<T>, signal: AbortSignal | undefined, maxMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  const stop = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new RunDownloadError("The download took too long", "timeout")), maxMs)
    if (signal) {
      onAbort = () => reject(new RunDownloadError("The run was stopped", "aborted"))
      if (signal.aborted) onAbort()
      else signal.addEventListener("abort", onAbort, { once: true })
    }
  })
  try {
    return await Promise.race([work, stop])
  } finally {
    if (timer) clearTimeout(timer)
    if (signal && onAbort) signal.removeEventListener("abort", onAbort)
    stop.catch(() => {})
  }
}

export interface RunDownloadOptions extends Omit<TrackedDownloadRequest, "requireAudio"> {
  readonly signal?: AbortSignal
  readonly slotWaitMs?: number
  readonly maxMs?: number
}

/**
 * The download a RUN needs, awaited: waits for a slot, then downloads through
 * the very path the route uses and resolves with the stored file. A stop of the
 * run abandons the WAIT only — the provider has no way to kill a download in
 * flight, so the file lands in storage unused and its slot frees when it ends.
 */
export async function downloadVideoForRun(options: RunDownloadOptions): Promise<{ videoUrl: string; thumbnailUrl?: string }> {
  const slot = await acquireSlot(options.userId, options.signal, options.slotWaitMs ?? RUN_DOWNLOAD_SLOT_WAIT_MS)
  const { state, done } = startTrackedDownload(options, slot)
  await within(done, options.signal, options.maxMs ?? RUN_DOWNLOAD_MAX_MS)
  if (state.phase === "completed" && state.videoUrl) {
    return { videoUrl: state.videoUrl, ...(state.thumbnailUrl ? { thumbnailUrl: state.thumbnailUrl } : {}) }
  }
  throw new RunDownloadError(state.error ?? "Download failed", "failed")
}

/**
 * Run another kind of download (the audio track) under the account's cap: it
 * occupies a slot like a video does, so a run that fetches sound beside its
 * videos cannot exceed what one account may have running.
 */
export async function withDownloadSlot<T>(
  userId: string,
  work: () => Promise<T>,
  options: { readonly signal?: AbortSignal; readonly slotWaitMs?: number; readonly maxMs?: number } = {},
): Promise<T> {
  const slot = await acquireSlot(userId, options.signal, options.slotWaitMs ?? RUN_DOWNLOAD_SLOT_WAIT_MS)
  const id = randomUUID()
  const state: ActiveDownload = { userId, percent: 0, phase: "downloading" }
  activeDownloads.set(id, state)
  // The slot frees when the work ENDS, not when this run stops waiting for it.
  const running = (async () => work())()
    .then(
      (result) => {
        state.phase = "completed"
        return result
      },
      (err: unknown) => {
        state.phase = "failed"
        throw err
      },
    )
    .finally(() => {
      activeDownloads.delete(id)
      slot.release()
    })
  running.catch(() => {})
  return within(running, options.signal, options.maxMs ?? RUN_DOWNLOAD_MAX_MS)
}
