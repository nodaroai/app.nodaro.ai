import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { resolveEffectiveTier } from "@nodaro/shared/credits"
import {
  getSubscription,
  getTransactions,
  getManageSubscriptionUrl,
  changePlan,
  getBillingPlans,
  BillingPlansError,
} from "@/lib/api"
import { createClient } from "@/lib/supabase"
import { hasCredits } from "@/lib/edition"
import { surfaceBillingSelfServe } from "@/lib/surface-selectors"
import { queryKeys } from "@/lib/query-keys"
import { invalidateBalance } from "@/ee/lib/invalidate-balance"
import { TIER_STORAGE_BYTES } from "@/lib/pricing-data"
import { useBillingSurface } from "@/hooks/use-billing-surface"
import { useCachedUserId } from "@/hooks/use-auth"

export function useSubscription(userId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.billing.subscription(userId ?? ""),
    queryFn: () => getSubscription(userId!),
    enabled: !!userId && hasCredits(),
    staleTime: 60_000,
  })
}

/**
 * The plans and packs this deployment sells, with their Stripe price ids
 * (`GET /v1/billing/plans`, public). A checkout sends only these ids
 * (ee/lib/plan-price-ids.ts), so a deployment on Stripe's test mode sells its
 * test prices. Asked only on Cloud and only `when` the caller is about to use
 * it: by default where the deployment sells to its users; a surface that is
 * mounted before it is shown (a dialog) passes `when: open`, and one that a
 * deployment's billing account may use where nobody else can buy (the pricing
 * page) asks for a signed-in visitor too, the server deciding by checkout's
 * rule.
 */
export function useBillingPlans(options: { readonly when?: boolean } = {}) {
  // Keyed by who is signed in: the answer can depend on it, and a sign-out clears no cache.
  const userId = useCachedUserId()
  return useQuery({
    queryKey: queryKeys.billing.plans(userId ?? ""),
    queryFn: () => getBillingPlans(),
    enabled: hasCredits() && (options.when ?? surfaceBillingSelfServe()),
    staleTime: 5 * 60_000,
    // A refusal (4xx) is the answer, never retried; a server or network failure is tried once more.
    retry: (failureCount: number, error: unknown) => !(error instanceof BillingPlansError && error.status < 500) && failureCount < 1,
  })
}

export function useTransactions(userId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.billing.transactions(userId ?? ""),
    queryFn: () => getTransactions(userId!),
    enabled: !!userId && hasCredits(),
    staleTime: 60_000,
  })
}

/** The signed-in user's storage use and limit. A `null` limit is no per-user ceiling. */
export interface StorageProfile {
  readonly storageUsed: number
  readonly storageLimit: number | null
}

/**
 * The signed-in user's storage use and limit. On a deployment with a payer,
 * media lives in the deployment's own bucket and no per-user ceiling is
 * enforced, so the limit is `null` there (decided 2026-11-08). A meter then
 * shows the usage, never a "space is running out" warning against the free
 * tier each user is stored at.
 */
export function useStorageProfile(userId: string | undefined): { data: StorageProfile | undefined } {
  const query = useQuery({
    queryKey: queryKeys.billing.storage(userId ?? ""),
    queryFn: async (): Promise<StorageProfile> => {
      const supabase = createClient()
      const { data } = await supabase
        .from("profiles")
        .select("storage_used_bytes, storage_limit_bytes, tier, subscription_tier, lifetime_topup_credits")
        .eq("id", userId!)
        .single()

      const tier = data
        ? resolveEffectiveTier({
            tier: (data.tier as string | null) ?? null,
            subscription_tier: (data.subscription_tier as string | null) ?? null,
            lifetime_topup_credits: (data.lifetime_topup_credits as number) ?? 0,
          })
        : "free"
      const dbLimit = (data?.storage_limit_bytes as number) ?? 0
      const tierLimit = TIER_STORAGE_BYTES[tier] ?? TIER_STORAGE_BYTES.free

      // Use tier-based limit when DB has no value or the stale 500MB default
      const storageLimit = dbLimit > 0 && dbLimit !== 524288000 ? dbLimit : tierLimit

      return {
        storageUsed: (data?.storage_used_bytes as number) ?? 0,
        storageLimit,
      }
    },
    enabled: !!userId && hasCredits(),
    staleTime: 30_000,
  })
  const { surface } = useBillingSurface()
  const data = query.data && surface.deploymentPayer === true ? { ...query.data, storageLimit: null } : query.data
  return { data }
}

export function useManageSubscriptionMutation() {
  return useMutation({
    mutationFn: (userId: string) => getManageSubscriptionUrl(userId),
  })
}

export function useChangePlanMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ userId, priceId }: { userId: string; priceId: string }) =>
      changePlan(userId, priceId),
    onSuccess: (_data, { userId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.billing.subscription(userId) })
      void invalidateBalance(qc, userId)
      qc.invalidateQueries({ queryKey: queryKeys.billing.storage(userId) })
      qc.invalidateQueries({ queryKey: queryKeys.userSettings.detail(userId) })
    },
  })
}
