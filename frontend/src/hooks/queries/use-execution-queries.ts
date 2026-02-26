import { useQuery } from "@tanstack/react-query"
import { listAllExecutions, type GlobalExecution } from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"

interface UseGlobalExecutionsOpts {
  cursor?: string
  status?: string
  viewAll?: boolean
  enabled?: boolean
}

export function useGlobalExecutions(opts: UseGlobalExecutionsOpts = {}) {
  const { cursor, status, viewAll, enabled = true } = opts

  return useQuery<{ data: GlobalExecution[]; nextCursor?: string }>({
    queryKey: queryKeys.executions.list({ status, viewAll, cursor }),
    queryFn: () => listAllExecutions({ limit: 20, cursor, status, viewAll }),
    enabled,
    refetchInterval: 15_000,
  })
}
