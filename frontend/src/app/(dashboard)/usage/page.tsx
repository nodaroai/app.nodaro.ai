import { Loader2 } from "lucide-react"
import { useT } from "@/lib/i18n"
import { useBillingSurface } from "@/hooks/use-billing-surface"
import { useBillingAccount } from "@/hooks/use-billing-account"
import { BillingAccountSummary } from "@/components/billing/billing-account-summary"

/**
 * Generic per-user usage view (B2 `account()`). Data-driven: it renders
 * whatever rich fields the registered provider supplied and nothing for the
 * fields it omitted. Gated on the deployment surface's `canAccount`, so a
 * `none` deployment shows no billing data. A null account (authority
 * unavailable) renders a distinct "unavailable" state — never zeros.
 */
export default function UsagePage() {
  const t = useT()
  const { surface, isLoading: surfaceLoading } = useBillingSurface()
  const { account, isLoading, isError } = useBillingAccount(surface.canAccount)

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">{t("usage.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("usage.subtitle")}</p>
      </div>

      {surfaceLoading || isLoading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : isError ? (
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-card p-6 text-sm text-muted-foreground">
          {t("usage.loadError")}
        </div>
      ) : !surface.canAccount ? (
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-card p-6 text-sm text-muted-foreground">
          {t("usage.empty")}
        </div>
      ) : account ? (
        <BillingAccountSummary account={account} />
      ) : (
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-card p-5">
          <div className="text-sm text-muted-foreground">{t("usage.spent")}</div>
          <div className="mt-1 text-3xl font-bold" style={{ color: "#ff0073" }}>{t("usage.unavailable")}</div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{t("usage.unavailableNote")}</p>
        </div>
      )}
    </div>
  )
}
