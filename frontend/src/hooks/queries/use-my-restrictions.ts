import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import { getCounterNoticeDeclaration, getMyAccountStanding, listMyRestrictions, sendCounterNotice, type CounterNoticeInput, type MyAccountStanding } from "@/lib/api"

/** The restrictions a complaint led to on my content (Settings → Content restrictions). */
export function useMyRestrictions(enabled = true) {
  return useQuery({
    queryKey: queryKeys.myRestrictions.list(),
    queryFn: async () => (await listMyRestrictions()).data,
    enabled,
    staleTime: 30_000,
  })
}

/** Where my account stands under the repeat-infringer policy (Settings → Content restrictions). */
export function useMyAccountStanding(enabled = true) {
  return useQuery({
    queryKey: queryKeys.myRestrictions.standing(),
    queryFn: async () => (await getMyAccountStanding()).data,
    enabled,
    staleTime: 30_000,
  })
}

/** Whether there is anything on my account to show: a measure in force, a warning or an infringement in the window. */
export function hasAccountStanding(standing: MyAccountStanding | undefined): boolean {
  return Boolean(standing && (standing.inForce.length > 0 || standing.warnings.length > 0 || standing.infringements.length > 0))
}

/** The declaration a counter-notification affirms, read when the form opens. */
export function useCounterNoticeDeclaration(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.myRestrictions.declaration(),
    queryFn: async () => (await getCounterNoticeDeclaration()).data,
    enabled,
    staleTime: 5 * 60_000,
  })
}

/** Sends a counter-notification; the list is read again, sent or refused. */
export function useSendCounterNotice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ restrictionId, input }: { restrictionId: string; input: CounterNoticeInput }) => sendCounterNotice(restrictionId, input),
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.myRestrictions.all }),
  })
}
