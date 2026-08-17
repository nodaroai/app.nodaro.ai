import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { Cloud, KeyRound, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { isCloud } from "@/lib/edition"

/**
 * "This install can't generate yet" — the dashboard callout a self-hoster sees
 * right after signing up on an install with no provider key and no nodaro.ai
 * connection.
 *
 * Why it exists (release check 8, #706): the guided /setup path only fires for
 * the very FIRST account (the login page redirects when the install has no
 * users). Every account created afterwards — and any first user who signs up
 * through the login page's "Create an account" — lands on the dashboard with
 * no hint that generation needs a key or the connection, and the founder's
 * words were "I'd expect a dismissible popup: hey, you haven't added an API
 * key yet — add one, or connect with nodaro.ai in one click."
 *
 * Reads GET /v1/setup/status (the one source for what this install can
 * reach). Shown only when `providers.ok` is false. Dismissal is remembered
 * per user in localStorage and forgotten again the moment the install has a
 * provider — so it comes back only if the state returns to keyless. Never on
 * cloud (`isCloud()` returns null before any fetch).
 */
const STORAGE_PREFIX = "nodaro:provider-callout-dismissed:"

interface ProvidersSlice {
  readonly checks?: { readonly providers?: { readonly ok?: boolean; readonly nodaroCloud?: boolean } }
}

export function ProviderSetupCallout({ userId }: { readonly userId: string | undefined }) {
  const [keyless, setKeyless] = useState<boolean | null>(null)
  const [dismissed, setDismissed] = useState<boolean>(false)
  const storageKey = userId ? `${STORAGE_PREFIX}${userId}` : null

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/v1/setup/status", { cache: "no-store" })
      if (!res.ok) return
      const json = (await res.json()) as ProvidersSlice
      const ok = json.checks?.providers?.ok === true
      setKeyless(!ok)
      // Providers exist now → forget the dismissal so a later keyless state
      // (key removed, connection revoked) surfaces the callout again.
      if (ok && storageKey) window.localStorage.removeItem(storageKey)
    } catch {
      /* transient — stay silent, never block the dashboard */
    }
  }, [storageKey])

  useEffect(() => {
    if (isCloud()) return
    if (storageKey) setDismissed(window.localStorage.getItem(storageKey) === "1")
    void refresh()
  }, [refresh, storageKey])

  if (isCloud() || keyless !== true || dismissed) return null

  const dismiss = () => {
    if (storageKey) window.localStorage.setItem(storageKey, "1")
    setDismissed(true)
  }

  return (
    <div
      role="status"
      data-testid="provider-setup-callout"
      className="mb-4 sm:mb-6 rounded-xl border border-[#ff0073]/40 bg-[#ff0073]/5 px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3"
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground">This install can&rsquo;t generate yet.</p>
        <p className="text-sm text-muted-foreground">
          Nodes need a model provider. Connect nodaro.ai in one click (no key, 1,500 free credits) — or paste your own
          provider key. Local keys always win.
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button asChild size="sm" className="bg-[#ff0073] hover:bg-[#e6006a] text-white gap-1.5">
          <Link to="/setup">
            <Cloud className="h-4 w-4" />
            Connect nodaro.ai
          </Link>
        </Button>
        <Button asChild size="sm" variant="outline" className="gap-1.5">
          <Link to="/integrations">
            <KeyRound className="h-4 w-4" />
            Paste a key
          </Link>
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-label="Dismiss"
          className="h-8 w-8 p-0 text-muted-foreground"
          onClick={dismiss}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
