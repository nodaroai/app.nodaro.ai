import { useEffect, useState } from "react"
import { Mail } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { fetchConsentStatus, grantConsent, withdrawConsent, SOURCE_APP } from "./consent-api"

/**
 * Settings opt-in/out for marketing email. Reads the current status read-only
 * (GET /v1/consent/status never stamps a show) and lets the user subscribe /
 * unsubscribe. Cloud-only: mounted through `ConsentSettingsSlot` behind
 * `hasCredits()`. Renders nothing until the status resolves.
 */
export function ConsentSettings() {
  const [subscribed, setSubscribed] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    void fetchConsentStatus().then((s) => {
      if (!cancelled) setSubscribed(s.subscribed)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (subscribed === null) return null

  async function toggle(next: boolean) {
    if (saving) return
    const prev = subscribed
    setSaving(true)
    setSubscribed(next) // optimistic
    try {
      if (next) await grantConsent(SOURCE_APP)
      else await withdrawConsent()
    } catch {
      setSubscribed(prev) // revert on failure
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-6 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-card p-6">
      <div className="flex items-center gap-2 mb-4">
        <Mail className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-base font-semibold">Email preferences</h2>
      </div>
      <div className="flex items-center justify-between">
        <div className="pr-4">
          <Label htmlFor="marketing-email">Product update emails</Label>
          <p className="text-xs text-muted-foreground mt-0.5">
            Occasional emails about new features. You can change this any time.
          </p>
        </div>
        <Switch id="marketing-email" checked={subscribed} disabled={saving} onCheckedChange={toggle} />
      </div>
    </div>
  )
}
