/**
 * The clip measurement as a BACKGROUND JOB (decided 2026-10-12, R4).
 *
 * A file of any size is downloaded and demuxed here, but the person's request
 * never waits for it: the editor starts the job and polls (`POST
 * /v1/media/clip-length`), and the second run of the same address answers from
 * the cache at once. No job row, no credits: the state lives in Redis beside
 * the answer.
 *
 *   - the ANSWER is `measureClip`'s own cache (per address, an hour);
 *   - a `running` MARKER (set with NX, a short lease renewed while the work
 *     goes on) keeps one measurement per address across instances; an
 *     instance that dies stops renewing it and the lease runs out, so the next
 *     poll starts it again;
 *   - a REFUSAL (no picture, unreadable, too big) is held for a few seconds so
 *     a poll can read its sentence; it is never cached as an answer;
 *   - if the answer could not be written to the cache, the finished job holds
 *     it in the marker for a few minutes, so polling never restarts the download.
 *
 * The work runs in this process, detached from the request that started it.
 */
import { createHash } from "node:crypto"
import { ClipMeasureError, measureClip, peekClip, type ClipMeasureErrorCode, type MeasuredClip, type MeasureClipOptions } from "./clip-measure.js"

export type ClipJobState =
  | { readonly status: "ready"; readonly clip: MeasuredClip }
  | { readonly status: "running" }
  | { readonly status: "failed"; readonly code: ClipMeasureErrorCode; readonly message: string }
  | { readonly status: "none" }

export interface ClipJobStore {
  readonly get: (key: string) => Promise<string | null>
  /** Set only if absent; true when this call set it. */
  readonly setNx: (key: string, value: string, ttlSeconds: number) => Promise<boolean>
  readonly set: (key: string, value: string, ttlSeconds: number) => Promise<void>
  readonly expire: (key: string, ttlSeconds: number) => Promise<void>
  readonly del: (key: string) => Promise<void>
}

export interface ClipJobDeps {
  readonly peek: (url: string) => Promise<MeasuredClip | null>
  readonly measure: (url: string, opts: MeasureClipOptions) => Promise<MeasuredClip>
  readonly store: ClipJobStore
  /** The most the download may write: the plan's upload size limit. */
  readonly maxBytes: number
  /** How often a running job renews its lease. */
  readonly heartbeatMs: number
}

/** The lease a running marker holds between renewals. */
const LEASE_SECONDS = 180
/** How long a refusal stays readable. */
const FAILED_SECONDS = 30
/** How long a finished answer that could not be cached is held by the job itself. */
const READY_SECONDS = 300

export const clipJobMarkerKey = (url: string): string => `clip-measure:job:v1:${createHash("sha256").update(url).digest("hex")}`

type Marker =
  | { readonly status: "running" }
  | { readonly status: "ready"; readonly clip: MeasuredClip }
  | { readonly status: "failed"; readonly code: ClipMeasureErrorCode; readonly message: string }

const CODES: readonly string[] = ["invalid-url", "unreadable", "no-picture", "unmeasured", "too-large"]

function parseMarker(raw: string | null): Marker | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as Partial<Marker>
    if (v.status === "running") return { status: "running" }
    if (v.status === "ready") {
      const clip = (v as { clip?: MeasuredClip }).clip
      if (clip && Number.isInteger(clip.durationMs) && clip.durationMs > 0) return { status: "ready", clip }
      return null
    }
    if (v.status === "failed" && typeof v.message === "string" && CODES.includes(String((v as { code?: unknown }).code))) {
      return { status: "failed", code: (v as { code: ClipMeasureErrorCode }).code, message: v.message }
    }
  } catch {
    // A marker that is junk is no marker.
  }
  return null
}

export interface ClipMeasureJob {
  /** What is known now, starting nothing. */
  poll(url: string): Promise<ClipJobState>
  /** Poll, and if nothing is known or running, start the measurement. */
  start(url: string): Promise<ClipJobState>
}

export function createClipMeasureJob(deps: ClipJobDeps): ClipMeasureJob {
  async function poll(url: string): Promise<ClipJobState> {
    try {
      const clip = await deps.peek(url)
      if (clip) return { status: "ready", clip }
    } catch {
      // A cache that is down is a miss.
    }
    let marker: Marker | null = null
    try {
      marker = parseMarker(await deps.store.get(clipJobMarkerKey(url)))
    } catch {
      marker = null
    }
    return marker ?? { status: "none" }
  }

  async function run(url: string): Promise<void> {
    const key = clipJobMarkerKey(url)
    const beat = setInterval(() => { deps.store.expire(key, LEASE_SECONDS).catch(() => undefined) }, deps.heartbeatMs)
    try {
      const clip = await deps.measure(url, { maxBytes: deps.maxBytes })
      // The answer normally sits in the measurement's own cache and the marker is
      // dropped. If the cache write failed, dropping the marker would read as
      // "nothing known" and the next poll would start the download again, so the
      // job holds the answer itself for a few minutes.
      const cached = await deps.peek(url).catch(() => null)
      if (cached) {
        await deps.store.del(key).catch(() => undefined)
      } else {
        const held: Marker = { status: "ready", clip }
        await deps.store.set(key, JSON.stringify(held), READY_SECONDS).catch(() => deps.store.del(key).catch(() => undefined))
      }
    } catch (err) {
      const marker: Marker = err instanceof ClipMeasureError
        ? { status: "failed", code: err.code, message: err.message }
        : { status: "failed", code: "unreadable", message: "Could not read this video. Check that the link works and the file is a video, then try again." }
      if (!(err instanceof ClipMeasureError)) console.warn(`[clip-measure-job] unexpected failure: ${err instanceof Error ? err.message : String(err)}`)
      await deps.store.set(key, JSON.stringify(marker), FAILED_SECONDS).catch(() => undefined)
    } finally {
      clearInterval(beat)
    }
  }

  async function start(url: string): Promise<ClipJobState> {
    const known = await poll(url)
    if (known.status !== "none") return known
    let won = false
    try {
      won = await deps.store.setNx(clipJobMarkerKey(url), JSON.stringify({ status: "running" }), LEASE_SECONDS)
    } catch {
      // No store to coordinate through: measure here anyway (the cache and the in-process share still apply).
      won = true
    }
    if (!won) {
      // Someone else holds the marker: report what they have (running, or just done).
      const now = await poll(url)
      return now.status === "none" ? { status: "running" } : now
    }
    void run(url)
    return { status: "running" }
  }

  return { poll, start }
}

/** The production wiring: `measureClip`'s cache and Redis for the marker. */
export function defaultClipJobDeps(maxBytes: number): ClipJobDeps {
  return {
    peek: (url) => peekClip(url),
    measure: (url, opts) => measureClip(url, undefined, opts),
    store: {
      get: async (key) => (await import("./queue.js")).redis.get(key),
      setNx: async (key, value, ttl) => (await (await import("./queue.js")).redis.set(key, value, "EX", ttl, "NX")) === "OK",
      set: async (key, value, ttl) => { await (await import("./queue.js")).redis.set(key, value, "EX", ttl) },
      expire: async (key, ttl) => { await (await import("./queue.js")).redis.expire(key, ttl) },
      del: async (key) => { await (await import("./queue.js")).redis.del(key) },
    },
    maxBytes,
    heartbeatMs: 60_000,
  }
}
