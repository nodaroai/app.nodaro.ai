/**
 * Admin → Motion price check: the range's runs, one run, and KIE's own
 * figures (POST /v1/admin/motion-price-check/*).
 *
 * A request carries KIE's figures only once the admin fetched them; its key
 * names that fetch by its stamp (`fetchedAt`), never by the map or the token.
 *
 * An answer is final: a failure the server answered (the 503 while the
 * database lacks the functions, a 400, a 404) is shown, never asked again.
 * Only a request that got no answer at all is tried once more.
 */
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query"
import { hasAdmin } from "@/lib/edition"
import { queryKeys } from "@/lib/query-keys"
import {
  MotionPriceApiError,
  fetchKieReal,
  fetchMotionPriceRun,
  fetchMotionPriceRuns,
  type KieRealResult,
  type MotionPriceListParams,
} from "@/ee/lib/motion-price-check-api"

const kieStampOf = (kie: KieRealResult | null): string | null => kie?.fetchedAt ?? null

const retryUnanswered = (failures: number, error: unknown): boolean => !(error instanceof MotionPriceApiError) && failures < 1

/** A page of the range's runs; `params` null (a range the page refuses) asks for nothing. */
export function useMotionPriceRuns(params: MotionPriceListParams | null, kie: KieRealResult | null) {
  return useQuery({
    queryKey: queryKeys.admin.motionPriceRuns(params, kieStampOf(kie)),
    queryFn: () => fetchMotionPriceRuns(params!, kie?.kieUsd),
    enabled: hasAdmin() && params !== null,
    placeholderData: keepPreviousData,
    retry: retryUnanswered,
  })
}

/**
 * One run's steps, its quote's lines and what it reused; `jobId` null asks
 * for nothing. KIE's figures landing while the run is open keep its figures
 * on screen until the new ones are in (`placeholderData`). The drawer mounts
 * one hook per run, so one run's figures never stand in for another's.
 */
export function useMotionPriceRun(jobId: string | null, kie: KieRealResult | null) {
  return useQuery({
    queryKey: queryKeys.admin.motionPriceRun(jobId, kieStampOf(kie)),
    queryFn: () => fetchMotionPriceRun(jobId!, kie?.kieUsd),
    enabled: hasAdmin() && jobId !== null,
    placeholderData: keepPreviousData,
    retry: retryUnanswered,
  })
}

/**
 * KIE's figures for a range, read with the admin's dashboard token. The
 * mutation's variables hold the token while it runs, so it leaves the cache
 * the moment nothing observes it (`gcTime: 0`; the page resets it once it has
 * the answer). The KIE bar says a failure itself: no toast besides.
 */
export function useFetchKieReal() {
  return useMutation({
    mutationFn: (body: { token: string; from: string; to: string }) => fetchKieReal(body),
    gcTime: 0,
    onError: () => undefined,
  })
}
