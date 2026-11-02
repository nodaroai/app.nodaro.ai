import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { getAuthHeaders } from "@/lib/api"
import { isCloud } from "@/lib/edition"
import { queryKeys } from "@/lib/query-keys"
import type { HeaderVersionsReport } from "./types"

async function fetchReport(fresh: boolean): Promise<HeaderVersionsReport> {
  const res = await fetch(`/v1/admin/header-versions${fresh ? "?fresh=1" : ""}`, { headers: await getAuthHeaders() })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: unknown } } | null
    throw new Error(typeof body?.error?.message === "string" ? body.error.message : "Failed to load header versions")
  }
  return (await res.json()) as HeaderVersionsReport
}

/** Once a minute while the tab is in view; the server builds one answer a minute for every admin. */
export const HEADER_VERSIONS_POLLING = { refetchInterval: 60_000, refetchIntervalInBackground: false } as const

export function useHeaderVersions() {
  return useQuery({
    queryKey: queryKeys.admin.headerVersions(),
    queryFn: () => fetchReport(false),
    enabled: isCloud(),
    staleTime: 30_000,
    ...HEADER_VERSIONS_POLLING,
  })
}

/** Asks past the server's kept answer (it still answers the last 15 seconds' one). */
export function useRefreshHeaderVersions() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => fetchReport(true),
    onSuccess: (report) => queryClient.setQueryData(queryKeys.admin.headerVersions(), report),
  })
}
