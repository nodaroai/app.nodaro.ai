/**
 * A media input on our own storage, with its exact size — copied there first
 * when it is not (decided 2026-11-11).
 *
 * A lane that hands an input to a model behind the platform passes the
 * caller's URL through {@link copyOutsideInput} and sends what comes back:
 * a URL on this install's own storage (`isOwnStoredFileUrl`, the same strict
 * test the platform's backstop applies) and the number of bytes behind it. A
 * lane's size limit lives in one place: it passes its cap in, and gets back a
 * stored URL with an exact size, or a typed refusal
 * ({@link OutsideInputRefusal}) it turns into its own sentence.
 *
 * Two cases, told apart by `copied`:
 *
 *   - ALREADY STORED (`isOwnStoredFileUrl(url)`): never fetched. The URL
 *     returned is the canonical public address of its storage key (a query or
 *     fragment the caller added is dropped: it is what was measured). Its size
 *     is read from storage's own record of the object (a head by its key),
 *     never from anything the caller or a public server says. A missing
 *     object, a key that is not plain (`//a.png`) and a key under a kept
 *     prefix (`evidence/…`, never answered about) are refused as unreadable;
 *     one over the cap as too large. The `inspect` callback does NOT run: the
 *     lane measures length or dimensions from the stored URL, as it always has.
 *   - ANYTHING ELSE: copying an outside link into our storage is an import,
 *     so it is refused before any fetch where the deployment turned links to
 *     outside content off (decided 2026-11-11): `assertLinkImportAllowed`, the
 *     one refusal every import lane gives (`link-imports-totality.test.ts`
 *     counts a route that calls this helper as asking). An input already on
 *     our storage is never subject to it. Otherwise, once one of this
 *     process's download slots is free (a per-user and a global limit; a short
 *     wait, then {@link OutsideInputBusyError}), it is downloaded through the
 *     platform's SSRF-safe fetch (`boundedPublicChunks`) to a temp file,
 *     counting the bytes actually read: a body past the cap is cut off and
 *     refused, whatever length it declared. The file is made read-only and
 *     typed from its first bytes; one that is not of the lane's kind is
 *     refused. The lane's `inspect` callback then reads the local file (an
 *     ffprobe, an image header) and its result is returned: the lane measures
 *     the very bytes it will send, and a throw refuses the input with nothing
 *     stored. The size and the type are taken AFTER `inspect` returns. The
 *     deployment's upload policy (when one is registered) is asked before
 *     anything is written. The copy is stored as a short-lived scratch input
 *     under a full random name, and the temp file is always removed.
 *
 * The slot is held for at most {@link OUTSIDE_INPUT_MAX_HOLD_MS} in all —
 * download, `inspect`, policy and upload — then given back with
 * {@link OutsideInputTimedOutError}, the temp folder removed with it; work
 * still running past it is told through `inspect`'s signal and stores nothing.
 *
 * Where a copy lives, and what deletes it:
 *
 *   - `opts.jobId` given (a workflow run's orchestrator, which has the job's
 *     id but no job context), or called inside a video-worker job (the running
 *     job's id): `tmp/provider-input/<jobId>/outside-input-<uuid>-<nonce>.<ext>`.
 *     The video worker empties that folder when the job ends
 *     (`discardJobScratch`). A job that never reaches the video worker's end
 *     (refused and its row deleted, or run by another worker) leaves it to the
 *     daily age sweep (`job-scratch-sweep.ts`, 7 days).
 *   - No job id and no job context (a route's guard, before the job row
 *     exists): the flat `tmp/provider-input/outside-input-<uuid>-<nonce>.<ext>`,
 *     which only the 7-day sweep deletes — whether the request then runs or is
 *     refused.
 *
 * A quote binds nothing and must store nothing: {@link inspectOutsideInput}
 * runs the same checks and the same `inspect` on the same bytes, stores
 * nothing, and draws on its own, smaller set of slots so quotes cannot starve
 * runs.
 *
 * Errors: a typed refusal, a cancellation / drain / the caller's abort (thrown
 * as they are), `LinkImportsDisabledError`, `UploadBlockedError`, or
 * {@link OutsideInputFailedError} for anything else (its cause logged on the
 * server only: a file-system or storage error can name a temp path, a key or
 * the storage endpoint).
 *
 * Generic platform plumbing: it names no model and no provider. Works in the
 * API process, the orchestrator and the workers (no job context needed).
 */
import { randomUUID } from "node:crypto"
import { createWriteStream } from "node:fs"
import { chmod, mkdtemp, open, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { isOwnStoredFileUrl } from "./own-storage-url.js"
import { boundedPublicChunks, PublicDownloadTooLargeError } from "./safe-fetch-bytes.js"
import { headR2Object, r2KeyFromOurUrl, r2Url } from "./storage.js"
import { keptStoragePrefix } from "./kept-storage-prefixes.js"
import { uploadJobScratchFile } from "./job-scratch.js"
import { applyUploadPolicies, hasUploadPolicies, UploadBlockedError } from "./upload-policy.js"
import { assertLinkImportAllowed, LinkImportsDisabledError } from "./link-imports.js"
import { JobCancelledError } from "./job-cancellation.js"
import { isDrainAbortError } from "./worker-drain.js"
import { createInflightSlots, type InflightSlots } from "./inflight-slots.js"

/** What kind of media the input is: the type its first bytes must show, and the upload policy's kind. */
export type OutsideInputKind = "image" | "video" | "audio"

/**
 * Copies: at most this many outside inputs are downloaded at once for one
 * user, and in all, in one process (each streams up to its cap to this host's
 * disk; a burst must not fill it). A call over a limit waits up to
 * {@link OUTSIDE_INPUT_SLOT_WAIT_MS} for a slot (a workflow's parallel nodes
 * queue briefly), then is refused with {@link OutsideInputBusyError}. An
 * already-stored input takes no slot.
 */
export const OUTSIDE_INPUT_MAX_INFLIGHT_PER_USER = 2
export const OUTSIDE_INPUT_MAX_INFLIGHT_GLOBAL = 8
export const OUTSIDE_INPUT_SLOT_WAIT_MS = 30_000
/** Quotes ({@link inspectOutsideInput}): their own, smaller set, so quotes cannot starve runs; a short wait. */
export const OUTSIDE_INPUT_QUOTE_MAX_INFLIGHT_PER_USER = 1
export const OUTSIDE_INPUT_QUOTE_MAX_INFLIGHT_GLOBAL = 4
export const OUTSIDE_INPUT_QUOTE_SLOT_WAIT_MS = 5_000
/** The longest a slot is held in all: the download, `inspect`, the policy check and the upload. */
export const OUTSIDE_INPUT_MAX_HOLD_MS = 5 * 60_000

const copySlots = createInflightSlots({ perUser: OUTSIDE_INPUT_MAX_INFLIGHT_PER_USER, global: OUTSIDE_INPUT_MAX_INFLIGHT_GLOBAL })
const quoteSlots = createInflightSlots({ perUser: OUTSIDE_INPUT_QUOTE_MAX_INFLIGHT_PER_USER, global: OUTSIDE_INPUT_QUOTE_MAX_INFLIGHT_GLOBAL })

/** Tests only: how many slots of a set are held (in all, or for one user). */
export function outsideInputSlotsHeld(set: "copy" | "quote", userId?: string): number {
  return (set === "copy" ? copySlots : quoteSlots).held(userId)
}

/** The longest a download may take, and the default: the SSRF-safe fetch's own ceiling. */
export const OUTSIDE_INPUT_MAX_TIMEOUT_MS = 120_000
/** The largest cap a lane may pass: the SSRF-safe fetch's own ceiling. */
export const OUTSIDE_INPUT_MAX_BYTES_CEILING = 500 * 1024 * 1024

interface OutsideInputBaseOptions {
  /** What the input must be: its first bytes must show a format of this kind. */
  readonly kind: OutsideInputKind
  /** The most bytes the input may have, stored or copied (at most {@link OUTSIDE_INPUT_MAX_BYTES_CEILING}). */
  readonly maxBytes: number
  /** Whom the input is fetched for: their slots, and the upload policy's user. */
  readonly userId: string
  /** The download's time limit in ms (default and maximum {@link OUTSIDE_INPUT_MAX_TIMEOUT_MS}). */
  readonly timeoutMs?: number
  /** Aborts the work (its reason is thrown as is). */
  readonly signal?: AbortSignal
}

/**
 * Reads the downloaded copy's local file before anything is stored; its
 * result is returned as `inspected`. A throw refuses the input
 * ({@link OutsideInputInspectRefusedError}, the throw as its `reason`) with
 * nothing stored. It MUST NOT modify the file (it is handed read-only, and the
 * size and type are read again after it returns). `signal` fires when the work
 * is stopped or the slot's time is up ({@link OUTSIDE_INPUT_MAX_HOLD_MS}), and
 * the file is deleted then: `inspect` MUST stop its tool when it fires (kill
 * its ffprobe) — a hung probe otherwise outlives its slot.
 * Runs only for a copy, never for an already-stored input.
 */
export type OutsideInputInspect<T> = (localPath: string, signal: AbortSignal) => Promise<T> | T

export interface CopyOutsideInputOptions<T> extends OutsideInputBaseOptions {
  /** The lane's own check of the copy, required: nothing is stored that the lane has not read. */
  readonly inspect: OutsideInputInspect<T>
  /**
   * The job whose scratch folder holds the copy. Omitted: the running job
   * inside a video-worker job, else the flat scratch key (see the module note).
   */
  readonly jobId?: string
}

export interface InspectOutsideInputOptions<T> extends OutsideInputBaseOptions {
  readonly inspect?: OutsideInputInspect<T>
}

export interface OwnStoredInput<T> {
  /** A URL on this install's own storage (`isOwnStoredFileUrl`): the stored input's canonical address, or its copy's. */
  readonly url: string
  /** Its exact size: storage's record of a stored input, the bytes stored for a copy. */
  readonly bytes: number
  /** True when the input was copied; false when it was already on our storage (and `inspect` did not run). */
  readonly copied: boolean
  /** What `inspect` returned (a copy only). */
  readonly inspected?: T
}

export interface InspectedInput<T> {
  /** The exact size, as {@link OwnStoredInput.bytes}. */
  readonly bytes: number
  /** True when the input is an outside one (downloaded and inspected, not stored). */
  readonly outside: boolean
  /** What `inspect` returned (an outside input only). */
  readonly inspected?: T
}

/** Why an input was refused. A lane maps `code` to its own sentence; the message names no address. */
export abstract class OutsideInputRefusal extends Error {
  abstract readonly code:
    | "input_too_large"
    | "input_unreadable"
    | "input_wrong_kind"
    | "input_refused"
    | "input_busy"
    | "input_timed_out"
}

/** Too many inputs are being downloaded right now (see {@link OUTSIDE_INPUT_MAX_INFLIGHT_PER_USER}): try again in a moment. */
export class OutsideInputBusyError extends OutsideInputRefusal {
  readonly code = "input_busy" as const
  constructor() {
    super("Too many files are being fetched right now. Try again in a moment.")
    this.name = "OutsideInputBusyError"
  }
}

/** The input is larger than the lane's cap (stored, declared or actually streamed). */
export class OutsideInputTooLargeError extends OutsideInputRefusal {
  readonly code = "input_too_large" as const
  constructor(readonly maxBytes: number) {
    super(`The file is larger than the ${Math.floor(maxBytes / 1_000_000)} MB this step takes.`)
    this.name = "OutsideInputTooLargeError"
  }
}

/** The input could not be read: an outside link that could not be downloaded (unreachable, refused, empty), or a stored file that is not there or not ours to read. */
export class OutsideInputUnreadableError extends OutsideInputRefusal {
  readonly code = "input_unreadable" as const
  constructor() {
    super("The file could not be read from its link.")
    this.name = "OutsideInputUnreadableError"
  }
}

/** The downloaded file is not of the kind the lane takes (its first bytes show another format, or none known). */
export class OutsideInputWrongKindError extends OutsideInputRefusal {
  readonly code = "input_wrong_kind" as const
  constructor(readonly expected: OutsideInputKind) {
    super(`The file is not ${expected === "audio" ? "an audio file" : `a${expected === "image" ? "n image" : " video"}`} this step can read.`)
    this.name = "OutsideInputWrongKindError"
  }
}

/** The slot was held past {@link OUTSIDE_INPUT_MAX_HOLD_MS} (a slow download, check or upload): nothing was stored. */
export class OutsideInputTimedOutError extends OutsideInputRefusal {
  readonly code = "input_timed_out" as const
  constructor() {
    super("Reading the file took too long. Try again in a moment.")
    this.name = "OutsideInputTimedOutError"
  }
}

/**
 * The lane's `inspect` refused the copy. Its own error is `reason` (not a
 * `cause`, so nothing it carries is walked into a job's error detail), for the
 * LANE to read and never to show: it can name a temp path or a tool's output.
 * Any throw lands here except the job being stopped (thrown as it is), so a
 * lane reads `reason` to tell its own refusal from a failure of the box (an
 * ffprobe the platform killed or could not admit), which may pass on a retry.
 */
export class OutsideInputInspectRefusedError extends OutsideInputRefusal {
  readonly code = "input_refused" as const
  constructor(readonly reason: unknown) {
    super("The file was refused before it was stored.")
    this.name = "OutsideInputInspectRefusedError"
  }
}

export function isOutsideInputRefusal(err: unknown): err is OutsideInputRefusal {
  return err instanceof OutsideInputRefusal
}

/**
 * Anything else that went wrong (a file-system or storage failure): one fixed
 * sentence, the original logged on the server only. Not the input's fault; a
 * retry may pass.
 */
export class OutsideInputFailedError extends Error {
  readonly code = "input_failed" as const
  constructor() {
    super("The file could not be prepared. Try again in a moment.")
    this.name = "OutsideInputFailedError"
  }
}

/**
 * `url` as an input on our own storage, with its exact size: the canonical
 * address of a stored input, else a copy (see the module note).
 */
export async function copyOutsideInput<T>(url: string, opts: CopyOutsideInputOptions<T>): Promise<OwnStoredInput<T>> {
  checkOptions(opts)
  if (typeof opts.inspect !== "function") throw new Error("outside-input: inspect is required to copy")
  try {
    const own = await storedInput(url, opts.maxBytes)
    if (own) return { ...own, copied: false }
    assertLinkImportAllowed(url)
    return await withDownload(url, opts, copySlots, OUTSIDE_INPUT_SLOT_WAIT_MS, async (local, stillHeld) => {
      if (hasUploadPolicies()) {
        const decision = await applyUploadPolicies({
          kind: local.kind,
          lane: "media-import",
          mime: local.contentType,
          sizeBytes: local.bytes,
          userId: opts.userId,
          buffer: await policySample(local.path, local.bytes),
        })
        if (!decision.allow) throw new UploadBlockedError(decision)
      }
      stillHeld()
      // A full random name: a copy is served immutable, so two must never share a key.
      const stored = await uploadJobScratchFile(local.path, `outside-input-${randomUUID()}`, local.ext, local.contentType, opts.jobId)
      // What the platform's backstop accepts, checked here so a misconfigured
      // storage base fails at its source rather than at every later step.
      if (!isOwnStoredFileUrl(stored)) throw new Error("outside-input: the stored copy failed the own-storage check")
      return { url: stored, bytes: local.bytes, copied: true, ...(local.inspected !== undefined ? { inspected: local.inspected } : {}) }
    })
  } catch (err) {
    throw publicError(err, opts.signal)
  }
}

/**
 * {@link copyOutsideInput}'s checks without the copy, for a quote: an
 * already-stored input's size from storage, an outside one downloaded,
 * capped, typed and inspected exactly as a run would, then discarded. Nothing
 * is stored and the upload policy is not asked (nothing is uploaded). Draws on
 * the quotes' own slots.
 */
export async function inspectOutsideInput<T = never>(url: string, opts: InspectOutsideInputOptions<T>): Promise<InspectedInput<T>> {
  checkOptions(opts)
  try {
    const own = await storedInput(url, opts.maxBytes)
    if (own) return { bytes: own.bytes, outside: false }
    assertLinkImportAllowed(url)
    return await withDownload(url, opts, quoteSlots, OUTSIDE_INPUT_QUOTE_SLOT_WAIT_MS, async (local) => ({
      bytes: local.bytes,
      outside: true,
      ...(local.inspected !== undefined ? { inspected: local.inspected } : {}),
    }))
  } catch (err) {
    throw publicError(err, opts.signal)
  }
}

function checkOptions(opts: OutsideInputBaseOptions): void {
  if (!Number.isSafeInteger(opts.maxBytes) || opts.maxBytes < 1 || opts.maxBytes > OUTSIDE_INPUT_MAX_BYTES_CEILING) {
    throw new Error(`outside-input: maxBytes must be a whole number of bytes from 1 to ${OUTSIDE_INPUT_MAX_BYTES_CEILING}`)
  }
  const timeout = opts.timeoutMs ?? OUTSIDE_INPUT_MAX_TIMEOUT_MS
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > OUTSIDE_INPUT_MAX_TIMEOUT_MS) {
    throw new Error(`outside-input: timeoutMs must be from 1 to ${OUTSIDE_INPUT_MAX_TIMEOUT_MS}`)
  }
  if (typeof opts.userId !== "string" || opts.userId === "") throw new Error("outside-input: userId is required")
}

/** What a caller may see: our own typed errors and the job being stopped as they are, anything else as one fixed sentence. */
function publicError(err: unknown, signal: AbortSignal | undefined): unknown {
  if (
    err instanceof OutsideInputRefusal ||
    err instanceof OutsideInputFailedError ||
    err instanceof LinkImportsDisabledError ||
    err instanceof UploadBlockedError
  ) return err
  const stop = stopping(err, signal)
  if (stop !== undefined) return stop
  console.error(`[outside-input] failed: ${err instanceof Error ? err.message : String(err)}`)
  return new OutsideInputFailedError()
}

/** A plain storage key: no empty, `.` or `..` segment (`//a.png` reads as the key `/a.png`). */
function isPlainStorageKey(key: string): boolean {
  return key.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..")
}

/**
 * An input already on our storage: its canonical address and its size from
 * storage's own record, or undefined when `url` is not one (an outside input).
 */
async function storedInput(url: string, maxBytes: number): Promise<{ url: string; bytes: number } | undefined> {
  if (!isOwnStoredFileUrl(url)) return undefined
  const key = r2KeyFromOurUrl(url)
  // Never answered about: a key that is not plain, or a kept folder's (the
  // credentialed head would skip the public edge's rule on it).
  if (!key || !isPlainStorageKey(key) || keptStoragePrefix(key)) throw new OutsideInputUnreadableError()
  const canonical = r2Url(key)
  if (!isOwnStoredFileUrl(canonical)) throw new Error("outside-input: a stored input's address failed the own-storage check")
  const head = await headR2Object(key)
  if (!head.exists || head.sizeBytes === undefined || head.sizeBytes < 1) throw new OutsideInputUnreadableError()
  if (head.sizeBytes > maxBytes) throw new OutsideInputTooLargeError(maxBytes)
  return { url: canonical, bytes: head.sizeBytes }
}

interface LocalInput<T> {
  readonly path: string
  readonly bytes: number
  readonly kind: OutsideInputKind
  readonly ext: string
  readonly contentType: string
  readonly inspected: T | undefined
}

/**
 * Take a slot of `set`, download `url` to a read-only temp file (capped on the
 * bytes read), type it, inspect it, hand it to `use`, and remove the temp
 * folder. The slot is given back on every way out, and at the latest after
 * {@link OUTSIDE_INPUT_MAX_HOLD_MS}, with the temp folder: work still running
 * then (a hung `inspect`, told through its signal) is fenced off — `use` is
 * told through `stillHeld`, which throws, so it stores nothing. An upload
 * already under way when the time is up may still land; nothing returns its
 * address, and the 7-day sweep deletes it.
 */
async function withDownload<T, R>(
  url: string,
  opts: OutsideInputBaseOptions & { readonly inspect?: OutsideInputInspect<T> },
  set: InflightSlots,
  waitMs: number,
  use: (local: LocalInput<T>, stillHeld: () => void) => Promise<R>,
): Promise<R> {
  if (!(await set.acquire(opts.userId, { waitMs, ...(opts.signal ? { signal: opts.signal } : {}) }))) {
    throw new OutsideInputBusyError()
  }
  const deadline = new AbortController()
  const timer = setTimeout(() => deadline.abort(new OutsideInputTimedOutError()), OUTSIDE_INPUT_MAX_HOLD_MS)
  const signal = opts.signal ? AbortSignal.any([opts.signal, deadline.signal]) : deadline.signal
  let dir: string | undefined
  try {
    dir = await mkdtemp(join(tmpdir(), "outside-input-"))
    const work = inDownloadSlot(url, dir, { ...opts, signal }, use)
    // Settled unobserved when the race below ends first.
    work.catch(() => undefined)
    return await new Promise<R>((resolve, reject) => {
      if (signal.aborted) return reject(signal.reason)
      signal.addEventListener("abort", () => reject(signal.reason), { once: true })
      work.then(resolve, reject)
    })
  } finally {
    clearTimeout(timer)
    // The temp folder goes with the slot, so the slots bound the disk too (a
    // check still reading past the deadline was told through `signal`).
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    set.release(opts.userId)
  }
}

async function inDownloadSlot<T, R>(
  url: string,
  dir: string,
  opts: OutsideInputBaseOptions & { readonly inspect?: OutsideInputInspect<T>; readonly signal: AbortSignal },
  use: (local: LocalInput<T>, stillHeld: () => void) => Promise<R>,
): Promise<R> {
  const stillHeld = () => { if (opts.signal.aborted) throw opts.signal.reason }
  try {
    const path = join(dir, "input")
    await download(url, path, opts)
    await chmod(path, 0o400)
    await typedAs(path, opts.kind)
    let inspected: T | undefined
    if (opts.inspect) {
      try {
        inspected = await opts.inspect(path, opts.signal)
      } catch (err) {
        throw stopping(err, opts.signal) ?? new OutsideInputInspectRefusedError(err)
      }
    }
    stillHeld()
    // Read again AFTER `inspect`: what is stored is what is reported.
    const bytes = (await stat(path)).size
    if (bytes > opts.maxBytes) throw new OutsideInputTooLargeError(opts.maxBytes)
    const type = await typedAs(path, opts.kind)
    return await use({ path, bytes, ...type, inspected }, stillHeld)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

/** The file's type from its first bytes, refused unless it is of `kind`. */
async function typedAs(path: string, kind: OutsideInputKind): Promise<InputType> {
  const type = sniffInputType(await readHead(path), kind)
  if (!type) throw new OutsideInputWrongKindError(kind)
  return { kind, ...type }
}

/** Stream `url` to `dest` through the SSRF-safe fetch, refusing past `maxBytes` actually read. */
async function download(url: string, dest: string, opts: OutsideInputBaseOptions & { readonly signal: AbortSignal }): Promise<void> {
  const chunks = boundedPublicChunks(url, {
    maxBytes: opts.maxBytes,
    timeoutMs: opts.timeoutMs ?? OUTSIDE_INPUT_MAX_TIMEOUT_MS,
    // Only names the fetch's own error messages, which are replaced below.
    label: opts.kind === "image" ? "Image" : "Video",
    signal: opts.signal,
  })
  // Only the fetch's failures are refusals; a local write failure is not.
  async function* fetched(): AsyncGenerator<Buffer> {
    try {
      yield* chunks
    } catch (err) {
      const stop = stopping(err, opts.signal)
      if (stop !== undefined) throw stop
      if (err instanceof PublicDownloadTooLargeError) throw new OutsideInputTooLargeError(opts.maxBytes)
      console.warn(`[outside-input] download refused: ${err instanceof Error ? err.message : String(err)}`)
      throw new OutsideInputUnreadableError()
    }
  }
  await pipeline(Readable.from(fetched()), createWriteStream(dest))
}

/**
 * The work being stopped, not the input being bad: a cancellation, a worker
 * drain handing the job back, the caller's own abort or the held span's
 * deadline. Thrown as it is (the worker recognises each by its type), never
 * as a refusal of the file.
 */
function stopping(err: unknown, signal: AbortSignal | undefined): unknown {
  if (err instanceof JobCancelledError || isDrainAbortError(err)) return err
  if (signal?.aborted) return signal.reason ?? err
  return undefined
}

/** The upload policy's look at the bytes: the whole file up to 25 MiB (every image), else its first 256 KiB, as the media-import lane does. */
async function policySample(path: string, bytes: number): Promise<Buffer> {
  return readHead(path, bytes <= 25 * 1024 * 1024 ? bytes : 256 * 1024)
}

async function readHead(path: string, size = 16): Promise<Buffer> {
  const fh = await open(path, "r")
  try {
    const buf = Buffer.alloc(size)
    const { bytesRead } = await fh.read(buf, 0, size, 0)
    return buf.subarray(0, bytesRead)
  } finally {
    await fh.close()
  }
}

interface InputType { readonly kind: OutsideInputKind; readonly ext: string; readonly contentType: string }

/** ISO-BMFF brands of a still image (AVIF, HEIF): every other `ftyp` brand is an audio-or-video container. */
const AVIF_BRANDS = new Set(["avif", "avis"])
const HEIF_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx", "mif1", "msf1"])
/** A QuickTime file whose first box is not `ftyp`: the box types it can start with. */
const QUICKTIME_FIRST_BOXES = new Set(["wide", "free", "skip", "mdat", "moov"])

/**
 * What a file of `kind` is stored as, from its first bytes (never the remote
 * server's word for it), or undefined when its first bytes show no format of
 * that kind listed here (the lane's `inspect` decides the rest: a listed
 * format can still be refused there).
 *
 * A container that holds sound or pictures alike (ISO-BMFF with any brand that
 * is not an image's, WebM / Matroska, Ogg) is taken for either `audio` or
 * `video`, typed by the kind asked for: the lane's stream probe decides
 * whether it really has what the lane needs.
 */
export function sniffInputType(head: Buffer, kind: OutsideInputKind): Omit<InputType, "kind"> | undefined {
  const ascii = (from: number, to: number) => head.subarray(from, to).toString("latin1")
  const audio = kind === "audio"
  const video = kind === "video"
  const image = kind === "image"
  if (head.length >= 12 && ascii(4, 8) === "ftyp") {
    const brand = ascii(8, 12)
    if (AVIF_BRANDS.has(brand)) return image ? { ext: "avif", contentType: "image/avif" } : undefined
    if (HEIF_BRANDS.has(brand)) return image ? { ext: "heic", contentType: "image/heic" } : undefined
    if (audio) return { ext: "m4a", contentType: "audio/mp4" }
    if (video) return brand === "qt  " ? { ext: "mov", contentType: "video/quicktime" } : { ext: "mp4", contentType: "video/mp4" }
    return undefined
  }
  if (head.length >= 4 && head.readUInt32BE(0) === 0x1a45dfa3) {
    return audio ? { ext: "webm", contentType: "audio/webm" } : video ? { ext: "webm", contentType: "video/webm" } : undefined
  }
  if (head.length >= 4 && ascii(0, 4) === "OggS") {
    return audio ? { ext: "ogg", contentType: "audio/ogg" } : video ? { ext: "ogv", contentType: "video/ogg" } : undefined
  }
  if (head.length >= 12 && ascii(8, 12) === "WAVE" && ["RIFF", "RF64", "BW64"].includes(ascii(0, 4))) {
    return audio ? { ext: "wav", contentType: "audio/wav" } : undefined
  }
  if (head.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "AVI ") return video ? { ext: "avi", contentType: "video/x-msvideo" } : undefined
  if (head.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return image ? { ext: "webp", contentType: "image/webp" } : undefined
  if (head.length >= 8 && head.readUInt32BE(0) === 0x89504e47) return image ? { ext: "png", contentType: "image/png" } : undefined
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return image ? { ext: "jpg", contentType: "image/jpeg" } : undefined
  if (head.length >= 6 && (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a")) return image ? { ext: "gif", contentType: "image/gif" } : undefined
  if (head.length >= 4 && (ascii(0, 4) === "II*\u0000" || ascii(0, 4) === "MM\u0000*")) return image ? { ext: "tiff", contentType: "image/tiff" } : undefined
  if (head.length >= 2 && ascii(0, 2) === "BM") return image ? { ext: "bmp", contentType: "image/bmp" } : undefined
  if (head.length >= 4 && ascii(0, 4) === "fLaC") return audio ? { ext: "flac", contentType: "audio/flac" } : undefined
  if (head.length >= 3 && ascii(0, 3) === "ID3") return audio ? { ext: "mp3", contentType: "audio/mpeg" } : undefined
  // An MPEG audio frame's sync: layer bits 00 are ADTS (AAC), anything else an MP3 frame.
  if (head.length >= 2 && head[0] === 0xff && (head[1]! & 0xf0) === 0xf0 && (head[1]! & 0x06) === 0) {
    return audio ? { ext: "aac", contentType: "audio/aac" } : undefined
  }
  if (head.length >= 2 && head[0] === 0xff && (head[1]! & 0xe0) === 0xe0) return audio ? { ext: "mp3", contentType: "audio/mpeg" } : undefined
  // Last: a QuickTime file whose first box is not `ftyp` (only a box type marks it).
  if (head.length >= 8 && QUICKTIME_FIRST_BOXES.has(ascii(4, 8))) return video ? { ext: "mov", contentType: "video/quicktime" } : undefined
  return undefined
}
