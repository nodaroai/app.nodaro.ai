import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { TrendCandidateCard, TrendCandidateStatus, TrendRadarSettingsPatch } from "@nodaro/sdk/trend-radar"
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

/** Pages the queue reads at most (200 cards each): far past any real queue, so a bug cannot loop. */
export const QUEUE_MAX_PAGES = 10

/**
 * Every card of one status (or of every open and approved status, for "all"),
 * read page by page to the end: the queue filters and sorts them in the
 * browser, so it must hold all of them, not the first page.
 */
export function useRadarQueue(status: TrendCandidateStatus | undefined, polling = false) {
  return useQuery({
    queryKey: queryKeys.admin.trendRadarCandidates(status ?? "all", "every-page"),
    queryFn: async () => {
      const cards: TrendCandidateCard[] = []
      let cursor: string | undefined
      for (let page = 0; page < QUEUE_MAX_PAGES; page++) {
        const res = await radarClient.trendRadar.candidates({ ...(status ? { status } : {}), sort: "firstSeen", limit: 200, ...(cursor ? { cursor } : {}) })
        cards.push(...res.data)
        if (!res.next) return { cards, complete: true }
        cursor = res.next
      }
      return { cards, complete: false }
    },
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

/** Reads a candidate ahead of time (the viewer's next one), so moving on shows its posts at once. */
export function usePrefetchRadarCandidate() {
  const qc = useQueryClient()
  return (id: string | null) => {
    if (!id || !hasAdmin()) return
    void qc.prefetchQuery({ queryKey: queryKeys.admin.trendRadarCandidate(id), queryFn: () => radarClient.trendRadar.candidate(id), staleTime: 30_000 })
  }
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

/** The declaration an admin confirms before a candidate's top post is downloaded (public; cached for the session). */
export function useRightsDeclaration(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.admin.trendRadarDeclaration(),
    queryFn: () => radarClient.contentRights.declaration(),
    enabled: enabled && hasAdmin(),
    staleTime: Infinity,
    retry,
  })
}

/**
 * Approve: with a top post, the admin's confirmation of the declaration for
 * its link is recorded first and rides into the clip's download.
 */
export function useApproveCandidate() {
  const invalidate = useInvalidateRadar()
  return useMutation({
    mutationFn: async ({ id, confirm }: { id: string; confirm?: { url: string; declarationVersion: number } }) => {
      const confirmation = confirm ? await radarClient.contentRights.confirm(confirm) : null
      return radarClient.trendRadar.approve(id, confirmation ? { confirmationId: confirmation.id } : {})
    },
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
