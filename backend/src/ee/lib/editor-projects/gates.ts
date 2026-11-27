import { refuse } from "./refusal.js"

/**
 * What one user may run at once on this instance, kept in this process (it
 * bounds each process, which is what must be protected; a user's requests on
 * two instances each count on their own instance). One set per registration
 * of the routes (`editorProjectRoutes`).
 *
 *   heavy turn  at most one save, cut, restore or version read runs at a time
 *               for a user; a second is refused 429 `busy` (`retry-after: 1`).
 *               The editor's save loop is single-flight, so it never meets
 *               this from one tab. The one request that waits instead is a
 *               save that gives the claim up after it (`x-release`, a closing
 *               page's last word, which nobody is left to send again): it is
 *               handed the turn the moment it is given back, in arrival order,
 *               and refused `busy` past its wait, past `MAX_TURN_WAITERS`, or
 *               past `MAX_WAITING_BYTES` held by every user's waiting bodies.
 *   cuts        the cuts a user may ask for a minute, counted together for
 *               `POST /:id/versions` and a save's `x-cut-version`.
 */
export interface EditorProjectGates {
  /** The user's heavy turn: call the returned function when done. Throws 429 `busy` while another runs. */
  heavyTurn(userId: string): () => void
  /**
   * The user's heavy turn, waited for up to `waitMs` while another request holds it (handed over when that one is
   * done, never free in between): the function to call when done. Rejects 429 `busy` past the wait, or at once when
   * `MAX_TURN_WAITERS` of the user's requests already wait, or when `bytes` (the request's body, held while it waits)
   * would take what every user's waiting requests hold past `MAX_WAITING_BYTES`.
   */
  awaitHeavyTurn(userId: string, waitMs: number, bytes?: number): Promise<() => void>
  /** Counts one cut for the user: true when it is within the limit, else the seconds until the count starts again. */
  takeCut(userId: string): { ok: true } | { ok: false; retryAfterSeconds: number }
}

/**
 * The requests of one user that may wait for the heavy turn at once on one
 * instance. Each holds its parsed body (up to 5 MB) while it waits, so the line
 * is short: a page closing sends at most two (its last edit against each base
 * the account may hold), two tabs closing together four.
 */
export const MAX_TURN_WAITERS = 4

/** What the bodies of every user's waiting requests may hold at once on one instance. */
export const MAX_WAITING_BYTES = 64 * 1024 * 1024

export function createEditorProjectGates(cutLimit: { max: number; windowMs: number }, limits: { maxWaitingBytes?: number } = {}): EditorProjectGates {
  const maxWaitingBytes = limits.maxWaitingBytes ?? MAX_WAITING_BYTES
  const running = new Set<string>()
  /** The bytes every waiting request holds. */
  let waitingBytes = 0
  /** Who waits for each user's turn, first come first. */
  const waiting = new Map<string, Array<() => void>>()
  const windows = new Map<string, { start: number; count: number }>()
  let sweptAt = Date.now()

  const leaveLine = (userId: string, entry: () => void) => {
    const rest = (waiting.get(userId) ?? []).filter((e) => e !== entry)
    if (rest.length > 0) waiting.set(userId, rest)
    else waiting.delete(userId)
  }

  /** The turn, held: given back once (a second call does nothing), straight to the first one waiting when there is one. */
  const turn = (userId: string) => {
    let done = false
    return () => {
      if (done) return
      done = true
      const next = waiting.get(userId)?.[0]
      if (!next) return void running.delete(userId)
      leaveLine(userId, next)
      next()
    }
  }

  return {
    heavyTurn(userId) {
      if (running.has(userId)) throw refuse(429, "busy")
      running.add(userId)
      return turn(userId)
    },
    awaitHeavyTurn(userId, waitMs, bytes = 0) {
      if (!running.has(userId)) {
        running.add(userId)
        return Promise.resolve(turn(userId))
      }
      if ((waiting.get(userId)?.length ?? 0) >= MAX_TURN_WAITERS || waitingBytes + bytes > maxWaitingBytes) return Promise.reject(refuse(429, "busy"))
      waitingBytes += bytes
      return new Promise((resolve, reject) => {
        const entry = () => {
          clearTimeout(timer)
          waitingBytes -= bytes
          resolve(turn(userId))
        }
        const timer = setTimeout(() => {
          waitingBytes -= bytes
          leaveLine(userId, entry)
          reject(refuse(429, "busy"))
        }, waitMs)
        waiting.set(userId, [...(waiting.get(userId) ?? []), entry])
      })
    },
    takeCut(userId) {
      const now = Date.now()
      // Windows that ended are dropped, so the map holds only this minute's users.
      if (now - sweptAt >= cutLimit.windowMs) {
        for (const [key, w] of windows) if (now - w.start >= cutLimit.windowMs) windows.delete(key)
        sweptAt = now
      }
      let w = windows.get(userId)
      if (!w || now - w.start >= cutLimit.windowMs) {
        w = { start: now, count: 0 }
        windows.set(userId, w)
      }
      if (w.count >= cutLimit.max) return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((w.start + cutLimit.windowMs - now) / 1000)) }
      w.count++
      return { ok: true }
    },
  }
}
