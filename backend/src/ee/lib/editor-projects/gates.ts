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
 *               this from one tab.
 *   cuts        the cuts a user may ask for a minute, counted together for
 *               `POST /:id/versions` and a save's `x-cut-version`.
 */
export interface EditorProjectGates {
  /** The user's heavy turn: call the returned function when done. Throws 429 `busy` while another runs. */
  heavyTurn(userId: string): () => void
  /** Counts one cut for the user: true when it is within the limit, else the seconds until the count starts again. */
  takeCut(userId: string): { ok: true } | { ok: false; retryAfterSeconds: number }
}

export function createEditorProjectGates(cutLimit: { max: number; windowMs: number }): EditorProjectGates {
  const running = new Set<string>()
  const windows = new Map<string, { start: number; count: number }>()
  let sweptAt = Date.now()

  return {
    heavyTurn(userId) {
      if (running.has(userId)) throw refuse(429, "busy")
      running.add(userId)
      let released = false
      return () => {
        if (released) return
        released = true
        running.delete(userId)
      }
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
