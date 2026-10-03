import { useQuery } from "@tanstack/react-query"
import { AlertTriangle } from "lucide-react"
import { getProviderAlerts } from "@/ee/lib/provider-alerts-api"
import { cn } from "@/lib/utils"

/**
 * Provider alerts across the top of every admin page: a provider account
 * that is running low, is empty or refused our key. Nobody watches those
 * dashboards daily, and this banner is the only notice the product gives
 * (there is no push channel), so it stays until the cause is fixed.
 */
export function ProviderAlertsBanner({ enabled }: { readonly enabled: boolean }) {
  const { data: alerts = [] } = useQuery({
    queryKey: ["admin", "provider-alerts"],
    queryFn: getProviderAlerts,
    enabled,
    // A server without the route answers none; a failure must not retry-storm
    // the admin chrome on every page.
    retry: false,
    refetchInterval: 5 * 60_000,
    staleTime: 60_000,
  })
  if (alerts.length === 0) return null
  return (
    <div className="flex flex-col gap-2 border-b border-border px-4 py-3" role="alert">
      {alerts.map((alert) => (
        <div
          key={alert.id}
          className={cn(
            "flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm",
            alert.severity === "error"
              ? "border-destructive/40 bg-destructive/10 text-destructive"
              : "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300",
          )}
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="font-semibold">{alert.title}</p>
            <p className="text-xs opacity-90">{alert.action}</p>
          </div>
        </div>
      ))}
    </div>
  )
}
