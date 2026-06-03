import { useQuery, type UseQueryOptions } from "@tanstack/react-query"
import { getStats } from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"

type StatsData = Awaited<ReturnType<typeof getStats>>["data"]

export function useStats(
  scope: "user" | "platform",
  userId: string | undefined,
  // Callback form supported so callers can gate polling on local activity
  // (return `false` to stop, a number of ms to keep polling).
  options?: { refetchInterval?: UseQueryOptions<StatsData>["refetchInterval"] },
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
