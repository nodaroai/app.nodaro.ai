import { useState } from "react"
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { NodaroLogo } from "@/components/nodaro-logo"
import { useAuth } from "@/hooks/use-auth"
import { isCloud } from "@/lib/edition"
import { useT } from "@/lib/i18n"

/**
 * Email/password sign-up — the self-host path (GoTrue handles it natively).
 * Cloud keeps its Google-only funnel and never renders this page.
 *
 * Two outcomes from signUp:
 *   - a session is returned (autoconfirm installs, the community-compose
 *     default) → straight into the app;
 *   - no session (the instance requires email confirmation) → tell the user
 *     to check their inbox, then sign in.
 */
export default function SignupPage() {
  const t = useT()
  const { signUpWithEmail } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  // Guided-setup flow: /setup links here with ?from=setup so a successful
  // signup returns to the stepper (step 1 -> done, step 2 lights up) instead
  // of dropping the user into the app mid-onboarding.
  const fromSetup = searchParams.get("from") === "setup"
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false)

  if (isCloud()) {
    return <Navigate to="/login" replace />
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) {
      setError(t("signup.passwordMismatch"))
      return
    }
    setPending(true)
    setError(null)
    try {
      const { sessionCreated } = await signUpWithEmail(email, password)
      if (sessionCreated) {
        navigate(fromSetup ? "/setup" : "/projects", { replace: true })
      } else {
        setAwaitingConfirmation(true)
        setPending(false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("signup.signUpFailed"))
      setPending(false)
    }
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center px-4 bg-gradient-to-b from-background via-background to-zinc-950/40">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: "radial-gradient(circle, currentColor 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />

      <div className="relative z-10 w-full max-w-sm space-y-8 text-center">
        <div className="space-y-3">
          <h1>
            <NodaroLogo size="xl" />
          </h1>
          <p className="animate-in fade-in duration-700">
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 font-mono text-[11px] tracking-[0.14em] text-muted-foreground">
              {t("auth.selfHostedBadge", { host: window.location.host })}
            </span>
          </p>
        </div>

        <div className="rounded-xl border border-white/[0.08] bg-card/60 backdrop-blur-sm p-6 shadow-lg space-y-4">
          <div className="space-y-1.5">
            <h2 className="text-lg font-semibold">{t("signup.heading")}</h2>
            <p className="text-xs text-muted-foreground">
              {t("signup.localAccountNotice")}
            </p>
          </div>

          {awaitingConfirmation ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {t("signup.awaitingConfirmation")}
              </p>
              <Button asChild className="w-full">
                <Link to="/login">{t("signup.backToSignIn")}</Link>
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3 text-left">
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
                placeholder={t("signup.passwordPlaceholder")}
                autoComplete="new-password"
                minLength={8}
                required
                aria-label={t("auth.passwordPlaceholder")}
              />
              <Input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder={t("signup.confirmPasswordPlaceholder")}
                autoComplete="new-password"
                minLength={8}
                required
                aria-label={t("signup.confirmPasswordPlaceholder")}
              />
              {/* Neutral (not brand-pink) on purpose: this creates a LOCAL
                  server account; pink is reserved for Nodaro Cloud actions. */}
              <Button
                type="submit"
                className="w-full bg-foreground text-background hover:bg-foreground/90"
                disabled={pending}
              >
                {pending ? t("signup.creatingAccount") : t("signup.createAccount")}
              </Button>
            </form>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          {!awaitingConfirmation && (
            <p className="text-xs text-muted-foreground/60 pt-1">
              {t("signup.alreadyHaveAccount")}{" "}
              <Link to="/login" className="underline underline-offset-2 hover:text-muted-foreground">
                {t("auth.signIn")}
              </Link>
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
