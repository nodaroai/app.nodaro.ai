/**
 * yt-dlp as a child process: spawned so a kill reaches everything it starts,
 * stopped on a wall-clock limit or the caller's abort, and failing with a
 * `YtDlpHaltError` when trying again elsewhere cannot help — so a client
 * ladder or a proxy chain stops at once instead of spawning again.
 */
import { spawn, type ChildProcess } from "node:child_process"
import { BOX_SHORTAGE_MESSAGE, isResourceShortage, spawnShowsShortage } from "./ffmpeg-shortage-retry.js"
import { retryOnBoxShortage } from "./box-shortage.js"

export type YtDlpHaltReason = "aborted" | "out_of_time" | "refused" | "too_much_output" | "server_busy"

/**
 * A run that must not be tried again on another client or proxy: the caller
 * aborted, the time ran out, yt-dlp's length/live filter refused the video,
 * it printed far more than any answer is, or the server could not start it
 * at all (no process was free, and waiting did not help).
 */
export class YtDlpHaltError extends Error {
  constructor(
    message: string,
    readonly reason: YtDlpHaltReason,
  ) {
    super(message)
    this.name = "YtDlpHaltError"
  }
}

/** yt-dlp's exit code when `--break-match-filters` (or `--max-downloads`) stops it. */
export const YTDLP_EXIT_STOPPED_BY_FILTER = 101

const GROUP_KILL = process.platform !== "win32"
const KILL_GRACE_MS = 2_000

/**
 * Spawn yt-dlp so a kill reaches what it starts. On Linux it leads its own
 * process group: the release binary is a PyInstaller bootloader whose real
 * Python process — and the ffmpeg it merges with — are its children, which a
 * signal to the bootloader alone leaves running.
 */
export function spawnYtDlpProcess(bin: string, args: readonly string[], env?: NodeJS.ProcessEnv): ChildProcess {
  return spawn(bin, [...args], { stdio: ["ignore", "pipe", "pipe"], ...(env ? { env } : {}), ...(GROUP_KILL ? { detached: true } : {}) })
}

/** Stop a yt-dlp process and what it started: SIGTERM to its group, SIGKILL a moment later. */
export function killYtDlpProcess(proc: ChildProcess): void {
  const pid = proc.pid
  if (GROUP_KILL && typeof pid === "number" && pid > 0) {
    if (!signalGroup(pid, "SIGTERM")) {
      proc.kill("SIGKILL")
      return
    }
    setTimeout(() => signalGroup(pid, "SIGKILL"), KILL_GRACE_MS).unref()
    return
  }
  proc.kill("SIGKILL")
}

/** Signal the group; false when it could not be signalled for any reason but being gone already. */
function signalGroup(pid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(-pid, signal)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "ESRCH"
  }
}

/** A run with no wall-clock limit of its own may spend this long being started again; the run itself is not held to it. */
const START_AGAIN_BUDGET_MS = 8 * 60_000

/** A spawn's own error, marked when the system refused the start for want of a process: the run never began. */
const startFailure = (err: Error): Error =>
  spawnShowsShortage(err as NodeJS.ErrnoException) ? Object.assign(err, { resourceShortage: true as const }) : err

/**
 * A yt-dlp the system refused to START — no process was free, the box's
 * passing shortage (2026-11-25: `spawn yt-dlp EAGAIN` on every proxy attempt
 * of a download, inside one second) — is started again after a wait, like an
 * ffmpeg launch (`box-shortage.ts`). Nothing ran, so nothing is done twice.
 * `budgetMs` bounds the waiting as a launch's kill budget does; `once` is
 * handed what is left of it and what has passed, for the run's own limits.
 *
 * A wait that gives up HALTS the run: the next client or proxy would be
 * refused the same way, and the person reads that the server is busy, not the
 * system's words for it.
 */
async function startAgainWhenRefused<T>(
  limits: YtDlpRunLimits,
  budgetMs: number,
  once: (leftMs: number, passedMs: number) => Promise<T>,
): Promise<T> {
  const startedAt = Date.now()
  try {
    return await retryOnBoxShortage((leftMs) => once(leftMs, Date.now() - startedAt), {
      limitMs: budgetMs,
      label: "yt-dlp",
      ...(limits.signal ? { signal: limits.signal } : {}),
    })
  } catch (err) {
    if (err instanceof YtDlpHaltError) throw err
    // The abort that ended a wait is the halt yt-dlp itself raises.
    if (limits.signal?.aborted) throw new YtDlpHaltError("yt-dlp aborted", "aborted")
    if (!isResourceShortage(err)) throw err
    console.error(`[yt-dlp] could not be started, no process was free: ${err instanceof Error ? err.message : String(err)}`)
    throw Object.assign(new YtDlpHaltError(BOX_SHORTAGE_MESSAGE, "server_busy"), { resourceShortage: true as const, cause: err })
  }
}

/** What is left of a wall-clock limit after `passedMs`; none stays none. */
const leftOf = (totalMs: number | undefined, passedMs: number): number | undefined =>
  totalMs === undefined ? undefined : Math.max(1, totalMs - passedMs)

/** The limits a run is held to by its caller. */
export interface YtDlpRunLimits {
  /** Replaces the child's environment (the hardened lane passes a minimal one). */
  env?: NodeJS.ProcessEnv
  /** A wall-clock limit; past it the run halts (`out_of_time`). */
  totalTimeoutMs?: number
  signal?: AbortSignal
}

/**
 * What a refusal by the length/live filter says. yt-dlp prints the filter's
 * own line to stdout, not stderr, so the message is fixed rather than read.
 */
export const YTDLP_REFUSED_MESSAGE = "the video is live, or longer than the length allowed for it"

/** The error a non-zero exit reports: the filter's halt, or stderr's last line. */
function exitError(code: number | null, stderr: string): Error {
  if (code === YTDLP_EXIT_STOPPED_BY_FILTER) return new YtDlpHaltError(YTDLP_REFUSED_MESSAGE, "refused")
  return new Error(stderr.trim().split("\n").pop() || `yt-dlp exited with code ${code}`)
}

/** More than any answer a capture asks for (`--dump-json` of a YouTube watch page runs to a few hundred KB). */
export const CAPTURE_MAX_BYTES = 8 * 1024 * 1024

/**
 * Run yt-dlp and resolve its stdout. `timeoutMs` bounds this one run (a
 * timeout is an ordinary failure: the next client may answer); the limits'
 * `totalTimeoutMs` and `signal` halt it. Output past `maxBytes` halts it too.
 */
export function runYtDlpCaptureWith(
  bin: string,
  args: readonly string[],
  opts: YtDlpRunLimits & { timeoutMs: number; maxBytes?: number },
): Promise<string> {
  // A capture never outlasts its own `timeoutMs`, the waits to be started included.
  return startAgainWhenRefused(opts, opts.timeoutMs, (leftMs, passedMs) =>
    captureOnce(bin, args, { ...opts, timeoutMs: Math.min(opts.timeoutMs, leftMs), totalTimeoutMs: leftOf(opts.totalTimeoutMs, passedMs) }),
  )
}

function captureOnce(
  bin: string,
  args: readonly string[],
  opts: YtDlpRunLimits & { timeoutMs: number; maxBytes?: number },
): Promise<string> {
  if (opts.signal?.aborted) return Promise.reject(new YtDlpHaltError("yt-dlp aborted", "aborted"))
  return new Promise((resolve, reject) => {
    const proc = spawnYtDlpProcess(bin, args, opts.env)
    const maxBytes = opts.maxBytes ?? CAPTURE_MAX_BYTES
    let stdout = ""
    let stderr = ""
    let settled = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearTimeout(deadline)
      opts.signal?.removeEventListener("abort", onAbort)
      fn()
    }
    const stop = (err: Error) => {
      if (settled) return
      killYtDlpProcess(proc)
      finish(() => reject(err))
    }
    const onAbort = () => stop(new YtDlpHaltError("yt-dlp aborted", "aborted"))
    const timer = setTimeout(() => stop(new Error(`yt-dlp timed out after ${opts.timeoutMs}ms`)), opts.timeoutMs)
    const deadline = opts.totalTimeoutMs
      ? setTimeout(() => stop(new YtDlpHaltError(`yt-dlp took longer than ${opts.totalTimeoutMs}ms`, "out_of_time")), opts.totalTimeoutMs)
      : undefined
    opts.signal?.addEventListener("abort", onAbort, { once: true })
    proc.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString()
      if (stdout.length > maxBytes) stop(new YtDlpHaltError(`yt-dlp printed more than ${maxBytes} bytes`, "too_much_output"))
    })
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-64 * 1024)
    })
    proc.on("error", (err) => finish(() => reject(startFailure(err))))
    proc.on("close", (code) => finish(() => (code === 0 ? resolve(stdout) : reject(exitError(code, stderr)))))
  })
}

/** What a failed run throws: the shape `youtube-dl-exec` gave its callers — the message IS stderr, and stderr, stdout and the exit code ride along. */
export interface YtDlpExitError extends Error {
  stderr: string
  stdout: string
  exitCode: number | null
}

/**
 * Run yt-dlp to its end, for a caller that wants no output (an audio extraction
 * writes a file). The run is its own process group (`spawnYtDlpProcess`), so the
 * caller's abort or `totalTimeoutMs` stops yt-dlp AND the ffmpeg it started
 * (`killYtDlpProcess`) — Node's own `signal` option reaches the one process only,
 * and a child ffmpeg could outlive the hold that reserves its memory. Both are a
 * halt. No idle watchdog: the hold is the bound.
 *
 * A non-zero exit rejects as `youtube-dl-exec` did (round 4 of #1860, decided
 * 2026-10-05, replacing it in the audio lanes): an Error whose message is stderr,
 * with `stderr`, `stdout` and `exitCode` attached — the audio route reports that
 * message and `trimAudio` reads `.stderr`.
 */
export function runYtDlpToEndWith(bin: string, args: readonly string[], opts: YtDlpRunLimits = {}): Promise<void> {
  return startAgainWhenRefused(opts, opts.totalTimeoutMs ?? START_AGAIN_BUDGET_MS, (_leftMs, passedMs) =>
    toEndOnce(bin, args, { ...opts, totalTimeoutMs: leftOf(opts.totalTimeoutMs, passedMs) }),
  )
}

function toEndOnce(bin: string, args: readonly string[], opts: YtDlpRunLimits): Promise<void> {
  if (opts.signal?.aborted) return Promise.reject(new YtDlpHaltError("yt-dlp aborted", "aborted"))
  return new Promise<void>((resolve, reject) => {
    const proc = spawnYtDlpProcess(bin, args, opts.env)
    let stdout = ""
    let stderr = ""
    let settled = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      opts.signal?.removeEventListener("abort", onAbort)
      fn()
    }
    const stop = (err: Error) => {
      if (settled) return
      killYtDlpProcess(proc)
      finish(() => reject(err))
    }
    const onAbort = () => stop(new YtDlpHaltError("yt-dlp aborted", "aborted"))
    const deadline = opts.totalTimeoutMs
      ? setTimeout(() => stop(new YtDlpHaltError(`yt-dlp took longer than ${opts.totalTimeoutMs}ms`, "out_of_time")), opts.totalTimeoutMs)
      : undefined
    opts.signal?.addEventListener("abort", onAbort, { once: true })
    // Only a tail of each stream is kept: progress lines run to megabytes over a long download.
    proc.stdout?.on("data", (chunk: Buffer) => {
      stdout = (stdout + chunk.toString()).slice(-64 * 1024)
    })
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-64 * 1024)
    })
    proc.on("error", (err) => finish(() => reject(startFailure(err))))
    proc.on("close", (code) =>
      finish(() => {
        if (code === 0) return resolve()
        const message = stderr.trim() || `yt-dlp exited with code ${code}`
        reject(Object.assign(new Error(message), { stderr, stdout, exitCode: code }) satisfies YtDlpExitError)
      }),
    )
  })
}

/**
 * One yt-dlp download: progress lines (`download:NN%`) to `onProgress`, an
 * idle watchdog (`idleTimeoutMs`: no output for that long is a stall — an
 * ordinary failure), and the caller's limits (a halt).
 */
export function spawnYtDlpDownloadWith(
  bin: string,
  args: readonly string[],
  onProgress: ((pct: number) => void) | undefined,
  opts: YtDlpRunLimits & { idleTimeoutMs: number },
): Promise<void> {
  return startAgainWhenRefused(opts, opts.totalTimeoutMs ?? START_AGAIN_BUDGET_MS, (_leftMs, passedMs) =>
    downloadOnce(bin, args, onProgress, { ...opts, totalTimeoutMs: leftOf(opts.totalTimeoutMs, passedMs) }),
  )
}

function downloadOnce(
  bin: string,
  args: readonly string[],
  onProgress: ((pct: number) => void) | undefined,
  opts: YtDlpRunLimits & { idleTimeoutMs: number },
): Promise<void> {
  if (opts.signal?.aborted) return Promise.reject(new YtDlpHaltError("yt-dlp aborted", "aborted"))
  return new Promise<void>((resolve, reject) => {
    const proc = spawnYtDlpProcess(bin, args, opts.env)
    let stderrBuf = ""
    let settled = false
    let watchdog: ReturnType<typeof setTimeout> | undefined
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(watchdog)
      clearTimeout(deadline)
      opts.signal?.removeEventListener("abort", onAbort)
      fn()
    }
    const stop = (err: Error) => {
      if (settled) return
      killYtDlpProcess(proc)
      finish(() => reject(err))
    }
    const onAbort = () => stop(new YtDlpHaltError("yt-dlp aborted", "aborted"))
    const deadline = opts.totalTimeoutMs
      ? setTimeout(() => stop(new YtDlpHaltError(`yt-dlp took longer than ${opts.totalTimeoutMs}ms`, "out_of_time")), opts.totalTimeoutMs)
      : undefined
    opts.signal?.addEventListener("abort", onAbort, { once: true })
    // Reset the idle timer on every byte of output; fire only after silence.
    const kick = () => {
      if (settled) return
      clearTimeout(watchdog)
      watchdog = setTimeout(() => stop(new Error(`yt-dlp stalled (no output for ${opts.idleTimeoutMs / 1000}s)`)), opts.idleTimeoutMs)
    }
    kick()

    proc.stdout?.on("data", (chunk: Buffer) => {
      kick()
      for (const line of chunk.toString().split("\n")) {
        const match = line.trim().match(/^download:\s*([\d.]+)%/)
        if (match) {
          const pct = parseFloat(match[1])
          if (!Number.isNaN(pct)) onProgress?.(pct)
        }
      }
    })
    proc.stderr?.on("data", (chunk: Buffer) => {
      kick()
      stderrBuf = (stderrBuf + chunk.toString()).slice(-64 * 1024)
    })
    proc.on("error", (err) => finish(() => reject(startFailure(err))))
    proc.on("close", (code) => finish(() => (code === 0 ? resolve() : reject(exitError(code, stderrBuf)))))
  })
}

/**
 * The one deadline a fetch is held to — the clock `remainingLimits` reads.
 *
 * It runs on wall time, EXCEPT while a step waits for the ffmpeg admission: a
 * launch that queues for a slot or for memory tells the deadline what it
 * waited (`excuse`, from `withFfmpegSlot`'s `deadline` option), and the
 * deadline moves out by that much. A busy box therefore never fails an import
 * as `out_of_time`, while every step after admission — the download, the
 * re-encode — is still held to what the fetch has left (decided 2026-10-05:
 * the same philosophy as the slot-wait ledger that pauses the heartbeat).
 * One rule, in one place, for every deadline-bounded caller of the admission.
 */
export class FetchDeadline {
  private endsAt: number

  constructor(
    totalMs: number,
    private readonly now: () => number = Date.now,
  ) {
    this.endsAt = now() + totalMs
  }

  /** Milliseconds left; zero or negative once the deadline has passed. */
  remainingMs(): number {
    return this.endsAt - this.now()
  }

  /** Time spent waiting for admission is not the fetch's: push the deadline out by it. */
  excuse(waitedMs: number): void {
    if (Number.isFinite(waitedMs) && waitedMs > 0) this.endsAt += waitedMs
  }
}

/**
 * The limits left for the next step of a fetch held to one deadline: throws a
 * halt when the caller aborted or the time is up, so no step starts late.
 */
export function remainingLimits(
  deadline: FetchDeadline,
  base: Omit<YtDlpRunLimits, "totalTimeoutMs">,
): YtDlpRunLimits & { totalTimeoutMs: number } {
  if (base.signal?.aborted) throw new YtDlpHaltError("yt-dlp aborted", "aborted")
  const left = deadline.remainingMs()
  if (left <= 0) throw new YtDlpHaltError("the fetch ran out of time", "out_of_time")
  return { ...base, totalTimeoutMs: left }
}
