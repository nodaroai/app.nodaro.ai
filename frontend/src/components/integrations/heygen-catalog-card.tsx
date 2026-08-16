"use client"

import { useCallback, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Loader2, RefreshCw, Users } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/hooks/use-auth"
import { hasAdmin } from "@/lib/edition"
import { refreshHeygenCatalog, type HeygenCatalogRefreshResponse } from "@/lib/api"
import {
  HEYGEN_AVATARS_QUERY_KEY,
  HEYGEN_PRIVATE_AVATARS_QUERY_KEY,
  HEYGEN_VOICES_QUERY_KEY,
} from "@/components/heygen/heygen-catalog"

/**
 * "HeyGen avatar catalog" on Integrations — the operator's manual refresh.
 *
 * The avatar / voice lists the pickers show are cached on the server (shared
 * through Redis, refreshed once a day; the account's own looks every couple of
 * minutes). This card refetches them from HeyGen NOW — for the day HeyGen adds
 * presets you want before tomorrow, or a catalog that looks wrong. Rendered
 * only for people the server lets press it: any signed-in user on community
 * (single operator), admins where the edition has admins.
 */

/** One line per outcome, in the operator's words. */
export function describeRefresh(r: HeygenCatalogRefreshResponse): string {
  if (r.mode === "connection") return "This install lists what nodaro.ai can render — its copy was forgotten and will be pulled fresh on the next pick."
  const parts: string[] = []
  const say = (what: string, outcome: HeygenCatalogRefreshResponse["avatars"]) => {
    switch (outcome) {
      case "started": parts.push(`${what}: refreshing in the background`); break
      case "already-running": parts.push(`${what}: a refresh is already running here`); break
      case "locked-elsewhere": parts.push(`${what}: another server is refreshing it right now`); break
      case "adopted": parts.push(`${what}: a newer shared list already existed — taken as-is`); break
      case "unconfigured": parts.push(`${what}: no HeyGen key on this install`); break
      case "relay-reset": parts.push(`${what}: forgotten, re-pulled on the next pick`); break
    }
  }
  say("Presets", r.avatars)
  say("Your own looks", r.privateAvatars)
  say("Voices", r.voices)
  return parts.join(" · ")
}

export function HeygenCatalogCard() {
  const { isAdmin, roleLoaded } = useAuth()
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [lastResult, setLastResult] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setBusy(true)
    try {
      const r = await refreshHeygenCatalog()
      const text = describeRefresh(r)
      setLastResult(text)
      // This tab's cached lists are now suspect: the next picker to open asks
      // the server again (a cheap delta while the same generation is served,
      // the whole new list once the refresh has landed).
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: HEYGEN_AVATARS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: HEYGEN_PRIVATE_AVATARS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: HEYGEN_VOICES_QUERY_KEY }),
      ])
      toast.success("HeyGen catalog refresh requested", { description: text })
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to refresh the HeyGen catalog"
      setLastResult(null)
      toast.error(message)
    } finally {
      setBusy(false)
    }
  }, [queryClient])

  // Where the edition has admins, only they may refresh (the server enforces
  // it too) — do not show non-admins a button that 403s.
  if (hasAdmin() && (!roleLoaded || !isAdmin)) return null

  return (
    <section
      aria-labelledby="heygen-catalog-heading"
      className="mb-6 rounded-xl border border-gray-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1E1E1E] p-5 flex flex-col gap-3"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#ff0073]/10 text-[#ff0073]">
          <Users className="h-6 w-6" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 id="heygen-catalog-heading" className="font-semibold text-gray-900 dark:text-white text-sm">
            HeyGen avatar catalog
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            The avatar and voice lists the AI Avatar pickers show are cached on this server and refreshed from HeyGen
            once a day; your own looks every couple of minutes. Refresh now to pull HeyGen&apos;s current lists at once —
            the fill takes about two minutes, and pickers show the new lists the next time they open.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={busy} className="shrink-0">
          {busy ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
          Refresh now
        </Button>
      </div>
      {lastResult && (
        <p className="text-[11px] text-gray-500 dark:text-gray-400" data-testid="heygen-catalog-refresh-result">
          {lastResult}
        </p>
      )}
    </section>
  )
}
