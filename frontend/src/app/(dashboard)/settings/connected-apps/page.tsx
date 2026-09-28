import { useState } from "react"
import { Link } from "react-router-dom"
import { ArrowLeft, Loader2, Plug } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { cn } from "@/lib/utils"
import { useT, labelOf, type MessageKey } from "@/lib/i18n"
import { useAppDir } from "@/lib/locale-store"
import { formatDate } from "@/lib/i18n/format"
import type { ConnectedApp } from "@/lib/api"
import { useConnectedApps, useRevokeConnectedAppMutation } from "@/hooks/queries/use-connected-apps-queries"

/** How each kind of grant reads. An MCP client that registered itself chose
 *  its own name, so the row says so — the same caution the consent screen
 *  shows before the grant. */
const KIND_LABEL: Record<"user" | "first_party_mcp" | "dynamic_mcp" | "community_instance", MessageKey> = {
  user: "connApps.kindUser",
  first_party_mcp: "connApps.kindNodaroMcp",
  dynamic_mcp: "connApps.kindMcp",
  community_instance: "connApps.kindInstance",
}

/**
 * Settings → Connected apps: every app the user let into their account
 * through OAuth, and the button that takes the access back. Revoking ends the
 * grant and every token issued under it at once.
 */
export default function ConnectedAppsPage() {
  const t = useT()
  const isRtl = useAppDir() === "rtl"
  const { data: apps, isLoading } = useConnectedApps()
  const revoke = useRevokeConnectedAppMutation()
  const [confirming, setConfirming] = useState<ConnectedApp | null>(null)

  const nameOf = (app: ConnectedApp) => app.name?.trim() || t("connApps.unnamed")

  const handleRevoke = async () => {
    if (!confirming) return
    try {
      await revoke.mutateAsync(confirming.authorizationId)
      toast.success(t("connApps.revoked"))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("apiErr.revokeConnectedApp"))
    } finally {
      setConfirming(null)
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="flex items-center gap-3 mb-6">
        <Link to="/settings" className="text-muted-foreground hover:text-foreground transition-colors" aria-label={t("common.back")}>
          <ArrowLeft className={cn("h-5 w-5", isRtl && "rotate-180")} />
        </Link>
        <div>
          <h1 className="text-2xl font-bold">{t("connApps.title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t("connApps.subtitle")}</p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (apps ?? []).length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 p-8 text-center">
          <Plug className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">{t("connApps.empty")}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {(apps ?? []).map((app) => (
            <div key={app.authorizationId} className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-card p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-sm">{nameOf(app)}</span>
                    <span className="text-xs text-muted-foreground">{labelOf(KIND_LABEL, app.kind, t)}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 mt-1 text-xs text-muted-foreground">
                    <span>{t("connApps.connected", { date: formatDate(app.connectedAt) })}</span>
                    <span>{app.lastUsedAt ? t("connApps.lastUsed", { date: formatDate(app.lastUsedAt) }) : t("connApps.neverUsed")}</span>
                  </div>
                  {app.scopes.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 mt-2">
                      <span className="text-xs text-muted-foreground">{t("connApps.access")}</span>
                      {app.scopes.map((scope) => (
                        <code key={scope} dir="ltr" className="text-[11px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-muted-foreground font-mono">
                          {scope}
                        </code>
                      ))}
                    </div>
                  )}
                </div>
                <Button variant="outline" size="sm" className="shrink-0 hover:text-red-500" onClick={() => setConfirming(app)}>
                  {t("connApps.revoke")}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <AlertDialog open={confirming !== null} onOpenChange={(open) => { if (!open) setConfirming(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirming ? t("connApps.revokeTitle", { name: nameOf(confirming) }) : ""}</AlertDialogTitle>
            <AlertDialogDescription>{t("connApps.revokeDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleRevoke()} disabled={revoke.isPending} className="bg-red-600 hover:bg-red-700 text-white">
              {t("connApps.revoke")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
