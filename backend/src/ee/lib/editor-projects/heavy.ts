// @reads backend/src/ee/lib/editor-projects/heavy-worker.ts
import { Worker } from "node:worker_threads"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"
import type { HeavyJob, HeavyResult, VersionToRebuild } from "./heavy-jobs.js"
import { refuse } from "./refusal.js"

/**
 * Where the editor-project routes' heavy work runs: a fixed pool of
 * `HEAVY_WORKERS` worker threads per process, never the request thread
 * (which every user of the instance shares). Each job — inflate, parse,
 * patch, canonicalise, hash, diff, gzip (`heavy-jobs.ts`) — runs under a
 * wall-clock limit (`HEAVY_JOB_TIMEOUT_MS`) and a heap limit
 * (`HEAVY_WORKER_LIMITS`). A job past either is killed with its worker (the
 * slot starts a new one on its next job) and answered as the caller decides:
 * a save 422 `too_complex`, a cut's diff "store the version whole", a version
 * read 500 `version_unreadable`. The process never dies of it and the request
 * thread never holds more than the hand-off: bytes in, bytes out, every
 * buffer copied once and transferred.
 *
 * A job that waits longer than `HEAVY_WAIT_MS` for a free worker is refused
 * 429 `busy` (try again shortly). A worker that cannot start, or dies other
 * than by a limit, fails the request as a server error (a logged 500).
 *
 * Loading: the compiled server starts `heavy-worker.js` beside this file
 * (`dist/`, emitted by the build like every module). Run from source (tests,
 * `tsx` dev) the worker file is TypeScript, so it is loaded through tsx's
 * loader, resolved from here. Idle workers are unref'd: they never keep a
 * process alive.
 */

export const HEAVY_WORKERS = 2
export const HEAVY_JOB_TIMEOUT_MS = 10_000
export const HEAVY_WAIT_MS = 10_000
/** How long a new worker may take to load before its job is given up. */
const HEAVY_START_TIMEOUT_MS = 30_000
export const HEAVY_WORKER_LIMITS = { maxOldGenerationSizeMb: 512 } as const

/** A job killed past its time or memory limit, or whose worker died. */
export class HeavyJobKilled extends Error {
  constructor(readonly why: "timeout" | "memory" | "crashed") {
    super(`editor-project job ${why}`)
    this.name = "HeavyJobKilled"
  }
}

const limits = {
  timeoutMs: HEAVY_JOB_TIMEOUT_MS,
  /** Test only: a time limit for one kind of job. */
  timeoutMsByKind: {} as Partial<Record<HeavyJob["kind"], number>>,
  waitMs: HEAVY_WAIT_MS,
  maxOldGenerationSizeMb: HEAVY_WORKER_LIMITS.maxOldGenerationSizeMb as number,
  /** Test only: the source of the workers started from now on (eval'd), in place of `heavy-worker`. */
  workerSource: null as string | null,
}
const started = new Map<string, number>()

/** Test hook: other limits until the returned function restores them (workers started meanwhile keep theirs). */
export function __setHeavyLimitsForTests(next: Partial<typeof limits>): () => void {
  const before = { ...limits }
  Object.assign(limits, next)
  return () => Object.assign(limits, before)
}

/** Test hook: how many jobs of `kind` were handed to a worker in this process. */
export function __heavyJobsStartedForTests(kind: HeavyJob["kind"]): number {
  return started.get(kind) ?? 0
}

/** Test hook: ends every idle worker (the next job starts a new one, with the limits then set). */
export async function __restartHeavyWorkersForTests(): Promise<void> {
  await Promise.all(slots.filter((s) => !s.busy && s.worker).map(async (s) => {
    const worker = s.worker!.worker
    s.worker = null
    await worker.terminate().catch(() => undefined)
  }))
}

interface Running {
  worker: Worker
  ready: Promise<void>
}
interface Slot {
  worker: Running | null
  busy: boolean
}

const slots: Slot[] = Array.from({ length: HEAVY_WORKERS }, () => ({ worker: null, busy: false }))
const waiting: Array<(slot: Slot) => void> = []
let nextId = 0

function workerSource(): { source: string | URL; eval: boolean } {
  const here = import.meta.url
  if (here.endsWith(".ts")) {
    const tsx = pathToFileURL(createRequire(here).resolve("tsx/esm/api")).href
    const entry = new URL("./heavy-worker.ts", here).href
    return { source: `import(${JSON.stringify(tsx)}).then(({ register }) => { register(); return import(${JSON.stringify(entry)}) })`, eval: true }
  }
  return { source: new URL("./heavy-worker.js", here), eval: false }
}

function start(slot: Slot): Running {
  const { source, eval: isEval } = limits.workerSource !== null ? { source: limits.workerSource, eval: true } : workerSource()
  const worker = new Worker(source, { eval: isEval, resourceLimits: { maxOldGenerationSizeMb: limits.maxOldGenerationSizeMb } })
  // Always listened to: an unheard worker `error` would end the process.
  const forget = () => {
    if (slot.worker?.worker === worker) slot.worker = null
  }
  worker.on("error", forget)
  worker.on("exit", forget)
  const ready = new Promise<void>((resolve, reject) => {
    const onReady = (m: { ready?: unknown }) => {
      if (m?.ready !== true) return
      cleanup()
      resolve()
    }
    const onFail = () => {
      cleanup()
      reject(new HeavyJobKilled("crashed"))
    }
    const timer = setTimeout(onFail, HEAVY_START_TIMEOUT_MS)
    const cleanup = () => {
      clearTimeout(timer)
      worker.off("message", onReady)
      worker.off("error", onFail)
      worker.off("exit", onFail)
    }
    worker.on("message", onReady)
    worker.once("error", onFail)
    worker.once("exit", onFail)
  })
  ready.catch(() => undefined)
  worker.unref()
  return { worker, ready }
}

function acquire(): Promise<Slot> {
  const free = slots.find((s) => !s.busy)
  if (free) {
    free.busy = true
    return Promise.resolve(free)
  }
  return new Promise((resolve, reject) => {
    const grant = (slot: Slot) => {
      clearTimeout(timer)
      resolve(slot)
    }
    const timer = setTimeout(() => {
      const i = waiting.indexOf(grant)
      if (i >= 0) waiting.splice(i, 1)
      reject(refuse(429, "busy"))
    }, limits.waitMs)
    waiting.push(grant)
  })
}

function release(slot: Slot): void {
  const next = waiting.shift()
  if (next) next(slot)
  else slot.busy = false
}

/** Runs `job` on a pool worker, handing it `transfer` (buffers this call owns). */
async function run(job: HeavyJob, transfer: ArrayBuffer[]): Promise<HeavyResult> {
  const slot = await acquire()
  try {
    if (!slot.worker) slot.worker = start(slot)
    const running = slot.worker
    try {
      await running.ready
    } catch (err) {
      if (slot.worker === running) slot.worker = null
      await running.worker.terminate().catch(() => undefined)
      throw err
    }
    started.set(job.kind, (started.get(job.kind) ?? 0) + 1)
    return await dispatch(slot, running, job, transfer)
  } finally {
    release(slot)
  }
}

function dispatch(slot: Slot, running: Running, job: HeavyJob, transfer: ArrayBuffer[]): Promise<HeavyResult> {
  const { worker } = running
  const id = ++nextId
  return new Promise((resolve, reject) => {
    let settled = false
    let killed = false
    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      worker.off("message", onMessage)
      worker.off("error", onError)
      worker.off("exit", onExit)
      worker.unref()
      fn()
    }
    // A killed job is answered only once its worker has stopped, so the slot is never reused while it still runs.
    const kill = (why: HeavyJobKilled["why"]) => {
      if (settled || killed) return
      // From here no answer counts, even one already on its way.
      killed = true
      if (slot.worker === running) slot.worker = null
      void worker.terminate().catch(() => undefined).finally(() => settle(() => reject(new HeavyJobKilled(why))))
    }
    const timer = setTimeout(() => kill("timeout"), limits.timeoutMsByKind[job.kind] ?? limits.timeoutMs)
    const onMessage = (m: { id?: number; result?: HeavyResult; refusal?: { status: number; code: string }; failed?: string }) => {
      if (m?.id !== id || killed) return
      if (m.result) settle(() => resolve(m.result!))
      else if (m.refusal) settle(() => reject(refuse(m.refusal!.status, m.refusal!.code)))
      else settle(() => reject(Object.assign(new Error("editor-project job failed"), { name: m.failed ?? "Error" })))
    }
    const onError = (err: { code?: unknown }) => kill(err?.code === "ERR_WORKER_OUT_OF_MEMORY" ? "memory" : "crashed")
    const onExit = () => kill("crashed")
    worker.on("message", onMessage)
    worker.once("error", onError)
    worker.once("exit", onExit)
    worker.ref()
    worker.postMessage({ id, job }, transfer)
  })
}

/** A copy of `bytes` that this call owns, to transfer (a Buffer may share pooled memory). */
function owned(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes)
}

const asBuffer = (bytes: Uint8Array) => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)

/**
 * A job past its time or memory limit (the work's own cost). A worker that
 * could not start or died otherwise is a server failure: it is answered as a
 * logged 500, never blamed on the request.
 */
const overLimits = (err: unknown): boolean => err instanceof HeavyJobKilled && err.why !== "crashed"

/** A save's own work past its limits is 422 `too_complex`. */
const asSaveRefusal = (err: unknown): unknown => (overLimits(err) ? refuse(422, "too_complex") : err)

/** PUT: the body (gzip) as canonical text and its gzip, checked against `hash`. */
export async function canonicalContent(body: Uint8Array, hash: string): Promise<{ text: Buffer; gz: Buffer }> {
  const copy = owned(body)
  try {
    const result = await run({ kind: "content", body: copy, hash }, [copy.buffer as ArrayBuffer])
    if (result.kind !== "content") throw new Error("unexpected job result")
    return { text: asBuffer(result.text), gz: asBuffer(result.gz) }
  } catch (err) {
    throw asSaveRefusal(err)
  }
}

/** PATCH: the client's patch (gzip) applied to the saved file (gzip), checked against `hash`. */
export async function patchedContent(patch: Uint8Array, base: Uint8Array, hash: string): Promise<{ text: Buffer; gz: Buffer }> {
  const p = owned(patch)
  const b = owned(base)
  try {
    const result = await run({ kind: "patch", patch: p, base: b, hash }, [p.buffer as ArrayBuffer, b.buffer as ArrayBuffer])
    if (result.kind !== "content") throw new Error("unexpected job result")
    return { text: asBuffer(result.text), gz: asBuffer(result.gz) }
  } catch (err) {
    throw asSaveRefusal(err)
  }
}

/** Whether a stored project file inflates to text with `hash`, and that text's size in bytes. */
export async function fileFacts(file: Uint8Array, hash: string): Promise<{ ok: boolean; textBytes: number }> {
  const copy = owned(file)
  try {
    const result = await run({ kind: "verify", file: copy, hash }, [copy.buffer as ArrayBuffer])
    return result.kind === "verified" ? { ok: result.ok, textBytes: result.textBytes } : { ok: false, textBytes: 0 }
  } catch (err) {
    throw asSaveRefusal(err)
  }
}

/**
 * A cut's patch version: the gzip of the patch from the full version `base`
 * to `current`, or null to store the version whole — including when the diff
 * is killed past its limits or no worker is free (never attempted again).
 */
export async function versionPatch(base: Uint8Array, baseHash: string, current: Uint8Array, currentHash: string): Promise<Buffer | null> {
  const b = owned(base)
  const c = owned(current)
  try {
    const result = await run({ kind: "diff", base: b, baseHash, current: c, currentHash }, [b.buffer as ArrayBuffer, c.buffer as ArrayBuffer])
    return result.kind === "diff" && result.patch ? asBuffer(result.patch) : null
  } catch {
    return null
  }
}

/** A version's whole content as gzip, rebuilt and verified (500 `version_unreadable` otherwise, past the limits included). */
export async function versionContent(
  file: Uint8Array,
  version: VersionToRebuild,
  base: { file: Uint8Array; content_hash: string } | null,
): Promise<Buffer> {
  const f = owned(file)
  const b = base ? owned(base.file) : null
  try {
    const result = await run(
      { kind: "version", file: f, version: { kind: version.kind, content_hash: version.content_hash }, base: b && base ? { file: b, content_hash: base.content_hash } : null },
      b ? [f.buffer as ArrayBuffer, b.buffer as ArrayBuffer] : [f.buffer as ArrayBuffer],
    )
    if (result.kind !== "version") throw new Error("unexpected job result")
    return asBuffer(result.gz)
  } catch (err) {
    throw overLimits(err) ? refuse(500, "version_unreadable") : err
  }
}
