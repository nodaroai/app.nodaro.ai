/**
 * An ffmpeg launch that failed because the box ran out of threads or
 * processes for a moment (decided 2026-11-18): many renders at once (a Clip
 * Pack's clips, every job of a busy worker) can exhaust the box's thread /
 * process limit, and ffmpeg then fails to create a thread — "Resource
 * temporarily unavailable" (EAGAIN) — or the process cannot even be spawned.
 * That is the box's passing shortage, not the input's fault: the launch is run
 * again after a short, jittered wait, its ffmpeg slot RELEASED while it waits
 * (each try is its own admission), up to {@link SHORTAGE_RETRY_ATTEMPTS} tries.
 *
 * Bounded so a retry can never outlive the launch's kill budget: every try
 * runs inside the first try's deadline, and a retry is made only while at
 * least half of that budget is left — so the liveness budgets that sum the
 * kill budgets (`lib/job-budget.ts`) still hold. A stop (`signal`) ends a wait
 * at once. A stalled or timed-out launch is never retried here.
 */

/** Tries per launch, the first included. */
export const SHORTAGE_RETRY_ATTEMPTS = 3
/** The first wait; each next one doubles it. */
export const SHORTAGE_RETRY_BASE_MS = 2_000
/** Up to this much random wait is added, so launches that failed together do not all come back together. */
export const SHORTAGE_RETRY_JITTER_MS = 2_000

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
  random: Math.random,
  warn: (message) => console.warn(message),
}

/**
 * Run a launch (`attempt`, handed the kill budget it may use) and run it again
 * when it failed for the box's passing shortage — waits jittered, every try
 * inside the first one's deadline (`limitMs` from now), a retry only while at
 * least half of it is left.
 */
export async function retryOnShortage<T>(
  attempt: (limitMs: number) => Promise<T>,
  opts: { readonly limitMs: number; readonly label: string; readonly signal?: AbortSignal },
  deps: ShortageRetryDeps = realDeps,
): Promise<T> {
  const deadline = deps.now() + opts.limitMs
  let limitMs = opts.limitMs
  for (let tries = 1; ; tries++) {
    try {
      return await attempt(limitMs)
    } catch (err) {
      if (!isResourceShortage(err) || tries >= SHORTAGE_RETRY_ATTEMPTS || opts.signal?.aborted) throw err
      const wait = SHORTAGE_RETRY_BASE_MS * 2 ** (tries - 1) + Math.floor(deps.random() * SHORTAGE_RETRY_JITTER_MS)
      const left = deadline - deps.now() - wait
      if (left < opts.limitMs / 2) throw err
      deps.warn(`[${opts.label}] the box ran out of threads for a moment; trying again in ${wait} ms (try ${tries + 1} of ${SHORTAGE_RETRY_ATTEMPTS})`)
      await deps.sleep(wait, opts.signal)
      limitMs = Math.max(1, deadline - deps.now())
    }
  }
}
