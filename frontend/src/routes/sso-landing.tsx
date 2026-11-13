import { useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { createClient } from "@/lib/supabase"
import { useT } from "@/lib/i18n"
import { DEFAULT_SIGN_IN_PATH, followSignInRedirect, sameSitePath, takeSignInRedirect } from "@/lib/sign-in-redirect"
import { reportSignIn } from "@/lib/analytics/sign-in-events"

/**
 * Where an SSO sign-in goes once its session exists. The identity provider
 * names a destination by appending `&next=` on its way back; the SSO hop
 * forwards nothing else, so the login page's own `?redirect=` (kept in
 * localStorage, as for the Google round trip) is what a sign-in begun there
 * goes on to, whenever the provider named no other page. `next` arrives as
 * `/projects` when it was absent or unsafe (the exchange route and the
 * index.html stash both default it), so that is the case the kept
 * destination fills. The kept destination is consumed either way: a finished
 * sign-in leaves nothing behind for the next one.
 */
function ssoDestination(next: string | undefined): string {
  const named = sameSitePath(next)
  const kept = takeSignInRedirect()
  if (named !== null && named !== DEFAULT_SIGN_IN_PATH) return named
  return kept ?? DEFAULT_SIGN_IN_PATH
}

/** SSO exchange landing (B6). The backend has already verified the assertion,
 *  enforced linking rules, and minted a one-time Supabase token; the
 *  index.html pre-module script stashed it into window.__NODARO_SSO__ and
 *  cleaned the URL. Here we redeem it for a session and go on: this app's own
 *  page in place, another product's page on this site by a full page load
 *  (lib/sign-in-redirect.ts). */
export default function SsoLandingPage() {
  const navigate = useNavigate()
  const t = useT()

  useEffect(() => {
    const stashed = (window as unknown as { __NODARO_SSO__?: { token: string; next: string } }).__NODARO_SSO__

    if (!stashed?.token) {
      navigate("/login", { replace: true })
      return
    }

    const supabase = createClient()
    // generateLink was minted with type "magiclink"; verifyOtp's "magiclink"
    // type is DEPRECATED — "email" is the current type that redeems a
    // magic-link hashed_token. Do not "fix" this to "magiclink".
    supabase.auth
      .verifyOtp({ token_hash: stashed.token, type: "email" })
      .then(({ data, error }) => {
        if (error) {
          navigate("/login", { replace: true })
          return
        }
        // The sign-in (or sign-up) for the site analytics, where it completes.
        if (data?.user) reportSignIn(data.user, "sso")
        // Same-origin path guard, again (defence in depth vs. the inline
        // script), the way the browser would follow it.
        followSignInRedirect(navigate, ssoDestination(stashed.next))
      })
      .catch(() => navigate("/login", { replace: true }))
  }, [navigate])

  return (
    <div className="flex h-screen items-center justify-center bg-background" role="status" aria-label={t("auth.ssoExchanging")}>
      <div className="animate-spin h-6 w-6 border-2 border-[#ff0073] border-t-transparent rounded-full" />
      <span className="sr-only">{t("auth.ssoExchanging")}</span>
    </div>
  )
}
