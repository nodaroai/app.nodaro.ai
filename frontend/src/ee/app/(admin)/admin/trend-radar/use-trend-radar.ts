import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ListTrendCandidatesParams, TrendCandidateStatus, TrendRadarSettingsPatch } from "@nodaro/sdk/trend-radar"
import { hasAdmin } from "@/lib/edition"
import { queryKeys } from "@/lib/query-keys"
import { radarClient } from "./client"

/** The SDK's error for a self-hosted instance (no radar) or Cloud before its storage exists. */
export function radarUnavailable(error: unknown): boolean {
  const status = (error as { status?: number } | null)?.status
  return status === 404 || status === 503
}

/** "Not available" is an answer, not a blip: say it at once instead of retrying. */
const retry = (count: number, error: Error) => !radarUnavailable(error) && count < 1

/** While a run is on its way the tiles and the queue re-read every 15 s (the run is asynchronous). */
export const RUN_POLLING_MS = 15_000

export function useRadarSummary(polling = false) {
  return useQuery({
    queryKey: queryKeys.admin.trendRadarSummary(),
    queryFn: () => radarClient.trendRadar.summary(),
    enabled: hasAdmin(),
    staleTime: 30_000,
    retry,
    refetchInterval: polling ? RUN_POLLING_MS : false,
  })
}

export function useRadarCandidates(params: Pick<ListTrendCandidatesParams, "status" | "sort">, polling = false) {
  return useQuery({
    queryKey: queryKeys.admin.trendRadarCandidates(params.status ?? "all", params.sort ?? "creators"),
    queryFn: () => radarClient.trendRadar.candidates({ ...params, limit: 200 }),
    enabled: hasAdmin(),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    retry,
    refetchInterval: polling ? RUN_POLLING_MS : false,
  })
}

export function useRadarCandidate(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.admin.trendRadarCandidate(id ?? ""),
    queryFn: () => radarClient.trendRadar.candidate(id!),
    enabled: hasAdmin() && !!id,
    staleTime: 30_000,
    retry,
  })
}

export function useRadarSettings() {
  return useQuery({
    queryKey: queryKeys.admin.trendRadarSettings(),
    queryFn: () => radarClient.trendRadar.settings(),
    enabled: hasAdmin(),
    staleTime: 30_000,
    retry,
  })
}

/** Every radar query, so one invalidation refreshes the queue, the open candidate and the tiles. */
function useInvalidateRadar() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: queryKeys.admin.trendRadar() })
}

export function useApproveCandidate() {
  const invalidate = useInvalidateRadar()
  return useMutation({
    mutationFn: (id: string) => radarClient.trendRadar.approve(id),
    onSuccess: () => void invalidate(),
  })
}

export function useWatchCandidate() {
  const invalidate = useInvalidateRadar()
  return useMutation({
    mutationFn: (id: string) => radarClient.trendRadar.watch(id),
    onSuccess: () => void invalidate(),
  })
}

export function useRejectCandidate() {
  const invalidate = useInvalidateRadar()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => radarClient.trendRadar.reject(id, { reason }),
    onSuccess: () => void invalidate(),
  })
}

export function useSaveRadarSettings() {
  const qc = useQueryClient()
  const invalidate = useInvalidateRadar()
  return useMutation({
    mutationFn: (patch: TrendRadarSettingsPatch) => radarClient.trendRadar.updateSettings(patch),
    onSuccess: (next) => {
      // The saved settings are the answer: the page's draft is clean at once,
      // not only after the refetch lands.
      qc.setQueryData(queryKeys.admin.trendRadarSettings(), next)
      void invalidate()
    },
  })
}

export function useRunRadar() {
  const invalidate = useInvalidateRadar()
  return useMutation({
    mutationFn: () => radarClient.trendRadar.run(),
    onSuccess: () => void invalidate(),
  })
}

/** The queue's filter pills: `all` is every candidate but the rejected and archived. */
export const QUEUE_FILTERS: ReadonlyArray<{ key: "all" | TrendCandidateStatus; label: string }> = [
  { key: "all", label: "All" },
  { key: "candidate", label: "Candidates" },
  { key: "watching", label: "Watching" },
  { key: "slowing", label: "Slowing" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
]

/** A scraped link is followed only when it is a web address. */
export function safeHref(url: string): string | undefined {
  return /^https?:\/\//i.test(url) ? url : undefined
}
