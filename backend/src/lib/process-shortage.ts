/**
 * Notices when the kernel refuses this container one more process or thread,
 * and says so with who holds the threads.
 *
 * The refusals are counted by the kernel (`process-limits.ts`), so "the
 * container ran out of threads" is read, never inferred from what a program
 * printed when it failed: a refused thread shows up as "Error while opening
 * encoder", as a frame that never arrives, as `spawn EAGAIN`, or as a proxy
 * that is simply gone — and on 2026-11-25 as all four at once, with no line
 * anywhere naming the cause.
 *
 * One observer per process. Whoever looks (the 5-second watch started at
 * boot, a render deciding whether it is stuck, a launch that just failed)
 * shares it, so a refusal is logged once per process, and at most one line
 * every {@link SHORTAGE_LOG_EVERY_MS}: the first refusal at once, the count of
 * the ones since with the next line.
 */
import { basename } from "node:path"
import { describeThreadCensus, processLimitsLine, readProcessLimits, threadCensus } from "./process-limits.js"

/** At most one line per this long; refusals in between are counted into the next line. */
export const SHORTAGE_LOG_EVERY_MS = 30_000
/** How often the boot watch looks. */
export const SHORTAGE_WATCH_INTERVAL_MS = 5_000

export interface ShortageObserverDeps {
  readonly now: () => number
  /** The kernel's count of refusals so far; undefined when it cannot be read. */
  readonly refusals: () => number | undefined
  /** The limits and who holds the threads — read only when a line is written. */
  readonly describe: () => string
  readonly log: (message: string) => void
}

export interface ShortageObserver {
  /** Reads the kernel's count: how many refusals since the last look (0 when none, or when it cannot be read). */
  look(): number
  /** When a refusal was last seen by a look, or undefined when none was. */
  lastRefusalAt(): number | undefined
  /**
   * Whether the kernel is KNOWN to have refused this container a process or a
   * thread within the last `ms` (it looks first). The count says how many, not
   * when: a refusal is dated by the two looks it fell between, so it is known
   * to be this recent only when the earlier of the two is. With the 5-second
   * watch running that is exact to the watch's interval; without it, a caller
   * that looked when its own work began learns whether the refusal came since.
   */
  refusedWithin(ms: number): boolean
}

const realDeps: ShortageObserverDeps = {
  now: () => Date.now(),
  refusals: () => readProcessLimits().refusals,
  describe: () => `${processLimitsLine()}. Threads by program: ${describeThreadCensus(threadCensus())}`,
  log: (message) => console.warn(message),
}

const refused = (count: number): string => (count === 1 ? "1 new process or thread" : `${count} new processes or threads`)

export function createShortageObserver(label: string, deps: ShortageObserverDeps = realDeps): ShortageObserver {
  // The count at the first look is where this process starts from: refusals
  // from before it existed are not its news.
  let seenSoFar = deps.refusals()
  // When the count was last read. A look that could not read it does not move this.
  let countedAt: number | undefined = seenSoFar === undefined ? undefined : deps.now()
  let refusedAt: number | undefined
  // The read before the one that last found refusals: they happened after it.
  let refusedAfter: number | undefined
  let loggedAt: number | undefined
  let unlogged = 0
  const look = (): number => {
    const count = deps.refusals()
    if (count === undefined) return 0
    const now = deps.now()
    const countedBefore = countedAt
    countedAt = now
    const fresh = seenSoFar === undefined ? 0 : Math.max(0, count - seenSoFar)
    seenSoFar = count
    if (fresh === 0) return 0
    refusedAt = now
    refusedAfter = countedBefore
    unlogged += fresh
    if (loggedAt === undefined || now - loggedAt >= SHORTAGE_LOG_EVERY_MS) {
      deps.log(`[${label}] the container is at its process limit: ${refused(unlogged)} refused. ${deps.describe()}`)
      loggedAt = now
      unlogged = 0
    }
    return fresh
  }
  return {
    look,
    lastRefusalAt: () => refusedAt,
    refusedWithin(ms) {
      look()
      return refusedAfter !== undefined && deps.now() - refusedAfter <= ms
    },
  }
}

let observer: ShortageObserver | undefined

/** What this process runs (`worker`, `server`): the name its lines carry when nobody named it. */
const programName = (): string => basename(process.argv[1] ?? "").replace(/\.[cm]?[jt]s$/, "") || "process"

/** This process's observer (created on first use, named by whoever started the watch, else by the program). */
export function processShortageObserver(label: string = programName()): ShortageObserver {
  observer ??= createShortageObserver(label)
  return observer
}

/**
 * At boot: one line with the limits this container really has, then a look
 * every {@link SHORTAGE_WATCH_INTERVAL_MS} for as long as the process lives.
 * Returns the function that stops the looks.
 */
export function startProcessShortageWatch(label: string): () => void {
  console.log(`[${label}] process limit: ${processLimitsLine()}`)
  const watched = processShortageObserver(label)
  const timer = setInterval(() => {
    try {
      watched.look()
    } catch {
      // A look that cannot read is not a reason to stop looking.
    }
  }, SHORTAGE_WATCH_INTERVAL_MS)
  timer.unref()
  return () => clearInterval(timer)
}
