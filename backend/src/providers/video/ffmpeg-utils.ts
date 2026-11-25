import { execFile, spawn, type ExecFileException } from "node:child_process"
import { execFileFfmpeg, spawnFfmpeg } from "./ffmpeg-process.js"
import { retryOnShortage, spawnShowsShortage, stderrShowsShortage } from "./ffmpeg-shortage-retry.js"
import { createWriteStream } from "node:fs"
import { promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { Readable, Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import { safeFetch } from "../../lib/safe-fetch.js"
import { isOwnStoredFileUrl } from "../../lib/own-storage-url.js"
import {
  assertSafeProbeSource,
  containerRefusalOf,
  isNetworkProbeSource,
  isProbeGuardOption,
  namesALink,
  OWN_STORAGE_PROBE_MAX_BYTES,
  probeInputArgs,
  ProbeSourceBlockedError,
  storedCopyProbeArgs,
  unguardedProbeLinkRefusal,
  withProbeEgress,
  type ProbeSourceBlockReason,
} from "./probe-guard.js"
import { csvFields } from "./ffprobe-csv.js"
import { preparePluginRun } from "./plugin-run-guard.js"
import { DeterministicJobError } from "../../lib/deterministic-job-error.js"
import { DEFAULT_DOWNLOAD_LIMITS, watchTransferBody, type TransferRateLimits, type TransferWatch } from "../../lib/transfer-watchdog.js"
import { currentSlotWaitLedger } from "../../lib/ffmpeg-slot-wait.js"
import { acquireFfmpegSlot as acquireFfmpegAdmission, ffmpegMemoryBudgetNow } from "./ffmpeg-admission-instance.js"
import { describeFfmpegMemoryBudget } from "./ffmpeg-memory.js"
import { ffmpegStallError, watchForStall, type FfmpegStallWatch } from "./ffmpeg-stall-watchdog.js"
import {
  DEFAULT_DOWNLOAD_FLOOR_BYTES_PER_SEC,
  DEFAULT_DOWNLOAD_MAX_MS,
  DEFAULT_DOWNLOAD_MIN_BYTES_PER_WINDOW,
  DEFAULT_DOWNLOAD_RATE_WINDOW_MS,
  DEFAULT_FFMPEG_TIMEOUT_MS,
  DOWNLOAD_FLOOR_BYTES_PER_SEC,
  DOWNLOAD_MAX_MS,
  DOWNLOAD_MIN_BYTES_PER_WINDOW,
  DOWNLOAD_RATE_WINDOW_MS,
  DOWNLOAD_TIMEOUT_MS,
  BIG_MEDIA_MAX_BYTES,
  FFMPEG_KILL_GRACE_MS,
  FFMPEG_SLOT_BACKSTOP_MS,
  FFPROBE_TIMEOUT_MS,
  downloadBodyDeadlineMs,
} from "./ffmpeg-timeouts.js"
import { constantFrameRate, parseFrameRate } from "./frame-rate.js"
import { UNREADABLE_CLIP_FPS } from "@nodaro/render-rules"

// The frame-rate rule lives in a dependency-free leaf (see its header);
// re-exported so every existing `ffmpeg-utils.js` import keeps working.
export { constantFrameRate, parseFrameRate }

// The ceilings live in a dependency-free leaf (see its header); re-exported so
// every existing `ffmpeg-utils.js` import keeps working.
export {
  DEFAULT_DOWNLOAD_FLOOR_BYTES_PER_SEC,
  DEFAULT_DOWNLOAD_MAX_MS,
  DEFAULT_DOWNLOAD_MIN_BYTES_PER_WINDOW,
  DEFAULT_DOWNLOAD_RATE_WINDOW_MS,
  DEFAULT_FFMPEG_TIMEOUT_MS,
  DOWNLOAD_FLOOR_BYTES_PER_SEC,
  DOWNLOAD_MAX_MS,
  DOWNLOAD_MIN_BYTES_PER_WINDOW,
  DOWNLOAD_RATE_WINDOW_MS,
  DOWNLOAD_TIMEOUT_MS,
  BIG_MEDIA_MAX_BYTES,
  FFMPEG_KILL_GRACE_MS,
  FFMPEG_SLOT_BACKSTOP_MS,
  FFPROBE_TIMEOUT_MS,
  downloadBodyDeadlineMs,
}

/**
 * Whether `err` is `downloadFile` refusing a body past its byte cap (`maxBytes`
 * or the limits' own) — a refusal that is the same on every attempt, unlike a
 * timeout. The one place that reads the refusal's wording.
 */
export function isDownloadByteCapError(err: unknown): boolean {
  return err instanceof Error && /^Download exceeds /.test(err.message)
}

/** The staged limits a BIG-MEDIA download runs under (production:
 *  `BIG_MEDIA_DOWNLOAD_LIMITS`; a test passes small ones). `responseMs` is
 *  also how long the response (status + headers) may take; the body limits
 *  are the shared `watchTransferBody` rule (`lib/transfer-watchdog.ts`). */
export interface DownloadLimits extends TransferRateLimits {
  /** The most it may write (unless the caller passes a smaller `maxBytes`). */
  readonly maxBytes: number
}

/** For callers that fetch big media — apply-edl's camera originals and the
 *  media proxy's source (decided 2026-09-25, Track 0.19). Their URLs are
 *  user-supplied, so the limits guard a hostile one: a minimum rate per window
 *  (a drip-feed fails within a minute) and a byte cap (a fast one cannot fill
 *  the disk). Every other caller runs under the default path's looser limits
 *  (`DEFAULT_DOWNLOAD_LIMITS`). */
export const BIG_MEDIA_DOWNLOAD_LIMITS: DownloadLimits = Object.freeze({
  responseMs: DOWNLOAD_TIMEOUT_MS,
  windowMs: DOWNLOAD_RATE_WINDOW_MS,
  minBytesPerWindow: DOWNLOAD_MIN_BYTES_PER_WINDOW,
  maxBytes: BIG_MEDIA_MAX_BYTES,
  floorBytesPerSec: DOWNLOAD_FLOOR_BYTES_PER_SEC,
  maxMs: DOWNLOAD_MAX_MS,
})

/** The default path's body limits — defined beside the body rule
 *  (`lib/transfer-watchdog.ts`), re-exported so every import keeps working. */
export { DEFAULT_DOWNLOAD_LIMITS }

/** A limit in words: whole seconds, or milliseconds under one. */
const seconds = (ms: number) => (ms < 1000 ? `${Math.max(0, Math.round(ms))} ms` : `${Math.round(ms / 1000)} s`)

/** A download that took longer than this is logged (how long, how much, how fast, which way). */
const SLOW_DOWNLOAD_LOG_MS = 120_000

/**
 * What the source that writes a download's bytes says of them, before the
 * body: the served `Content-Type` and `Content-Length` over HTTP (the length
 * as announced, whatever its encoding), the object's own type and size for a
 * read from storage. A field is absent when the source does not say.
 */
export interface DownloadSource {
  readonly contentType?: string
  readonly contentLength?: number
}

/** The bound a storage read inside `saveResponse`'s 404 fallback runs under. */
interface StorageReadBounds {
  timeoutMs: number
  signal?: AbortSignal
  maxBytes?: number
  limits?: TransferRateLimits
  onSource?: (source: DownloadSource) => void
}

/** What one `downloadFile` call is bounded by. */
interface DownloadOptions {
  maxBytes?: number
  limits?: DownloadLimits
  timeoutMs?: number
  signal?: AbortSignal
  /** Told what the source says of the bytes ({@link DownloadSource}) once it
   *  answers, before the body is written — again for each source tried
   *  (storage, the link, storage again): the last call is the one that wrote. */
  onSource?: (source: DownloadSource) => void
  /** The DEFAULT path's overall ceiling, lowered for a caller whose own wait is
   *  shorter (a synchronous route): the same size-scaled body rule, ending at
   *  this many ms from the start (at most `DEFAULT_DOWNLOAD_MAX_MS`). Ignored
   *  with `limits` or `timeoutMs`. */
  ceilingMs?: number
}

/**
 * Fetch `url` to `dest`.
 *
 * OUR OWN FILES (a link strictly under this install's `R2_PUBLIC_URL`, with
 * storage configured) are read straight from storage, not back through the
 * public host: the first read of a freshly written object is a miss at the
 * edge and can arrive at a few kB/s. A file storage does not have fails as the
 * HTTP path would ("Failed to download: <url> (404)"); any other storage
 * failure falls back to HTTP, and an HTTP timeout of one of our files is
 * retried once from storage. An install without storage, and every other
 * link, goes over HTTP only, as before.
 *
 * Over HTTP every limit reaches the BODY: one signal stops the fetch AND the
 * stream that writes it, so a body cannot keep arriving past its limit.
 *
 * DEFAULT (no `limits`, no `timeoutMs`): the response within
 * `DOWNLOAD_TIMEOUT_MS` (120 s); the body is never judged within 120 s of the
 * start, then must keep a small minimum rate per window, gets its announced
 * size at a conservative floor rate, and stops at a ceiling
 * (`DEFAULT_DOWNLOAD_LIMITS`). So a slow-but-steady large file still arrives;
 * a stalled or drip-fed one is ended.
 *
 * BIG MEDIA (`opts.limits`, normally `BIG_MEDIA_DOWNLOAD_LIMITS`): a transfer
 * runs while it keeps a minimum rate — aborted when a `windowMs` window
 * delivers under `minBytesPerWindow` (a dead or drip-fed transfer: these
 * callers take user-supplied URLs), when a known-size body outlasts its size at
 * the floor rate, at `maxMs` overall, or past `maxBytes` on disk. The flat 120 s
 * could never deliver a 3-hour camera original (~15 GB). The rate applies only
 * after `responseMs` (review round 3 of #1656, decided 2026-09-25). The body is
 * fetched uncompressed and a compressed one is refused — the rate counts
 * decoded bytes, so gzip would let a drip-feed pass it at ~1000:1.
 *
 * `onSource` is told the served type and announced length (or the stored
 * object's), for a caller that decides by them as it would by the headers.
 *
 * Every timeout starts "Download timeout:" and names its limit. On the DEFAULT
 * path a caller on a tighter budget passes `timeoutMs` (never above
 * `DOWNLOAD_TIMEOUT_MS`; a hard total, rejecting as a `TimeoutError`) and a
 * caller whose client may go away a `signal`.
 */
export async function downloadFile(url: string, dest: string, opts: DownloadOptions = {}): Promise<void> {
  const startedAt = Date.now()
  const route: string[] = []
  let failed = true
  try {
    await downloadFileOnce(url, dest, opts, startedAt, route)
    failed = false
  } finally {
    const tookMs = Date.now() - startedAt
    // Never lets the log line change the download's own outcome.
    if (tookMs > SLOW_DOWNLOAD_LOG_MS) await logSlowDownload(url, dest, tookMs, route, failed).catch(() => undefined)
  }
}

/**
 * One line for a download that took over {@link SLOW_DOWNLOAD_LOG_MS}: so
 * production can see who runs long, and confirm nobody working is being cut
 * off. The link without its query (a signed link's query is a credential).
 */
async function logSlowDownload(url: string, dest: string, tookMs: number, route: readonly string[], failed: boolean): Promise<void> {
  let where = "(unparseable link)"
  try { const u = new URL(url); where = `${u.origin}${u.pathname}` } catch { /* keep the placeholder */ }
  const bytes = await fs.stat(dest).then((st) => st.size, () => 0)
  const kBps = Math.round(bytes / 1024 / (tookMs / 1000))
  console.warn(`[downloadFile] slow download ${failed ? "failed" : "finished"}: ${where} — ${Math.round(tookMs / 1000)} s, ${bytes} bytes, ${kBps} kB/s average, via ${route.join("-then-") || "nothing"}`)
}

async function downloadFileOnce(url: string, dest: string, opts: DownloadOptions, startedAt: number, route: string[]): Promise<void> {
  const budgetMs = opts.limits || opts.timeoutMs === undefined ? undefined : Math.min(DOWNLOAD_TIMEOUT_MS, opts.timeoutMs)
  // ONE deadline for the whole call, whichever reads it takes (storage, the
  // link, storage again): the caller's budget, else its path's ceiling.
  const defaultLimits = !opts.limits && opts.ceilingMs !== undefined && opts.ceilingMs > 0 && opts.ceilingMs < DEFAULT_DOWNLOAD_LIMITS.maxMs
    ? { ...DEFAULT_DOWNLOAD_LIMITS, maxMs: opts.ceilingMs }
    : DEFAULT_DOWNLOAD_LIMITS
  const deadlineAt = startedAt + (budgetMs ?? (opts.limits ? opts.limits.maxMs : defaultLimits.maxMs))
  const timeLeft = () => deadlineAt - Date.now()
  const maxBytes = opts.limits ? Math.min(opts.maxBytes ?? Infinity, opts.limits.maxBytes) : opts.maxBytes
  const signal = opts.limits ? undefined : opts.signal

  const key = await ownStorageKey(url)
  const fromStorage = key
    ? () => {
      route.push("storage")
      return readOwnStoredObject(key, url, dest, {
        ...(Number.isFinite(maxBytes) && maxBytes !== undefined ? { maxBytes } : {}),
        ...(opts.limits ? { limits: opts.limits } : {}),
        ...(signal ? { signal } : {}),
        ...(opts.onSource ? { onSource: opts.onSource } : {}),
        timeLeft,
      })
    }
    : undefined
  if (fromStorage && (await fromStorage())) return

  // The 404 fallback reads storage within the same deadline — and not at all
  // when the storage read above already failed for this very key.
  const storageFallback = {
    skip: key !== null,
    bounds: (): StorageReadBounds => ({
      timeoutMs: timeLeft(),
      ...(signal ? { signal } : {}),
      ...(maxBytes !== undefined && Number.isFinite(maxBytes) ? { maxBytes } : {}),
      ...(opts.limits ? { limits: opts.limits } : {}),
      ...(opts.onSource ? { onSource: opts.onSource } : {}),
    }),
  }
  route.push("http")
  try {
    await (opts.limits
      ? downloadOverHttpBigMedia(url, dest, opts.limits, maxBytes!, { startedAt, deadlineAt, storageFallback, onSource: opts.onSource })
      : downloadOverHttpDefault(url, dest, { maxBytes, signal, budgetMs, deadlineAt, storageFallback, onSource: opts.onSource, limits: defaultLimits }))
  } catch (err) {
    // Our own file timed out at the public host: one more read from storage,
    // on whatever is left of the call's deadline.
    if (fromStorage && isDownloadTimeoutError(err) && !signal?.aborted && timeLeft() > 0) {
      if (await fromStorage().catch(() => false)) return
    }
    throw err
  }
}

/** A `downloadFile` limit ran out (its own words, or a budget's `TimeoutError`). */
function isDownloadTimeoutError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  return err.name === "TimeoutError" || err.message.startsWith("Download timeout")
}

/**
 * The storage key of `url` when it is one of OUR files and storage is
 * configured here; null otherwise (the link then goes over HTTP only).
 * Strictly ours (`isOwnStoredFileUrl`: no escape, no edge transform, the one
 * normal form), so the key is exactly the path under the public base — a link
 * that is not strict stays on HTTP rather than risk reading a wrong key.
 * Storage is loaded only for such a link (its module builds a client); a test
 * whose partial mock of it throws gets HTTP.
 */
async function ownStorageKey(url: string): Promise<string | null> {
  if (!isOwnStoredFileUrl(url)) return null
  try {
    const { isStorageConfigured, r2KeyFromOurUrl } = await import("../../lib/storage.js")
    if (!isStorageConfigured()) return null
    const key = r2KeyFromOurUrl(url)
    return key && (await storageMayServeDirectly(key)) ? key : null
  } catch {
    return null
  }
}

/**
 * Whether storage may hand over `key` without its public link being asked —
 * false wherever the link is refused by a rule storage itself does not know:
 *
 *  - a kept prefix (`lib/kept-storage-prefixes.ts`): the deployment's own
 *    files, among them a restricted file's evidence bytes (`evidence/…`),
 *    which the public host refuses to serve;
 *  - every key, on a deployment that makes withheld results private by their
 *    ACL (`withheldObjectsGoPrivate`): such a file's link no longer reads it,
 *    but storage's credentials still would, and which files are withheld is
 *    not known here without a lookup per download.
 *
 * The key is checked as given and decoded (a link's path may escape it). Any
 * doubt — a module that cannot be read — is a refusal: the link is then read
 * over HTTP, where the host's own rules apply.
 */
async function storageMayServeDirectly(key: string): Promise<boolean> {
  try {
    const [{ keptStoragePrefix }, { withheldObjectsGoPrivate }] = await Promise.all([
      import("../../lib/kept-storage-prefixes.js"),
      import("../../lib/storage-deletes-setting.js"),
    ])
    if (withheldObjectsGoPrivate()) return false
    let decoded = key
    try { decoded = decodeURIComponent(key) } catch { return false }
    return keptStoragePrefix(key) === undefined && keptStoragePrefix(decoded) === undefined
  } catch {
    return false
  }
}

/** Storage's own "no such object" — GetObject's `NoSuchKey` only. Any other
 *  refusal (a bucket it does not know, a bare 404 from a proxy in front of it)
 *  says nothing about the file, so the link is tried instead. */
function isStorageNotFound(err: unknown): boolean {
  const e = err as { name?: unknown; Code?: unknown } | null
  return e?.name === "NoSuchKey" || e?.Code === "NoSuchKey"
}

/**
 * Read one of our objects from storage to `dest`. Resolves true once written;
 * false when the read failed in a way HTTP may not (storage unreachable, a
 * refused credential, a stalled read) — the caller then fetches over HTTP.
 * Throws what HTTP would fail the same way: a missing object (worded as the
 * HTTP path's 404), a byte-cap refusal, the caller's abort, a spent budget.
 */
async function readOwnStoredObject(
  key: string,
  url: string,
  dest: string,
  bounds: { maxBytes?: number; limits?: TransferRateLimits; signal?: AbortSignal; onSource?: (source: DownloadSource) => void; timeLeft: () => number },
): Promise<boolean> {
  const left = bounds.timeLeft()
  if (left <= 0) {
    throw Object.assign(new Error(`Download timeout: no time left to read ${url}`), { name: "TimeoutError" })
  }
  try {
    const { downloadR2ObjectToFile } = await import("../../lib/storage.js")
    await downloadR2ObjectToFile(key, dest, {
      ...(bounds.maxBytes !== undefined ? { maxBytes: bounds.maxBytes } : {}),
      ...(bounds.limits ? { limits: bounds.limits } : {}),
      ...(bounds.signal ? { signal: bounds.signal } : {}),
      ...(bounds.onSource ? { onSource: bounds.onSource } : {}),
      timeoutMs: left,
    })
    return true
  } catch (err) {
    if (isStorageNotFound(err)) throw new Error(`Failed to download: ${url} (404)`)
    if (isDownloadByteCapError(err) || bounds.signal?.aborted || bounds.timeLeft() <= 0) throw err
    // Visible, so a storage that is always failing here (credentials, a
    // bucket name) does not just quietly add its retries to every download.
    console.warn(`[downloadFile] reading ${key} from storage failed (${err instanceof Error ? err.message : String(err)}); fetching its link instead`)
    return false
  }
}

/** The DEFAULT path over HTTP (see `downloadFile`). */
async function downloadOverHttpDefault(
  url: string,
  dest: string,
  o: {
    maxBytes?: number
    signal?: AbortSignal
    budgetMs?: number
    deadlineAt: number
    storageFallback: { skip: boolean; bounds: () => StorageReadBounds }
    onSource?: (source: DownloadSource) => void
    /** `DEFAULT_DOWNLOAD_LIMITS`, or the same with the caller's lower ceiling. */
    limits: TransferRateLimits
  },
): Promise<void> {
  // safeFetch: callers include media-process which streams user-supplied
  // sourceUrl into ffmpeg. Without DNS-aware SSRF protection, a hostname
  // resolving to an internal IP would have the response processed and the
  // result uploaded to R2 (read-oracle). See backend/src/lib/safe-fetch.ts.
  const ctrl = new AbortController()
  // A `TimeoutError`, as the flat timer's rejection was: a caller may tell a
  // timeout from another failure by its name.
  const abortWith = (what: string) => {
    if (!ctrl.signal.aborted) ctrl.abort(Object.assign(new Error(`Download timeout: ${what}: ${url}`), { name: "TimeoutError" }))
  }
  const onCallerAbort = () => { if (!ctrl.signal.aborted) ctrl.abort(o.signal!.reason) }
  if (o.signal?.aborted) onCallerAbort()
  else o.signal?.addEventListener("abort", onCallerAbort, { once: true })

  const limits = o.limits
  // Every timer is OURS, so every abort names its limit; safeFetch's own timer
  // is only a backstop set past them.
  const timers: Array<ReturnType<typeof setTimeout>> = []
  const clearTimers = () => { for (const t of timers) clearTimeout(t); timers.length = 0 }
  let body: TransferWatch | undefined
  const remaining = o.deadlineAt - Date.now()
  const left = o.budgetMs === undefined ? undefined : remaining
  try {
    let phase: ReturnType<typeof setTimeout> | undefined
    if (remaining <= 0) throw Object.assign(new Error(`Download timeout: no time left to read ${url}`), { name: "TimeoutError" })
    if (left !== undefined) {
      // A caller on a budget: one hard total over the response AND the body.
      timers.push(setTimeout(() => abortWith(`over its ${seconds(o.budgetMs!)} limit`), left))
    } else {
      timers.push(setTimeout(() => abortWith(`over its ${seconds(limits.maxMs)} overall ceiling`), remaining))
      phase = setTimeout(() => abortWith(`no response within ${seconds(limits.responseMs)}`), limits.responseMs)
      timers.push(phase)
    }
    const httpStartedAt = Date.now()
    const response = await safeFetch(url, { timeoutMs: (left ?? limits.maxMs) + 5_000, signal: ctrl.signal })
    clearTimeout(phase)
    await saveResponse(url, dest, response, o.maxBytes, {
      signal: ctrl.signal,
      // The storage fallback runs under what is left of the call's deadline.
      onFallback: clearTimers,
      storageFallback: o.storageFallback,
      ...(o.onSource ? { onSource: o.onSource } : {}),
      ...(left === undefined
        ? {
          onBody: () => {
            // Only an unencoded length is the size of what arrives.
            const size = contentEncoding(response) ? NaN : Number(response.headers?.get?.("content-length") ?? NaN)
            body = watchTransferBody({ limits, sizeBytes: size, startedAt: httpStartedAt, stop: abortWith })
            return body.count
          },
        }
        : {}),
    })
  } catch (err) {
    // Our own abort reason says what happened; the fetch/stream layers would
    // otherwise surface a bare "This operation was aborted".
    if (ctrl.signal.aborted && ctrl.signal.reason instanceof Error) throw ctrl.signal.reason
    throw err
  } finally {
    clearTimers()
    body?.stop()
    o.signal?.removeEventListener("abort", onCallerAbort)
  }
}

/** The BIG-MEDIA path over HTTP (see `downloadFile`). */
async function downloadOverHttpBigMedia(
  url: string,
  dest: string,
  limits: DownloadLimits,
  maxBytes: number,
  call: {
    startedAt: number
    deadlineAt: number
    storageFallback: { skip: boolean; bounds: () => StorageReadBounds }
    onSource?: (source: DownloadSource) => void
  },
): Promise<void> {
  const startedAt = Date.now()
  const { deadlineAt } = call
  const ctrl = new AbortController()
  const abortWith = (what: string) => {
    if (!ctrl.signal.aborted) ctrl.abort(new Error(`Download timeout: ${what}: ${url}`))
  }
  // Every timer is OURS, so every abort names its limit; safeFetch's own timer
  // is only a backstop set past the overall ceiling.
  // The call's ceiling, less what a storage read before this took — and the
  // reason says so when that read took part of it.
  const spentOnStorage = startedAt - call.startedAt
  let overall: ReturnType<typeof setTimeout> | undefined = setTimeout(
    () => abortWith(spentOnStorage >= 1000
      ? `over its ${seconds(limits.maxMs)} overall ceiling, ${seconds(spentOnStorage)} of it spent first on a storage read that failed`
      : `over its ${seconds(limits.maxMs)} overall ceiling`),
    Math.max(0, deadlineAt - Date.now()),
  )
  let phase: ReturnType<typeof setTimeout> | undefined = setTimeout(
    () => abortWith(`no response within ${seconds(limits.responseMs)}`),
    limits.responseMs,
  )
  let body: TransferWatch | undefined
  try {
    // Identity only: camera and audio originals are never sent compressed, and
    // a compressed body would be counted decoded by the rate window below.
    const response = await safeFetch(url, {
      timeoutMs: limits.maxMs + 5_000,
      signal: ctrl.signal,
      headers: { "accept-encoding": "identity" },
    })
    clearTimeout(phase)
    const encoding = contentEncoding(response)
    if (response.ok && encoding) {
      await response.body?.cancel().catch(() => undefined)
      throw new Error(`Download refused: the server sent a compressed body (Content-Encoding: ${encoding}) though an uncompressed one was requested: ${url}`)
    }
    await saveResponse(url, dest, response, maxBytes, {
      signal: ctrl.signal,
      // The storage fallback runs under the caller's limits and what is left
      // of the call's deadline; ours stop here.
      onFallback: () => { clearTimeout(overall); overall = undefined },
      storageFallback: call.storageFallback,
      ...(call.onSource ? { onSource: call.onSource } : {}),
      onBody: () => {
        const size = Number(response.headers?.get?.("content-length") ?? NaN)
        // The size deadline and, once `responseMs` has passed since the start
        // (when the default path would itself have given up), the minimum rate.
        body = watchTransferBody({ limits, sizeBytes: size, startedAt, stop: abortWith })
        return body.count
      },
    })
  } catch (err) {
    if (ctrl.signal.aborted && ctrl.signal.reason instanceof Error) throw ctrl.signal.reason
    throw err
  } finally {
    clearTimeout(overall)
    clearTimeout(phase)
    body?.stop()
  }
}

/** The response's content coding, or "" when its body is sent as is. */
function contentEncoding(response: Response): string {
  const value = (response.headers?.get?.("content-encoding") ?? "").trim().toLowerCase()
  return value === "identity" ? "" : value
}

/** Write an already-fetched response to `dest` (both HTTP download paths). */
async function saveResponse(
  url: string,
  dest: string,
  response: Response,
  maxBytes: number | undefined,
  hooks: {
    /** Stops the body too: the one signal the fetch was given (a limit, the caller's abort). */
    readonly signal?: AbortSignal
    readonly onFallback?: () => void
    readonly onBody?: () => (bytes: number) => void
    /** The 404 fallback's storage read: skipped when storage already failed for this
     *  link's key; else bounded by `bounds()` (read when the fallback starts). */
    readonly storageFallback?: { readonly skip: boolean; readonly bounds: () => StorageReadBounds }
    /** Told the served type and announced length, before the body is written. */
    readonly onSource?: (source: DownloadSource) => void
  },
): Promise<void> {
  if (!response.ok) {
    // Never leave a failed response streaming: a 4xx/5xx whose body keeps
    // coming would otherwise hold its connection until the fetch timer fires.
    await response.body?.cancel().catch(() => undefined)
    // Cloudflare can negative-cache a 404 per-edge for 40-55min on freshly
    // finalized media (incidents 2026-06-10/12). When the URL is OUR public
    // bucket, bypass the edge and stream straight from the R2 origin —
    // r2KeyFromOurUrl returns null for foreign URLs, so provider links keep
    // the plain failure path.
    if (response.status === 404 && hooks.storageFallback && !hooks.storageFallback.skip) {
      // Dynamic import keeps storage (and its module-level S3 client) out of
      // this module's graph — the fallback is a cold error path and several
      // test suites load ffmpeg-utils with a minimal config mock.
      const { r2KeyFromOurUrl, downloadR2ObjectToFile } = await import("../../lib/storage.js")
      const key = r2KeyFromOurUrl(url)
      // Never a file whose link the public host refuses (`storageMayServeDirectly`).
      if (key && (await storageMayServeDirectly(key))) {
        hooks.onFallback?.()
        const bounds = hooks.storageFallback.bounds()
        if (bounds.timeoutMs <= 0) {
          throw Object.assign(new Error(`Download timeout: no time left for the storage fallback: ${url}`), { name: "TimeoutError" })
        }
        await downloadR2ObjectToFile(key, dest, bounds)
        return
      }
    }
    throw new Error(`Failed to download: ${url} (${response.status})`)
  }
  const capped = maxBytes !== undefined && maxBytes > 0 && Number.isFinite(maxBytes)
  const announced = Number(response.headers?.get?.("content-length") ?? NaN)
  if (capped && !contentEncoding(response) && announced > maxBytes) {
    // A body that says up front it is over the cap fails at the headers
    // (unencoded only: an encoded length is not the size on disk).
    await response.body?.cancel().catch(() => undefined)
    throw new Error(`Download exceeds ${Math.round(maxBytes / (1024 * 1024))} MB: ${url}`)
  }
  if (hooks.onSource) {
    const type = response.headers?.get?.("content-type")
    hooks.onSource({
      ...(type ? { contentType: type } : {}),
      ...(Number.isFinite(announced) ? { contentLength: announced } : {}),
    })
  }
  const count = hooks.onBody?.()
  const stages: Array<NodeJS.ReadableStream | NodeJS.ReadWriteStream | NodeJS.WritableStream> = [
    Readable.fromWeb(response.body as import("stream/web").ReadableStream),
  ]
  if (count) {
    // Every chunk counts toward the current rate window.
    stages.push(new Transform({ transform(chunk: Buffer, _enc, cb) { count(chunk.length); cb(null, chunk) } }))
  }
  if (capped) {
    // Byte cap for callers that fetch attacker-choosable URLs: the stream is
    // aborted as soon as the cap is crossed, so a hostile host cannot fill the
    // worker's tmpdir at line rate (each write is the caller's own work dir).
    let total = 0
    stages.push(new Transform({
      transform(chunk: Buffer, _enc, cb) {
        total += chunk.length
        if (total > maxBytes) cb(new Error(`Download exceeds ${Math.round(maxBytes / (1024 * 1024))} MB: ${url}`))
        else cb(null, chunk)
      },
    }))
  }
  stages.push(createWriteStream(dest))
  // The signal goes to the pipeline as well as the fetch: aborting only the
  // fetch does not reliably end a body already streaming (after a garbage
  // collection it kept arriving past its limit), so a limit was not real.
  await (pipeline as (...s: unknown[]) => Promise<void>)(...stages, ...(hooks.signal ? [{ signal: hooks.signal }] : []))
}

// The ffmpeg admission (`ffmpeg-admission-instance.ts`): FFMPEG_CONCURRENCY
// slots per process so fan-out doesn't launch N ffmpeg processes on a 2-vCPU box
// (the worker runs at high concurrency for I/O work; ffmpeg needs its own much
// lower cap), AND a memory budget every launch reserves its predicted peak from
// before it starts, shared by all the container's processes (decided
// 2026-10-05: two 4K chunks at once ran the box out of memory). The time a job
// spends queued here — for a slot or for memory — is recorded into its
// slot-wait ledger (`lib/ffmpeg-slot-wait.ts`, Track 0.13): a wait is not a
// hang, so the heartbeat and the workflow engine leave it out.

/** A deadline the admission wait does not count against (`FetchDeadline`). */
export interface WaitExcusedDeadline {
  /** The launch waited this many milliseconds for admission: move the deadline out by them. */
  excuse(waitedMs: number): void
}

/** What one launch tells the admission. */
export interface FfmpegLaunchOptions {
  /** The launch's predicted peak memory in MiB. Omitted: the default estimate
   *  (393 + 22.9 × its threads, or `FFMPEG_DEFAULT_PEAK_MIB`). A caller that
   *  knows its peak passes it (`ffmpeg-memory-model.ts`) — every Apply EDL
   *  picture slice and every re-encode does. */
  readonly peakMemoryMiB?: number
  /** Gives up WAITING for the launch's slot and memory when it aborts (the launch then rejects with its
   *  reason); never stops a launch already admitted, unless `stopOnAbort`. `runFfmpeg` only. Omitted: waits as long as it takes. */
  readonly signal?: AbortSignal
  /** With `signal`: its abort also stops the launch once it runs (the child is killed; the failure then
   *  carries `aborted`). `runFfmpeg` only. Omitted: an admitted launch runs to its end. */
  readonly stopOnAbort?: boolean
  /** The child's environment: the probe guard's, for a run that reads a link through its proxy
   *  (`ffmpeg-reading-links.ts`). Omitted: this process's own. */
  readonly env?: NodeJS.ProcessEnv
}

export { ffmpegMemoryBudgetNow }

function acquireFfmpegSlot(signal: AbortSignal | undefined, peakMemoryMiB: number | undefined): Promise<() => void> {
  // Captured now: a grant runs later, in the async context of whoever released.
  return acquireFfmpegAdmission(signal, peakMemoryMiB, currentSlotWaitLedger())
}


/** Hold one slot for `work`, never longer than `limitMs` (+ the backstop): past
 *  that the slot is released and the call rejects, while `work` is left to
 *  settle on its own (its result discarded, its failure swallowed). */
async function holdSlot<T>(
  work: () => Promise<T>,
  opts: {
    readonly limitMs: number
    readonly signal?: AbortSignal
    readonly label: string
    readonly peakMemoryMiB?: number
    readonly deadline?: WaitExcusedDeadline
  },
): Promise<T> {
  // Admitted first; the hold's clocks (the backstop here, the caller's kill
  // budget inside `work`) start only once the launch may actually run.
  const waitStartedAt = Date.now()
  const release = await acquireFfmpegSlot(opts.signal, opts.peakMemoryMiB)
  // The ONE rule for a caller held to a deadline (a fetch's, `FetchDeadline`): what
  // the launch waited for its slot and its memory is not the caller's time.
  opts.deadline?.excuse(Date.now() - waitStartedAt)
  let backstop: ReturnType<typeof setTimeout> | undefined
  try {
    const running = work()
    running.catch(() => undefined)
    const ceilingMs = opts.limitMs + FFMPEG_KILL_GRACE_MS + FFMPEG_SLOT_BACKSTOP_MS
    return await Promise.race([
      running,
      new Promise<never>((_, reject) => {
        backstop = setTimeout(
          // A timeout like any other: the same flags `execFailureFlags` sets, so
          // a caller that classifies timeouts (Video Overlay) still does.
          () => reject(Object.assign(
            new Error(`${opts.label} held its ffmpeg slot past ${Math.round(ceilingMs / 1000)} s; the slot was released`),
            { killed: true, timedOut: true },
          )),
          ceilingMs,
        )
      }),
    ])
  } finally {
    clearTimeout(backstop)
    release()
  }
}

/** A run's kill budget: the given one, or the default for none — a zero, negative
 *  or non-finite budget would leave the run (and its slot) unbounded. */
function ffmpegLimitMs(timeoutMs: number | undefined): number {
  return typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_FFMPEG_TIMEOUT_MS
}

/** SIGKILL `child` `FFMPEG_KILL_GRACE_MS` after its execFile timeout's SIGTERM,
 *  if it has not exited by then. Returns the cleanup. */
function escalateKill(child: ReturnType<typeof execFile> | undefined, timeoutMs: number): () => void {
  if (!child) return () => {}
  const timer = setTimeout(() => {
    // Still alive: neither exited nor ended by a signal.
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
  }, timeoutMs + FFMPEG_KILL_GRACE_MS)
  timer.unref?.()
  return () => clearTimeout(timer)
}

/**
 * Run `fn` while holding one FIFO ffmpeg slot, releasing it afterwards.
 *
 * WHY exported: a few CPU/memory-bound steps are NOT ffmpeg spawns (so they
 * can't go through `runFfmpeg`) yet must share the same low concurrency cap —
 * e.g. the collage badge overlay is a sharp 4K re-encode running on a worker at
 * concurrency 50. Gating it on the same semaphore keeps fan-out from launching
 * dozens of heavy raster jobs at once. `acquireFfmpegSlot` stays private; this
 * is the only sanctioned way for a non-`runFfmpeg` caller to borrow a slot.
 *
 * `timeoutMs` is REQUIRED: the longest the work may hold the slot. A caller
 * that kills its own process passes that kill budget; raster work passes the
 * ffmpeg default. The slot releases itself shortly after it regardless
 * (`FFMPEG_SLOT_BACKSTOP_MS`), so no queued job waits on a hold forever.
 */
export async function withFfmpegSlot<T>(
  fn: () => Promise<T>,
  opts: {
    readonly timeoutMs: number
    readonly signal?: AbortSignal
    readonly label?: string
    /** The deadline of a caller that is held to one: the time this launch waits
     *  for its slot or memory is excused from it, so a busy box never spends a
     *  fetch's time. Read it inside `fn` — what is left once the launch is admitted. */
    readonly deadline?: WaitExcusedDeadline
  } & FfmpegLaunchOptions,
): Promise<T> {
  return holdSlot(fn, {
    limitMs: opts.timeoutMs, signal: opts.signal, label: opts.label ?? "a slot-gated step", peakMemoryMiB: opts.peakMemoryMiB,
    deadline: opts.deadline,
  })
}

/**
 * How much of ffmpeg's output a failure message carries.
 *
 * WHY A TAIL, AND WHY THIS SMALL. ffmpeg opens EVERY run with a ~2-4 KB banner
 * (`ffmpeg version …`, `built with …`, `configuration: --prefix=… (60 flags)`,
 * a `lib*` line per library) and writes the actual error LAST. `markJobFailed`
 * stores `error_message.slice(0, 500)` (lib/job-failure.ts), so a message built
 * head-first stores the banner and drops the cause — every ffmpeg failure in
 * `/admin/app-reports` reads "ffmpeg version n8.1.2 … configuration: --prefix"
 * and nothing else (prod report 2026-09-06, a voice-changer-pro remux: the
 * stderr that would have named the broken step never left the worker).
 * `runFfmpegWithProgress` already keeps only a tail for the same reason.
 *
 * The budget is deliberately under that 500-char cut so the cause SURVIVES it.
 */
const FFMPEG_ERROR_TAIL_CHARS = 420

/**
 * A codec library's own error line (`x265 [error]: frameNumThreads … must be
 * [0 .. X265_MAX_FRAME_THREADS)`). The library names the cause and ffmpeg's
 * own last lines only the consequence ("Terminating thread with return code
 * -22", "Conversion failed!"), which then fill the tail: a trend crop failed
 * on staging with the cause cut (2026-10-27).
 */
const LIBRARY_ERROR_LINE = /\[error\]/i

/**
 * Last non-empty lines of ffmpeg output, newest-last, within the budget — led
 * by the last library error line when the tail does not already hold it (that
 * line given at most half the budget).
 */
function ffmpegOutputTail(text: string, maxChars = FFMPEG_ERROR_TAIL_CHARS): string {
  const lines = text.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim().length > 0)
  const tail = lastLines(lines, maxChars)
  let at = lines.length - 1
  while (at >= 0 && !LIBRARY_ERROR_LINE.test(lines[at]!)) at--
  const cause = lines[at]
  if (!cause || tail.includes(cause)) return tail
  const lead = cause.length > maxChars / 2 ? `${cause.slice(0, Math.floor(maxChars / 2))}…` : cause
  const after = lines.slice(at + 1)
  return [lead, lastLines(after, maxChars - lead.length - 1)].filter(Boolean).join("\n")
}

/** The last `lines`, newest-last, within `maxChars` (one over-long line tail-cut rather than dropped). */
function lastLines(lines: readonly string[], maxChars: number): string {
  const kept: string[] = []
  let budget = maxChars
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!
    // Always keep something: a single over-long line is tail-cut rather than
    // dropped (an ffmpeg filter-graph error is often one very long line).
    if (kept.length === 0) {
      kept.unshift(line.length > maxChars ? `…${line.slice(-maxChars)}` : line)
      budget -= Math.min(line.length, maxChars) + 1
      continue
    }
    if (line.length + 1 > budget) break
    kept.unshift(line)
    budget -= line.length + 1
  }
  return kept.join("\n")
}

/**
 * The message every ffmpeg failure throws: the "ffmpeg failed:" prefix other
 * layers key off (`lib/mcp/tools/_job-error.ts` uses it to keep keyword
 * classification away from raw ffmpeg diagnostics) plus the TAIL of whatever
 * ffmpeg said. `fallback` is the spawn error's own message, used when ffmpeg
 * wrote no stderr at all — it too is tailed, because Node's execFile message is
 * `Command failed: ffmpeg -y -i … <every argument>` and would otherwise eat the
 * whole budget with the command line.
 */
export function ffmpegFailureMessage(stderr: string | undefined, fallback: string): string {
  const tail = ffmpegOutputTail(stderr ?? "") || ffmpegOutputTail(fallback) || "no output"
  return `ffmpeg failed: ${tail}`
}

/**
 * `killed`: Node's execFile killed the child (the `timeout` watchdog or a
 * maxBuffer overflow — ffmpeg traps the SIGTERM and exits 255, so `signal` is
 * null and `killed` is the only reliable marker). `timedOut`: killed by the
 * watchdog specifically. Attached to every ffmpeg / ffprobe failure so a
 * caller can classify without parsing text (Video Overlay: a timeout is
 * "Render exceeded the 10-minute limit"; a probe timeout stays retryable).
 */
function execFailureFlags(error: ExecFileException): { killed: boolean; timedOut: boolean; notStarted?: true; aborted?: true; truncated?: true; signalledFromOutside?: true } {
  const killed = error.killed === true
  return {
    // Ended by a signal this process did not send (the kernel's out-of-memory
    // killer's SIGKILL, an operator): the box's failure, not the input's.
    ...(!killed && typeof error.signal === "string" && error.signal.length > 0 ? { signalledFromOutside: true as const } : {}),
    killed,
    timedOut: killed && error.code !== "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
    // The process never started (ENOENT, EAGAIN, EMFILE…: the spawn's own error): the server's failure, not the input's.
    ...(typeof error.syscall === "string" && error.syscall.startsWith("spawn") ? { notStarted: true as const } : {}),
    // Stopped by its caller's signal.
    ...(error.name === "AbortError" ? { aborted: true as const } : {}),
    // Its output outgrew the capture buffer and was cut short (Node may not set `killed` for it):
    // a caller that parses the captured log must not read it as whole.
    ...(error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" ? { truncated: true as const } : {}),
  }
}

/** The box's passing shortage, from a failed launch's full stderr or its spawn error (never a stopped launch). */
function shortageMark(error: ExecFileException, stderr: string | undefined): { resourceShortage?: true } {
  if (error.killed === true || error.name === "AbortError") return {}
  return stderrShowsShortage(stderr) || spawnShowsShortage(error) ? { resourceShortage: true } : {}
}

/**
 * Run ffmpeg to completion under its kill budget. With `stallWatch`, the launch
 * is also stopped once it shows no progress — frozen stats AND an idle CPU —
 * for the stall window (`ffmpeg-stall-watchdog.ts`), and rejects with
 * `isFfmpegStall(err)` true so the caller can relaunch it. The render chunks
 * pass it (`edl-timeline.ts` `runSlice`); every other caller is unchanged.
 */
export async function runFfmpeg(
  args: readonly string[],
  timeoutMs?: number,
  launch?: FfmpegLaunchOptions,
  stallWatch?: FfmpegStallWatch,
): Promise<string> {
  // A launch that failed for the box's passing shortage runs again, its slot released while it waits.
  return retryOnShortage((limitMs) => holdSlot(() => new Promise<string>((resolve, reject) => {
    // Declared first: the callback may run before execFile returns.
    let stopEscalation = () => {}
    let stopWatch = () => {}
    let stalledAfterMs: number | undefined
    const startedAt = Date.now()
    const child = execFileFfmpeg(args, {
      maxBuffer: 10 * 1024 * 1024,
      timeout: limitMs,
      ...(launch?.env ? { env: launch.env } : {}),
      ...(launch?.stopOnAbort && launch.signal ? { signal: launch.signal } : {}),
    }, (error, stdout, stderr) => {
      stopEscalation()
      stopWatch()
      if (stalledAfterMs !== undefined) {
        reject(ffmpegStallError(stalledAfterMs, stallWatch?.stallMs))
      } else if (error) {
        reject(Object.assign(new Error(ffmpegFailureMessage(stderr, error.message)), execFailureFlags(error), shortageMark(error, stderr)))
      } else {
        resolve(stdout)
      }
    })
    stopEscalation = escalateKill(child, limitMs)
    if (stallWatch) {
      stopWatch = watchForStall(child, stallWatch, () => {
        // Already exited (its close not yet delivered): its own result stands.
        if (child.exitCode !== null || child.signalCode !== null) return
        // Marked before the kill so the callback reports a stall, not a crash.
        stalledAfterMs = Date.now() - startedAt
        // SIGKILL: a deadlocked main loop never services a SIGTERM.
        child.kill("SIGKILL")
      })
    }
  }), { limitMs, label: "ffmpeg", peakMemoryMiB: launch?.peakMemoryMiB, ...(launch?.signal ? { signal: launch.signal } : {}) }),
  { limitMs: ffmpegLimitMs(timeoutMs), label: "ffmpeg", ...(launch?.signal ? { signal: launch.signal } : {}) })
}

/**
 * Same as runFfmpeg, but returns BOTH stdout and stderr — needed for filters
 * like `silencedetect` that write their markers to stderr (FFmpeg filter info
 * messages always land on stderr; stdout stays empty unless `-progress -` is
 * set). The FIFO semaphore + timeout are shared with `runFfmpeg`.
 */
export async function runFfmpegCapture(
  args: readonly string[],
  timeoutMs?: number,
  launch?: FfmpegLaunchOptions,
): Promise<{ stdout: string; stderr: string }> {
  return retryOnShortage((limitMs) => holdSlot(() => new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      // Declared first: the callback may run before execFile returns.
      let stopEscalation = () => {}
      const child = execFileFfmpeg(args, {
        maxBuffer: 10 * 1024 * 1024,
        timeout: limitMs,
        ...(launch?.env ? { env: launch.env } : {}),
      }, (error, stdout, stderr) => {
        stopEscalation()
        if (error) {
          // Some filters (e.g. `-f null -`) exit non-zero after writing useful
          // stderr; let the caller decide whether to parse anyway — so the FULL
          // stderr stays on the error object even though the message carries
          // only its tail. Flagged like `runFfmpeg`'s rejection, so a launch
          // that was stopped (`killed`, `timedOut`) is told apart from ffmpeg
          // refusing its input.
          reject(
            Object.assign(new Error(ffmpegFailureMessage(stderr, error.message)), {
              stdout,
              stderr,
              ...execFailureFlags(error),
              ...shortageMark(error, stderr),
            }),
          )
        } else {
          resolve({ stdout, stderr })
        }
      })
      stopEscalation = escalateKill(child, limitMs)
  }), { limitMs, label: "ffmpeg", peakMemoryMiB: launch?.peakMemoryMiB }), { limitMs: ffmpegLimitMs(timeoutMs), label: "ffmpeg" })
}

/**
 * Same contract (FIFO semaphore + hard timeout) as `runFfmpeg`, but streams
 * per-frame progress while encoding: spawns ffmpeg with `-progress pipe:1`
 * and calls `onFrame(n)` for every `frame=N` line it emits on stdout.
 *
 * Used by renders whose total frame count is known up front (still-to-video
 * computes `frames = ceil(audioDuration * fps)` for zoompan anyway), so the
 * caller can surface REAL percent progress instead of coarse milestones.
 *
 * Unlike `runFfmpeg`, this uses `spawn` — execFile's built-in `timeout`
 * option doesn't exist there, so the watchdog kill is explicit (mirrors
 * youtube-video.ts): a hung ffmpeg must not hold its semaphore slot past
 * the ceiling and starve the FIFO queue.
 */
export async function runFfmpegWithProgress(
  args: readonly string[],
  onFrame?: (frame: number) => void,
  timeoutMs?: number,
  launch?: FfmpegLaunchOptions,
): Promise<void> {
  return retryOnShortage((limitMs) => holdSlot(() => new Promise<void>((resolve, reject) => {
      const proc = spawnFfmpeg(["-progress", "pipe:1", "-nostats", ...args], {
        stdio: ["ignore", "pipe", "pipe"],
      })

      let timedOut = false
      const watchdog = setTimeout(() => {
        timedOut = true
        proc.kill("SIGKILL")
      }, limitMs)

      // Keep only the stderr tail — that's where ffmpeg writes its real error.
      // (8 KB here, then `ffmpegFailureMessage` narrows it to the last lines.)
      let stderrTail = ""
      proc.stderr.on("data", (chunk: Buffer) => {
        stderrTail = (stderrTail + chunk.toString()).slice(-8192)
      })

      let lineBuf = ""
      proc.stdout.on("data", (chunk: Buffer) => {
        lineBuf += chunk.toString()
        const lines = lineBuf.split("\n")
        lineBuf = lines.pop() ?? ""
        for (const line of lines) {
          const m = /^frame=(\d+)/.exec(line.trim())
          if (m && onFrame) onFrame(parseInt(m[1]!, 10))
        }
      })

      proc.on("error", (err) => {
        clearTimeout(watchdog)
        reject(Object.assign(new Error(`ffmpeg failed to spawn: ${err.message}`), spawnShowsShortage(err as NodeJS.ErrnoException) ? { resourceShortage: true as const } : {}))
      })
      proc.on("close", (code) => {
        clearTimeout(watchdog)
        if (timedOut) {
          reject(new Error(`ffmpeg timed out after ${limitMs}ms`))
        } else if (code === 0) {
          resolve()
        } else {
          reject(Object.assign(new Error(ffmpegFailureMessage(stderrTail, `exit code ${code}`)), stderrShowsShortage(stderrTail) ? { resourceShortage: true as const } : {}))
        }
      })
  }), { limitMs, label: "ffmpeg", peakMemoryMiB: launch?.peakMemoryMiB }), { limitMs: ffmpegLimitMs(timeoutMs), label: "ffmpeg" })
}

/**
 * Log the installed ffmpeg version — one line, called once per process at
 * boot (API server + video worker). Rendered output is ffmpeg-version-
 * dependent (see the FFMPEG_VERSION pin in the Dockerfile), so when
 * production output changes, the logs must be able to answer "which
 * ffmpeg?". Non-fatal: a missing binary logs a loud error line here and
 * fails the first render anyway — boot must not die over logging.
 */
/**
 * Whether an ffmpeg run actually WROTE its output file (exists + non-empty).
 * ffmpeg exits 0 even when a seek lands past the last frame and ZERO frames
 * reach the encoder ("Output file is empty, nothing was encoded" is a warning,
 * not an error) — so a "successful" run must be verified before the output is
 * consumed, or the caller ENOENTs later on a file that was never written.
 */
export async function wroteOutputFile(filePath: string): Promise<boolean> {
  try {
    return (await fs.stat(filePath)).size > 0
  } catch {
    return false
  }
}

let ffmpegVersionPromise: Promise<string> | undefined
/** The installed ffmpeg's first `-version` line (e.g. `ffmpeg version n8.1.2-…`),
 *  resolved once per process. Rendered output is ffmpeg-build-dependent, so
 *  render caches key on it. A failed probe is NOT memoized and resolves to
 *  "unknown" — a cache then misses (safe), it never matches wrongly. */
export function ffmpegVersionLine(): Promise<string> {
  ffmpegVersionPromise ??= runFfmpeg(["-version"]).then(
    (out) => out.split("\n", 1)[0].trim() || "unknown",
    () => {
      ffmpegVersionPromise = undefined
      return "unknown"
    },
  )
  return ffmpegVersionPromise
}

export function logFfmpegVersion(tag: string): void {
  execFileFfmpeg(["-version"], { timeout: 10_000 }, (error, stdout) => {
    if (error) {
      console.error(`[${tag}] ffmpeg -version failed (is ffmpeg installed?): ${error.message}`)
    } else {
      console.log(`[${tag}] ${stdout.split("\n", 1)[0]}`)
    }
  })
  // The budget every launch reserves from, so the logs can answer "how much
  // did this box let ffmpeg use?" when a render waits or a box runs short.
  console.log(`[${tag}] ${describeFfmpegMemoryBudget(ffmpegMemoryBudgetNow())}`)
}

// A raw ffprobe run is never handed a link outside the guard: every run below checks with
// `unguardedProbeLinkRefusal` (probe-guard.ts) before ffprobe starts.

export function runFfprobe(
  args: readonly string[],
  opts: {
    readonly timeoutMs?: number
    readonly signal?: AbortSignal
    /** The child's environment: a guarded network probe's (`readProbeSource`, which points ffprobe at the probe guard's proxy). */
    readonly env?: NodeJS.ProcessEnv
  } = {},
): Promise<string> {
  const refused = unguardedProbeLinkRefusal(args, opts.env)
  if (refused) return Promise.reject(refused)
  return new Promise((resolve, reject) => {
    // Watchdog: ffprobe accepts remote http(s) inputs (probeVideoSource) and
    // a stalled edge/socket would otherwise hang the worker indefinitely —
    // there is no BullMQ-side rescue for a live-but-stuck handler. 120s
    // matches the safeFetch download timeout. A caller on a tighter budget
    // (`opts.timeoutMs`, never above it) has the process killed sooner, and
    // `signal` kills it at once (a caller whose time is up, e.g. the
    // outside-input copy's check, or a request whose client went away).
    const timeout = Math.min(FFPROBE_TIMEOUT_MS, opts.timeoutMs ?? FFPROBE_TIMEOUT_MS)
    execFile("ffprobe", args as string[], { maxBuffer: 5 * 1024 * 1024, timeout, ...(opts.signal ? { signal: opts.signal } : {}), ...(opts.env ? { env: opts.env } : {}) }, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(new Error(`ffprobe failed: ${stderr || error.message}`), execFailureFlags(error)))
      } else {
        resolve(stdout)
      }
    })
  })
}

/**
 * Same as `runFfprobe`, but resolves BOTH stdout and stderr — for a caller
 * that reads ffprobe's warnings (e.g. "Estimating duration from bitrate").
 * Same watchdog, same rejection (`killed` / `timedOut` flags).
 */
export function runFfprobeCapture(args: readonly string[], opts?: { timeoutMs?: number }): Promise<{ stdout: string; stderr: string }> {
  const refused = unguardedProbeLinkRefusal(args, undefined)
  if (refused) return Promise.reject(refused)
  return new Promise((resolve, reject) => {
    const timeout = Math.min(FFPROBE_TIMEOUT_MS, opts?.timeoutMs ?? FFPROBE_TIMEOUT_MS)
    execFile("ffprobe", args as string[], { maxBuffer: 5 * 1024 * 1024, timeout }, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(new Error(`ffprobe failed: ${stderr || error.message}`), execFailureFlags(error)))
      } else {
        resolve({ stdout, stderr })
      }
    })
  })
}

/**
 * Returns true if the media file has at least one audio stream. Used by the
 * voice-changer video path to fail early (with a friendly message) when the
 * source clip is silent — most i2v/t2v models output video with no audio
 * track, and ElevenLabs speech-to-speech has nothing to transform. Probes a
 * LOCAL file only (no network), so no SSRF guard is needed.
 */
export async function hasAudioStream(filePath: string): Promise<boolean> {
  const output = await runFfprobe([
    "-v", "error",
    "-select_streams", "a:0",
    "-show_entries", "stream=codec_type",
    "-of", "default=noprint_wrappers=1:nokey=1",
    filePath,
  ])
  return output.trim().length > 0
}

/**
 * The sample rate of a local media file's FIRST audio stream — the stream a
 * filter graph's `[i:a]` binds — in Hz; undefined when the file has no audio
 * stream or ffprobe reports no positive integer rate. Local paths only (no
 * network, no SSRF surface).
 */
export async function probeAudioSampleRate(filePath: string): Promise<number | undefined> {
  const output = await runFfprobe([
    "-v", "error",
    "-select_streams", "a:0",
    "-show_entries", "stream=sample_rate",
    "-of", "default=noprint_wrappers=1:nokey=1",
    filePath,
  ])
  const rate = Number(output.trim().split("\n")[0])
  return Number.isInteger(rate) && rate > 0 ? rate : undefined
}

/**
 * Probe the frame rate of a local video file. Falls back to
 * `UNREADABLE_CLIP_FPS` (30, @nodaro/render-rules: what Combine Videos' charge
 * reads such a clip at) if the probe fails or returns something
 * unparseable — a missing fps shouldn't abort a frame-count-based trim.
 */
export async function getVideoFps(filePath: string): Promise<number> {
  try {
    const out = await runFfprobe([
      "-v", "error", "-select_streams", "v:0",
      "-show_entries", "stream=r_frame_rate", "-of", "csv=p=0", filePath,
    ])
    return parseFrameRate(csvFields(out)[0] ?? "") ?? UNREADABLE_CLIP_FPS
  } catch {
    return UNREADABLE_CLIP_FPS
  }
}

/**
 * The frame count of a LOCAL file's first video stream: the container's own
 * (`nb_frames`, which an MP4 records), else counted by DECODING the stream
 * (`-count_frames` → `nb_read_frames`: a MOV or WebM need not record one).
 * Exact, never duration × rate (which can be a frame or two off); throws when
 * neither says. Local paths only (no network, no SSRF surface): what a
 * frame-aligned cut (a trend's preview clip and its mask) is measured by.
 */
export async function probeVideoFrameCount(filePath: string): Promise<number> {
  const read = async (args: readonly string[]): Promise<number> => {
    const out = await runFfprobe(["-v", "error", "-select_streams", "v:0", ...args, "-of", "csv=p=0", filePath])
    const text = csvFields(out)[0] ?? ""
    return /^\d+$/.test(text) ? Number(text) : Number.NaN
  }
  let frames = await read(["-show_entries", "stream=nb_frames"])
  if (!(frames > 0)) frames = await read(["-count_frames", "-show_entries", "stream=nb_read_frames"])
  if (!(frames > 0)) throw new Error(`Could not count the video frames of: ${filePath}`)
  return frames
}

export async function getVideoDuration(filePath: string): Promise<number> {
  const output = await runFfprobe([
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "csv=p=0",
    filePath,
  ])
  const duration = parseFloat(output.trim())
  if (Number.isNaN(duration) || duration <= 0) {
    throw new Error(`Could not determine duration for: ${filePath}`)
  }
  return duration
}

/**
 * Duration of the VIDEO STREAM (seconds) — NOT the container. AI-generated
 * clips routinely carry an audio track 40-90ms longer than the video, so the
 * container/format duration (getVideoDuration) overshoots the last video
 * frame. Anything computing FRAME positions (frame trims, concat boundaries,
 * xfade offsets) must use this instead: cutting at `formatDuration - N/fps`
 * lands past the video's end and silently under-trims by the overhang
 * (~1-2 frames). Falls back to the format duration when the stream doesn't
 * report one (rare containers).
 */
export async function getVideoStreamDuration(filePath: string): Promise<number> {
  const output = await runFfprobe([
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=duration",
    "-of", "csv=p=0",
    filePath,
  ])
  const duration = parseFloat(output.trim())
  if (Number.isNaN(duration) || duration <= 0) {
    return getVideoDuration(filePath)
  }
  return duration
}

/**
 * `runFfprobe` for a caller that may hand it a link among its arguments (the
 * private plugin's toolkit): the link is read through the probe guard
 * (`readProbeSource`: the first-hop check, the proxy, the container rule and
 * the own-storage fallback), with the guard's input options placed right
 * before it. A caller may not set any of those options itself (refused:
 * ffprobe keeps an option's last value wherever it sits, so placing ours
 * alone would not hold). One link at most; without one this is `runFfprobe`.
 */
export async function runFfprobeReadingLinks(args: readonly string[]): Promise<string> {
  const links = args.filter((a) => isNetworkProbeSource(a))
  if (links.length > 1) throw new Error("runFfprobeReadingLinks: one link per run")
  // ffprobe keeps the LAST value of an option wherever it sits, so a caller's own could widen the guard's: refused
  // (also read from a file, `-/protocol_whitelist <file>`).
  const own = links.length > 0 ? args.find((a) => isProbeGuardOption(a)) : undefined
  if (own) throw new Error(`runFfprobeReadingLinks: a run that reads a link cannot set the probe guard's own options (${own})`)
  // A plugin run's other rules (plugin-run-guard.ts): option files read once and handed over as that copy, no
  // widened whitelist, no argument through another protocol, a local list and a lavfi graph's files checked.
  const prepared = await preparePluginRun(args, "ffprobe", { readsLink: args.some((a) => namesALink(a)) })
  try {
    const run = prepared.argv
    const link = links[0]
    if (link === undefined) return await runFfprobe(run)
    return await readProbeSource(link, (input, probe) => probe.run(run.flatMap((a) => (a === link ? [...probe.inputArgs, input] : [a]))))
  } finally {
    await prepared.cleanup()
  }
}

/**
 * {@link getVideoStreamDuration} of a source that may be a LINK (a provider's
 * result, a stored clip): the same two readings, the video stream's length
 * and else the container's, read through the probe guard (`readProbeSource`).
 */
export async function probeVideoStreamDurationSource(src: string): Promise<number> {
  return readProbeSource(src, async (input, probe) => {
    const read = async (entries: readonly string[]) => parseFloat((await probe.run(["-v", "error", ...probe.inputArgs, ...entries, "-of", "csv=p=0", input])).trim())
    const stream = await read(["-select_streams", "v:0", "-show_entries", "stream=duration"])
    if (Number.isFinite(stream) && stream > 0) return stream
    const container = await read(["-show_entries", "format=duration"])
    if (!(Number.isFinite(container) && container > 0)) throw new Error(`Could not determine duration for: ${src}`)
    return container
  })
}

// The probe's link guard (the first hop) and its typed refusal live in
// `probe-guard.ts`, beside the proxy every guarded run reads through;
// re-exported so every existing `ffmpeg-utils.js` import keeps working.
export { assertSafeProbeSource, ProbeSourceBlockedError }
export type { ProbeSourceBlockReason }

export { OWN_STORAGE_PROBE_MAX_BYTES }

/** What a probe of one source runs ffprobe with (`readProbeSource`). */
export interface GuardedProbe {
  /** The input options to place before the source: the protocol whitelist (and, for a link, the redirect limit). */
  readonly inputArgs: readonly string[]
  /** Run ffprobe under the guard: a link's run reads through the probe guard's proxy. */
  run(args: readonly string[], opts?: { readonly timeoutMs?: number; readonly signal?: AbortSignal }): Promise<string>
  /** The child environment a streamed scan (`scanPacketEnds`) spawns ffprobe with; undefined for a local file. */
  readonly env?: NodeJS.ProcessEnv
}

/** How a guarded probe's own-storage fallback downloads (`readProbeSource`). */
export interface ProbeSourceOptions {
  /** The download's bound (default `DOWNLOAD_TIMEOUT_MS`, never above it). */
  readonly downloadTimeoutMs?: number
  /** Stops the download (a request whose client went away, a caller whose time is up). */
  readonly signal?: AbortSignal
  /** The caller already passed `src` through `assertSafeProbeSource` and it was allowed (one DNS lookup, not two). */
  readonly sourceChecked?: boolean
  /**
   * `src` is a local copy of a user's file (the own-storage fallback's
   * download): read with the container rule a link gets (`storedCopyProbeArgs`).
   */
  readonly userFile?: boolean
}

const localProbe: GuardedProbe = {
  inputArgs: probeInputArgs("/local"),
  run: (args, opts = {}) => runFfprobe(args, opts),
}

/** A local copy of a user's file: `file` only, and the container rule a link gets (a playlist fails as its typed refusal). */
const storedCopyProbe: GuardedProbe = {
  inputArgs: storedCopyProbeArgs(),
  run: (args, opts = {}) => runFfprobe(args, opts).catch((err: unknown) => {
    throw containerRefusalOf(err) ?? err
  }),
}

/**
 * Read a probe source the one guarded way (`probe-guard.ts`): every ffprobe
 * that may read a link someone gave us goes through here.
 *
 * - A local path is read with only the `file` protocol.
 * - A link passes the link guard (`assertSafeProbeSource`) first — unless the
 *   caller already did (`sourceChecked`) — and ffprobe then reads it through
 *   the guard's proxy, which checks every connection it makes (redirects,
 *   range requests, the links a playlist names); a refused hop throws the
 *   first hop's `ProbeSourceBlockedError`. A link is read only as an ordinary
 *   media file (`REMOTE_PROBE_FORMATS`): a playlist or a manifest fails as a
 *   refusal with reason `container`.
 * - Only when the guard refuses the link's ADDRESS (reason `address`) and the
 *   link is strictly a file of this install's own storage (`isOwnStoredFileUrl`:
 *   a self-host's storage on a loopback or private address) is the file
 *   downloaded instead — at most {@link OWN_STORAGE_PROBE_MAX_BYTES}, within
 *   `downloadTimeoutMs`, through `downloadFile`'s own-storage exemption (no
 *   redirect) — and read on disk ({@link readOwnStoredCopy}). A link the guard
 *   allows is never downloaded to be probed: on Cloud, storage is public.
 */
export async function readProbeSource<T>(
  src: string,
  read: (input: string, probe: GuardedProbe) => Promise<T>,
  opts: ProbeSourceOptions = {},
): Promise<T> {
  if (!isNetworkProbeSource(src)) return read(src, opts.userFile ? storedCopyProbe : localProbe)
  if (!opts.sourceChecked) {
    try {
      await assertSafeProbeSource(src)
    } catch (err) {
      if (err instanceof ProbeSourceBlockedError && err.reason === "address" && isOwnStoredFileUrl(src)) {
        return readOwnStoredCopy(src, (local) => read(local, storedCopyProbe), opts)
      }
      throw err
    }
  }
  const inputArgs = probeInputArgs(src)
  return withProbeEgress((egress) => read(src, {
    inputArgs,
    env: egress.env,
    // A link that is not an ordinary media file (a playlist, a manifest) fails as its typed refusal.
    run: (args, runOpts = {}) => runFfprobe(args, { ...runOpts, env: egress.env }).catch((err: unknown) => {
      throw containerRefusalOf(err) ?? err
    }),
  }))
}

/**
 * The own-storage fallback of {@link readProbeSource}, for a caller that runs
 * the link guard itself (`video-utility-length.ts`, under a route's deadline):
 * download `url` — strictly a file of this install's own storage, checked here
 * again — at most {@link OWN_STORAGE_PROBE_MAX_BYTES} within `downloadTimeoutMs`
 * (default `DOWNLOAD_TIMEOUT_MS`), then `read` the local copy, removed after.
 */
export async function readOwnStoredCopy<T>(
  url: string,
  read: (localPath: string) => Promise<T>,
  opts: Pick<ProbeSourceOptions, "downloadTimeoutMs" | "signal"> = {},
): Promise<T> {
  if (!isOwnStoredFileUrl(url)) {
    throw new ProbeSourceBlockedError("address", "probeVideoSource: blocked — only a file of this install's own storage is read from it")
  }
  const timeoutMs = Math.min(DOWNLOAD_TIMEOUT_MS, opts.downloadTimeoutMs ?? DOWNLOAD_TIMEOUT_MS)
  if (!(timeoutMs > 0)) throw Object.assign(new Error(`Download timeout: no time left to read ${url}`), { name: "TimeoutError" })
  const dir = await createWorkDir("probe-own-storage")
  try {
    const local = join(dir, "input")
    await downloadFile(url, local, { maxBytes: OWN_STORAGE_PROBE_MAX_BYTES, timeoutMs, ...(opts.signal ? { signal: opts.signal } : {}) })
    return await read(local)
  } finally {
    await cleanupWorkDir(dir)
  }
}

/**
 * What Video Overlay knows about its base after ONE local ffprobe call
 * (`probeVideoOverlayBase`). `width` / `height` are the DISPLAY size — the
 * stored size with the axes swapped for a 90°/270° rotation tag, which is what
 * the ffmpeg CLI's autorotate hands `[0:v]` and what a browser's
 * videoWidth/videoHeight report. `sar` is in the same (display) orientation;
 * 1 when absent. Durations are the VIDEO stream's (AAC priming inflates the
 * container's). The frame rates are the raw ffprobe rationals.
 */
export interface VideoOverlayBaseProbe {
  readonly width: number
  readonly height: number
  /** Display-matrix rotation, degrees normalised to 0..359. */
  readonly rotation: number
  readonly sar: number
  /** `sar` exactly, as the fraction `num/den` (a `setsar` value), in the same orientation; absent when it is 1. */
  readonly sarRatio?: string
  readonly rFrameRate?: string
  readonly avgFrameRate?: string
  /** The video stream's length, else the container's: what the render reads. */
  readonly streamDurationSec: number
  readonly startTimeSec: number
  /**
   * The picture's own length as the header states it, for the charge
   * (`videoOverlayChargedSec`): the video stream's (`stream=duration`), and its
   * `DURATION` tag (a WebM / MKV states only that). With neither, the charge
   * scans the stream's packets (`videoStreamIndex`), then falls back to the
   * container's (`containerSec`).
   */
  readonly videoStreamSec?: number
  readonly videoTagSec?: number
  /** The video stream's index, for a packet scan of it. */
  readonly videoStreamIndex?: number
  /** The container's length (`format=duration`), when it states one. */
  readonly containerSec?: number
  /** The file's start time (`format=start_time`), taken off a packet end. */
  readonly formatStartTimeSec?: number
  /** The container's frame count (`nb_frames`), when it states one. */
  readonly frameCount?: number
  /** codec_name of the FIRST audio stream; null when the base is silent. */
  readonly audioCodec: string | null
  /** start_time of that first audio stream, when it states one. With `startTimeSec`: the file's picture/sound offset, which a Video Overlay video layer keeps. */
  readonly audioStartTimeSec?: number
}

/**
 * The ONE ffprobe call Video Overlay makes on its downloaded base (spec §4.2
 * step 3). No `-select_streams` (v:0 and a:0 cannot be selected in one call):
 * the first real video stream and the first audio stream are picked here.
 * An embedded cover picture (`disposition.attached_pic`) is not a video — an
 * MP3 with album art must fail as "not a video", not render one frame.
 */
const VIDEO_OVERLAY_PROBE_ENTRIES =
  "stream=index,codec_type,codec_name,width,height,sample_aspect_ratio,r_frame_rate,avg_frame_rate,duration,start_time,nb_frames" +
  ":stream_side_data=rotation:stream_disposition=attached_pic:stream_tags=rotate,DURATION:format=duration,start_time"

/** ffprobe's `num:den` sample aspect as its two terms; undefined when absent or unusable ("0:1", "N/A"). */
function sampleAspectTerms(value: unknown): readonly [number, number] | undefined {
  if (typeof value !== "string") return undefined
  const [num, den] = value.split(":").map(Number)
  return num !== undefined && den !== undefined && Number.isFinite(num) && Number.isFinite(den) && num > 0 && den > 0 ? [num, den] : undefined
}

function parseSampleAspect(value: unknown): number {
  const terms = sampleAspectTerms(value)
  return terms ? terms[0] / terms[1] : 1
}

function parseRotation(stream: Record<string, unknown>): number {
  const side = Array.isArray(stream.side_data_list) ? (stream.side_data_list as Array<Record<string, unknown>>) : []
  const fromSide = side.map((s) => Number(s?.rotation)).find((r) => Number.isFinite(r))
  const tag = Number((stream.tags as Record<string, unknown> | undefined)?.rotate)
  const raw = fromSide ?? (Number.isFinite(tag) ? tag : 0)
  return ((Math.round(raw) % 360) + 360) % 360
}

/** Pure: ffprobe JSON → the display-oriented probe, or DeterministicJobError("The base input is not a video"). */
export function parseVideoOverlayProbe(json: string): VideoOverlayBaseProbe {
  const notVideo = () => new DeterministicJobError("The base input is not a video")
  let parsed: { streams?: unknown; format?: { duration?: unknown; start_time?: unknown } }
  try {
    parsed = JSON.parse(json) as typeof parsed
  } catch {
    throw notVideo()
  }
  const streams = Array.isArray(parsed.streams) ? (parsed.streams as Array<Record<string, unknown>>) : []
  const video = streams.find(
    (s) => s.codec_type === "video" && (s.disposition as { attached_pic?: unknown } | undefined)?.attached_pic !== 1,
  )
  const audio = streams.find((s) => s.codec_type === "audio")
  if (!video) throw notVideo()
  const storedW = Number(video.width)
  const storedH = Number(video.height)
  if (!Number.isInteger(storedW) || storedW <= 0 || !Number.isInteger(storedH) || storedH <= 0) throw notVideo()
  const streamDur = Number(video.duration)
  const formatDur = Number(parsed.format?.duration)
  const streamDurationSec = Number.isFinite(streamDur) && streamDur > 0 ? streamDur : Number.isFinite(formatDur) && formatDur > 0 ? formatDur : NaN
  const videoTagSec = parseMatroskaDurationTag((video.tags as Record<string, unknown> | undefined)?.DURATION)
  const videoIndex = Number(video.index)
  const formatStart = Number(parsed.format?.start_time)
  if (!Number.isFinite(streamDurationSec)) throw notVideo()
  const rotation = parseRotation(video)
  const swap = rotation === 90 || rotation === 270
  const sar = parseSampleAspect(video.sample_aspect_ratio)
  const terms = sampleAspectTerms(video.sample_aspect_ratio)
  const start = Number(video.start_time)
  const frames = Number(video.nb_frames)
  // `Number(undefined)` / `Number("N/A")` are NaN: no stated start, no field.
  const audioStart = audio ? Number(audio.start_time) : Number.NaN
  return {
    width: swap ? storedH : storedW,
    height: swap ? storedW : storedH,
    rotation,
    // The ffmpeg CLI's autorotate transposes the frame AND inverts its SAR.
    sar: swap ? 1 / sar : sar,
    ...(terms && terms[0] !== terms[1] ? { sarRatio: swap ? `${terms[1]}/${terms[0]}` : `${terms[0]}/${terms[1]}` } : {}),
    ...(typeof video.r_frame_rate === "string" ? { rFrameRate: video.r_frame_rate } : {}),
    ...(typeof video.avg_frame_rate === "string" ? { avgFrameRate: video.avg_frame_rate } : {}),
    streamDurationSec,
    startTimeSec: Number.isFinite(start) ? start : 0,
    ...(Number.isFinite(streamDur) && streamDur > 0 ? { videoStreamSec: streamDur } : {}),
    ...(videoTagSec !== undefined ? { videoTagSec } : {}),
    ...(Number.isInteger(videoIndex) && videoIndex >= 0 ? { videoStreamIndex: videoIndex } : {}),
    ...(Number.isFinite(formatDur) && formatDur > 0 ? { containerSec: formatDur } : {}),
    ...(Number.isFinite(formatStart) ? { formatStartTimeSec: formatStart } : {}),
    ...(Number.isInteger(frames) && frames > 0 ? { frameCount: frames } : {}),
    audioCodec: audio && typeof audio.codec_name === "string" ? audio.codec_name : null,
    ...(Number.isFinite(audioStart) ? { audioStartTimeSec: audioStart } : {}),
  }
}

/**
 * The same probe on the base's LINK, before anything is downloaded — what the
 * route and the workflow run price a run with a video layer by
 * (lib/video-overlay-length.ts), so they measure the very stream the worker's
 * {@link probeVideoOverlayBase} will (cover pictures skipped, the video
 * stream's length). Guarded like `probeVideoSource` (`readProbeSource`). Any
 * failure throws; the caller refuses the run before anything is reserved.
 */
export async function probeVideoOverlayBaseSource(srcUrlOrPath: string): Promise<VideoOverlayBaseProbe> {
  return readProbeSource(srcUrlOrPath, async (input, probe) => parseVideoOverlayProbe(await probe.run([
    "-v", "error",
    ...probe.inputArgs,
    "-show_entries", VIDEO_OVERLAY_PROBE_ENTRIES,
    "-of", "json",
    input,
  ])))
}

/**
 * Probe the LOCAL base file. ffprobe failing on it (HTML, a PNG or an MP3
 * saved as .mp4 …) is a deterministic refusal — fail once, refund; an
 * ffprobe TIMEOUT stays a plain, retryable error.
 */
export async function probeVideoOverlayBase(path: string): Promise<VideoOverlayBaseProbe> {
  let out: string
  try {
    out = await runFfprobe(["-v", "error", "-show_entries", VIDEO_OVERLAY_PROBE_ENTRIES, "-of", "json", path])
  } catch (err) {
    if ((err as { timedOut?: unknown }).timedOut === true) throw err
    throw new DeterministicJobError("The base input is not a video", { cause: err })
  }
  return parseVideoOverlayProbe(out)
}

/** A Matroska `DURATION` tag (`HH:MM:SS.fffffffff`, or plain seconds) in seconds; undefined when absent or unreadable. */
export function parseMatroskaDurationTag(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined
  const m = /^\s*(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)\s*$/.exec(value)
  const sec = m ? Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) : Number(value)
  return Number.isFinite(sec) && sec > 0 ? sec : undefined
}

/**
 * Probe a video URL for dimensions + duration (+ frame rate) in a single
 * ffprobe call. Accepts a local path OR a remote http(s) URL — ffprobe reads
 * both, a URL only through the probe guard (`readProbeSource`; `signal` also
 * stops its own-storage download on a self-host).
 *
 * `fps` is OPTIONAL on purpose: dimensions and duration are the contract (a
 * missing one throws), but a container that reports no usable frame rate — or a
 * VARIABLE one, which is no single rate at all (see `constantFrameRate`) — is
 * still a perfectly probeable video, and the caller falls back rather than fails.
 *
 * `durationSeconds` is the CONTAINER's (`format=duration`). `videoDurationSeconds`
 * is the first video stream's own (`stream=duration`), which is shorter when
 * the audio runs past the last frame; OPTIONAL, absent when the stream reports
 * none usable (some containers, e.g. a WebM, leave it out).
 */
export async function probeVideoSource(srcUrlOrPath: string, opts: { readonly signal?: AbortSignal } = {}): Promise<{
  width: number
  height: number
  durationSeconds: number
  fps?: number
  videoDurationSeconds?: number
  /** The first video stream's `DURATION` tag: the picture's length a Matroska / WebM file states (it states no `stream=duration`). */
  videoTagDurationSeconds?: number
  /** That stream's index, for a packet scan of it. */
  videoStreamIndex?: number
  /** The file's start time (`format=start_time`). */
  startTimeSeconds?: number
  /** The first video stream's sample aspect ratio (width of a pixel ÷ its height), when it states one other than 1:1. */
  sampleAspectRatio?: number
  /** The first video stream's display rotation (its side data, else its `rotate` tag), 0..359, when not 0: `width`/`height` stay the STORED size. */
  rotation?: number
}> {
  const output = await readProbeSource(srcUrlOrPath, (input, probe) => probe.run([
    "-v", "error",
    // Confine ffprobe to the source's transports (probeInputArgs) so a
    // malicious manifest can't pivot to other protocols.
    ...probe.inputArgs,
    "-select_streams", "v:0",
    "-show_entries", "stream=index,width,height,sample_aspect_ratio,avg_frame_rate,r_frame_rate,duration:stream_side_data=rotation:stream_tags=rotate,DURATION:format=duration,start_time",
    "-of", "json",
    input,
  ], opts), opts.signal ? { signal: opts.signal } : {})
  // CSV inserts extra fields for stream side data (including an empty field
  // on Remotion MP4s). Read named fields so metadata cannot shift dimensions.
  let metadata: {
    streams?: Array<{ index?: unknown; width?: unknown; height?: unknown; sample_aspect_ratio?: unknown; avg_frame_rate?: unknown; r_frame_rate?: unknown; duration?: unknown; tags?: { DURATION?: unknown; rotate?: unknown }; side_data_list?: unknown }>
    format?: { duration?: unknown; start_time?: unknown }
  }
  try {
    metadata = JSON.parse(output)
  } catch {
    throw new Error(`probeVideoSource failed to parse: "${output.trim()}"`)
  }
  const width = Number(metadata?.streams?.[0]?.width)
  const height = Number(metadata?.streams?.[0]?.height)
  const durationSeconds = Number(metadata?.format?.duration)
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0
    || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error(`probeVideoSource failed to parse: "${output.trim()}"`)
  }
  const fps = constantFrameRate(
    parseFrameRate(metadata?.streams?.[0]?.avg_frame_rate),
    parseFrameRate(metadata?.streams?.[0]?.r_frame_rate),
  )
  const streamDuration = metadata?.streams?.[0]?.duration
  const videoDurationSeconds = streamDuration === undefined || streamDuration === null ? Number.NaN : Number(streamDuration)
  const videoTagDurationSeconds = parseMatroskaDurationTag(metadata?.streams?.[0]?.tags?.DURATION)
  const videoStreamIndex = Number(metadata?.streams?.[0]?.index)
  const startTimeSeconds = Number(metadata?.format?.start_time)
  const sampleAspectRatio = parseSampleAspect(metadata?.streams?.[0]?.sample_aspect_ratio)
  const rotation = metadata?.streams?.[0] ? parseRotation(metadata.streams[0] as Record<string, unknown>) : 0
  return {
    width,
    height,
    durationSeconds,
    ...(fps !== undefined ? { fps } : {}),
    ...(Number.isFinite(videoDurationSeconds) && videoDurationSeconds > 0 ? { videoDurationSeconds } : {}),
    ...(videoTagDurationSeconds !== undefined ? { videoTagDurationSeconds } : {}),
    ...(Number.isInteger(videoStreamIndex) && videoStreamIndex >= 0 ? { videoStreamIndex } : {}),
    ...(Number.isFinite(startTimeSeconds) ? { startTimeSeconds } : {}),
    ...(sampleAspectRatio !== 1 ? { sampleAspectRatio } : {}),
    ...(rotation !== 0 ? { rotation } : {}),
  }
}

/**
 * Probe ONLY the container duration (seconds) of any media URL or path —
 * audio OR video. Unlike probeVideoSource, this does not require a video
 * stream, so it works on audio-only files (mp3/wav/m4a). Accepts a local path
 * OR a remote http(s) URL; a URL is read only through the probe guard
 * (`readProbeSource`). `timeoutMs` bounds the probe and, on a self-host, the
 * own-storage download before it.
 *
 * Used by the ai-avatar AUDIO-mode reserve preHandler to bucket the credit
 * hold by the ACTUAL clip length instead of a coarse worst-case ceiling.
 */
export async function probeMediaDuration(srcUrlOrPath: string, opts?: { timeoutMs?: number }): Promise<number> {
  const output = await readProbeSource(srcUrlOrPath, (input, probe) => probe.run([
    "-v", "error",
    ...probe.inputArgs,
    "-show_entries", "format=duration",
    "-of", "csv=p=0",
    input,
  ], opts), opts?.timeoutMs !== undefined ? { downloadTimeoutMs: opts.timeoutMs } : {})
  const duration = parseFloat(output.trim())
  if (Number.isNaN(duration) || duration <= 0) {
    throw new Error(`probeMediaDuration failed to parse: "${output.trim()}"`)
  }
  return duration
}

/**
 * Duration and byte size of a media file in ONE ffprobe call — for a provider
 * that limits both (Nemotron 3.5 Transcribe: 60 minutes, 200 MB). Same source
 * handling and SSRF guard as {@link probeMediaDuration}. Either field is
 * ABSENT when the file does not declare it — a duration a container leaves out
 * (a browser-recorded WebM written as a stream, a fragmented MP4), a size a
 * remote source does not send (no Content-Length) — rather than guessed; the
 * call throws only when ffprobe cannot read the source at all.
 */
export async function probeMediaDurationAndSize(
  srcUrlOrPath: string,
): Promise<{ durationSec?: number; sizeBytes?: number }> {
  const output = await readProbeSource(srcUrlOrPath, (input, probe) => probe.run([
    "-v", "error",
    ...probe.inputArgs,
    "-show_entries", "format=duration,size",
    "-of", "json",
    input,
  ]))
  const parsed = JSON.parse(output) as { format?: { duration?: string; size?: string } }
  const durationSec = parseFloat(parsed.format?.duration ?? "")
  const sizeBytes = Number(parsed.format?.size ?? "")
  return {
    ...(Number.isFinite(durationSec) && durationSec > 0 ? { durationSec } : {}),
    ...(Number.isFinite(sizeBytes) && sizeBytes > 0 ? { sizeBytes } : {}),
  }
}

/**
 * Container format and duration of a media file in ONE ffprobe call — what a
 * provider's reference-audio contract needs (`format_name` "mp3" for an
 * MP3-only lane, plus the clip length). Same source handling and SSRF guard as
 * {@link probeMediaDuration}. `formatNames` is ffprobe's comma list split
 * ("mov,mp4,m4a,3gp,3g2,mj2" for an M4A); a field ffprobe did not report is
 * absent rather than guessed.
 */
export async function probeMediaFormatAndDuration(
  srcUrlOrPath: string,
): Promise<{ formatNames?: string[]; durationSec?: number }> {
  const output = await readProbeSource(srcUrlOrPath, (input, probe) => probe.run([
    "-v", "error",
    ...probe.inputArgs,
    "-show_entries", "format=format_name,duration",
    "-of", "json",
    input,
  ]))
  const parsed = JSON.parse(output) as { format?: { format_name?: string; duration?: string } }
  const formatNames = (parsed.format?.format_name ?? "").split(",").map((n) => n.trim()).filter((n) => n.length > 0)
  const durationSec = parseFloat(parsed.format?.duration ?? "")
  return {
    ...(formatNames.length > 0 ? { formatNames } : {}),
    ...(Number.isFinite(durationSec) && durationSec > 0 ? { durationSec } : {}),
  }
}

/** One track of a source file, as the window check sees it. */
export type TrackEnd =
  /** The file carries no such track (cover art is not a picture track). */
  | { readonly state: "absent" }
  /** The track's real end, in seconds on the RENDER's clock. */
  | { readonly state: "measured"; readonly endSec: number }
  /** The track is there but its end could not be read (no timestamps, or the scan failed).
   *  `declaredEndSec` is set ONLY for a re-anchoring container (MPEG-TS/PS) whose
   *  timestamps run continuously (never back, never forward past the CLI's
   *  fold threshold — see `dtsContinuity`): its `format.duration` is then the span of
   *  every stream, which on the render's clock can only OVER-state a track's end
   *  — a coarse upper bound the window check may refuse against without ever
   *  refusing a correct edit. A TS/PS file whose timestamps jump BACK (two
   *  recordings joined, a stream reconnect, a restarted encoder) gets none:
   *  ffprobe's duration is then last-minus-first timestamp and UNDER-states the
   *  content the render plays straight through (a 20 s joined file declares
   *  10 s). A plain scan failure gets none either: there the declaration can
   *  UNDER-report too (a Xing-less VBR mp3 of 600 s declares 554 s). */
  | { readonly state: "unmeasured"; readonly reason: string; readonly declaredEndSec?: number }

/** The picture and sound tracks of one source file. */
export interface StreamEnds {
  readonly video: TrackEnd
  readonly audio: TrackEnd
}

/**
 * The REAL end of a local media file's picture and sound tracks, on the clock
 * the render's `trim` / `atrim` run on — measured from each track's own
 * packets (demux only, no decode), never from anything the container declares
 * and never as a single number for the whole file.
 *
 * Why not `format=duration` (`probeMediaDuration`): it is a declaration the
 * container can get wrong or leave out. An mp3 without a Xing/Info header (or
 * with a stale one — a re-cut or ad-stitched podcast file) is bitrate-
 * extrapolated and under-reports by seconds that GROW with the file (a 30 s
 * VBR encode declares 27.85 s; 600 s declares 554 s); a live-muxed WebM /
 * Matroska (a browser MediaRecorder recording) declares nothing (`N/A`).
 *
 * Why not one `-c copy -f null` pass: its `out_time` is the muxer's clock —
 * the last packet's DTS plus its duration, blended across streams. With
 * B-frames that trails the true (PTS) end by the reorder delay in frame
 * spacing — seconds on a 1 fps still-image encode; cover art mapped as video
 * made it N/A on ffmpeg 8.1; and one number cannot describe a file whose
 * picture and sound differ in length.
 *
 * How each track is read:
 *  - The stream is chosen by `parseStreamListing`: the first REAL video stream
 *    (never `attached_pic` cover art) and the first audio stream — the same
 *    streams the render binds (`[i:V]`, `[i:a]`).
 *  - Its end is max(pts + duration) over its packets, skipping packets the
 *    demuxer flags D (discard) — frames past a tail-trimming mp4/mov edit list
 *    the decoder drops, which `trim` can never reach. A stream with no pts on
 *    ANY packet (AVI) falls back to max(dts + duration).
 *  - The file's `format.start_time` is subtracted: without `-copyts` the
 *    ffmpeg CLI shifts every input by it before any filter sees a frame, so an
 *    offset MKV/MP4 or an mp4 with an initial empty edit would otherwise
 *    over-report by exactly that offset. A negative start (encoder priming) is
 *    handled the same way. EXCEPTION: MPEG-TS / program-stream containers
 *    re-anchor to the earliest MAPPED stream (which chunking changes), so
 *    `format.start_time` is not the render's zero for them — both tracks come
 *    back `unmeasured`. Their declared duration is attached as a coarse upper
 *    bound only when a packet scan of every mapped track shows its DTS running
 *    continuously; otherwise the window check is skipped for the source
 *    rather than made wrong.
 *
 * Cost is I/O only and scales with file size. Packet lines are STREAMED (a
 * two-hour track is several MB of csv — past `runFfprobe`'s buffer). Local
 * paths only (no network, no SSRF surface). Throws only when the stream
 * listing itself cannot be read; a track whose scan fails, or that carries no
 * timestamps, comes back `unmeasured` with the reason, and the other track is
 * still measured.
 */
export async function probeStreamEnds(filePath: string): Promise<StreamEnds> {
  const listing = await runFfprobe([
    "-v", "error",
    "-show_entries", "format=start_time,duration,format_name:stream=index,codec_type:stream_disposition=attached_pic",
    "-of", "json",
    filePath,
  ])
  const { video, audio, startSec, reAnchors, declaredSec } = parseStreamListing(listing)
  if (reAnchors) {
    // The container's timestamps do not share the render's clock (see the
    // docstring) — measuring per track against them would refuse correct edits
    // or pass bad ones. Its declared duration (the span of every stream) is a
    // safe UPPER bound instead — but only while the timestamps run forward: a
    // backward jump makes it UNDER-state the content (see `TrackEnd`), and a
    // bound that refuses correct paid edits is worse than none. When it holds,
    // the window check refuses past it + a wider tolerance, so an overrun
    // cannot deliver minutes of frozen picture.
    const mapped = [video, audio].filter((i): i is number => i !== undefined)
    const continuity = declaredSec !== undefined ? await dtsContinuity(filePath, mapped) : undefined
    const base = "MPEG-TS/PS container re-anchors timestamps; not on the render's clock"
    const unmeasured: TrackEnd = {
      state: "unmeasured",
      reason: continuity === undefined || continuity === "monotonic"
        ? base
        : `${base}; ${continuity}, so its declared length is no bound`,
      ...(declaredSec !== undefined && continuity === "monotonic" ? { declaredEndSec: declaredSec } : {}),
    }
    return {
      video: video === undefined ? { state: "absent" } : unmeasured,
      audio: audio === undefined ? { state: "absent" } : unmeasured,
    }
  }
  const measure = async (index: number | undefined): Promise<TrackEnd> => {
    if (index === undefined) return { state: "absent" }
    try {
      const { maxPtsEnd, maxDtsEnd } = await scanPacketEnds(filePath, index)
      const end = maxPtsEnd ?? maxDtsEnd
      return end === undefined
        ? { state: "unmeasured", reason: `stream ${index} carries no packet timestamps` }
        : { state: "measured", endSec: end - startSec }
    } catch (err) {
      return { state: "unmeasured", reason: err instanceof Error ? err.message : String(err) }
    }
  }
  return { video: await measure(video), audio: await measure(audio) }
}

/** From an ffprobe `-show_entries format=start_time,duration,format_name:
 *  stream=index,codec_type:stream_disposition=attached_pic -of json` listing:
 *  the first REAL video stream (not cover art) and the first audio stream, by
 *  index, the file's start time in seconds (0 when the container reports none),
 *  `reAnchors` — whether the container re-anchors timestamps to the earliest
 *  mapped stream (MPEG-TS / program stream), so `format.start_time` is not the
 *  render's zero — and `declaredSec`, the container's declared duration when it
 *  reports a positive one. Exported for its unit test. */
export function parseStreamListing(listingJson: string): { video?: number; audio?: number; startSec: number; reAnchors: boolean; declaredSec?: number } {
  let parsed: {
    streams?: Array<{ index?: number; codec_type?: string; disposition?: { attached_pic?: number } }>
    format?: { start_time?: string; duration?: string; format_name?: string }
  }
  try {
    parsed = JSON.parse(listingJson) as typeof parsed
  } catch {
    throw new Error(`probeStreamEnds: ffprobe stream listing is not JSON: "${listingJson.slice(0, 80)}"`)
  }
  const streams = parsed.streams ?? []
  const video = streams.find((s) => s.codec_type === "video" && !(s.disposition?.attached_pic ?? 0))?.index
  const audio = streams.find((s) => s.codec_type === "audio")?.index
  const start = Number(parsed.format?.start_time)
  // ffprobe joins comma-separated demuxer names, e.g. "mpegts" or "mpeg".
  const names = (parsed.format?.format_name ?? "").split(",").map((n) => n.trim())
  const reAnchors = names.includes("mpegts") || names.includes("mpegtsraw") || names.includes("mpeg")
  const declared = Number(parsed.format?.duration)
  return {
    ...(typeof video === "number" ? { video } : {}),
    ...(typeof audio === "number" ? { audio } : {}),
    startSec: Number.isFinite(start) ? start : 0,
    reAnchors,
    ...(Number.isFinite(declared) && declared > 0 ? { declaredSec: declared } : {}),
  }
}

/** Do these tracks' packet DTS run continuously? "monotonic" when every track
 *  has DTS and none jumps; otherwise a short reason. A jump is either a step
 *  BACK — within one stream DTS is non-decreasing even with B-frames (PTS is
 *  what reorders) — or a step FORWARD past where the previous packet ENDS
 *  (dts + duration, the CLI's own `next_dts` prediction) by more than
 *  `DTS_JUMP_THRESHOLD_SEC`, the CLI's `-dts_delta_threshold` (so a still-image
 *  stream whose frames each last 12 s is continuous, as the CLI sees it): both are discontinuities the
 *  CLI folds away at render time, so the content plays straight through while
 *  `format.duration` (last minus first timestamp) says something else. The
 *  forward case matters: libavformat treats a timestamp more than 60 s below
 *  the first one as a 33-bit wrap and adds 2^33 ticks, so a recording that
 *  restarted its clock reads as one ~26.5 h forward step (a genuine wrap, which
 *  libavformat unwraps into continuous timestamps, stays monotonic). A scan
 *  that fails is reported, never treated as continuous. */
export const DTS_JUMP_THRESHOLD_SEC = 10

async function dtsContinuity(filePath: string, streamIndices: readonly number[]): Promise<string> {
  if (streamIndices.length === 0) return "no mapped track to scan"
  for (const index of streamIndices) {
    try {
      const { dtsSteps } = await scanPacketEnds(filePath, index)
      if (dtsSteps === "none") return `stream ${index} carries no DTS`
      if (dtsSteps === "discontinuous") return `stream ${index}'s timestamps jump (back, or forward by more than ${DTS_JUMP_THRESHOLD_SEC} s — a joined or reconnected recording)`
    } catch (err) {
      return `stream ${index} could not be scanned (${err instanceof Error ? err.message : String(err)})`
    }
  }
  return "monotonic"
}

/** One packet csv line — ffprobe always writes the fields in its own order,
 *  `pts_time,dts_time,duration_time,flags`, whatever order they are requested
 *  in. Exported for its unit test. */
export function parsePacketLine(line: string): { pts?: number; dts?: number; dur: number; discard: boolean } | undefined {
  const trimmed = line.trim()
  if (!trimmed) return undefined
  const [pts, dts, dur, flags] = trimmed.split(",")
  const num = (v: string | undefined): number | undefined => {
    if (v === undefined || v === "" || v === "N/A") return undefined
    const n = Number(v)
    return Number.isFinite(n) ? n : undefined
  }
  const p = num(pts)
  const d = num(dts)
  return {
    ...(p !== undefined ? { pts: p } : {}),
    ...(d !== undefined ? { dts: d } : {}),
    dur: num(dur) ?? 0,
    discard: (flags ?? "").includes("D"),
  }
}

/** How a packet scan reads its source. Every field is optional; without them a
 *  scan reads a LOCAL file under `DEFAULT_FFMPEG_TIMEOUT_MS` (probeStreamEnds). */
export interface PacketScanOptions {
  /** The guarded probe of a source read through `readProbeSource` (a link:
   *  its input options and the proxy's environment): the scan opens what the
   *  header probe beside it may, never more. Omitted: a LOCAL file, read as is. */
  readonly probe?: Pick<GuardedProbe, "inputArgs" | "env">
  /** Kill the scan after this long (default `DEFAULT_FFMPEG_TIMEOUT_MS`); its
   *  rejection then carries `timedOut: true` (retryable). */
  readonly timeoutMs?: number
  /** Kill the scan when this aborts (a request whose client went away); its
   *  rejection then carries `aborted: true`. */
  readonly signal?: AbortSignal
}

/** Stream one track's packet list through ffprobe; keep the max PTS end and,
 *  for a stream with no pts at all, the max DTS end, and whether its DTS ever
 *  JUMPS — back, or forward past `DTS_JUMP_THRESHOLD_SEC` (`dtsSteps`, read by
 *  `dtsContinuity`). Discarded packets never count. The lines are streamed, so
 *  a scan has no size limit but its time (`opts`). */
export function scanPacketEnds(
  filePath: string,
  streamIndex: number,
  opts: PacketScanOptions = {},
): Promise<{ maxPtsEnd?: number; maxDtsEnd?: number; dtsSteps: "monotonic" | "discontinuous" | "none" }> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) {
      reject(Object.assign(new Error(`probeStreamEnds: aborted before the scan of stream ${streamIndex}`), { aborted: true }))
      return
    }
    const refused = unguardedProbeLinkRefusal([filePath], opts.probe?.env)
    if (refused) {
      reject(refused)
      return
    }
    const proc = spawn("ffprobe", [
      "-v", "error",
      ...(opts.probe?.inputArgs ?? []),
      "-select_streams", String(streamIndex),
      "-show_entries", "packet=pts_time,dts_time,duration_time,flags",
      "-of", "csv=p=0",
      filePath,
    ], { stdio: ["ignore", "pipe", "pipe"], ...(opts.probe?.env ? { env: opts.probe.env } : {}) })

    const limitMs = opts.timeoutMs ?? DEFAULT_FFMPEG_TIMEOUT_MS
    let timedOut = false
    let aborted = false
    const watchdog = setTimeout(() => {
      timedOut = true
      proc.kill("SIGKILL")
    }, limitMs)
    const onAbort = () => {
      aborted = true
      proc.kill("SIGKILL")
    }
    opts.signal?.addEventListener("abort", onAbort, { once: true })

    let maxPtsEnd: number | undefined
    let maxDtsEnd: number | undefined
    let lastDts: number | undefined
    let lastDur = 0
    let dtsJumps = false
    let lineBuf = ""
    const take = (line: string) => {
      const pkt = parsePacketLine(line)
      if (!pkt || pkt.discard) return
      if (pkt.pts !== undefined && (maxPtsEnd === undefined || pkt.pts + pkt.dur > maxPtsEnd)) maxPtsEnd = pkt.pts + pkt.dur
      if (pkt.dts !== undefined && (maxDtsEnd === undefined || pkt.dts + pkt.dur > maxDtsEnd)) maxDtsEnd = pkt.dts + pkt.dur
      if (pkt.dts !== undefined) {
        if (lastDts !== undefined && (pkt.dts < lastDts || pkt.dts - (lastDts + lastDur) > DTS_JUMP_THRESHOLD_SEC)) dtsJumps = true
        lastDts = pkt.dts
        lastDur = pkt.dur
      }
    }
    proc.stdout.on("data", (chunk: Buffer) => {
      lineBuf += chunk.toString()
      const lines = lineBuf.split("\n")
      lineBuf = lines.pop() ?? ""
      for (const line of lines) take(line)
    })
    let stderrTail = ""
    proc.stderr.on("data", (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-2048)
    })
    proc.on("error", (err) => {
      clearTimeout(watchdog)
      opts.signal?.removeEventListener("abort", onAbort)
      reject(Object.assign(new Error(`ffprobe failed to spawn: ${err.message}`), { notStarted: true, cause: err }))
    })
    proc.on("close", (code) => {
      clearTimeout(watchdog)
      opts.signal?.removeEventListener("abort", onAbort)
      if (lineBuf) take(lineBuf)
      if (aborted) reject(Object.assign(new Error(`probeStreamEnds: ffprobe aborted on stream ${streamIndex}`), { aborted: true }))
      else if (timedOut) reject(Object.assign(new Error(`probeStreamEnds: ffprobe timed out after ${limitMs}ms on stream ${streamIndex}`), { timedOut: true }))
      else if (code !== 0) reject(new Error(`probeStreamEnds: ffprobe exit ${code} on stream ${streamIndex}: ${stderrTail.trim() || "no output"}`))
      else resolve({
        ...(maxPtsEnd !== undefined ? { maxPtsEnd } : {}),
        ...(maxDtsEnd !== undefined ? { maxDtsEnd } : {}),
        dtsSteps: lastDts === undefined ? "none" : dtsJumps ? "discontinuous" : "monotonic",
      })
    })
  })
}

/** Presentation times (ms) of a LOCAL file's first video track's frames,
 *  sorted (packets come in decode order; B-frames reorder them). One csv line
 *  per frame, so the packet list is STREAMED: a long proxy at a high fps is
 *  megabytes of csv, past `runFfprobe`'s buffer (a 2 h proxy at 60 fps is
 *  ~430k lines, over 5 MiB). Packets with no pts are skipped. `timeoutMs` is
 *  the watchdog (a proxy segment passes its span's own, `proxySpanProbeTimeoutMs`). */
export function probeVideoFramePtsMs(filePath: string, timeoutMs: number = DEFAULT_FFMPEG_TIMEOUT_MS): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const refused = unguardedProbeLinkRefusal([filePath], undefined)
    if (refused) {
      reject(refused)
      return
    }
    const proc = spawn("ffprobe", [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "packet=pts_time",
      "-of", "csv=p=0",
      filePath,
    ], { stdio: ["ignore", "pipe", "pipe"] })

    let timedOut = false
    const watchdog = setTimeout(() => {
      timedOut = true
      proc.kill("SIGKILL")
    }, timeoutMs)

    const ptsMs: number[] = []
    let lineBuf = ""
    const take = (line: string) => {
      const sec = Number.parseFloat(line)
      if (Number.isFinite(sec)) ptsMs.push(sec * 1000)
    }
    proc.stdout.on("data", (chunk: Buffer) => {
      lineBuf += chunk.toString()
      const lines = lineBuf.split("\n")
      lineBuf = lines.pop() ?? ""
      for (const line of lines) take(line)
    })
    let stderrTail = ""
    proc.stderr.on("data", (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-2048)
    })
    proc.on("error", (err) => {
      clearTimeout(watchdog)
      reject(Object.assign(new Error(`ffprobe failed to spawn: ${err.message}`), { notStarted: true, cause: err }))
    })
    proc.on("close", (code) => {
      clearTimeout(watchdog)
      if (lineBuf) take(lineBuf)
      if (timedOut) reject(new Error(`probeVideoFramePtsMs: ffprobe timed out after ${timeoutMs}ms`))
      else if (code !== 0) reject(new Error(`probeVideoFramePtsMs: ffprobe exit ${code}: ${stderrTail.trim() || "no output"}`))
      else resolve(ptsMs.sort((a, b) => a - b))
    })
  })
}

export interface MediaStreams {
  /** At least one REAL video stream — embedded cover art (attached_pic) does not count. */
  readonly hasVideo: boolean
  /** At least one audio stream. */
  readonly hasAudio: boolean
}

/**
 * What streams does this media ACTUALLY carry? One ffprobe call, JSON out.
 *
 * The container, the extension, the client MIME and the input slot a file
 * arrived through can all lie: an audio-only M4A is happily served as
 * `video/mp4` from `uploads/videos/` (incident 2026-08-30, voice-changer-pro —
 * the paid speech-to-speech pass ran, then the remux died at `-map 0:v`). The
 * stream list is the only honest signal, so anything that must choose between
 * an audio path and a video path decides on THIS, never on the slot.
 *
 * `hasVideo` ignores `disposition.attached_pic` streams — a podcast MP3 with
 * cover art has an mjpeg/png "video" stream that is a still picture, and
 * mapping it as video would be the same class of lie in the other direction.
 *
 * Accepts a local path OR a remote http(s) URL; a URL is read only through
 * the probe guard (`readProbeSource`).
 * Throws (never guesses) when ffprobe's output is not parseable — callers
 * that want a fail-open decision catch and fall back on the slot's word.
 * `timeoutMs` bounds the ffprobe run tighter than its own watchdog (never looser).
 */
export async function probeMediaStreams(
  srcUrlOrPath: string,
  opts: { readonly userFile?: boolean; readonly timeoutMs?: number } = {},
): Promise<MediaStreams> {
  const runOpts = opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : undefined
  const output = await readProbeSource(srcUrlOrPath, (input, probe) => probe.run([
    "-v", "error",
    ...probe.inputArgs,
    "-show_entries", "stream=codec_type:stream_disposition=attached_pic",
    "-of", "json",
    input,
  ], runOpts), opts.userFile ? { userFile: true } : {})
  let parsed: { streams?: unknown }
  try {
    parsed = JSON.parse(output) as { streams?: unknown }
  } catch {
    throw new Error(`probeMediaStreams failed to parse: "${output.trim().slice(0, 200)}"`)
  }
  if (!Array.isArray(parsed.streams)) {
    throw new Error(`probeMediaStreams: no stream list in ffprobe output: "${output.trim().slice(0, 200)}"`)
  }
  const streams = parsed.streams as Array<{ codec_type?: unknown; disposition?: { attached_pic?: unknown } }>
  const hasVideo = streams.some(
    (s) => s.codec_type === "video" && s.disposition?.attached_pic !== 1,
  )
  const hasAudio = streams.some((s) => s.codec_type === "audio")
  return { hasVideo, hasAudio }
}

/**
 * Probe the video codec and pixel format in a single ffprobe call.
 * Returns e.g. { codec: "h264", pixFmt: "yuv420p" }.
 */
export async function probeVideoStream(filePath: string): Promise<{ codec: string; pixFmt: string }> {
  return videoStreamOf(await runFfprobe([...VIDEO_STREAM_ENTRIES, filePath]))
}

/** {@link probeVideoStream} of a source that may be a LINK, read through the probe guard (`readProbeSource`). */
export async function probeVideoStreamSource(src: string): Promise<{ codec: string; pixFmt: string }> {
  return readProbeSource(src, async (input, probe) => videoStreamOf(await probe.run([...probe.inputArgs, ...VIDEO_STREAM_ENTRIES, input])))
}

const VIDEO_STREAM_ENTRIES = ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,pix_fmt", "-of", "csv=p=0"] as const

function videoStreamOf(output: string): { codec: string; pixFmt: string } {
  // ffprobe CSV output: "h264,yuv420p" (see csvFields for the shapes a plain split misreads)
  const parts = csvFields(output.toLowerCase())
  return {
    codec: parts[0] ?? "",
    pixFmt: parts[1] ?? "",
  }
}

/**
 * Check whether a video file needs transcoding for browser playback.
 * Browsers universally support H.264 baseline/main/high with yuv420p.
 * When codec or pixel format cannot be determined, defaults to transcoding.
 */
export async function needsTranscode(filePath: string): Promise<boolean> {
  return videoStreamNeedsTranscode(await probeVideoStream(filePath))
}

/** The rule of {@link needsTranscode}: anything but H.264 in yuv420p (an unknown codec or format included). */
export function videoStreamNeedsTranscode(stream: { readonly codec: string; readonly pixFmt: string }): boolean {
  return stream.codec !== "h264" || stream.pixFmt !== "yuv420p"
}

/** Standard browser-safe H.264 encoding args (no input/output). */
export const BROWSER_SAFE_VIDEO_ARGS = [
  "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "fast", "-crf", "23",
  "-movflags", "+faststart",
] as const

/**
 * CRF for every re-encode on the COMBINE/DELIVERY path — clip normalization,
 * smart-cut edge trims, and the xfade renders in combine-videos.ts. The
 * inputs are already-compressed AI segments, and this is the encode the user
 * actually receives: x264's default 23 (and the explicit 23 normalize used
 * to carry) halved the delivered bitrate at the very last step (job
 * 08f99f85: 2.2–2.5 Mbps segments → 1.19 Mbps final; the cut path even
 * stacks normalize + trim, two such generations before its stream-copy
 * concat). 18 is the visually-lossless norm; the size cost lands on one
 * deliverable file, not a library.
 */
export const COMBINE_DELIVERY_CRF = "18"

/**
 * Browser-safe args optimized for Remotion's OffthreadVideo compositor.
 * Forces a keyframe every frame (`-g 1`) so the compositor can seek to any
 * timestamp without decoding from a distant keyframe.  File size is ~20-40%
 * larger but frame extraction goes from ~33s to <1s per frame.
 */
export const REMOTION_INPUT_VIDEO_ARGS = [
  "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "fast", "-crf", "18",
  "-g", "1",
  "-movflags", "+faststart",
] as const

/**
 * Transcode a video file to browser-safe H.264/yuv420p if needed.
 * Returns the output path (same as outputPath) if transcoding occurred,
 * or the original inputPath if the file was already compatible.
 */
export async function transcodeToBrowserSafe(
  inputPath: string,
  outputPath: string,
  /** Override the encode's CRF (default 23) — a lane whose product is fidelity (an upscale) passes {@link COMBINE_DELIVERY_CRF}. */
  crf?: string,
): Promise<string> {
  if (!await needsTranscode(inputPath)) return inputPath
  await runFfmpeg(browserSafeTranscodeArgs(inputPath, outputPath, crf))
  return outputPath
}

/** The ffmpeg arguments of {@link transcodeToBrowserSafe}'s encode. */
export function browserSafeTranscodeArgs(inputPath: string, outputPath: string, crf?: string): string[] {
  const videoArgs = crf === undefined
    ? BROWSER_SAFE_VIDEO_ARGS
    : BROWSER_SAFE_VIDEO_ARGS.map((arg, i, all) => (all[i - 1] === "-crf" ? crf : arg))
  return [
    "-y", "-i", inputPath,
    ...videoArgs,
    "-c:a", "aac", "-b:a", "128k",
    outputPath,
  ]
}

export async function createWorkDir(prefix: string): Promise<string> {
  const workDir = join(tmpdir(), `${prefix}-${randomUUID()}`)
  await fs.mkdir(workDir, { recursive: true })
  return workDir
}

export async function cleanupWorkDir(workDir: string): Promise<void> {
  await fs.rm(workDir, { recursive: true, force: true }).catch(() => {})
}

/**
 * Trim the last N frames off a video. Used to remove the tail dissolve
 * VEO3.1 adds when rendering first+last-frame loops — the final ~333ms
 * (8 frames @ 24fps) is a soft cross-fade that breaks the loop seam.
 *
 * Uses `-t` with a computed target duration (totalDuration - frames/fps),
 * which trims BOTH video and audio streams to the same length and keeps
 * existing codecs intact when stream-copy is safe. We force re-encode
 * to land on an exact frame boundary because `-t` + stream-copy cuts at
 * the next keyframe, which can land before our target and shave too much.
 */
export async function trimLastFrames(
  inputPath: string,
  outputPath: string,
  framesToTrim: number,
  fps: number,
): Promise<string> {
  const sourceDuration = await getVideoDuration(inputPath)
  const trimSeconds = framesToTrim / fps
  const targetDuration = sourceDuration - trimSeconds
  if (targetDuration <= 0) {
    throw new Error(
      `Source video too short to trim ${framesToTrim} frames at ${fps}fps ` +
      `(duration=${sourceDuration.toFixed(3)}s, trim=${trimSeconds.toFixed(3)}s)`,
    )
  }
  await runFfmpeg([
    "-y", "-i", inputPath,
    "-t", targetDuration.toFixed(3),
    // Re-encode video so the cut lands on exact frame N-8, not the
    // previous keyframe. Audio can stream-copy safely since we only
    // shorten the duration.
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-preset", "fast",
    "-crf", "20",
    "-c:a", "copy",
    "-movflags", "+faststart",
    outputPath,
  ])
  return outputPath
}

/**
 * Trim N frames off the start and/or end of a clip (re-encode). Shared by
 * combine-videos.ts (clip-boundary seam trim between combined clips) and
 * assemble-narrated-video.ts (interior block-join seam trim) — both callers
 * are responsible for zeroing out the start/end frame count on edges that
 * must stay untouched (e.g. the very first clip's start, the very last
 * clip's end) BEFORE calling this, since this helper has no notion of clip
 * position.
 *
 * Probes fps + duration, converts frame counts to seconds, then:
 *   - returns `inputPath` unchanged when both `trimStartFrames` and
 *     `trimEndFrames` are <= 0 (nothing requested — skips the probe too)
 *   - returns `inputPath` unchanged when the combined trim would meet or
 *     exceed the clip's duration (would leave nothing to keep)
 *   - otherwise re-encodes to `outputPath` via `-ss`/`-to` and returns it
 */
export async function trimEdgeFrames(
  inputPath: string,
  outputPath: string,
  trimStartFrames: number,
  trimEndFrames: number,
  opts?: {
    /** End-trim the VIDEO only, keeping the audio through the clip's
     *  ORIGINAL end (fix 2a, field report 2026-07-25 "voice was cut"): at a
     *  matched smart-cut boundary the dropped tail frames are DUPLICATED
     *  video, but their audio is unique speech — continuation models
     *  re-render the video overlap yet generate fresh audio (measured:
     *  next-head audio holds no copy of prev's tail, xcorr |r|≈0.1). The
     *  caller MUST route such a clip through a filter graph that re-anchors
     *  audio (combine's L-cut amix); the concat demuxer joins streams
     *  independently and would drift on the longer audio track. */
    preserveAudioTail?: boolean
  },
): Promise<string> {
  if (trimStartFrames <= 0 && trimEndFrames <= 0) return inputPath

  const fps = await getVideoFps(inputPath)
  // VIDEO STREAM duration, not container: the container includes the audio
  // overhang AI clips ship (~1-2 frames' worth), so an end cut computed from
  // it lands past the last video frame and silently trims fewer frames than
  // requested (regression caught by smart cut, which needs exact indices).
  const duration = await getVideoStreamDuration(inputPath)
  const startSec = trimStartFrames / fps
  const endSec = trimEndFrames / fps

  if (startSec + endSec >= duration) return inputPath

  if (opts?.preserveAudioTail && trimEndFrames > 0) {
    await runFfmpeg([
      "-y", "-i", inputPath,
      "-filter_complex",
      `[0:v]trim=start=${startSec}:end=${duration - endSec},setpts=PTS-STARTPTS[v];` +
        `[0:a]atrim=start=${startSec},asetpts=PTS-STARTPTS[a]`,
      "-map", "[v]", "-map", "[a]",
      "-c:v", "libx264", "-preset", "fast", "-crf", COMBINE_DELIVERY_CRF, "-c:a", "aac", outputPath,
    ])
    return outputPath
  }

  const args = ["-y", "-i", inputPath]
  if (trimStartFrames > 0) args.push("-ss", String(startSec))
  // Also bounds the AUDIO to the video's cut point, killing the overhang on
  // trimmed clips — concat boundaries then match the video exactly.
  if (trimEndFrames > 0) args.push("-to", String(duration - endSec))
  args.push("-c:v", "libx264", "-preset", "fast", "-crf", COMBINE_DELIVERY_CRF, "-c:a", "aac", outputPath)

  await runFfmpeg(args)
  return outputPath
}

/**
 * Cap a video to its first `maxFrames` video frames (frame-accurate via
 * `-frames:v` + re-encode, so the cut lands on the exact frame rather than the
 * next keyframe). Audio is trimmed to match via `-shortest`. Used by the SwitchX
 * worker to fit a source that's slightly over Beeble's 240-frame cap.
 */
export async function capVideoToFrames(
  inputPath: string,
  outputPath: string,
  maxFrames: number,
): Promise<string> {
  await runFfmpeg([
    "-y", "-i", inputPath,
    "-frames:v", String(maxFrames),
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-preset", "fast",
    "-crf", "20",
    "-c:a", "copy",
    "-shortest",
    "-movflags", "+faststart",
    outputPath,
  ])
  return outputPath
}

/**
 * Strip the audio track from a video, leaving the video stream untouched.
 * Stream-copies the video (`-c:v copy -an`) so this is essentially free —
 * no re-encode. Used to honour `sound: false` for providers that don't
 * expose a native audio toggle (e.g. VEO3 / VEO3.1, which always ship with
 * background audio per KIE's docs).
 */
export async function stripAudio(inputPath: string, outputPath: string): Promise<string> {
  await runFfmpeg([
    "-y", "-i", inputPath,
    "-c:v", "copy",
    "-an",
    outputPath,
  ])
  return outputPath
}

/**
 * Re-encode a clip to a uniform format for combining: fps=24, h264/yuv420p,
 * AAC audio at 44.1kHz stereo, and — crucially — scaled and letterboxed to
 * exactly `targetWidth`×`targetHeight`. xfade/acrossfade and the concat
 * filter all require every input to share the same resolution, so a single
 * odd-sized clip would otherwise abort the whole combine.
 *
 * The `-ar`/`-ac` pin matters as much as the resolution: providers emit
 * clips at 32/44.1/48kHz, and the combine cut path splices normalized clips
 * with `-f concat -c copy`, which stamps the whole output track with the
 * FIRST clip's decoder config. A later clip at another rate then plays at
 * the wrong speed/pitch and desyncs from its video (job 3dca9c76). Same
 * pin as runBlockFit's block encode in assemble-narrated-video.ts.
 */
export async function normalizeVideoForCombine(
  inputPath: string,
  outputPath: string,
  targetWidth: number,
  targetHeight: number,
  // The ONE frame rate every clip in a set is conformed to — the frame-index
  // trims and the smart-cut matcher need it uniform. combine-videos tallies it
  // from the sources (pickTargetFps) so two 30 fps clips stay 30 fps; the
  // fixed 24 this used to be resampled them, dropping one frame in five
  // (job 597dcf72, 2026-09-08). 24 stays the default for callers that never
  // pass one, so their output is byte-for-byte what it was.
  targetFps: number = 24,
): Promise<string> {
  // Output dimensions must be even for yuv420p.
  const w = targetWidth - (targetWidth % 2)
  const h = targetHeight - (targetHeight % 2)
  await runFfmpeg([
    "-y", "-i", inputPath,
    "-vf", `fps=${targetFps},scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "fast", "-crf", COMBINE_DELIVERY_CRF,
    "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "2",
    "-movflags", "+faststart",
    outputPath,
  ])
  return outputPath
}

// Containers the video-analysis consumer accepts directly — everything else is
// remuxed into .mp4 first. Extension-only decision (case-insensitive); the
// actual per-stream codec fix-up happens in buildRemuxArgs / remuxToMp4.
const REMUX_PASS_THROUGH_EXTS = new Set(["mp4", "webm", "mov"])

/**
 * True when a media file must be remuxed into an MP4 container before the
 * downstream consumer can read it. False for the already-safe containers
 * (.mp4/.webm/.mov), true for everything else (.mkv, .avi, …). Accepts a full
 * path OR a bare extension ("mkv", ".mkv") — case-insensitive on the extension.
 */
export function needsContainerRemux(pathOrExt: string): boolean {
  const lower = pathOrExt.toLowerCase()
  const dotIdx = lower.lastIndexOf(".")
  // No dot → treat the whole string as a bare extension (the "Ext" form).
  const ext = dotIdx >= 0 ? lower.slice(dotIdx + 1) : lower
  return !REMUX_PASS_THROUGH_EXTS.has(ext)
}

/**
 * Build the ffmpeg args to remux `input` into an MP4 at `output`. The video
 * stream is always stream-copied (`-c:v copy` — no re-encode, near-instant).
 * Audio recipe, keyed on the probed source audio codec:
 *   - aac / mp3        → `-c:a copy` (already MP4-muxer-safe)
 *   - any other codec  → `-c:a aac`  (the MP4 muxer rejects Opus/PCM — common
 *                          in yt-dlp .mkv/.webm payloads; an audio-only
 *                          re-encode is cheap next to a video re-encode)
 *   - null (no audio)  → no `-c:a` flags at all (audio-less source)
 */
export function buildRemuxArgs(input: string, output: string, audioCodec: string | null): string[] {
  const args = ["-y", "-i", input, "-c:v", "copy"]
  if (audioCodec !== null) {
    const muxerSafe = audioCodec === "aac" || audioCodec === "mp3"
    args.push("-c:a", muxerSafe ? "copy" : "aac")
  }
  args.push("-movflags", "+faststart", output)
  return args
}

/**
 * Probe the codec_name of the FIRST audio stream (a:0). Returns null when the
 * source has no audio stream at all (ffprobe prints nothing). LOCAL file only
 * (no network), so no SSRF guard is needed. Mirrors probeVideoStream's shape.
 */
async function probeFirstAudioCodec(filePath: string): Promise<string | null> {
  return firstAudioCodecOf(await runFfprobe([...FIRST_AUDIO_CODEC_ENTRIES, filePath]))
}

/** The first audio stream's codec of a source that may be a LINK, read through the probe guard (`readProbeSource`). */
export async function probeFirstAudioCodecSource(src: string): Promise<string | null> {
  return readProbeSource(src, async (input, probe) => firstAudioCodecOf(await probe.run([...probe.inputArgs, ...FIRST_AUDIO_CODEC_ENTRIES, input])))
}

const FIRST_AUDIO_CODEC_ENTRIES = ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_name", "-of", "csv=p=0"] as const

function firstAudioCodecOf(output: string): string | null {
  const codec = (csvFields(output.toLowerCase())[0] ?? "")
  return codec.length > 0 ? codec : null
}

/**
 * Remux any container into MP4: video stream copied untouched, audio kept when
 * already MP4-muxer-safe (aac/mp3) else re-encoded to AAC. Probes the source
 * audio codec first (absent stream → audio-less remux), then runs a single
 * semaphore-gated ffmpeg spawn (remux is cheap but is still a real spawn).
 */
export async function remuxToMp4(inputPath: string, outputPath: string): Promise<void> {
  const audioCodec = await probeFirstAudioCodec(inputPath)
  await runFfmpeg(buildRemuxArgs(inputPath, outputPath, audioCodec))
}

/**
 * ffmpeg args to lay the audio of `audioSource` onto the video of `video`,
 * without re-encoding the picture. Used to restore sound onto a Remotion
 * render whose input video was transcoded audio-less (`-an`) for fast frame
 * seeking — the composition therefore has no audio, and its own (silent)
 * track is dropped in favour of the source's. `-shortest` guards a source
 * whose audio runs a hair longer than the render.
 */
export function buildAudioOntoVideoArgs(video: string, audioSource: string, output: string, audioCodec: string): string[] {
  const muxerSafe = audioCodec === "aac" || audioCodec === "mp3"
  return [
    "-y",
    "-i", video,
    "-i", audioSource,
    "-map", "0:v:0",
    "-map", "1:a:0",
    "-c:v", "copy",
    "-c:a", muxerSafe ? "copy" : "aac",
    "-shortest",
    "-movflags", "+faststart",
    output,
  ]
}

/**
 * Restore audio onto a captioned (or otherwise re-rendered) video by copying
 * the first audio stream of `audioSource` over it. No-op returning false when
 * the source has no audio stream, so a genuinely silent input stays silent
 * and the caller keeps the original file. Local files only.
 */
export async function restoreVideoAudioFromSource(video: string, audioSource: string, output: string): Promise<boolean> {
  const audioCodec = await probeFirstAudioCodec(audioSource)
  if (audioCodec === null) return false
  await runFfmpeg(buildAudioOntoVideoArgs(video, audioSource, output, audioCodec))
  return true
}
