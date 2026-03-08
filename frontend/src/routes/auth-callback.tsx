import { useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { createClient } from "@/lib/supabase"
import { AUTH_REDIRECT_KEY } from "@/lib/storage-keys"

export default function AuthCallback() {
  const navigate = useNavigate()

  useEffect(() => {
    const supabase = createClient()

    // Consume the saved redirect URL once (e.g., from /present/:shareToken)
    let redirectUrl = localStorage.getItem(AUTH_REDIRECT_KEY) ?? "/projects"
    localStorage.removeItem(AUTH_REDIRECT_KEY)
    // Validate redirect is a relative path (prevent open redirect)
    if (!redirectUrl.startsWith("/") || redirectUrl.startsWith("//")) {
      redirectUrl = "/projects"
    }

    // Supabase automatically exchanges the code/hash tokens via onAuthStateChange.
    // We just need to listen for the session to appear.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === "SIGNED_IN" || event === "TOKEN_REFRESHED") && session) {
        navigate(redirectUrl, { replace: true })
      }
    })

    // Fallback: if Supabase already has a session (race condition),
    // or if the code exchange already happened before this listener attached
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        navigate(redirectUrl, { replace: true })
      }
    })

    // Safety timeout — if nothing happens in 5s, go to login
    const timeout = setTimeout(() => {
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
