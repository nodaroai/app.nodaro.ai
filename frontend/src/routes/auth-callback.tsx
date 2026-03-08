import { useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { createClient } from "@/lib/supabase"
import { AUTH_REDIRECT_KEY } from "@/lib/storage-keys"

export default function AuthCallback() {
  const navigate = useNavigate()

  useEffect(() => {
    const supabase = createClient()

    // If opened as a popup (e.g., from embedded iframe), send the session
    // to the opener via postMessage and close the window.
    const isPopup = !!window.opener

    // Consume the saved redirect URL once (e.g., from /present/:shareToken)
    let redirectUrl = localStorage.getItem(AUTH_REDIRECT_KEY) ?? "/projects"
    localStorage.removeItem(AUTH_REDIRECT_KEY)
    // Validate redirect is a relative path (prevent open redirect)
    if (!redirectUrl.startsWith("/") || redirectUrl.startsWith("//")) {
      redirectUrl = "/projects"
    }

    function onAuthSuccess() {
      if (isPopup) {
        // Send session tokens to opener (iframe) via postMessage.
        // Cross-origin iframes have partitioned localStorage, so the
        // session stored here is invisible to the iframe — tokens must
        // be passed explicitly.
        supabase.auth.getSession().then(({ data: { session } }) => {
          if (session && window.opener) {
            window.opener.postMessage({
              type: "nodaro:authComplete",
              access_token: session.access_token,
              refresh_token: session.refresh_token,
            }, window.location.origin)
          }
          // Small delay to let the message be received before closing
          setTimeout(() => window.close(), 200)
        })
        return
      }
      navigate(redirectUrl, { replace: true })
    }

    // Supabase automatically exchanges the code/hash tokens via onAuthStateChange.
    // We just need to listen for the session to appear.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === "SIGNED_IN" || event === "TOKEN_REFRESHED") && session) {
        onAuthSuccess()
      }
    })

    // Fallback: if Supabase already has a session (race condition),
    // or if the code exchange already happened before this listener attached
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        onAuthSuccess()
      }
    })

    // Safety timeout — if nothing happens in 5s, go to login
    const timeout = setTimeout(() => {
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
