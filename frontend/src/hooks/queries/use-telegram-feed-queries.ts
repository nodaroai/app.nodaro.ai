import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import { getTelegramFeedCursor, resetTelegramFeedCursor } from "@/lib/api"

/**
 * The Telegram Channel Feed's position (`node_cursors`, owned by the feed's
 * route): what the card and the panel show as "Last seen #N", and what Reset
 * forgets. Keyed by workflow + node; an unsaved canvas has no position to read.
 */
/** The feed's position for this node AND channel (a position is per channel; changing it starts fresh). */
export function useTelegramFeedCursor(workflowId: string | null | undefined, nodeId: string, channel?: string) {
  return useQuery({
    queryKey: queryKeys.telegramFeed.cursor(workflowId ?? "", nodeId, channel ?? ""),
    queryFn: () => getTelegramFeedCursor(workflowId as string, nodeId, channel),
    enabled: !!workflowId,
    staleTime: 15_000,
  })
}

export function useResetTelegramFeedCursorMutation(workflowId: string | null | undefined, nodeId: string, channel?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => resetTelegramFeedCursor(workflowId as string, nodeId, channel),
    onSuccess: () => {
      if (workflowId) void qc.invalidateQueries({ queryKey: queryKeys.telegramFeed.cursor(workflowId, nodeId, channel ?? "") })
    },
  })
}
