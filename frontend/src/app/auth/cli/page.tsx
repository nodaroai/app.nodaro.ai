import { useEffect, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { Loader2, Terminal, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/hooks/use-auth"
import { createApiToken } from "@/lib/api"
import { toast } from "sonner"

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
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { user, loading: authLoading } = useAuth()

  const callback = params.get("callback") ?? ""
  const state = params.get("state") ?? ""
  const device = params.get("device") ?? "this device"

  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  const callbackError = validateLoopbackUrl(callback)
  const missingParam = !callback ? "callback" : !state ? "state" : null

  // Redirect to login if not authenticated, preserving return URL
  useEffect(() => {
    if (authLoading) return
    if (!user && !missingParam && !callbackError) {
      const returnTo = window.location.pathname + window.location.search
      navigate(`/login?return_to=${encodeURIComponent(returnTo)}`)
    }
  }, [user, authLoading, navigate, missingParam, callbackError])

  function buildCallback(extra: Record<string, string>) {
    const url = new URL(callback)
    url.searchParams.set("state", state)
    for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v)
    return url.toString()
  }

  function handleCancel() {
    if (callbackError || missingParam) return
    window.location.href = buildCallback({ error: "access_denied" })
  }

  async function handleAuthorize() {
    if (callbackError || missingParam) return
    setSubmitting(true)
    try {
      const tokenName = `CLI: ${device}`.slice(0, 100)
      const result = await createApiToken({ name: tokenName })
      const token = result.data.token
      setDone(true)
      // Brief pause so the user sees confirmation before the tab closes/redirects
      setTimeout(() => {
        window.location.href = buildCallback({ token })
      }, 600)
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to issue token"
      toast.error(message)
      setSubmitting(false)
    }
  }

  if (missingParam || callbackError) {
    return (
      <ErrorScreen
        title="Invalid CLI authorization request"
        detail={missingParam ? `Missing parameter: ${missingParam}` : callbackError!}
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

        <h1 className="mb-2 text-2xl font-semibold">Authorize Nodaro CLI</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          Sign in <span className="font-medium text-foreground">{user?.email}</span> on{" "}
          <span className="font-medium text-foreground">{device}</span>?
        </p>

        <div className="mb-6 rounded-md border bg-muted/40 p-4 text-xs text-muted-foreground">
          The CLI will receive an API token tied to your account. You can revoke it
          any time from <a href="/settings/api" className="underline">Settings → API</a>.
        </div>

        {done ? (
          <div className="text-center text-sm text-muted-foreground">
            <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
            Returning to terminal…
          </div>
        ) : (
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={handleCancel} disabled={submitting}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={handleAuthorize} disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Authorize"}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

function validateLoopbackUrl(raw: string): string | null {
  if (!raw) return null
  let url: URL
  try { url = new URL(raw) }
  catch { return "callback is not a valid URL" }
  if (url.protocol !== "http:") return "callback must use http://"
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    return "callback must be a loopback address (127.0.0.1 or localhost)"
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
