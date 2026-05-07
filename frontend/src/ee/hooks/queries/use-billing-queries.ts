import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  getSubscription,
  getTransactions,
  getManageSubscriptionUrl,
  changePlan,
} from "@/lib/api"
import { createClient } from "@/lib/supabase"
import { hasCredits } from "@/lib/edition"
import { queryKeys } from "@/lib/query-keys"
import { TIER_STORAGE_BYTES } from "@/lib/pricing-data"

export function useSubscription(userId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.billing.subscription(userId ?? ""),
    queryFn: () => getSubscription(userId!),
    enabled: !!userId && hasCredits(),
    staleTime: 60_000,
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

export function useStorageProfile(userId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.billing.storage(userId ?? ""),
    queryFn: async () => {
      const supabase = createClient()
      const { data } = await supabase
        .from("profiles")
        .select("storage_used_bytes, storage_limit_bytes, tier")
        .eq("id", userId!)
        .single()

      const tier = (data?.tier as string) ?? "free"
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
      qc.invalidateQueries({ queryKey: queryKeys.credits.balance(userId) })
      qc.invalidateQueries({ queryKey: queryKeys.billing.storage(userId) })
      qc.invalidateQueries({ queryKey: queryKeys.userSettings.detail(userId) })
    },
  })
}
