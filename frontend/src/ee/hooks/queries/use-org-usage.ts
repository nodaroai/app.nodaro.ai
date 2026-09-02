import { useQuery, keepPreviousData, type UseQueryResult } from "@tanstack/react-query"
import type { OrgPage, UsageLogEntry, UsageReport } from "@nodaro/shared"
import {
  getOrgUsage,
  getWorkspaceUsage,
  listOrgUsageRows,
  listWorkspaceUsageRows,
  OrgApiError,
} from "@/ee/lib/orgs-api"
import { hasOrganizations } from "@/lib/edition"
import { queryKeys } from "@/lib/query-keys"

/**
 * The usage data seam (X-09). P16 mounts a card on these hooks; nothing here
 * renders. `tz` defaults to the browser's zone (the school's local days).
 *
 * A 4xx OR 5xx OrgApiError is a STATE the card renders, never a flake — a 503
 * `billing_unavailable` means "reports are not available yet" and must show at
 * once, so it is not retried (matching the orgs console's `retry: false`). Only
 * a transport failure (no OrgApiError) retries, and only a bounded number of
 * times.
 */
export interface UsageParams {
  from?: string
  to?: string
  tz?: string
  groupBy?: "workspace" | "member" | "model" | "day"
  workspaceId?: string
  userId?: string
}

/** Rows can set a page size; the SQL clamps it to [1, 1000]. */
type RowsParams = Omit<UsageParams, "groupBy"> & { limit?: number }

const browserTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone

const retryTransportOnly = (count: number, err: unknown) => !(err instanceof OrgApiError) && count < 2

function keyParams(p: {
  from?: string
  to?: string
  tz: string
  groupBy?: string
  workspaceId?: string
  userId?: string
  limit?: number
}): Record<string, string | number | undefined> {
  return { from: p.from, to: p.to, tz: p.tz, groupBy: p.groupBy, workspaceId: p.workspaceId, userId: p.userId, limit: p.limit }
}

export function useOrgUsage(orgId: string | undefined, params: UsageParams): UseQueryResult<UsageReport, OrgApiError> {
  const tz = params.tz ?? browserTz()
  return useQuery<UsageReport, OrgApiError>({
    queryKey: queryKeys.orgs.usage(orgId ?? "", keyParams({ ...params, tz })),
    queryFn: () => getOrgUsage(orgId!, { ...params, tz }),
    enabled: !!orgId && hasOrganizations(),
    staleTime: 60_000,
    retry: retryTransportOnly,
  })
}

export function useWorkspaceUsage(
  workspaceId: string | undefined,
  params: Omit<UsageParams, "workspaceId" | "groupBy"> & { groupBy?: "member" | "model" | "day" },
): UseQueryResult<UsageReport, OrgApiError> {
  const tz = params.tz ?? browserTz()
  return useQuery<UsageReport, OrgApiError>({
    queryKey: queryKeys.orgs.workspaceUsage(workspaceId ?? "", keyParams({ ...params, tz })),
    queryFn: () => getWorkspaceUsage(workspaceId!, { ...params, tz }),
    enabled: !!workspaceId && hasOrganizations(),
    staleTime: 60_000,
    retry: retryTransportOnly,
  })
}

export function useOrgUsageRows(
  orgId: string | undefined,
  params: RowsParams,
  cursor?: string,
): UseQueryResult<OrgPage<UsageLogEntry>, OrgApiError> {
  const tz = params.tz ?? browserTz()
  return useQuery<OrgPage<UsageLogEntry>, OrgApiError>({
    queryKey: queryKeys.orgs.usageRows(orgId ?? "", keyParams({ ...params, tz }), cursor),
    queryFn: () => listOrgUsageRows(orgId!, { ...params, tz, cursor }),
    enabled: !!orgId && hasOrganizations(),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    retry: retryTransportOnly,
  })
}

export function useWorkspaceUsageRows(
  workspaceId: string | undefined,
  params: Omit<RowsParams, "workspaceId">,
  cursor?: string,
): UseQueryResult<OrgPage<UsageLogEntry>, OrgApiError> {
  const tz = params.tz ?? browserTz()
  return useQuery<OrgPage<UsageLogEntry>, OrgApiError>({
    queryKey: queryKeys.orgs.workspaceUsageRows(workspaceId ?? "", keyParams({ ...params, tz }), cursor),
    queryFn: () => listWorkspaceUsageRows(workspaceId!, { ...params, tz, cursor }),
    enabled: !!workspaceId && hasOrganizations(),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    retry: retryTransportOnly,
  })
}
