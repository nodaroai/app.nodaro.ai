/**
 * MEDIA PROXY — one cached, cheap-to-analyse rendition per source.
 *
 * WHY THIS EXISTS
 * The podcast-editing analysis nodes (`transcribe`, `silence-detect`,
 * `audio-sync`, `edit-plan`, later `speaker-frames`) must not each download and
 * decode a multi-GB original. They read a PROXY instead: a 16 kHz mono AAC
 * audio track, or a low-fps, low-height video for detection/review. The render nodes
 * (`apply-edl`, `speaker-view`) keep reading the ORIGINAL. This is what makes a
 * 90-minute episode analysable in minutes and keeps vendor uploads small.
 *
 * The proxy is content-addressed and cached in R2, so re-analysing the same
 * source is a HEAD, not a re-encode. This is a worker STEP (a plain async
 * function), not a node — callers invoke `ensureMediaProxy` when they need one.
 *
 * ffmpeg runs through `runFfmpeg`, which is already FIFO-semaphore-gated
 * (`withFfmpegSlot`), so a proxy encode shares the process-wide ffmpeg slot
 * budget with every other ffmpeg job. A 3-hour source can exceed the default
 * 10-minute per-spawn timeout, so this passes an explicit longer one.
 *
 * KEYING: the cache key is derived from the source IDENTITY — the R2 object key
 * for our own URLs (already content-addressed per job), else the URL string —
 * NOT a byte hash of the source (that would require downloading before the
 * cache check could run). So two different URLs serving byte-identical content
 * do not dedupe; the same source URL always hits. That is the right trade for
 * the common case; a byte/ETag-level key is a future refinement.
 *
 * VIDEO PROXIES (P3.2) can be span-scoped: `spans` samples only those stretches
 * of the source (Speaker Frames: the spans an EDL keeps, plus margins), and
 * every video proxy comes back with its SPAN MAP — the proxy→source clock built
 * from the frames actually written (`media-proxy-span-map.ts`). The map is
 * stored beside the proxy, so a cache hit returns the same clock; a proxy found
 * without its map is re-encoded, never served clockless. The encode itself is
 * `video-proxy-encode.ts`.
 *
 * Every video proxy also carries its SCENE CUTS (P3.2b), found in the same
 * decode and stored in the same manifest, on the source clock
 * (`media-proxy-cuts.ts`). The cut rule is part of the key, and a manifest
 * without cuts — or with another rule's — is a miss.
 */
import { createHash } from "node:crypto"
import { join } from "node:path"
import {
  createWorkDir,
  cleanupWorkDir,
  BIG_MEDIA_DOWNLOAD_LIMITS,
  downloadFile,
  hasAudioStream,
  runFfmpeg,
} from "../providers/video/ffmpeg-utils.js"
import { MEDIA_PROXY_FFMPEG_TIMEOUT_MS } from "../providers/video/ffmpeg-timeouts.js"
import { DeterministicJobError } from "../lib/deterministic-job-error.js"
import {
  getR2ObjectSize,
  r2KeyFromOurUrl,
  r2Url,
  readR2ObjectBuffer,
  uploadBufferToR2,
  uploadLocalFileToR2Key,
} from "../lib/storage.js"
import { encodeVideoProxy } from "./video-proxy-encode.js"
import { normalizeProxySpans, type ProxySpan, type ProxySpanMap } from "./media-proxy-span-map.js"
import { SCENE_CUT_RECIPE, isSceneCutList } from "./media-proxy-cuts.js"

export { MediaHasNoVideoError } from "./video-proxy-encode.js"

/** An AUDIO proxy was asked of a source with no audio track (a picture-only
 *  camera file). Checked on the downloaded file, before encoding — ffmpeg would
 *  otherwise fail with "Output file does not contain any stream". Deterministic:
 *  it depends only on the input, so a job that lets it propagate
 *  (silence-detect) fails once instead of re-downloading the file for every
 *  retry. A caller that can use the other sources (audio-sync) catches it by
 *  class. */
export class MediaHasNoAudioError extends DeterministicJobError {
  constructor(readonly sourceUrl: string) {
    super("the source has no audio track")
    this.name = "MediaHasNoAudioError"
  }
}

/** Kinds of proxy a caller can ask for. */
export type MediaProxyKind = "audio" | "video"

export interface MediaProxyResult {
  /** Public R2 URL of the cached proxy. */
  readonly url: string
  /** R2 object key. */
  readonly key: string
  readonly kind: MediaProxyKind
  /** True when the proxy already existed in R2 (no encode ran). */
  readonly cached: boolean
}

/** A video proxy also carries its clock and its frame. */
export interface VideoProxyResult extends MediaProxyResult {
  readonly kind: "video"
  readonly fps: number
  /** Proxy → source clock, from the frames actually written. One row for a whole-source proxy. */
  readonly spanMap: ProxySpanMap
  /** Display-oriented, square-pixel frame size: what box fractions refer to. */
  readonly frame: { readonly w: number; readonly h: number }
  readonly frameCount: number
  /** Scene cuts, ms on the SOURCE clock, ascending: a cut at `c` starts a new
   *  shot at `c`. Found in the decode that built the proxy, over the kept spans only. */
  readonly cuts: readonly number[]
}

export interface MediaProxyOptions {
  /** Video proxy frame rate. 2 fps for frame-by-frame detection, ~15 fps for
   *  review. Ignored for audio. Default 15. */
  readonly fps?: number
  /** Video only: output height in px, even, at most 2160. Default 360. A source
   *  shorter than this keeps its own height (never upscaled). */
  readonly height?: number
  /** Video only: sample just these stretches of the source (ms, source clock).
   *  Omitted = the whole source. Normalized (sorted, merged) before keying. */
  readonly spans?: readonly ProxySpan[]
  /** Override the per-spawn ffmpeg timeout (ms). Without it, an audio proxy, a
   *  whole-source video proxy and a span proxy's join run at
   *  `MEDIA_PROXY_FFMPEG_TIMEOUT_MS` (a ~3h source), and each span of a
   *  span-scoped video proxy at its own length-sized ceiling
   *  (`proxySpanEncodeTimeoutMs`). ANY value replaces all of those, the
   *  per-span ceilings included, so a caller whose budget counts per-span
   *  ceilings (`speaker-frames-budget.ts`) must not pass one. */
  readonly timeoutMs?: number
}

/** Audio proxy: 16 kHz mono AAC — everything a transcriber / silence pass needs. */
const AUDIO_PROXY = { sampleRateHz: 16_000, bitrate: "64k", ext: "m4a", contentType: "audio/mp4" } as const
/** Video proxy: 360p by default, low fps, no audio — for detection / review. */
const VIDEO_PROXY = { height: 360, maxHeight: 2160, defaultFps: 15, ext: "mp4", contentType: "video/mp4" } as const


/** The stable identity a proxy is keyed on: our own object key when the source
 *  is an R2 URL (content-addressed per job), else the URL verbatim. */
function sourceIdentity(sourceUrl: string): string {
  return r2KeyFromOurUrl(sourceUrl) ?? sourceUrl
}

/** Version of the AUDIO proxy's recipe, part of its key so a change to how it
 *  is made re-encodes once instead of serving the old file. v2 (2026-09-25)
 *  keeps the source's own clock — see `buildProxyArgs`. */
const AUDIO_PROXY_VERSION = 2

/** Version of the VIDEO proxy's recipe. v2 (2026-10-06, P3.2): span-scoped,
 *  height-keyed, square pixels, a sample grid anchored at each span's start,
 *  and a span map stored beside it. v3 (2026-10-08, P3.2b): scene cuts found
 *  in the same decode, stored in the manifest; the key also names the cut
 *  rule (`-sc<SCENE_CUT_RECIPE>`). */
const VIDEO_PROXY_VERSION = 3

const sha = (text: string, chars: number) => createHash("sha256").update(text).digest("hex").slice(0, chars)

/** Content-addressed cache key. The variant (kind + fps + height + the
 *  scene-cut rule + spans for video, the recipe version for audio) is part of
 *  the key so an audio proxy, a 2-fps detection proxy, a 15-fps review proxy
 *  and two different span sets of the same source never collide. Spans are normalized first, so equivalent
 *  span lists share one proxy. */
export function mediaProxyKey(
  sourceUrl: string,
  kind: MediaProxyKind,
  opts: Pick<MediaProxyOptions, "fps" | "height" | "spans"> = {},
): string {
  let variant = `audio-v${AUDIO_PROXY_VERSION}`
  if (kind === "video") {
    const fps = opts.fps ?? VIDEO_PROXY.defaultFps
    variant = `video-v${VIDEO_PROXY_VERSION}@${fps}fps-${opts.height ?? VIDEO_PROXY.height}p-sc${SCENE_CUT_RECIPE}`
    if (opts.spans) variant += `-spans-${sha(JSON.stringify(normalizeProxySpans(opts.spans, fps)), 16)}`
  }
  const hash = sha(`${sourceIdentity(sourceUrl)}::${variant}`, 40)
  const ext = kind === "audio" ? AUDIO_PROXY.ext : VIDEO_PROXY.ext
  return `proxies/${hash}/${variant}.${ext}`
}

/** Where a video proxy's span map lives: beside it, same name, `.json`. */
export function mediaProxyManifestKey(proxyKey: string): string {
  return proxyKey.replace(/\.[^./]+$/, ".json")
}

/** What is stored beside a video proxy. Version 2 (P3.2b) adds the cuts and
 *  the rule that found them; a version 1 manifest is a miss. */
interface VideoProxyManifest {
  readonly version: 2
  readonly fps: number
  readonly height: number
  readonly spans: readonly ProxySpan[] | null
  readonly spanMap: ProxySpanMap
  readonly frame: { readonly w: number; readonly h: number }
  readonly frameCount: number
  readonly cuts: readonly number[]
  readonly cutRecipe: string
}

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)

/** The stored manifest, or null when it is missing or not one we wrote. */
function parseManifest(body: Buffer | null): VideoProxyManifest | null {
  if (!body) return null
  try {
    const m = JSON.parse(body.toString("utf8")) as Partial<VideoProxyManifest>
    const rowsOk = Array.isArray(m.spanMap) && m.spanMap.length > 0 && m.spanMap.every((r) =>
      [r?.proxyStartMs, r?.proxyEndMs, r?.sourceStartMs, r?.firstFrame, r?.frameCount].every(isFiniteNumber))
    if (m.version !== 2 || !rowsOk || !isFiniteNumber(m.frameCount) || !isFiniteNumber(m.frame?.w) || !isFiniteNumber(m.frame?.h)) return null
    // The cuts this key promises: found by this rule, a valid list.
    if (m.cutRecipe !== SCENE_CUT_RECIPE || !isSceneCutList(m.cuts)) return null
    return m as VideoProxyManifest
  } catch {
    return null
  }
}

/** Validate the video options up front — before any download. */
function videoOptions(opts: MediaProxyOptions): { fps: number; height: number; spans?: ProxySpan[] } {
  const fps = opts.fps ?? VIDEO_PROXY.defaultFps
  if (!(Number.isFinite(fps) && fps > 0 && fps <= 60)) throw new DeterministicJobError(`media proxy: fps ${fps} is not in (0, 60]`)
  const height = opts.height ?? VIDEO_PROXY.height
  if (!(Number.isInteger(height) && height > 0 && height % 2 === 0 && height <= VIDEO_PROXY.maxHeight)) {
    throw new DeterministicJobError(`media proxy: height ${height} must be an even number of pixels up to ${VIDEO_PROXY.maxHeight}`)
  }
  return { fps, height, spans: opts.spans ? normalizeProxySpans(opts.spans, fps) : undefined }
}

/** The AUDIO proxy's ffmpeg arguments (the video proxy's are in
 *  `video-proxy-encode.ts`). Exported for the real-ffmpeg tests. */
export function buildProxyArgs(kind: "audio", src: string, out: string): string[] {
  return [
    "-y", "-i", src,
    "-vn", // drop video
    // Keep the SOURCE's clock (the one apply-edl cuts on): a file whose audio
    // starts after its picture (a stream-copy trim, a camera's late mic), or
    // that drops samples mid-stream (a recorder losing 40 ms at a time), has
    // gaps the encoder would close — so every time read off the proxy
    // (audio-sync's offsets, silence ranges) slid early by them. Fill every
    // gap from 10 ms with silence (drop any overlap) so proxy time = source
    // time; jitter under 10 ms is left alone, never warped. Measured on the
    // pinned 8.1.2: normal files unchanged sample for sample; late audio,
    // mid-stream gaps and staircase dropouts within 10 ms of apply-edl's read.
    "-af", "aresample=async=1:min_hard_comp=0.01:first_pts=0",
    "-ac", "1",
    "-ar", String(AUDIO_PROXY.sampleRateHz),
    "-c:a", "aac", "-b:a", AUDIO_PROXY.bitrate,
    out,
  ]
}

/**
 * Return a cached proxy of `sourceUrl`, generating and caching it on first use.
 * Idempotent and safe to call from many workers: concurrent misses both encode
 * and both write the SAME content-addressed key (last write wins, content is
 * equivalent) — a benign race, not corruption.
 */
export async function ensureMediaProxy(sourceUrl: string, kind: "audio", opts?: MediaProxyOptions): Promise<MediaProxyResult>
export async function ensureMediaProxy(sourceUrl: string, kind: "video", opts?: MediaProxyOptions): Promise<VideoProxyResult>
export async function ensureMediaProxy(
  sourceUrl: string,
  kind: MediaProxyKind,
  opts?: MediaProxyOptions,
): Promise<MediaProxyResult | VideoProxyResult>
export async function ensureMediaProxy(
  sourceUrl: string,
  kind: MediaProxyKind,
  opts: MediaProxyOptions = {},
): Promise<MediaProxyResult | VideoProxyResult> {
  if (kind === "video") return ensureVideoProxy(sourceUrl, opts)
  if (opts.spans !== undefined || opts.height !== undefined) {
    throw new Error("media proxy: `spans` and `height` apply to a video proxy only")
  }
  const key = mediaProxyKey(sourceUrl, "audio")

  // Cache check: a HEAD, not a download.
  if (await getR2ObjectSize(key) > 0) {
    return { url: r2Url(key), key, kind, cached: true }
  }

  const workDir = await createWorkDir("media-proxy")
  try {
    const src = join(workDir, "source")
    // The ORIGINAL behind a proxy is big media: the staged limits (Track 0.19).
    await downloadFile(sourceUrl, src, { limits: BIG_MEDIA_DOWNLOAD_LIMITS })
    if (!(await hasAudioStream(src))) throw new MediaHasNoAudioError(sourceUrl)
    const out = join(workDir, `proxy.${AUDIO_PROXY.ext}`)
    await runFfmpeg(buildProxyArgs("audio", src, out), opts.timeoutMs ?? MEDIA_PROXY_FFMPEG_TIMEOUT_MS)
    const url = await uploadLocalFileToR2Key(out, key, AUDIO_PROXY.contentType)
    return { url, key, kind, cached: false }
  } finally {
    await cleanupWorkDir(workDir)
  }
}

async function ensureVideoProxy(sourceUrl: string, opts: MediaProxyOptions): Promise<VideoProxyResult> {
  const { fps, height, spans } = videoOptions(opts)
  const key = mediaProxyKey(sourceUrl, "video", { fps, height, spans })
  const manifestKey = mediaProxyManifestKey(key)

  // Cache check: the proxy AND its clock, or it is a miss.
  if (await getR2ObjectSize(key) > 0) {
    const manifest = parseManifest(await readR2ObjectBuffer(manifestKey))
    if (manifest) {
      return {
        url: r2Url(key), key, kind: "video", cached: true, fps,
        spanMap: manifest.spanMap, frame: manifest.frame, frameCount: manifest.frameCount, cuts: manifest.cuts,
      }
    }
  }

  const workDir = await createWorkDir("media-proxy")
  try {
    const src = join(workDir, "source")
    await downloadFile(sourceUrl, src, { limits: BIG_MEDIA_DOWNLOAD_LIMITS })
    const encoded = await encodeVideoProxy(src, workDir, { fps, height, spans, timeoutMs: opts.timeoutMs })
    // The proxy first, its map second: a crash between the two leaves a proxy
    // with no map, which the cache check above reads as a miss.
    const url = await uploadLocalFileToR2Key(encoded.outPath, key, VIDEO_PROXY.contentType)
    const manifest: VideoProxyManifest = {
      version: 2, fps, height, spans: spans ?? null,
      spanMap: encoded.spanMap, frame: encoded.frame, frameCount: encoded.frameCount,
      cuts: encoded.cuts, cutRecipe: SCENE_CUT_RECIPE,
    }
    await uploadBufferToR2(Buffer.from(JSON.stringify(manifest)), manifestKey, "application/json")
    return {
      url, key, kind: "video", cached: false, fps,
      spanMap: encoded.spanMap, frame: encoded.frame, frameCount: encoded.frameCount, cuts: encoded.cuts,
    }
  } finally {
    await cleanupWorkDir(workDir)
  }
}
