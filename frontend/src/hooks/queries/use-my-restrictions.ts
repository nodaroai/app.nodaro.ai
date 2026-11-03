import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import { getCounterNoticeDeclaration, listMyRestrictions, sendCounterNotice, type CounterNoticeInput } from "@/lib/api"

/** The restrictions a complaint led to on my content (Settings → Content restrictions). */
export function useMyRestrictions(enabled = true) {
  return useQuery({
    queryKey: queryKeys.myRestrictions.list(),
    queryFn: async () => (await listMyRestrictions()).data,
    enabled,
    staleTime: 30_000,
  })
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
