import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { getAuthHeaders } from "@/lib/api"
import { hasAdmin } from "@/lib/edition"
import { queryKeys } from "@/lib/query-keys"
import type { CancelAnswer, LaneConfig, LaneHistory, LaneSizes, LaneUserReport, LiveReport, LiveView, OverrideAnswer, OverrideBody } from "./types"

/** The server's reason, or a plain one when it sent none. */
async function failureMessage(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: { message?: unknown } } | null
  return typeof body?.error?.message === "string" ? body.error.message : fallback
}

/** A failed answer, with its HTTP status kept for the callers that tell a 404 apart. */
export class LiveUsageError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

async function getJson<T>(url: string, fallback: string): Promise<T> {
  const res = await fetch(url, { headers: await getAuthHeaders() })
  if (!res.ok) throw new LiveUsageError(await failureMessage(res, fallback), res.status)
  return (await res.json()) as T
}

export const LIVE_USAGE_INTERVAL_MS = 3_000

/** HTTP 429: asked too often. It passes, so the polling goes on. */
const TOO_MANY_REQUESTS = 429

/**
 * A refusal (4xx: not allowed, no such user) will answer the same again: stop
 * asking. Being rate-limited (429) passes, like a server error: keep asking.
 */
export function stopsPolling(error: unknown): boolean {
  return error instanceof LiveUsageError && error.status >= 400 && error.status < 500 && error.status !== TOO_MANY_REQUESTS
}

/**
 * Every 3 s, and only from a tab in view (React Query stops a background
 * tab's interval); no retries, since the next tick is one. A refusal stops the
 * polling; a server error, a rate limit or a dropped connection does not. The server keeps
 * one report for 2.5 s however many admins look, and rate-limits each admin at
 * 60 reads a minute.
 */
export const LIVE_USAGE_POLLING = {
  refetchInterval: (query: { state: { error: Error | null } }) => (stopsPolling(query.state.error) ? false : LIVE_USAGE_INTERVAL_MS),
  refetchIntervalInBackground: false,
  retry: false,
} as const

export function useLiveUsage() {
  return useQuery({
    queryKey: queryKeys.admin.lanesLive(),
    queryFn: () => getJson<LiveReport>("/v1/admin/lanes/live", "Failed to load live usage"),
    enabled: hasAdmin(),
    ...LIVE_USAGE_POLLING,
    staleTime: 2_000,
    placeholderData: keepPreviousData,
  })
}

/**
 * One user's running and waiting jobs, their own override, and their last 30
 * days, refreshed like the page while the drawer is open (the server keeps the
 * days a minute, so a refresh re-reads only the lanes and the override).
 */
export function useLaneUser(userId: string | null) {
  return useQuery({
    queryKey: queryKeys.admin.lanesUser(userId ?? ""),
    queryFn: () => getJson<LaneUserReport>(`/v1/admin/lanes/users/${encodeURIComponent(userId ?? "")}`, "Failed to load this user's lanes"),
    enabled: hasAdmin() && userId !== null,
    ...LIVE_USAGE_POLLING,
    staleTime: 2_000,
  })
}

/** The daily history: rows change once a day, so it is read once per visit, never polled. */
export function useLaneHistory(view: LiveView, days = 30) {
  return useQuery({
    queryKey: queryKeys.admin.lanesHistory(view, days),
    queryFn: () => getJson<LaneHistory>(`/v1/admin/lanes/history?days=${days}&view=${view}`, "Failed to load the lane history"),
    enabled: hasAdmin(),
    staleTime: 5 * 60_000,
  })
}

/** The lane configuration: whether overrides exist here (`editable`) and each plan's sizes. */
export function useLaneConfig() {
  return useQuery({
    queryKey: queryKeys.admin.lanesConfig(),
    queryFn: () => getJson<LaneConfig>("/v1/admin/lanes/config", "Failed to load the lane configuration"),
    enabled: hasAdmin(),
    staleTime: 60_000,
  })
}

async function send<T>(url: string, method: "POST" | "PUT", body: unknown, fallback: string): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { ...(await getAuthHeaders()), "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new LiveUsageError(await failureMessage(res, fallback), res.status)
  return (await res.json()) as T
}

/** The drawer shows a failure beside the control that caused it, so the app-wide error toast stays out. */
const SHOWN_INLINE = () => undefined

/** Cancel a waiting job on its owner's behalf (refunded through the owner's own cancel path). */
export function useCancelLaneJob(userId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (jobId: string) => send<CancelAnswer>(`/v1/admin/lanes/jobs/${encodeURIComponent(jobId)}/cancel`, "POST", {}, "Failed to cancel the job"),
    onError: SHOWN_INLINE,
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.lanesUser(userId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.lanesLive() })
    },
  })
}

/**
 * Replace a user's override; every lane null removes it. The answer is the
 * override as now stored: it becomes the drawer's at once (a refresh already
 * on its way is dropped first, so it cannot bring back the old one).
 */
export function useSaveLaneOverride(userId: string) {
  const queryClient = useQueryClient()
  const key = queryKeys.admin.lanesUser(userId)
  return useMutation({
    mutationFn: (body: OverrideBody) => send<OverrideAnswer>(`/v1/admin/lanes/users/${encodeURIComponent(userId)}`, "PUT", body, "Failed to save the override"),
    onError: SHOWN_INLINE,
    onSuccess: async (answer) => {
      await queryClient.cancelQueries({ queryKey: key })
      queryClient.setQueryData<LaneUserReport>(key, (old) => old && {
        ...old,
        own: { available: true, override: answer.override, note: answer.note, updatedAt: new Date().toISOString() },
      })
      void queryClient.invalidateQueries({ queryKey: key })
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.lanesLive() })
    },
  })
}

/** A Settings write changes what /config answers: read it again (the switch also changes the live banner). */
function useConfigWrite<V, T>(write: (v: V) => Promise<T>, alsoLive = false) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: write,
    onError: SHOWN_INLINE,
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.lanesConfig() })
      if (alsoLive) void queryClient.invalidateQueries({ queryKey: queryKeys.admin.lanesLive() })
    },
  })
}

/** One plan's four sizes (the PUT replaces the whole row). */
export function useSavePlanSizes() {
  return useConfigWrite(({ tier, sizes }: { tier: string; sizes: LaneSizes }) =>
    send<{ tier: string; sizes: LaneSizes }>(`/v1/admin/lanes/plans/${encodeURIComponent(tier)}`, "PUT", sizes, "Failed to save the plan's sizes"))
}

/** A provider's platform ceiling; null removes it (the provider is then not limited). */
export function useSaveProviderCeiling() {
  return useConfigWrite(({ provider, ceiling }: { provider: string; ceiling: number | null }) =>
    send<{ provider: string; ceiling: number | null; applied: boolean }>(
      `/v1/admin/lanes/providers/${encodeURIComponent(provider)}`, "PUT", { ceiling }, "Failed to save the provider ceiling",
    ))
}

/** The queue timeout and the live-wait limit, both at once (the PUT takes both). */
export function useSaveLaneSettings() {
  return useConfigWrite((body: { queueTimeoutMinutes: number; liveWaitMinutes: number }) =>
    send<{ settings: unknown }>("/v1/admin/lanes/settings", "PUT", body, "Failed to save the waiting limits"))
}

/** This environment's switch. `confirmUnmet` turns limits on with preconditions unmet. */
export function useSetLanesEnforced() {
  return useConfigWrite((body: { on: boolean; confirmUnmet?: true }) =>
    send<{ enforced: boolean; env: string; woke: number; mirrored: boolean }>("/v1/admin/lanes/enforced", "PUT", body, "Failed to change the switch"), true)
}
