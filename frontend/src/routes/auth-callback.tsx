import { useEffect } from "react"
import { useNavigate } from "react-router-dom"
import type { Session } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase"
import { DEFAULT_SIGN_IN_PATH, followSignInRedirect, takeSignInRedirect } from "@/lib/sign-in-redirect"
import { isBlockedCallback } from "@/lib/sign-in-error"
import { LOGIN_POPUP_MESSAGE_TYPE } from "@/lib/popup-message"
import { reportSignIn } from "@/lib/analytics/sign-in-events"

export default function AuthCallback() {
  const navigate = useNavigate()

  useEffect(() => {
    // GoTrue refused a blocked account. Say so on the login page rather than
    // waiting out the timeout below into a bare login form.
    if (isBlockedCallback(window.location.search, window.location.hash)) {
      navigate("/login?blocked=1", { replace: true })
      return
    }

    const supabase = createClient()

    // If opened as a popup (e.g., from embedded iframe), send the session
    // to the opener via postMessage and close the window.
    const isPopup = !!window.opener

    // Consume the saved redirect once (e.g., from /present/:shareToken, or a
    // page of another product on this site) — a path on this site only, the
    // way the browser would follow it (prevents an open redirect).
    const redirectUrl = takeSignInRedirect() ?? DEFAULT_SIGN_IN_PATH

    // Set below. Cleared once the sign-in goes on: a full page load keeps this
    // page mounted until the next document arrives, and the timeout must not
    // send it to /login meanwhile.
    let timeout: ReturnType<typeof setTimeout> | undefined
    let wentOn = false

    function onAuthSuccess(session: Session) {
      if (isPopup) {
        // Send session tokens to opener (iframe) via postMessage.
        // Cross-origin iframes have partitioned localStorage, so the
        // session stored here is invisible to the iframe — tokens must
        // be passed explicitly.
        supabase.auth.getSession().then(({ data: { session } }) => {
          if (session && window.opener) {
            window.opener.postMessage({
              type: LOGIN_POPUP_MESSAGE_TYPE,
              access_token: session.access_token,
              refresh_token: session.refresh_token,
            }, window.location.origin)
          }
          // Small delay to let the message be received before closing
          setTimeout(() => window.close(), 200)
        })
        return
      }
      // This app's own page in place; another product's page on this site by
      // a full page load (lib/sign-in-redirect.ts). Once: the listener and the
      // getSession fallback below can both report the same session.
      if (wentOn) return
      wentOn = true
      clearTimeout(timeout)
      // The sign-in (or sign-up) for the site analytics: here, where it
      // completes, once — never from the session listener, which also fires
      // on token refreshes and tab focus.
      reportSignIn(session.user)
      followSignInRedirect(navigate, redirectUrl)
    }

    // Supabase automatically exchanges the code/hash tokens via onAuthStateChange.
    // We just need to listen for the session to appear.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === "SIGNED_IN" || event === "TOKEN_REFRESHED") && session) {
        onAuthSuccess(session)
      }
    })

    // Fallback: if Supabase already has a session (race condition),
    // or if the code exchange already happened before this listener attached
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        onAuthSuccess(session)
      }
    })

    // Safety timeout — if nothing happens in 5s, go to login
    timeout = setTimeout(() => {
      if (isPopup) {
        window.close()
        return
      }
      navigate("/login", { replace: true })
    }, 5000)

    return () => {
      subscription.unsubscribe()
      clearTimeout(timeout)
    }
  }, [navigate])

  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <div className="animate-spin h-6 w-6 border-2 border-[#ff0073] border-t-transparent rounded-full" />
    </div>
  )
}
