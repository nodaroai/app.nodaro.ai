import { useQuery } from "@tanstack/react-query"
import type { EntityStatus, EntityType } from "@nodaro/shared"
import { getAuthHeaders } from "@/lib/api"

export interface PipelineEntityVariant {
  variant_key: string
  asset_id: string | null
  asset_url: string | null
  status: string
}

export interface PipelineEntity {
  id: string
  entity_type: EntityType
  entity_key: string
  status: EntityStatus
  main_asset_id: string | null
  main_asset_url: string | null
  metadata: Record<string, unknown> | null
  variants: PipelineEntityVariant[]
}

// Same proxy convention as the rest of the frontend: same-origin relative paths
// under /v1/* are forwarded to the backend by the Vite dev server and the Caddy
// reverse proxy in production. See frontend/src/lib/api.ts.
const API_BASE = ""

export function usePipelineEntities(
  pipelineId: string | undefined,
  entityType: EntityType,
): {
  data: PipelineEntity[] | undefined
  isLoading: boolean
  refetch: () => void
} {
  const query = useQuery({
    queryKey: ["pipeline-entities", pipelineId, entityType],
    queryFn: async () => {
      if (!pipelineId) return []
      const res = await fetch(
        `${API_BASE}/v1/pipelines/${pipelineId}/entities?type=${entityType}`,
        {
          credentials: "include",
          headers: { ...(await getAuthHeaders()) },
        },
      )
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`)
      return (await res.json()) as PipelineEntity[]
    },
    enabled: !!pipelineId,
    // Poll only while anything is mid-flight. When every row has settled
    // (approved / awaiting_approval / failed), stop polling — the panel's
    // SSE hook still triggers a refetch on the next status transition.
    refetchInterval: (q) => {
      const rows = q.state.data
      if (!rows || rows.length === 0) return 5000
      const allSettled = rows.every((r) =>
        ["approved", "awaiting_approval", "failed"].includes(r.status),
      )
      return allSettled ? false : 5000
    },
  })
  return {
    data: query.data,
    isLoading: query.isLoading,
    refetch: () => void query.refetch(),
  }
}
