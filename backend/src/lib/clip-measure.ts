/**
 * The ONE measurement of a clip for Speaker View's Video input (decided
 * 2026-10-11, D16): how long its picture really runs, and how many pixels it
 * has. The editor's run, the server's run and the REST route all call this, so
 * they build the same one-clip edit.
 *
 * The length is the picture track's REAL end, read from its own packets after
 * the file is downloaded behind the SSRF guard (`downloadFile` → `safeFetch`)
 * — never the container's declared duration, which a VBR audio file, a
 * live-muxed WebM or a joined transport stream gets wrong. A too-long length is
 * billed per output minute and read past the last frame, and nothing
 * downstream corrects it, so a clip whose end cannot be measured is REFUSED,
 * not guessed.
 *
 * The same pass records whether the clip shows a face (decided 2026-10-12, R2):
 * a few sampled frames through the existing detector. `faces` is `"unknown"`
 * when the host cannot look; only a node that opts in refuses on `"none"`.
 *
 * Cost is a download of the file and a demux (no decode of the whole file). The answer is cached
 * per address in Redis (several instances share it) and concurrent callers in
 * one process share a single measurement; a failure is never cached. The
 * download uses the staged big-media limits (a drip-feed fails within a minute;
 * a fast source cannot fill the disk).
 */
import { createHash } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { safeUrlSchema } from "./url-validator.js"

export type ClipFaces = "present" | "none" | "unknown"

export interface MeasuredClip {
  /** The picture track's real end, in whole milliseconds. */
  readonly durationMs: number
  /** The picture's displayed size (after a quarter-turn rotation); absent when it could not be read. */
  readonly width?: number
  readonly height?: number
  /** Whether the sampled frames show a face; absent on a host with no face look at all. */
  readonly faces?: ClipFaces
}

export type ClipMeasureErrorCode = "invalid-url" | "unreadable" | "no-picture" | "unmeasured" | "too-large"

/** A measurement that cannot be made, with a sentence a person can act on. */
export class ClipMeasureError extends Error {
  constructor(readonly code: ClipMeasureErrorCode, message: string) {
    super(message)
    this.name = "ClipMeasureError"
  }
}

type TrackEndLike =
  | { readonly state: "absent" }
  | { readonly state: "measured"; readonly endSec: number }
  | { readonly state: "unmeasured"; readonly reason: string }

export interface ClipMeasureDeps {
  readonly download: (url: string, dest: string, opts?: { readonly maxBytes?: number }) => Promise<void>
  readonly streamEnds: (path: string) => Promise<{ readonly video: TrackEndLike; readonly audio: TrackEndLike }>
  readonly frameSize: (path: string) => Promise<{ readonly width: number; readonly height: number }>
  /** Looks at a few frames of the downloaded file; absent where the host cannot (the measurement then has no `faces`). */
  readonly facePresence?: (path: string, clip: { readonly durationMs: number; readonly width?: number; readonly height?: number }) => Promise<ClipFaces>
  readonly cacheGet: (key: string) => Promise<string | null>
  readonly cacheSet: (key: string, value: string, ttlSeconds: number) => Promise<void>
}

const CACHE_TTL_SECONDS = 60 * 60

export const clipCacheKey = (url: string): string => `clip-measure:v2:${createHash("sha256").update(url).digest("hex")}`

/** The displayed size from an ffprobe `-of json` listing of the first picture stream. */
export function parseFrameSize(listingJson: string): { width: number; height: number } {
  let parsed: { streams?: Array<{ width?: unknown; height?: unknown; tags?: { rotate?: unknown }; side_data_list?: Array<{ rotation?: unknown }> }> }
  try {
    parsed = JSON.parse(listingJson)
  } catch {
    throw new Error("clip-measure: ffprobe size listing is not JSON")
  }
  const stream = parsed.streams?.[0]
  const width = Number(stream?.width)
  const height = Number(stream?.height)
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new Error("clip-measure: ffprobe size listing has no picture size")
  }
  const turned = [Number(stream?.tags?.rotate), ...(stream?.side_data_list ?? []).map((d) => Number(d.rotation))]
    .filter((r) => Number.isFinite(r))
    .some((r) => Math.abs(Math.round(r)) % 180 === 90)
  return turned ? { width: height, height: width } : { width, height }
}

const inflight = new Map<string, Promise<MeasuredClip>>()

const FACES: readonly unknown[] = ["present", "none", "unknown"]

const isMeasured = (v: unknown): v is MeasuredClip =>
  !!v &&
  typeof v === "object" &&
  Number.isInteger((v as MeasuredClip).durationMs) &&
  (v as MeasuredClip).durationMs > 0 &&
  ((v as MeasuredClip).faces === undefined || FACES.includes((v as MeasuredClip).faces))

export interface MeasureClipOptions {
  /** The most the download may write (the plan's upload size limit, on the route). */
  readonly maxBytes?: number
}

const TOO_LARGE = /^Download exceeds (\d+) MB/

const tooLarge = (err: unknown, maxBytes: number | undefined): ClipMeasureError | undefined => {
  const hit = TOO_LARGE.exec(err instanceof Error ? err.message : String(err))
  if (!hit) return undefined
  const mb = hit[1] ?? (maxBytes ? String(Math.round(maxBytes / (1024 * 1024))) : "")
  return new ClipMeasureError("too-large", `This video is over the ${mb} MB limit, so it cannot be checked. Use a smaller file.`)
}

async function measureUncached(url: string, deps: ClipMeasureDeps, opts: MeasureClipOptions): Promise<MeasuredClip> {
  const dir = await mkdtemp(join(tmpdir(), "clip-measure-"))
  const path = join(dir, "clip.mp4")
  try {
    try {
      await deps.download(url, path, opts.maxBytes === undefined ? undefined : { maxBytes: opts.maxBytes })
    } catch (err) {
      const big = tooLarge(err, opts.maxBytes)
      if (big) throw big
      console.warn(`[clip-measure] download failed: ${err instanceof Error ? err.message : String(err)}`)
      throw new ClipMeasureError("unreadable", "Could not read this video. Check that the link works and the file is a video, then run again.")
    }
    let ends: Awaited<ReturnType<ClipMeasureDeps["streamEnds"]>>
    try {
      ends = await deps.streamEnds(path)
    } catch (err) {
      console.warn(`[clip-measure] demux failed: ${err instanceof Error ? err.message : String(err)}`)
      throw new ClipMeasureError("unreadable", "Could not read this video. Check that the file is a video that plays, then run again.")
    }
    if (ends.video.state === "absent") throw new ClipMeasureError("no-picture", "This file has no picture, so Speaker View has nothing to frame.")
    if (ends.video.state !== "measured" || !(ends.video.endSec > 0)) {
      throw new ClipMeasureError("unmeasured", "Could not tell exactly how long this video runs, so Speaker View cannot cut it. Re-export it as an MP4 and try again.")
    }
    const durationMs = Math.floor(ends.video.endSec * 1000)
    if (durationMs < 1) throw new ClipMeasureError("unmeasured", "This video is too short to cut.")
    let size: { width: number; height: number } | undefined
    try {
      size = await deps.frameSize(path)
    } catch {
      size = undefined
    }
    const clip = { durationMs, ...(size ?? {}) }
    let faces: ClipFaces | undefined
    if (deps.facePresence) {
      try {
        faces = await deps.facePresence(path, clip)
      } catch (err) {
        console.warn(`[clip-measure] face look failed: ${err instanceof Error ? err.message : String(err)}`)
        faces = "unknown"
      }
    }
    return { ...clip, ...(faces ? { faces } : {}) }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

/** The cached measurement for an address, or null: reads the cache only, never downloads. */
export async function peekClip(url: string, deps: Pick<ClipMeasureDeps, "cacheGet"> = defaultDeps()): Promise<MeasuredClip | null> {
  if (!safeUrlSchema.safeParse(url).success) return null
  try {
    const hit = await deps.cacheGet(clipCacheKey(url))
    if (hit) {
      const cached: unknown = JSON.parse(hit)
      if (isMeasured(cached)) return cached
    }
  } catch {
    // A cache that is down or holds junk is just a miss.
  }
  return null
}

/**
 * The clip's measured length and size. Throws `ClipMeasureError` (a plain
 * sentence in `message`) when it cannot be measured.
 */
export async function measureClip(url: string, deps: ClipMeasureDeps = defaultDeps(), opts: MeasureClipOptions = {}): Promise<MeasuredClip> {
  const checked = safeUrlSchema.safeParse(url)
  if (!checked.success) throw new ClipMeasureError("invalid-url", "That video address cannot be used. Use a public http(s) link to a video file.")
  const key = clipCacheKey(url)
  try {
    const hit = await deps.cacheGet(key)
    if (hit) {
      const cached: unknown = JSON.parse(hit)
      if (isMeasured(cached)) return cached
    }
  } catch {
    // A cache that is down or holds junk is just a miss.
  }
  // The cap is part of the identity of an in-flight measurement: a caller with a
  // cap must not inherit (and so bypass the cap of) one started without it.
  const flightKey = `${key}|${opts.maxBytes ?? "uncapped"}`
  const running = inflight.get(flightKey)
  if (running) return running
  const job = measureUncached(url, deps, opts)
    .then(async (measured) => {
      try {
        await deps.cacheSet(key, JSON.stringify(measured), CACHE_TTL_SECONDS)
      } catch {
        // Cached for the next caller only if the cache is up.
      }
      return measured
    })
    .finally(() => { inflight.delete(flightKey) })
  inflight.set(flightKey, job)
  return job
}

/** The production wiring: the guarded big-media download, the demux, ffprobe and Redis. */
function defaultDeps(): ClipMeasureDeps {
  return {
    download: async (url, dest, opts) => {
      const { downloadFile, BIG_MEDIA_DOWNLOAD_LIMITS } = await import("../providers/video/ffmpeg-utils.js")
      await downloadFile(url, dest, { limits: BIG_MEDIA_DOWNLOAD_LIMITS, ...(opts?.maxBytes !== undefined ? { maxBytes: opts.maxBytes } : {}) })
    },
    facePresence: async (path, clip) => {
      const { detectFacePresence } = await import("../services/face-detect/face-presence.js")
      return detectFacePresence(path, clip)
    },
    streamEnds: async (path) => {
      const { probeStreamEnds } = await import("../providers/video/ffmpeg-utils.js")
      return probeStreamEnds(path)
    },
    frameSize: async (path) => {
      const { runFfprobe } = await import("../providers/video/ffmpeg-utils.js")
      const out = await runFfprobe([
        "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height:stream_tags=rotate:stream_side_data=rotation",
        "-of", "json",
        path,
      ])
      return parseFrameSize(out)
    },
    cacheGet: async (key) => {
      const { redis } = await import("./queue.js")
      return redis.get(key)
    },
    cacheSet: async (key, value, ttlSeconds) => {
      const { redis } = await import("./queue.js")
      await redis.set(key, value, "EX", ttlSeconds)
    },
  }
}
