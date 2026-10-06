import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import { getTelegramFeedCursor, resetTelegramFeedCursor } from "@/lib/api"

/**
 * The Telegram Channel Feed's position (`node_cursors`, owned by the feed's
 * route): what the card and the panel show as "Last seen #N", and what Reset
 * forgets. Keyed by workflow + node; an unsaved canvas has no position to read.
 */
export function useTelegramFeedCursor(workflowId: string | null | undefined, nodeId: string) {
  return useQuery({
    queryKey: queryKeys.telegramFeed.cursor(workflowId ?? "", nodeId),
    queryFn: () => getTelegramFeedCursor(workflowId as string, nodeId),
    enabled: !!workflowId,
    staleTime: 15_000,
  })
}

export function useResetTelegramFeedCursorMutation(workflowId: string | null | undefined, nodeId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => resetTelegramFeedCursor(workflowId as string, nodeId),
    onSuccess: () => {
      if (workflowId) void qc.invalidateQueries({ queryKey: queryKeys.telegramFeed.cursor(workflowId, nodeId) })
    },
  })
}
