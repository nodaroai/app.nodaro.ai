import { useQuery } from "@tanstack/react-query"
import { getBillingSurface } from "@/lib/api"
import { BILLING_SURFACE_DEFAULT, type BillingSurface } from "@/lib/billing-surface"

/**
 * The deployment billing surface (B2). Replaces scattered hasCredits()/isCloud()
 * gates in the cost/usage views: whether the Cost tab mounts, and the display
 * unit, both follow the registered provider. Deployment-level (no per-user
 * data) → cached long. Until it resolves we return the inert `none` default,
 * so the tab stays hidden with no flash (matches today's community default).
 */
export function useBillingSurface(): { surface: BillingSurface; isLoading: boolean } {
  const { data, isLoading } = useQuery({
    queryKey: ["billing", "surface"],
    queryFn: getBillingSurface,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  })
  return { surface: data ?? BILLING_SURFACE_DEFAULT, isLoading }
}
