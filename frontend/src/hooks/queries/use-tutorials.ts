// Public dashboard hook for the unified Tutorials tab.
// Calls GET /v1/tutorials which returns categories pre-grouped with video and
// flow items in each bucket. Skip-auth: anonymous users can browse the
// tutorials too.

import { useQuery } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import { fetchTutorialsGrouped } from "@/lib/api"

export function useTutorialsGrouped() {
  return useQuery({
    queryKey: queryKeys.tutorials.grouped(),
    queryFn: fetchTutorialsGrouped,
    staleTime: 60_000,
  })
}
