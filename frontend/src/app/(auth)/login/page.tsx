import { useState, useEffect } from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { NodaroLogo } from "@/components/nodaro-logo"
import { useAuth } from "@/hooks/use-auth"
import { isCloud } from "@/lib/edition"
import { AUTH_REDIRECT_KEY } from "@/lib/storage-keys"
import { FREE_TIER_CREDITS } from "@/lib/pricing-data"
import { runtimeSupabaseAnonKey, runtimeSupabaseUrl } from "@/lib/runtime-config"

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

  // Email/password is the self-host path (GoTrue native). Cloud stays
  // Google-only — its funnel is a product decision, not an edition default.
  const showEmailAuth = !isCloud()

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
      setError(err instanceof Error ? err.message : "Sign in failed")
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
      setError(err instanceof Error ? err.message : "Sign in failed")
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
              Visual workflows for AI video generation
            </p>
          ) : (
            <p className="animate-in fade-in duration-700">
              <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 font-mono text-[11px] tracking-[0.14em] text-muted-foreground">
                SELF-HOSTED &middot; {window.location.host}
              </span>
            </p>
          )}
        </div>

        {/* Login card */}
        <div className="rounded-xl border border-white/[0.08] bg-card/60 backdrop-blur-sm p-6 shadow-lg space-y-4">
          <div className="space-y-1.5">
            <h2 className="text-lg font-semibold">{isCloud() ? "Sign in" : "Sign in to this server"}</h2>
            {!isCloud() && (
              <p className="text-xs text-muted-foreground">
                Your local account on this server &mdash; not a nodaro.ai
                account. Connecting nodaro.ai happens afterwards, in
                Integrations.
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
                  placeholder="Email"
                  autoComplete="email"
                  required
                  aria-label="Email"
                />
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  autoComplete="current-password"
                  required
                  aria-label="Password"
                />
                <Button type="submit" className="w-full" disabled={pending}>
                  {pending ? "Signing in..." : "Sign in"}
                </Button>
              </form>

              {googleAvailable && (
                <div className="flex items-center gap-3">
                  <div className="h-px flex-1 bg-border" />
                  <span className="text-xs text-muted-foreground/60">or</span>
                  <div className="h-px flex-1 bg-border" />
                </div>
              )}
            </>
          )}

          {googleAvailable && (
            <Button
              variant={showEmailAuth ? "outline" : "default"}
              className="w-full"
              onClick={handleGoogleSignIn}
              disabled={pending}
            >
              {pending ? "Redirecting..." : "Continue with Google"}
            </Button>
          )}

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          {showEmailAuth ? (
            <p className="text-xs text-muted-foreground/60 pt-1">
              New here?{" "}
              <Link to="/signup" className="underline underline-offset-2 hover:text-muted-foreground">
                Create an account
              </Link>
              <span className="mx-2">&middot;</span>
              <Link to="/setup" className="underline underline-offset-2 hover:text-muted-foreground">
                Install setup
              </Link>
            </p>
          ) : (
            <p className="text-xs text-muted-foreground/60 pt-1">
              Start free with up to {FREE_TIER_CREDITS.toLocaleString()} credits. No credit card required.
            </p>
          )}
        </div>
      </div>

      {/* Legal footer */}
      <div className="absolute bottom-6 flex items-center justify-center gap-4 text-xs text-muted-foreground/60">
        <a href="https://nodaro.ai/terms" target="_blank" rel="noopener noreferrer" className="hover:text-muted-foreground transition-colors">
          Terms of Service
        </a>
        <span>&middot;</span>
        <a href="https://nodaro.ai/privacy" target="_blank" rel="noopener noreferrer" className="hover:text-muted-foreground transition-colors">
          Privacy Policy
        </a>
        <span>&middot;</span>
        <a href="https://nodaro.ai/refund" target="_blank" rel="noopener noreferrer" className="hover:text-muted-foreground transition-colors">
          Refund Policy
        </a>
      </div>
    </div>
  )
}
