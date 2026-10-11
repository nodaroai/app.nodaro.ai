/**
 * The no-progress watchdog for chunked renders (C4 bug fixes, decided
 * 2026-10-10).
 *
 * WHY. ffmpeg's scheduler can keep electing an input the filter graph already
 * closed: the launch then sleeps on every thread (each one in a futex wait),
 * its stats line frozen, until its kill budget ends it — minutes to hours for
 * one render chunk. Measured on the production-pinned ffmpeg: 19 of 281
 * six-input launches stalled this way. The pinned build carries the fix; this
 * is the safety net for any stall the patch does not cover.
 *
 * WHAT COUNTS AS PROGRESS. A launch is ALIVE while either moves:
 *   - its OUTPUT: the stats line's frame count, output time or size
 *     (`statsProgressKey`) — never elapsed, fps or speed, which keep ticking
 *     through a stall;
 *   - its CPU time (`/proc/<pid>/stat`), by at least `FFMPEG_STALL_CPU_SEC`
 *     within the window. A sparse chunk decodes hours of source between two
 *     output frames (`apply-edl-budget.ts`); its stats freeze while it works,
 *     and it must never be killed for that.
 * Frozen stats AND an idle process for `FFMPEG_STALL_MS` is the stall, and
 * only that is killed — with SIGKILL, because a deadlocked main loop never
 * services a SIGTERM. Where CPU time cannot be read (no `/proc`: a dev Mac) a
 * stall cannot be told from a slow decode, so the watchdog stands down and the
 * launch keeps only its kill budget.
 *
 * WHAT HAPPENS NEXT. `retryStalledLaunch` relaunches a stalled chunk at most
 * `SLICE_STALL_ATTEMPTS` times in all, each attempt given only the budget the
 * stalled ones left (the render's liveness budget is the sum of the chunks'
 * kill budgets, so a chunk's attempts together never outlast its own), then
 * fails with a message that says what happened. Anything that is not a stall —
 * a real ffmpeg error, a timeout, a cancel — is never retried here.
 */
import { readFileSync } from "node:fs"

/** How long a launch may show no progress before it is stopped. */
export const FFMPEG_STALL_MS = 30_000
/** CPU-seconds a launch must burn within the window to count as working. The
 *  stalled launch burns ~none (its one awake thread prints stats twice a
 *  second); a launch decoding on a shared 2-vCPU box burns ~15 in 30 s. */
export const FFMPEG_STALL_CPU_SEC = 0.5
/** How often the watchdog looks. */
export const FFMPEG_STALL_TICK_MS = 1_000
/** Launches of one chunk in all — the first plus two relaunches — before the
 *  render fails. A stall is rare and independent per launch (about 7% of
 *  six-input launches before the fix), so a third stall in a row is not luck. */
export const SLICE_STALL_ATTEMPTS = 3

/** Clock ticks per second in `/proc/<pid>/stat` (USER_HZ: 100 on Linux). */
const USER_HZ = 100

/** The watchdog's knobs: the production values unless a test shortens them. */
export interface FfmpegStallWatch {
  readonly stallMs?: number
  readonly cpuSec?: number
  readonly tickMs?: number
  /** A process's CPU-seconds so far, undefined when unreadable. */
  readonly readCpuSec?: (pid: number) => number | undefined
}

/** What the watchdog needs of a child: its pid and its stderr. */
export interface WatchedChild {
  readonly pid?: number
  readonly stderr: NodeJS.EventEmitter | null
}

/** The stats line's shape: `frame=` (picture outputs only), then `size=` and
 *  `time=`. Anchored at the start of a line so a metadata line never reads as one. */
const STATS_LINE = /^\s*(?:frame=\s*(\d+)\b.*?)?\bL?size=\s*(\S+)\s+time=\s*(\S+)/

/**
 * The output-progress key of the LAST complete stats line in `text` (ffmpeg
 * ends each with `\r`, the last with `\n`): frame, size and output time.
 * Undefined when there is none. A half-written line at the end is skipped — a
 * chunk boundary inside a line would otherwise read as a change.
 */
export function statsProgressKey(text: string): string | undefined {
  const lines = text.split(/[\r\n]/)
  lines.pop() // the unterminated remainder
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = STATS_LINE.exec(lines[i]!)
    if (m) return `${m[1] ?? ""}|${m[2]}|${m[3]}`
  }
  return undefined
}

/** A process's CPU-seconds (utime + stime) from the text of its `/proc/<pid>/stat`.
 *  Its fields are read after the comm's LAST `)` — a comm may hold spaces and
 *  parentheses. Undefined for text that is not one. */
export function parseProcStatCpuSec(stat: string): number | undefined {
  const close = stat.lastIndexOf(")")
  if (close < 0) return undefined
  // After ")": field 3 (state) is index 0, so utime (14) and stime (15) are 11 and 12.
  const fields = stat.slice(close + 1).trim().split(/\s+/)
  const utime = Number(fields[11])
  const stime = Number(fields[12])
  if (fields.length < 13 || !Number.isFinite(utime) || !Number.isFinite(stime)) return undefined
  return (utime + stime) / USER_HZ
}

/** `pid`'s CPU-seconds so far, from `/proc`; undefined where there is no `/proc`
 *  or the process is gone. */
export function readProcessCpuSec(pid: number): number | undefined {
  try {
    return parseProcStatCpuSec(readFileSync(`/proc/${pid}/stat`, "utf8"))
  } catch {
    return undefined
  }
}

let warnedInert = false

/**
 * Watch `child` and call `onStall` once if it shows no progress — frozen stats
 * and an idle CPU — for the stall window. Returns the stop function (call it
 * when the child closes). Inert where CPU time cannot be read.
 */
export function watchForStall(child: WatchedChild, watch: FfmpegStallWatch, onStall: () => void): () => void {
  const stallMs = watch.stallMs ?? FFMPEG_STALL_MS
  const cpuSec = watch.cpuSec ?? FFMPEG_STALL_CPU_SEC
  const readCpu = watch.readCpuSec ?? readProcessCpuSec
  const pid = child.pid
  const startCpu = pid === undefined ? undefined : readCpu(pid)
  if (pid === undefined || startCpu === undefined || !child.stderr) {
    if (!warnedInert) {
      warnedInert = true
      console.warn("[ffmpeg] the stall watchdog is off here: this host does not expose a process's CPU time (/proc)")
    }
    return () => {}
  }

  let markAt = Date.now()
  let cpuMark = startCpu
  let lastKey: string | undefined
  let tail = ""
  const progressed = () => {
    markAt = Date.now()
    cpuMark = readCpu(pid) ?? cpuMark
  }
  const onData = (chunk: Buffer | string) => {
    tail = (tail + chunk.toString()).slice(-4096)
    const key = statsProgressKey(tail)
    if (key !== undefined && key !== lastKey) {
      lastKey = key
      progressed()
    }
  }
  child.stderr.on("data", onData)

  let stopped = false
  const stop = () => {
    if (stopped) return
    stopped = true
    clearInterval(timer)
    child.stderr?.removeListener("data", onData)
  }
  const timer = setInterval(() => {
    const cpu = readCpu(pid)
    if (cpu !== undefined && cpu - cpuMark >= cpuSec) {
      markAt = Date.now()
      cpuMark = cpu
      return
    }
    if (Date.now() - markAt >= stallMs) {
      stop()
      onStall()
    }
  }, watch.tickMs ?? FFMPEG_STALL_TICK_MS)
  timer.unref?.()
  return stop
}

/** A launch the watchdog stopped. `ranMs`: how long it ran before it was killed. */
export type FfmpegStallError = Error & { readonly stalled: true; readonly ranMs: number; readonly killed: true; readonly timedOut: false }

/** The error a stalled launch rejects with. */
export function ffmpegStallError(ranMs: number, stallMs: number = FFMPEG_STALL_MS): FfmpegStallError {
  return Object.assign(
    new Error(`ffmpeg failed: no progress for ${Math.round(stallMs / 1000)} s — the launch was stopped`),
    { stalled: true as const, ranMs, killed: true as const, timedOut: false as const },
  )
}

/** Is `err` a launch the watchdog stopped (and so one to relaunch)? */
export function isFfmpegStall(err: unknown): err is FfmpegStallError {
  return err instanceof Error && (err as { stalled?: unknown }).stalled === true && typeof (err as { ranMs?: unknown }).ranMs === "number"
}

/**
 * Run `launch` with the chunk's kill budget; relaunch it when the watchdog
 * stopped it, with what the stalled attempts left of that budget, at most
 * `attempts` launches in all. `beforeRetry` runs before each relaunch (the
 * job's cancellation check). Any failure that is not a stall is rethrown as is.
 */
export async function retryStalledLaunch<T>(
  launch: (timeoutMs: number) => Promise<T>,
  opts: {
    readonly timeoutMs: number
    readonly attempts?: number
    readonly beforeRetry?: () => Promise<void>
    readonly label?: string
    readonly stallMs?: number
  },
): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? SLICE_STALL_ATTEMPTS)
  const label = opts.label ?? "a render chunk"
  let remainingMs = opts.timeoutMs
  for (let n = 1; ; n++) {
    try {
      return await launch(remainingMs)
    } catch (err) {
      if (!isFfmpegStall(err)) throw err
      remainingMs -= err.ranMs
      if (n >= attempts || remainingMs <= 0) {
        const why = n >= attempts ? `${n} attempts` : `${n} attempt${n === 1 ? "" : "s"}, which used its whole time budget`
        throw new Error(
          `ffmpeg failed: ${label} made no progress for ${Math.round((opts.stallMs ?? FFMPEG_STALL_MS) / 1000)} s and was stopped, on ${why} — an ffmpeg stall, not a slow render`,
        )
      }
      console.warn(`[ffmpeg] ${label} stalled (no progress, idle) after ${Math.round(err.ranMs / 1000)} s — relaunching (attempt ${n + 1} of ${attempts})`)
      await opts.beforeRetry?.()
    }
  }
}
