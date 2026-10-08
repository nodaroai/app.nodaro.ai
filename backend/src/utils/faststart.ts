/**
 * "Faststart" for uploaded MP4 / MOV video: move the index (`moov`) in front of
 * the media (`mdat`) so the first seek into a large file does not have to fetch
 * the tail of the file first. An OBS or phone recording is finalised with the
 * index LAST; a 3-hour one costs about 1.5 s on the first open before any seek.
 *
 * WHERE it runs, and why not afterwards. The remux happens BEFORE the object is
 * first written, never as a background replacement of a key that already
 * exists: every stored object is served `Cache-Control: public, max-age=31536000,
 * immutable`, so an edge that served the old bytes in the seconds before a swap
 * would keep them for a year, and the most likely first reader of an upload is
 * the editor that was just handed its URL. Remuxing first means the object is
 * never non-faststart at any instant, `assets.size_bytes` and the storage-quota
 * reservation are taken on the FINAL length, and there is no replace to race.
 *
 * It is a stream copy (`-c copy`): no decode, no re-encode, byte-identical
 * packets. Everything about it is fail-safe — on any doubt the caller keeps the
 * file exactly as the user sent it:
 *   - a file that is already faststart, fragmented, or not ISO-BMFF is left alone;
 *   - the output must keep the stream count and the duration, must really have
 *     `moov` first, and must be about the same size, or it is thrown away;
 *   - it runs through the shared ffmpeg launcher (`runFfmpegCancellable`), so it
 *     is admitted against the container's memory budget like every other ffmpeg,
 *     and the whole attempt (admission wait included) has a deadline;
 *   - a box without room for the second copy skips it instead of filling the disk:
 *     free space, less what running remuxes have already promised, must be at least
 *     twice the file's size (decided 2026-10-08);
 *   - at most UPLOAD_FASTSTART_MAX_FILE_REMUXES (default 2) imported recordings are
 *     remuxed at once per process, and the buffered upload lanes have a cap of
 *     their own; past a cap the file is stored as sent, with a warning.
 *
 * Kill switch: `UPLOAD_FASTSTART_ENABLED=false` (default on, decided 2026-10-08)
 * turns the whole rewrite off at the two entry points below, so every lane
 * stores the file exactly as sent with no other behaviour change.
 */
import { promises as fs } from "node:fs"
import { statfs } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, extname, join } from "node:path"
import { randomUUID } from "node:crypto"
import { runFfmpegCancellable } from "../providers/video/ffmpeg-cancellable.js"
import { runFfprobe } from "../providers/video/ffmpeg-utils.js"
import { audioPeakMemoryMiB } from "../providers/video/ffmpeg-memory-model.js"
import { uploadFaststartEnabled, uploadFaststartMaxFileRemuxes } from "../lib/config.js"
import { probeMp4Layout, probeMp4LayoutInBuffer, type RangeReader } from "./mp4-boxes.js"

/**
 * Any video type may reach the box walk: the declared type is a client claim
 * (`video/mov`, `video/x-m4v`, a vendor alias on the handoff lane that never
 * resolves it), and the walk reads the file's own first bytes — it answers
 * "unknown" for WebM, Matroska, AVI and the rest in sixteen bytes, so nothing
 * but a real MP4/MOV is ever remuxed. Non-video types never get this far.
 */
export function isFaststartCandidateMime(mime: string): boolean {
  return mime.trim().toLowerCase().startsWith("video/")
}

/** A stream copy reads and writes sequentially: budget it at a deliberately slow disk rate. */
const BUDGET_BASE_MS = 30_000
const BUDGET_BYTES_PER_SEC = 15 * 1024 * 1024
const BUDGET_CEILING_MS = 60 * 60_000

/** The output is a re-wrapped copy of the same packets: far outside this band means something was dropped or doubled. */
const SIZE_BAND = { min: 0.9, max: 1.1 } as const
/** A stream copy keeps every timestamp; a hundred milliseconds covers container rounding. */
const DURATION_TOLERANCE_SEC = 0.1
/** Headroom on top of the output's own size when checking free disk. */
const DISK_MARGIN_BYTES = 256 * 1024 * 1024

/**
 * Disk promised to remuxes that are running right now, not yet visible in
 * `statfs`: every one of them is about to write an output of up to
 * `size * SIZE_BAND.max` while other lanes (the URL import runs eight at once,
 * each streaming a download of up to 8 GB onto the same volume) keep filling it.
 * A free-space check taken alone says yes to each of them in turn; counting the
 * promises makes the second one see what the first has already spent. Checked and
 * taken with no `await` between, so two callers cannot both pass on the same bytes.
 */
let reservedDiskBytes = 0

/**
 * Free space, after every earlier promise, must be at least this many times the
 * file being remuxed (decided 2026-10-08): the second copy, plus room for the
 * volume's other writers to keep filling it while the remux runs.
 */
const FREE_DISK_MULTIPLE = 2

/**
 * Take `bytes` of the volume if `free` (a fresh `statfs`) still covers them plus
 * every earlier promise and the margin, and is at least `floor` -- the
 * {@link FREE_DISK_MULTIPLE} rule, also measured after the earlier promises.
 */
function tryReserveDisk(free: number, bytes: number, extraNeeded = 0, floor = 0): boolean {
  const available = free - reservedDiskBytes
  if (available < bytes + extraNeeded + DISK_MARGIN_BYTES || available < floor) return false
  reservedDiskBytes += bytes
  return true
}

/** Remuxes holding an in-memory upload buffer at once (the buffered upload lanes). */
const MAX_CONCURRENT_BUFFER_REMUXES = 2
let bufferRemuxesInFlight = 0

/**
 * Remuxes of an imported recording running right now (the file lane: the URL
 * import, which can hold up to 8 GB per file and runs eight imports at once).
 * Capped at UPLOAD_FASTSTART_MAX_FILE_REMUXES per process; the buffered lanes
 * count separately above, so neither lane can starve the other.
 */
let fileRemuxesInFlight = 0

export type FaststartOutcome =
  /** The file was rewritten with `moov` first. */
  | "remuxed"
  /** `moov` is already before `mdat`; untouched. */
  | "already-faststart"
  /** The UPLOAD_FASTSTART_ENABLED kill switch is off; untouched, nothing probed. */
  | "disabled"
  /** Not an MP4/MOV, fragmented (built to stream), or unreadable; untouched. */
  | "not-applicable"
  /** Too many remuxes already run in this process (the buffered or the file lane's own cap); untouched. */
  | "busy"
  /** Not enough free disk for the second copy; untouched. */
  | "no-disk"
  /** The remux failed or its output did not verify; untouched. */
  | "failed"

export interface FaststartOptions {
  /** The caller's own cancel (a client disconnect). */
  readonly signal?: AbortSignal
  /** Ceiling on the whole attempt, admission wait included. Default: sized from the file. */
  readonly maxBudgetMs?: number
  /** Free bytes on the volume holding `dir` — injectable for tests. */
  readonly freeBytes?: (dir: string) => Promise<number>
}

export interface FaststartFileResult {
  /** The file to use from here on: a NEW file next to the source when remuxed, else the source itself. */
  readonly path: string
  readonly outcome: FaststartOutcome
  readonly reason?: string
}

export interface FaststartBufferResult {
  /** The bytes to store: a new buffer when remuxed, else the SAME buffer that was passed in. */
  readonly buffer: Buffer
  readonly outcome: FaststartOutcome
  readonly reason?: string
}

/** The kill budget for a remux of `sizeBytes`, within `maxBudgetMs`. */
export function faststartBudgetMs(sizeBytes: number, maxBudgetMs?: number): number {
  const sized = BUDGET_BASE_MS + Math.ceil((sizeBytes / BUDGET_BYTES_PER_SEC) * 1000)
  return Math.min(Math.max(sized, BUDGET_BASE_MS), maxBudgetMs ?? BUDGET_CEILING_MS)
}

async function defaultFreeBytes(dir: string): Promise<number> {
  const s = await statfs(dir)
  return Number(s.bavail) * Number(s.bsize)
}

/** A RangeReader over a local file. */
async function withFileReader<T>(path: string, fn: (read: RangeReader, size: number) => Promise<T>): Promise<T> {
  const handle = await fs.open(path, "r")
  try {
    const { size } = await handle.stat()
    const read: RangeReader = async (offset, length) => {
      const buf = Buffer.alloc(length)
      const { bytesRead } = await handle.read(buf, 0, length, offset)
      return buf.subarray(0, bytesRead)
    }
    return await fn(read, size)
  } finally {
    await handle.close()
  }
}

async function probeStreamsAndDuration(path: string): Promise<{ streams: number; durationSec: number }> {
  const out = await runFfprobe(["-v", "error", "-show_entries", "format=duration,nb_streams", "-of", "json", path])
  const format = (JSON.parse(out) as { format?: { duration?: string; nb_streams?: number } }).format ?? {}
  return { streams: Number(format.nb_streams ?? 0), durationSec: Number.parseFloat(format.duration ?? "") }
}

function unchanged(path: string, outcome: FaststartOutcome, reason?: string): FaststartFileResult {
  return { path, outcome, ...(reason ? { reason } : {}) }
}

/**
 * Rewrite the MP4/MOV at `srcPath` with `moov` first, into a new file beside it.
 * Returns the path to use: the new file when it verified, otherwise `srcPath`
 * (and any partial output is removed). Never throws for a remux problem — the
 * caller always has a usable file back.
 */
export function faststartVideoFile(
  srcPath: string,
  mime: string,
  opts: FaststartOptions = {},
): Promise<FaststartFileResult> {
  return remuxVideoFile(srcPath, mime, opts, "file")
}

/**
 * The remux behind both entry points. `lane` decides the admission rules that
 * differ: the file lane takes one of the capped file slots and asks for twice
 * the file's size in free disk; the buffered lane has taken its own slot and
 * already checked disk for both copies before writing the input (see
 * {@link faststartVideoBuffer}), so it asks for neither again.
 */
async function remuxVideoFile(
  srcPath: string,
  mime: string,
  opts: FaststartOptions,
  lane: "file" | "buffer",
): Promise<FaststartFileResult> {
  if (!uploadFaststartEnabled()) return unchanged(srcPath, "disabled")
  if (!isFaststartCandidateMime(mime)) return unchanged(srcPath, "not-applicable", "not an MP4/MOV type")

  let outPath: string | undefined
  let reserved = 0
  let tookFileSlot = false
  try {
    const { probe, size } = await withFileReader(srcPath, async (read, fileSize) => ({
      probe: await probeMp4Layout(read, fileSize),
      size: fileSize,
    }))
    if (probe.layout === "faststart") return unchanged(srcPath, "already-faststart")
    if (probe.layout !== "moov-last") return unchanged(srcPath, "not-applicable", `layout ${probe.layout}`)

    if (lane === "file") {
      // Checked and taken with no await between, so two callers cannot both pass on the last slot.
      const cap = uploadFaststartMaxFileRemuxes()
      if (fileRemuxesInFlight >= cap) {
        return unchanged(srcPath, "busy", `${fileRemuxesInFlight} file remuxes already running (limit ${cap})`)
      }
      fileRemuxesInFlight++
      tookFileSlot = true
    }

    const dir = dirname(srcPath)
    const free = await (opts.freeBytes ?? defaultFreeBytes)(dir)
    const outputBytes = Math.ceil(size * SIZE_BAND.max)
    const floor = lane === "file" ? size * FREE_DISK_MULTIPLE : 0
    if (!tryReserveDisk(free, outputBytes, 0, floor)) {
      const needed = Math.max(outputBytes + DISK_MARGIN_BYTES, floor)
      return unchanged(srcPath, "no-disk", `${free} bytes free (${reservedDiskBytes} already promised to running remuxes), ${needed} needed`)
    }
    reserved = outputBytes

    // The brand picks the muxer: QuickTime ("qt  ") stays a MOV, everything else an MP4.
    const format = probe.majorBrand === "qt  " ? "mov" : "mp4"
    outPath = join(dir, `faststart-${randomUUID()}${extname(srcPath) || `.${format}`}`)

    const budgetMs = faststartBudgetMs(size, opts.maxBudgetMs)
    const deadline = AbortSignal.timeout(budgetMs)
    const signal = opts.signal ? AbortSignal.any([deadline, opts.signal]) : deadline

    const before = await probeStreamsAndDuration(srcPath)
    if (!(before.streams > 0) || !Number.isFinite(before.durationSec)) {
      return unchanged(srcPath, "failed", "the source could not be probed")
    }

    await runFfmpegCancellable(
      [
        "-y", "-v", "error", "-nostdin",
        "-i", srcPath,
        "-map", "0", "-c", "copy", "-map_metadata", "0",
        "-movflags", "+faststart",
        "-f", format,
        outPath,
      ],
      signal,
      budgetMs,
      // A stream copy decodes and encodes nothing: the model's fixed term, as for an audio-only launch.
      { peakMemoryMiB: audioPeakMemoryMiB() },
    )

    const verdict = await verifyRemux(outPath, size, before)
    if (verdict) {
      await fs.rm(outPath, { force: true }).catch(() => {})
      return unchanged(srcPath, "failed", verdict)
    }
    return { path: outPath, outcome: "remuxed" }
  } catch (err) {
    if (outPath) await fs.rm(outPath, { force: true }).catch(() => {})
    return unchanged(srcPath, "failed", (err as Error).message)
  } finally {
    reservedDiskBytes -= reserved
    if (tookFileSlot) fileRemuxesInFlight--
  }
}

/** Why the output cannot replace the source, or undefined when it can. */
async function verifyRemux(
  outPath: string,
  srcSize: number,
  before: { streams: number; durationSec: number },
): Promise<string | undefined> {
  const after = await probeStreamsAndDuration(outPath)
  if (after.streams !== before.streams) return `stream count changed (${before.streams} -> ${after.streams})`
  if (!Number.isFinite(after.durationSec) || Math.abs(after.durationSec - before.durationSec) > DURATION_TOLERANCE_SEC) {
    return `duration changed (${before.durationSec} -> ${after.durationSec})`
  }
  const { size: outSize } = await fs.stat(outPath)
  if (outSize < srcSize * SIZE_BAND.min || outSize > srcSize * SIZE_BAND.max) {
    return `output size ${outSize} is outside the expected band for ${srcSize}`
  }
  const layout = await withFileReader(outPath, (read, size) => probeMp4Layout(read, size))
  if (layout.layout !== "faststart") return `output layout is ${layout.layout}`
  return undefined
}

/**
 * {@link faststartVideoFile} for a file held in memory (the buffered upload
 * lanes). The cheap box walk runs on the buffer first, so a file that needs
 * nothing never touches the disk; only a moov-last file is written out,
 * remuxed, and read back. Returns the SAME buffer object when nothing changed.
 */
export async function faststartVideoBuffer(
  buffer: Buffer,
  mime: string,
  opts: FaststartOptions = {},
): Promise<FaststartBufferResult> {
  const same = (outcome: FaststartOutcome, reason?: string): FaststartBufferResult =>
    ({ buffer, outcome, ...(reason ? { reason } : {}) })

  if (!uploadFaststartEnabled()) return same("disabled")
  if (!isFaststartCandidateMime(mime)) return same("not-applicable", "not an MP4/MOV type")
  const probe = await probeMp4LayoutInBuffer(buffer)
  if (probe.layout === "faststart") return same("already-faststart")
  if (probe.layout !== "moov-last") return same("not-applicable", `layout ${probe.layout}`)

  if (bufferRemuxesInFlight >= MAX_CONCURRENT_BUFFER_REMUXES) return same("busy")
  bufferRemuxesInFlight++
  const workDir = join(tmpdir(), `faststart-${randomUUID()}`)
  try {
    await fs.mkdir(workDir, { recursive: true })
    const inPath = join(workDir, "input.mp4")
    // Disk is checked BEFORE the input is written: the input copy and the output both land in the work dir.
    const free = await (opts.freeBytes ?? defaultFreeBytes)(workDir)
    // The input copy is promised only until it is written (then `statfs` sees it); the output is
    // promised by faststartVideoFile itself, so the check here asks for both without double-holding.
    const inputBytes = buffer.length
    const floor = inputBytes * FREE_DISK_MULTIPLE
    if (!tryReserveDisk(free, inputBytes, Math.ceil(inputBytes * SIZE_BAND.max), floor)) {
      const needed = Math.max(Math.ceil(inputBytes * (1 + SIZE_BAND.max)) + DISK_MARGIN_BYTES, floor)
      return same("no-disk", `${free} bytes free (${reservedDiskBytes} already promised to running remuxes), ${needed} needed`)
    }
    try {
      await fs.writeFile(inPath, buffer)
    } finally {
      reservedDiskBytes -= inputBytes
    }
    const result = await remuxVideoFile(inPath, mime, opts, "buffer")
    if (result.outcome !== "remuxed") return same(result.outcome, result.reason)
    return { buffer: await fs.readFile(result.path), outcome: "remuxed" }
  } catch (err) {
    return same("failed", (err as Error).message)
  } finally {
    bufferRemuxesInFlight--
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {})
  }
}

/** Test seam: bytes promised to remuxes in flight right now (0 when idle). */
export function faststartReservedDiskBytes(): number {
  return reservedDiskBytes
}

/** Test seam: how many buffered remuxes are in flight right now. */
export function faststartBuffersInFlight(): number {
  return bufferRemuxesInFlight
}

/** Test seam: how many file-lane (imported recording) remuxes are in flight right now. */
export function faststartFileRemuxesInFlight(): number {
  return fileRemuxesInFlight
}

/** Log why a remux that was attempted did not happen — the skips that are normal stay silent. */
export function noteFaststartOutcome(lane: string, outcome: FaststartOutcome, reason?: string): void {
  if (outcome === "failed" || outcome === "no-disk" || outcome === "busy") {
    console.warn(`[faststart] ${lane}: stored as uploaded (${outcome}${reason ? `: ${reason}` : ""})`)
  }
}
