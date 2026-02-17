import { useQuery } from "@tanstack/react-query"
import { getStats } from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"

export function useStats(
  scope: "user" | "platform",
  userId: string | undefined,
  options?: { refetchInterval?: number },
) {
  return useQuery({
    queryKey: queryKeys.stats.scoped(scope, userId ?? ""),
    queryFn: async () => {
      const { data } = await getStats(scope, userId)
      return data
    },
    enabled: !!userId,
    staleTime: 10_000,
    refetchInterval: options?.refetchInterval,
  })
}
