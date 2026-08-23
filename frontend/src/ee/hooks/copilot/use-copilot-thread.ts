/**
 * Thread + history for the open workflow.
 *
 * Server state stays in React Query; the live turn lives in the module store
 * (`ee/lib/copilot/turn-store.ts`). The two meet in the message list: history
 * renders everything the server has persisted, and the live turn is drawn on
 * top until the refetch that follows `done` contains it.
 */
import { useEffect } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { findCopilotThread, getCopilotThread, updateCopilotThread } from "@/ee/lib/copilot/api"
import { copilotState, setCopilotState, useCopilotStore } from "@/ee/lib/copilot/turn-store"
import type { CopilotRunMode, CopilotThread, DisplayMessage } from "@/ee/lib/copilot/types"

/**
 * Resolve (but never create) the thread for this workflow. Creation happens on
 * the first send — opening the panel must not leave a thread behind.
 */
export function useCopilotThreadForWorkflow(): { thread: CopilotThread | null; loading: boolean } {
  const workflowId = useWorkflowStore((s) => s.workflowId)
  const storedThreadId = useCopilotStore((s) => s.threadId)

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.copilot.forWorkflow(workflowId ?? "none"),
    queryFn: () => findCopilotThread(workflowId!),
    enabled: Boolean(workflowId),
    staleTime: 30_000,
  })

  const resolved = data?.thread ?? null

  useEffect(() => {
    if (resolved && resolved.id !== storedThreadId) {
      setCopilotState({ threadId: resolved.id, workflowId: resolved.workflowId })
      copilotState().setRunSettings(resolved.runMode, resolved.autoRunLimitCredits)
    }
  }, [resolved, storedThreadId])

  return { thread: resolved, loading: isLoading }
}

/** Persisted messages for a thread. Empty (and idle) until a thread exists. */
export function useCopilotHistory(threadId: string | null): {
  thread: CopilotThread | null
  messages: DisplayMessage[]
} {
  const streaming = useCopilotStore((s) => s.streaming)

  const { data } = useQuery({
    queryKey: queryKeys.copilot.thread(threadId ?? "none"),
    queryFn: () => getCopilotThread(threadId!),
    enabled: Boolean(threadId),
    // While a turn streams, the live state is authoritative and refetching only
    // costs a request; the engine invalidates once the turn settles.
    staleTime: streaming ? Infinity : 5_000,
  })

  return { thread: data?.thread ?? null, messages: data?.messages ?? [] }
}

/** Ask/Auto + the auto-run credit ceiling. */
export function useCopilotSettings(threadId: string | null) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (patch: { runMode?: CopilotRunMode; autoRunLimitCredits?: number }) => {
      if (!threadId) throw new Error("no thread")
      return updateCopilotThread(threadId, patch)
    },
    onSuccess: ({ thread }) => {
      copilotState().setRunSettings(thread.runMode, thread.autoRunLimitCredits)
      queryClient.setQueryData(queryKeys.copilot.forWorkflow(thread.workflowId), { thread })
      queryClient.invalidateQueries({ queryKey: queryKeys.copilot.thread(thread.id) })
    },
  })
}
