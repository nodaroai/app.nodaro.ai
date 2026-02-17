import { useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { createClient } from "@/lib/supabase"

export default function AuthCallback() {
  const navigate = useNavigate()

  useEffect(() => {
    const supabase = createClient()

    // Supabase automatically exchanges the code/hash tokens via onAuthStateChange.
    // We just need to listen for the session to appear.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) {
        navigate("/projects", { replace: true })
      } else if (event === "TOKEN_REFRESHED") {
        // Already signed in, redirect
        navigate("/projects", { replace: true })
      }
    })

    // Fallback: if Supabase already has a session (race condition),
    // or if the code exchange already happened before this listener attached
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        navigate("/projects", { replace: true })
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
