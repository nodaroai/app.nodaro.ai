import { useCallback } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import { listHttpCredentials, type HttpCredentialSummary } from "@/lib/api"
import { useReadOnlyCanvas } from "@/components/nodes/read-only-canvas-context"

const NONE: ReadonlyArray<HttpCredentialSummary> = []

/**
 * The caller's stored HTTP credentials (Integrations → Credentials) — the list
 * a Webhook Output node picks from. One React Query entry shared by every
 * open config panel and the Integrations card, so a workflow with several
 * webhook nodes reads the list once; `refresh()` invalidates it after a write.
 */
export function useHttpCredentials(enabled = true) {
  const qc = useQueryClient()
  // A view-only canvas may be open to someone signed out; the credentials are the owner's.
  const readOnly = useReadOnlyCanvas()
  const query = useQuery({
    queryKey: queryKeys.httpCredentials.list(),
    queryFn: async () => {
      const res = await listHttpCredentials()
      return res.data
    },
    enabled: enabled && !readOnly,
    staleTime: 30_000,
  })
  const refresh = useCallback(
    () => qc.invalidateQueries({ queryKey: queryKeys.httpCredentials.all }),
    [qc],
  )
  return {
    credentials: query.data ?? NONE,
    loading: query.isLoading,
    error: query.error ? (query.error instanceof Error ? query.error.message : "Failed to load credentials") : null,
    refresh,
  }
}
