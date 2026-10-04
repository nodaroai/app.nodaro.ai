/**
 * Video Analysis given a post's LINK (a YouTube, TikTok, Instagram, X or
 * Facebook post in its link field — typed, mapped, or wired from a trigger):
 * read the post's length before anything is reserved, so the run is priced by
 * the post's own duration bucket instead of the 600 s ceiling, and a live or
 * over-long post is refused for free.
 *
 * The probe is the hardened social-post lane's (`probeSocialPostVideo`): a
 * link that is not one post on a platform we read is left to the worker's own
 * refusal, unprobed. A probe that fails (a block, a timeout, a post nobody
 * can read) refuses nothing: the run is priced at the ceiling, as a link
 * without a length always was, and a post the worker cannot fetch fails there
 * and is refunded.
 *
 * A Social Search post that came with its own video file is read the same way
 * from that file (ffprobe, behind the same SSRF guard as every probed URL):
 * the post's own claim about its length is never what prices the run. A post
 * whose file link has expired is refused by name before anything is created.
 *
 * Only where credits are charged (the length prices the run); answers are
 * cached for ten minutes by the post's canonical link; at most a few probes
 * run at once in one process, so a burst of triggered runs cannot fan out
 * into a burst of yt-dlp processes.
 */
import { createHash } from "node:crypto"
import { VIDEO_ANALYSIS_DURATION_TOLERANCE_SEC, VIDEO_ANALYSIS_MAX_DURATION_SEC } from "@nodaro/shared"
import { hasCredits } from "../../lib/config.js"
import { redis } from "../../lib/queue.js"
import { probeMediaDuration } from "../../providers/video/ffmpeg-utils.js"
import { probeSocialPostVideo, socialPostOf, type SocialPostMetadata } from "../../providers/video/social-post-video.js"
import type { ResolvedInputs, SimpleNode } from "./types.js"

/** A refusal the node state carries by code, with a sentence the person can act on. */
export class VideoAnalysisPostError extends Error {
  constructor(
    readonly errorCode: "live_stream_not_supported" | "video_too_long" | "post_video_expired" | "post_has_no_video" | "post_video_unreadable",
    message: string,
  ) {
    super(message)
    this.name = "VideoAnalysisPostError"
  }
}

/** What the probe step reads through; the defaults are the real ones. */
export interface PostProbeDeps {
  readonly probe: (url: string) => Promise<SocialPostMetadata>
  /** The length of a video FILE (a Social Search post's own), in seconds. */
  readonly probeFile: (url: string) => Promise<number>
  readonly cache: {
    get(key: string): Promise<string | null>
    set(key: string, value: string, ttlSec: number): Promise<unknown>
  }
  readonly enabled: () => boolean
}

const CACHE_TTL_SEC = 10 * 60
/** The cache answers fast or not at all: its client retries forever during an outage. */
const CACHE_WAIT_MS = 500
const PROBE_CONCURRENCY = 4
/** Waiting longer than this for a probe slot prices the run at the ceiling instead. */
export const PROBE_SLOT_WAIT_MS = 10_000

const redisCache: PostProbeDeps["cache"] = {
  get: (key) => redis.get(key),
  set: (key, value, ttlSec) => redis.set(key, value, "EX", ttlSec),
}

const DEFAULT_DEPS: PostProbeDeps = {
  probe: probeSocialPostVideo,
  probeFile: probeMediaDuration,
  cache: redisCache,
  enabled: hasCredits,
}

/** `work`, or a rejection once `ms` pass first. */
function within<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} took longer than ${ms}ms`)), ms)
  })
  return Promise.race([work, late]).finally(() => clearTimeout(timer))
}

interface Waiter {
  readonly take: () => void
  done: boolean
}
let running = 0
const waiting: Waiter[] = []

/**
 * At most `PROBE_CONCURRENCY` probes at once: a finished one hands its slot to
 * the next one still waiting. A probe that waits past `PROBE_SLOT_WAIT_MS`
 * gives up its place and fails (the caller prices the run at the ceiling).
 */
async function withProbeSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (running < PROBE_CONCURRENCY) {
    running++
  } else {
    await new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const waiter: Waiter = {
        take: () => {
          clearTimeout(timer)
          resolve()
        },
        done: false,
      }
      timer = setTimeout(() => {
        if (waiter.done) return
        waiter.done = true
        reject(new Error(`no probe slot within ${PROBE_SLOT_WAIT_MS}ms`))
      }, PROBE_SLOT_WAIT_MS)
      waiting.push(waiter)
    })
  }
  try {
    return await fn()
  } finally {
    let next = waiting.shift()
    while (next?.done) next = waiting.shift()
    if (next) {
      next.done = true
      next.take()
    } else {
      running--
    }
  }
}

/** One probe per link at a time: a second run asking for the same post waits for the first's answer. */
const inFlight = new Map<string, Promise<SocialPostMetadata>>()

async function cachedRead(key: string, deps: PostProbeDeps): Promise<SocialPostMetadata | null> {
  try {
    const hit = await within(deps.cache.get(key), CACHE_WAIT_MS, "the probe cache")
    return hit ? (JSON.parse(hit) as SocialPostMetadata) : null
  } catch {
    // A cache that cannot answer is a miss.
    return null
  }
}

async function cachedProbe(
  url: string,
  deps: PostProbeDeps,
  probe: (url: string) => Promise<SocialPostMetadata> = deps.probe,
): Promise<SocialPostMetadata> {
  const key = `va:post-probe:${createHash("sha256").update(url).digest("hex")}`
  const hit = await cachedRead(key, deps)
  if (hit) return hit
  const pending = inFlight.get(key)
  if (pending) return pending
  const probing = withProbeSlot(async () => (await cachedRead(key, deps)) ?? probe(url))
    .then(async (meta) => {
      try {
        await within(deps.cache.set(key, JSON.stringify(meta), CACHE_TTL_SEC), CACHE_WAIT_MS, "the probe cache")
      } catch {
        // Best effort: the answer stands whether or not it was kept.
      }
      return meta
    })
    .finally(() => inFlight.delete(key))
  inFlight.set(key, probing)
  return probing
}

/** The refusal for a Social Search post whose video link has expired. */
export const POST_VIDEO_EXPIRED_MESSAGE =
  "This post's video link has expired (a search's video links last a few days). Run the Social Search again to get fresh ones."

/** The refusal for a Social Search post that is an image or a text post. */
export const POST_NO_VIDEO_MESSAGE = "This post has no video to analyze (it is an image or a text post)."

/** The refusal for a Social Search post whose video cannot be read or gives no length. */
export const POST_UNREADABLE_MESSAGE =
  "This post's video could not be read: the platform did not say how long it is, or refused it. Run the Social Search again, or download the video and upload it."

/** A probed length in whole seconds; a video past the ceiling is refused, free. */
function lengthOrRefusal(durationSec: number | null): number | null {
  if (durationSec === null) return null
  if (durationSec > VIDEO_ANALYSIS_MAX_DURATION_SEC + VIDEO_ANALYSIS_DURATION_TOLERANCE_SEC) {
    throw new VideoAnalysisPostError(
      "video_too_long",
      `This post's video is ${Math.ceil(durationSec)} seconds long; Video Analysis reads up to ${VIDEO_ANALYSIS_MAX_DURATION_SEC}.`,
    )
  }
  return Math.ceil(durationSec)
}

/**
 * A Social Search post's own video file, by the length read from the file.
 * A file that cannot be read is refused, free — as the editor's route refuses
 * it — rather than priced at the ceiling.
 */
async function postFileDuration(url: string, deps: PostProbeDeps): Promise<number> {
  let durationSec: number | null = null
  try {
    const meta = await cachedProbe(url, deps, async (fileUrl) => ({ durationSec: await deps.probeFile(fileUrl), title: null, isLive: false }))
    durationSec = meta.durationSec
  } catch (err) {
    const why = (err instanceof Error ? err.message : String(err)).split("\n")[0]
    console.warn(`[video-analysis] social search post's video file probe failed (${why}); refused`)
  }
  const length = lengthOrRefusal(durationSec)
  if (length === null) throw new VideoAnalysisPostError("post_video_unreadable", POST_UNREADABLE_MESSAGE)
  return length
}

/**
 * The post's length in whole seconds when Video Analysis will read a post's
 * link or a Social Search post's own video file; null when it reads something
 * else (another wired or typed video file, a length already known, a link
 * that is not a post), when credits are not charged, or when the length
 * cannot be read (the ceiling prices it). Throws a VideoAnalysisPostError for
 * a post it refuses: live, too long, or a Social Search post whose video link
 * has expired (on every install, charged or not).
 */
export async function videoAnalysisPostDuration(
  node: SimpleNode,
  resolvedInputs: ResolvedInputs,
  deps: PostProbeDeps = DEFAULT_DEPS,
): Promise<number | null> {
  if (node.type !== "video-analysis") return null
  if (resolvedInputs.socialPostVideoExpired && !resolvedInputs.videoUrl && !resolvedInputs.videoPageUrl) {
    throw new VideoAnalysisPostError("post_video_expired", POST_VIDEO_EXPIRED_MESSAGE)
  }
  if (resolvedInputs.socialPostNoVideo && !resolvedInputs.videoUrl && !resolvedInputs.videoPageUrl) {
    throw new VideoAnalysisPostError("post_has_no_video", POST_NO_VIDEO_MESSAGE)
  }
  if (!deps.enabled()) return null
  const data = node.data as Record<string, unknown>
  // A length the run already knows is the trusted one.
  if (resolvedInputs.videoDuration !== undefined) return null
  if (resolvedInputs.videoUrl && resolvedInputs.videoFromSocialPost) return postFileDuration(resolvedInputs.videoUrl, deps)
  // Any other video file wins over a link (the worker's own precedence).
  if (resolvedInputs.videoUrl || (typeof data.videoUrl === "string" && data.videoUrl !== "")) return null
  // The link the payload will carry: one wired into the `video` handle, else the node's own field.
  const link = (resolvedInputs.videoPageUrl ?? (typeof data.youtubeUrl === "string" ? data.youtubeUrl : "")).trim()
  const post = link ? socialPostOf(link) : null
  if (!post) return null

  // A Social Search post's page: a page that cannot be read, or gives no
  // length, is refused (free) — never priced at the ceiling — as the editor's
  // route refuses it.
  const fromSearch = resolvedInputs.videoPageFromSocialPost === true && resolvedInputs.videoPageUrl !== undefined
  let meta: SocialPostMetadata
  try {
    meta = await cachedProbe(post.url, deps)
  } catch (err) {
    const why = (err instanceof Error ? err.message : String(err)).split("\n")[0]
    if (fromSearch) {
      console.warn(`[video-analysis] ${post.platform} social search post probe failed (${why}); refused`)
      throw new VideoAnalysisPostError("post_video_unreadable", POST_UNREADABLE_MESSAGE)
    }
    console.warn(`[video-analysis] ${post.platform} post probe failed (${why}); priced at the ceiling`)
    // The editor's own read of the same YouTube link stands in (it reads only
    // YouTube); else the ceiling.
    const probed = data.probedYoutube as { url?: unknown; durationSec?: unknown } | undefined
    return post.platform === "youtube" && probed?.url === link && typeof probed.durationSec === "number" ? Math.ceil(probed.durationSec) : null
  }
  if (meta.isLive) {
    throw new VideoAnalysisPostError("live_stream_not_supported", "This post is a live stream, which cannot be analyzed.")
  }
  if (fromSearch && meta.durationSec === null) throw new VideoAnalysisPostError("post_video_unreadable", POST_UNREADABLE_MESSAGE)
  return lengthOrRefusal(meta.durationSec)
}
