import { useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { createClient } from "@/lib/supabase"
import { useT } from "@/lib/i18n"

/** SSO exchange landing (B6). The backend has already verified the assertion,
 *  enforced linking rules, and minted a one-time Supabase token; the
 *  index.html pre-module script stashed it into window.__NODARO_SSO__ and
 *  cleaned the URL. Here we redeem it for a session and navigate on. */
export default function SsoLandingPage() {
  const navigate = useNavigate()
  const t = useT()

  useEffect(() => {
    const stashed = (window as unknown as { __NODARO_SSO__?: { token: string; next: string } }).__NODARO_SSO__
    // Same-origin relative guard, again (defence in depth vs. the inline script).
    let next = stashed?.next ?? "/projects"
    if (!next.startsWith("/") || next.startsWith("//")) next = "/projects"

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
      .then(({ error }) => {
        navigate(error ? "/login" : next, { replace: true })
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
