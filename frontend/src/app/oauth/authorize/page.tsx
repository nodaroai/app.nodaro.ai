import { useEffect, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { Loader2, ShieldCheck, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/hooks/use-auth"
import { getOAuthAppInfo, oauthAuthorize, type OAuthAppInfo } from "@/lib/api"
import { toast } from "sonner"

const SCOPE_DESCRIPTIONS: Record<string, string> = {
  "workflows:read": "Read your workflows",
  "workflows:write": "Create and modify workflows",
  "workflows:execute": "Run workflows on your behalf",
  "jobs:read": "Read job status and results",
  "assets:read": "Read your uploaded assets",
  "assets:write": "Upload assets to your account",
  "credits:read": "See your credit balance",
  "apps:read": "Read published apps",
}

export default function OAuthAuthorizePage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { user, loading: authLoading } = useAuth()

  const clientId = params.get("client_id") ?? ""
  const redirectUri = params.get("redirect_uri") ?? ""
  const scopeStr = params.get("scope") ?? ""
  const state = params.get("state") ?? ""
  const responseType = params.get("response_type") ?? "code"

  const [appInfo, setAppInfo] = useState<OAuthAppInfo | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Validate required params
  const missingParam = !clientId
    ? "client_id"
    : !redirectUri
      ? "redirect_uri"
      : !scopeStr
        ? "scope"
        : responseType !== "code"
          ? "response_type (must be 'code')"
          : null

  useEffect(() => {
    if (missingParam) return
    let cancelled = false
    getOAuthAppInfo(clientId)
      .then((info) => { if (!cancelled) setAppInfo(info) })
      .catch((err) => { if (!cancelled) setLoadError(err instanceof Error ? err.message : "Failed to load app info") })
    return () => { cancelled = true }
  }, [clientId, missingParam])

  // Redirect to login if not authenticated, preserving return URL
  useEffect(() => {
    if (authLoading) return
    if (!user && !missingParam) {
      const returnTo = window.location.pathname + window.location.search
      navigate(`/login?return_to=${encodeURIComponent(returnTo)}`)
    }
  }, [user, authLoading, navigate, missingParam])

  function buildErrorRedirect(error: string, description?: string) {
    const url = new URL(redirectUri)
    url.searchParams.set("error", error)
    if (description) url.searchParams.set("error_description", description)
    if (state) url.searchParams.set("state", state)
    return url.toString()
  }

  function handleCancel() {
    if (!redirectUri) return
    window.location.href = buildErrorRedirect("access_denied", "User cancelled")
  }

  async function handleAllow() {
    if (!appInfo) return
    setSubmitting(true)
    try {
      const requestedScopes = scopeStr.split(/[\s+]/).filter(Boolean)
      const result = await oauthAuthorize({
        clientId,
        redirectUri,
        scopes: requestedScopes,
        state: state || undefined,
      })
      const url = new URL(result.redirectUri)
      url.searchParams.set("code", result.code)
      if (result.state) url.searchParams.set("state", result.state)
      window.location.href = url.toString()
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Authorization failed"
      toast.error(msg)
      setSubmitting(false)
    }
  }

  if (missingParam) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-md w-full p-6 rounded-lg border bg-card text-card-foreground shadow">
          <div className="flex items-center gap-2 mb-4 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            <h1 className="text-lg font-semibold">Invalid OAuth request</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Missing or invalid parameter: <code className="text-foreground">{missingParam}</code>
          </p>
        </div>
      </div>
    )
  }

  if (authLoading || (!user && !missingParam)) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>
  }

  if (loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-md w-full p-6 rounded-lg border bg-card text-card-foreground shadow">
          <div className="flex items-center gap-2 mb-4 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            <h1 className="text-lg font-semibold">Couldn't load app info</h1>
          </div>
          <p className="text-sm text-muted-foreground">{loadError}</p>
          <Button variant="outline" className="mt-4" onClick={handleCancel}>Cancel</Button>
        </div>
      </div>
    )
  }

  if (!appInfo) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>
  }

  const requestedScopes = scopeStr.split(/[\s+]/).filter(Boolean)

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <div className="max-w-md w-full p-6 rounded-lg border bg-card text-card-foreground shadow-lg">
        <div className="flex items-center gap-3 mb-6">
          {appInfo.logoUrl ? (
            <img src={appInfo.logoUrl} alt="" className="w-12 h-12 rounded" />
          ) : (
            <div className="w-12 h-12 rounded bg-muted flex items-center justify-center">
              <ShieldCheck className="h-6 w-6 text-muted-foreground" />
            </div>
          )}
          <div className="min-w-0">
            <h1 className="font-semibold truncate">{appInfo.name}</h1>
            {appInfo.homepageUrl && (
              <a href={appInfo.homepageUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground hover:underline truncate block">
                {appInfo.homepageUrl}
              </a>
            )}
          </div>
        </div>

        <p className="text-sm mb-2">
          <span className="font-medium">{appInfo.name}</span> wants to access your Nodaro account.
        </p>
        {appInfo.description && (
          <p className="text-xs text-muted-foreground mb-4">{appInfo.description}</p>
        )}

        <div className="my-6">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">Permissions</p>
          <ul className="space-y-2">
            {requestedScopes.map((s) => (
              <li key={s} className="flex items-start gap-2 text-sm">
                <ShieldCheck className="h-4 w-4 mt-0.5 text-primary flex-shrink-0" />
                <span>{SCOPE_DESCRIPTIONS[s] ?? s}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col gap-2">
          <Button onClick={handleAllow} disabled={submitting}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Allow
          </Button>
          <Button variant="outline" onClick={handleCancel} disabled={submitting}>
            Cancel
          </Button>
        </div>

        <p className="text-xs text-muted-foreground mt-4 text-center">
          You can revoke this access at any time from your account settings.
        </p>
      </div>
    </div>
  )
}
