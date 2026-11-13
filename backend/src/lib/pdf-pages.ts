// @reads-none resolves and loads the pdf-lib dependency in a worker; reads no repo file
/**
 * The page count of a PDF an LLM call reads, from a real parser in an
 * isolated thread (decided 2026-11-13).
 *
 * The count sizes the call's hold, its page limit and its charge floor, and
 * the file is the caller's, so reading it must never hurt the process. A
 * keyword scan could be fooled and made slow; this reads it as a PDF reader
 * does, and answers TWO counts, each for what it decides (decided 2026-11-13):
 *  - `pages`: the leaves of the page tree pdf-lib parsed, walked from the
 *    catalog's `/Pages` — what a reader shows for an ordinary file, edited
 *    ones included (pages removed and saved, an incremental update that
 *    deletes pages). The 100-pages-in-all cap and the charge floor use it, so
 *    a legitimate file is never refused nor over-charged.
 *  - `holdPages`: the largest of three readings — that walk, the distinct
 *    `/Type /Page` objects parsed, the largest `/Count` of any page-tree node.
 *    pdf-lib reads front to back (the last copy of an object wins), so a
 *    crafted file can hide pages from its walk; the hold uses this count, so
 *    such a file is never under-held (over-holding is released at the settle).
 *    Accepted: such a file can pass the page cap up to the provider's own
 *    limit and, only where the reply states no charge, be floored by `pages`
 *    (a few cents per hundred hidden pages).
 *  - The parse runs in a `worker_threads` Worker with a heap limit
 *    ({@link PDF_WORKER_LIMITS}), a cap on what its streams may inflate to
 *    ({@link PDF_STREAM_DECODED_MAX_BYTES} each,
 *    {@link PDF_DECODED_MAX_BYTES} in all: pdf-lib's own decoder, capped in
 *    the worker) and a wall-clock limit ({@link PDF_PARSE_TIMEOUT_MS}), after
 *    which the worker is terminated. The main thread never parses PDF bytes.
 *  - At most {@link PDF_WORKERS_MAX} run at once in a process; a file that
 *    waits longer than {@link PDF_WORKER_WAIT_MS} for one is refused as busy.
 *
 * A file that cannot be read within those bounds counts as null: the caller
 * refuses it as unreadable.
 */
import { Worker } from "node:worker_threads"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"

/**
 * pdf-lib's CommonJS entry and the two modules the worker adjusts, resolved
 * here (so the worker loads them by absolute path, whatever its working
 * directory) on first use, never at module load: a missing package fails a
 * document read, never the API's boot.
 */
let pdfLibPaths: { main: string; decodeStream: string; byteStream: string } | null = null
function resolvePdfLib(): { main: string; decodeStream: string; byteStream: string } {
  if (!pdfLibPaths) {
    const main = createRequire(import.meta.url).resolve("pdf-lib")
    const core = join(dirname(main), "core")
    pdfLibPaths = { main, decodeStream: join(core, "streams", "DecodeStream.js"), byteStream: join(core, "parser", "ByteStream.js") }
  }
  return pdfLibPaths
}

/** How long one file may take to read, worker start included. */
export const PDF_PARSE_TIMEOUT_MS = 3_000
/** How many PDF workers one process runs at once. */
export const PDF_WORKERS_MAX = 2
/** How long a file may wait for a worker before it is refused as busy. */
export const PDF_WORKER_WAIT_MS = 5_000
/** The worker's heap. */
export const PDF_WORKER_LIMITS = { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 } as const
/** The most bytes one stream of the file may inflate to. */
export const PDF_STREAM_DECODED_MAX_BYTES = 16 * 1024 * 1024
/** The most bytes all of the file's streams may inflate to together (outside the heap: typed arrays). */
export const PDF_DECODED_MAX_BYTES = 64 * 1024 * 1024
/** The most page-tree nodes the count visits (a tree that repeats a subtree many times is refused). */
const PDF_TREE_MAX_VISITS = 100_000

/** No worker was free within {@link PDF_WORKER_WAIT_MS}. */
export class PdfReaderBusyError extends Error {
  constructor() {
    super("Every PDF reader is busy")
    this.name = "PdfReaderBusyError"
  }
}

/**
 * The worker, as CommonJS source (`eval: true`), so it needs no build step of
 * its own and runs the same from `src/` (tests, dev) and `dist/`. Before it
 * loads pdf-lib it:
 *  - silences `console` (pdf-lib warns about every odd object);
 *  - caps pdf-lib's decoder ({@link PDF_STREAM_DECODED_MAX_BYTES} a stream,
 *    {@link PDF_DECODED_MAX_BYTES} in all);
 *  - makes `ByteStream.slice` a view, not a copy: pdf-lib copies a stream's
 *    bytes each time it parses it, and an object stream may list one large
 *    stream any number of times — copies outside the heap limit that would
 *    let a 25 KB file take the process's memory;
 *  - notes, as pdf-lib parses, every object number whose dictionary says
 *    `/Type /Page` and the largest `/Count` of any `/Type /Pages` node.
 *
 * pdf-lib reads the file front to back (the last copy of an object wins), so
 * the walk of its page tree may see less than a reader that follows the
 * cross-reference table. The count is the LARGEST of three readings, so it is
 * never below what a reader shows: the tree's leaves (a `/Type /Page` node is
 * a leaf, whatever else it carries), the distinct page objects parsed, and
 * the largest `/Count`. A kid that does not resolve to a dictionary refuses
 * the file. Answers `{ pages }` (null: unreadable).
 */
const WORKER_SOURCE = String.raw`
"use strict"
for (const k of ["log", "warn", "error", "info", "debug", "trace"]) console[k] = () => {}
const { parentPort, workerData } = require("node:worker_threads")
const { pdfLib, decodeStream, byteStream, bytes, streamMax, totalMax, maxVisits } = workerData
let decoded = 0
let overBudget = false
const DecodeStream = require(decodeStream).default
const ensureBuffer = DecodeStream.prototype.ensureBuffer
DecodeStream.prototype.ensureBuffer = function (requested) {
  if (requested > streamMax) { overBudget = true; throw new Error("a stream inflates past its cap") }
  const before = this.buffer ? this.buffer.byteLength : 0
  const buffer = ensureBuffer.call(this, requested)
  decoded += buffer.byteLength - before
  if (decoded > totalMax) { overBudget = true; throw new Error("the file inflates past its budget") }
  return buffer
}
require(byteStream).default.prototype.slice = function (start, end) { return this.bytes.subarray(start, end) }
const { PDFDocument, PDFName, PDFDict, PDFArray, PDFRef, PDFContext, PDFPageLeaf, PDFPageTree, PDFNumber } = require(pdfLib)
const COUNT = PDFName.of("Count")
const pageObjects = new Set()
let maxCount = 0
const assign = PDFContext.prototype.assign
PDFContext.prototype.assign = function (ref, object) {
  if (object instanceof PDFPageLeaf) pageObjects.add(ref.objectNumber)
  else if (object instanceof PDFPageTree) {
    const count = object.get(COUNT)
    if (count instanceof PDFNumber && Number.isFinite(count.asNumber())) maxCount = Math.max(maxCount, Math.floor(count.asNumber()))
  }
  return assign.call(this, ref, object)
}
class Unresolved extends Error {}
function pageLeaves(doc) {
  const KIDS = PDFName.of("Kids"), TYPE = PDFName.of("Type"), PAGES = PDFName.of("Pages"), PAGE = PDFName.of("Page")
  let visits = 0
  let leaves = 0
  const onPath = new Set()
  const walk = (item, depth) => {
    if (++visits > maxVisits || depth > 64) throw new Error("page tree too large")
    const key = item instanceof PDFRef ? item.toString() : null
    if (key && onPath.has(key)) return
    const node = doc.context.lookup(item)
    if (!(node instanceof PDFDict)) throw new Unresolved()
    const type = node.lookup(TYPE)
    const kids = node.lookup(KIDS)
    if (type === PAGE || !(kids instanceof PDFArray)) {
      if (type !== PAGES) leaves++
      return
    }
    if (key) onPath.add(key)
    for (let i = 0; i < kids.size(); i++) walk(kids.get(i), depth + 1)
    if (key) onPath.delete(key)
  }
  walk(doc.catalog.get(PAGES), 0)
  return leaves
}
PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false, parseSpeed: Infinity })
  .then((doc) => {
    const walked = pageLeaves(doc)
    if (overBudget || walked < 1) return parentPort.postMessage({ pages: null })
    parentPort.postMessage({ pages: walked, holdPages: Math.max(walked, pageObjects.size, maxCount) })
  })
  .catch(() => parentPort.postMessage({ pages: null }))
`

let active = 0
const waiting: Array<() => void> = []

/** A worker slot, within `waitMs`; {@link PdfReaderBusyError} past it, the signal's reason on abort. */
function acquireSlot(waitMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason)
  if (active < PDF_WORKERS_MAX) {
    active++
    return Promise.resolve()
  }
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer)
      signal?.removeEventListener("abort", onAbort)
      const i = waiting.indexOf(grant)
      if (i >= 0) waiting.splice(i, 1)
    }
    const grant = () => {
      cleanup()
      active++
      resolve()
    }
    const onAbort = () => {
      cleanup()
      reject(signal!.reason)
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(new PdfReaderBusyError())
    }, waitMs)
    waiting.push(grant)
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

function releaseSlot(): void {
  active--
  waiting.shift()?.()
}

/** Test hook: hold every worker slot until the returned release is called. */
export async function __holdPdfReaderSlotsForTests(): Promise<() => void> {
  for (let i = 0; i < PDF_WORKERS_MAX; i++) await acquireSlot(PDF_WORKER_WAIT_MS)
  return () => {
    for (let i = 0; i < PDF_WORKERS_MAX; i++) releaseSlot()
  }
}

/** A document's two page counts (see the module's header). */
export interface PdfPageCount {
  /** The page tree's leaves: what a reader shows. The cap and the charge floor use it. */
  pages: number
  /** The largest of the three readings, never below `pages`: what the hold sizes by. */
  holdPages: number
}

/**
 * The page counts of the PDF in `bytes`, or null when it cannot be read
 * within the worker's bounds (damaged, encrypted beyond what opens without a
 * password, a stream past its cap, too slow, too large a tree, no page).
 * Throws {@link PdfReaderBusyError} when no worker is free in time, and the
 * signal's reason when it aborts (the worker is terminated).
 *
 * `owner` (the user) reads one file at a time in this process: a second read
 * of the same owner waits behind the first before it asks for a worker, so
 * one user never holds both workers and another user's file still runs.
 */
export async function countPdfPages(
  bytes: Uint8Array,
  opts: { signal?: AbortSignal; timeoutMs?: number; waitMs?: number; owner?: string } = {},
): Promise<PdfPageCount | null> {
  const { signal } = opts
  const releaseOwner = opts.owner ? await takeDocumentReadTurn(opts.owner, signal) : () => {}
  try {
    await acquireSlot(opts.waitMs ?? PDF_WORKER_WAIT_MS, signal)
    try {
      return await runWorker(bytes, opts.timeoutMs ?? PDF_PARSE_TIMEOUT_MS, signal)
    } finally {
      releaseSlot()
    }
  } finally {
    releaseOwner()
  }
}

/** Each owner's last turn in line: the next read of that owner waits for it. */
const ownerTurns = new Map<string, Promise<void>>()

/** How long one owner's read may wait behind their own earlier reads before it is refused as busy. */
export const PDF_OWNER_WAIT_MS = 30_000

/**
 * The owner's turn to read documents here, once every earlier turn of the
 * same owner is done. Call the returned function when done. Refused, giving
 * the place up: the signal's reason on abort, {@link PdfReaderBusyError} past
 * `waitMs` ({@link PDF_OWNER_WAIT_MS}), so a user's queued calls never wait
 * without end. {@link countPdfPages} takes one per read when given an
 * `owner`; a caller that reads several files (and fetches them) takes one for
 * all of them and counts without an owner.
 *
 * A turn given up early only stops waiting: the next turn still waits for
 * the one before it, so a later read never starts beside a running one. The
 * owner's entry is dropped once the last turn in line has settled.
 */
export async function takeDocumentReadTurn(owner: string, signal?: AbortSignal, waitMs = PDF_OWNER_WAIT_MS): Promise<() => void> {
  const before = ownerTurns.get(owner) ?? Promise.resolve()
  let done!: () => void
  const mine = new Promise<void>((resolve) => {
    done = resolve
  })
  const turn = before.then(() => mine)
  ownerTurns.set(owner, turn)
  void turn.then(() => {
    if (ownerTurns.get(owner) === turn) ownerTurns.delete(owner)
  })
  const release = () => done()
  if (signal?.aborted) {
    release()
    throw signal.reason
  }
  try {
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer)
        reject(signal!.reason)
      }
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort)
        reject(new PdfReaderBusyError())
      }, waitMs)
      signal?.addEventListener("abort", onAbort, { once: true })
      void before.then(() => {
        clearTimeout(timer)
        signal?.removeEventListener("abort", onAbort)
        resolve()
      })
    })
  } catch (err) {
    release()
    throw err
  }
  return release
}

function runWorker(bytes: Uint8Array, timeoutMs: number, signal?: AbortSignal): Promise<PdfPageCount | null> {
  // The worker gets its own copy, transferred, so the caller keeps its bytes.
  const copy = new Uint8Array(bytes)
  const lib = resolvePdfLib()
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: {
        pdfLib: lib.main,
        decodeStream: lib.decodeStream,
        byteStream: lib.byteStream,
        bytes: copy,
        streamMax: PDF_STREAM_DECODED_MAX_BYTES,
        totalMax: PDF_DECODED_MAX_BYTES,
        maxVisits: PDF_TREE_MAX_VISITS,
      },
      transferList: [copy.buffer as ArrayBuffer],
      resourceLimits: { ...PDF_WORKER_LIMITS },
      // pdf-lib warns about every odd object; a hostile file's warnings stay in the worker.
      stdout: true,
      stderr: true,
    })
    worker.stdout.resume()
    worker.stderr.resume()
    let settled = false
    // The answer is given only once the worker has stopped, so its slot is
    // never released while it still runs.
    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener("abort", onAbort)
      void worker.terminate().catch(() => undefined).finally(fn)
    }
    const timer = setTimeout(() => settle(() => resolve(null)), timeoutMs)
    const onAbort = () => settle(() => reject(signal!.reason))
    signal?.addEventListener("abort", onAbort, { once: true })
    worker.once("message", (m: { pages?: unknown; holdPages?: unknown }) => {
      const count = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null)
      const pages = count(m?.pages)
      const holdPages = count(m?.holdPages)
      settle(() => resolve(pages === null ? null : { pages, holdPages: Math.max(pages, holdPages ?? pages) }))
    })
    // Out of memory (`ERR_WORKER_OUT_OF_MEMORY`), a crash, an exit with no answer: unreadable.
    worker.once("error", () => settle(() => resolve(null)))
    worker.once("exit", () => settle(() => resolve(null)))
  })
}
