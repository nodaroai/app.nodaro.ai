import { useEffect, useState } from "react"
import { ShieldBan } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useT } from "@/lib/i18n"
import { createClient } from "@/lib/supabase"
import { ACCESS_BLOCKED_EVENT } from "@/lib/access-blocked-event"

/**
 * What a blocked person sees: one sentence over the whole app and a way out.
 *
 * Mounted ONCE at the app root (main.tsx), outside the router, so it covers
 * every page — the dashboard, the editor, a published app, a presentation —
 * not only the ones inside the dashboard layout. It appears when any API call
 * answers `403 access_blocked` (`throwApiError` dispatches the event) and only
 * for a signed-in session: the login page never shows it.
 */
export function AccessBlockedScreen() {
  const t = useT()
  const [blocked, setBlocked] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  useEffect(() => {
    const onBlocked = () => {
      void createClient()
        .auth.getSession()
        .then(({ data }) => {
          if (data.session) setBlocked(true)
        })
    }
    window.addEventListener(ACCESS_BLOCKED_EVENT, onBlocked)
    return () => window.removeEventListener(ACCESS_BLOCKED_EVENT, onBlocked)
  }, [])

  if (!blocked) return null

  const signOut = async () => {
    setSigningOut(true)
    try {
      await createClient().auth.signOut()
    } catch {
      // Leave anyway: this session can do nothing here, and the login page
      // says why when the account itself is blocked.
    } finally {
      window.location.assign("/login")
    }
  }

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="access-blocked-title"
      aria-describedby="access-blocked-body"
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-background/95 px-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-md space-y-4 rounded-xl border bg-card p-6 text-center shadow-lg">
        <ShieldBan className="mx-auto h-10 w-10 text-destructive" aria-hidden="true" />
        <h2 id="access-blocked-title" className="text-lg font-semibold">
          {t("accessBlocked.title")}
        </h2>
        <p id="access-blocked-body" className="text-sm text-muted-foreground">
          {t("accessBlocked.body")}
        </p>
        <Button onClick={signOut} disabled={signingOut}>
          {t("nav.signOut")}
        </Button>
      </div>
    </div>
  )
}
