import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { getAuthHeaders } from "@/lib/api"
import { hasAdmin } from "@/lib/edition"
import { queryKeys } from "@/lib/query-keys"
import type { IndexStatus, OnlineUsersReport, RealtimeSnapshot, SectionResult, SiteAnalyticsDays, SiteAnalyticsReport } from "./types"

/** The server's reason, or a plain one when it sent none. */
async function failureMessage(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: { message?: unknown } } | null
  return typeof body?.error?.message === "string" ? body.error.message : fallback
}

async function fetchReport(days: SiteAnalyticsDays, fresh: boolean): Promise<SiteAnalyticsReport> {
  const res = await fetch(`/v1/admin/site-analytics?days=${days}${fresh ? "&fresh=1" : ""}`, { headers: await getAuthHeaders() })
  if (!res.ok) throw new Error(await failureMessage(res, "Failed to load site analytics"))
  return (await res.json()) as SiteAnalyticsReport
}

/** The report for a range — kept five minutes here, ten on the server. The last range stays on screen while the next loads. */
export function useSiteAnalytics(days: SiteAnalyticsDays) {
  return useQuery({
    queryKey: queryKeys.admin.siteAnalytics(days),
    queryFn: () => fetchReport(days, false),
    enabled: hasAdmin(),
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
  })
}

/**
 * Once a minute, and only while the page is on screen: every realtime
 * question spends Google's allowance. The server keeps one snapshot for
 * every admin and decides when Google is actually asked.
 */
export const REALTIME_POLLING = { refetchInterval: 60_000, refetchIntervalInBackground: false } as const

/** A page nobody has touched for this long stops asking — it resumes on the next movement. */
export const REALTIME_IDLE_MS = 20 * 60_000

/** The last 30 minutes. Nothing is asked without a GA property, or while `enabled` is false (an idle page). */
export function useRealtime(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.admin.siteAnalyticsRealtime(),
    queryFn: async (): Promise<SectionResult<RealtimeSnapshot>> => {
      const res = await fetch("/v1/admin/site-analytics/realtime", { headers: await getAuthHeaders() })
      if (!res.ok) throw new Error(await failureMessage(res, "Failed to load real-time data"))
      return (await res.json()) as SectionResult<RealtimeSnapshot>
    },
    enabled: hasAdmin() && enabled,
    ...REALTIME_POLLING,
    staleTime: 30_000,
  })
}

/** Twice a minute, from a tab in view only: the server notes a visit at most every 30 s. */
export const ONLINE_USERS_POLLING = { refetchInterval: 30_000, refetchIntervalInBackground: false } as const

/** Who is signed in right now. Nothing is asked while `enabled` is false (an idle page). */
export function useOnlineUsers(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.admin.siteAnalyticsOnlineUsers(),
    queryFn: async (): Promise<OnlineUsersReport> => {
      const res = await fetch("/v1/admin/online-users", { headers: await getAuthHeaders() })
      if (!res.ok) throw new Error(await failureMessage(res, "Failed to load who is signed in"))
      return (await res.json()) as OnlineUsersReport
    },
    enabled: hasAdmin() && enabled,
    ...ONLINE_USERS_POLLING,
    staleTime: 15_000,
  })
}

/**
 * Asks Google again, past both caches. The range travels with the call, so
 * a switch while it runs cannot file one range's report under another.
 */
export function useRefreshSiteAnalytics() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (days: SiteAnalyticsDays) => fetchReport(days, true),
    onSuccess: (report, days) => queryClient.setQueryData(queryKeys.admin.siteAnalytics(days), report),
  })
}

async function inspectPage(url: string, fresh: boolean): Promise<IndexStatus> {
  const res = await fetch("/v1/admin/site-analytics/inspect", {
    method: "POST",
    headers: { ...(await getAuthHeaders()), "content-type": "application/json" },
    body: JSON.stringify({ url, fresh }),
  })
  if (!res.ok) throw new Error(await failureMessage(res, "Google could not check this page"))
  return (await res.json()) as IndexStatus
}

const DAY_MS = 24 * 3_600_000

/**
 * Whether Google indexed one page. Nothing is asked until `check` — a check
 * spends Google's scarce quota — and the answer stays in the page's cache, so
 * switching tabs, filters or ranges never loses it.
 */
export function useIndexStatus(url: string) {
  const queryClient = useQueryClient()
  const queryKey = queryKeys.admin.siteAnalyticsInspection(url)
  const query = useQuery({ queryKey, queryFn: () => inspectPage(url, false), enabled: false, staleTime: DAY_MS, gcTime: DAY_MS, retry: false })
  const check = (fresh: boolean) => {
    // The query's own state carries the error to the cell; the promise has nothing more to say.
    void queryClient.fetchQuery({ queryKey, queryFn: () => inspectPage(url, fresh), staleTime: 0, retry: false }).catch(() => undefined)
  }
  return { status: query.data, checking: query.isFetching, error: query.error, check }
}
