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
 * The P15 usage data seam (X-09). P16 mounts a card on these hooks; nothing
 * here renders. `tz` defaults to the browser's zone (the school's local days).
 * A 403/404/400 is a STATE, not a flake — only a real 5xx retries.
 */
export interface UsageParams {
  from?: string
  to?: string
  tz?: string
  groupBy?: "workspace" | "member" | "model" | "day"
  workspaceId?: string
  userId?: string
}

const browserTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone

const retryNon5xx = (_count: number, err: unknown) => !(err instanceof OrgApiError && err.status < 500)

function keyParams(p: { from?: string; to?: string; tz: string; groupBy?: string; workspaceId?: string; userId?: string }): Record<string, string | number | undefined> {
  return { from: p.from, to: p.to, tz: p.tz, groupBy: p.groupBy, workspaceId: p.workspaceId, userId: p.userId }
}

export function useOrgUsage(orgId: string | undefined, params: UsageParams): UseQueryResult<UsageReport, OrgApiError> {
  const tz = params.tz ?? browserTz()
  return useQuery<UsageReport, OrgApiError>({
    queryKey: queryKeys.orgs.usage(orgId ?? "", keyParams({ ...params, tz })),
    queryFn: () => getOrgUsage(orgId!, { ...params, tz }),
    enabled: !!orgId && hasOrganizations(),
    staleTime: 60_000,
    retry: retryNon5xx,
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
    retry: retryNon5xx,
  })
}

export function useOrgUsageRows(
  orgId: string | undefined,
  params: Omit<UsageParams, "groupBy">,
  cursor?: string,
): UseQueryResult<OrgPage<UsageLogEntry>, OrgApiError> {
  const tz = params.tz ?? browserTz()
  return useQuery<OrgPage<UsageLogEntry>, OrgApiError>({
    queryKey: queryKeys.orgs.usageRows(orgId ?? "", keyParams({ ...params, tz }), cursor),
    queryFn: () => listOrgUsageRows(orgId!, { ...params, tz, cursor }),
    enabled: !!orgId && hasOrganizations(),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    retry: retryNon5xx,
  })
}

export function useWorkspaceUsageRows(
  workspaceId: string | undefined,
  params: Omit<UsageParams, "groupBy" | "workspaceId">,
  cursor?: string,
): UseQueryResult<OrgPage<UsageLogEntry>, OrgApiError> {
  const tz = params.tz ?? browserTz()
  return useQuery<OrgPage<UsageLogEntry>, OrgApiError>({
    queryKey: queryKeys.orgs.workspaceUsageRows(workspaceId ?? "", keyParams({ ...params, tz }), cursor),
    queryFn: () => listWorkspaceUsageRows(workspaceId!, { ...params, tz, cursor }),
    enabled: !!workspaceId && hasOrganizations(),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    retry: retryNon5xx,
  })
}
