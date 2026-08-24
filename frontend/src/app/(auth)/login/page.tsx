import { useState, useEffect } from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { NodaroLogo } from "@/components/nodaro-logo"
import { useAuth } from "@/hooks/use-auth"
import { isCloud } from "@/lib/edition"
import { surfaceAuthMethods } from "@/lib/surface-selectors"
import type { AuthMethod } from "@/lib/surface-profile"
import { AUTH_REDIRECT_KEY } from "@/lib/storage-keys"
import { FREE_TIER_CREDITS } from "@/lib/pricing-data"
import { runtimeSupabaseAnonKey, runtimeSupabaseUrl } from "@/lib/runtime-config"
import { useT } from "@/lib/i18n"

const PENDING_PLAN_KEY = "nodaro_pending_plan"

/** Read + consume the stored post-auth redirect (same key the OAuth
 *  round-trip uses), falling back to the dashboard. */
function consumeRedirect(): string {
  const stored = localStorage.getItem(AUTH_REDIRECT_KEY)
  if (stored && stored.startsWith("/") && !stored.startsWith("//")) {
    localStorage.removeItem(AUTH_REDIRECT_KEY)
    return stored
  }
  return "/projects"
}

export default function LoginPage() {
  const t = useT()
  const { signInWithGoogle, signInWithEmail } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")

  // First-boot detection (self-host): a fresh install has zero accounts —
  // asking someone to SIGN IN before anything exists is nonsense (founder,
  // 2026-08-13). Land them on /setup, which shows install health and leads
  // with operator-account creation. Best-effort: any fetch failure keeps
  // the normal login flow.
  useEffect(() => {
    if (isCloud()) return
    let cancelled = false
    fetch("/v1/setup/status", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { hasUsers?: boolean } | null) => {
        if (!cancelled && json && json.hasUsers === false) {
          navigate("/setup", { replace: true })
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [navigate])

  // Self-host: the bundled GoTrue has NO Google OAuth configured — clicking
  // "Continue with Google" would land on a raw GoTrue JSON error (founder hit
  // this 2026-08-14). Ask GoTrue which external providers exist and show the
  // button only when google is truly enabled. Cloud skips the probe.
  const [googleAvailable, setGoogleAvailable] = useState(isCloud())
  useEffect(() => {
    if (isCloud()) return
    let cancelled = false
    const base = runtimeSupabaseUrl() || undefined
    const anon = runtimeSupabaseAnonKey() || undefined
    if (!base || !anon) return
    fetch(`${base.replace(/\/$/, "")}/auth/v1/settings`, { headers: { apikey: anon } })
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { external?: Record<string, boolean> } | null) => {
        if (!cancelled && json?.external?.google === true) setGoogleAvailable(true)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // Email/password is the self-host path (GoTrue native); cloud stays
  // Google-only. B1: the deployment surface profile can NARROW which methods
  // show — surfaceAuthMethods drops any method the code doesn't offer, so a
  // profile can hide a lever but never surface an unavailable one.
  const codeDefaultAuthMethods: AuthMethod[] = [
    ...(isCloud() ? [] : (["email"] as const)),
    ...(googleAvailable ? (["google"] as const) : []),
  ]
  const authMethods = surfaceAuthMethods(codeDefaultAuthMethods)
  const showEmailAuth = authMethods.includes("email")
  const showGoogle = authMethods.includes("google")

  // Persist redirect param to localStorage (survives Google OAuth round-trip).
  // Both spellings are live senders: dashboard guards use ?redirect=, while
  // the OAuth consent + CLI auth pages send ?return_to= — ignoring the latter
  // stranded users in /projects after sign-in, losing the consent screen
  // (founder hit it mid community-connect, 2026-08-14).
  useEffect(() => {
    const redirect = searchParams.get("redirect") ?? searchParams.get("return_to")
    if (redirect && redirect.startsWith("/") && !redirect.startsWith("//")) {
      localStorage.setItem(AUTH_REDIRECT_KEY, redirect)
    }
  }, [searchParams])

  async function handleGoogleSignIn() {
    setPending(true)
    setError(null)

    // Persist plan param through the OAuth redirect
    const plan = searchParams.get("plan")
    if (plan) {
      localStorage.setItem(PENDING_PLAN_KEY, plan)
    }

    try {
      await signInWithGoogle()
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.signInFailed"))
      setPending(false)
    }
  }

  async function handleEmailSignIn(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    try {
      await signInWithEmail(email, password)
      navigate(consumeRedirect(), { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.signInFailed"))
      setPending(false)
    }
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center px-4 bg-gradient-to-b from-background via-background to-zinc-950/40">
      {/* Subtle dot grid background */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: "radial-gradient(circle, currentColor 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />

      <div className="relative z-10 w-full max-w-sm space-y-8 text-center">
        {/* Logo + tagline */}
        <div className="space-y-3">
          <h1>
            <NodaroLogo size="xl" />
          </h1>
          {isCloud() ? (
            <p className="text-base text-muted-foreground animate-in fade-in duration-700">
              {t("auth.tagline")}
            </p>
          ) : (
            <p className="animate-in fade-in duration-700">
              <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 font-mono text-[11px] tracking-[0.14em] text-muted-foreground">
                {t("auth.selfHostedBadge", { host: window.location.host })}
              </span>
            </p>
          )}
        </div>

        {/* Login card */}
        <div className="rounded-xl border border-white/[0.08] bg-card/60 backdrop-blur-sm p-6 shadow-lg space-y-4">
          <div className="space-y-1.5">
            <h2 className="text-lg font-semibold">{isCloud() ? t("auth.signIn") : t("auth.signInToServer")}</h2>
            {!isCloud() && (
              <p className="text-xs text-muted-foreground">
                {t("auth.localAccountNotice")}
              </p>
            )}
          </div>

          {showEmailAuth && (
            <>
              <form onSubmit={handleEmailSignIn} className="space-y-3 text-left">
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t("auth.emailPlaceholder")}
                  autoComplete="email"
                  required
                  aria-label={t("auth.emailPlaceholder")}
                />
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t("auth.passwordPlaceholder")}
                  autoComplete="current-password"
                  required
                  aria-label={t("auth.passwordPlaceholder")}
                />
                <Button type="submit" className="w-full" disabled={pending}>
                  {pending ? t("auth.signingIn") : t("auth.signIn")}
                </Button>
              </form>

              {showGoogle && (
                <div className="flex items-center gap-3">
                  <div className="h-px flex-1 bg-border" />
                  <span className="text-xs text-muted-foreground/60">{t("auth.or")}</span>
                  <div className="h-px flex-1 bg-border" />
                </div>
              )}
            </>
          )}

          {showGoogle && (
            <Button
              variant={showEmailAuth ? "outline" : "default"}
              className="w-full"
              onClick={handleGoogleSignIn}
              disabled={pending}
            >
              {pending ? t("auth.redirecting") : t("auth.continueWithGoogle")}
            </Button>
          )}

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          {showEmailAuth ? (
            <p className="text-xs text-muted-foreground/60 pt-1">
              {t("auth.newHere")}{" "}
              <Link to="/signup" className="underline underline-offset-2 hover:text-muted-foreground">
                {t("auth.createAccount")}
              </Link>
              <span className="mx-2">&middot;</span>
              <Link to="/setup" className="underline underline-offset-2 hover:text-muted-foreground">
                {t("auth.installSetup")}
              </Link>
            </p>
          ) : (
            <p className="text-xs text-muted-foreground/60 pt-1">
              {t("auth.freeCredits", { credits: FREE_TIER_CREDITS.toLocaleString() })}
            </p>
          )}
        </div>
      </div>

      {/* Legal footer */}
      <div className="absolute bottom-6 flex items-center justify-center gap-4 text-xs text-muted-foreground/60">
        <a href="https://nodaro.ai/terms" target="_blank" rel="noopener noreferrer" className="hover:text-muted-foreground transition-colors">
          {t("legal.terms")}
        </a>
        <span>&middot;</span>
        <a href="https://nodaro.ai/privacy" target="_blank" rel="noopener noreferrer" className="hover:text-muted-foreground transition-colors">
          {t("legal.privacy")}
        </a>
        <span>&middot;</span>
        <a href="https://nodaro.ai/refund" target="_blank" rel="noopener noreferrer" className="hover:text-muted-foreground transition-colors">
          {t("legal.refund")}
        </a>
      </div>
    </div>
  )
}
