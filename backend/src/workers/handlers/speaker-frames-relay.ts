/**
 * Speaker Frames from a connected self-host (P3.6; P3-15 (a), P3-23 (b),
 * decided 2026-10-06; the relay contract decided 2026-10-09).
 *
 * BEFORE THE RELAY (`speakerFramesRelayPayload`):
 *  - nodaro.ai must take a relayed job at all (`speakerFramesRelaySupport`):
 *    until its plugin accepts the proxies and the relayed marker, the job
 *    fails once with "not available on a connected install yet" (a JSON-written
 *    node reaches the worker without the route, so the worker asks too). An
 *    install with no connection is told to connect, and one whose credential
 *    nodaro.ai rejects (401/403) to reconnect — both once, in the route's words
 *    (`speakerFramesRelayRefusal`). Only an unreachable nodaro.ai is
 *    transient: the queue retries.
 *  - The self-host builds the DETECTION PROXIES itself (core
 *    `ensureMediaProxy`, keyless on every edition) over exactly the spans the
 *    plugin would sample (`speakerFramesScope`, the plugin's scope verbatim),
 *    and relays them — URL, span map, scene cuts and frame — in place of the
 *    originals: a 540p 2 fps proxy of three hours is tens of MB. They are the
 *    only media sent, so they are the only media sized: one over the re-host
 *    cap is refused before ANY is uploaded, naming its camera. Each sampled
 *    source's `url` in the edit names its proxy. `relayed: true` tells the
 *    cloud it has no original, and it skips mouth-motion attribution with a
 *    note (P3-23 (b)).
 *  - Every source it does NOT sample (the master audio, an unticked camera, a
 *    non-video source) keeps its place in the edit — the edit stays whole for
 *    shared's `validateEdl` — but its `url` is the UNSAMPLED PLACEHOLDER
 *    (`speakerFramesUnsampledUrl`, round 2, decided 2026-10-09): nodaro.ai's
 *    relayed path never reads an edit's source URLs (the proxy is the media),
 *    so the original is neither sized, uploaded nor named to the cloud.
 *
 * AFTER THE RUN (`bringTrackSetHome`): the track file nodaro.ai wrote is copied
 * into THIS install's storage under the local job's own key
 * (`speaker-tracks/<jobId>.json`), its bytes re-checked against the
 * descriptor's sha256 and size, and the descriptor's `url` pointed at the copy
 * — so the file expires and is expunged with the install's own job, never
 * depending on the cloud's copy. POST-PROVIDER: nodaro.ai has billed the run,
 * so a failure here never refunds.
 */
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import {
  SPEAKER_FRAMES_PROXY_HEIGHT,
  SPEAKER_FRAMES_SAMPLE_FPS,
  coerceSpeakerFramesEdits,
  speakerFramesScope,
} from "@nodaro/render-rules"
import { SPEAKER_TRACKS_MAX_BYTES, type Edl } from "@nodaro/shared"
import { DeterministicJobError } from "../../lib/deterministic-job-error.js"
import { runPostProcessing } from "../../lib/post-processing-error.js"
import {
  speakerFramesRelayRefusal,
  speakerFramesRelaySupport,
  type SpeakerFramesRelayAnswer,
} from "../../lib/private-plugins/speaker-frames-relay-support.js"
import { MAX_REHOST_BYTES } from "../../providers/nodaro/rehost-limit.js"
import { relayedProxySizeMessage, type RehostByteSizeProbe, type RehostSizeHit } from "../../lib/rehost-size-check.js"
import { NodaroCloudError, ensureCloudReachableMediaUrl, rehostByteSize } from "../../providers/nodaro/client.js"
import type { VideoProxyResult } from "../../services/media-proxy.js"
import { speakerFramesUnsampledUrl } from "../../lib/speaker-frames-unsampled-url.js"

export { SPEAKER_FRAMES_UNSAMPLED_URL_BASE, isSpeakerFramesUnsampledUrl, speakerFramesUnsampledUrl } from "../../lib/speaker-frames-unsampled-url.js"

export interface SpeakerFramesRelayDeps {
  readonly relaySupport: () => Promise<SpeakerFramesRelayAnswer>
  readonly ensureProxy: (url: string, opts: { fps: number; height: number; spans?: ReadonlyArray<{ startMs: number; endMs: number }> }) => Promise<VideoProxyResult>
  /** A URL nodaro.ai can read (our own storage re-hosted; public passes through). */
  readonly toCloud: (url: string) => Promise<string>
  /** The size the re-host would send for a URL (`undefined`: not re-hosted, or unknown). */
  readonly probeSize: RehostByteSizeProbe
}

const defaultDeps: SpeakerFramesRelayDeps = {
  relaySupport: () => speakerFramesRelaySupport(),
  ensureProxy: async (url, opts) => (await import("../../services/media-proxy.js")).ensureMediaProxy(url, "video", opts),
  toCloud: (url) => ensureCloudReachableMediaUrl(url),
  probeSize: (url) => rehostByteSize(url),
}

/**
 * One relayed detection proxy, as the plugin's route takes it (P3-15 (a)).
 * nodaro.ai's schema for it is strict: a field it does not name refuses the
 * whole job (`invalid_proxy`), so exactly these travel, span rows included.
 */
export interface SpeakerFramesRelayedProxy {
  readonly sourceId: string
  readonly url: string
  readonly fps: number
  readonly height: number
  readonly spanMap: VideoProxyResult["spanMap"]
  readonly cuts: readonly number[]
}

/**
 * The job payload with the self-host's detection proxies in place of the
 * originals, and the relayed marker. Throws `DeterministicJobError` for every
 * refusal no retry changes (nodaro.ai does not take relayed jobs yet; the
 * scope the plugin would refuse).
 */
export async function speakerFramesRelayPayload(
  payload: Record<string, unknown>,
  deps: SpeakerFramesRelayDeps = defaultDeps,
): Promise<Record<string, unknown>> {
  const refusal = speakerFramesRelayRefusal(await deps.relaySupport())
  if (refusal) throw refusal.retryable ? new NodaroCloudError(refusal.message) : new DeterministicJobError(refusal.message)

  let edits: Edl[] | undefined
  if (payload.edl !== undefined && payload.edl !== null) {
    const coerced = coerceSpeakerFramesEdits(payload.edl)
    if (!coerced.ok) throw new DeterministicJobError(coerced.message)
    edits = coerced.edits
  }
  const scope = speakerFramesScope({
    ...(edits ? { edits } : {}),
    ...(typeof payload.videoUrl === "string" ? { videoUrl: payload.videoUrl } : {}),
    ...(Array.isArray(payload.excludeSourceIds) ? { excludeSourceIds: payload.excludeSourceIds as string[] } : {}),
  })
  if (!scope.ok) throw new DeterministicJobError(scope.message)

  // One proxy per sampled source, one at a time (each holds an ffmpeg slot).
  const built: Array<{ sourceId: string; proxy: VideoProxyResult }> = []
  for (const source of scope.sources) {
    built.push({
      sourceId: source.sourceId,
      proxy: await deps.ensureProxy(source.url, {
        fps: SPEAKER_FRAMES_SAMPLE_FPS,
        height: SPEAKER_FRAMES_PROXY_HEIGHT,
        ...(source.spans ? { spans: source.spans } : {}),
      }),
    })
  }

  // The proxies are all this job uploads: one over the re-host cap is refused
  // before any is sent, naming its camera. A size the probe cannot tell
  // passes (the in-rehost cap is the backstop).
  const hits: RehostSizeHit[] = []
  for (const { sourceId, proxy } of built) {
    const bytes = await deps.probeSize(proxy.url).catch(() => undefined)
    if (typeof bytes === "number" && Number.isFinite(bytes) && bytes > MAX_REHOST_BYTES) hits.push({ sourceId, bytes })
  }
  if (hits.length > 0) throw new DeterministicJobError(relayedProxySizeMessage("Speaker Frames", hits))

  const proxies: SpeakerFramesRelayedProxy[] = []
  for (const { sourceId, proxy } of built) {
    proxies.push({
      sourceId,
      url: await deps.toCloud(proxy.url),
      fps: proxy.fps,
      height: SPEAKER_FRAMES_PROXY_HEIGHT,
      spanMap: proxy.spanMap.map((r) => ({
        proxyStartMs: r.proxyStartMs,
        proxyEndMs: r.proxyEndMs,
        sourceStartMs: r.sourceStartMs,
        firstFrame: r.firstFrame,
        frameCount: r.frameCount,
      })),
      cuts: [...proxy.cuts],
    })
  }

  // A sampled source names its proxy; every other one the placeholder.
  const proxyUrlOf = new Map(proxies.map((p) => [p.sourceId, p.url]))
  const relayedEdits = edits?.map((edl) => ({
    ...edl,
    sources: edl.sources.map((s) => ({ ...s, url: proxyUrlOf.get(s.id) ?? speakerFramesUnsampledUrl(s.id) })),
  }))
  return {
    ...payload,
    ...(relayedEdits ? { edl: relayedEdits.length === 1 ? relayedEdits[0] : relayedEdits } : {}),
    ...(typeof payload.videoUrl === "string" ? { videoUrl: proxies[0]!.url } : {}),
    proxies,
    relayed: true,
  }
}

export interface TrackSetHomeDeps {
  readonly download: (url: string, dest: string, opts: { maxBytes: number }) => Promise<void>
  /** Stores the body under the job's own key, `speaker-tracks/<jobId>.json` (the plugin's prefix). */
  readonly upload: (body: Buffer, jobId: string, userId?: string) => Promise<string>
  readonly workDir: () => Promise<string>
  readonly cleanup: (dir: string) => Promise<void>
}

const defaultHomeDeps: TrackSetHomeDeps = {
  download: async (url, dest, opts) => (await import("../../providers/video/ffmpeg-utils.js")).downloadFile(url, dest, opts),
  upload: async (body, jobId, userId) =>
    (await import("../../lib/storage.js")).uploadBufferToR2(body, `speaker-tracks/${jobId}.json`, "application/json", userId),
  workDir: async () => (await import("../../providers/video/ffmpeg-utils.js")).createWorkDir("relay-speaker-tracks"),
  cleanup: async (dir) => (await import("../../providers/video/ffmpeg-utils.js")).cleanupWorkDir(dir),
}

const SHA256_HEX = /^[0-9a-f]{64}$/

/**
 * The cloud's output with its track file copied home: the descriptor's `url`
 * now names `speaker-tracks/<jobId>.json` in this install's storage; its hash
 * and size are the ones nodaro.ai stated, re-checked on the bytes copied.
 */
export async function bringTrackSetHome(
  output: Record<string, unknown>,
  jobId: string,
  jobUserId: string | undefined,
  deps: TrackSetHomeDeps = defaultHomeDeps,
): Promise<Record<string, unknown>> {
  return runPostProcessing(async () => {
    const raw = typeof output.json === "string" ? (JSON.parse(output.json) as unknown) : output.json
    const descriptor = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null
    const url = typeof descriptor?.url === "string" ? descriptor.url : ""
    const sha256 = typeof descriptor?.sha256 === "string" ? descriptor.sha256 : ""
    const bytes = typeof descriptor?.bytes === "number" ? descriptor.bytes : -1
    if (!descriptor || !url || !SHA256_HEX.test(sha256) || !(Number.isInteger(bytes) && bytes > 0 && bytes <= SPEAKER_TRACKS_MAX_BYTES)) {
      throw new NodaroCloudError("nodaro.ai: speaker-frames finished on the connection but returned no usable track file descriptor")
    }
    const dir = await deps.workDir()
    try {
      const local = join(dir, "tracks.json")
      await deps.download(url, local, { maxBytes: SPEAKER_TRACKS_MAX_BYTES })
      const body = await readFile(local)
      const got = createHash("sha256").update(body).digest("hex")
      if (body.length !== bytes || got !== sha256) {
        throw new NodaroCloudError(
          `nodaro.ai: the track file does not match its descriptor (${body.length} bytes, sha256 ${got.slice(0, 12)}…; expected ${bytes} bytes, ${sha256.slice(0, 12)}…)`,
        )
      }
      const homeUrl = await deps.upload(body, jobId, jobUserId)
      return { ...output, json: { ...descriptor, url: homeUrl } }
    } finally {
      await deps.cleanup(dir)
    }
  })
}
