/**
 * An ffmpeg launch that failed because the box ran out of threads or
 * processes for a moment (decided 2026-11-18): many renders at once (a Clip
 * Pack's clips, every job of a busy worker) can exhaust the box's thread /
 * process limit, and ffmpeg then fails to create a thread — "Resource
 * temporarily unavailable" (EAGAIN) — or the process cannot even be spawned.
 * That is the box's passing shortage, not the input's fault: the launch is run
 * again after a short, jittered wait, its ffmpeg slot RELEASED while it waits
 * (each try is its own admission).
 *
 * WHAT SAYS SO. The launch's own words (that text, a spawn the system
 * refused), and the kernel's own count (decided 2026-11-27): a launch that
 * ended on its own while the container was being refused a process or a
 * thread failed for the shortage whatever it printed. On 2026-11-25 an encoder
 * that could not start its threads said only "Error while opening encoder —
 * maybe incorrect parameters", and those launches were failed as the input's
 * fault. The count is handed in (`kernel`), so this file imports nothing:
 * `box-shortage.ts` wires the real reader in for every runner.
 *
 * HOW LONG. {@link SHORTAGE_RETRY_ATTEMPTS} tries on the launch's own words.
 * With the kernel's count behind the try that just failed, for as long as
 * {@link SHORTAGE_RETRY_WINDOW_MS} after the first failure: a shortage lasts
 * until whatever holds the threads lets go — minutes on that day, when three
 * tries inside ten seconds all failed.
 *
 * Bounded so a retry can never outlive the launch's kill budget: every try
 * runs inside the first try's deadline, and a retry is made only while at
 * least half of that budget is left — so the liveness budgets that sum the
 * kill budgets (`lib/job-budget.ts`) still hold. A stop (`signal`) ends a wait
 * at once. A stalled or timed-out launch is never retried here.
 */

/** Tries per launch on its own words alone, the first included. */
export const SHORTAGE_RETRY_ATTEMPTS = 3
/** The first wait; each next one doubles it, up to {@link SHORTAGE_RETRY_MAX_WAIT_MS}. */
export const SHORTAGE_RETRY_BASE_MS = 2_000
/** No wait is longer than this, however many tries came before it. */
export const SHORTAGE_RETRY_MAX_WAIT_MS = 30_000
/** Up to this much random wait is added, so launches that failed together do not all come back together. */
export const SHORTAGE_RETRY_JITTER_MS = 2_000
/** With the kernel's count behind it, how long after its first failed try a launch is still tried again. */
export const SHORTAGE_RETRY_WINDOW_MS = 4 * 60_000
/** How recent a refusal the kernel counted must be to explain a launch that just failed. */
export const KERNEL_REFUSAL_RECENT_MS = 30_000

/** What a person is told when the box's shortage, not their input, failed the work. */
export const BOX_SHORTAGE_MESSAGE = "The server is busy right now and could not finish this — try again in a few minutes."

const SHORTAGE_TEXT = "Resource temporarily unavailable"

/**
 * Whether ffmpeg's own output says it ran out of threads: a line with the
 * system's EAGAIN text. A line naming a link (`://`) is left out — a link's
 * own path can carry any words, and a link is the input, not the box.
 */
export function stderrShowsShortage(stderr: string | undefined): boolean {
  if (!stderr || !stderr.includes(SHORTAGE_TEXT)) return false
  return stderr.split("\n").some((line) => line.includes(SHORTAGE_TEXT) && !line.includes("://"))
}

/** Whether a spawn itself failed for want of a process (EAGAIN): the process never started. */
export function spawnShowsShortage(error: { readonly code?: unknown; readonly syscall?: unknown } | null | undefined): boolean {
  return !!error && error.code === "EAGAIN" && (typeof error.syscall !== "string" || error.syscall.startsWith("spawn"))
}

/** The mark a launch's rejection carries when it failed for the box's passing shortage. */
export interface ShortageMarked {
  readonly resourceShortage?: true
}

export function isResourceShortage(err: unknown): boolean {
  return !!err && typeof err === "object" && (err as ShortageMarked).resourceShortage === true
}

/** Whether the box's shortage failed `err`, or an error it was caused by (a handler that wraps a launch's failure keeps the cause). */
export function causedByResourceShortage(err: unknown): boolean {
  let cur: unknown = err
  for (let depth = 0; cur !== null && cur !== undefined && depth < 8; depth++) {
    if (isResourceShortage(cur)) return true
    cur = (cur as { cause?: unknown }).cause
  }
  return false
}

/**
 * The kernel's word on this container (`lib/process-shortage.ts`'s observer,
 * handed in): a look reads its count of refusals, and `refusedWithin` says
 * whether one is known to have happened that recently.
 */
export interface KernelRefusals {
  look(): unknown
  refusedWithin(ms: number): boolean
}

/** What one try can say about its own failure. */
export interface LaunchEvidence {
  /**
   * The mark for a launch that ENDED ON ITS OWN — never for one that was
   * stopped (killed at its limit, stalled, aborted). `ownWords`: the launch
   * itself said so (its stderr, its spawn error). The kernel having just
   * refused this container a process or a thread is added here.
   */
  mark(ownWords: boolean): ShortageMarked
}

export interface ShortageRetryDeps {
  readonly now: () => number
  readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>
  readonly random: () => number
  readonly warn: (message: string) => void
}

const abortableSleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason instanceof Error ? signal.reason : new Error("ffmpeg cancelled"))
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal?.reason instanceof Error ? signal.reason : new Error("ffmpeg cancelled"))
    }
    signal?.addEventListener("abort", onAbort, { once: true })
  })

const realDeps: ShortageRetryDeps = {
  now: () => Date.now(),
  sleep: abortableSleep,
  random: () => Math.random(),
  warn: (message) => console.warn(message),
}

export interface ShortageRetryOptions {
  readonly limitMs: number
  readonly label: string
  readonly signal?: AbortSignal
  /** The kernel's count of refusals; left out, only a launch's own words count (and only the three tries). */
  readonly kernel?: KernelRefusals
}

/**
 * Run a launch (`attempt`, handed the kill budget it may use and what it can
 * say about its own failure) and run it again when it failed for the box's
 * passing shortage — waits jittered, every try inside the first one's deadline
 * (`limitMs` from now), a retry only while at least half of it is left.
 */
export async function retryOnShortage<T>(
  attempt: (limitMs: number, evidence: LaunchEvidence) => Promise<T>,
  opts: ShortageRetryOptions,
  deps: ShortageRetryDeps = realDeps,
): Promise<T> {
  const deadline = deps.now() + opts.limitMs
  const kernelSaysSo = (): boolean => opts.kernel?.refusedWithin(KERNEL_REFUSAL_RECENT_MS) === true
  const evidence: LaunchEvidence = { mark: (ownWords) => (ownWords || kernelSaysSo() ? { resourceShortage: true } : {}) }
  let limitMs = opts.limitMs
  let firstFailedAt: number | undefined
  for (let tries = 1; ; tries++) {
    // Read when the try begins: a refusal counted by the next read came since.
    opts.kernel?.look()
    try {
      return await attempt(limitMs, evidence)
    } catch (err) {
      if (!isResourceShortage(err) || opts.signal?.aborted) throw err
      const now = deps.now()
      firstFailedAt ??= now
      const counted = kernelSaysSo()
      if (tries >= SHORTAGE_RETRY_ATTEMPTS && !(counted && now - firstFailedAt < SHORTAGE_RETRY_WINDOW_MS)) throw err
      const wait = Math.min(SHORTAGE_RETRY_MAX_WAIT_MS, SHORTAGE_RETRY_BASE_MS * 2 ** (tries - 1)) + Math.floor(deps.random() * SHORTAGE_RETRY_JITTER_MS)
      const left = deadline - now - wait
      if (left < opts.limitMs / 2) throw err
      deps.warn(
        counted
          ? `[${opts.label}] the container is at its process limit (the kernel refused it a process or a thread); trying again in ${wait} ms (try ${tries + 1}, for up to ${SHORTAGE_RETRY_WINDOW_MS / 60_000} min after the first)`
          : `[${opts.label}] the box ran out of threads for a moment; trying again in ${wait} ms (try ${tries + 1} of ${SHORTAGE_RETRY_ATTEMPTS})`,
      )
      await deps.sleep(wait, opts.signal)
      limitMs = Math.max(1, deadline - deps.now())
    }
  }
}
