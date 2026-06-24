import { useEffect, useState } from "react"
import { setAuthFromTokens } from "@/hooks/use-auth"
import { isAllowedEmbedParent } from "@/lib/embed-origins"

/** How long to wait for the parent to hand us a session before giving up
 *  and letting the normal auth flow (login redirect) take over. */
const HANDOFF_TIMEOUT_MS = 4000

/** True when this document is rendered inside a (cross-origin) iframe. */
export function isEmbedded(): boolean {
  try {
    return window.self !== window.top
  } catch {
    // Accessing window.top across origins throws — which means we ARE embedded.
    return true
  }
}

/**
 * Receiver side of the cross-origin embed session handoff.
 *
 * When app.nodaro.ai runs inside another Nodaro surface's iframe (e.g.
 * studio.nodaro.ai's pricing modal), its localStorage is a different origin's,
 * so the parent's Supabase session is invisible here and the dashboard would
 * bounce to /login. This hook lets a trusted parent hand us the session:
 *
 *   1. We announce readiness (`nodaro:embedReady`) to the parent.
 *   2. The parent replies with `{ access_token, refresh_token }` (or
 *      `nodaro:noSession`) — only honored from a first-party origin.
 *   3. We adopt the session via `setAuthFromTokens` (works with PKCE — unlike
 *      the abandoned URL-hash handoff, `setSession` needs no code verifier).
 *
 * Returns `awaitingHandoff` so the auth guard can hold its redirect (show a
 * spinner) instead of flashing /login while the session is in flight. We stop
 * waiting once a session lands (the guard then sees a user), the parent reports
 * no session, or a short timeout elapses (so a genuinely-unauthenticated
 * direct-to-parent user still falls through to login).
 */
export function useEmbedSessionHandoff(): { awaitingHandoff: boolean } {
  const [awaitingHandoff, setAwaitingHandoff] = useState(() => isEmbedded())

  useEffect(() => {
    if (!isEmbedded()) return

    let settled = false
    const stopWaiting = () => {
      if (settled) return
      settled = true
      setAwaitingHandoff(false)
    }

    const handler = (event: MessageEvent) => {
      if (!isAllowedEmbedParent(event.origin)) return
      const data = event.data
      if (!data || typeof data !== "object") return

      if (data.type === "nodaro:setSession") {
        const { access_token, refresh_token } = data as Record<string, unknown>
        if (typeof access_token !== "string" || typeof refresh_token !== "string") return
        // On success the user populates via onAuthStateChange and the guard
        // renders — we intentionally DON'T stopWaiting() here, to avoid a
        // window where awaitingHandoff is false but the user isn't set yet.
        // The timeout clears the flag harmlessly later (user is set by then).
        void setAuthFromTokens(access_token, refresh_token)
      } else if (data.type === "nodaro:noSession") {
        // Parent is itself unauthenticated — don't keep the user waiting.
        stopWaiting()
      }
    }
    window.addEventListener("message", handler)

    // Announce readiness. `nodaro:embedReady` carries no secret, so a wildcard
    // target is fine; the parent validates that the reply target is us.
    try {
      window.parent.postMessage({ type: "nodaro:embedReady" }, "*")
    } catch {
      // ignore — not embedded after all / blocked
    }

    const timeout = setTimeout(stopWaiting, HANDOFF_TIMEOUT_MS)

    return () => {
      window.removeEventListener("message", handler)
      clearTimeout(timeout)
    }
  }, [])

  return { awaitingHandoff }
}
