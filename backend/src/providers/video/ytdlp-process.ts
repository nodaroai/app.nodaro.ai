/**
 * yt-dlp as a child process: spawned so a kill reaches everything it starts,
 * stopped on a wall-clock limit or the caller's abort, and failing with a
 * `YtDlpHaltError` when trying again elsewhere cannot help — so a client
 * ladder or a proxy chain stops at once instead of spawning again.
 */
import { spawn, type ChildProcess } from "node:child_process"

export type YtDlpHaltReason = "aborted" | "out_of_time" | "refused" | "too_much_output"

/**
 * A run that must not be tried again on another client or proxy: the caller
 * aborted, the time ran out, yt-dlp's length/live filter refused the video,
 * or it printed far more than any answer is.
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
    proc.on("error", (err) => finish(() => reject(err)))
    proc.on("close", (code) => finish(() => (code === 0 ? resolve(stdout) : reject(exitError(code, stderr)))))
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
    proc.on("error", (err) => finish(() => reject(err)))
    proc.on("close", (code) => finish(() => (code === 0 ? resolve() : reject(exitError(code, stderrBuf)))))
  })
}

/**
 * The limits left for the next step of a fetch held to one deadline: throws a
 * halt when the caller aborted or the time is up, so no step starts late.
 */
export function remainingLimits(
  deadlineAt: number,
  base: Omit<YtDlpRunLimits, "totalTimeoutMs">,
): YtDlpRunLimits & { totalTimeoutMs: number } {
  if (base.signal?.aborted) throw new YtDlpHaltError("yt-dlp aborted", "aborted")
  const left = deadlineAt - Date.now()
  if (left <= 0) throw new YtDlpHaltError("the fetch ran out of time", "out_of_time")
  return { ...base, totalTimeoutMs: left }
}
