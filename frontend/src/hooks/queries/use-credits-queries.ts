import { useQuery } from "@tanstack/react-query"
import { getUserCredits, getModelCreditCost, type UserBalance } from "@/lib/api"
import { hasCredits } from "@/lib/edition"
import { queryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"

export function useUserCredits(userId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.credits.balance(userId ?? ""),
    queryFn: async () => {
      const result = await getUserCredits(userId!)
      const data = result.data ?? (result as unknown as UserBalance)
      return data
    },
    enabled: !!userId && hasCredits(),
    refetchInterval: 30_000,
    staleTime: 30_000,
  })
}

export function useModelCreditCost(model: string | undefined) {
  return useQuery({
    queryKey: queryKeys.credits.modelCost(model ?? ""),
    queryFn: async () => {
      const { data } = await getModelCreditCost(model!)
      return data.creditCost
    },
    enabled: !!model && hasCredits(),
    staleTime: Infinity,
    gcTime: 30 * 60_000,
  })
}

export function getCachedCredits(model: string): number | undefined {
  return queryClient.getQueryData<number>(queryKeys.credits.modelCost(model))
}

export async function prefetchModelCredits(models: string[]): Promise<void> {
  if (!hasCredits()) return
  await Promise.allSettled(
    models.map((model) =>
      queryClient.prefetchQuery({
        queryKey: queryKeys.credits.modelCost(model),
        queryFn: async () => {
          const { data } = await getModelCreditCost(model)
          return data.creditCost
        },
        staleTime: Infinity,
      }),
    ),
  )
}
