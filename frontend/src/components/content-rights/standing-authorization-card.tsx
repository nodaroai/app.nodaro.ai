"use client"

/**
 * Settings → "Imports through API keys and AI agents": the standing
 * authorization of the content rights declaration. A key or an agent cannot
 * tick the box a link import shows, so the person authorizes those imports
 * once here, for the declaration as it reads now, and takes it back here.
 *
 * The card shows the current state (authorized under the current declaration,
 * or not), the declaration's text behind the same box every link import shows,
 * and one button. The box starts unticked on every visit: a tick is the act,
 * never a remembered state, exactly like the box on a link.
 */
import { useState } from "react"
import { ShieldCheck } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { RightsDeclarationBox } from "@/components/content-rights/rights-declaration-box"
import { DeclarationChangedError, loadDeclaration, reloadDeclaration } from "@/lib/content-rights"
import { formatDate } from "@/lib/i18n/format"
import { useT } from "@/lib/i18n"
import { useAuthorizeImportsMutation, useRevokeImportsAuthorizationMutation, useStandingAuthorization } from "@/hooks/queries/use-content-rights-queries"

function isStale(err: unknown): boolean {
  return err instanceof DeclarationChangedError || (typeof err === "object" && err !== null && (err as { code?: unknown }).code === "rights_confirmation_stale")
}

export function StandingAuthorizationCard() {
  const t = useT()
  const { data: authorization, isLoading } = useStandingAuthorization()
  const authorize = useAuthorizeImportsMutation()
  const revoke = useRevokeImportsAuthorizationMutation()
  const [ticked, setTicked] = useState(false)

  const handleAuthorize = async () => {
    try {
      const declaration = await loadDeclaration()
      await authorize.mutateAsync(declaration.version)
      setTicked(false)
      toast.success(t("contentRights.authorized"))
    } catch (err) {
      if (isStale(err)) {
        reloadDeclaration()
        setTicked(false)
        toast.error(t("contentRights.declarationChanged"))
        return
      }
      toast.error(err instanceof Error ? err.message : t("contentRights.authorizeFailed"))
    }
  }

  const handleRevoke = async () => {
    try {
      await revoke.mutateAsync()
      toast.success(t("contentRights.revoked"))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("contentRights.revokeFailed"))
    }
  }

  const busy = authorize.isPending || revoke.isPending

  return (
    <div className="mt-6 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-card p-6">
      <div className="flex items-center gap-3">
        <ShieldCheck className="h-5 w-5 text-muted-foreground" />
        <div>
          <h2 className="text-base font-semibold">{t("contentRights.cardTitle")}</h2>
          <p className="text-sm text-muted-foreground mt-0.5">{t("contentRights.cardDesc")}</p>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-3">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : authorization ? (
          <>
            <p className="text-sm" data-testid="standing-authorization-state">
              {t("contentRights.authorizedSince", { date: formatDate(authorization.createdAt) })}
            </p>
            <div>
              <Button variant="outline" size="sm" onClick={handleRevoke} disabled={busy}>
                {t("contentRights.revoke")}
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground" data-testid="standing-authorization-state">
              {t("contentRights.notAuthorized")}
            </p>
            <RightsDeclarationBox checked={ticked} disabled={busy} onCheckedChange={setTicked} textClass="text-sm" label={t("contentRights.confirmForKeys")} />
            <div>
              <Button size="sm" onClick={handleAuthorize} disabled={!ticked || busy}>
                {t("contentRights.authorize")}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
