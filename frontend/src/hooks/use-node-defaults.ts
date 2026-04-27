import { useQuery } from "@tanstack/react-query"
import { fetchNodeDefaults } from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"

export function useNodeDefaults() {
  return useQuery({
    queryKey: queryKeys.nodeDefaults.all,
    queryFn: fetchNodeDefaults,
    staleTime: 30_000,
  })
}
