/**
 * Admin → Remake faults: a page of the range's faulted Video Remake runs
 * (GET /v1/admin/remake-faults).
 *
 * An answer is final: a failure the server answered (the 503 while the
 * database lacks the function, a 400) is shown, never asked again. Only a
 * request that got no answer at all is tried once more.
 */
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { hasAdmin } from "@/lib/edition"
import { queryKeys } from "@/lib/query-keys"
import { RemakeFaultsApiError, fetchRemakeFaults, type RemakeFaultListParams } from "@/ee/lib/remake-faults-api"

const retryUnanswered = (failures: number, error: unknown): boolean => !(error instanceof RemakeFaultsApiError) && failures < 1

/** A page of faulted runs; `params` null (a range the page refuses) asks for nothing. */
export function useRemakeFaults(params: RemakeFaultListParams | null) {
  return useQuery({
    queryKey: queryKeys.admin.remakeFaults(params),
    queryFn: () => fetchRemakeFaults(params!),
    enabled: hasAdmin() && params !== null,
    placeholderData: keepPreviousData,
    retry: retryUnanswered,
  })
}
