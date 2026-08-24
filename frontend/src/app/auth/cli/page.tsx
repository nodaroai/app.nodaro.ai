import { useEffect, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { Loader2, Terminal, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/hooks/use-auth"
import { createApiToken } from "@/lib/api"
import { toast } from "sonner"
import { useT, type MessageKey } from "@/lib/i18n"

/**
 * CLI login bridge — `nodaro auth login` opens the browser here with a
 * loopback callback URL and a one-shot state token. The user clicks
 * "Authorize", we mint an API token via the existing /v1/api-tokens
 * endpoint, and redirect the browser back to the loopback URL with the
 * token in the query string. The CLI's localhost listener captures it.
 *
 * Security:
 * - callback MUST be loopback (http://127.0.0.1:* or http://localhost:*).
 *   Anything else is rejected — token never leaves the user's machine.
 * - state echoes back unchanged; the CLI verifies it before saving.
 * - Token is shown to the bridge once and immediately handed off.
 */
export default function AuthCliPage() {
  const t = useT()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { user, loading: authLoading } = useAuth()

  const callback = params.get("callback") ?? ""
  const state = params.get("state") ?? ""
  // Raw param drives the stored token NAME (locale-independent, so the label a
  // user sees in Settings → API doesn't depend on the UI language at issue
  // time); the translated fallback is display-only.
  const deviceRaw = params.get("device") ?? "this device"
  const deviceLabel = params.get("device") ?? t("cli.thisDevice")

  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  const callbackErrorKey = validateLoopbackUrl(callback)
  const missingParam = !callback ? "callback" : !state ? "state" : null

  // Redirect to login if not authenticated, preserving return URL
  useEffect(() => {
    if (authLoading) return
    if (!user && !missingParam && !callbackErrorKey) {
      const returnTo = window.location.pathname + window.location.search
      navigate(`/login?return_to=${encodeURIComponent(returnTo)}`)
    }
  }, [user, authLoading, navigate, missingParam, callbackErrorKey])

  function buildCallback(extra: Record<string, string>) {
    const url = new URL(callback)
    url.searchParams.set("state", state)
    for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v)
    return url.toString()
  }

  function handleCancel() {
    if (callbackErrorKey || missingParam) return
    window.location.href = buildCallback({ error: "access_denied" })
  }

  async function handleAuthorize() {
    if (callbackErrorKey || missingParam) return
    setSubmitting(true)
    try {
      const tokenName = `CLI: ${deviceRaw}`.slice(0, 100)
      const result = await createApiToken({ name: tokenName })
      const token = result.data.token
      setDone(true)
      // Brief pause so the user sees confirmation before the tab closes/redirects
      setTimeout(() => {
        window.location.href = buildCallback({ token })
      }, 600)
    } catch (err) {
      const message = err instanceof Error ? err.message : t("cli.failedIssueToken")
      toast.error(message)
      setSubmitting(false)
    }
  }

  if (missingParam || callbackErrorKey) {
    return (
      <ErrorScreen
        title={t("cli.invalidRequestTitle")}
        detail={
          missingParam
            ? t("cli.missingParam", { param: missingParam })
            : t(callbackErrorKey!)
        }
      />
    )
  }

  if (authLoading || (!user && !done)) {
    return <LoadingScreen />
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md rounded-lg border bg-card p-8 shadow-lg">
        <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          <Terminal className="h-6 w-6 text-primary" />
        </div>

        <h1 className="mb-2 text-2xl font-semibold">{t("cli.authorizeTitle")}</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          {t("cli.signInAs")}{" "}
          <span className="font-medium text-foreground">{user?.email}</span>{" "}
          {t("cli.signInOn")}{" "}
          <span className="font-medium text-foreground">{deviceLabel}</span>?
        </p>

        <div className="mb-6 rounded-md border bg-muted/40 p-4 text-xs text-muted-foreground">
          {t("cli.tokenNotice")}{" "}
          <a href="/settings/api" className="underline">{t("cli.settingsApiLink")}</a>.
        </div>

        {done ? (
          <div className="text-center text-sm text-muted-foreground">
            <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
            {t("cli.returningToTerminal")}
          </div>
        ) : (
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={handleCancel} disabled={submitting}>
              {t("common.cancel")}
            </Button>
            <Button className="flex-1" onClick={handleAuthorize} disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : t("cli.authorize")}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Returns a message KEY (not a rendered string) so the plain, non-hook function
 * stays locale-agnostic; the caller translates it at the render site.
 */
function validateLoopbackUrl(raw: string): MessageKey | null {
  if (!raw) return null
  let url: URL
  try { url = new URL(raw) }
  catch { return "cli.errNotValidUrl" }
  if (url.protocol !== "http:") return "cli.errMustUseHttp"
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    return "cli.errMustBeLoopback"
  }
  return null
}

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  )
}

function ErrorScreen({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md rounded-lg border border-destructive/40 bg-card p-8">
        <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10">
          <AlertTriangle className="h-5 w-5 text-destructive" />
        </div>
        <h1 className="mb-2 text-lg font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{detail}</p>
      </div>
    </div>
  )
}
