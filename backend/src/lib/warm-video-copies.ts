/**
 * Warm the CDN's light copies of a video the clients are about to play.
 *
 * Client apps play platform videos from the CDN's media transform
 * (`https://cdn.nodaro.ai/cdn-cgi/media/width=<W>,mode=video/<path>` for the
 * file at `https://cdn.nodaro.ai/<path>`). The FIRST request for a given copy
 * is a cold transform — about 6 s before its first byte — and every request
 * after it is served from the edge in a few tens of milliseconds, from every
 * region (the transformed copy's cache is shared). So the platform asks for
 * each copy once, as soon as the video exists (a trend version published, a
 * run finished), and the first viewer no longer waits.
 *
 * Fire and forget: {@link warmVideoCopies} returns at once, never throws and
 * never blocks its caller. Each copy is fetched in full (the body read and
 * dropped, so the edge finishes the transform it was asked for), at most
 * {@link WARM_CONCURRENCY} at a time across the process, each bounded by
 * {@link WARM_TIMEOUT_MS}. A copy asked for recently is not asked again; a
 * failure is logged at debug level and forgotten, so a later call may retry it.
 */

/**
 * The copy widths the clients ask for. Mirrors the client apps' light-copy
 * playback rule: change both together, or the warmed copies are not the ones
 * the clients request.
 */
export const LIGHT_COPY_WIDTHS = [480, 854, 1280] as const

/**
 * The client plays the FULL file, not a copy, when the copy it would ask for
 * is at least this many times the source's width (the CDN never upscales, so
 * such a copy is the same picture re-encoded). Mirrors the client apps'
 * light-copy playback rule.
 */
export const FULL_FILE_WIDTH_FACTOR = 1.5

/**
 * The copies warmed when the source's width is not known: the two smaller
 * ones. The widest is warmed only for a source known to be wide enough.
 */
export const UNKNOWN_WIDTH_COPIES: readonly number[] = [480, 854]

/** At most this many copies are fetched at once, across the process. */
export const WARM_CONCURRENCY = 2

/** One copy's fetch (headers and whole body) is given up after this long. */
export const WARM_TIMEOUT_MS = 60_000

/** Copies waiting beyond this many are dropped (a burst never grows memory without bound). */
export const WARM_QUEUE_MAX = 200

/** A copy asked for within this window is not asked for again. */
export const WARM_RECENT_TTL_MS = 30 * 60_000

/** How many recently asked copies are remembered (oldest forgotten first). */
export const WARM_RECENT_MAX = 2_000

/**
 * `https://cdn.nodaro.ai/<path>[?query][#fragment]`: a path that starts with
 * a file name character (not `/`, `?` or `#`), with no spaces or backslashes,
 * and that is not already under `cdn-cgi/`. The same rule the clients apply
 * before they rewrite an address to its light copy.
 */
const PLATFORM_FILE = /^https:\/\/cdn\.nodaro\.ai\/(?!cdn-cgi\/)([^/?#\s\\][^?#\s\\]*)((?:[?#]\S*)?)$/i

/** A path that steps out of where it is put (`.` / `..` segments) is left alone. */
const DOT_SEGMENT = /(?:^|\/)\.{1,2}(?:\/|$)/

function knownWidth(sourceWidth: number | null | undefined): number | undefined {
  return typeof sourceWidth === "number" && Number.isFinite(sourceWidth) && sourceWidth > 0 ? sourceWidth : undefined
}

/** The copy widths a client may ask for a source this wide (unknown: {@link UNKNOWN_WIDTH_COPIES}). */
export function lightCopyWidths(sourceWidth?: number | null): number[] {
  const width = knownWidth(sourceWidth)
  if (width === undefined) return [...UNKNOWN_WIDTH_COPIES]
  return LIGHT_COPY_WIDTHS.filter((w) => w < FULL_FILE_WIDTH_FACTOR * width)
}

/**
 * The light-copy addresses to warm for `url`, built exactly as the clients
 * build them (query kept: it is part of the edge's cache key). Empty for any
 * address that is not a plain file on the platform CDN.
 */
export function lightCopyUrlsToWarm(url: string, sourceWidth?: number | null): string[] {
  if (typeof url !== "string") return []
  const match = PLATFORM_FILE.exec(url)
  if (!match) return []
  const [, path, rest] = match
  if (!path || DOT_SEGMENT.test(path)) return []
  return lightCopyWidths(sourceWidth).map((w) => `https://cdn.nodaro.ai/cdn-cgi/media/width=${w},mode=video/${path}${rest ?? ""}`)
}

export interface VideoCopyWarmerOptions {
  fetch?: typeof fetch
  concurrency?: number
  timeoutMs?: number
  queueMax?: number
  recentTtlMs?: number
  recentMax?: number
  now?: () => number
  log?: (message: string) => void
}

export interface VideoCopyWarmer {
  /** Queue the light copies of `url` (see {@link warmVideoCopies}). */
  warm(url: string, sourceWidth?: number | null): void
  /** Resolves once nothing is queued or in flight (tests). */
  idle(): Promise<void>
}

/** Read a response body to its end and drop it. */
async function drain(res: Response): Promise<void> {
  const reader = res.body?.getReader()
  if (!reader) return
  for (;;) {
    const { done } = await reader.read()
    if (done) return
  }
}

export function createVideoCopyWarmer(opts: VideoCopyWarmerOptions = {}): VideoCopyWarmer {
  const doFetch = opts.fetch ?? ((input, init) => globalThis.fetch(input, init))
  const concurrency = opts.concurrency ?? WARM_CONCURRENCY
  const timeoutMs = opts.timeoutMs ?? WARM_TIMEOUT_MS
  const queueMax = opts.queueMax ?? WARM_QUEUE_MAX
  const recentTtlMs = opts.recentTtlMs ?? WARM_RECENT_TTL_MS
  const recentMax = opts.recentMax ?? WARM_RECENT_MAX
  const now = opts.now ?? Date.now
  const log = opts.log ?? ((message: string) => console.debug(`[warm-video-copies] ${message}`))

  const queue: string[] = []
  /** Copy URL → when it was asked for (insertion order = age). */
  const recent = new Map<string, number>()
  let active = 0
  let idleWaiters: Array<() => void> = []

  function remember(copy: string): boolean {
    const at = recent.get(copy)
    const t = now()
    if (at !== undefined && t - at < recentTtlMs) return false
    recent.delete(copy)
    recent.set(copy, t)
    while (recent.size > recentMax) {
      const oldest = recent.keys().next().value
      if (oldest === undefined) break
      recent.delete(oldest)
    }
    return true
  }

  function settleIdle(): void {
    if (active > 0 || queue.length > 0) return
    const waiters = idleWaiters
    idleWaiters = []
    for (const w of waiters) w()
  }

  async function fetchOne(copy: string): Promise<void> {
    try {
      const res = await doFetch(copy, { signal: AbortSignal.timeout(timeoutMs) })
      if (!res.ok) {
        recent.delete(copy)
        log(`${copy} answered ${res.status}`)
        await res.body?.cancel().catch(() => undefined)
        return
      }
      await drain(res)
    } catch (e) {
      recent.delete(copy)
      log(`${copy} failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  function pump(): void {
    while (active < concurrency && queue.length > 0) {
      const copy = queue.shift()!
      active += 1
      void fetchOne(copy).finally(() => {
        active -= 1
        pump()
        settleIdle()
      })
    }
  }

  return {
    warm(url, sourceWidth) {
      try {
        for (const copy of lightCopyUrlsToWarm(url, sourceWidth)) {
          if (!remember(copy)) continue
          if (queue.length >= queueMax) {
            recent.delete(copy)
            log(`queue full, ${copy} not warmed`)
            continue
          }
          queue.push(copy)
        }
        pump()
      } catch (e) {
        log(`could not queue ${String(url)}: ${e instanceof Error ? e.message : String(e)}`)
      }
    },
    idle() {
      if (active === 0 && queue.length === 0) return Promise.resolve()
      return new Promise<void>((resolve) => idleWaiters.push(resolve))
    },
  }
}

const processWarmer = createVideoCopyWarmer()

/**
 * Ask the CDN for the light copies the clients will play of `url` (a video on
 * the platform CDN; anything else is ignored), so they are cached before the
 * first viewer asks. `sourceWidth` is the video's own width when known.
 * Returns at once; never throws.
 */
export function warmVideoCopies(url: string, sourceWidth?: number | null): void {
  processWarmer.warm(url, sourceWidth)
}

/**
 * The job types whose finished video the clients play from its light copies:
 * Nodaro Motion runs, trend runs and their Full Quality versions. A job the
 * video worker picked up carries its queue name in `job_type`, which for a
 * Full Quality version is its own (`cast-swap-full-quality`).
 */
export const WARMED_JOB_TYPES: ReadonlySet<string> = new Set(["cast-swap", "cast-swap-full-quality"])

/**
 * After a job of a {@link WARMED_JOB_TYPES} type COMPLETED: warm its output
 * video (`output.videoUrl`, its width `output.width` when recorded). Any other
 * job, or an output without a video address, warms nothing. Never throws.
 */
export function warmCompletedJobVideo(jobType: unknown, output: Record<string, unknown> | null | undefined): void {
  try {
    if (typeof jobType !== "string" || !WARMED_JOB_TYPES.has(jobType) || !output) return
    const videoUrl = output.videoUrl
    if (typeof videoUrl !== "string") return
    const width = typeof output.width === "number" ? output.width : undefined
    warmVideoCopies(videoUrl, width)
  } catch {
    /* never reaches the completion */
  }
}
