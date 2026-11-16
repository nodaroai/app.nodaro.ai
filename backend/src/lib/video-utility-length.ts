import type { FastifyReply, FastifyRequest } from "fastify"
import type { ZodTypeAny } from "zod"
import { assertSafeProbeSource, ProbeSourceBlockedError, readOwnStoredCopy, type ProbeSourceBlockReason } from "../providers/video/ffmpeg-utils.js"
import { MEDIA_LINK_BAD_HOST, NOT_A_MEDIA_FILE, OWN_STORAGE_PROBE_MAX_BYTES, PROBE_UNAVAILABLE, probeNotRun } from "../providers/video/probe-guard.js"
import { DOWNLOAD_TIMEOUT_MS } from "../providers/video/ffmpeg-timeouts.js"
import { PRE_CHARGE_PROBE_TIMEOUT_MS, ROUTE_MEASURE_DEADLINE_MS } from "./pre-charge-probe-bounds.js"
import { unitRateBaseCredits } from "./credit-base-cost.js"
import { isOwnStoredFileUrl } from "./own-storage-url.js"
import { safeUrlSchema } from "./url-validator.js"
import { COMBINE_VIDEOS_MAX_CLIPS, combineVideosTooManyClipsMessage, MEASURED_VIDEO_UTILITY_JOBS, videoUtilityClipReading, videoUtilityInputUrls, videoUtilityUnits, withMeasuredInputLengths, workerClipRates } from "./video-utility-credits.js"
import { probeClipReading, type ClipLengthReading, type ClipReading } from "./video-utility-probe.js"
import { dropClientMeasureFields, requestMeasure, setRequestMeasure } from "./request-measure.js"

/**
 * Trim Video, Loop Video and Combine Videos are charged by the measured length
 * of the clips they are given: every place a run starts — the routes'
 * preHandler (`POST /v1/trim-video`, `/v1/loop-video`, `/v1/combine-videos`:
 * the editor's single-node Run, the MCP verbs, the SDK), the workflow run
 * (node-executor: workflows, published apps, components, use-case graphs) and
 * a pipeline's combine step — probes each input before anything is reserved
 * and prices the node's own unit formula (`videoUtilityUnits`) at those
 * lengths, never at a length the request or the graph forwards. The units ride
 * the job (`billedUnits`, with the measured lengths on `upstreamDuration` /
 * `upstreamDurations`), and the render re-measures the files it downloads
 * (lib/video-utility-refusal.ts).
 *
 * The length is read by `probeClipLengthSec` (lib/video-utility-probe.ts), the
 * reading the render's check re-measures by, from the length the node's worker
 * reads (`videoUtilityClipReading`): Trim and Loop the container's (ffprobe's
 * format duration, the reading Trim cuts by and Loop fills its target by),
 * Combine Videos each clip's video stream (the length it joins at); for a file
 * whose header carries no length, the end of its last video packet.
 *
 * An input that cannot be read is refused: the render must decode it, so it
 * would fail there anyway, after the reservation. A file in this install's own
 * storage that the probe's link guard refuses (a self-host's bundled storage
 * behind the app's own origin, on a loopback or private address) is measured
 * the way the render reaches it: downloaded (`readOwnStoredCopy`, the probe
 * guard's own-storage fallback: `downloadFile`, which exempts that subtree),
 * at most {@link OWN_STORAGE_MEASURE_MAX_BYTES}, and probed on disk.
 *
 * The work before a charge is bounded: a Combine Videos joins at most
 * {@link COMBINE_VIDEOS_MAX_CLIPS} clips (a longer list is refused before
 * anything is fetched), the routes check the body and the balance at one unit
 * first, and the time is bounded by path (`MeasureBounds`):
 * - a ROUTE (the editor's Run, the API, MCP — a client is waiting, behind a
 *   proxy that gives up at about 100 s) measures the whole request within
 *   {@link ROUTE_MEASURE_DEADLINE_MS}: each clip's header read at most
 *   {@link PRE_CHARGE_PROBE_TIMEOUT_MS}, a packet scan (a clip with no length in
 *   its header) or an own-storage download at most what is left of the
 *   deadline; and a client that goes away stops the measure, before any job or
 *   reservation;
 * - the WORKFLOW stamp and a pipeline step (no client waiting) read each
 *   clip's header within {@link PRE_CHARGE_PROBE_TIMEOUT_MS} and scan its packets
 *   within the render's own download bound (`DOWNLOAD_TIMEOUT_MS`).
 * A read that runs out of time is a retryable refusal (`probe_timeout`), never
 * an unreadable clip. A scan has no size limit but its time.
 */

export { COMBINE_VIDEOS_MAX_CLIPS }

// The bounds every measure before a charge shares (a leaf, re-exported for the existing imports).
export { PRE_CHARGE_PROBE_TIMEOUT_MS, ROUTE_MEASURE_DEADLINE_MS }

/**
 * The bound a measure runs under. A route passes `deadlineAt` (now +
 * {@link ROUTE_MEASURE_DEADLINE_MS}) and the `signal` of its client's
 * connection; with neither (the workflow stamp, a pipeline step) a packet scan
 * gets the render's own download bound, `DOWNLOAD_TIMEOUT_MS`.
 */
export interface MeasureBounds {
  readonly deadlineAt?: number
  readonly signal?: AbortSignal
}

/**
 * The most a clip of this install's own storage is downloaded to be measured
 * before a charge (only when the probe's link guard refuses its address: a
 * self-host's storage). A larger file is refused as unreadable. The probe
 * guard's own cap (`OWN_STORAGE_PROBE_MAX_BYTES`), the same for every probe.
 */
export const OWN_STORAGE_MEASURE_MAX_BYTES = OWN_STORAGE_PROBE_MAX_BYTES

export type VideoUtilityLength =
  /** `fps`: each clip's frame rate as its worker cuts it (`workerClipRates`), what the units were counted at. */
  | { readonly ok: true; readonly secs: readonly number[]; readonly fps: ReadonlyArray<number | undefined>; readonly units: number }
  | { readonly ok: false; readonly code: VideoUtilityRefusalCode; readonly message: string }

/**
 * Why a run was refused before its charge: a clip that cannot be read, a probe
 * that timed out (retryable: run it again), a link whose host could not be
 * resolved (retryable: a DNS failure can pass), a read the server could not
 * run just now (retryable), a link whose host does not exist or is a private
 * address (`media_link_bad_host`: the link has to change), more clips than one
 * run joins.
 */
export type VideoUtilityRefusalCode = "invalid_video_duration" | "probe_timeout" | "source_unreachable" | "probe_unavailable" | "too_many_clips" | "client_closed" | "media_link_not_a_file" | typeof MEDIA_LINK_BAD_HOST

/**
 * The HTTP status a route answers a refusal with: a retryable one (a timed-out
 * probe, an unreachable host, a read the server could not run) 503, a request whose client went away 499 (no
 * one reads it), the rest are the request's (400).
 */
export function videoUtilityRefusalStatus(code: VideoUtilityRefusalCode): number {
  if (code === "client_closed") return 499
  return code === "probe_timeout" || code === "source_unreachable" || code === PROBE_UNAVAILABLE.code ? 503 : 400
}

/** What a route answers a request whose client went away before its charge: nothing was created or reserved. */
export const VIDEO_UTILITY_CLIENT_CLOSED = Object.freeze({
  code: "client_closed" as const,
  message: "The request was closed before its clips were measured; nothing was charged.",
})

/** How many inputs are probed at once (a Combine Videos may take dozens of clips). */
const PROBE_CONCURRENCY = 4

/** The clip by its place when there are several. */
const clipName = (index: number, count: number): string => (count > 1 ? `clip ${index + 1} of ${count}` : "the video")

/** What a probe refusal says. */
function refusalOf(failure: ClipFailure, index: number, count: number): VideoUtilityLength {
  if (failure === "aborted") return { ok: false, ...VIDEO_UTILITY_CLIENT_CLOSED }
  // A sibling's stop is never the answer (`probeEach`); read as the clip that could not be measured.
  if (failure === "stopped") return refusalOf("unreadable", index, count)
  const which = clipName(index, count)
  if (failure === "timeout") return { ok: false, code: "probe_timeout", message: `Timed out reading ${which} — run it again.` }
  if (failure === "unreachable") return { ok: false, code: "source_unreachable", message: `Could not reach ${which} — run it again.` }
  if (failure === "unavailable") return { ok: false, code: PROBE_UNAVAILABLE.code, message: `Could not read ${which} just now — run it again.` }
  if (failure === "nohost") return { ok: false, code: MEDIA_LINK_BAD_HOST, message: `Could not read ${which}: its host was not found. Check the link.` }
  if (failure === "private") {
    return {
      ok: false,
      code: MEDIA_LINK_BAD_HOST,
      message: `Could not read ${which}: it points to a private or reserved address, which the server does not read. Use a link to a public host, or upload the file.`,
    }
  }
  if (failure === "notmedia") return { ok: false, code: NOT_A_MEDIA_FILE.code, message: count > 1 ? `Clip ${index + 1} of ${count}: ${NOT_A_MEDIA_FILE.message}` : NOT_A_MEDIA_FILE.message }
  return { ok: false, code: "invalid_video_duration", message: `Could not read ${which}. The file may be corrupted or an unsupported format.` }
}

/**
 * Why one clip has no length: it cannot be read, reading it timed out, its host
 * could not be resolved for now (`unreachable`, retryable) or does not exist
 * (`nohost`, for good), it is on a private or reserved address that is not
 * this install's own storage (`private`, at the first hop or a redirect), the
 * server could not run the read (`unavailable`:
 * its reader failed to start or was stopped, retryable), or the request's client went away (`aborted`: nothing
 * is answered, created or reserved), or the link is not an ordinary media
 * file (`notmedia`: a streaming playlist, a manifest). `stopped`: another clip of the same
 * measure failed first, so this one's read was stopped — never the answer.
 */
type ClipFailure = "unreadable" | "timeout" | "unreachable" | "unavailable" | "nohost" | "private" | "notmedia" | "aborted" | "stopped"

/** ffprobe's own lookup of a host failed; the host it names is captured. */
const FFPROBE_LOOKUP_FAILED = /Failed to resolve hostname\s+\[?([^\s\]:]+)/i

/**
 * ffprobe's lookup of the host the guard had JUST resolved failed: a passing
 * failure, retryable. A lookup failure on any other host (a redirect target
 * the guard never resolved) says nothing of the kind, so it stays unreadable.
 * A fallback only: ffprobe reads every link through the probe guard's proxy,
 * which resolves each hop itself and says why one failed
 * (`ProbeSourceBlockedError`, read first by `failureOf`).
 */
function ffprobeLookupOfGuardedHostFailed(err: unknown, url: string): boolean {
  const named = FFPROBE_LOOKUP_FAILED.exec(err instanceof Error ? err.message : String(err))?.[1]
  if (!named) return false
  try {
    return named.toLowerCase() === new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, "")
  } catch {
    return false
  }
}

/**
 * A probe or a download that ran out of time (ffprobe killed at its timeout,
 * an aborted fetch, or a storage read stopped by its timeout signal — an
 * `AbortError` whose `cause` is the `TimeoutError`): retryable. Read after the
 * client's and the sibling's stops (`failureOf`), so an abort by either of
 * those is never taken for one.
 */
const timedOut = (err: unknown): boolean => {
  const e = err as { timedOut?: unknown; name?: unknown; cause?: { name?: unknown } | null } | null
  return e?.timedOut === true || e?.name === "TimeoutError" || (e?.name === "AbortError" && e.cause?.name === "TimeoutError")
}

/**
 * Why a failed read of `url` failed, as a measure tells it, in this order:
 * stopped by its client or by a sibling's failure, out of time (also when a
 * hop was refused on the way), a hop the probe guard
 * refused (a host that could not be resolved for now is retryable; one that
 * does not exist, and a private address, are the link's to fix — at the first
 * hop or at a redirect, alike), a passing lookup failure of its host, or
 * unreadable.
 */
function failureOf(err: unknown, bounds: MeasureBounds, readSignal: AbortSignal | undefined, url: string): ClipFailure {
  if (bounds.signal?.aborted) return "aborted"
  if (readSignal?.aborted) return "stopped"
  // A read that ran out of time is retryable even when a hop was refused on the way.
  if (timedOut(err) || timedOut((err as { cause?: unknown } | null)?.cause)) return "timeout"
  // The server could not run the read (its reader failed to start, or it was stopped): retryable.
  if (probeNotRun(err)) return "unavailable"
  const refused = refusalReason(err)
  if (refused) return refused === "dns" ? "unreachable" : refused === "host" ? "nohost" : refused === "address" ? "private" : refused === "container" ? "notmedia" : "unreadable"
  return ffprobeLookupOfGuardedHostFailed(err, url) ? "unreachable" : "unreadable"
}

/** The probe guard's reason, when `err` is its refusal of a hop (`ProbeSourceBlockedError`, read by its shape). */
function refusalReason(err: unknown): ProbeSourceBlockReason | undefined {
  const reason = (err as { reason?: unknown } | null)?.reason
  return err instanceof Error && (reason === "address" || reason === "host" || reason === "dns" || reason === "link" || reason === "container") ? reason : undefined
}

/** What is left of a route's deadline (ms), or the bound a path without one uses. */
const leftMs = (bounds: MeasureBounds, otherwise: number): number =>
  bounds.deadlineAt === undefined ? otherwise : bounds.deadlineAt - Date.now()

/** `work` within what is left of a route's deadline: past it, the measure answers in time (a timed-out read); the work itself may finish unread. */
async function withinDeadline<T>(work: Promise<T>, bounds: MeasureBounds): Promise<T> {
  if (bounds.deadlineAt === undefined) return work
  work.catch(() => undefined)
  let timer: ReturnType<typeof setTimeout> | undefined
  const outOfTime = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error("measure: out of time"), { timedOut: true })), Math.max(0, leftMs(bounds, 0)))
  })
  try {
    return await Promise.race([work, outOfTime])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * `work`, or a rejection (`{ aborted: true }`) as soon as `signal` aborts, so a
 * read that cannot be cancelled (a DNS lookup) does not hold its measure; the
 * work itself may finish unread.
 */
async function untilStopped<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return work
  work.catch(() => undefined)
  let onAbort: (() => void) | undefined
  const stopped = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(Object.assign(new Error("measure: stopped"), { aborted: true }))
    if (signal.aborted) onAbort()
    else signal.addEventListener("abort", onAbort, { once: true })
  })
  try {
    return await Promise.race([work, stopped])
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort)
  }
}

/**
 * One clip's length, or why it has none. The link is checked once by the
 * probe's link guard (`assertSafeProbeSource`, here under the measure's own
 * deadline and stop) and the probe then reads it through the guard's proxy
 * (`probeClipLengthSec` → `readProbeSource`), which checks every later hop.
 * Only when the guard refuses the ADDRESS (a private or reserved address:
 * `ProbeSourceBlockedError` reason `address`) and the link is strictly a file
 * of this install's own storage (`isOwnStoredFileUrl`: a self-host's storage
 * on a loopback or private address, which the render downloads through the
 * same exemption) is the file downloaded — capped — and probed on disk
 * instead (`readOwnStoredCopy`, the probe guard's one fallback). A host that
 * could not be resolved for now (reason `dns`, at the first hop or a later
 * one) is retryable and never downloaded; a host that does not exist (reason
 * `host`), and a private or reserved address that is not this install's own
 * storage, are refused for good, saying so (`media_link_bad_host`); any other
 * refusal or failure means the clip cannot be read. A link the guard allows is never downloaded to be
 * measured (on Cloud, storage is public and the guard allows it).
 */
async function clipReadingOf(
  url: string,
  reading: ClipLengthReading,
  bounds: MeasureBounds,
  /** What stops this clip's reads: its client going away, or another clip of the measure failing first. */
  readSignal: AbortSignal | undefined = bounds.signal,
): Promise<ClipReading | ClipFailure> {
  if (bounds.signal?.aborted) return "aborted"
  if (readSignal?.aborted) return "stopped"
  if (leftMs(bounds, Infinity) <= 0) return "timeout"
  // The header read at most 30 s; the packet scan the rest of a route's deadline, else the render's own download bound.
  const timeout = {
    timeoutMs: PRE_CHARGE_PROBE_TIMEOUT_MS,
    reading,
    ...(bounds.deadlineAt !== undefined ? { deadlineAt: bounds.deadlineAt } : { packetTimeoutMs: DOWNLOAD_TIMEOUT_MS }),
    ...(readSignal ? { signal: readSignal } : {}),
  }
  let refusal: ProbeSourceBlockedError["reason"] | "other" | undefined
  try {
    // The guard's DNS lookup is bounded by what is left of a route's deadline, and stopped with this clip's reads.
    await withinDeadline(untilStopped(assertSafeProbeSource(url), readSignal), bounds)
  } catch (err) {
    // Classified in the measure's own order: the client, a sibling's stop, then time.
    if (bounds.signal?.aborted) return "aborted"
    if (readSignal?.aborted) return "stopped"
    if (timedOut(err)) return "timeout"
    refusal = err instanceof ProbeSourceBlockedError ? err.reason : "other"
  }
  if (refusal === undefined) {
    try {
      return await probeClipReading(url, { ...timeout, sourceChecked: true })
    } catch (err) {
      return failureOf(err, bounds, readSignal, url)
    }
  }
  if (refusal === "dns") return "unreachable"
  if (refusal === "host") return "nohost"
  if (refusal !== "address") return "unreadable"
  if (!isOwnStoredFileUrl(url)) return "private"
  // Within what is left of a route's deadline (none left: out of time, never a negative bound); the render's
  // own download bound otherwise. The storage fallback of a 404 runs under the same bound and cap.
  const downloadMs = leftMs(bounds, DOWNLOAD_TIMEOUT_MS)
  if (downloadMs <= 0) return "timeout"
  try {
    // The local copy is a user's file: the container rule a link gets.
    return await readOwnStoredCopy(url, (local) => probeClipReading(local, { ...timeout, userFile: true }), {
      downloadTimeoutMs: downloadMs,
      ...(readSignal ? { signal: readSignal } : {}),
    })
  } catch (err) {
    return failureOf(err, bounds, readSignal, url)
  }
}

/**
 * Each url's length, in order; the first clip that cannot be read (or timed
 * out) when any. The first clip to fail stops the reads still running beside
 * it (one stop for the measure, chained with its client's signal): the
 * refusal does not wait for clips it will not use.
 */
async function probeEach(urls: readonly unknown[], reading: ClipLengthReading, bounds: MeasureBounds): Promise<{ readonly readings: ClipReading[] } | { readonly failed: number; readonly failure: ClipFailure }> {
  const readings: ClipReading[] = new Array<ClipReading>(urls.length)
  const stop = new AbortController()
  const readSignal = bounds.signal ? AbortSignal.any([bounds.signal, stop.signal]) : stop.signal
  let failed: { readonly failed: number; readonly failure: ClipFailure } | undefined
  for (let start = 0; start < urls.length && failed === undefined; start += PROBE_CONCURRENCY) {
    const batch = urls.slice(start, start + PROBE_CONCURRENCY)
    const read = await Promise.all(batch.map(async (url): Promise<ClipReading | ClipFailure> => {
      const got = typeof url === "string" && url !== "" ? await clipReadingOf(url, reading, bounds, readSignal) : "unreadable"
      if (typeof got === "string" && got !== "stopped") stop.abort()
      return got
    }))
    // The answer is a clip's own failure, never a sibling's stop.
    read.forEach((got, i) => {
      if (typeof got !== "string") readings[start + i] = got
      else if (got !== "stopped") failed ??= { failed: start + i, failure: got }
    })
  }
  return failed ?? { readings }
}

/**
 * Measures the clips a Trim / Loop / Combine Videos request hands its run and
 * the units they cost (the node's own formula, `videoUtilityUnits`, at the
 * measured lengths and frame rates — any length the request carried is
 * replaced). A clip that
 * cannot be read is refused, and so is a Combine Videos of more than
 * {@link COMBINE_VIDEOS_MAX_CLIPS} clips, before any clip is fetched.
 */
export async function measureVideoUtilityCharge(
  jobName: string,
  body: Readonly<Record<string, unknown>>,
  bounds: MeasureBounds = {},
): Promise<VideoUtilityLength> {
  const urls = videoUtilityInputUrls(jobName, body)
  if (jobName === "combine-videos" && urls.length > COMBINE_VIDEOS_MAX_CLIPS) {
    return { ok: false, code: "too_many_clips", message: combineVideosTooManyClipsMessage(urls.length) }
  }
  const probed = await probeEach(urls, videoUtilityClipReading(jobName), bounds)
  if ("failed" in probed) return refusalOf(probed.failure, probed.failed, urls.length)
  const secs = probed.readings.map((r) => r.sec)
  // Frame trims at the rate the worker cuts each clip by (decided 2026-11-14), never a rate the request carried.
  const fps = workerClipRates(jobName, probed.readings)
  const units = videoUtilityUnits(jobName, withMeasuredInputLengths(jobName, body, secs), fps) ?? 1
  return { ok: true, secs, fps, units: Math.max(1, units) }
}

/** BASE credits for `units` of a measured video utility: its one-unit row times the count (`unitRateBaseCredits`). */
export async function videoUtilityMeasuredBaseCredits(jobName: string, units: number): Promise<number> {
  return unitRateBaseCredits(jobName, Math.max(1, units))
}

/**
 * The workflow run's twin of the routes' preHandler: measures a Trim / Loop /
 * Combine Videos payload's clips and stamps what the reservation charges
 * (`billedUnits`, read by `videoUtilityReserveUnits`) and the lengths it was
 * charged for (`upstreamDuration` / `upstreamDurations`, replacing the length
 * the graph forwarded) — what the render checks the files it downloads against.
 * Run BEFORE input_data is written, in every edition (the render refuses a job
 * that carries no units). Returns the routes' refusal for a clip they would
 * refuse; undefined otherwise, and for any other job, whose payload is left
 * untouched.
 *
 * Each clip must pass the routes' own `safeUrlSchema` (http(s), no literal
 * local or private host) before anything is probed, as Video Depth's stamp
 * checks its clip: raw workflow JSON reaches here without the routes' Zod, and
 * the probe's link guard reads a string with no scheme as a local path. Any
 * other clip is refused as unreadable. The urls checked are the payload's own
 * (`videoUrl`, or `videoUrls` — for Combine Videos also when a clip order
 * picked them from the wired sources), the ones the render downloads.
 */
export async function stampVideoUtilityLength(
  jobName: string,
  payload: Record<string, unknown>,
): Promise<{ readonly code: string; readonly message: string } | undefined> {
  if (!MEASURED_VIDEO_UTILITY_JOBS.has(jobName)) return undefined
  const urls = videoUtilityInputUrls(jobName, payload)
  // A list over the cap is refused by the measure, by its count, before any clip is looked at.
  const unsafe = urls.length > COMBINE_VIDEOS_MAX_CLIPS ? -1 : urls.findIndex((url) => !safeUrlSchema.safeParse(url).success)
  if (unsafe >= 0) {
    const refusal = refusalOf("unreadable", unsafe, urls.length)
    if (!refusal.ok) return { code: refusal.code, message: refusal.message }
  }
  const measured = await measureVideoUtilityCharge(jobName, payload)
  if (!measured.ok) return { code: measured.code, message: measured.message }
  Object.assign(payload, withMeasuredInputLengths(jobName, {}, measured.secs), { billedUnits: measured.units })
  return undefined
}

/** The units a stamped Trim / Loop / Combine Videos payload reserves; undefined for any other job. */
export function videoUtilityReserveUnits(jobName: string, payload: Readonly<Record<string, unknown>>): number | undefined {
  return MEASURED_VIDEO_UTILITY_JOBS.has(jobName) && typeof payload.billedUnits === "number" && payload.billedUnits >= 1 ? payload.billedUnits : undefined
}

/** A body field named like the measurement (the name the routes once stashed it under): dropped, never read. */
const STASH = "__videoUtilityMeasured"
/** The request measure the routes' preHandler keeps for the credit guard and the handler (server-side only). */
const MEASURE = "videoUtility"

/** The measurement a route's preHandler kept on the server-side request (never the body); undefined when it did not measure (the handler's parse answers). */
export function stashedVideoUtilityLength(req: FastifyRequest): { readonly secs: readonly number[]; readonly units: number } | undefined {
  const stash = requestMeasure<{ secs?: unknown; units?: unknown }>(req, MEASURE)
  return stash && Array.isArray(stash.secs) && typeof stash.units === "number" && stash.units >= 1
    ? { secs: stash.secs as number[], units: stash.units }
    : undefined
}

/** Where the routes' preHandler leaves the signal of its client's connection (aborted when the client goes away). */
const CLIENT_GONE = Symbol("videoUtilityClientGone")

/**
 * Whether the client of a measured Trim / Loop / Combine Videos request went
 * away (its connection closed before an answer): its handler then creates no
 * job and reserves nothing.
 */
export function videoUtilityClientGone(req: FastifyRequest): boolean {
  return (req as unknown as Record<symbol, AbortSignal | undefined>)[CLIENT_GONE]?.aborted === true
}

/** A request body without a field of the measurement's old name (dropped by the preHandler already). */
export function withoutVideoUtilityStash(body: unknown): Record<string, unknown> {
  const { [STASH]: _stash, ...rest } = (body ?? {}) as Record<string, unknown>
  return rest
}

/**
 * The routes' preHandler, between the credit guard's check at the one-unit
 * floor and its check of the measured price: parses the body with the route's
 * own schema first (its shape, its urls through `safeUrlSchema` and, for
 * Combine Videos, at most {@link COMBINE_VIDEOS_MAX_CLIPS} clips) — a body that
 * does not parse is left to the handler's parse, and nothing is probed — then
 * measures each clip within {@link ROUTE_MEASURE_DEADLINE_MS} for the whole
 * request, refuses one that cannot be read (400 `invalid_video_duration`),
 * whose host does not exist or is a private address (400
 * `media_link_bad_host`), whose reading ran out of time (503
 * `probe_timeout`) or whose host could not be looked up for now (503
 * `source_unreachable`) before anything is reserved, and keeps the lengths
 * and units on the server-side request for the guard and the handler
 * (`stashedVideoUtilityLength`; never the body, whose field of the old stash
 * name is dropped first). A client that goes
 * away stops the measure (`videoUtilityClientGone`), and its handler creates
 * nothing.
 */
export function measureVideoUtilityPreHandler(jobName: string, schema: ZodTypeAny) {
  return async function measureVideoUtilityInputs(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    dropClientMeasureFields(req.body, [STASH])
    const body = (req.body ?? {}) as Record<string, unknown>
    if (!schema.safeParse(body).success) return
    const urls = videoUtilityInputUrls(jobName, body)
    if (!urls.every((url) => safeUrlSchema.safeParse(url).success)) return
    // The client's connection: a close before the answer is written means it went away.
    const gone = new AbortController()
    reply.raw.once("close", () => {
      if (!reply.raw.writableFinished) gone.abort()
    })
    // Gone already (during the floor check before this): its close has fired, and will not fire again.
    if (reply.raw.destroyed && !reply.raw.writableFinished) gone.abort()
    ;(req as unknown as Record<symbol, AbortSignal>)[CLIENT_GONE] = gone.signal
    const measured = await measureVideoUtilityCharge(jobName, body, { deadlineAt: Date.now() + ROUTE_MEASURE_DEADLINE_MS, signal: gone.signal })
    if (!measured.ok) {
      return void reply.code(videoUtilityRefusalStatus(measured.code)).send({ error: { code: measured.code, message: measured.message } })
    }
    setRequestMeasure(req, MEASURE, { secs: measured.secs, units: measured.units })
  }
}
