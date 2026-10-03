"use client"

import { useCallback, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Loader2, RefreshCw, Users } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/hooks/use-auth"
import { hasAdmin } from "@/lib/edition"
import { useT, tx } from "@/lib/i18n"
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
  if (r.mode === "connection") return tx("integ.heygenRefreshRelay")
  const parts: string[] = []
  const say = (what: string, outcome: HeygenCatalogRefreshResponse["avatars"]) => {
    switch (outcome) {
      case "started": parts.push(tx("integ.heygenOutcomeStarted", { what })); break
      case "already-running": parts.push(tx("integ.heygenOutcomeRunning", { what })); break
      case "locked-elsewhere": parts.push(tx("integ.heygenOutcomeLocked", { what })); break
      case "adopted": parts.push(tx("integ.heygenOutcomeAdopted", { what })); break
      case "unconfigured": parts.push(tx("integ.heygenOutcomeUnconfigured", { what })); break
      case "relay-reset": parts.push(tx("integ.heygenOutcomeRelayReset", { what })); break
    }
  }
  say(tx("integ.heygenPresets"), r.avatars)
  say(tx("integ.heygenOwnLooks"), r.privateAvatars)
  say(tx("integ.heygenVoices"), r.voices)
  return parts.join(" · ")
}

export function HeygenCatalogCard() {
  const { isAdmin, roleLoaded } = useAuth()
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [lastResult, setLastResult] = useState<string | null>(null)
  const t = useT()

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
      toast.success(tx("integ.heygenRefreshRequested"), { description: text })
    } catch (err) {
      const message = err instanceof Error ? err.message : tx("integ.heygenRefreshFailed")
      setLastResult(null)
      toast.error(message)
    } finally {
      setBusy(false)
    }
  }, [queryClient])

  // Where the edition has admins, only they may refresh (the server enforces
  // it too) — do not show non-admins a button that 403s.
  if (hasAdmin() && (!roleLoaded || !isAdmin)) return null

  // A sibling card to the credentials one, in whichever theme is on. The
  // handoff draws this panel near-black even on the light page, to mark it as
  // maintenance rather than content — but a dark slab in the middle of a light
  // page reads as a different app, not a different category. The CACHE eyebrow
  // and the muted body carry that distinction instead.
  return (
    <section
      aria-labelledby="heygen-catalog-heading"
      className="flex flex-col gap-4 rounded-[16px] border p-5"
      style={{ borderColor: "var(--integ-line)", background: "var(--integ-surface)", color: "var(--integ-fg)" }}
    >
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2.5">
          <Users className="h-3.5 w-3.5" style={{ color: "var(--integ-muted)" }} aria-hidden />
          <span className="text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color: "var(--integ-muted)" }}>
            {t("integ.cacheEyebrow")}
          </span>
        </div>
        <h3 id="heygen-catalog-heading" className="text-[15px] font-bold tracking-[-0.01em]">
          {t("integ.heygenCatalogTitle")}
        </h3>
        {/* Deliberately not "synced 4h ago" as the handoff shows: the refresh
            endpoint returns no timestamp, and a made-up one is worse than
            none on a card whose whole job is telling you how stale a list is. */}
        <p className="text-[12.5px] leading-[1.55] text-pretty" style={{ color: "var(--integ-muted)" }}>
          {t("integ.heygenCatalogDesc")}
        </p>
      </div>

      {lastResult && (
        <p
          className="text-[11px] leading-[1.5]"
          style={{ color: "var(--integ-muted)" }}
          data-testid="heygen-catalog-refresh-result"
        >
          {lastResult}
        </p>
      )}

      <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={busy} className="h-9 w-full shrink-0">
        {busy ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="me-1.5 h-3.5 w-3.5" />}
        {t("integ.refreshNow")}
      </Button>
    </section>
  )
}
